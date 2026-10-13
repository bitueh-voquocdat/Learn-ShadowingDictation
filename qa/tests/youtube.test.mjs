import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import * as C from '../public/core.mjs';
import {youtubeVideoID,youtubeURL,readYouTubeCues,createYouTubeSentences,
  sanitizeYouTubeSource,sanitizeSubtitleTiming,subtitleWords} from '../public/youtube-source.mjs';
import {IPAQueue,hasCurrentPhonetics,COMMON_UK} from '../public/ipa.mjs';
import {BrowserTranslation,TranslationQueue,hasCurrentTranslation} from '../public/translation.mjs';
import {CloudSync} from '../public/cloud.mjs';
import {LessonStore,memoryStorage} from '../public/store.mjs';
import {MediaStore} from '../public/media-store.mjs';
import {SyncOutbox} from '../public/sync-outbox.mjs';
import {workspaceIdentity} from '../public/crypto-sync.mjs';
const videoId='M7lc1UVf-VE',url=youtubeURL(videoId);
const transcript='0:10\nHello there.\n0:12\nHow are you today?\n0:15\nI am fine.';
function makeLesson(raw=transcript){const parsed=createYouTubeSentences(raw,C);const l=C.createLesson('YouTube lesson',parsed.sentences);
  l.youtube={version:1,videoId,url,format:parsed.format,transcript:raw,importedAt:Date.now(),wordTiming:'estimated'};
  l.settings.source='youtube';return l;}
