import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import * as C from '../public/core.mjs';
import {LessonStore,memoryStorage} from '../public/store.mjs';
import {CloudSync,PREFERENCES_ID} from '../public/cloud.mjs';
import {workspaceIdentity} from '../public/crypto-sync.mjs';
import {MediaStore,pruneRecordings,RECORDING_TTL} from '../public/media-store.mjs';
import {readLegacy,clearLegacy} from '../public/legacy.mjs';
import {DEFAULT_EXPERIENCE} from '../public/preferences.mjs';
import {buildFullAudio,fullKey} from '../public/full-audio.mjs';

const token='AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';
const prefs={theme:'dark',accent:'#118866',gradient:31,sound:false,volume:67,effects:false};
const lesson=()=>C.createLesson('Daily conversation',C.parseTranscript('Alice: Good morning.\nBob: Good morning to you.'));
const fixture=JSON.parse(fs.readFileSync(new URL('./fixtures/paragraph.json',import.meta.url)));
const audio={data:fixture.audio,mime:fixture.mime,words:fixture.words,duration:fixture.duration};
const deferred=()=>{let resolve;return {promise:new Promise(r=>resolve=r),resolve:v=>resolve(v)};};
function server(){
  const entries=new Map(),chunks=new Map();
  const api={entries,chunks,offline:false,commitGate:null,entered:null};
  const online=()=>{if(api.offline)throw Error('Offline');};
  Object.assign(api,{
    list:async()=>{online();return structuredClone([...entries.values()]);},watch:()=>()=>{},
    get:async id=>{online();return structuredClone(entries.get(id));},
    chunk:async id=>{online();return structuredClone(chunks.get(id));},
    putChunk:async(id,value)=>{online();chunks.set(id,structuredClone(value));},
    removeChunk:async id=>chunks.delete(id),
    commit:async(id,base,value)=>{
      online();api.entered?.resolve();await api.commitGate?.promise;
      if((entries.get(id)?.revision||null)!==base){const error=Error('Conflict');error.code='sync/conflict';throw error;}
      entries.set(id,{id,...structuredClone(value)});
    },
  });return api;
}
async function client(t,db,{media=new MediaStore(),initialPreferences=null,legacy=null,start=true}={}){
  const identity=await workspaceIdentity(memoryStorage(),new URL('https://shadow.example/#sync='+token),token);
  const store=new LessonStore().load();if(legacy)store.lessons=legacy.lessons;
  const statuses=[],restored=[],conflicts=[];
  const sync=new CloudSync({identity,store,media,initialPreferences,legacyLessons:!!legacy?.lessons.length,
    transportFactory:()=>db,onPreferences:v=>restored.push(v),onConflict:id=>conflicts.push(id),
    onStatus:(state,text)=>{statuses.push({state,text});if(state==='synced'&&legacy&&!sync.dirty.size&&!sync.conflicts.size)clearLegacy(legacy);}});
  t.after(()=>sync.close());if(start)await sync.start();
  return {identity,store,media,sync,statuses,restored,conflicts};
}
// Minimal asynchronous database adapter: disk values are cloned, including
// cursor.value on each read, so mutation of RAM cannot masquerade as a disk write.
function database(seed=[]){
  const disk=new Map(seed.map(([key,value])=>[key,structuredClone(value)]));
  return {disk,transaction(){
    const tx={oncomplete:null,onerror:null,onabort:null};
    setTimeout(()=>tx.oncomplete?.(),0);
    tx.objectStore=()=>({
      get(key){const request={};queueMicrotask(()=>{request.result=structuredClone(disk.get(key));request.onsuccess?.();});return request;},
      put(value,key){disk.set(key,structuredClone(value));},delete(key){disk.delete(key);},
      openCursor(){
        const request={},keys=[...disk.keys()];let index=0;
        const next=()=>queueMicrotask(()=>{
          const key=keys[index];
          request.result=index<keys.length?{key,get value(){return structuredClone(disk.get(key));},
            update(value){disk.set(key,structuredClone(value));},continue(){index++;next();}}:null;
          request.onsuccess?.();
        });next();return request;
      },
    });return tx;
  }};
}

test('default lesson and pending stores never use localStorage or the old quota',async t=>{
  let writes=0;const previous=globalThis.localStorage;
  globalThis.localStorage={getItem(){throw Error('Runtime must not read legacy state');},setItem(){writes++;}};
  t.after(()=>{globalThis.localStorage=previous;});
  const store=new LessonStore().load(),l=lesson();l.notes='x'.repeat(3_000_000);
  store.upsert(l);assert.equal(writes,0);assert.equal(store.storage.getItem(store.key),null);
  const a=await client(t,server());a.sync.setPreferences(prefs);
  assert.equal(writes,0);assert(a.store.storage.getItem(a.sync.queueKey));
});

