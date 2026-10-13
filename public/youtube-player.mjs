import {sanitizeYouTubeSource, subtitleWords} from './youtube-source.mjs';
const aborted = () => new DOMException('Đã dừng', 'AbortError');
let apiPromise;
function waitFor(promise, signal) {
  if (!signal) return promise;
  if (signal.aborted) return Promise.reject(aborted());
  return new Promise((resolve, reject) => {
    const abort = () => reject(aborted());
    signal.addEventListener('abort', abort, {once:true});
    promise.then(resolve, reject).finally(() => signal.removeEventListener('abort', abort));
  });
}
export function loadYouTubeAPI() {
  if (globalThis.YT?.Player) return Promise.resolve(globalThis.YT);
  if (apiPromise) return apiPromise;
  apiPromise = new Promise((resolve, reject) => {
    const tag = document.createElement('script'), previous = globalThis.onYouTubeIframeAPIReady;
    let timer;
    const clear = () => { clearTimeout(timer); tag.onerror = null; };
    const fail = () => { clear(); tag.remove(); reject(Error('Không tải được trình phát YouTube. Kiểm tra mạng hoặc tiện ích chặn nội dung rồi thử lại.')); };
    globalThis.onYouTubeIframeAPIReady = () => {
      clear();
      try { previous?.(); } catch {}
      if (globalThis.YT?.Player) resolve(globalThis.YT); else fail();
    };
    tag.src = 'https://www.youtube.com/iframe_api';
    tag.async = true; tag.referrerPolicy = 'strict-origin-when-cross-origin';
    tag.onerror = fail;
    timer = setTimeout(fail, 20000);
    document.head.append(tag);
  }).catch(error => { apiPromise = null; throw error; });
  return apiPromise;
}
export function youtubeError(code) {
  const messages = {
    2:'Link hoặc ID video YouTube không hợp lệ.',
    5:'Trình duyệt chưa phát được video này. Hãy tải lại trang hoặc chọn video khác.',
    100:'Video đã bị xóa, chuyển riêng tư hoặc không còn truy cập được.',
    101:'Chủ video không cho phép phát nhúng. Hãy chọn video khác.',
    150:'Chủ video không cho phép phát nhúng. Hãy chọn video khác.',
    153:'YouTube thiếu thông tin trang phát. Hãy triển khai cả vercel.json trong bản cập nhật rồi tải lại trang.',
  };
  return Error(messages[code] || `YouTube báo lỗi ${code}. Hãy thử lại hoặc chọn video khác.`);
}

