import test from 'node:test';
import assert from 'node:assert/strict';
import * as C from '../public/core.mjs';
import {createYouTubeSentences} from '../public/youtube-source.mjs';
import {YouTubeAudioEngine,youtubeError} from '../public/youtube-player.mjs';
import {StudyAudioEngine} from '../public/study-audio.mjs';
const videoId='M7lc1UVf-VE';
function lesson(){const l=C.createLesson('YouTube',createYouTubeSentences('0:10\nHello there.\n0:12\nGood morning.\n0:14\nHow are you?',C,{lastEnd:18}).sentences);
  l.youtube={version:1,videoId};l.settings.source='youtube';return l;}
function setup(t,options={}) {
  const originalDoc=globalThis.document,originalLocation=globalThis.location,originalCancel=globalThis.cancelAnimationFrame;
  globalThis.cancelAnimationFrame=()=>{};
  globalThis.document={createElement:tag=>({tagName:tag.toUpperCase()})};globalThis.location={origin:'https://shadow.example'};
  const container={hidden:false,children:[],replaceChildren(...children){this.children=children;}},players=[],times=[],rates=[],errors=[];
  class FakePlayer {
    constructor(iframe,{events}){this.iframe=iframe;this.events=events;this.state=2;this.time=0;this.duration=40;this.rate=1;this.seeks=[];
      players.push(this);if(!options.holdReady)queueMicrotask(()=>events.onReady({target:this}));}
    ready(){this.events.onReady({target:this});}
    getPlayerState(){return this.state;}getCurrentTime(){return this.time;}getDuration(){return this.duration;}
    getAvailablePlaybackRates(){return [.5,.75,1,1.25,1.5,1.75,2];}getPlaybackRate(){return this.rate;}
    setPlaybackRate(value){if(this.rate!==value){this.rate=value;this.events.onPlaybackRateChange({data:value});}}
    seekTo(value,ahead){this.seeks.push([value,ahead]);if(!this.staleSeek)this.time=value;}
    playVideo(){this.state=1;this.events.onStateChange({data:1});}
    pauseVideo(){if(this.state!==2){this.state=2;this.events.onStateChange({data:2});}}
    destroy(){this.destroyed=true;}
    ended(){this.state=0;this.events.onStateChange({data:0});}
  }
  const engine=new YouTubeAudioEngine(container,{loadAPI:async()=>({Player:FakePlayer}),
    onTime:value=>times.push(value),onRate:value=>rates.push(value),onError:error=>errors.push(error)});
  t.after(()=>{engine.destroy();globalThis.document=originalDoc;globalThis.location=originalLocation;globalThis.cancelAnimationFrame=originalCancel;});
  return {engine,container,players,times,rates,errors};
}
test('visible official iframe uses origin, controls and referrer; repeated warm reuses the same player',async t=>{
  const {engine,container,players}=setup(t),l=lesson();await engine.warm(l);await engine.warm(l);
  assert.equal(players.length,1);assert.equal(container.children.length,1);
  const iframe=container.children[0],src=new URL(iframe.src);
  assert.equal(src.hostname,'www.youtube.com');assert.equal(src.searchParams.get('origin'),'https://shadow.example');
  assert.equal(src.searchParams.get('enablejsapi'),'1');assert.equal(src.searchParams.get('controls'),'1');
  assert.equal(iframe.referrerPolicy,'strict-origin-when-cross-origin');assert(iframe.allow.includes('autoplay'));
  assert.equal(players[0].state,2); // Warm never autoplays a hidden/background video.
});
test('sentence playback seeks to the subtitle start and pauses at its end',async t=>{
  const {engine,players,times}=setup(t),l=lesson();const c=await engine.prepare(l,l.sentences[0]);
  assert.equal(c.source,'youtube');assert.equal(c.start,10);assert.equal(c.end,12);assert.equal(c.words.length,2);
  const p=engine.segment(c.start,c.end);assert.deepEqual(players[0].seeks.at(-1),[10,true]);
  players[0].time=11;engine.tick();assert(times.at(-1).playing);
  players[0].time=12;engine.tick();await p;assert.equal(engine.bound,null);assert.equal(players[0].state,2);assert.equal(engine.timer,null);
});
test('stale time from an asynchronous YouTube seek cannot prematurely finish the new segment',async t=>{
  const {engine,players}=setup(t),l=lesson();await engine.prepare(l,l.sentences[0]);
  const player=players[0];player.time=30;player.staleSeek=true;
  const p=engine.segment(10,12);engine.tick();assert(engine.bound);assert.equal(engine.bound.armed,false);
  player.time=10.05;engine.tick();assert.equal(engine.bound.armed,true);
  player.time=12;engine.tick();await p;assert.equal(engine.bound,null);
});
test('pause/resume and speed changes keep an active sentence bound',async t=>{
  const {engine,players,rates}=setup(t),l=lesson();await engine.prepare(l,l.sentences[0]);const p=engine.segment(10,12);
  engine.togglePause();assert(engine.paused);assert(engine.bound);
  engine.setRate(.75);assert.equal(engine.speed,.75);assert.deepEqual(rates,[.75]);assert(engine.bound);
  engine.togglePause();assert(!engine.paused);players[0].time=12;engine.tick();await p;
});
test('unsupported rates are mapped to available rates and independent player rate changes are reported',async t=>{
  const {engine,players,rates}=setup(t),l=lesson();await engine.prepare(l,l.sentences[0]);
  assert.equal(engine.setRate(1.15),1.25);assert.equal(engine.speed,1.25);
  players[0].setPlaybackRate(1.75);assert.equal(rates.at(-1),1.75);
});
test('abort and stop immediately reject running playback and remove timers',async t=>{
  const {engine}=setup(t),l=lesson();await engine.prepare(l,l.sentences[0]);
  const controller=new AbortController(),p=engine.segment(10,12,controller.signal),checked=assert.rejects(p,{name:'AbortError'});
  controller.abort();await checked;assert.equal(engine.bound,null);assert.equal(engine.timer,null);
  const second=engine.segment(10,12),stopped=assert.rejects(second,{name:'AbortError'});engine.stop();await stopped;
});
test('seek while practising stays within the range and preserves pause state',async t=>{
  const {engine,players}=setup(t),l=lesson();await engine.prepare(l,l.sentences[0]);
  const p=engine.segment(10,12);engine.togglePause();engine.seek(11);assert.equal(players[0].time,11);assert(engine.paused);
  engine.togglePause();players[0].time=12;engine.tick();await p;
});
test('whole lesson plays one continuous video range with all subtitle units',async t=>{
  const {engine,players}=setup(t),l=lesson();l.cursor=1;
  const c=await engine.prepareLesson(l,null,true);assert.equal(c.start,12);assert.equal(c.end,18);assert.equal(c.units.length,3);
  const p=engine.segment(c.start,c.end);players[0].time=13;engine.tick();assert(engine.bound);
  players[0].time=17;engine.tick();assert(engine.bound);assert.equal(players[0].seeks.length,1);
  players[0].time=18;engine.tick();await p;assert.equal(players[0].seeks.length,1);
});
test('actual video duration clamps the tail and rejects sentences outside the video',async t=>{
  const {engine,players}=setup(t),l=lesson();await engine.warm(l);players[0].duration=16;
  const c=await engine.prepare(l,l.sentences[2]);assert.equal(c.end,16);assert(c.words.every(w=>w.end<=16));
  const outside={...l.sentences[2],start:50,end:55};await assert.rejects(engine.prepare(l,outside),/ngoài video/);
});
test('word clicks replay the containing sentence without claiming exact word alignment',async t=>{
  const {engine,players}=setup(t),l=lesson();await engine.warm(l);
  const p=engine.word(l,l.sentences[0],1);await new Promise(resolve=>setImmediate(resolve));
  assert.equal(engine.bound.start,10);assert.equal(engine.bound.end,12);assert(engine.current.words.every(w=>!w.exact));
  players[0].time=12;engine.tick();await p;
});
test('autoplay blocking and embedding errors reject the active task with a useful message',async t=>{
  const {engine,players}=setup(t),l=lesson();await engine.prepare(l,l.sentences[0]);
  let p=engine.segment(10,12),checked=assert.rejects(p,/Bấm nút phát/);players[0].events.onAutoplayBlocked();await checked;
  p=engine.segment(10,12);checked=assert.rejects(p,/không cho phép phát nhúng/);players[0].events.onError({data:101});await checked;
  assert.equal(engine.bound,null);assert.equal(engine.timer,null);assert(youtubeError(153).message.includes('vercel.json'));
});
test('switching video while loading rejects the stale task; late ready events cannot resurrect it',async t=>{
  const {engine,players}=setup(t,{holdReady:true}),l=lesson();
  const first=engine.warm(l),checked=assert.rejects(first,{name:'AbortError'});await new Promise(resolve=>setImmediate(resolve));
  const next={...l,youtube:{version:1,videoId:'dQw4w9WgXcQ'}};const second=engine.warm(next);
  await new Promise(resolve=>setImmediate(resolve));await checked;assert.equal(players[0].destroyed,true);
  players[0].ready();assert.equal(engine.player,players[1]);players[1].ready();await second;
  assert.equal(engine.videoId,'dQw4w9WgXcQ');
});
test('pre-aborted tasks and invalid timings do not start playback',async t=>{
  const {engine,players}=setup(t),l=lesson(),controller=new AbortController();controller.abort();
  await assert.rejects(engine.prepare(l,l.sentences[0],controller.signal),{name:'AbortError'});assert.equal(players.length,0);
  await engine.prepare(l,l.sentences[0]);await assert.rejects(engine.segment(12,10),/không hợp lệ/);
  assert.equal(players[0].state,2);
});
test('facade delegates normal lessons and explicit UK MP3 generation to the existing audio engine',async t=>{
  const {container}=setup(t),element={addEventListener(){},pause(){this.paused=true;},load(){},removeAttribute(){},paused:true,playbackRate:1};
  const facade=new StudyAudioEngine(element,container,()=>{});t.after(()=>{
    const previous=globalThis.cancelAnimationFrame;globalThis.cancelAnimationFrame=()=>{};
    facade.destroy();globalThis.cancelAnimationFrame=previous;
  });
  let calls=[];facade.local.prepare=async(l,s)=>{calls.push('local');return {source:'tts'};};
  facade.youtube.prepare=async()=>{calls.push('youtube');return {source:'youtube'};};
  facade.local.ensureLesson=async()=>{calls.push('UK MP3');return {mime:'audio/mpeg'};};
  const l=lesson();l.settings.source='tts';await facade.prepare(l,l.sentences[0]);assert(container.hidden);
  l.settings.source='youtube';await facade.prepare(l,l.sentences[0]);assert(!container.hidden);
  assert.equal((await facade.ensureLesson(l)).mime,'audio/mpeg');assert.deepEqual(calls,['local','youtube','UK MP3']);
  facade.syncLesson(null);assert(container.hidden);
});
