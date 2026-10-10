// Presentation only: these controls delegate to the existing app handlers.
import { readerStats, dueSentences } from './core.mjs';
const $ = (id) => document.getElementById(id);
const paths = {
  moon: '<path d="M20.6 14.1A9 9 0 0 1 9.9 3.4 9 9 0 1 0 20.6 14.1Z"/>',
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2m0 16v2M2 12h2m16 0h2M5 5l1.5 1.5m11 11L19 19M5 19l1.5-1.5m11-11L19 5"/>',
  language: '<path d="M3 5h12M9 3v2M5 5c0 6 6 10 10 11M13 5c0 5-5 10-10 12m12-2 4-9 4 9m-6-3h4"/>',
  palette: '<path d="M12 3a9 9 0 1 0 0 18h1a2 2 0 0 0 1-3.7c-1.1-.6-.8-2.3.5-2.3H17a4 4 0 0 0 4-4c0-4.5-4-8-9-8Z"/><circle cx="7" cy="10" r=".7"/><circle cx="10" cy="6" r=".7"/><circle cx="15" cy="7" r=".7"/>',
  audio: '<path d="M4 10v4m4-8v12m4-16v20m4-16v12m4-9v6"/>',
  headphones: '<path d="M4 14v-3a8 8 0 0 1 16 0v3M4 13h2v7H4a2 2 0 0 1-2-2v-3a2 2 0 0 1 2-2Zm16 0h-2v7h2a2 2 0 0 0 2-2v-3a2 2 0 0 0-2-2Z"/>',
  mic: '<rect x="9" y="2" width="6" height="13" rx="3"/><path d="M5 10v2a7 7 0 0 0 14 0v-2m-7 9v3m-4 0h8"/>',
  write: '<path d="M14 3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-9M16 2l6 6m-2-8L9 11l-1 5 5-1L24 4M7 20h10"/>',
  edit: '<path d="m15 4 5 5M4 20l5-1L21 7a2.8 2.8 0 0 0-4-4L5 15l-1 5Z"/>',
  library: '<rect x="4" y="3" width="14" height="17" rx="2"/><path d="M8 7h6M8 11h5m-4 9 3-3 3 3m6-14v13a4 4 0 0 1-4 4H7"/>',
  folder: '<path d="M3 7V5a2 2 0 0 1 2-2h5l2 3h7a2 2 0 0 1 2 2v2M3 7h18l-2 13H3L1 7h2Z"/>',
  note: '<path d="M7 4H4v17h16V4h-3M9 2h6v5H9V2Zm-2 9h10m-10 4h7"/>',
  repeat: '<path d="m17 2 4 4-4 4M3 11V9a3 3 0 0 1 3-3h15M7 22l-4-4 4-4m14-1v2a3 3 0 0 1-3 3H3"/>',
  replay: '<path d="M4 10a8 8 0 1 1 0 6m0-13v7h7"/>',
  download: '<path d="M12 3v12m-5-5 5 5 5-5M4 16v5h16v-5"/>',
  trash: '<path d="M3 6h18M9 6V3h6v3M5 6l1 15h12l1-15M10 10v7m4-7v7"/>',
  cloud: '<path d="M17 18h2a4 4 0 0 0 .5-8 7 7 0 0 0-13-2 5 5 0 0 0-1.5 10h2m2-5 3-3 3 3m-3-3v12"/>',
  settings: '<path d="m9 3 1-1h4l1 3 3 1 3-1 2 4-2 2v3l2 2-2 4-3-1-3 1-1 3h-4l-1-3-3-1-3 1-2-4 2-2v-3L1 9l2-4 3 1 3-1V3Z"/><circle cx="12" cy="12" r="3"/>',
  sliders: '<path d="M4 3v4m0 4v10m8-18v10m0 4v4m8-18v4m0 4v10M1 7h6m2 10h6m2-10h6"/>',
  list: '<path d="M8 5h13M8 12h13M8 19h13M3 5h.1M3 12h.1M3 19h.1"/>',
  user: '<circle cx="12" cy="7" r="4"/><path d="M4 22v-3a8 8 0 0 1 16 0v3"/>',
  help: '<circle cx="12" cy="12" r="9"/><path d="M9 8a3 3 0 0 1 6 0c0 2-3 2-3 5m0 4h.1"/>',
  info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v6m0-10h.1"/>',
  search: '<circle cx="10" cy="10" r="6"/><path d="m15 15 6 6"/>',
  plus: '<path d="M12 4v16M4 12h16"/>',
  check: '<path d="m5 12 4 4L20 5"/>',
  close: '<path d="m6 6 12 12M6 18 18 6"/>',
  more: '<circle cx="12" cy="4" r="1"/><circle cx="12" cy="12" r="1"/><circle cx="12" cy="20" r="1"/>',
  'chevron-down': '<path d="m6 9 6 6 6-6"/>',
  'chevron-left': '<path d="m15 5-7 7 7 7"/>',
  'chevron-right': '<path d="m9 5 7 7-7 7"/>',
  'arrow-right': '<path d="M3 12h18m-7-7 7 7-7 7"/>',
  play: '<path d="m8 4 13 8-13 8V4Z"/>',
  pause: '<path d="M7 4h3v16H7V4Zm7 0h3v16h-3V4Z"/>',
  stop: '<rect x="6" y="6" width="12" height="12" rx="1.5"/>',
  bulb: '<path d="M9 18h6m-6 3h6m-6-6a6 6 0 1 1 6 0v3H9v-3Z"/>',
  history: '<path d="M3 9a9 9 0 1 1 0 6m0-12v6h6m3-2v5l4 2"/>',
};
export const icon = (name) => `<svg class="icon" viewBox="0 0 24 24" aria-hidden="true">${paths[name] || paths.info}</svg>`;
const escape = (s) => String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const modes = {listen:['Listen','headphones'],dict:['Dictation','write'],shadow:['Shadowing','mic'],review:['Review','repeat']};
let toastTimer, confirmation = null, navigationSignature = '';
let transcriptKey = '';
const recognitionSnapshots = new Map();