test('two fresh RAM clients restore progress, settings, translations, MP3 and global appearance',async t=>{
  const db=server(),a=await client(t,db),l=lesson();
  l.notes='Tomorrow';l.sentences[0].translation='Chào buổi sáng';l.settings.speed=1.25;l.settings.strict=true;
  l.translationData={language:'vi',paragraph:'Bản dịch toàn cuộc hội thoại.',status:'complete',updatedAt:Date.now()};
  l.settings.dictType='blanks';l.voiceProfiles.Alice={voice:C.VOICES[1],rate:15,pitch:-10};
  const p=l.progress[l.sentences[0].id];p.dict.draft='Good';p.dict.hints=3;p.notes='Repeat this';
  C.addAttempt(l,l.sentences[0].id,'dict',C.compare(l.sentences[0].text,'Good evening'),{answer:'Good evening'});
  a.store.upsert(l);a.sync.setPreferences(prefs);
  const full=await buildFullAudio(l,{},async()=>audio),key=await fullKey(l);
  await a.media.put(a.identity.scope+':'+l.id,{tts:{},full:{[key]:full},source:{data:audio.data,mime:audio.mime},recordings:{}});
  a.sync.mark(l.id);await a.sync.flush();assert.equal(a.sync.dirty.size,0);
  const b=await client(t,db),restored=b.store.lessons[0];
  assert.deepEqual(restored,C.validateLesson(l));assert.deepEqual(b.restored.at(-1),prefs);
  const assets=await b.sync.loadAssets(l.id);assert.equal(assets.full[key].data,full.data);assert.equal(assets.source.data,audio.data);
  assert.notEqual(a.store,b.store);assert.notEqual(a.media,b.media);assert.equal(b.store.storage.getItem(b.store.key),null);
});

test('recordings are excluded from encrypted manifests and cloud chunks while transcripts remain',async t=>{
  const db=server(),a=await client(t,db),l=lesson(),id=l.sentences[0].id;
  l.progress[id].shadow.transcript='Good morning';a.store.upsert(l);
  await a.media.put(a.identity.scope+':'+l.id,{tts:{},full:{},source:null,
    recordings:{[id]:{data:'AQIDBA==',mime:'audio/webm',createdAt:Date.now()}}});
  a.sync.mark(l.id);await a.sync.flush();
  const manifest=await a.sync.unpack(db.entries.get(l.id));assert.deepEqual(manifest.assets,[]);
  const b=await client(t,db);assert.deepEqual((await b.sync.loadAssets(l.id)).recordings,{});
  assert.equal(b.store.lessons[0].progress[id].shadow.transcript,'Good morning');
  assert.equal((await a.media.get(a.identity.scope+':'+l.id)).recordings[id].data,'AQIDBA==');
});

test('disk stores recordings only, replacing the same sentence while preserving other recordings',async()=>{
  const db=database(),media=new MediaStore({database:db}),now=Date.now();
  const a={tts:{voice:audio},full:{render:audio},source:audio,
    recordings:{s1:{data:'AQIDBA==',mime:'audio/webm',createdAt:now},s2:{data:'AQIDBA==',mime:'audio/webm',createdAt:now}}};
  await media.put('course',a);assert.deepEqual(Object.keys(db.disk.get('course')),['recordings']);
  a.recordings.s1={data:'BQYHCA==',mime:'audio/webm',createdAt:now+1};await media.put('course',a);
  assert.equal(db.disk.get('course').recordings.s1.data,'BQYHCA==');assert.equal(Object.keys(db.disk.get('course').recordings).length,2);
  const reopened=new MediaStore({database:db}),disk=await reopened.get('course');
  assert.equal(disk.recordings.s1.data,'BQYHCA==');assert(disk._partial);assert.equal(disk.tts,undefined);
  assert.equal((await media.get('course')).tts.voice.data,audio.data);
});