const close=(a,b)=>assert(Math.abs(a-b)<.002,`${a} != ${b}`);
test('YouTube URL formats are canonicalized and spoofed hosts are rejected',()=>{
  for(const link of [url,`https://youtu.be/${videoId}?t=10`,`https://m.youtube.com/watch?v=${videoId}&list=abc`,
    `https://www.youtube.com/shorts/${videoId}`,`https://youtube.com/live/${videoId}`,
    `https://www.youtube-nocookie.com/embed/${videoId}`]) assert.equal(youtubeVideoID(link),videoId);
  for(const bad of ['https://youtube.com.attacker.test/watch?v='+videoId,'javascript:alert(1)',
    'https://attacker.test/youtube.com?v='+videoId,'https://youtube.com/playlist?list=abc',
    'https://user:pass@youtube.com/watch?v='+videoId,'https://youtu.be/short','https://youtu.be/'+videoId+'/extra'])
    assert.throws(()=>youtubeVideoID(bad));
});
test('copied YouTube transcript timestamps become timed lessons with a labelled estimated tail',()=>{
  const {sentences:s,format}=createYouTubeSentences(transcript,C);
  assert.equal(format,'youtube');assert.equal(s.length,3);assert.equal(s[0].start,10);assert.equal(s[0].end,12);
  assert.equal(s[1].start,12);assert.equal(s[1].end,15);assert.equal(s[2].timing,'estimated');
  assert(s.every(x=>sanitizeSubtitleTiming(x.subtitleTiming,x)));
  assert.equal(createYouTubeSentences(transcript,C,{lastEnd:19}).sentences.at(-1).end,19);
});
test('inline timestamps and hours are accepted; header text is ignored',()=>{
  const s=createYouTubeSentences('Transcript\nEnglish\nSearch in video\n[1:02:03.250] Hello.\n1:02:05 Good morning.',C).sentences;
  close(s[0].start,3723.25);close(s[0].end,3725);assert.equal(s[1].text,'Good morning.');
});
test('SRT fragments are merged at sentence boundaries and preserve cue-specific word times',()=>{
  const raw='1\n00:00:02,000 --> 00:00:04,000\nI would like\n\n2\n00:00:04,000 --> 00:00:06,000\nsome tea, please.\n\n3\n00:00:07,000 --> 00:00:09,000\nThank you.';
  const s=createYouTubeSentences(raw,C).sentences;
  assert.equal(s.length,2);assert.equal(s[0].text,'I would like some tea, please.');
  assert.equal(s[0].start,2);assert.equal(s[0].end,6);close(s[0].subtitleTiming.words[3].start,4);
  assert.equal(s[0].timing,'cue');
});
test('VTT speaker turns and multiple sentences split cue time without dropping words',()=>{
  const raw='WEBVTT\n\nNOTE Imported subtitles\nA note\n\n00:01.000 --> 00:05.000 align:start\n<v Alice>Hello there. How are you?</v>\n\n00:05.000 --> 00:07.000\n<v Bob>I am fine.</v>';
  const s=createYouTubeSentences(raw,C).sentences;
  assert.equal(s.length,3);assert.equal(s[0].speaker,'Alice');assert.equal(s[2].speaker,'Bob');
  assert.equal(s[0].timing,'estimated');close(s[0].end,s[1].start);close(s[1].end,5);
  assert.equal(s.map(x=>x.text).join(' '),'Hello there. How are you? I am fine.');
});
test('rolling VTT captions are deduplicated while non-overlapping repetitions are preserved',()=>{
  const raw='WEBVTT\n\n00:00.000 --> 00:02.000\nHello there\n\n00:01.000 --> 00:03.000\nHello there my friend.\n\n00:03.000 --> 00:05.000\nHello there my friend.';
  const s=createYouTubeSentences(raw,C).sentences;
  assert.equal(s.map(x=>x.text).join(' '),'Hello there my friend. Hello there my friend.');
  assert(s.every(x=>sanitizeSubtitleTiming(x.subtitleTiming,x)));
  const duplicate=createYouTubeSentences('00:00.000 --> 00:02.000\nHello there.\n\n00:01.000 --> 00:03.000\nHello there.',C).sentences;
  assert.equal(duplicate.length,1);assert.equal(duplicate[0].end,3);
});
test('long cues obey selected segment size and keep all tokens',()=>{
  const text='Learning English every day improves my speaking and listening skills '.repeat(7).trim();
  const s=createYouTubeSentences('00:01.000 --> 00:36.000\n'+text,C,{maxWords:20}).sentences;
  assert(s.every(x=>C.tokens(x.text).length<=20));assert.deepEqual(C.tokens(s.map(x=>x.text).join(' ')),C.tokens(text));
  close(s[0].start,1);close(s.at(-1).end,36);
});
test('music-only cues are omitted and HTML entities decode as plain text',()=>{
  const s=createYouTubeSentences('00:00.000 --> 00:01.000\n[Music]\n\n00:01.000 --> 00:03.000\n<c>Hello &amp; welcome&#33;</c>',C).sentences;
  assert.equal(s.length,1);assert.equal(s[0].text,'Hello & welcome!');assert.equal(s[0].start,1);
});
test('timeless, corrupt, decreasing, invalid and oversized transcripts fail before creating a lesson',()=>{
  for(const raw of ['', 'Hello there. This has no timestamps.', '0:03\nHi.\n0:01\nBye.',
    '0:61\nHello.', '00:03.000 --> 00:01.000\nHello.', '00:01.000 --> invalid\nHello.', 'x'.repeat(30001)])
    assert.throws(()=>createYouTubeSentences(raw,C));
  assert.throws(()=>createYouTubeSentences(transcript,C,{lastEnd:14}));
});
test('sentence gaps and different speakers remain separate',()=>{
  const s=createYouTubeSentences('00:01.000 --> 00:03.000\nAlice: Could you\n\n00:05.000 --> 00:07.000\nAlice: help me?\n\n00:07.000 --> 00:08.000\nBob: Yes.',C).sentences;
  assert.equal(s.length,3);assert.equal(s[0].end,3);assert.equal(s[1].start,5);assert.equal(s[2].speaker,'Bob');
});
test('metadata and subtitle timings survive export/import without progress or appearance loss',async()=>{
  const l=makeLesson();l.notes='Video notes';l.settings.speed=.75;l.settings.experience={theme:'dark',accent:'#2255aa'};
  l.progress[l.sentences[1].id].dict.draft='How are';l.sentences[0].translation='Xin chào';
  await new IPAQueue({present:()=>true,load:async()=>({words:{...JSON.parse(fs.readFileSync(new URL('../public/ipa-en-gb.json',import.meta.url))).words,...COMMON_UK},degraded:false})}).ensure(l);
  const parsed=C.parseFile(C.serializeFile(l,{tts:{},full:{},recordings:{},source:null})).lesson;
  assert.deepEqual(parsed.youtube,l.youtube);assert.equal(parsed.settings.source,'youtube');
  assert.deepEqual(parsed.sentences[0].subtitleTiming,l.sentences[0].subtitleTiming);assert(hasCurrentPhonetics(parsed));
  assert.equal(parsed.notes,'Video notes');assert.equal(parsed.settings.speed,.75);assert.equal(parsed.settings.experience.theme,'dark');
  assert.equal(parsed.progress[l.sentences[1].id].dict.draft,'How are');assert.equal(parsed.sentences[0].translation,'Xin chào');
});
test('stale subtitle timings fall back to estimated words after edits',()=>{
  const l=makeLesson(),s=l.sentences[0];s.text='Good morning everyone.';
  assert.equal(sanitizeSubtitleTiming(s.subtitleTiming,s),null);
  const valid=C.validateLesson(l);assert(!valid.sentences[0].subtitleTiming);
  assert.equal(subtitleWords(valid.sentences[0]).length,3);assert(subtitleWords(valid.sentences[0]).every(x=>x.exact===false));
});
test('untrusted source and word timing data are bounded and rejected',()=>{
  assert.equal(sanitizeYouTubeSource({version:1,videoId:'javascript:alert(1)'}),null);
  const x=sanitizeYouTubeSource({version:1,videoId,url:'https://attacker.test',transcript:'x'.repeat(50000),importedAt:'bad'});
  assert.equal(x.url,url);assert.equal(x.transcript.length,30000);assert.equal(x.importedAt,0);
  const l=makeLesson();l.sentences[0].subtitleTiming.words[0].end=999;
  assert(!C.validateLesson(l).sentences[0].subtitleTiming);
  delete l.youtube;assert.throws(()=>C.validateLesson(l));
});
test('new YouTube lessons use the existing automatic browser translation queue',async()=>{
  const l=makeLesson(),calls=[];let saves=0;
  const browser=new BrowserTranslation({api:()=>({availability:async()=> 'available',create:async()=>({translate:async text=>{calls.push(text);return 'Dịch: '+text;}})}),activation:()=>true});
  await new TranslationQueue({browser,save:async()=>saves++}).ensure(l);
  assert(l.sentences.every(hasCurrentTranslation));assert(l.translationData.paragraph);assert.equal(l.translationData.status,'complete');
  assert(calls.includes(l.sentences[0].text));assert(saves>0);assert.equal(l.settings.source,'youtube');
});
test('two fresh CloudSync devices restore YouTube, IPA, translation and learning settings',async t=>{
  const entries=new Map(),chunks=new Map(),watchers=new Set();
  const transport={list:async()=>[...entries.values()].map(x=>structuredClone(x)),get:async id=>structuredClone(entries.get(id)),
    chunk:async id=>structuredClone(chunks.get(id)),putChunk:async(id,v)=>chunks.set(id,structuredClone(v)),removeChunk:async id=>chunks.delete(id),
    commit:async(id,base,v)=>{assert.equal(entries.get(id)?.revision||null,base);entries.set(id,{id,...structuredClone(v)});},
    watch:callback=>{watchers.add(callback);return()=>watchers.delete(callback);}};
  async function client(){const identity=await workspaceIdentity(memoryStorage(),new URL('https://shadow.example/'));
    const store=new LessonStore().load();const sync=new CloudSync({identity,store,media:new MediaStore({database:null}),
      outbox:new SyncOutbox({database:null}),transportFactory:()=>transport});t.after(()=>sync.close());await sync.start();return {store,sync};}
  const first=await client(),l=makeLesson();l.settings.speed=1.25;l.settings.ipa=false;l.notes='Cross device';
  l.sentences[0].translation='Xin chào.';l.sentences[0].translationOrigin='auto';l.sentences[0].translationSource=l.sentences[0].text;
  l.progress[l.sentences[0].id].shadow.transcript='Hello';
  await new IPAQueue({present:()=>true,load:async()=>({words:{...JSON.parse(fs.readFileSync(new URL('../public/ipa-en-gb.json',import.meta.url))).words,...COMMON_UK},degraded:false})}).ensure(l);
  first.store.upsert(l);first.sync.mark(l.id);await first.sync.flush();assert(!first.sync.dirty.has(l.id));
  const second=await client(),opened=second.store.lessons.find(x=>x.id===l.id);
  assert(opened);assert.equal(opened.settings.source,'youtube');assert.deepEqual(opened.youtube,l.youtube);
  assert.deepEqual(opened.sentences[0].subtitleTiming,l.sentences[0].subtitleTiming);assert(hasCurrentPhonetics(opened));
  assert.equal(opened.settings.ipa,false);assert.equal(opened.settings.speed,1.25);assert.equal(opened.sentences[0].translation,'Xin chào.');
  assert.equal(opened.progress[l.sentences[0].id].shadow.transcript,'Hello');assert.equal(opened.notes,'Cross device');
});
test('Vercel permits the official player and sends origin referrer; UI includes all new controls',()=>{
  const config=JSON.parse(fs.readFileSync(new URL('../vercel.json',import.meta.url))),headers=config.headers[0].headers;
  assert.equal(headers.find(x=>x.key==='Referrer-Policy').value,'strict-origin-when-cross-origin');
  const csp=headers.find(x=>x.key==='Content-Security-Policy').value;
  assert(csp.includes("script-src 'self' https://www.youtube.com https://s.ytimg.com"));
  assert(csp.includes('frame-src https://www.youtube.com https://www.youtube-nocookie.com'));
  assert(csp.includes('https://firestore.googleapis.com'));assert(!csp.includes('unsafe-inline'));
  const html=fs.readFileSync(new URL('../public/index.html',import.meta.url),'utf8');
  for(const id of ['youtube-player','new-source-type','new-youtube-url','new-youtube-end']) assert.equal((html.match(new RegExp(`id="${id}"`,'g'))||[]).length,1);
});