// Recognition snapshots are display-only. Saved transcripts, attempts and
// recordings continue to be owned by the existing learning logic.
export function noteRecognition(text) {
  if (transcriptKey && text.trim()) {
    recognitionSnapshots.set(transcriptKey, text);
    if (recognitionSnapshots.size > 40)
      recognitionSnapshots.delete(recognitionSnapshots.keys().next().value);
  }
  syncTranscriptUI();
}

export function resetRecognitionView() {
  recognitionSnapshots.delete(transcriptKey);
  syncTranscriptUI();
}

function syncTranscriptUI() {
  const text = $('spoken-text').value;
  const original = recognitionSnapshots.get(transcriptKey) || '';
  const edited = !!original && text.trim() !== original.trim();
  const result = $('speech-result');
  const stale = !!result.children.length && text.trim() !== (result.dataset.answer || '').trim();
  $('speech-summary-label').textContent = text.trim()
    ? 'Xem / sửa bản chép lời nói' : 'Nhập / sửa bản chép lời nói';
  $('transcript-note').hidden = !(edited || stale);
  $('transcript-note').textContent = 'Bản chép đã thay đổi. Nhấn Đối chiếu để chấm nội dung hiện tại.';
  $('recognition-original').hidden = !edited;
  $('recognition-original-text').textContent = edited ? original : '';
  result.dataset.stale = String(stale);
}

function syncShadowUI() {
  const run = $('shadow-run');
  const capturing = !$('finish-record').hidden;
  const hasResult = !!$('speech-result').children.length || !$('record-playback').hidden;
  const footer = $('shadow-result-actions');
  const target = hasResult && !capturing ? footer : document.querySelector('.shadow-actions');
  if (run.parentElement !== target) target.insertBefore(run, target.firstChild);
  const record = $('record');
  if (record.parentElement !== target) target.insertBefore(record, target === footer ? $('shadow-next') : $('finish-record'));
  footer.hidden = !hasResult || capturing;
  run.hidden = capturing;
  $('shadow-pane').dataset.recording = String(capturing);
  $('shadow-pane').dataset.hasResult = String(hasResult && !capturing);
  $('workspace').dataset.shadowResult = String(hasResult && !capturing && $('workspace').dataset.mode === 'shadow');
  $('shadow-next').disabled = $('next').disabled;
  const label = run.disabled ? 'Đang luyện…' : hasResult ? 'Luyện lại' : 'Bắt đầu luyện tập';
  if (run.dataset.label !== label) {
    run.dataset.label = label;
    run.innerHTML = icon(hasResult ? 'replay' : 'mic') + escape(label);
  }
  syncTranscriptUI();
}

