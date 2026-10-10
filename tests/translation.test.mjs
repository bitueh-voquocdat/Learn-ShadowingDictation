import test from 'node:test';
import assert from 'node:assert/strict';
import * as C from '../public/core.mjs';
import {LessonStore} from '../public/store.mjs';
import {TranslationQueue, translationPlan, paragraphText, paragraphChunks, translationBatches, hasCurrentTranslation} from '../public/translation.mjs';
import {sanitizeExperience, palette, contrastRatio} from '../public/preferences.mjs';

const make = text => C.createLesson('Automatic Vietnamese', C.parseTranscript(text));
const response = items => ({ok: true, json: async () => ({translations: items.map(item => ({...item, translation: `Bản dịch: ${item.text}`, provider: 'fixture'}))})});
const memory = () => { const data = new Map(); return {getItem: key => data.get(key) || null, setItem: (key, value) => data.set(key, value)}; };

test('auto translates each sentence and whole dialogue, without changing learning state', async () => {
  const l = make('Alice: Good morning!\nRyan: How are you?');
  l.notes = 'My notes'; l.settings.speed = 1.25; l.progress[l.sentences[0].id].dict.draft = 'good';
  const before = structuredClone({settings:l.settings, progress:l.progress, notes:l.notes, cursor:l.cursor});
  const calls = [], saves = [];
  const queue = new TranslationQueue({fetcher: async (url, request) => {
    assert.equal(url, '/api/translate'); const body = JSON.parse(request.body);
    assert.equal(body.source, 'en'); assert.equal(body.target, 'vi'); calls.push(body.items);
    return response([...body.items].reverse());
  }, save: async l => saves.push(C.validateLesson(l))});
  assert.equal(await queue.ensure(l), true);
  assert(l.sentences.every(s => s.translationOrigin === 'auto' && s.translationSource === s.text));
  assert.match(l.translationData.paragraph, /Alice: Good morning/);
  assert.equal(l.translationData.status, 'complete'); assert.equal(queue.jobs.size, 0);
  assert.deepEqual({settings:l.settings, progress:l.progress, notes:l.notes, cursor:l.cursor}, before);
  assert.equal(calls.length, 1); assert(saves.length >= 1);
  await queue.ensure(l); assert.equal(calls.length, 1, 'saved translations are reused');
});

test('translation and appearance survive export/import and legacy adapter reload', async () => {
  const l = make('Hello! I learn every day.');
  l.settings.experience = {theme:'dark',accent:'#7650cc',gradient:12,sound:false,volume:15,effects:false};
  await new TranslationQueue({fetcher: async (_, request) => response(JSON.parse(request.body).items)}).ensure(l);
  const imported = C.parseFile(C.serializeFile(l)).lesson;
  assert.deepEqual(imported.translationData,l.translationData);
  assert.deepEqual(imported.sentences,l.sentences);
  assert.deepEqual(imported.settings.experience,l.settings.experience);
  const local = memory(), first = new LessonStore(local).load(); first.upsert(l);
  const restored = new LessonStore(local).load().selected();
  assert.deepEqual(restored.translationData,l.translationData);
  assert.equal(restored.settings.experience.theme,'dark');
  assert.equal(translationPlan(restored).items.length,0);
});

test('manual translations are preserved, including edits made during a request', async () => {
  const l = make('Hello! How are you?');
  l.sentences[0].translation = 'Xin chào bạn!'; l.sentences[0].translationOrigin = 'manual';
  let complete;
  const queue = new TranslationQueue({fetcher: async (_, request) => {
    const items=JSON.parse(request.body).items;
    assert(!items.some(i => i.text==='Hello!'));
    return new Promise(resolve=> {complete=()=>resolve(response(items));});
  }});
  const job=queue.ensure(l);
  l.sentences[1].translation='Bạn khỏe không?'; l.sentences[1].translationOrigin='manual';
  complete(); await job;
  assert.deepEqual(l.sentences.map(s=>s.translation),['Xin chào bạn!','Bạn khỏe không?']);
});

test('editing English in flight discards stale results and translates new text', async () => {
  const l = make('Old sentence.'); let release, calls=0;
  const queue=new TranslationQueue({fetcher: async (_, request)=> {
    const items=JSON.parse(request.body).items; calls++;
    if(calls===1)return new Promise(resolve=>{release=()=>resolve(response(items));});
    return response(items);
  }});
  const first=queue.ensure(l); l.sentences[0].text='New sentence.'; queue.ensure(l);
  release(); await first;
  if(queue.jobs.get(l.id))await queue.jobs.get(l.id).promise;
  assert.equal(calls,2); assert.match(l.sentences[0].translation,/New sentence/);
  assert(!l.translationData.paragraph.includes('Old sentence'));
});

