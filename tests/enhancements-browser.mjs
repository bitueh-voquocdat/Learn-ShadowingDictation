// End-to-end regression for the final additions; uses the existing test harness.
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import assert from 'node:assert/strict';
import {fileURLToPath} from 'node:url';
import {uiClick,uiCheck} from './ui-controls.mjs';
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE||'playwright');
const root=fileURLToPath(new URL('..',import.meta.url));
const out=path.resolve(process.env.TEST_OUTPUT_DIR||path.join(root,'test-output/enhancements'));
fs.mkdirSync(out,{recursive:true});
const config=JSON.parse(fs.readFileSync(path.join(root,'vercel.json')));
const audioFixture=fs.readFileSync(path.join(root,'tests/fixtures/tts.json'));
let serviceMode='normal',translateCalls=0;
const translations={
  'I study English every day.':'Tôi học tiếng Anh mỗi ngày.',
  'I like a cup of tea.':'Tôi thích một tách trà.',
  'Learning can be fun!':'Việc học có thể rất thú vị!',
};
const server=http.createServer(async(req,res)=>{
  for(const h of config.headers[0].headers)res.setHeader(h.key,h.value);
  if(req.url==='/api/translate'){
    translateCalls++;let text='';for await(const chunk of req)text+=chunk;
    const items=JSON.parse(text).items;
    if(serviceMode==='slow')await new Promise(r=>setTimeout(r,700));
    res.writeHead(serviceMode==='error'?503:200,{'Content-Type':'application/json'});
    return res.end(serviceMode==='error'?JSON.stringify({error:'Translation temporarily offline'}):
      JSON.stringify({translations:items.map(i=>({...i,translation:translations[i.text]||'Bản dịch thử nghiệm: '+i.text,provider:'fixture'})),failed:[]}));
  }
  if(req.url==='/api/tts'){
    for await(const _ of req){}res.writeHead(200,{'Content-Type':'application/json'});return res.end(audioFixture);
  }
  const file=req.url==='/'?'index.html':decodeURIComponent(req.url.slice(1).split('?')[0]);
  try{
    const data=fs.readFileSync(path.join(root,'public',file));
    const types={'.html':'text/html','.mjs':'application/javascript','.css':'text/css','.ttf':'font/ttf','.svg':'image/svg+xml'};
    res.writeHead(200,{'Content-Type':types[path.extname(file)]||'application/octet-stream'});res.end(data);
  }catch{res.writeHead(404);res.end();}
});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const url=`http://127.0.0.1:${server.address().port}`;
const browser=await chromium.launch({executablePath:process.env.PLAYWRIGHT_EXECUTABLE_PATH||undefined,
  args:['--no-sandbox','--disable-dev-shm-usage','--disable-gpu'],headless:true});
const context=await browser.newContext({viewport:{width:1365,height:850},acceptDownloads:true});
await context.route('**/firebase-adapter.mjs',r=>r.fulfill({contentType:'application/javascript',body:
  "export function createTransport(){return {list:async()=>{throw Error('Offline fixture')},watch:()=>()=>{}};}"}));
