import {AudioEngine} from './audio.mjs';
import {YouTubeAudioEngine} from './youtube-player.mjs';
// Delegate existing file/TTS operations unchanged; only YouTube playback is new.
export class StudyAudioEngine {
  constructor(element,container,onTime,options={}) {
    this.local=new AudioEngine(element,t=>{if(this.active===this.local)onTime(t);});
    this.youtube=new YouTubeAudioEngine(container,{...options,onTime:t=>{if(this.active===this.youtube)onTime(t);}});
    this.active=this.local;this.container=container;
  }
  get current(){return this.active.current;}
  get bound(){return this.active.bound;}
  get paused(){return this.active===this.youtube?this.youtube.paused:this.local.el.paused;}
  get speed(){return this.active===this.youtube?this.youtube.speed:this.local.el.playbackRate;}
  syncLesson(lesson) {
    const use=lesson?.settings.source==='youtube';
    this.container.hidden=!(use&&lesson.mode!=='review');
    const next=use?this.youtube:this.local;
    if(next!==this.active){this.active.stop();this.active=next;}
  }
  setAssets(assets){this.stop();this.local.setAssets(assets);this.youtube.reset();}
  ensure(...args){return this.local.ensure(...args);}
  ensureLesson(...args){return this.local.ensureLesson(...args);}
  warm(lesson,signal){return this.youtube.warm(lesson,signal);}
  prepare(lesson,...args){this.syncLesson(lesson);return this.active.prepare(lesson,...args);}
  prepareLesson(lesson,...args){this.syncLesson(lesson);return this.active.prepareLesson(lesson,...args);}
  segment(...args){return this.active.segment(...args);}
  word(lesson,sentence,index,signal,isolated=false){
    this.syncLesson(lesson);
    if(isolated&&lesson.settings.source==='youtube') {
      this.youtube.stop();this.active=this.local;
      return this.local.word({...lesson,settings:{...lesson.settings,source:'tts'}},sentence,index,signal,true);
    }
    return this.active.word(lesson,sentence,index,signal,isolated);
  }
  setRate(value){if(this.active===this.youtube)return this.youtube.setRate(value);this.local.el.playbackRate=value;return value;}
  seek(...args){return this.active.seek(...args);}
  togglePause(){return this.active.togglePause();}
  stop(){this.local.stop();this.youtube.stop();}
  destroy(){this.local.destroy();this.youtube.destroy();}
}