export function notify(message, kind = '') {
  const box = $('global-status');
  clearTimeout(toastTimer);
  if (!message) { box.hidden = true; return; }
  // Keep an actionable error visible even if another operation reports progress.
  if (!box.hidden && box.classList.contains('error') && box.dataset.message !== message) {
    const previous = box.cloneNode(true);
    previous.removeAttribute('id');
    previous.querySelector('.toast-close').onclick = () => previous.remove();
    $('toast-stack').insertBefore(previous, box);
  }
  box.dataset.message = message;
  box.className = `global-status ${kind}`;
  box.setAttribute('role', kind === 'error' ? 'alert' : 'status');
  box.innerHTML = `<span class="toast-icon">${icon(kind === 'success' ? 'check' : 'info')}</span><span>${escape(message)}</span><button type="button" class="toast-close" aria-label="Đóng thông báo">${icon('close')}</button>`;
  box.hidden = false;
  box.querySelector('button').onclick = () => { clearTimeout(toastTimer); box.hidden = true; };
  if (kind !== 'error') toastTimer = setTimeout(() => { box.hidden = true; }, kind === 'success' ? 5000 : 7000);
}

export function confirmAction(message, {title='Xác nhận thao tác', confirmLabel='Tiếp tục', danger=false} = {}) {
  if (confirmation) return Promise.resolve(false);
  const dialog = $('confirm-dialog');
  $('confirm-title').textContent = title;
  $('confirm-message').textContent = message;
  $('confirm-accept').textContent = confirmLabel;
  $('confirm-accept').className = danger ? 'danger' : 'primary';
  $('confirm-symbol').className = `confirm-symbol ${danger ? 'danger' : ''}`;
  $('confirm-symbol').innerHTML = icon(danger ? 'trash' : 'info');
  dialog.returnValue = 'cancel';
  return new Promise(resolve => {
    confirmation = resolve;
    dialog.addEventListener('close', () => {
      confirmation = null;
      resolve(dialog.returnValue === 'accept');
    }, {once:true});
    dialog.showModal();
    $('confirm-cancel').focus();
  });
}

export function openPanel(id) {
  const target = $(id);
  // Close only informational panels; editable forms and conflict decisions keep
  // their existing behavior and their input data.
  document.querySelectorAll('dialog.drawer[open], #sync-dialog[open]').forEach(d => {
    if (d !== target) d.close();
  });
  if (!target.open) target.showModal();
}

export function syncPlayback({playing, resumable, busy}) {
  const button = $('main-play');
  const label = playing ? 'Tạm dừng' : resumable ? 'Tiếp tục' : 'Nghe câu';
  if (button.dataset.label !== label) {
    button.dataset.label = label;
    button.innerHTML = icon(playing ? 'pause' : 'play');
    button.setAttribute('aria-label',label);
    button.title = label;
  }
  button.disabled = !!busy && !resumable;
  button.dataset.playing = String(playing);
  const seek = $('seek');
  const span = Number(seek.max) - Number(seek.min);
  const percent = seek.disabled || span <= 0 ? 0 : Math.max(0, Math.min(100, (Number(seek.value) - Number(seek.min)) / span * 100));
  seek.style.setProperty('--played', `${percent}%`);
  seek.setAttribute('aria-valuetext', `${$('elapsed').textContent} / ${$('duration').textContent}`);
}

