import {DEFAULT_EXPERIENCE, sanitizeExperience, palette} from './preferences.mjs';
import {icon, openPanel, notify} from './presentation.mjs';

const KEY = 'shadowlab-experience-v1';
const $ = id => document.getElementById(id);
let prefs = {...DEFAULT_EXPERIENCE}, audio = null, activeLesson = null;
let onChange = () => {}, previousMode = '', previousLesson = '', effectTimer;
const celebrated = new Set();

try { prefs = sanitizeExperience(JSON.parse(localStorage.getItem(KEY) || '{}')); } catch {}

export function experiencePreferences() { return {...prefs}; }
export function effectiveDark(value = prefs) {
  return value.theme === 'dark' || value.theme === 'system' && matchMedia('(prefers-color-scheme:dark)').matches;
}
function apply() {
  const root = document.documentElement, dark = effectiveDark();
  root.dataset.theme = dark ? 'dark' : 'light';
  root.dataset.customAccent = String(prefs.accent !== DEFAULT_EXPERIENCE.accent);
  root.dataset.effects = String(prefs.effects);
  root.style.colorScheme = dark ? 'dark' : 'light';
  for (const [key, value] of Object.entries(palette(prefs, dark))) root.style.setProperty(key, value);
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', dark ? '#0c1424' : '#f9fbff');
  const button = $('theme-toggle');
  if (button) {
    button.innerHTML = icon(dark ? 'sun' : 'moon');
    button.setAttribute('aria-pressed', String(dark));
    button.setAttribute('aria-label', dark ? 'Chuyển sang giao diện sáng' : 'Chuyển sang giao diện tối');
    button.title = dark ? 'Giao diện sáng' : 'Giao diện tối';
  }
}
// Module imports run before asynchronous cloud initialization and first render.
apply();

function syncForm() {
  $('appearance-theme').value = prefs.theme;
  $('appearance-accent').value = prefs.accent;
  $('appearance-gradient').value = prefs.gradient;
  $('appearance-gradient-value').textContent = `${prefs.gradient}%`;
  $('feedback-sound').checked = prefs.sound;
  $('feedback-volume').value = prefs.volume;
  $('feedback-volume-value').textContent = `${prefs.volume}%`;
  $('feedback-effects').checked = prefs.effects;
}
function save(value) {
  prefs = sanitizeExperience({...prefs, ...value});
  try { localStorage.setItem(KEY, JSON.stringify(prefs)); } catch {}
  apply(); syncForm();
  if (activeLesson) activeLesson.settings.experience = experiencePreferences();
  onChange(activeLesson);
  if (!prefs.effects) clearEffects();
}
async function unlock() {
  if (!prefs.sound) return;
  try {
    const Context = window.AudioContext || window.webkitAudioContext;
    if (!Context) return;
    audio ||= new Context();
    if (audio.state === 'suspended') await audio.resume();
  } catch { /* A blocked sound never blocks a learning operation. */ }
}
export function soundBlocked() {
  return !$('finish-record').hidden || !$('model').paused || !$('recorded').paused || !$('tts-player').paused;
}
export async function playFeedbackSound(kind = 'correct', preview = false) {
  if (!prefs.sound || !prefs.volume || soundBlocked()) return false;
  await unlock();
  if (!audio || audio.state !== 'running' || soundBlocked()) return false;
  try {
    const notes = kind === 'celebrate' ? [523.25, 659.25, 783.99, 1046.5]
      : kind === 'wrong' ? [311.13, 261.63] : kind === 'review' ? [587.33, 783.99] : [659.25, 880];
    const start = audio.currentTime + 0.012;
    notes.forEach((frequency, i) => {
      const tone = audio.createOscillator(), gain = audio.createGain();
      tone.type = 'sine'; tone.frequency.value = frequency;
      const at = start + i * (kind === 'wrong' ? 0.12 : 0.105);
      gain.gain.setValueAtTime(0, at);
      gain.gain.linearRampToValueAtTime(0.12 * prefs.volume / 100, at + 0.012);
      gain.gain.exponentialRampToValueAtTime(0.0001, at + 0.18);
      tone.connect(gain); gain.connect(audio.destination);
      tone.start(at); tone.stop(at + 0.21);
      tone.onended = () => { tone.disconnect(); gain.disconnect(); };
    });
    return true;
  } catch { return false; }
}
function motionAllowed() {
  return prefs.effects && !matchMedia('(prefers-reduced-motion:reduce)').matches;
}
function clearEffects() {
  clearTimeout(effectTimer);
  document.querySelectorAll('.feedback-correct,.feedback-wrong,.review-enter').forEach(el =>
    el.classList.remove('feedback-correct', 'feedback-wrong', 'review-enter'));
  $('celebration-layer')?.replaceChildren();
}
function pulse(target, kind) {
  if (!motionAllowed() || !target) return;
  target.classList.remove('feedback-correct', 'feedback-wrong');
  void target.offsetWidth;
  target.classList.add(`feedback-${kind}`);
  setTimeout(() => target.classList.remove(`feedback-${kind}`), 700);
}
function celebrate() {
  if (!motionAllowed()) return;
  const layer = $('celebration-layer');
  layer.replaceChildren(); clearTimeout(effectTimer);
  for (let i = 0; i < 28; i++) {
    const particle = document.createElement('i');
    particle.style.setProperty('--x', `${18 + Math.random() * 64}%`);
    particle.style.setProperty('--drift', `${(Math.random() - 0.5) * 160}px`);
    particle.style.setProperty('--spin', `${Math.random() * 520 - 260}deg`);
    particle.style.setProperty('--delay', `${Math.random() * 0.18}s`);
    particle.style.setProperty('--particle', ['var(--blue)', 'var(--green)', 'var(--amber)', '#79bfff'][i % 4]);
    layer.append(particle);
  }
  effectTimer = setTimeout(() => layer.replaceChildren(), 1600);
}
export function learningFeedback(lesson, result, mode = 'dict') {
  if (activeLesson?.id !== lesson.id || !result || !Number.isFinite(result.score)) return;
  const kind = result.score === 100 ? 'correct' : 'wrong';
  pulse($(mode === 'shadow' ? 'speech-result' : 'dict-result'), kind);
  const complete = lesson.sentences.every(s => lesson.progress[s.id].completed);
  if (complete && !celebrated.has(lesson.id)) {
    celebrated.add(lesson.id); celebrate();
    playFeedbackSound('celebrate');
    notify('Bạn đã hoàn tất bài học. Hẹn gặp lại ở lượt ôn tiếp theo!', 'success');
  } else playFeedbackSound(kind);
}

