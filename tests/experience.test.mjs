import test from 'node:test';
import assert from 'node:assert/strict';
import * as C from '../public/core.mjs';

test('theme, color and feedback controls save preferences and keep sound out of playback/recording',async()=>{
  const elements=new Map(),listeners=new Map(),storage=new Map(),notes=[];
  const element=id=>{
    if(elements.has(id))return elements.get(id);
    const attributes=new Map(),classes=new Set();
    const value={id,dataset:{},style:{setProperty(){}},hidden:true,paused:true,open:false,
      classList:{add(...names){names.forEach(n=>classes.add(n));},remove(...names){names.forEach(n=>classes.delete(n));},contains(n){return classes.has(n);}},
      setAttribute(k,v){attributes.set(k,v);},getAttribute(k){return attributes.get(k);},
      showModal(){this.open=true;},close(){this.open=false;},replaceChildren(){},append(){},
      addEventListener(){},querySelector(){return {onclick:null};},offsetWidth:100};
    elements.set(id,value);return value;
  };
  let darkSystem=false,reduced=false;
  globalThis.localStorage={getItem:key=>storage.get(key)||null,setItem:(key,value)=>storage.set(key,value)};
  globalThis.matchMedia=query=>({matches:query.includes('reduced-motion')?reduced:darkSystem,addEventListener(){}});
  globalThis.requestAnimationFrame=fn=>fn();
  globalThis.document={documentElement:element('root'),hidden:false,getElementById:element,
    createElement:()=>element('particle'+Math.random()),querySelector:()=>element('meta'),
    querySelectorAll:selector=>selector.includes('feedback-correct')?[...elements.values()].filter(e=>
      ['feedback-correct','feedback-wrong','review-enter'].some(c=>e.classList.contains(c))):[],
    addEventListener:(type,fn)=>listeners.set(type,fn)};
  class Context{
    constructor(){this.state='suspended';this.currentTime=0;this.destination={};}
    async resume(){this.state='running';}async suspend(){this.state='suspended';}async close(){this.state='closed';}
    createOscillator(){const tone={frequency:{value:0},connect(){},disconnect(){},start(){notes.push(tone.frequency.value);},stop(){}};return tone;}
    createGain(){return {gain:{setValueAtTime(){},linearRampToValueAtTime(){},exponentialRampToValueAtTime(){}},connect(){},disconnect(){}};}
  }
  globalThis.window={AudioContext:Context,addEventListener(){}};
  const experience=await import('../public/experience.mjs');
  let saves=0,savedPreferences;experience.initExperience((lesson,prefs)=>{saves++;savedPreferences=prefs;});
  const l=C.createLesson('Experience',C.parseTranscript('One sentence.'));
  experience.syncExperience(l);
  element('theme-toggle').onclick();
  assert.equal(element('root').dataset.theme,'dark');assert.equal(l.settings.experience.theme,'dark');
  assert.equal(element('theme-toggle').getAttribute('aria-pressed'),'true');
  element('appearance-accent').oninput({target:{value:'#7650cc'}});
  assert.equal(l.settings.experience.accent,'#7650cc');assert.equal(element('root').dataset.customAccent,'true');
  assert.equal(savedPreferences.accent,'#7650cc');assert.equal(storage.size,0);assert(saves>=2);
  assert(await experience.playFeedbackSound('correct'));assert.deepEqual(notes,[659.25,880]);
  notes.length=0;assert(await experience.playFeedbackSound('wrong'));assert.deepEqual(notes,[311.13,261.63]);
  element('model').paused=false;notes.length=0;
  assert.equal(await experience.playFeedbackSound('correct'),false);assert.equal(notes.length,0);
  element('model').paused=true;element('finish-record').hidden=false;
  assert.equal(await experience.playFeedbackSound('correct'),false);assert.equal(notes.length,0);
  element('finish-record').hidden=true;
  element('feedback-sound').onchange({target:{checked:false}});
  assert.equal(await experience.playFeedbackSound('celebrate'),false);assert.equal(notes.length,0);
  element('show-appearance').onclick();assert(element('appearance-dialog').open);
  l.mode='review';experience.syncExperience(l);assert(element('review-pane').classList.contains('review-enter'));
  element('feedback-effects').onchange({target:{checked:false}});assert(!element('review-pane').classList.contains('review-enter'));
  reduced=true;element('feedback-effects').onchange({target:{checked:true}});
  l.mode='listen';experience.syncExperience(l);l.mode='review';experience.syncExperience(l);
  assert(!element('review-pane').classList.contains('review-enter'));
  const imported=C.parseFile(C.serializeFile(l)).lesson;
  assert.equal(imported.settings.experience.sound,false);assert.equal(imported.settings.experience.accent,'#7650cc');
  darkSystem=true;element('appearance-theme').onchange({target:{value:'system'}});
  assert.equal(element('root').dataset.theme,'dark');
  experience.syncExperience(null);
  element('feedback-volume').oninput({target:{value:'41'}});
  assert.equal(savedPreferences.volume,41);assert.equal(storage.size,0);
  experience.restoreExperience({...savedPreferences,theme:'light',accent:'#118866'});
  assert.equal(element('root').dataset.theme,'light');assert.equal(element('appearance-accent').value,'#118866');
});