export function renderLessonUI(l) {
  const active = !!l && l.kind !== 'tts';
  document.body.dataset.lessonOpen = String(active);
  $('new').classList.toggle('primary', !active);
  $('new').classList.toggle('outline', active);
  $('delete-lesson').disabled = !l || l.kind === 'tts';
  $('change-lesson').disabled = !l || l.kind === 'tts';
  document.querySelectorAll('[data-needs-lesson]').forEach(b=> {b.disabled=!l || l.kind==='tts';});
  $('show-full-translation').disabled = !l || l.kind === 'tts' || l.mode === 'dict';
  if (!l || l.kind === 'tts') return;
  const key = `${l.id}:${l.sentences[l.cursor].id}`;
  if (key !== transcriptKey) {
    transcriptKey = key;
    $('recognition-original').open = false;
  }
  $('workspace').dataset.mode = l.mode;
  const [name, glyph] = modes[l.mode] || modes.listen;
  $('mode-label').textContent = name;
  $('step-crumb').textContent = name;
  $('mode-icon').innerHTML = icon(glyph);
  const speakers = readerStats(l).length;
  $('lesson-meta').innerHTML = `<span class="meta-item">${icon('write')}${l.sentences.length} câu</span><span class="meta-divider"></span><span class="meta-item">${icon('user')}${speakers} người đọc</span><span class="meta-divider"></span><span class="meta-item">${icon('audio')}${l.settings.source === 'original' ? 'Audio gốc' : 'Giọng UK'}</span>`;
  const completed = Object.values(l.progress).filter(p=>p.completed).length;
  $('lesson-progress').max = l.sentences.length;
  $('lesson-progress').value = completed;
  $('progress-text').textContent = `${completed}/${l.sentences.length} câu`;
  $('progress-percent').textContent = `${Math.round(completed/l.sentences.length*100)}%`;
  $('show-progress').title = `${completed} câu hoàn tất · Xem thống kê`;
  $('next-footer').disabled = l.cursor >= l.sentences.length-1;
  syncShadowUI();
  const attempted = l.sentences.filter(s => l.progress[s.id].dict.attempts.length || l.progress[s.id].shadow.attempts.length).length;
  const dict = Object.values(l.progress).map(p=>p.dict);
  const listens = l.sentences.reduce((n,s)=>n+(l.progress[s.id].listen||0)+l.progress[s.id].dict.listens+l.progress[s.id].shadow.listens,0);
  const tiles = [[`${completed}/${l.sentences.length}`,'Câu hoàn tất'],[attempted,'Câu đã luyện'],[l.sentences.filter(s=>s.star).length,'Câu đánh dấu'],[dueSentences(l).length,'Câu cần ôn'],[listens,'Lượt nghe'],[dict.reduce((n,p)=>n+p.hints,0),'Gợi ý đã dùng']];
  $('progress-overview').innerHTML = `<div class="stat-grid">${tiles.map(([n,label])=>`<div class="stat-tile"><strong>${n}</strong><small>${label}</small></div>`).join('')}</div>`;
  const signature = JSON.stringify([l.id,l.cursor,l.mode,l.sentences.map(s=>[s.id,s.star,l.progress[s.id].completed])]);
  if (signature === navigationSignature) return;
  navigationSignature = signature;
  const total = l.sentences.length;
  const limit = matchMedia('(max-width:600px)').matches ? 7 : 10;
  let start = Math.max(0, Math.min(total-limit,l.cursor-Math.floor(limit/2)));
  const indexes = Array.from({length:Math.min(limit,total)},(_,i)=>start+i);
  $('sentence-numbers').innerHTML = indexes.map(i=> {
    const s = l.sentences[i], done = l.progress[s.id].completed;
    const status = `${i===l.cursor ? ' · đang học' : ''}${done ? ' · đã hoàn tất' : ' · chưa hoàn tất'}${s.star ? ' · đánh dấu' : ''}`;
    return `<button class="sentence-number ${i===l.cursor ? 'active' : ''} ${done ? 'completed' : ''}" data-jump="${i}" aria-label="Câu ${i+1}${status}" aria-current="${i===l.cursor ? 'true' : 'false'}" title="Câu ${i+1}${status}">${i+1}${done||s.star ? `<span class="number-state" aria-hidden="true">${s.star ? '★' : '✓'}</span>` : ''}</button>`;
  }).join('');
}