test('30-day cleanup scans unopened lessons and preserves original age on reads and exports',async()=>{
  let now=Date.now();const record=createdAt=>({data:'AQIDBA==',mime:'audio/webm',createdAt});
  const db=database([
    ['old',{recordings:{expired:record(now-RECORDING_TTL),fresh:record(now-1000)},source:audio}],
    ['legacy',{recordings:{noDate:{data:'AQIDBA==',mime:'audio/webm'}}}],
  ]),media=new MediaStore({database:db,now:()=>now});
  await media.pruneExpired();assert(!db.disk.get('old').recordings.expired);assert(db.disk.get('old').source);
  const first=db.disk.get('legacy').recordings.noDate.createdAt;assert.equal(first,now);
  now+=1000;await media.pruneExpired();assert.equal(db.disk.get('legacy').recordings.noDate.createdAt,first);
  const l=lesson(),id=l.sentences[0].id,createdAt=now-9000;
  const exported=C.parseFile(C.serializeFile(l,{recordings:{[id]:record(createdAt)}}));
  assert.equal(exported.assets.recordings[id].createdAt,createdAt);
  now=first+RECORDING_TTL;await media.pruneExpired();assert.deepEqual(db.disk.get('legacy').recordings,{});
  const invalid={recordings:{empty:null,future:record(now+RECORDING_TTL)}};
  pruneRecordings(invalid,now);assert(!invalid.recordings.empty);assert.equal(invalid.recordings.future.createdAt,now);
});

test('recordings-only disk cache cannot discard model audio references during progress save',async t=>{
  const db=server(),a=await client(t,db),l=lesson(),id=l.sentences[0].id,key=a.identity.scope+':'+l.id;
  a.store.upsert(l);await a.media.put(key,{tts:{[C.audioKey(l,l.sentences[0])]:audio},full:{},source:audio,recordings:{}});
  a.sync.mark(l.id);await a.sync.flush();
  const disk=database([[key,{recordings:{[id]:{data:'AQIDBA==',mime:'audio/webm',createdAt:Date.now()}}}]]);
  const b=await client(t,db,{media:new MediaStore({database:disk})});
  b.store.lessons[0].notes='Edited before audio download';b.sync.mark(l.id);await b.sync.flush();
  const manifest=await b.sync.unpack(db.entries.get(l.id));assert.equal(manifest.assets.length,2);
  const restored=await b.sync.loadAssets(l.id);assert(restored.source);assert.equal(Object.keys(restored.tts).length,1);
  assert.equal(restored.recordings[id].data,'AQIDBA==');
});

test('legacy lesson and preferences move to Firebase before localStorage and model backups are removed',async t=>{
  const identity={...await workspaceIdentity(memoryStorage(),new URL('https://shadow.example/#sync='+token),token),migrate:false},old=memoryStorage(),l=lesson();
  old.setItem('shadowlab-private-sync',token);
  old.setItem('shadowlab-library-'+identity.scope,JSON.stringify({lessons:[l]}));
  const other=lesson();other.title='Old unsynced lesson';
  old.setItem('shadow-dictation-library-v2',JSON.stringify({lessons:[l,other]}));
  old.setItem('shadowlab-experience-v1',JSON.stringify(prefs));old.setItem('unrelated-app','Keep me');
  const legacy=readLegacy(identity,old);assert.equal(legacy.lessons.length,2);
  const db=server();db.offline=true;
  const key=identity.scope+':'+l.id,disk=database([[key,{tts:{[C.audioKey(l,l.sentences[0])]:audio},full:{},source:audio,recordings:{}}]]);
  const a=await client(t,db,{legacy,initialPreferences:legacy.preferences,media:new MediaStore({database:disk})});
  assert(old.getItem('shadowlab-library-'+identity.scope));assert(disk.disk.get(key).source);
  db.offline=false;await a.sync.start();assert.equal(a.sync.dirty.size,0);
  assert.equal(old.getItem('shadowlab-library-'+identity.scope),null);assert.equal(old.getItem('shadow-dictation-library-v2'),null);
  assert.equal(old.getItem('shadowlab-experience-v1'),null);assert.equal(old.getItem('shadowlab-private-sync'),null);
  assert.equal(old.getItem('unrelated-app'),'Keep me');assert.deepEqual(Object.keys(disk.disk.get(key)),['recordings']);
  const b=await client(t,db);assert.equal(b.store.lessons.length,2);assert.deepEqual(b.sync.preferences,prefs);
  assert((await b.sync.loadAssets(l.id)).source);
});

test('malformed legacy data remains intact and unrelated private workspaces are not migrated',async()=>{
  const identity={...await workspaceIdentity(memoryStorage(),new URL('https://shadow.example/#sync='+token),token),migrate:false},old=memoryStorage();
  old.setItem('shadowlab-library-'+identity.scope,'{broken');
  const result=readLegacy(identity,old);assert(result.error);clearLegacy(result);assert.equal(old.getItem('shadowlab-library-'+identity.scope),'{broken');
  old.removeItem('shadowlab-library-'+identity.scope);old.setItem('shadowlab-private-sync','BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB');
  old.setItem('shadow-dictation-library-v2',JSON.stringify({lessons:[lesson()]}));old.setItem('shadowlab-experience-v1',JSON.stringify(prefs));
  const unrelated=readLegacy(identity,old);assert.deepEqual(unrelated.lessons,[]);assert.equal(unrelated.preferences,null);
  clearLegacy(unrelated);assert(old.getItem('shadow-dictation-library-v2'));assert(old.getItem('shadowlab-experience-v1'));
});

