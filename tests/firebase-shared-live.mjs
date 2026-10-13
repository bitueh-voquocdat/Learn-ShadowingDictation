// Opt-in live Firestore check. All test-created records are tracked and removed.
// TEST_DEPLOYMENT_WORKSPACE=1 checks the as-shipped key ONLY if it is still empty.
// The default uses a random test build key so an existing user's data is untouched.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import * as C from '../public/core.mjs';
import {workspaceIdentity, legacyIdentity} from '../public/crypto-sync.mjs';
import {CloudSync} from '../public/cloud.mjs';
import {SyncMigration} from '../public/sync-migration.mjs';
import {LessonStore, memoryStorage} from '../public/store.mjs';
import {MediaStore} from '../public/media-store.mjs';
import {createTransport, firebaseConfig} from '../public/firebase-adapter.mjs';
import {buildFullAudio, fullKey} from '../public/full-audio.mjs';

globalThis.document={visibilityState:'visible',addEventListener(){},removeEventListener(){}};
const bridge=fileURLToPath(new URL('./firebase_bridge.py',import.meta.url));
let requests=0;
globalThis.fetch=async(url,options={})=>{
  const response=await new Promise((resolve,reject)=>{
    const child=spawn('python3',[bridge]);let output='',error='';
    const abort=()=>{child.kill();reject(new DOMException('Aborted','AbortError'));};
    options.signal?.addEventListener('abort',abort,{once:true});
    child.stdout.on('data',v=>output+=v);child.stderr.on('data',v=>error+=v);child.on('error',reject);
    child.on('close',code=>{options.signal?.removeEventListener('abort',abort);
      if(code)reject(Error(error||'QA relay stopped'));else{try{resolve(JSON.parse(output));}catch(e){reject(e);}}});
    child.stdin.end(JSON.stringify({url:String(url),method:options.method||'GET',body:options.body,headers:options.headers||{}}));
  });requests++;return{status:response.status,ok:response.status>=200&&response.status<300,
    json:async()=>JSON.parse(Buffer.from(response.body,'base64').toString()||'null')};
};
const deploymentProbe=process.env.TEST_DEPLOYMENT_WORKSPACE==='1';
const testKey=Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString('base64url');
// Each device independently initializes from a clean browser and the plain URL.
const rootIdentity=()=>workspaceIdentity(memoryStorage(),new URL('https://shadow.example/'),deploymentProbe?undefined:testKey);
const tracked=new Map(),clients=[],checks=[],statuses=[];
function transportFactory(scope){
  if(tracked.has(scope))return tracked.get(scope).transport;
  const raw=createTransport(scope),blobs=new Set(),entries=new Set();
  const transport={...raw,watch:()=>()=>{},putChunk:async(id,value)=>{blobs.add(id);return raw.putChunk(id,value);},
    commit:async(id,...args)=>{entries.add(id);return raw.commit(id,...args);}};
  tracked.set(scope,{transport,blobs,entries});return transport;
}
async function client({identity,migrate=false,media=new MediaStore()}={}){
  identity ||= await rootIdentity();const store=new LessonStore().load();let migration;
  const sync=new CloudSync({identity,store,media,transportFactory,onReady:()=>migration?.run(),
    onStatus:(state,message)=>statuses.push({state,message})});
  if(migrate)migration=new SyncMigration({sync,sources:identity.sources});
  clients.push(sync);await sync.start();assert(sync.online,statuses.at(-1)?.message);
  assert.equal(sync.dirty.size,0,statuses.at(-1)?.message);return {identity,store,media,sync,migration};
}
let report;
try{
  const preflight=await rootIdentity();assert.equal((await transportFactory(preflight.scope).list()).length,0,
    'This live probe will not modify a workspace that already contains data.');
  const a=await client();
  const preferences={theme:'dark',accent:'#2277bb',gradient:28,sound:false,volume:47,effects:true};
  a.sync.setPreferences(preferences);await a.sync.flush();assert.equal(a.sync.dirty.size,0);
  const fixture=JSON.parse(fs.readFileSync(new URL('./fixtures/paragraph.json',import.meta.url)));
  const lesson=C.createLesson('Temporary multi-device sync check',C.parseTranscript(fixture.text));
  lesson.notes='Device A';lesson.settings.speed=1.5;lesson.sentences[0].translation='Bản dịch đã lưu';
  lesson.translationData={language:'vi',paragraph:'Bản dịch toàn bài.',status:'complete',updatedAt:Date.now()};
  const sid=lesson.sentences[0].id;lesson.progress[sid].dict.draft='My dictation draft';lesson.progress[sid].dict.hints=2;
  C.addAttempt(lesson,sid,'dict',C.compare(lesson.sentences[0].text,'Wrong answer'),{answer:'Wrong answer'});
  lesson.voiceProfiles[C.READER]={voice:C.VOICES[2],rate:-10,pitch:5};
  const full=await buildFullAudio(lesson,{},async()=>({data:fixture.audio,mime:fixture.mime,words:fixture.words,duration:fixture.duration}));
  const key=await fullKey(lesson);a.store.upsert(lesson);
  await a.media.put(a.identity.scope+':'+lesson.id,{tts:{},full:{[key]:full},source:{data:fixture.audio,mime:fixture.mime},
    recordings:{[sid]:{data:'UklGRg==',mime:'audio/webm',createdAt:Date.now()}}});
  a.sync.mark(lesson.id);await a.sync.flush();assert.equal(a.sync.dirty.size,0);
  const b=await client();assert.notEqual(a.identity,b.identity);assert.equal(a.identity.scope,b.identity.scope);
  assert.deepEqual(b.sync.preferences,preferences);assert.deepEqual(b.store.lessons[0],C.validateLesson(lesson));
  checks.push('Independent fresh devices opening the root URL restore the same lesson, progress, translation, voices and appearance');
  const assets=await b.sync.loadAssets(lesson.id);assert.equal(assets.full[key].data,full.data);assert.equal(assets.source.data,fixture.audio);
  assert.deepEqual(assets.recordings,{});assert.equal((await a.media.get(a.identity.scope+':'+lesson.id)).recordings[sid].data,'UklGRg==');
  checks.push('MP3 and source audio restore; learner recording binary remains local');
  b.sync.setPreferences({...preferences,theme:'light'},{theme:'light'});await b.sync.flush();
  await a.sync.reconcile(await a.sync.transport.list());assert.equal(a.sync.preferences.theme,'light');
  checks.push('Reverse-device preference updates');
  b.store.lessons[0].notes='Concurrent device B';b.sync.mark(lesson.id);
  a.store.lessons[0].notes='Concurrent device A';a.sync.mark(lesson.id);await a.sync.flush();await b.sync.flush();
  assert(b.sync.conflicts.has(lesson.id));await b.sync.resolve(lesson.id,true);assert.equal(b.sync.dirty.size,0);
  const c=await client();assert.equal(c.identity.scope,a.identity.scope);assert.equal(c.store.lessons[0].notes,'Concurrent device B');
  checks.push('Real server revision preconditions detect simultaneous lesson edits; existing resolution persists to a third fresh device');
  const sourceIdentity=await legacyIdentity(Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString('base64url'));
  const old=await client({identity:sourceIdentity}),oldLesson=C.createLesson('Temporary old workspace',C.parseTranscript('Hello from the old device.'));
  old.store.upsert(oldLesson);old.sync.mark(oldLesson.id);await old.sync.flush();assert.equal(old.sync.dirty.size,0);
  const oldSnapshot=await old.sync.transport.list(),newIdentity=await rootIdentity();newIdentity.sources=[sourceIdentity];
  const migrated=await client({identity:newIdentity,migrate:true});assert.equal(migrated.migration.pending,false);
  assert(migrated.store.lessons.some(l=>l.title===oldLesson.title));assert.deepEqual(await old.sync.transport.list(),oldSnapshot);
  const repeated=await client({identity:{...await rootIdentity(),sources:[sourceIdentity]},migrate:true});
  assert.equal(repeated.store.lessons.filter(l=>l.title===oldLesson.title).length,1);
  checks.push('Old encrypted workspace imports into the shared library without deleting source records or duplicating on retry');
  c.store.remove(lesson.id);c.sync.mark(lesson.id);await c.sync.flush();await a.sync.reconcile(await a.sync.transport.list());
  assert(!a.store.lessons.some(l=>l.id===lesson.id));checks.push('Deletion propagates to another device');
  report={status:'passed',project:firebaseConfig.projectId,transport:'rest',testedAsShippedWorkspace:deploymentProbe,
    rootURLHadSyncFragment:false,checks};
}catch(error){report={status:'failed',error:error.message,checks};process.exitCode=1;
}finally{
  for(const sync of clients)sync.close();const failures=[];let blobsRemoved=0,entriesRemoved=0;
  for(const [scope,trackedWorkspace] of tracked){
    for(const id of trackedWorkspace.blobs){try{await trackedWorkspace.transport.removeChunk(id);blobsRemoved++;}catch(e){failures.push(e.message);}}
    for(const id of trackedWorkspace.entries){try{
      const response=await fetch(`https://firestore.googleapis.com/v1/projects/${firebaseConfig.projectId}/databases/(default)/documents/shadowlab/${scope}/entries/${id}?key=${firebaseConfig.apiKey}`,{method:'DELETE'});
      if(!response.ok&&response.status!==404)failures.push('Cleanup HTTP '+response.status);else entriesRemoved++;
    }catch(e){failures.push(e.message);}}
  }
  report={...report,requests,blobsRemoved,entriesRemoved,temporaryRecordsRemoved:failures.length===0,...(failures.length?{cleanupErrors:failures}:{})};
  if(failures.length)process.exitCode=1;
  const out=process.env.TEST_OUTPUT_DIR||'/tmp/shadow-firebase-shared-qa';fs.mkdirSync(out,{recursive:true});
  fs.writeFileSync(out+'/firebase-shared-live-report.json',JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));
}
