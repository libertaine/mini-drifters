// Browser glue: keyboard, the animation loop and the HUD.
import { TUNING } from './tuning.js';
import { createGame, startRun, restartRun, togglePause, toggleGhost, advance } from './game.js';
import { createRenderer, drawFrame, resize, resetEffects } from './render.js';
import { currentMultiplier, angleScore } from './scoring.js';
import { projectOnTrack } from './track.js';
import { GameAudio } from './audio.js';

const $ = (id) => document.getElementById(id);
const MPH_PER_MS = 2.23694;
const DEG = 180 / Math.PI;
const BANNER_TIME = 1.9;
const ANGLE_GAUGE_MAX = 90;

const game = createGame();
const renderer = createRenderer($('view'), game.track);

// --- Sound -----------------------------------------------------------------
const soundButton = $('sound');
const audio = new GameAudio({
  // The published page carries this tag. Without it, the game uses the synthesized engine.
  coyoteEnabled: !!document.querySelector('meta[name="mini-drifters-engine"][content="coyote-local"]'),
  isHidden: () => document.hidden,
  onChange: showSound,
});

function showSound(sound) {
  setText('sound', sound.label);
  soundButton.dataset.engine = sound.engine;
  soundButton.title = sound.failure ? `${sound.failure}. Click to try again.`
    : sound.engine === 'coyote' ? 'Engine: Coyote Hybrid (recorded)'
      : sound.engine === 'fallback' ? 'Engine: synthesized fallback (not a recording)' : '';
}

// --- Input -----------------------------------------------------------------
const CODE_TO_KEY = {
  ArrowUp: 'up',
  ArrowDown: 'down',
  ArrowLeft: 'left',
  ArrowRight: 'right',
  Space: 'handbrake',
};
const input = { up: false, down: false, left: false, right: false, handbrake: false };
let debug = false;

function clearInput() {
  for (const key of Object.keys(input)) input[key] = false;
}

function beginRun() {
  startRun(game);
  resetEffects(renderer, game.car);
  clearInput();
  syncScreens();
  audio.newRun(game);
}

function restart() {
  restartRun(game);
  resetEffects(renderer, game.car);
  syncScreens();
  audio.newRun(game);
}

// While driving, Space is always the handbrake, even with the Sound button focused.
function buttonOwnsSpace(e) {
  if (game.state === 'menu') return e.target instanceof HTMLButtonElement;
  return e.target === soundButton && (game.paused || game.state === 'finished');
}

window.addEventListener('keydown', (e) => {
  const held = CODE_TO_KEY[e.code];
  if (held) {
    // On the menu, Space may still activate a focused button.
    if (!(e.code === 'Space' && buttonOwnsSpace(e))) e.preventDefault();
    input[held] = true;
    return;
  }
  if (e.repeat || e.ctrlKey || e.metaKey || e.altKey) return;
  if (e.code === 'Enter' && e.target === soundButton) {
    // Left to the browser, so Enter toggles the focused Sound button.
  } else if (e.code === 'Enter' && (game.state === 'menu' || game.state === 'finished')) {
    e.preventDefault();
    beginRun();
  } else if (e.code === 'KeyR' && game.state !== 'menu') {
    restart();
  } else if (e.code === 'KeyP') {
    togglePause(game);
    clearInput();
    syncScreens();
    audio.gesture(game);
  } else if (e.code === 'KeyD') {
    debug = !debug;
    $('debug').hidden = !debug;
  } else if (e.code === 'KeyG' && game.state !== 'menu') {
    toggleGhost(game);
    showGhostStatus();
  }
});

window.addEventListener('keyup', (e) => {
  const held = CODE_TO_KEY[e.code];
  if (!held) return;
  // Firefox activates a focused button on keyup, so that needs blocking as well.
  if (!(e.code === 'Space' && buttonOwnsSpace(e))) e.preventDefault();
  input[held] = false;
});

