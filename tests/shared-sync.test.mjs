import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import * as C from '../public/core.mjs';
import {workspaceIdentity, legacyIdentity} from '../public/crypto-sync.mjs';
import {SHARED_SYNC_TOKEN} from '../public/sync-config.mjs';
import {CloudSync, PREFERENCES_ID} from '../public/cloud.mjs';
import {SyncMigration, migratedId} from '../public/sync-migration.mjs';
import {SyncOutbox} from '../public/sync-outbox.mjs';
import {LessonStore, memoryStorage} from '../public/store.mjs';
import {MediaStore} from '../public/media-store.mjs';
import {DEFAULT_EXPERIENCE} from '../public/preferences.mjs';
import {createRESTTransport} from '../public/rest-firestore.mjs';

const oldToken='BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB';
const makeLesson=()=>C.createLesson('Practice', C.parseTranscript('Alice: Good morning.\nBob: How are you today?'));
const fixture=JSON.parse(fs.readFileSync(new URL('./fixtures/paragraph.json',import.meta.url)));
const sample={data:fixture.audio,mime:fixture.mime,words:fixture.words,duration:fixture.duration};
const gate=()=>{let resolve;return {promise:new Promise(r=>resolve=r),resolve};};
const pause=ms=>new Promise(r=>setTimeout(r,ms));
function database(){
  const disk=new Map();
  return {disk,transaction(){
    const tx={};setTimeout(()=>tx.oncomplete?.(),0);
    tx.objectStore=()=>({
      get(key){const r={};queueMicrotask(()=>{r.result=structuredClone(disk.get(key));r.onsuccess?.();});return r;},
      put(value,key){disk.set(key,structuredClone(value));},delete(key){disk.delete(key);},
      openCursor(){const r={},keys=[...disk.keys()];let i=0;
        const next=()=>queueMicrotask(()=>{const key=keys[i];r.result=i<keys.length?{key,value:structuredClone(disk.get(key)),continue(){i++;next();}}:null;r.onsuccess?.();});
        next();return r;},
    });return tx;
  }};
}
function hub(){
  const servers=new Map();
  function factory(scope){
    if(servers.has(scope))return servers.get(scope);
    const entries=new Map(),chunks=new Map(),listeners=new Set();
    const s={entries,chunks,listeners,offline:false,loseAck:false,commits:0,chunkGate:null,chunkEntered:null,commitGate:null,commitEntered:null};
    const online=()=>{if(s.offline)throw Error('Offline');};
    Object.assign(s,{
      list:async()=>{online();return structuredClone([...entries.values()]);},
      get:async id=>{online();return structuredClone(entries.get(id));},
      chunk:async id=>{online();s.chunkEntered?.resolve();await s.chunkGate?.promise;return structuredClone(chunks.get(id));},
      putChunk:async(id,value)=>{online();chunks.set(id,structuredClone(value));},
      removeChunk:async id=>chunks.delete(id),
      commit:async(id,base,value)=>{online();s.commitEntered?.resolve();await s.commitGate?.promise;
        if((entries.get(id)?.revision||null)!==base){const e=Error('Conflict');e.code='sync/conflict';throw e;}
        s.commits++;entries.set(id,{id,...structuredClone(value)});if(s.loseAck){s.loseAck=false;throw Error('Response lost after server committed');}},
      watch:(fn,error)=>{const listener={fn,error};listeners.add(listener);return()=>listeners.delete(listener);},
      publish:async()=>{const rows=await s.list();await Promise.all([...listeners].map(l=>l.fn(rows)));},
    });servers.set(scope,s);return s;
  }return {factory,servers};
}
async function client(t,h,{identity,storage=memoryStorage(),outbox=new SyncOutbox({database:null}),beforeRemote,initialPreferences,start=true,migrate=false,media=new MediaStore()}={}){
  identity ||= await workspaceIdentity(storage,new URL('https://shadow.example/'));
  const store=new LessonStore().load(),statuses=[],changed=[];let migration;
  const sync=new CloudSync({identity,store,media,outbox,beforeRemote,initialPreferences,transportFactory:h.factory,
    onStatus:(state,text)=>statuses.push({state,text}),onChange:id=>changed.push(id),onReady:()=>migration?.run()});
  if(migrate)migration=new SyncMigration({sync,sources:identity.sources});
  t.after(()=>sync.close());if(start)await sync.start();
  return {identity,store,sync,media,outbox,statuses,changed,migration,server:h.factory(identity.scope)};
}
async function save(a,l){a.store.upsert(l);a.sync.mark(l.id);await a.sync.flush();assert(!a.sync.dirty.has(l.id));}
async function journal(a){await Promise.allSettled([...a.sync.checkpoints.values()]);}