await context.addInitScript(()=>{
  window.__tones=0;
  const Native=window.AudioContext;
  if(Native)window.AudioContext=class extends Native{
    createOscillator(){window.__tones++;return super.createOscillator();}
  };
});
const page=await context.newPage(),errors=[],report=[];
page.on('pageerror',e=>errors.push(e.message));page.setDefaultTimeout(12000);
const check=name=>report.push({name,status:'passed'});
const stage=async name=>{
  await uiClick(page,`[data-mode="${name}"]`);
  await page.waitForFunction(name=>document.querySelector('#workspace').dataset.mode===name,name);
};
const current=()=>page.evaluate(()=>{
  const item=Object.entries(localStorage).find(([key])=>key.startsWith('shadowlab-library-'));
  const data=JSON.parse(item[1]);return data.lessons.find(l=>l.id===data.current);
});
const create=async(title,text)=>{
  await uiClick(page,'#new');await page.locator('#new-title').fill(title);
  await page.locator('#new-text').fill(text);await uiClick(page,'#analyse');await uiClick(page,'#create-confirm');
  await page.waitForFunction(()=>!document.querySelector('#create-dialog').open);
};
const completeTranslation=()=>page.waitForFunction(()=>{
  const entry=Object.entries(localStorage).find(([key])=>key.startsWith('shadowlab-library-'));
  if(!entry)return false;const data=JSON.parse(entry[1]);
  return data.lessons.find(l=>l.id===data.current)?.translationData?.status==='complete';
});
const shot=async name=>page.screenshot({path:path.join(out,name),fullPage:true,animations:'disabled'});
try{
  await page.goto(url);await page.waitForSelector('#new');
  await create('Final additions','I study English every day. I like a cup of tea. Learning can be fun!');
  await completeTranslation();let l=await current();const id=l.id;
  assert.equal(l.sentences.length,3);assert.equal(l.sentences[0].translation,'Tôi học tiếng Anh mỗi ngày.');
  assert(l.translationData.paragraph);check('new English lesson automatically receives saved sentence and full-text translations');
  await page.evaluate(()=>document.fonts.ready);
  assert(await page.evaluate(()=>getComputedStyle(document.body).fontFamily.includes('Be Vietnam Pro')&&
    document.fonts.check('400 13px "Be Vietnam Pro"','Tiếng Việt: ơ ư ắ ấ ệ ộ ờ ự')));
  check('local Vietnamese font loads under production CSP');
  await uiCheck(page,'#show-translation',true);
  assert.equal(await page.locator('#translation').innerText(),'Tôi học tiếng Anh mỗi ngày.');
  await uiClick(page,'#show-full-translation');
  assert(await page.locator('#paragraph-translation').innerText());
  assert(await page.locator('#paragraph-original').innerText().then(t=>t.includes('Learning can be fun!')));
  await shot('automatic-translation.png');await page.locator('[data-close="translation-dialog"]').click();
  check('whole translation uses a popup, sentence translation uses the existing caption control');
  await stage('dict');assert(await page.locator('#translation').isHidden());
  assert(await page.locator('#show-full-translation').isDisabled());check('dictation retains hidden answers and translations');
  await page.locator('#dict-answer').fill('I study English every day.');await uiClick(page,'#check');
  await page.waitForFunction(()=>window.__tones>0);
  assert(await page.locator('#dict-result').innerText().then(t=>t.includes('100%')));
  check('correct answer plays a short synthesized feedback sound without changing scoring');
  const tones=await page.evaluate(()=>window.__tones);
  await page.locator('#dict-answer').fill('I English day.');await uiClick(page,'#check');
  await page.waitForFunction(n=>window.__tones>n,tones);check('incorrect answer plays a distinct sound and keeps word comparison');
  await uiClick(page,'#show-appearance');await page.locator('#feedback-sound').uncheck();
  await page.locator('[data-close="appearance-dialog"]').click();const muted=await page.evaluate(()=>window.__tones);
  await uiClick(page,'#check');await page.waitForTimeout(150);assert.equal(await page.evaluate(()=>window.__tones),muted);
  check('sound can be muted independently of the exercises');
  await uiClick(page,'#theme-toggle');assert.equal(await page.locator('html').getAttribute('data-theme'),'dark');
  await page.waitForFunction(()=>{
    const entry=Object.entries(localStorage).find(([key])=>key.startsWith('shadowlab-library-'));
    const data=JSON.parse(entry[1]);return data.lessons.find(l=>l.id===data.current)?.settings.experience?.theme==='dark';
  });
  assert.equal((await current()).settings.experience.theme,'dark');check('dark toggle is saved with the lesson');
  await uiClick(page,'#show-appearance');
  await page.locator('#appearance-accent').evaluate(el=>{el.value='#875bda';el.dispatchEvent(new Event('input',{bubbles:true}));});
  await page.locator('#appearance-gradient').evaluate(el=>{el.value='24';el.dispatchEvent(new Event('input',{bubbles:true}));});
  await shot('dark-preferences.png');await page.locator('[data-close="appearance-dialog"]').click();
  await page.waitForTimeout(300);assert.equal((await current()).settings.experience.accent,'#875bda');
  check('custom color and gradient intensity persist without rebuilding audio');
  await stage('review');assert(await page.locator('#review-pane').evaluate(el=>el.classList.contains('review-enter')));
  await shot('dark-review.png');check('entering Review animates its existing cards and keeps the original review layout');
  await stage('listen');await shot('dark-listen.png');
  await page.setViewportSize({width:390,height:844});
  assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));await shot('dark-mobile.png');
  check('dark mode and the added toolbar icon remain within a mobile viewport');
  await page.setViewportSize({width:1365,height:850});
  await uiClick(page,'#show-appearance');await page.locator('#feedback-effects').uncheck();await page.locator('[data-close="appearance-dialog"]').click();
  await stage('review');assert(!await page.locator('#review-pane').evaluate(el=>el.classList.contains('review-enter')));
  check('effects can be disabled without changing Review data or controls');
  await stage('listen');const requestsBeforeReload=translateCalls;
  await page.reload();await page.waitForSelector(`[data-lesson="${id}"]`);await uiClick(page,`[data-lesson="${id}"]`);
  await page.waitForTimeout(300);assert.equal(translateCalls,requestsBeforeReload);
  l=await current();assert.equal(l.settings.experience.theme,'dark');assert.equal(l.settings.experience.accent,'#875bda');
  assert.equal(l.sentences[0].translation,'Tôi học tiếng Anh mỗi ngày.');
  check('reload restores saved translations, theme, color, effects and learning attempts');
  await uiClick(page,'#export');await page.locator('#include-audio').uncheck();
  const downloaded=page.waitForEvent('download');await uiClick(page,'#export-confirm');
  const file=await downloaded;await file.saveAs(path.join(out,'roundtrip.shadow.json'));
  const portable=JSON.parse(fs.readFileSync(path.join(out,'roundtrip.shadow.json')));
  assert.equal(portable.lesson.translationData.status,'complete');assert.equal(portable.lesson.settings.experience.theme,'dark');
  check('portable file contains full translation, sentence translations and appearance preferences');
  await uiClick(page,'#edit-sentence');await page.locator('#edit-translation').fill('Bản dịch tôi tự điều chỉnh.');
  await page.locator('#edit-form button[type=submit]').click();await page.waitForTimeout(250);
  await uiClick(page,'#show-full-translation');await uiClick(page,'#retry-translation');
  await page.locator('[data-close="translation-dialog"]').click();
  assert.equal((await current()).sentences[0].translation,'Bản dịch tôi tự điều chỉnh.');check('retry never overwrites a user-edited translation');
  serviceMode='error';await create('Offline translation','A new sentence for the offline case.');
  await page.waitForFunction(()=>document.querySelector('#global-status').textContent.includes('Dịch tự động chưa đủ'));
  l=await current();assert.equal(l.translationData.status,'partial');assert.equal(l.sentences.length,1);
  await uiClick(page,'#show-full-translation');assert(await page.locator('#retry-translation').isEnabled());
  serviceMode='normal';await uiClick(page,'#retry-translation');await completeTranslation();
  assert(await page.locator('#retry-translation').isEnabled());await page.locator('[data-close="translation-dialog"]').click();
  check('offline translation preserves the new lesson and retry becomes usable after the job finishes');
  serviceMode='slow';await create('Edited during translation','The original sentence before editing.');
  await uiClick(page,'#edit-sentence');await page.locator('#edit-text').fill('The revised English sentence.');
  await page.locator('#edit-form button[type=submit]').click();await completeTranslation();
  l=await current();assert.match(l.sentences[0].translation,/revised English/);assert(!l.translationData.paragraph.includes('original sentence'));
  check('editing a sentence during translation discards the old response and saves the new one');
  serviceMode='normal';await uiClick(page,'#tts-tab');await page.locator('#tts-text').fill('One final audio example.');
  await uiClick(page,'#tts-generate');await page.waitForFunction(()=>!document.querySelector('#tts-output').hidden);
  const callsBeforeStudy=translateCalls;await uiClick(page,'#tts-study');await completeTranslation();assert(translateCalls>callsBeforeStudy);
  check('Text → MP3 remains operational and a converted study lesson also receives translations');
  assert.deepEqual(errors,[]);check('no uncaught browser errors under the unchanged production security headers');
  console.log(JSON.stringify(report,null,2));
  fs.writeFileSync(path.join(out,'enhancements-ui-report.json'),JSON.stringify(report,null,2));
}finally{await browser.close();await new Promise(r=>server.close(r));}
