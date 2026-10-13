// Shared, DOM-free validation for local preferences and imported lesson files.
export const DEFAULT_EXPERIENCE = Object.freeze({
  theme: 'light', accent: '#3458ff', gradient: 18,
  sound: true, volume: 25, effects: true,
});

export function sanitizeExperience(value = {}) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) value = {};
  const number = (key, lo, hi) => typeof value[key] === 'number' && Number.isFinite(value[key])
    ? Math.round(Math.max(lo, Math.min(hi, value[key]))) : DEFAULT_EXPERIENCE[key];
  return {
    theme: ['light', 'dark', 'system'].includes(value.theme) ? value.theme : 'light',
    accent: typeof value.accent === 'string' && /^#[0-9a-f]{6}$/i.test(value.accent)
      ? value.accent.toLowerCase() : DEFAULT_EXPERIENCE.accent,
    gradient: number('gradient', 0, 40),
    sound: typeof value.sound === 'boolean' ? value.sound : true,
    volume: number('volume', 0, 100),
    effects: typeof value.effects === 'boolean' ? value.effects : true,
  };
}

const rgb = hex => [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16));
export function mixColor(color, base, fraction) {
  const a = rgb(color), b = rgb(base);
  return '#' + a.map((v, i) => Math.round(v * fraction + b[i] * (1 - fraction)).toString(16).padStart(2, '0')).join('');
}
function luminance(hex) {
  const c = rgb(hex).map(v => v / 255).map(v => v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
  return c[0] * 0.2126 + c[1] * 0.7152 + c[2] * 0.0722;
}
export function contrastRatio(a, b) {
  const values = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (values[0] + 0.05) / (values[1] + 0.05);
}
export function palette(value, dark = false) {
  const prefs = sanitizeExperience(value);
  const surface = dark ? '#141f34' : '#ffffff';
  const page = dark ? '#0c1424' : '#f9fbff';
  let accent = prefs.accent;
  const blend = dark ? '#ffffff' : '#000000';
  for (let i = 1; contrastRatio(accent, surface) < 4.5 && i <= 30; i++)
    accent = mixColor(prefs.accent, blend, 1 - i / 30);
  const onAccent = !dark || contrastRatio(accent, '#ffffff') >= contrastRatio(accent, '#07101f') ? '#ffffff' : '#07101f';
  return {
    '--blue': accent, '--hover': mixColor(accent, blend, 0.86), '--on-accent': onAccent,
    '--ink': dark ? '#e6edf8' : '#16213e', '--muted': dark ? '#a7b7d2' : '#66758f',
    '--surface': surface, '--page-base': page, '--line': dark ? '#2c3c56' : '#e5ebf8',
    '--soft': mixColor(accent, surface, dark ? 0.10 : 0.04),
    '--accent-soft': mixColor(accent, surface, dark ? 0.16 : 0.08),
    '--accent-line': mixColor(accent, surface, dark ? 0.45 : 0.22),
    '--wash-a': mixColor(prefs.accent, page, prefs.gradient / 100),
    '--wash-b': mixColor('#43b1ff', page, prefs.gradient / 180),
    '--green': dark ? '#64d3a1' : '#15865b', '--green-soft': dark ? '#183c33' : '#e9f8f0',
    '--red': dark ? '#ff9aab' : '#c83e50', '--red-soft': dark ? '#422532' : '#fff0f3',
    '--amber': dark ? '#f2cd8b' : '#8e692c', '--amber-soft': dark ? '#382f22' : '#fff8eb',
  };
}