// Keys released while the page lacks focus would otherwise stay "held". The
// clock also stops, because the driver has lost control of the car.
function onFocusLost() {
  clearInput();
  if ((game.state === 'racing' || game.state === 'ready') && !game.paused) {
    togglePause(game);
    syncScreens();
  }
  // Called directly because animation frames stop in a hidden tab.
  audio.setPageActive(false, game);
}
window.addEventListener('blur', onFocusLost);
window.addEventListener('focus', () => audio.setPageActive(true, game));
document.addEventListener('visibilitychange', () => {
  if (document.hidden) onFocusLost();
  else audio.setPageActive(true, game);
});
window.addEventListener('pagehide', () => audio.dispose());

window.addEventListener('resize', () => resize(renderer));
$('start').addEventListener('click', beginRun);
$('again').addEventListener('click', beginRun);
soundButton.addEventListener('click', (e) => {
  audio.setMuted(!audio.muted && !audio.failure, game);
  // After a mouse click, hand the keyboard straight back to the car.
  if (e.detail > 0) soundButton.blur();
});

// --- HUD -------------------------------------------------------------------
function formatTime(seconds) {
  if (seconds === null || seconds === undefined) return '--';
  const minutes = Math.floor(seconds / 60);
  const rest = seconds - minutes * 60;
  return `${minutes}:${rest.toFixed(2).padStart(5, '0')}`;
}

const formatNumber = (n) => Math.round(n).toLocaleString('en-US');

function setText(id, text) {
  const el = $(id);
  if (el.textContent !== text) el.textContent = text;
}

function showGhostStatus() {
  const el = $('ghost-status');
  el.dataset.state = game.ghostVisible ? 'on' : 'off';
  setText('ghost-status', game.ghostVisible ? 'Ghost On' : 'Ghost Off');
}

function syncScreens() {
  const { state, paused } = game;
  $('menu').hidden = state !== 'menu';
  $('hud').hidden = state === 'menu';
  $('paused').hidden = !paused;
  const finished = state === 'finished';
  $('results').hidden = !finished;
  if (finished) showResults();
  if (document.activeElement instanceof HTMLElement && state !== 'menu' && !finished) document.activeElement.blur();
}

function showResults() {
  const r = game.results;
  setText('r-score', formatNumber(r.score));
  setText('r-best', formatTime(r.bestLap));
  setText('r-time', formatTime(r.runTime));
  setText('r-combo', r.bestCombo ? `${formatNumber(r.bestCombo)} (×${r.bestMultiplier})` : 'None');
  setText('r-spins', String(r.spinouts));
  setText('remark', r.remark);
}

const banner = { until: 0, serialCombo: 0, serialLap: 0 };
let currentRunId = -1;

function showBanner(kind, text, now) {
  const el = $('banner');
  el.dataset.kind = kind;
  el.textContent = text;
  el.hidden = false;
  banner.until = now + BANNER_TIME;
}

function updateBanners(now) {
  const { scoring, laps } = game;
  if (currentRunId !== game.runId) {
    currentRunId = game.runId;
    banner.serialCombo = scoring.eventSerial;
    banner.serialLap = game.lapEventSerial;
    banner.until = 0;
  }
  if (scoring.eventSerial !== banner.serialCombo) {
    banner.serialCombo = scoring.eventSerial;
    const e = scoring.event;
    if (e.type === 'banked') showBanner('banked', `+${formatNumber(e.points)} BANKED`, now);
    else showBanner('lost', `${formatNumber(e.points)} LOST — ${e.reason.toUpperCase()}`, now);
  }
  if (game.lapEventSerial !== banner.serialLap) {
    banner.serialLap = game.lapEventSerial;
    if (game.lapEvent === 'lap') {
      const best = laps.lastLap === laps.bestLap && laps.completed > 1;
      showBanner('lap', `LAP ${formatTime(laps.lastLap)}${best ? ' — BEST' : ''}`, now);
    } else {
      showBanner('void', 'LAP NOT COUNTED — CHECKPOINT MISSED', now);
    }
  }
  if (now >= banner.until) $('banner').hidden = true;
}

function updatePrompt() {
  const el = $('prompt');
  let text = '';
  let kind = '';
  if (game.state === 'ready') {
    text = 'Press ↑ to go. The clock starts when you move.';
  } else if (game.state === 'racing') {
    if (game.wrongWayTime > 1.2) {
      text = 'WRONG WAY';
      kind = 'warn';
    } else if (!game.laps.valid) {
      text = 'Checkpoint missed. This lap will not count.';
      kind = 'warn';
    }
  }
  el.hidden = !text;
  if (text) {
    setText('prompt', text);
    el.dataset.kind = kind;
  }
}