test('ordinary root URLs independently select the same configured Firebase library without localStorage writes',async t=>{
  const h=hub();let writes=0;const storage=()=>({getItem:()=>null,setItem:()=>writes++});
  const a=await client(t,h,{storage:storage()}),b=await client(t,h,{storage:storage()});
  assert.equal(a.identity.token,SHARED_SYNC_TOKEN);assert.equal(a.identity.scope,b.identity.scope);assert.equal(writes,0);
  const l=makeLesson();l.notes='Shared across devices';l.settings.speed=1.5;
  l.sentences[0].translation='Chào buổi sáng';l.progress[l.sentences[0].id].dict.draft='Good';
  await save(a,l);await a.server.publish();assert.deepEqual(b.store.lessons[0],C.validateLesson(l));
  b.store.lessons[0].notes='Return trip';b.sync.mark(l.id);await b.sync.flush();await b.server.publish();
  assert.equal(a.store.lessons[0].notes,'Return trip');
  b.store.remove(l.id);b.sync.mark(l.id);await b.sync.flush();await b.server.publish();assert.equal(a.store.lessons.length,0);
});
test('two simultaneous first visits bootstrap preferences without an unnecessary conflict',async t=>{
  const h=hub();const [a,b]=await Promise.all([client(t,h),client(t,h)]);
  await a.server.publish();await b.sync.flush();
  assert.equal(a.sync.conflicts.size+b.sync.conflicts.size,0);assert.equal(a.sync.dirty.size+b.sync.dirty.size,0);
});
test('independent appearance fields merge, while different edits to the same field retain the version-choice flow',async t=>{
  const h=hub(),a=await client(t,h),b=await client(t,h);
  a.sync.setPreferences({...DEFAULT_EXPERIENCE,theme:'dark'},{theme:'dark'});
  b.sync.setPreferences({...DEFAULT_EXPERIENCE,volume:23},{volume:23});
  await a.sync.flush();await b.sync.flush();await b.sync.flush();await a.server.publish();
  assert.equal(b.sync.conflicts.size,0);assert.equal(a.sync.preferences.theme,'dark');assert.equal(a.sync.preferences.volume,23);
  a.sync.setPreferences({...a.sync.preferences,accent:'#112233'},{accent:'#112233'});
  b.sync.setPreferences({...b.sync.preferences,accent:'#445566'},{accent:'#445566'});
  await a.sync.flush();await b.sync.flush();assert(b.sync.conflicts.has(PREFERENCES_ID));
  await b.sync.resolve(PREFERENCES_ID,false);assert.equal(b.sync.preferences.accent,'#112233');
});
test('a delayed poll cannot undo an acknowledged newer local commit',async t=>{
  const h=hub(),a=await client(t,h),l=makeLesson();await save(a,l);
  const stale=await a.server.list();l.notes='Latest';a.sync.mark(l.id);await a.sync.flush();
  await a.sync.reconcile(stale);assert.equal(a.store.lessons[0].notes,'Latest');
  assert.equal(a.sync.records.get(l.id).revision,a.server.entries.get(l.id).revision);
});
test('typing during an asynchronous remote body read stays local until the existing conflict is resolved',async t=>{
  const h=hub(),a=await client(t,h),l=makeLesson();await save(a,l);let draftPending=false,b;
  b=await client(t,h,{beforeRemote:id=>{if(draftPending&&id===l.id){draftPending=false;b.sync.mark(id);}}});
  l.notes='Remote change';a.sync.mark(l.id);await a.sync.flush();
  a.server.chunkEntered=gate();a.server.chunkGate=gate();const polling=b.sync.reconcile(await a.server.list());
  await a.server.chunkEntered.promise;b.store.lessons[0].notes='Typed while downloading';draftPending=true;
  a.server.chunkGate.resolve();await polling;
  assert.equal(b.store.lessons[0].notes,'Typed while downloading');assert(b.sync.conflicts.has(l.id));
  await b.sync.resolve(l.id,true);await a.server.publish();assert.equal(a.store.lessons[0].notes,'Typed while downloading');
});
test('one unreadable record does not stop the rest of the library from loading',async t=>{
  const h=hub(),a=await client(t,h),first=makeLesson(),second=makeLesson();await save(a,first);await save(a,second);
  a.server.entries.get(first.id).payload.cipher='damaged';const b=await client(t,h);
  assert(b.store.lessons.some(l=>l.id===second.id));assert.equal(b.statuses.at(-1).state,'error');
});
test('repeated identical saves and retained history never delete the current body chunks',async t=>{
  const h=hub(),a=await client(t,h),l=makeLesson();await save(a,l);
  for(let i=0;i<8;i++){a.sync.mark(l.id);await a.sync.flush();}
  for(let i=0;i<6;i++){l.notes='Version '+i;a.sync.mark(l.id);await a.sync.flush();a.sync.mark(l.id);await a.sync.flush();}
  const b=await client(t,h);assert.equal(b.store.lessons[0].notes,'Version 5');assert.equal(b.sync.conflicts.size,0);
});
test('an older acknowledgement cannot erase a newer disk checkpoint',async()=>{
  const db=database(),a=new SyncOutbox({database:db}),scope='scope';
  await a.save(scope,'lesson',{pending:{sequence:1},lesson:{notes:'old'}});
  const saving=a.save(scope,'lesson',{pending:{sequence:2},lesson:{notes:'new'}}),ack=a.acknowledge(scope,'lesson',1);
  await Promise.all([saving,ack]);const b=new SyncOutbox({database:db});
  assert.equal((await b.list(scope))[0].lesson.notes,'new');await b.acknowledge(scope,'lesson',2);assert.equal(db.disk.size,0);
});
test('offline progress, preferences and generated audio survive a fresh-RAM restart; confirmed writes clear the journal',async t=>{
  const h=hub(),db=database(),a=await client(t,h,{outbox:new SyncOutbox({database:db})}),l=makeLesson();await save(a,l);
  a.server.offline=true;l.notes='Offline note';l.progress[l.sentences[0].id].dict.draft='Draft without network';
  await a.media.put(a.identity.scope+':'+l.id,{tts:{sample},full:{},source:null,recordings:{s1:{data:'AQID',mime:'audio/webm',createdAt:Date.now()}}});
  a.sync.mark(l.id);a.sync.setPreferences({...DEFAULT_EXPERIENCE,theme:'dark'},{theme:'dark'});
  await a.sync.flush();await journal(a);a.sync.close();assert(db.disk.size>=2);
  for(const value of db.disk.values())assert.equal(Object.keys(value.assets?.recordings||{}).length,0);
  const b=await client(t,h,{outbox:new SyncOutbox({database:db})});assert.equal(b.store.lessons[0].notes,'Offline note');
  assert.equal(b.store.lessons[0].progress[l.sentences[0].id].dict.draft,'Draft without network');assert.equal(b.sync.preferences.theme,'dark');
  a.server.offline=false;await b.sync.start();assert.equal(b.sync.dirty.size,0);assert.equal(db.disk.size,0);
  const c=await client(t,h);assert.equal(c.store.lessons[0].notes,'Offline note');assert.equal(c.sync.preferences.theme,'dark');
  assert.equal((await c.sync.loadAssets(l.id)).tts.sample.data,fixture.audio);
});
test('a response lost after Firebase committed is recognized on restart rather than treated as a conflicting edit',async t=>{
  const h=hub(),db=database(),a=await client(t,h,{outbox:new SyncOutbox({database:db})}),l=makeLesson();await save(a,l);
  l.notes='Server committed, response lost';a.sync.mark(l.id);a.server.loseAck=true;await a.sync.flush();await journal(a);a.sync.close();
  const commits=a.server.commits,b=await client(t,h,{outbox:new SyncOutbox({database:db})});
  assert.equal(b.sync.dirty.size,0);assert.equal(b.sync.conflicts.size,0);assert.equal(a.server.commits,commits);
  assert.equal(b.store.lessons[0].notes,l.notes);assert.equal(db.disk.size,0);
});
test('editing again while a write is waiting for acknowledgement preserves the newer checkpoint and sends it next',async t=>{
  const h=hub(),db=database(),a=await client(t,h,{outbox:new SyncOutbox({database:db})}),l=makeLesson();await save(a,l);
  a.server.commitEntered=gate();a.server.commitGate=gate();l.notes='First edit';a.sync.mark(l.id);
  const saving=a.sync.flush();await a.server.commitEntered.promise;l.notes='Second edit';a.sync.mark(l.id);await journal(a);
  a.server.commitGate.resolve();await saving;assert(a.sync.dirty.has(l.id));
  assert.equal((await new SyncOutbox({database:db}).list(a.identity.scope))[0].lesson.notes,'Second edit');
  await a.sync.flush();const b=await client(t,h);assert.equal(b.store.lessons[0].notes,'Second edit');assert.equal(db.disk.size,0);
});
test('preference acknowledgement loss does not cause a duplicate write or reset appearance after restart',async t=>{
  const h=hub(),db=database(),a=await client(t,h,{outbox:new SyncOutbox({database:db})});
  a.sync.setPreferences({...DEFAULT_EXPERIENCE,theme:'dark'},{theme:'dark'});a.server.loseAck=true;
  await a.sync.flush();await journal(a);a.sync.close();const commits=a.server.commits;
  const b=await client(t,h,{outbox:new SyncOutbox({database:db})});assert.equal(b.sync.preferences.theme,'dark');
  assert.equal(a.server.commits,commits);assert.equal(b.sync.dirty.size+b.sync.conflicts.size,0);assert.equal(db.disk.size,0);
});
test('offline preference replay merges distinct fields but does not silently overwrite a conflicting server field',async t=>{
  const h=hub(),db=database(),a=await client(t,h,{outbox:new SyncOutbox({database:db})}),b=await client(t,h);
  a.server.offline=true;a.sync.setPreferences({...DEFAULT_EXPERIENCE,theme:'dark'},{theme:'dark'});
  await a.sync.flush();await journal(a);a.sync.close();a.server.offline=false;
  b.sync.setPreferences({...DEFAULT_EXPERIENCE,volume:19},{volume:19});await b.sync.flush();
  const c=await client(t,h,{outbox:new SyncOutbox({database:db})});
  assert.equal(c.sync.preferences.theme,'dark');assert.equal(c.sync.preferences.volume,19);assert.equal(c.sync.conflicts.size,0);
  c.server.offline=true;c.sync.setPreferences({...c.sync.preferences,accent:'#112233'},{accent:'#112233'});
  await c.sync.flush();await journal(c);c.sync.close();c.server.offline=false;
  await b.sync.reconcile(await b.server.list());b.sync.setPreferences({...b.sync.preferences,accent:'#445566'},{accent:'#445566'});await b.sync.flush();
  const d=await client(t,h,{outbox:new SyncOutbox({database:db})});
  assert(d.sync.conflicts.has(PREFERENCES_ID));assert.equal(d.sync.preferences.accent,'#112233');
  await d.sync.resolve(PREFERENCES_ID,false);assert.equal(d.sync.preferences.accent,'#445566');assert.equal(db.disk.size,0);
});
test('old URLs are remembered as migration sources across reloads but never select a different destination',async()=>{
  const old=memoryStorage();old.setItem('shadowlab-private-sync',oldToken);
  const identity=await workspaceIdentity(old,new URL('https://shadow.example/'));
  assert.equal(identity.token,SHARED_SYNC_TOKEN);assert.equal(identity.sources[0].token,oldToken);
  const resumed=await workspaceIdentity(memoryStorage(),new URL(identity.resumeURL));
  assert.equal(resumed.sources[0].scope,identity.sources[0].scope);assert.equal(resumed.scope,identity.scope);
  assert(!identity.url.includes('from='));
});
test('old encrypted lessons and model audio migrate once, preserve local recordings, and leave the source cloud intact',async t=>{
  const h=hub(),sourceIdentity=await legacyIdentity(oldToken),old=await client(t,h,{identity:sourceIdentity}),l=makeLesson();
  old.sync.setPreferences({...DEFAULT_EXPERIENCE,theme:'dark'});await old.sync.flush();
  await old.media.put(sourceIdentity.scope+':'+l.id,{tts:{sample},full:{},source:sample,recordings:{s1:{data:'AQID',mime:'audio/webm',createdAt:Date.now()}}});
  await save(old,l);const sourceRows=structuredClone([...old.server.entries.values()]);
  const identity=await workspaceIdentity(memoryStorage(),new URL('https://shadow.example/#sync='+oldToken));
  const a=await client(t,h,{identity,migrate:true,media:old.media}),id=await migratedId(sourceIdentity.scope,l.id);
  assert.equal(a.migration.pending,false);assert.equal(a.store.lessons.length,1);assert.equal(a.sync.preferences.theme,'dark');
  assert.equal((await a.sync.loadAssets(id)).tts.sample.data,fixture.audio);
  assert.equal((await a.media.get(identity.scope+':'+id)).recordings.s1.data,'AQID');
  assert.deepEqual([...old.server.entries.values()],sourceRows);
  const b=await client(t,h,{identity,migrate:true});assert.equal(b.store.lessons.length,1);
  assert.equal((await b.sync.loadAssets(id)).source.data,fixture.audio);assert.deepEqual((await b.sync.loadAssets(id)).recordings,{});
});
test('reopening an old link preserves newer shared edits; changed old data is kept as a separate backup',async t=>{
  const h=hub(),sourceIdentity=await legacyIdentity(oldToken),old=await client(t,h,{identity:sourceIdentity}),l=makeLesson();await save(old,l);
  const identity=await workspaceIdentity(memoryStorage(),new URL('https://shadow.example/#sync='+oldToken));
  const a=await client(t,h,{identity,migrate:true}),id=a.store.lessons[0].id;
  a.store.lessons[0].notes='New shared edit';a.sync.mark(id);await a.sync.flush();
  let b=await client(t,h,{identity,migrate:true});assert.equal(b.store.lessons.length,1);assert.equal(b.store.lessons[0].notes,'New shared edit');
  l.notes='Independent old-device edit';old.sync.mark(l.id);await old.sync.flush();
  b=await client(t,h,{identity,migrate:true});assert.equal(b.store.lessons.length,2);
  assert.equal(b.store.lessons.find(l=>l.id===id).notes,'New shared edit');assert(b.store.lessons.some(l=>l.notes==='Independent old-device edit'));
});
test('a deleted migrated lesson is not resurrected by reopening its old link',async t=>{
  const h=hub(),old=await client(t,h,{identity:await legacyIdentity(oldToken)}),l=makeLesson();await save(old,l);
  const identity=await workspaceIdentity(memoryStorage(),new URL('https://shadow.example/#sync='+oldToken));
  const a=await client(t,h,{identity,migrate:true}),id=a.store.lessons[0].id;a.store.remove(id);a.sync.mark(id);await a.sync.flush();
  const b=await client(t,h,{identity,migrate:true});assert.equal(b.store.lessons.length,0);assert(b.sync.records.get(id).deleted);
});
test('two concurrent devices import an old workspace into a single destination lesson',async t=>{
  const h=hub(),old=await client(t,h,{identity:await legacyIdentity(oldToken)}),l=makeLesson();await save(old,l);
  const identity=await workspaceIdentity(memoryStorage(),new URL('https://shadow.example/#sync='+oldToken));
  const [a,b]=await Promise.all([client(t,h,{identity,migrate:true}),client(t,h,{identity,migrate:true})]);
  if(b.migration.pending)await b.migration.run();if(a.migration.pending)await a.migration.run();
  const c=await client(t,h);assert.equal(c.store.lessons.length,1);assert.equal(a.migration.pending||b.migration.pending,false);
});
test('interrupted migration keeps legacy local data until a retry is acknowledged, then clears only the old app keys',async t=>{
  const h=hub(),oldIdentity=await legacyIdentity(oldToken),old=await client(t,h,{identity:oldIdentity}),l=makeLesson();await save(old,l);
  const previousStorage=globalThis.localStorage,local=memoryStorage();globalThis.localStorage=local;
  t.after(()=>{globalThis.localStorage=previousStorage;});const key='shadowlab-library-'+oldIdentity.scope;
  const edited=structuredClone(l);edited.notes='Newer legacy offline note';edited.updatedAt=Date.now()+1;
  local.setItem('shadowlab-private-sync',oldToken);local.setItem(key,JSON.stringify({lessons:[edited]}));local.setItem('another-app','keep');
  const identity=await workspaceIdentity(local,new URL('https://shadow.example/')),shared=h.factory(identity.scope);
  const commit=shared.commit;let fail=true;shared.commit=async(id,...args)=>{if(fail&&id.startsWith('migrated-')){fail=false;throw Error('Interrupted import');}return commit(id,...args);};
  const a=await client(t,h,{identity,migrate:true});assert(a.migration.pending);assert(local.getItem(key));assert(identity.resumeURL.includes('from='));
  await a.sync.start();assert.equal(a.migration.pending,false);assert.equal(local.getItem(key),null);assert.equal(local.getItem('another-app'),'keep');
  const b=await client(t,h);assert.equal(b.store.lessons.length,1);assert.equal(b.store.lessons[0].notes,'Newer legacy offline note');
});
test('REST watcher reports successful unchanged polls after a failure and resumes on focus/online',async t=>{
  const originalFetch=globalThis.fetch,originalDocument=globalThis.document,originalAdd=globalThis.addEventListener,originalRemove=globalThis.removeEventListener;
  const docListeners=new Map(),windowListeners=new Map();let offline=false,reads=0,success=0,errors=0;
  globalThis.document={visibilityState:'visible',addEventListener:(k,v)=>docListeners.set(k,v),removeEventListener:k=>docListeners.delete(k)};
  globalThis.addEventListener=(k,v)=>windowListeners.set(k,v);globalThis.removeEventListener=k=>windowListeners.delete(k);
  globalThis.fetch=async()=>{reads++;if(offline)throw Error('Offline');return{ok:true,status:200,json:async()=>({documents:[]})};};
  const transport=createRESTTransport('scope',{projectId:'project',apiKey:'test'},{pollInterval:8});
  const close=transport.watch(()=>success++,()=>errors++);
  t.after(()=>{close();globalThis.fetch=originalFetch;globalThis.document=originalDocument;globalThis.addEventListener=originalAdd;globalThis.removeEventListener=originalRemove;});
  await pause(20);offline=true;await pause(20);assert(errors>0);const previous=success;
  offline=false;await windowListeners.get('online')();assert(success>previous);
  document.visibilityState='hidden';await pause(12);const hiddenReads=reads;await pause(20);assert.equal(reads,hiddenReads);
  document.visibilityState='visible';await windowListeners.get('focus')();assert(reads>hiddenReads);
  close();assert.equal(docListeners.size+windowListeners.size,0);
});