export class YouTubeAudioEngine {
  constructor(container, {onTime=()=>{}, onState=()=>{}, onRate=()=>{}, onError=()=>{},
    loadAPI=loadYouTubeAPI, interval=50}={}) {
    this.container=container; this.onTime=onTime; this.onState=onState; this.onRate=onRate;
    this.onError=onError; this.loadAPI=loadAPI; this.interval=interval;
    this.player=null; this.videoId=''; this.current=null; this.bound=null;
    this.generation=0; this.timer=null; this.pendingLoad=null; this.loadReject=null;
    this.rate=1; this.error=null; this.ready=false;
  }
  get paused() { return !this.player || ![1,3].includes(this.player.getPlayerState?.()); }
  get speed() { return Number(this.player?.getPlaybackRate?.()) || this.rate; }
  async load(videoId, signal) {
    if (signal?.aborted) throw aborted();
    if (this.player && this.ready && this.videoId===videoId && !this.pendingLoad && !this.error) return this.player;
    if (this.videoId===videoId && this.pendingLoad) return waitFor(this.pendingLoad,signal);
    this.disposePlayer();
    this.videoId=videoId; this.error=null;
    const generation=this.generation;
    this.pendingLoad=this.loadAPI().then(API => {
      if (generation!==this.generation) throw aborted();
      return new Promise((resolve,reject) => {
        let ready=false, settled=false, timeout;
        const fail=error => {
          if(settled)return;
          settled=true; clearTimeout(timeout); this.loadReject=null; this.ready=false;
          if(error.name!=='AbortError')this.error=error;
          reject(error);
        };
        this.loadReject=fail;
        const iframe=document.createElement('iframe'), origin=globalThis.location?.origin || '';
        const params=new URLSearchParams({enablejsapi:'1',playsinline:'1',controls:'1',rel:'0',cc_load_policy:'0',origin});
        iframe.src=`https://www.youtube.com/embed/${videoId}?${params}`;
        iframe.title='Video YouTube của bài học'; iframe.width='480'; iframe.height='270';
        iframe.allow='autoplay; encrypted-media; picture-in-picture; fullscreen';
        iframe.allowFullscreen=true; iframe.referrerPolicy='strict-origin-when-cross-origin';
        this.container.replaceChildren(iframe);
        timeout=setTimeout(()=>fail(Error('YouTube chưa tải xong video. Kiểm tra mạng rồi bấm phát lại.')),25000);
        this.player=new API.Player(iframe, {events:{
          onReady:event => {
            if(generation!==this.generation||settled) return;
            this.player=event.target; ready=true; settled=true; this.ready=true; clearTimeout(timeout); this.loadReject=null;
            this.setRate(this.rate); this.onState(); resolve(this.player);
          },
          onStateChange:event => {
            if(generation!==this.generation) return;
            if(event.data===1) this.startTick();
            else if(event.data!==3) { clearInterval(this.timer); this.timer=null; }
            if(event.data===0 && this.bound) this.finish();
            this.tick(); this.onState();
          },
          onPlaybackRateChange:event => {
            if(generation!==this.generation) return;
            this.rate=event.data; this.onRate(event.data); this.tick();
          },
          onAutoplayBlocked:()=> {
            if(generation!==this.generation) return;
            const error=Error('Bấm nút phát trong khung YouTube một lần, rồi dùng nút luyện của app. Trình duyệt đang chặn tự phát.');
            if(this.bound) this.finish(error); else this.onError(error);
          },
          onError:event => {
            if(generation!==this.generation) return;
            const error=youtubeError(event.data); this.error=error;
            if(!ready) fail(error);
            else if(this.bound) this.finish(error);
            else this.onError(error);
            this.onState();
          },
        }});
      });
    });
    const pending=this.pendingLoad;
    pending.finally(()=>{if(this.pendingLoad===pending)this.pendingLoad=null;}).catch(()=>{});
    return waitFor(pending,signal);
  }
  async warm(lesson,signal) {
    const source=sanitizeYouTubeSource(lesson.youtube);
    if(!source) throw Error('Bài học thiếu link YouTube hợp lệ.');
    this.rate=lesson.settings.speed;
    await this.load(source.videoId,signal);
    if(signal?.aborted) throw aborted();
    this.setRate(lesson.settings.speed);
    return this.player;
  }
  bounds(sentence) {
    if(!Number.isFinite(sentence.start)||!Number.isFinite(sentence.end)||sentence.start<0||sentence.end<=sentence.start)
      throw Error('Câu này chưa có mốc thời gian hợp lệ. Hãy sửa mốc đầu/cuối.');
    const duration=Number(this.player?.getDuration?.()) || 0;
    const end=duration>0 ? Math.min(sentence.end,duration) : sentence.end;
    if(end<=sentence.start) throw Error('Mốc câu nằm ngoài video. Hãy kiểm tra lại transcript và link.');
    return {id:sentence.id,start:sentence.start,end,words:subtitleWords(sentence)
      .filter(w=>w.start<end).map(w=>({...w,end:Math.min(w.end,end)}))};
  }
  async prepare(lesson,sentence,signal) {
    await this.warm(lesson,signal);
    const c=this.bounds(sentence);
    this.current={sentenceId:sentence.id,start:c.start,end:c.end,words:c.words,source:'youtube'};
    this.emit(c.start,false);
    return this.current;
  }
  async prepareLesson(lesson,signal,fromCursor=false) {
    await this.warm(lesson,signal);
    const units=lesson.sentences.map(s=>this.bounds(s));
    const start=units[fromCursor?lesson.cursor:0].start,end=units.at(-1).end;
    if(end<=start) throw Error('Các mốc phụ đề trong bài chưa theo thứ tự. Hãy sửa mốc câu.');
    this.current={lessonId:lesson.id,units,start,end,words:[],source:'youtube'};
    this.emit(start,false);
    return this.current;
  }
  emit(time,playing=!this.paused) {
    if(this.current) this.onTime({time,start:this.current.start,end:this.current.end,
      words:this.current.words,source:'youtube',playing});
  }
  startTick() {
    if(this.timer===null) this.timer=setInterval(()=>this.tick(),this.interval);
  }
  tick() {
    if(!this.player||!this.current) return;
    const time=Number(this.player.getCurrentTime()) || 0, marker=this.bound;
    const duration=Number(this.player.getDuration?.()) || 0;
    if(duration>0) {
      this.current.end=Math.min(this.current.end,duration);
      if(marker) marker.end=Math.min(marker.end,duration);
    }
    if(marker && !marker.armed) {
      if(time>=marker.target-.2 && time<=marker.target+Math.min(1,Math.max(.1,(marker.end-marker.start)/2))) marker.armed=true;
      else return; // Ignore stale pre-seek time until YouTube acknowledges the target.
    }
    this.emit(time);
    if(marker&&marker.armed&&time>=marker.end-.015) this.finish();
  }
  segment(start,end,signal) {
    if(signal?.aborted) return Promise.reject(aborted());
    if(!this.player||!this.current) return Promise.reject(Error('Hãy chuẩn bị video trước khi phát.'));
    if(this.error) return Promise.reject(this.error);
    if(!Number.isFinite(start)||!Number.isFinite(end)||end<=start) return Promise.reject(Error('Mốc phát không hợp lệ.'));
    if(this.bound) this.finish(aborted());
    return new Promise((resolve,reject)=>{
      const marker={start,end,target:start,armed:false,resolve,reject,signal,abort:null,timeout:null};
      marker.abort=()=>{if(this.bound===marker)this.finish(aborted());};
      this.bound=marker;
      signal?.addEventListener('abort',marker.abort,{once:true});
      marker.timeout=setTimeout(()=>{
        if(this.bound===marker&&!marker.armed) this.finish(Error('YouTube chưa bắt đầu phát đoạn này. Bấm phát trong khung video rồi thử lại.'));
      },15000);
      try {
        this.player.seekTo(start,true); this.player.playVideo(); this.startTick(); this.onState();
      } catch(error) {this.finish(error);}
      if(signal?.aborted) marker.abort();
    });
  }
  finish(error=null) {
    const marker=this.bound;
    if(!marker) return;
    this.bound=null; clearTimeout(marker.timeout);
    marker.signal?.removeEventListener('abort',marker.abort);
    this.player?.pauseVideo?.(); clearInterval(this.timer); this.timer=null;
    this.emit(Number(this.player?.getCurrentTime?.())||marker.start,false); this.onState();
    if(error) marker.reject(error); else marker.resolve();
  }
  setRate(value) {
    this.rate=Number(value)||1;
    const rates=this.player?.getAvailablePlaybackRates?.();
    if(Array.isArray(rates)&&rates.length) this.rate=rates.reduce((a,b)=>Math.abs(b-value)<Math.abs(a-value)?b:a,rates[0]);
    this.player?.setPlaybackRate?.(this.rate);
    return this.rate;
  }
  seek(value) {
    if(!this.current||!this.player) return;
    const time=Math.max(this.current.start,Math.min(this.current.end,value));
    if(this.bound){this.bound.target=time;this.bound.armed=false;}
    this.player.seekTo(time,true); this.emit(time);
  }
  togglePause() {
    if(!this.current||!this.player) return;
    if(!this.paused) this.player.pauseVideo();
    else {this.player.playVideo();this.startTick();}
    this.onState();
  }
  async word(lesson,sentence,index,signal) {
    const c=await this.prepare(lesson,sentence,signal);
    if(!c.words[index])return;
    // Caption timestamps do not provide verified word-level alignment.
    return this.segment(c.start,c.end,signal);
  }
  stop() {
    if(this.bound)this.finish(aborted());
    this.player?.pauseVideo?.();clearInterval(this.timer);this.timer=null;this.onState();
  }
  reset(){this.stop();this.current=null;}
  disposePlayer() {
    this.stop(); this.generation++;
    this.loadReject?.(aborted());this.loadReject=null;
    this.pendingLoad=null;
    this.player?.destroy?.();this.player=null;this.videoId='';this.current=null;this.ready=false;
    this.container?.replaceChildren();
  }
  destroy(){this.disposePlayer();}
}
