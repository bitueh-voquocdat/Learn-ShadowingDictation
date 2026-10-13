// Opt-in real-project probe. Creates a random isolated workspace and cleans it.
// The Python relay is only for this QA environment's restricted TLS networking.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import * as C from '../public/core.mjs';
import {workspaceIdentity} from '../public/crypto-sync.mjs';
import {CloudSync,PREFERENCES_ID} from '../public/cloud.mjs';
import {LessonStore} from '../public/store.mjs';
import {MediaStore} from '../public/media-store.mjs';
import {createTransport,firebaseConfig} from '../public/firebase-adapter.mjs';
import {buildFullAudio,fullKey} from '../public/full-audio.mjs';

globalThis.document={visibilityState:'visible',addEventListener(){},removeEventListener(){}};
const bridge=fileURLToPath(new URL('./firebase_bridge.py',import.meta.url));
let requests=0;
globalThis.fetch=async(url,options={})=>{
  const response=await new Promise((resolve,reject)=>{
    const child=spawn('python3',[bridge]);let output='',error='';
    const abort=()=>{child.kill();reject(new DOMException('Aborted','AbortError'));};
    options.signal?.addEventListener('abort',abort,{once:true});
    child.stdout.on('data',v=>output+=v);child.stderr.on('data',v=>error+=v);
    child.on('error',reject);child.on('close',code=>{
      options.signal?.removeEventListener('abort',abort);
      if(code)reject(Error(error||'QA relay stopped'));else{
        try{resolve(JSON.parse(output));}catch(e){reject(e);}
      }
    });
    child.stdin.end(JSON.stringify({url:String(url),method:options.method||'GET',body:options.body,headers:options.headers||{}}));
  });
  requests++;
  return {status:response.status,ok:response.status>=200&&response.status<300,
    json:async()=>JSON.parse(Buffer.from(response.body,'base64').toString()||'null')};
};
const isolatedToken=Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString('base64url');
const identity=await workspaceIdentity({getItem:()=>null},new URL('https://shadow.example/'),isolatedToken);
const transport=createTransport(identity.scope),chunks=new Set(),entries=new Set([PREFERENCES_ID]),clients=[];
const originalPut=transport.putChunk;
transport.putChunk=async(id,value)=>{chunks.add(id);return originalPut(id,value);};
const originalCommit=transport.commit;
transport.commit=async(id,...args)=>{entries.add(id);return originalCommit(id,...args);};
let statuses=[],report;
async function client(){
  const store=new LessonStore().load(),media=new MediaStore(),restored=[];
  const sync=new CloudSync({identity,store,media,transportFactory:()=>({...transport,watch:()=>()=>{}}),
    onPreferences:value=>restored.push(value),onStatus:(state,message)=>statuses.push({state,message})});
  clients.push(sync);await sync.start();
  assert(sync.online,statuses.at(-1)?.message);assert.equal(sync.dirty.size,0,statuses.at(-1)?.message);
  return {store,media,sync,restored};
}
try{
  const a=await client();
  // No open lesson: global appearance must still have a confirmed server write.
  const preferences={theme:'dark',accent:'#2277bb',gradient:28,sound:false,volume:47,effects:true};
  a.sync.setPreferences(preferences);await a.sync.flush();assert.equal(a.sync.dirty.size,0);
  const fixture=JSON.parse(fs.readFileSync(new URL('./fixtures/paragraph.json',import.meta.url)));
  const lesson=C.createLesson('Temporary Firebase storage check',C.parseTranscript(fixture.text));
  lesson.notes='Firebase round trip';lesson.sentences[0].translation='Bản dịch đã lưu';
  lesson.progress[lesson.sentences[0].id].dict.draft='My dictation draft';
  lesson.progress[lesson.sentences[0].id].dict.hints=2;
  lesson.voiceProfiles[C.READER]={voice:C.VOICES[2],rate:-10,pitch:5};
  const full=await buildFullAudio(lesson,{},async()=>({data:fixture.audio,mime:fixture.mime,words:fixture.words,duration:fixture.duration}));
  const key=await fullKey(lesson);
  a.store.upsert(lesson);
  await a.media.put(identity.scope+':'+lesson.id,{tts:{},full:{[key]:full},source:{data:fixture.audio,mime:fixture.mime},
    recordings:{[lesson.sentences[0].id]:{data:'UklGRg==',mime:'audio/webm',createdAt:Date.now()}}});
  a.sync.mark(lesson.id);await a.sync.flush();assert.equal(a.sync.dirty.size,0,statuses.at(-1)?.message);
  const b=await client(),restored=b.store.lessons.find(l=>l.id===lesson.id);
  assert.deepEqual(b.restored.at(-1),preferences);
  assert.equal(restored.notes,lesson.notes);assert.equal(restored.sentences[0].translation,lesson.sentences[0].translation);
  assert.equal(restored.progress[lesson.sentences[0].id].dict.draft,'My dictation draft');
  assert.equal(restored.progress[lesson.sentences[0].id].dict.hints,2);
  assert.deepEqual(restored.voiceProfiles[C.READER],lesson.voiceProfiles[C.READER]);
  const audio=await b.sync.loadAssets(lesson.id);
  assert.equal(audio.full[key].data,full.data);assert.equal(audio.source.data,fixture.audio);
  assert.deepEqual(audio.recordings,{});
  assert.equal(Object.keys((await a.media.get(identity.scope+':'+lesson.id)).recordings).length,1);
  const manifest=await a.sync.unpack(await transport.get(lesson.id));
  assert(manifest.assets.every(asset=>asset.type!=='recordings'));
  lesson.settings.speed=1.5;a.sync.mark(lesson.id);await a.sync.flush();assert.equal(a.sync.dirty.size,0);
  await b.sync.reconcile(await transport.list());assert.equal(b.store.lessons[0].settings.speed,1.5);
  b.sync.setPreferences({...preferences,theme:'light'});await b.sync.flush();assert.equal(b.sync.dirty.size,0);
  await a.sync.reconcile(await transport.list());assert.equal(a.sync.preferences.theme,'light');
  report={status:'passed',project:firebaseConfig.projectId,transport:transport.mode,
    checks:['two fresh RAM clients','global appearance with no selected lesson','encrypted lesson/progress/translation/voice profiles',
      'model MP3 and source audio restored','recording binaries excluded from cloud','speed update and reverse-device preference update'],
    blobsWritten:chunks.size};
}catch(error){report={status:'failed',error:error.message};process.exitCode=1;
}finally{
  for(const sync of clients)sync.close();
  const failures=[];
  for(const id of chunks){try{await transport.removeChunk(id);}catch(e){failures.push(e.message);}}
  for(const id of entries){
    try{
      const response=await fetch(`https://firestore.googleapis.com/v1/projects/${firebaseConfig.projectId}/databases/(default)/documents/shadowlab/${identity.scope}/entries/${id}?key=${firebaseConfig.apiKey}`,{method:'DELETE'});
      if(!response.ok)failures.push('Could not clean probe entry: '+response.status);
    }catch(e){failures.push(e.message);}
  }
  report={...report,requests,temporaryRecordsRemoved:failures.length===0,...(failures.length?{cleanupErrors:failures}:{})};
  const out=process.env.TEST_OUTPUT_DIR||'/tmp/shadow-firebase-storage-qa';
  fs.mkdirSync(out,{recursive:true});fs.writeFileSync(out+'/firebase-storage-live-report.json',JSON.stringify(report,null,2));
  console.log(JSON.stringify(report,null,2));
}