export function initPresentation() {
  document.querySelectorAll('[data-icon]').forEach(el => {
    if (el.id || el.classList.length) el.innerHTML = icon(el.dataset.icon);
    else el.outerHTML = icon(el.dataset.icon);
  });
  $('show-sentences').onclick = () => openPanel('sentence-dialog');
  $('show-progress').onclick = () => openPanel('progress-dialog');
  $('confirm-cancel').onclick = () => $('confirm-dialog').close('cancel');
  $('confirm-accept').onclick = () => $('confirm-dialog').close('accept');
  document.addEventListener('click', e => {
    const button = e.target.closest('button');
    if (button?.dataset.action) $(button.dataset.action)?.click();
    const selected = button?.closest('.dropdown');
    document.querySelectorAll('.dropdown[open]').forEach(menu => {
      if (!menu.contains(e.target) || selected===menu) menu.open = false;
    });
  });
  document.addEventListener('toggle', e => {
    const menu = e.target;
    if (menu.matches?.('.dropdown') && menu.open)
      document.querySelectorAll('.dropdown[open]').forEach(other=> {if(other!==menu) other.open=false;});
  },true);
  document.addEventListener('keydown', e => {
    if (e.key !== 'Escape' || document.querySelector('dialog[open]')) return;
    const menu = document.querySelector('.dropdown[open]');
    if (menu) { e.preventDefault(); menu.open=false; menu.querySelector('summary').focus(); }
  });
  document.querySelectorAll('.dropdown>summary').forEach(summary=> {
    summary.addEventListener('keydown', e => {
      if (e.key==='ArrowDown') {
        e.preventDefault();
        summary.parentElement.open=true;
        summary.parentElement.querySelector('button:not(:disabled),input,select')?.focus();
      }
    });
  });
  // All original text fields stay in the DOM. Collapsing a panel neither saves
  // new data nor stops playback/capture; those remain owned by app.mjs.
  document.querySelectorAll('dialog').forEach(dialog=> {
    const heading = dialog.querySelector('h2');
    if (heading && !dialog.hasAttribute('aria-labelledby')) {
      heading.id ||= `${dialog.id}-title`;
      dialog.setAttribute('aria-labelledby',heading.id);
    }
  });
  // Warn only when explicitly dismissing an unsaved form. Saving and automatic
  // note/settings persistence keep their original behavior.
  for (const id of ['create-dialog', 'edit-dialog']) {
    const dialog = $(id);
    let initial = '', asking = false, pendingClose = false;
    const snapshot = () => JSON.stringify([...dialog.querySelectorAll('input,textarea,select')]
      .map(el => [el.type === 'checkbox' ? el.checked : el.value]));
    new MutationObserver(() => { if (dialog.open) initial = snapshot(); })
      .observe(dialog, {attributes:true, attributeFilter:['open']});
    const discard = async () => {
      if (asking) { pendingClose = true; return; }
      asking = true;
      const accepted = await confirmAction('Nội dung trong cửa sổ này chưa được lưu. Đóng và bỏ các thay đổi?',
        {title:'Đóng khi chưa lưu?',confirmLabel:'Bỏ thay đổi',danger:true});
      asking = false;
      const retryClose = pendingClose;
      pendingClose = false;
      if (accepted) dialog.close();
      else if (retryClose && dialog.open) discard();
    };
    dialog.addEventListener('cancel', e => {
      if (initial !== snapshot()) { e.preventDefault(); discard(); }
    });
    dialog.addEventListener('click', e => {
      if (e.target.closest(`[data-close="${id}"]`) && initial !== snapshot()) {
        e.preventDefault(); e.stopImmediatePropagation(); discard();
      }
    }, true);
  }
  $('spoken-text').addEventListener('input', syncTranscriptUI);
  new MutationObserver(syncShadowUI).observe($('speech-result'), {childList:true});
  new MutationObserver(syncShadowUI).observe($('record-playback'), {attributes:true,attributeFilter:['hidden']});
  new MutationObserver(syncShadowUI).observe($('finish-record'), {attributes:true,attributeFilter:['hidden']});
  new MutationObserver(syncShadowUI).observe($('shadow-run'), {attributes:true,attributeFilter:['disabled']});
  window.addEventListener('resize',()=> { navigationSignature=''; });
  for (const [id, glyph, idle, busy] of [
    ['listen-all','play','Nghe toàn bài','Đang nghe…'],
    ['tts-generate','audio','Tạo giọng đọc','Đang tạo…'],
  ]) {
    const button = $(id);
    const update = () => {button.innerHTML = icon(glyph) + escape(button.disabled ? busy : idle);};
    new MutationObserver(update).observe(button,{attributes:true,attributeFilter:['disabled']});
    update();
  }
}
