import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import * as C from '../public/core.mjs';
import {youtubeVideoID,youtubeURL,createYouTubeSentences} from '../public/youtube-source.mjs';
import {IPAQueue,COMMON_UK,hasCurrentPhonetics,renderIPAWord,ipaKey} from '../public/ipa.mjs';
import {BrowserTranslation,TranslationQueue,hasCurrentTranslation} from '../public/translation.mjs';
const app=fs.readFileSync(new URL('../public/app.mjs',import.meta.url),'utf8');
const dictionary={words:{...JSON.parse(fs.readFileSync(new URL('../public/ipa-en-gb.json',import.meta.url))).words,...COMMON_UK},degraded:false};
const raw='0:10\nHello there.\n0:12\nHow are you?';
function setup({gate}={}) {
  const elements=new Map(),store={lessons:[],current:null},saved=[];
  function $(id){if(!elements.has(id))elements.set(id,{value:'',textContent:'',innerHTML:'',disabled:false,hidden:false,
    classList:{toggle(){}},dataset:{},close(){this.closed=true;}});return elements.get(id);}
  $('new-source-type').value='youtube';$('new-youtube-url').value='https://youtu.be/M7lc1UVf-VE';
  $('new-youtube-end').value='17';$('new-title').value='My video';$('new-text').value=raw;$('segment-size').value='32';
  $('create-confirm').textContent='Tạo bài';
  const ipa=new IPAQueue({present:l=>store.lessons.includes(l),load:async()=>{if(gate)await gate;return dictionary;}});
  const translations=new TranslationQueue({browser:new BrowserTranslation({api:()=>({availability:async()=> 'available',
    create:async()=>({translate:async text=>'Dịch: '+text})}),activation:()=>true}),save:async l=>saved.push(C.validateLesson(l))});
  const context=vm.createContext({$,C,youtubeVideoID,youtubeURL,createYouTubeSentences,structuredClone,
    preview:[],youtubePreview:null,previewSignature:'',creating:true,assetLibrary:new Map(),resultCache:new Map(),
    appTab:'study',esc:value=>String(value).replace(/</g,'&lt;'),converter:{stop:async()=>{}},stopAll:async()=>{},
    persist:async(immediate,id)=>{if(id)saved.push(C.validateLesson(store.lessons.find(l=>l.id===id)));},
    startAutoIPA:(l,opts)=>ipa.ensure(l,opts),experiencePreferences:()=>({theme:'dark'}),
    putLesson:l=>{store.lessons.push(l);store.current=l.id;return true;},bindAssets(){},render(){},preload(){},say(){},
    startAutoTranslation:l=>{context.translationJob=translations.ensure(l);},Date,Number,JSON});
  vm.runInContext(app.slice(app.indexOf('function renderPreview()'),app.indexOf('function editSentence()')),context);
  return {context,$,store,saved};
}
test('actual create handler creates YouTube, IPA and automatic translations before normal saved use',async()=>{
  const {context,$,store,saved}=setup();context.analyse();assert.equal(context.preview.length,2);
  assert.equal($('create-confirm').disabled,false);assert($('preview').innerHTML.includes('data-preview-start'));
  await context.createNew({preventDefault(){}});await context.translationJob;
  const l=store.lessons[0];assert.equal(l.settings.source,'youtube');assert.equal(l.youtube.videoId,'M7lc1UVf-VE');
  assert(hasCurrentPhonetics(l));assert(saved.every(x=>hasCurrentPhonetics(x)));
  assert(l.sentences.every(hasCurrentTranslation));assert.equal(l.translationData.status,'complete');
  assert.equal(l.sentences[0].start,10);assert.equal(l.sentences.at(-1).end,17);assert.equal(l.settings.experience.theme,'dark');
  assert($('create-dialog').closed);assert.equal($('create-confirm').textContent,'Tạo bài');
});
test('actual create handler blocks double submission during IPA generation',async()=>{
  let release;const gate=new Promise(resolve=>release=resolve),{context,$,store}=setup({gate});context.analyse();
  const first=context.createNew({preventDefault(){}});await new Promise(resolve=>setImmediate(resolve));
  assert($('create-confirm').disabled);await context.createNew({preventDefault(){}});assert.equal(store.lessons.length,0);
  release();await first;await context.translationJob;assert.equal(store.lessons.length,1);assert.equal($('create-confirm').disabled,false);
});
test('changed link and invalid preview times cannot save a stale YouTube lesson',async()=>{
  let a=setup();a.context.analyse();a.$('new-youtube-url').value='https://youtu.be/dQw4w9WgXcQ';
  await a.context.createNew({preventDefault(){}});assert.equal(a.store.lessons.length,0);assert(a.$('create-error').textContent.includes('Phân tích'));
  a=setup();a.context.analyse();a.context.preview[0].end=9;await a.context.createNew({preventDefault(){}});
  assert.equal(a.store.lessons.length,0);assert(a.$('create-error').textContent.includes('mốc'));
});
test('standard text import still uses the original parser and creates a TTS lesson',async()=>{
  const {context,$,store}=setup();$('new-source-type').value='text';$('new-text').value='Alice: Hello.\nBob: Good morning.';
  context.analyse();assert.equal(context.youtubePreview,null);assert.equal(context.preview[0].speaker,'Alice');
  assert(!$('preview').innerHTML.includes('data-preview-start'));await context.createNew({preventDefault(){}});await context.translationJob;
  assert.equal(store.lessons[0].settings.source,'tts');assert(!store.lessons[0].youtube);assert(hasCurrentPhonetics(store.lessons[0]));
});
test('actual caption renderer displays per-word IPA in YouTube Shadowing and hides answers in Dictation',async()=>{
  const s=createYouTubeSentences(raw,C).sentences,l=C.createLesson('Test',s);l.youtube={version:1,videoId:'M7lc1UVf-VE'};
  l.settings.source='youtube';l.mode='shadow';await new IPAQueue({load:async()=>dictionary}).ensure(l);
  l.sentences[0].translation='Xin chào.';l.sentences[0].translationOrigin='auto';l.sentences[0].translationSource=l.sentences[0].text;
  const els=new Map();const $=id=>{if(!els.has(id))els.set(id,{innerHTML:'',textContent:'',hidden:false,dataset:{},classList:{toggle(){}}});return els.get(id);};
  const context=vm.createContext({$,C,lesson:()=>l,sentence:()=>l.sentences[0],assets:()=>({source:null}),
    esc:v=>String(v),renderIPAWord,ipaKey,ipa:{jobs:new Map()},hasCurrentTranslation});
  vm.runInContext(app.slice(app.indexOf('function renderCaption()'),app.indexOf('function onTime(')),context);
  context.renderCaption();assert($('caption').innerHTML.includes('ipa-symbol'));assert($('caption').innerHTML.includes('data-word="1"'));
  l.mode='dict';context.renderCaption();assert($('caption').hidden);assert($('translation').hidden);assert(!$('caption').innerHTML.includes('ipa-symbol'));
});
