import test from 'node:test';
import assert from 'node:assert/strict';
import * as C from '../public/core.mjs';
import {BrowserTranslation, TranslationQueue, translationPlan} from '../public/translation.mjs';

const make = text => C.createLesson('Browser translation', C.parseTranscript(text));
const deferred = () => { let resolve, reject; const promise = new Promise((yes,no) => {resolve=yes;reject=no;}); return {promise,resolve,reject}; };
const tick = () => new Promise(resolve => setImmediate(resolve));
function fixture({availability='available', create, translate}={}) {
  const calls={create:0,translate:[]};
  const api={availability:async options=>{assert.deepEqual(options,{sourceLanguage:'en',targetLanguage:'vi'});return availability;},
    create:async options=>{calls.create++;assert.equal(options.targetLanguage,'vi');
      return create ? create(options) : {translate:async (text,options)=>{
        calls.translate.push(text);assert(options.signal instanceof AbortSignal);
        return translate ? translate(text,options) : `Dịch: ${text}`;
      }};
    }};
  return {api,calls};
}

test('default app route uses native Translator, no server fetch; results stay portable',async()=>{
  const f=fixture(),old=globalThis.Translator,fetch=globalThis.fetch;
  globalThis.Translator=f.api;
  globalThis.fetch=()=>{throw Error('The native route must not call /api/translate');};
  try {
    const l=make('Alice: Hello!\nRyan: Good morning.');
    l.notes='Keep'; l.settings.speed=1.5; l.progress[l.sentences[0].id].dict.draft='My draft';
    const before=structuredClone({notes:l.notes,settings:l.settings,progress:l.progress});
    const queue=new TranslationQueue();assert.equal(await queue.ensure(l),true);
    assert(l.sentences.every(s=>s.translationOrigin==='auto' && s.translationSource===s.text));
    assert.match(l.translationData.paragraph,/Alice/); assert.equal(f.calls.create,1);
    assert.deepEqual({notes:l.notes,settings:l.settings,progress:l.progress},before);
    const copy=C.parseFile(C.serializeFile(l)).lesson;
    assert.equal(translationPlan(copy).items.length,0);
    await queue.ensure(copy);assert.equal(f.calls.create,1);assert.equal(f.calls.translate.length,3);
  } finally {if(old===undefined)delete globalThis.Translator;else globalThis.Translator=old;globalThis.fetch=fetch;}
});

test('first download requires activation, reports progress, and shares one model',async()=>{
  let active=false; const progress=[], f=fixture({availability:'downloadable',create:async options=>{
    options.monitor({addEventListener:(type,callback)=>{assert.equal(type,'downloadprogress');callback({loaded:.5});callback({loaded:1});}});
    return {translate:async()=> 'Xin chào'};
  }});
  const native=new BrowserTranslation({api:()=>f.api,activation:()=>active,progress:value=>progress.push(value)});
  await assert.rejects(native.prepare(),/Bấm Dịch phần còn thiếu/); assert.equal(f.calls.create,0);
  active=true;const [first,second]=await Promise.all([native.prepare(),native.prepare()]);
  assert.equal(first,second); assert.equal(f.calls.create,1);assert(progress.includes(50));assert.equal(progress.at(-1),null);
  active=false;assert.equal(await native.prepare(),first);
});

test('unsupported API and unsupported language pair provide useful errors without deleting lessons',async()=>{
  for(const api of [undefined,{availability:async()=> 'unavailable',create:async()=>{throw Error('must not create');}}]) {
    const l=make('Keep this lesson.');const before=structuredClone(l.progress);
    const queue=new TranslationQueue({browser:new BrowserTranslation({api:()=>api})});
    assert.equal(await queue.ensure(l),false);assert.match(l.translationData.error,/chưa hỗ trợ/);
    assert.equal(l.sentences[0].text,'Keep this lesson.');assert.deepEqual(l.progress,before);assert.equal(queue.jobs.size,0);
  }
});

test('cancelled lessons do not wait for or receive a pending model download',async()=>{
  const ready=deferred(),entered=deferred(), f=fixture({create:async()=>{entered.resolve();return ready.promise;}});
  const native=new BrowserTranslation({api:()=>f.api});const queue=new TranslationQueue({browser:native});
  const l=make('Cancelled lesson.'),pending=queue.ensure(l);await entered.promise;queue.cancel(l.id);
  assert.equal(await pending,false);assert.equal(l.sentences[0].translation,'');
  ready.resolve({translate:async text=>`Dịch: ${text}`});await native.prepare();
  const next=make('Another lesson.');assert.equal(await queue.ensure(next),true);assert.equal(f.calls.create,1);
});