test('server acknowledgement is required for synced status; offline updates stay pending',async t=>{
  const db=server(),a=await client(t,db);db.entered=deferred();db.commitGate=deferred();
  a.sync.setPreferences(prefs);const saving=a.sync.flush();await db.entered.promise;
  assert(a.sync.dirty.has(PREFERENCES_ID));assert.equal(a.statuses.at(-1).state,'pending');
  db.commitGate.resolve();await saving;assert.equal(a.statuses.at(-1).state,'synced');assert.equal(a.sync.dirty.size,0);
  db.offline=true;a.sync.setPreferences({...prefs,volume:20});await a.sync.flush();
  assert(a.sync.dirty.has(PREFERENCES_ID));assert.equal(a.statuses.at(-1).state,'error');assert.match(a.statuses.at(-1).text,/Chưa lưu lên server/);
});

test('edits to appearance during initial load merge only changed fields with server settings',async t=>{
  const db=server(),a=await client(t,db);a.sync.setPreferences(prefs);await a.sync.flush();
  const list=db.list,gate=deferred();db.list=async()=>{await gate.promise;return list();};
  const b=await client(t,db,{start:false}),starting=b.sync.start();
  b.sync.setPreferences({...DEFAULT_EXPERIENCE,theme:'light'},{theme:'light'});
  gate.resolve();await starting;
  assert.equal(b.sync.conflicts.size,0);assert.deepEqual(b.sync.preferences,{...prefs,theme:'light'});
  await a.sync.reconcile(await list());assert.deepEqual(a.sync.preferences,{...prefs,theme:'light'});
});

test('simultaneous appearance edits use the existing version-choice flow',async t=>{
  const db=server(),a=await client(t,db),b=await client(t,db);
  a.sync.setPreferences(prefs);b.sync.setPreferences({...prefs,accent:'#aa3344'});
  await a.sync.flush();await b.sync.flush();assert(b.sync.conflicts.has(PREFERENCES_ID));
  await b.sync.resolve(PREFERENCES_ID,false);assert.deepEqual(b.sync.preferences,prefs);assert.equal(b.sync.dirty.size,0);
});

test('appearance document name is not reserved by Firestore',()=>{
  assert.match(PREFERENCES_ID,/^[A-Za-z0-9_-]{1,80}$/);assert(!/^__.*__$/.test(PREFERENCES_ID));
});

test('MP3 conversion history and playback settings survive a fresh device',async t=>{
  const db=server(),a=await client(t,db),l=C.createLesson('Conversion history',C.parseTranscript(fixture.text));
  l.kind='tts';l.settings.speed=1.75;l.voiceProfiles[C.READER]={voice:C.VOICES[2],rate:20,pitch:-15};
  a.store.upsert(l);const full=await buildFullAudio(l,{},async()=>audio),key=await fullKey(l);
  await a.media.put(a.identity.scope+':'+l.id,{tts:{},full:{[key]:full},recordings:{},source:null});
  a.sync.mark(l.id);await a.sync.flush();const b=await client(t,db);
  assert.equal(b.store.lessons.filter(l=>l.kind==='tts').length,1);assert.equal(b.store.lessons[0].settings.speed,1.75);
  assert.equal(b.store.lessons[0].voiceProfiles[C.READER].pitch,-15);assert.equal((await b.sync.loadAssets(l.id)).full[key].data,full.data);
});

test('newer legacy edits are protected even when the old cloud commit has a later network timestamp',async t=>{
  const db=server(),a=await client(t,db),l=lesson();l.updatedAt=Date.now()-10_000;l.notes='Old cloud copy';
  a.store.upsert(l);a.sync.mark(l.id);await a.sync.flush();
  const edited=structuredClone(l);edited.notes='New offline edit';edited.updatedAt=Date.now()-1000;
  assert(edited.updatedAt<db.entries.get(l.id).updatedAt);
  const old=memoryStorage(),key='shadowlab-library-'+a.identity.scope;
  old.setItem(key,JSON.stringify({lessons:[edited]}));const legacy=readLegacy(a.identity,old);
  const b=await client(t,db,{legacy});assert(b.sync.conflicts.has(l.id));assert(old.getItem(key));
  assert.equal(b.store.lessons[0].notes,edited.notes);await b.sync.resolve(l.id,true);
  assert.equal(old.getItem(key),null);const c=await client(t,db);assert.equal(c.store.lessons[0].notes,edited.notes);
});
