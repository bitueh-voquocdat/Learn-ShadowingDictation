// British English word pronunciations. Results belong to the lesson, not localStorage.
export const IPA_VERSION = 1;
export const IPA_DICTIONARY_VERSION = 'en-GB-20261011-v1';
const wordPattern = /[\p{L}\p{N}]+(?:['’][\p{L}\p{N}]+)*(?:-[\p{L}\p{N}]+)*/gu;
export const ipaWords = text => String(text).match(wordPattern) || [];
export const ipaKey = text => String(text).normalize('NFKC').replace(/[’‘]/g, "'").toLowerCase();
const escape = value => String(value).replace(/[&<>"']/g, c =>
  ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

// Common words, contractions and weak forms supplement the bundled wordlist.
// Weak/strong readings are shown together; no context-dependent reading is guessed.
export const COMMON_UK = Object.freeze({
  a:['/ə/','/eɪ/'],an:['/ən/','/æn/'],the:['/ðə/','/ðiː/'],and:['/ənd/','/ænd/'],
  i:['/aɪ/'],you:['/juː/'],he:['/hiː/'],she:['/ʃiː/'],it:['/ɪt/'],we:['/wiː/'],they:['/ðeɪ/'],
  me:['/miː/'],him:['/hɪm/'],her:['/hə/','/hɜː/'],us:['/ʌs/'],them:['/ðəm/','/ðem/'],
  my:['/maɪ/'],your:['/jə/','/jɔː/'],his:['/hɪz/'],its:['/ɪts/'],our:['/aʊə/','/ɑː/'],their:['/ðeə/'],
  am:['/əm/','/æm/'],is:['/ɪz/'],are:['/ə/','/ɑː/'],was:['/wəz/','/wɒz/'],were:['/wə/','/wɜː/'],
  be:['/biː/'],been:['/biːn/','/bɪn/'],being:['/ˈbiːɪŋ/'],have:['/hæv/','/həv/'],has:['/hæz/','/həz/'],had:['/hæd/','/həd/'],
  do:['/duː/','/də/'],does:['/dʌz/','/dəz/'],did:['/dɪd/'],done:['/dʌn/'],
  can:['/kən/','/kæn/'],could:['/kəd/','/kʊd/'],would:['/wəd/','/wʊd/'],should:['/ʃəd/','/ʃʊd/'],
  will:['/wɪl/'],shall:['/ʃəl/','/ʃæl/'],may:['/meɪ/'],might:['/maɪt/'],must:['/mʌst/'],
  to:['/tə/','/tuː/'],of:['/əv/','/ɒv/'],for:['/fə/','/fɔː/'],from:['/frəm/','/frɒm/'],at:['/ət/','/æt/'],
  in:['/ɪn/'],on:['/ɒn/'],with:['/wɪð/','/wɪθ/'],as:['/əz/','/æz/'],but:['/bət/','/bʌt/'],or:['/ə/','/ɔː/'],
  if:['/ɪf/'],than:['/ðən/','/ðæn/'],that:['/ðæt/','/ðət/'],this:['/ðɪs/'],these:['/ðiːz/'],those:['/ðəʊz/'],
  what:['/wɒt/'],when:['/wen/'],where:['/weə/'],who:['/huː/'],why:['/waɪ/'],how:['/haʊ/'],which:['/wɪtʃ/'],
  not:['/nɒt/'],no:['/nəʊ/'],yes:['/jes/'],please:['/pliːz/'],thank:['/θæŋk/'],thanks:['/θæŋks/'],
  hello:['/həˈləʊ/'],good:['/ɡʊd/'],morning:['/ˈmɔːnɪŋ/'],world:['/wɜːld/'],
  tea:['/tiː/'],coffee:['/ˈkɒfi/'],cup:['/kʌp/'],like:['/laɪk/'],welcome:['/ˈwelkəm/'],
  alice:['/ˈælɪs/'],ryan:['/ˈraɪən/'],john:['/dʒɒn/'],mary:['/ˈmeəri/'],
  read:['/riːd/','/red/'],live:['/lɪv/','/laɪv/'],lead:['/liːd/','/led/'],wind:['/wɪnd/','/waɪnd/'],
  close:['/kləʊz/','/kləʊs/'],minute:['/ˈmɪnɪt/','/maɪˈnjuːt/'],
  address:['/əˈdres/','/ˈædres/'],record:['/ˈrekɔːd/','/rɪˈkɔːd/'],
  present:['/ˈprezənt/','/prɪˈzent/'],object:['/ˈɒbdʒɪkt/','/əbˈdʒekt/'],
  subject:['/ˈsʌbdʒɪkt/','/səbˈdʒekt/'],project:['/ˈprɒdʒekt/','/prəˈdʒekt/'],
  produce:['/prəˈdjuːs/','/ˈprɒdjuːs/'],desert:['/ˈdezət/','/dɪˈzɜːt/'],
  conduct:['/ˈkɒndʌkt/','/kənˈdʌkt/'],content:['/ˈkɒntent/','/kənˈtent/'],
  refuse:['/rɪˈfjuːz/','/ˈrefjuːs/'],use:['/juːz/','/juːs/'],
  house:['/haʊs/','/haʊz/'],mouth:['/maʊθ/','/maʊð/'],
  excuse:['/ɪkˈskjuːs/','/ɪkˈskjuːz/'],bow:['/bəʊ/','/baʊ/'],
  tear:['/tɪə/','/teə/'],row:['/rəʊ/','/raʊ/'],sew:['/səʊ/'],sow:['/səʊ/','/saʊ/'],
  bass:['/beɪs/','/bæs/'],wound:['/wuːnd/','/waʊnd/'],
  learned:['/lɜːnd/','/ˈlɜːnɪd/'],blessed:['/blest/','/ˈblesɪd/'],
  separate:['/ˈseprət/','/ˈsepəreɪt/'],graduate:['/ˈɡrædʒuət/','/ˈɡrædʒueɪt/'],
  estimate:['/ˈestɪmət/','/ˈestɪmeɪt/'],associate:['/əˈsəʊʃiət/','/əˈsəʊʃieɪt/'],
  convert:['/ˈkɒnvɜːt/','/kənˈvɜːt/'],increase:['/ˈɪŋkriːs/','/ɪnˈkriːs/'],
  decrease:['/ˈdiːkriːs/','/dɪˈkriːs/'],permit:['/ˈpɜːmɪt/','/pəˈmɪt/'],
  import:['/ˈɪmpɔːt/','/ɪmˈpɔːt/'],export:['/ˈekspɔːt/','/ɪkˈspɔːt/'],
  perfect:['/ˈpɜːfɪkt/','/pəˈfekt/'],alternate:['/ɔːlˈtɜːnət/','/ˈɔːltəneɪt/'],
  conflict:['/ˈkɒnflɪkt/','/kənˈflɪkt/'],contrast:['/ˈkɒntrɑːst/','/kənˈtrɑːst/'],
  progress:['/ˈprəʊɡres/','/prəˈɡres/'],reject:['/ˈriːdʒekt/','/rɪˈdʒekt/'],
  protest:['/ˈprəʊtest/','/prəˈtest/'],contest:['/ˈkɒntest/','/kənˈtest/'],
  attribute:['/ˈætrɪbjuːt/','/əˈtrɪbjuːt/'],appropriate:['/əˈprəʊpriət/','/əˈprəʊprieɪt/'],
  coordinate:['/kəʊˈɔːdɪnət/','/kəʊˈɔːdɪneɪt/'],
  "i'm":['/aɪm/'],"you're":['/jʊə/','/jɔː/'],"we're":['/wɪə/'],"they're":['/ðeə/'],
  "he's":['/hiːz/'],"she's":['/ʃiːz/'],"it's":['/ɪts/'],"that's":['/ðæts/'],"there's":['/ðeəz/'],"what's":['/wɒts/'],
  "i've":['/aɪv/'],"you've":['/juːv/'],"we've":['/wiːv/'],"they've":['/ðeɪv/'],
  "i'll":['/aɪl/'],"you'll":['/juːl/'],"he'll":['/hiːl/'],"she'll":['/ʃiːl/'],"we'll":['/wiːl/'],"they'll":['/ðeɪl/'],
  "i'd":['/aɪd/'],"you'd":['/juːd/'],"he'd":['/hiːd/'],"she'd":['/ʃiːd/'],"we'd":['/wiːd/'],"they'd":['/ðeɪd/'],
  "can't":['/kɑːnt/'],"cannot":['/ˈkænɒt/'],"don't":['/dəʊnt/'],"doesn't":['/ˈdʌzənt/'],"didn't":['/ˈdɪdənt/'],
  "isn't":['/ˈɪzənt/'],"aren't":['/ɑːnt/'],"wasn't":['/ˈwɒzənt/'],"weren't":['/wɜːnt/'],
  "won't":['/wəʊnt/'],"wouldn't":['/ˈwʊdənt/'],"couldn't":['/ˈkʊdənt/'],"shouldn't":['/ˈʃʊdənt/'],
  "haven't":['/ˈhævənt/'],"hasn't":['/ˈhæzənt/'],"hadn't":['/ˈhædənt/'],"mustn't":['/ˈmʌsənt/'],"let's":['/lets/'],
  zero:['/ˈzɪərəʊ/'],one:['/wʌn/'],two:['/tuː/'],three:['/θriː/'],four:['/fɔː/'],five:['/faɪv/'],
  six:['/sɪks/'],seven:['/ˈsevən/'],eight:['/eɪt/'],nine:['/naɪn/'],ten:['/ten/'],
  eleven:['/ɪˈlevən/'],twelve:['/twelv/'],thirteen:['/ˌθɜːˈtiːn/'],fourteen:['/ˌfɔːˈtiːn/'],
  fifteen:['/ˌfɪfˈtiːn/'],sixteen:['/ˌsɪksˈtiːn/'],seventeen:['/ˌsevənˈtiːn/'],eighteen:['/ˌeɪˈtiːn/'],nineteen:['/ˌnaɪnˈtiːn/'],
  twenty:['/ˈtwenti/'],thirty:['/ˈθɜːti/'],forty:['/ˈfɔːti/'],fifty:['/ˈfɪfti/'],sixty:['/ˈsɪksti/'],
  seventy:['/ˈsevənti/'],eighty:['/ˈeɪti/'],ninety:['/ˈnaɪnti/'],hundred:['/ˈhʌndrəd/'],thousand:['/ˈθaʊzənd/'],
});

export function phoneticSignature(lesson) {
  const text = JSON.stringify((lesson.sentences || []).map(s => [s.id,s.text]));
  let hash = 2166136261;
  for (let i=0;i<text.length;i++) hash = Math.imul(hash ^ text.charCodeAt(i),16777619);
  return `${(hash>>>0).toString(16)}:${text.length}`;
}
const uniqueWords = sentences => [...new Set(sentences.flatMap(s => ipaWords(s.text).map(ipaKey)))];
function cleanForm(value) {
  return typeof value === 'string' && /^\/[^\/<>&\x00-\x1f]{1,160}\/$/u.test(value) ? value : null;
}
function formsOf(value) {
  const forms = Array.isArray(value) ? value : [];
  return [...new Set(forms.slice(0,6).map(cleanForm).filter(Boolean))];
}

// Called by validateLesson, so cloud downloads, outbox recovery and import all
// preserve the same bounded fields. Unknown/obsolete sentence data is rejected.
export function sanitizePhonetics(data, sentences) {
  if (!data || typeof data !== 'object' || data.version !== IPA_VERSION || data.locale !== 'en-GB') return null;
  const signature = phoneticSignature({sentences});
  if (data.signature !== signature || !data.words || typeof data.words !== 'object') return null;
  const words = Object.create(null);
  for (const key of uniqueWords(sentences)) {
    if (!Object.hasOwn(data.words,key)) continue;
    const entry = data.words[key];
    if (!entry || typeof entry !== 'object') continue;
    const forms = formsOf(entry.forms);
    words[key] = {forms,kind: forms.length && ['dictionary','compound','possessive','number'].includes(entry.kind) ? entry.kind : 'missing'};
  }
  return {version:IPA_VERSION,locale:'en-GB',signature,
    dictionary:typeof data.dictionary==='string' ? data.dictionary.slice(0,80) : '',
    words,status:['complete','partial','error'].includes(data.status) ? data.status : 'partial',
    error:typeof data.error==='string' ? data.error.slice(0,300) : '',
    updatedAt:typeof data.updatedAt==='number' && Number.isFinite(data.updatedAt) ? Math.max(0,Math.min(data.updatedAt,Date.now()+86400000)) : 0};
}
export function hasCurrentPhonetics(lesson) {
  const data = lesson?.phonetics;
  return !!data && data.version===IPA_VERSION && data.dictionary===IPA_DICTIONARY_VERSION &&
    data.signature===phoneticSignature(lesson) && ['complete','partial'].includes(data.status) &&
    uniqueWords(lesson.sentences).every(word => Object.hasOwn(data.words || {},word));
}

let dictionaryPromise = null, loadedDictionary = null;
export function loadIPADictionary(fetcher = globalThis.fetch) {
  if (loadedDictionary) return Promise.resolve(loadedDictionary);
  if (dictionaryPromise) return dictionaryPromise;
  const controller = new AbortController(), timer = setTimeout(()=>controller.abort(),10000);
  dictionaryPromise = (async () => {
    try {
      const response = await fetcher(new URL('./ipa-en-gb.json',import.meta.url),{signal:controller.signal});
      if (!response.ok) throw Error('Không tải được từ điển IPA ('+response.status+').');
      const data = await response.json();
      if (data.version!==IPA_DICTIONARY_VERSION || !data.words || typeof data.words!=='object')
        throw Error('Từ điển IPA không đúng phiên bản.');
      loadedDictionary={words:{...data.words,...COMMON_UK},degraded:false};
      return loadedDictionary;
    } finally { clearTimeout(timer);dictionaryPromise=null; }
  })();
  return dictionaryPromise;
}

function numberWords(value) {
  if (!/^\d{1,4}$/.test(value) || (value.length>1 && value.startsWith('0'))) return null;
  const ones=['zero','one','two','three','four','five','six','seven','eight','nine','ten','eleven','twelve','thirteen','fourteen','fifteen','sixteen','seventeen','eighteen','nineteen'];
  const tens=['','','twenty','thirty','forty','fifty','sixty','seventy','eighty','ninety'];
  const n=Number(value);
  if(n<20)return [ones[n]];
  if(n<100)return [tens[Math.floor(n/10)],...(n%10?[ones[n%10]]:[])];
  if(n<1000)return [ones[Math.floor(n/100)],'hundred',...(n%100?['and',...numberWords(String(n%100))]:[])];
  return [ones[Math.floor(n/1000)],'thousand',...(n%1000?[...(n%1000<100?['and']:[]),...numberWords(String(n%1000))]:[])];
}
export function lookupIPA(word,dictionary,depth=0) {
  const key=ipaKey(word), words=dictionary.words || dictionary;
  const exact=Object.hasOwn(COMMON_UK,key) ? COMMON_UK[key] : Object.hasOwn(words,key) ? words[key] : null;
  const forms=formsOf(exact);
  if(forms.length)return {forms,kind:'dictionary'};
  if(key==='color')return lookupIPA('colour',dictionary,depth+1);
  if(key==='email' || key==='e-mail')return {forms:['/ˈiːmeɪl/'],kind:'dictionary'};
  if(depth>1)return {forms:[],kind:'missing'};
  const parts=key.includes('-') ? key.split('-') : numberWords(key);
  if(parts && parts.length>1){
    const readings=parts.map(p=>lookupIPA(p,dictionary,depth+1));
    if(readings.every(p=>p.forms.length))return {forms:['/'+readings.map(p=>p.forms[0].slice(1,-1)).join(' ')+'/'],kind:key.includes('-')?'compound':'number'};
  }
  if(parts?.length===1){const value=lookupIPA(parts[0],dictionary,depth+1);if(value.forms.length)return {...value,kind:'number'};}
  if(key.endsWith("'s")){
    const base=lookupIPA(key.slice(0,-2),dictionary,depth+1);
    if(base.forms.length){
      const readings=base.forms.map(f=>{const body=f.slice(1,-1),last=body.replace(/[ˈˌːˑ\s]/g,'').at(-1);
        const suffix=/[szʃʒ]$|[td]ʒ$|tʃ$/.test(body)?'ɪz':/[ptkfθ]$/.test(last)?'s':'z';return '/'+body+suffix+'/';});
      return {forms:readings,kind:'possessive'};
    }
  }
  return {forms:[],kind:'missing'};
}

export class IPAQueue {
  constructor({save=async()=>{},change=()=>{},status=()=>{},present=()=>true,load=loadIPADictionary}={}) {
    Object.assign(this,{save,change,status,present,load});this.jobs=new Map();
  }
  warm() { return this.load(); }
  cancel(id) { const job=this.jobs.get(id);if(job){job.cancelled=true;this.jobs.delete(id);} }
  ensure(lesson,{allowNew=false,force=false}={}) {
    if(!lesson || lesson.kind==='tts')return Promise.resolve(null);
    if(!force && hasCurrentPhonetics(lesson))return Promise.resolve(lesson.phonetics);
    const signature=phoneticSignature(lesson),old=this.jobs.get(lesson.id);
    if(old?.signature===signature)return old.promise;
    this.cancel(lesson.id);
    const job={signature,cancelled:false,promise:null};this.jobs.set(lesson.id,job);
    const valid=()=>!job.cancelled && this.jobs.get(lesson.id)===job && (allowNew || this.present(lesson));
    job.promise=(async()=>{
      this.status(lesson,'pending');
      let dictionary,error='';
      try {dictionary=await this.load();}
      catch(e){dictionary={words:COMMON_UK,degraded:true};error=e.name==='AbortError'?'Tải từ điển IPA quá thời gian. Thử lại khi có mạng.':e.message;}
      if(!valid())return null;
      if(phoneticSignature(lesson)!==signature){this.cancel(lesson.id);return this.ensure(lesson,{allowNew,force});}
      const words=Object.create(null),list=uniqueWords(lesson.sentences);
      for(let i=0;i<list.length;i++){
        words[list[i]]=lookupIPA(list[i],dictionary);
        if(i && i%300===0){await new Promise(resolve=>setTimeout(resolve,0));if(!valid())return null;}
      }
      if(!valid())return null;
      if(phoneticSignature(lesson)!==signature){this.cancel(lesson.id);return this.ensure(lesson,{allowNew,force});}
      const missing=Object.values(words).some(e=>!e.forms.length);
      const data={version:IPA_VERSION,locale:'en-GB',dictionary:dictionary.degraded?'en-GB-basic-v1':IPA_DICTIONARY_VERSION,
        signature,words,status:dictionary.degraded?'error':missing?'partial':'complete',error,updatedAt:Date.now()};
      lesson.phonetics=data;this.change(lesson);
      if(this.present(lesson))await this.save(lesson);
      this.status(lesson,data.status);return data;
    })().finally(()=>{if(this.jobs.get(lesson.id)===job)this.jobs.delete(lesson.id);});
    return job.promise;
  }
}

export function renderIPAWord(word,index,entry,pending=false) {
  const forms=formsOf(entry?.forms),text=forms.length?forms.join(' · '):pending?'…':'—';
  const description=forms.length ? 'IPA Anh–Anh: '+forms.join(' hoặc ')+(entry.kind==='number'?' · Số đọc theo dạng số đếm.':entry.kind==='compound'?' · Ghép cách đọc từng phần.':'')
    : pending?'Đang tạo IPA…':'Chưa có phiên âm trong từ điển Anh–Anh.';
  return `<button type="button" class="ipa-word" data-word="${index}" title="${escape(description+' · Bấm để nghe lại từ.')}" aria-label="${escape(word+'; '+description)}"><span class="ipa-spelling">${escape(word)}</span><span class="ipa-symbol ${forms.length?'':'ipa-unavailable'}" aria-hidden="true">${escape(text)}</span></button>`;
}

export function initIPAUI({onToggle=()=>{}}={},doc=document) {
  if(!doc.getElementById('ipa-styles')){
    const link=doc.createElement('link');link.id='ipa-styles';link.rel='stylesheet';link.href=new URL('./ipa.css',import.meta.url).href;doc.head.append(link);
  }
  let control=doc.getElementById('show-ipa'),row=doc.getElementById('ipa-display-option');
  const menu=doc.querySelector('#display-menu .caption-options');
  if(!control && menu){row=doc.createElement('label');row.id='ipa-display-option';
    row.innerHTML='<span>Phiên âm IPA</span><input id="show-ipa" type="checkbox" checked />';menu.append(row);control=doc.getElementById('show-ipa');}
  if(control)control.onchange=()=>onToggle(control.checked);
  return {sync(lesson){const shadow=lesson?.kind!=='tts' && lesson?.mode==='shadow';
    if(row)row.hidden=!shadow;if(control){control.disabled=!shadow;control.checked=lesson?.settings?.ipa!==false;}}};
}

// Scroll the additional IPA caption inside its own frame, without moving the page.
export function followIPAHighlight(doc=document) {
  const caption=doc.getElementById('caption');
  if(!caption?.classList.contains('ipa-caption'))return;
  const active=caption.querySelector('[data-word].active'),container=caption.closest('.caption-content');
  if(!active || !container || caption.dataset.ipaActive===active.dataset.word)return;
  caption.dataset.ipaActive=active.dataset.word;
  const outer=container.getBoundingClientRect(),word=active.getBoundingClientRect();
  if(word.bottom>outer.bottom || word.top<outer.top){
    const top=container.scrollTop+word.top-outer.top-Math.max(0,(container.clientHeight-word.height)/2);
    if(typeof container.scrollTo==='function')container.scrollTo({top:Math.max(0,top),behavior:'smooth'});
    else container.scrollTop=Math.max(0,top);
  }
}
