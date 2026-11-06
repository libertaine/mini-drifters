import { AudioLab } from './audio.js';
import { DEFAULTS, PRESETS, mapAudio } from './model.js';

const $ = (id) => document.getElementById(id);
const controls = [
  ['rpm', 'Engine speed', 750, 7000, 25, 'rpm'],
  ['throttle', 'Throttle', 0, 1, 0.01, '%'],
  ['speed', 'Vehicle speed', 0, 120, 1, 'mph'],
  ['slip', 'Tire slip', 0, 90, 1, '°'],
  ['grip', 'Rear grip', 0.15, 1, 0.01, '%'],
  ['engineVolume', 'Engine volume', 0, 1, 0.01, '%'],
  ['tireVolume', 'Tire volume', 0, 1, 0.01, '%'],
  ['masterVolume', 'Master volume', 0, 1, 0.01, '%'],
];
const lab = new AudioLab({ onChange: renderStatus });

for (const [id, title, min, max, step, unit] of controls) {
  const wrapper = document.createElement('div'); wrapper.className = 'control';
  const label = document.createElement('label'); label.htmlFor = id; label.textContent = title;
  const output = document.createElement('output'); output.id = `${id}-value`; output.htmlFor = id;
  label.append(output);
  const slider = document.createElement('input');
  Object.assign(slider, { type: 'range', id, min, max, step, value: DEFAULTS[id] });
  wrapper.append(label, slider);
  $(id.endsWith('Volume') ? 'mix-controls' : 'driving-controls').append(wrapper);
  slider.addEventListener('input', () => {
    lab.set({ [id]: Number(slider.value) });
    clearPreset(); renderControls();
  });
  slider.dataset.unit = unit;
}

function clearPreset() {
  for (const button of $('presets').children) button.setAttribute('aria-pressed', 'false');
}
for (const preset of PRESETS) {
  const button = document.createElement('button');
  button.type = 'button'; button.textContent = preset.name; button.setAttribute('aria-pressed', 'false');
  button.addEventListener('click', () => {
    lab.set(preset.values); clearPreset(); button.setAttribute('aria-pressed', 'true'); renderControls();
  });
  $('presets').append(button);
}

function renderControls() {
  for (const [id, , , , , unit] of controls) {
    const value = lab.values[id];
    $(id).value = value;
    const text = unit === '%' ? `${Math.round(value * 100)}%` : `${Math.round(value)}${unit === '°' ? '' : ' '}${unit}`;
    $(`${id}-value`).textContent = text;
    $(id).setAttribute('aria-valuetext', text);
  }
  $('mode').value = lab.values.mode; $('surface').value = lab.values.surface;
  const p = mapAudio(lab.values);
  $('pulse').textContent = `${Math.round(p.firingHz)} Hz`;
  $('tire-meter').value = p.tireIntensity;
  $('tire-level').textContent = `${Math.round(p.tireIntensity * 100)}%`;
  $('mode-note').textContent = lab.values.mode === 'procedural'
    ? 'A · Four engine layers, intake noise, exhaust filtering and idle flutter. Filtered tire noise gains a tonal squeal as slip grows.'
    : 'B · Two recorded engine loops blend with RPM. Playback rate, load filtering and a looped tire-foley excerpt follow the same dials.';
}

function renderStatus(state) {
  $('status').textContent = state.message;
  $('mute').setAttribute('aria-pressed', String(state.muted));
  $('mute').textContent = state.muted ? 'Unmute' : 'Mute';
  const messages = {
    'not loaded': 'Recorded samples load when audio starts.',
    loading: 'Loading recorded samples… Sample mode stays silent until recordings are ready.',
    ready: '3/3 recordings ready. Both modes are available.',
    partial: 'Some recordings are unavailable. Missing layers stay silent; the remaining engine layer covers the RPM range.',
    unavailable: 'Recordings unavailable. Sample mode is silent. Procedural mode is available; stop and start to retry.',
  };
  $('sample-status').textContent = [messages[state.sampleState], ...state.failures].join(' ');
}

$('mode').addEventListener('change', () => { lab.set({ mode: $('mode').value }); renderControls(); });
$('surface').addEventListener('change', () => { lab.set({ surface: $('surface').value }); clearPreset(); renderControls(); });
$('start').addEventListener('click', () => {
  if (document.hidden) return;
  try {
    lab.start().catch(() => {}); // Controller reports asynchronous resume errors.
  } catch (error) {
    lab.stop(`Audio unavailable: ${error.message}`);
  }
});
$('stop').addEventListener('click', () => lab.stop());
$('mute').addEventListener('click', () => lab.mute(!lab.muted));
document.addEventListener('visibilitychange', () => {
  if (document.hidden) lab.stop('Stopped while this page was hidden. Press Start Audio to resume.');
});
window.addEventListener('pagehide', () => lab.stop());
// Read-only diagnostic snapshots for browser checks and the listening bench.
window.__audioLab = Object.freeze({ snapshot: () => lab.snapshot() });
renderControls(); lab.notify();