export function syncExperience(lesson) {
  const changed = previousLesson !== (lesson?.id || '');
  activeLesson = lesson?.kind === 'tts' ? null : lesson;
  if (changed) {
    previousLesson = lesson?.id || ''; previousMode = '';
    if (activeLesson?.sentences.every(s => activeLesson.progress[s.id].completed)) celebrated.add(activeLesson.id);
  }
  if (activeLesson?.settings.experience) {
    const next = sanitizeExperience(activeLesson.settings.experience);
    if (JSON.stringify(next) !== JSON.stringify(prefs)) {
      prefs = next;
      try { localStorage.setItem(KEY, JSON.stringify(prefs)); } catch {}
      apply(); syncForm();
    }
  }
  if (activeLesson?.mode === 'review' && previousMode !== 'review') {
    const id = activeLesson.id;
    requestAnimationFrame(() => {
      if (activeLesson?.id !== id || activeLesson.mode !== 'review') return;
      const pane = $('review-pane');
      if (motionAllowed()) {
        pane.classList.remove('review-enter'); void pane.offsetWidth; pane.classList.add('review-enter');
      }
      playFeedbackSound('review');
    });
  }
  previousMode = activeLesson?.mode || '';
}

export function initExperience(changed) {
  onChange = changed;
  $('theme-toggle').onclick = () => save({theme: effectiveDark() ? 'light' : 'dark'});
  $('show-appearance').onclick = () => { syncForm(); openPanel('appearance-dialog'); };
  $('appearance-theme').onchange = e => save({theme: e.target.value});
  $('appearance-accent').oninput = e => save({accent: e.target.value});
  $('appearance-gradient').oninput = e => save({gradient: Number(e.target.value)});
  $('feedback-sound').onchange = e => save({sound: e.target.checked});
  $('feedback-volume').oninput = e => save({volume: Number(e.target.value)});
  $('feedback-effects').onchange = e => save({effects: e.target.checked});
  $('preview-feedback').onclick = () => playFeedbackSound('celebrate', true);
  $('reset-appearance').onclick = () => save(DEFAULT_EXPERIENCE);
  const scheme = matchMedia('(prefers-color-scheme:dark)');
  scheme.addEventListener?.('change', () => { if (prefs.theme === 'system') apply(); });
  window.addEventListener('storage', event => {
    if (event.key !== KEY) return;
    try { prefs = sanitizeExperience(JSON.parse(event.newValue || '{}')); apply(); syncForm(); } catch {}
  });
  document.addEventListener('pointerdown', unlock, {passive: true});
  document.addEventListener('keydown', unlock, {passive: true});
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) { clearEffects(); audio?.suspend().catch(() => {}); }
  });
  window.addEventListener('pagehide', () => { audio?.close().catch(() => {}); audio = null; });
  syncForm(); apply();
}