test('provider failure keeps the lesson usable and retry preserves partial translations', async () => {
  const l=make('Hello! How are you?'); let calls=0;
  const queue=new TranslationQueue({fetcher:async (_,request)=> {
    const items=JSON.parse(request.body).items;calls++;
    if(calls===1)return {ok:true,json:async()=>({translations:[{...items[0],translation:'Xin chào!'}]})};
    assert(!items.some(i=>i.text==='Hello!')); return response(items);
  }});
  assert.equal(await queue.ensure(l),false); assert.equal(l.translationData.status,'partial');
  assert.equal(l.sentences[0].translation,'Xin chào!'); assert.equal(l.sentences.length,2);
  assert.equal(await queue.ensure(l),true); assert.equal(l.sentences[0].translation,'Xin chào!');
  const offline=make('Offline sentence.');
  const failing=new TranslationQueue({fetcher:async()=>{throw Error('Network offline');}});
  assert.equal(await failing.ensure(offline),false);assert.equal(offline.translationData.status,'partial');
  assert.equal(offline.sentences[0].text,'Offline sentence.'); assert.equal(failing.jobs.size,0);
});

test('canceling or replacing a lesson cannot write an old translation into its replacement', async () => {
  const old=make('Old lesson.');let release,calls=0;
  const queue=new TranslationQueue({fetcher:async(_,request)=>{
    calls++;const items=JSON.parse(request.body).items;
    if(calls===1)return new Promise(resolve=>{release=()=>resolve(response(items));});
    return response(items);
  }});
  const pending=queue.ensure(old); const newer=make('New lesson.');newer.id=old.id;
  await queue.ensure(newer); release(); await pending;
  assert.equal(old.sentences[0].translation,''); assert.match(newer.sentences[0].translation,/New lesson/);
  assert.equal(queue.jobs.size,0);
});

test('long text, paragraph cache and sentence identifiers remain bounded and unambiguous', async () => {
  const l=make(Array.from({length:60},(_,i)=>`Sentence number ${i} has a little more content.`).join(' '));
  l.sentences[0].id='paragraph:0';
  const requests=[],queue=new TranslationQueue({fetcher:async(_,request)=>{
    const items=JSON.parse(request.body).items;requests.push(items);assert.equal(new Set(items.map(i=>i.id)).size,items.length);
    return response(items);
  }});
  await queue.ensure(l);
  assert(requests.every(batch=>batch.length<=8 && batch.reduce((n,i)=>n+i.text.length,0)<=10000));
  assert(paragraphChunks(paragraphText(l)).every(text=>text.length<=1800));
  assert.equal(l.translationData.status,'complete');
  const chunks=paragraphChunks(paragraphText(l));assert.equal(l.translationData.parts.length,chunks.length);
  const restored=C.validateLesson(l);assert.equal(translationPlan(restored).items.length,0);
});

test('stale auto translations are detected, legacy manual translations remain valid',()=>{
  assert.equal(hasCurrentTranslation({text:'New',translation:'Cũ',translationOrigin:'auto',translationSource:'Old'}),false);
  assert.equal(hasCurrentTranslation({text:'New',translation:'Thủ công'}),true);
  assert(translationBatches(Array.from({length:25},(_,i)=>({id:String(i),text:'x'.repeat(1800)}))).every(b=>b.reduce((n,i)=>n+i.text.length,0)<=10000));
});

test('a recovered paragraph cache is reused without another provider request',async()=>{
  const l=make('Saved sentence.');
  await new TranslationQueue({fetcher:async(_,request)=>response(JSON.parse(request.body).items)}).ensure(l);
  const original=l.translationData.paragraph;
  l.translationData.paragraph='';l.translationData.status='partial';
  const queue=new TranslationQueue({fetcher:async()=>{throw Error('A cached paragraph must not be requested again');}});
  assert.equal(await queue.ensure(l),true);assert.equal(l.translationData.paragraph,original);
});

test('a long Vietnamese translation is not truncated when saved or reopened',async()=>{
  const l=make('A long sentence may need a longer translation.');
  const text='Bản dịch tiếng Việt đầy đủ. '.repeat(100).trim();
  assert(text.length>2000 && text.length<8000);
  const queue=new TranslationQueue({fetcher:async(_,request)=>({ok:true,json:async()=>({
    translations:JSON.parse(request.body).items.map(i=>({...i,translation:text})),
  })})});
  await queue.ensure(l);assert.equal(l.sentences[0].translation,text);
  assert.equal(C.parseFile(C.serializeFile(l)).lesson.sentences[0].translation,text);
});

test('custom colors remain readable in both themes, malformed settings are sanitized',()=>{
  for(const color of ['#ffffff','#000000','#ff0000','#00ff00','#0000ff','#ffff00','#3458ff','#7650cc','#777777'])
    for(const dark of [true,false]){
      const p=palette({accent:color},dark);
      assert(contrastRatio(p['--blue'],p['--surface'])>=4.5,`${color} accent contrast`);
      assert(contrastRatio(p['--blue'],p['--on-accent'])>=4.5,`${color} button contrast`);
      assert(contrastRatio(p['--hover'],p['--on-accent'])>=4.5,`${color} hover contrast`);
      assert(contrastRatio(p['--ink'],p['--surface'])>=7);
    }
  assert.deepEqual(sanitizeExperience({theme:'invalid',accent:'url(evil)',gradient:-5,volume:900,sound:0}),
    {theme:'light',accent:'#3458ff',gradient:0,sound:true,volume:100,effects:true});
});