function updateHud(now) {
  const { car, laps, scoring } = game;
  const T = TUNING;
  setText('lap', `${Math.min(laps.completed + 1, T.runLaps)}/${T.runLaps}`);
  setText('lap-time', formatTime(laps.lapTime));
  setText('best-lap', formatTime(laps.bestLap));
  setText('score', formatNumber(scoring.score));
  setText('speed', String(Math.round(car.speed * MPH_PER_MS)));

  const shownSlip = car.speed > 3 && car.forwardSpeed > 0 ? Math.abs(car.slipAngle) * DEG : 0;
  setText('angle', `${Math.round(shownSlip)}°`);
  $('angle-needle').style.left = `calc(${Math.min(100, shownSlip / ANGLE_GAUGE_MAX * 100)}% - 1px)`;

  const comboEl = $('combo');
  const { combo } = scoring;
  comboEl.dataset.state = combo ? 'active' : 'idle';
  if (combo) {
    setText('combo-points', formatNumber(combo.points));
    setText('combo-mult', `×${currentMultiplier(combo)}`);
    $('combo-grace-bar').style.transform = `scaleX(${Math.max(0, combo.grace / T.comboGrace)})`;
  }
  updateBanners(now);
  updatePrompt();
  if (debug) updateDebug();
}

function updateDebug() {
  const { car, scoring, laps, track, trackInfo } = game;
  const T = TUNING;
  const rows = [
    ['state', `${game.state}${game.paused ? ' (paused)' : ''}`],
    ['forward', `${car.forwardSpeed.toFixed(1)} m/s`],
    ['lateral', `${car.lateralSpeed.toFixed(1)} m/s`],
    ['speed', `${car.speed.toFixed(1)} m/s`],
    ['slip', `${(car.slipAngle * DEG).toFixed(1)}°`],
    ['front slip', `${(car.frontSlip * DEG).toFixed(1)}°`],
    ['rear slip', `${(car.rearSlip * DEG).toFixed(1)}°`],
    ['yaw rate', `${(car.yawRate * DEG).toFixed(0)}°/s`],
    ['steer', car.steer.toFixed(2)],
    ['wheel', `${(car.wheelAngle * DEG).toFixed(1)}°`],
    ['throttle', car.throttle.toFixed(2)],
    ['brake', car.brake.toFixed(2)],
    ['handbrake', car.handbrake ? 'ON' : 'off'],
    ['rear grip', car.rearGrip.toFixed(2)],
    ['traction', car.traction.toFixed(2)],
    ['surface', car.surface],
    ['drift', scoring.qualification],
    ['angle score', angleScore(Math.abs(car.slipAngle)).toFixed(2)],
    ['progress', `${game.progressRate.toFixed(1)} m/s`],
    ['new ground', `${game.furthest.toFixed(0)} m`],
    ['track', `s=${trackInfo.s.toFixed(0)} off=${trackInfo.offset.toFixed(1)}`],
    ['checkpoint', `${laps.next}/${track.gates.length}${laps.valid ? '' : ' VOID'}`],
    ['step', `${(T.simStep * 1000).toFixed(1)} ms`],
  ];
  setText('debug', rows.map(([k, v]) => `${k.padEnd(12)}${v}`).join('\n'));
}

// --- Loop ------------------------------------------------------------------
let last = performance.now();
let shownState = game.state;
function frame(now) {
  const dt = Math.max(0, (now - last) / 1000);
  last = now;
  advance(game, dt, input);
  if (game.state !== shownState) {
    shownState = game.state;
    syncScreens();
  }
  audio.update(game, dt);
  const alpha = Math.min(1, game.accumulator / TUNING.simStep);
  drawFrame(renderer, game, alpha, dt, debug);
  if (game.state !== 'menu') updateHud(now / 1000);
  requestAnimationFrame(frame);
}

syncScreens();
showGhostStatus();
showSound(audio.snapshot());
// A small read-only hook for the browser checks and tuning from the console.
window.__miniDrifters = { game, input, projectOnTrack, audio: () => audio.snapshot() };
requestAnimationFrame(frame);