test('completed items survive a later native error and retry only requests missing content',async()=>{
  let count=0;const f=fixture({translate:async text=>{if(++count===2)throw Error('Native service interrupted');return `Dịch: ${text}`;}});
  const queue=new TranslationQueue({browser:new BrowserTranslation({api:()=>f.api})});const l=make('Hello! Good morning.');
  assert.equal(await queue.ensure(l),false);assert.equal(l.sentences[0].translation,'Dịch: Hello!');
  assert.match(l.translationData.error,/Native service interrupted/);
  assert.equal(await queue.ensure(l),true);assert.equal(f.calls.translate.filter(x=>x==='Hello!').length,1);
});

test('manual edits and changed English still reject outdated native translations',async()=>{
  const wait=deferred(),entered=deferred();let first=true;
  const f=fixture({translate:async text=>{if(first){first=false;entered.resolve();await wait.promise;}return `Dịch: ${text}`;}});
  const queue=new TranslationQueue({browser:new BrowserTranslation({api:()=>f.api})});const l=make('Old text.');
  const pending=queue.ensure(l);await entered.promise;l.sentences[0].text='New text.';queue.ensure(l);wait.resolve();await pending;
  if(queue.jobs.get(l.id))await queue.jobs.get(l.id).promise;
  assert.equal(l.sentences[0].translation,'Dịch: New text.');assert(!l.translationData.paragraph.includes('Old text'));
  const hand=make('Hello!');hand.sentences[0].translation='Thủ công';hand.sentences[0].translationOrigin='manual';
  await queue.ensure(hand);assert.equal(hand.sentences[0].translation,'Thủ công');
});

test('native translation errors never replace a previous valid translation with an empty string',async()=>{
  const f=fixture({translate:async()=>''});const l=make('Hi!');
  const queue=new TranslationQueue({browser:new BrowserTranslation({api:()=>f.api})});
  assert.equal(await queue.ensure(l),false);assert.match(l.translationData.error,/trống/);assert.equal(l.sentences[0].translation,'');
});

test('failed model creation resets the promise so a click can retry',async()=>{
  let count=0;const f=fixture({create:async()=>{if(++count===1)throw new DOMException('Not allowed','NotAllowedError');return {translate:async()=> 'Xin chào'};}});
  const native=new BrowserTranslation({api:()=>f.api});await assert.rejects(native.prepare(),/Bấm Dịch/);
  assert(await native.prepare());assert.equal(f.calls.create,2);
  let once=true;const synchronous={...f.api,availability:()=>{if(once){once=false;throw Error('Synchronous error');}return Promise.resolve('available');}};
  const second=new BrowserTranslation({api:()=>synchronous});await assert.rejects(second.prepare(),/Synchronous/);assert(await second.prepare());
});

test('model initialization has a bounded timeout instead of a permanent pending job',async()=>{
  const f=fixture({create:async()=>new Promise(()=>{})});
  const native=new BrowserTranslation({api:()=>f.api,downloadTimeout:5});
  await assert.rejects(native.prepare(),/quá thời gian chờ/);assert.equal(native.creating,null);
});

test('translation cancellation reaches the native operation and leaves its result unsaved',async()=>{
  const entered=deferred();const f=fixture({translate:async(text,{signal})=>{
    entered.resolve();return new Promise((resolve,reject)=>signal.addEventListener('abort',()=>reject(signal.reason),{once:true}));
  }});
  const queue=new TranslationQueue({browser:new BrowserTranslation({api:()=>f.api})}),l=make('Cancelled text.');
  const pending=queue.ensure(l);await entered.promise;queue.cancel(l.id);assert.equal(await pending,false);assert.equal(l.sentences[0].translation,'');
});

test('already downloaded models translate even if navigator reports offline',async()=>{
  const f=fixture(),old=globalThis.navigator;Object.defineProperty(globalThis,'navigator',{configurable:true,value:{onLine:false,userActivation:{isActive:false}}});
  try {const queue=new TranslationQueue({browser:new BrowserTranslation({api:()=>f.api})});assert.equal(await queue.ensure(make('Offline works.')),true);}
  finally {Object.defineProperty(globalThis,'navigator',{configurable:true,value:old});}
});
