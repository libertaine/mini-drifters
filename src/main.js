// Browser glue: keyboard/controller input, the animation loop and the HUD.
import { TUNING } from './tuning.js';
import { createRecords } from './records.js';
import { Controller, NEUTRAL_DRIVE } from './controller.js';
import { InputArbiter } from './controls.js';
import { createGame, startRun, restartRun, returnToMenu, togglePause, toggleGhost, advance, countedScore } from './game.js';
import { createRenderer, drawFrame, resize, resetEffects } from './render.js';
import { currentMultiplier, angleScore } from './scoring.js';
import { DEFAULT_TRACK_ID, TRACKS, projectOnTrack, trackById } from './track.js';
import { GameAudio } from './audio.js';
import { RADIO_OFF, STATIONS, hasProvisionalMusic, stationById } from './radio-stations.js';
import { createTutorial, updateTutorial, skipStep, tutorialView, tutorialEnding } from './tutorial.js';
import { HANDLING_MODES, handlingById } from './handling.js';
import { readHandlingPreference, writeHandlingPreference } from './handling-preferences.js';
import { padTrack } from './practice-pad.js';

const $ = (id) => document.getElementById(id);
const MPH_PER_MS = 2.23694;
const DEG = 180 / Math.PI;
const BANNER_TIME = 1.9;
const ANGLE_GAUGE_MAX = 90;

// The lesson's prompts and checks were written for Original, so it always drives there.
const LESSON_TRACK_ID = 'original';
// They were also written for Classic's handbrake technique, so it always drives Classic.
const LESSON_HANDLING = handlingById('classic');

// Records are kept per track and handling mode (records.js).
const records = createRecords();
const game = createGame(undefined, { onRunEvent: (event) => {
  records.handle(event);
  showPersonalBests();
} });
// The title's poster is Original's hairpin, whichever circuit is chosen for driving.
const renderer = createRenderer($('view'), game.track, trackById('original'));

// --- Track -----------------------------------------------------------------
// The circuit for the next normal run. It isn't saved, so a new visit starts on Original.
let selectedTrackId = DEFAULT_TRACK_ID;

const trackInputs = TRACKS.map((track) => {
  const label = document.createElement('label');
  label.className = 'track';
  const input = document.createElement('input');
  input.type = 'radio';
  input.name = 'track';
  input.value = track.id;
  const name = document.createElement('span');
  name.textContent = track.name;
  label.append(input, name);
  $('tracks').append(label);
  input.addEventListener('change', () => selectTrack(track.id));
  return input;
});

function selectTrack(id) {
  selectedTrackId = id;
  for (const input of trackInputs) input.checked = input.value === id;
  showPersonalBests();
}

// Left and Right, wrapping. Focus follows only if it was already on the choice.
function stepTrack(direction) {
  const i = TRACKS.findIndex((t) => t.id === selectedTrackId);
  selectTrack(TRACKS[(i + direction + TRACKS.length) % TRACKS.length].id);
  if (trackInputs.includes(document.activeElement)) trackInputs.find((input) => input.checked).focus();
}

// --- Handling ----------------------------------------------------------------
// The mode for the next run, chosen only on the title. Unlike the track it is remembered: a
// first visit starts on Classic, and later visits on the mode last chosen (handling-preferences.js).
// A run takes its mode when it starts and keeps it through restarts and Drive again.
function browserStorage() {
  try { return window.localStorage; } catch { return null; }
}
const preferenceStorage = browserStorage();
const MENU_MODES = HANDLING_MODES;
let selectedHandlingId = readHandlingPreference(preferenceStorage);

const handlingInputs = MENU_MODES.map((mode) => {
  const label = document.createElement('label');
  label.className = 'mode';
  const input = document.createElement('input');
  input.type = 'radio';
  input.name = 'handling';
  input.value = mode.id;
  input.setAttribute('aria-describedby', 'handling-summary');
  const name = document.createElement('span');
  name.textContent = mode.name;
  label.append(input, name);
  $('handlings').append(label);
  input.addEventListener('change', () => selectHandling(mode.id));
  return input;
});

function selectHandling(id, { remember = true } = {}) {
  // A session's mode is fixed: the choice can only change where no session is running.
  if (game.state !== 'menu' || !handlingById(id)) return;
  selectedHandlingId = id;
  // Saved only when the player chooses, never just for loading the page.
  if (remember) writeHandlingPreference(preferenceStorage, id);
  for (const input of handlingInputs) input.checked = input.value === id;
  setText('handling-summary', handlingById(id).summary);
  showPersonalBests();
}

function stepHandling(direction) {
  const i = MENU_MODES.findIndex((m) => m.id === selectedHandlingId);
  selectHandling(MENU_MODES[(i + direction + MENU_MODES.length) % MENU_MODES.length].id);
  if (handlingInputs.includes(document.activeElement)) handlingInputs.find((input) => input.checked).focus();
}

const selectedHandling = () => handlingById(selectedHandlingId);

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
  showRadio(sound);
}

// --- Radio -----------------------------------------------------------------
const stationInputs = STATIONS.map((station) => {
  const label = document.createElement('label');
  label.className = 'station';
  const input = document.createElement('input');
  input.type = 'radio';
  input.name = 'station';
  input.value = station.id;
  const name = document.createElement('span');
  name.textContent = station.name;
  label.append(input, name);
  $('stations').append(label);
  return input;
});

function radioNote(sound, station) {
  if (sound.radio.status === 'unavailable') return 'This station could not load. Select it again to retry. Driving is not affected.';
  if (sound.station === RADIO_OFF) return 'No music. Engine and tire sounds stay on.';
  const provisional = hasProvisionalMusic(station) ? 'Provisional built-in music, which may be replaced later. ' : '';
  return `${provisional}Press N to change station while driving.`;
}

function showRadio(sound) {
  const station = stationById(sound.station);
  const unavailable = sound.radio.status === 'unavailable';
  const status = $('radio-status');
  status.dataset.state = sound.station === RADIO_OFF ? 'off' : unavailable ? 'unavailable' : sound.muted ? 'muted' : 'on';
  setText('radio-status', `${station.name}${unavailable ? ' · Unavailable' : ''}`);
  for (const input of stationInputs) input.checked = input.value === sound.station;
  $('music-volume').value = String(sound.musicVolume);
  setText('music-volume-value', `${sound.musicVolume}%`);
  $('effects-volume').value = String(sound.effectsVolume);
  setText('effects-volume-value', `${sound.effectsVolume}%`);
  setText('radio-note', radioNote(sound, station));
  $('options-muted').hidden = !sound.muted;
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
const controller = new Controller(typeof navigator.getGamepads === 'function' ? () => navigator.getGamepads() : null);
const arbiter = new InputArbiter();
let pageActive = true;
let controllerContext = '';
let instructionDevice = 'keyboard';

function clearInput() {
  for (const key of Object.keys(input)) input[key] = false;
  controller.reset();
  arbiter.reset();
}

// The kind of session is the run's own `game.mode`: 'normal' (a scored circuit run),
// 'tutorial', or 'practice' (the pad: free driving, never scored, timed or saved). The records
// keeper only listens to 'normal'.

function beginRun() {
  doneOpen = false;
  tutorial = null;
  startRun(game, { track: trackById(selectedTrackId), handling: selectedHandling() });
  resetEffects(renderer, game.car);
  clearInput();
  syncScreens();
  audio.newRun(game);
}

// The practice pad: the selected mode on open asphalt. No ghost, no laps, no records.
function beginPractice() {
  doneOpen = false;
  tutorial = null;
  startRun(game, { track: padTrack(), mode: 'practice', ghost: false, handling: selectedHandling() });
  resetEffects(renderer, game.car);
  clearInput();
  syncScreens();
  audio.newRun(game);
}

// Same track, same mode, same kind of session: only the car and the run start over.
function restart() {
  clearInput();
  const kind = tutorial ? 'tutorial' : game.mode;
  restartRun(game, { ghost: kind === 'normal', mode: kind }); // a lesson or the pad leaves no ghost behind
  resetEffects(renderer, game.car);
  syncScreens();
  audio.newRun(game);
}

// --- Tutorial -------------------------------------------------------------
// The lesson is a normal session being watched. Its progress lives here, and not on the game.
let tutorial = null;
let doneOpen = false;
let doneOpenedAt = 0;
const DONE_KEY_GUARD_MS = 500; // the player was just driving, and may still be stabbing at keys

function startTutorial() {
  doneOpen = false;
  tutorial = createTutorial();
  // Always Classic, whichever mode is selected on the title; the selection itself is left alone.
  startRun(game, { ghost: false, track: trackById(LESSON_TRACK_ID), mode: 'tutorial', handling: LESSON_HANDLING });
  resetEffects(renderer, game.car);
  clearInput();
  syncScreens();
  audio.newRun(game);
}

// The single way out of a session: anything running or showing is discarded, and the game
// is back in the state it opens in.
function leaveSession() {
  tutorial = null;
  optionsOpen = false;
  optionsOpener = null;
  helpOpen = false;
  helpOpener = null;
  doneOpen = false;
  returnToMenu(game);
  resetEffects(renderer, game.car);
  clearInput();
  banner.until = 0;
  syncScreens();
  audio.newRun(game);
}

function returnToTitle() {
  leaveSession();
  $('start').focus();
}

function finishTutorial() {
  const ending = tutorialEnding(tutorial);
  leaveSession();
  setText('done-banked', ending.banked > 0 ? `You banked ${formatNumber(ending.banked)} points.` : '');
  setText('done-title', ending.title);
  setText('done-text', ending.text);
  doneOpen = true;
  doneOpenedAt = performance.now();
  syncScreens();
  $('done-start').focus();
}

function skipTutorialStep() {
  if (!tutorial) return;
  skipStep(tutorial);
  if (game.paused) togglePause(game);
  clearInput();
  syncScreens();
  audio.gesture(game);
}

// --- Options --------------------------------------------------------------
let optionsOpen = false;
let optionsOpener = null;

// Options only opens where a sheet is already showing, and the car is never moving there.
const optionsAvailable = () => game.state === 'menu' || game.paused || game.state === 'finished';

function openOptions(opener = null) {
  if (optionsOpen || !optionsAvailable()) return;
  optionsOpen = true;
  optionsOpener = opener;
  clearInput();
  syncScreens();
  (stationInputs.find((input) => input.checked) ?? stationInputs[0]).focus();
}

function closeOptions({ restoreFocus = true } = {}) {
  if (!optionsOpen) return;
  optionsOpen = false;
  syncScreens();
  settleFocus(optionsOpener, restoreFocus);
  optionsOpener = null;
}

function settleFocus(opener, restoreFocus) {
  if (opener && restoreFocus) opener.focus();
  else if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
}

// --- How to play ----------------------------------------------------------
let helpOpen = false;
let helpOpener = null;

function openHelp(opener = null) {
  if (helpOpen || game.state !== 'menu') return;
  helpOpen = true;
  helpOpener = opener;
  clearInput();
  syncScreens();
  $('help-back').focus();
}

function closeHelp({ restoreFocus = true } = {}) {
  if (!helpOpen) return;
  helpOpen = false;
  syncScreens();
  settleFocus(helpOpener, restoreFocus);
  helpOpener = null;
}

// The title's Up/Down stops: the chosen handling mode, then the menu buttons.
function titleStops() {
  const mode = handlingInputs.find((input) => input.checked);
  return [mode, ...document.querySelectorAll('.title-menu button')].filter((el) => el && el.getClientRects().length);
}

// Up and Down walk the title's menu, wrapping at the ends.
function moveMenuFocus(direction) {
  const buttons = titleStops();
  const current = buttons.indexOf(document.activeElement);
  const next = current < 0 ? (direction > 0 ? 0 : buttons.length - 1) : (current + direction + buttons.length) % buttons.length;
  buttons[next].focus();
}

// These keep Enter, and Space when the car isn't being driven, for their own use.
const keepsKeys = (target) => target instanceof Element && target.matches('#sound, .options-open, #how-to-play, #practice, #again, #resume, #restart, .return-title, #tutorial-skip');

// While driving, Space is always the handbrake, even with the Sound button focused.
function buttonOwnsSpace(e) {
  if (game.state === 'menu') return e.target instanceof HTMLButtonElement || trackInputs.includes(e.target) || handlingInputs.includes(e.target);
  return keepsKeys(e.target) && (game.paused || game.state === 'finished');
}

// Browsers let audio start only after the player has done something. This is what lets
// a saved station begin at the first key or click.
function noteInteraction() {
  if (navigator.userActivation?.hasBeenActive !== false) audio.interaction(game);
}
window.addEventListener('pointerdown', noteInteraction, { capture: true });
window.addEventListener('keydown', noteInteraction, { capture: true });

window.addEventListener('keydown', (e) => {
  // With Options open the car isn't being driven, and its controls need their own keys.
  if (optionsOpen) {
    // A pedal still held from driving repeats, and mustn't walk through the stations.
    if (e.repeat && e.target instanceof HTMLInputElement && e.target.type === 'radio') e.preventDefault();
    if (!e.repeat && (e.code === 'Escape' || e.code === 'KeyO')) {
      e.preventDefault();
      closeOptions();
    }
    return;
  }
  // How to Play is only reading, so the game's keys stay out of it too.
  if (helpOpen) {
    // A key held from the button that opened this repeats on Back, and mustn't press it.
    if (e.repeat) e.preventDefault();
    else if (e.code === 'Escape') {
      e.preventDefault();
      closeHelp();
    }
    return;
  }
  // The lesson's last sheet. It appears by itself, so a key meant for the car is ignored.
  if (doneOpen) {
    const tooSoon = performance.now() - doneOpenedAt < DONE_KEY_GUARD_MS;
    if (e.repeat || (tooSoon && (e.code === 'Space' || e.code === 'Enter'))) {
      e.preventDefault();
    } else if (e.code === 'Escape') {
      e.preventDefault();
      returnToTitle();
    }
    return;
  }
  // The lesson and the practice pad have nothing to finish, so Esc leaves them directly.
  if ((tutorial || game.mode === 'practice') && game.state !== 'menu' && !game.paused && e.code === 'Escape' && !e.repeat) {
    e.preventDefault();
    returnToTitle();
    return;
  }
  if (game.state === 'menu' && (e.code === 'ArrowUp' || e.code === 'ArrowDown')) {
    e.preventDefault();
    if (!e.repeat) moveMenuFocus(e.code === 'ArrowDown' ? 1 : -1);
    return;
  }
  if (game.state === 'menu' && (e.code === 'ArrowLeft' || e.code === 'ArrowRight')) {
    e.preventDefault();
    // Left and Right change the track, unless the handling choice has the focus.
    const direction = e.code === 'ArrowRight' ? 1 : -1;
    if (!e.repeat) {
      if (handlingInputs.includes(document.activeElement)) stepHandling(direction);
      else stepTrack(direction);
    }
    return;
  }
  if (game.state === 'menu' && e.code === 'KeyH' && !e.repeat && !(e.ctrlKey || e.metaKey || e.altKey)) {
    stepHandling(e.shiftKey ? -1 : 1);
    return;
  }
  const held = CODE_TO_KEY[e.code];
  if (held) {
    // On the menu, Space may still activate a focused button.
    if (!(e.code === 'Space' && buttonOwnsSpace(e))) e.preventDefault();
    input[held] = true;
    return;
  }
  // A held Enter mustn't press whichever button focus has just landed on.
  if (e.repeat && e.code === 'Enter') e.preventDefault();
  if (e.repeat || e.ctrlKey || e.metaKey || e.altKey) return;
  if (e.code === 'Enter' && keepsKeys(e.target)) {
    // Left to the browser, so Enter presses the focused button.
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
  } else if (e.code === 'KeyG' && game.state !== 'menu' && !tutorial) {
    toggleGhost(game);
    showGhostStatus();
  } else if (e.code === 'KeyN') {
    audio.nextStation(game);
  } else if (e.code === 'KeyO') {
    // Closing goes back to whichever menu button the keyboard was on.
    openOptions(document.activeElement instanceof HTMLButtonElement ? document.activeElement : null);
  }
});

window.addEventListener('keyup', (e) => {
  const held = CODE_TO_KEY[e.code];
  if (!held) return;
  if (optionsOpen || helpOpen || doneOpen) {
    input[held] = false; // and Space stays free to press the focused control
    return;
  }
  // Firefox activates a focused button on keyup, so that needs blocking as well.
  if (!(e.code === 'Space' && buttonOwnsSpace(e))) e.preventDefault();
  input[held] = false;
});

// Keys released while the page lacks focus would otherwise stay "held". The
// clock also stops, because the driver has lost control of the car.
function onFocusLost() {
  pageActive = false;
  clearInput();
  if ((game.state === 'racing' || game.state === 'ready') && !game.paused) {
    togglePause(game);
    syncScreens();
  }
  // Called directly because animation frames stop in a hidden tab.
  audio.setPageActive(false, game);
}
window.addEventListener('blur', onFocusLost);
window.addEventListener('focus', () => {
  pageActive = true;
  controller.reset();
  audio.setPageActive(true, game);
});
document.addEventListener('visibilitychange', () => {
  if (document.hidden) onFocusLost();
  else { pageActive = true; controller.reset(); audio.setPageActive(true, game); }
});
window.addEventListener('pagehide', () => audio.dispose());

window.addEventListener('resize', () => { resize(renderer); fitTitle(); });
$('resume').addEventListener('click', pauseOrResume);
$('restart').addEventListener('click', restart);
$('start').addEventListener('click', beginRun);
$('practice').addEventListener('click', beginPractice);
$('again').addEventListener('click', beginRun);
soundButton.addEventListener('click', (e) => {
  audio.setMuted(!audio.muted && !audio.failure, game);
  // After a mouse click, hand the keyboard straight back to the car.
  if (e.detail > 0) soundButton.blur();
});
for (const button of document.querySelectorAll('.options-open')) {
  // A mouse click leaves nothing focused afterward, so Enter and Space go back to the game.
  button.addEventListener('click', (e) => openOptions(e.detail > 0 ? null : button));
}
$('options-close').addEventListener('click', (e) => closeOptions({ restoreFocus: e.detail === 0 }));
$('how-to-play').addEventListener('click', (e) => openHelp(e.detail > 0 ? null : e.currentTarget));
$('help-back').addEventListener('click', (e) => closeHelp({ restoreFocus: e.detail === 0 }));
$('help-try').addEventListener('click', () => {
  closeHelp({ restoreFocus: false });
  startTutorial();
});
$('tutorial-skip').addEventListener('click', skipTutorialStep);
$('done-start').addEventListener('click', beginRun);
$('done-again').addEventListener('click', startTutorial);
for (const button of document.querySelectorAll('.return-title')) button.addEventListener('click', returnToTitle);
// A click also covers selecting the current station again, to retry one that failed.
for (const input of stationInputs) {
  const select = () => audio.setStation(input.value, game);
  input.addEventListener('change', select);
  input.addEventListener('click', select);
}
$('music-volume').addEventListener('input', (e) => audio.setMusicVolume(Number(e.target.value)));
$('effects-volume').addEventListener('input', (e) => audio.setEffectsVolume(Number(e.target.value)));

// --- Controller ------------------------------------------------------------
function clearControllerFocus() {
  document.querySelectorAll('.controller-focus').forEach((el) => el.classList.remove('controller-focus'));
}
const keyboardInstructions = () => { instructionDevice = 'keyboard'; clearControllerFocus(); };
window.addEventListener('keydown', keyboardInstructions, { capture: true });
window.addEventListener('pointerdown', keyboardInstructions, { capture: true });

function controllerFocus(el) {
  clearControllerFocus();
  el.focus();
  el.classList.add('controller-focus');
  el.scrollIntoView({ block: 'nearest', inline: 'nearest' });
}

function pauseOrResume() {
  togglePause(game);
  clearInput();
  syncScreens();
  audio.gesture(game);
}

function controllerLost() {
  const wasDriving = arbiter.source === 'controller';
  if (wasDriving) clearInput();
  else controller.reset();
  if (wasDriving && !game.paused && (game.state === 'ready' || game.state === 'racing')) {
    togglePause(game);
    syncScreens();
  }
}
window.addEventListener('gamepaddisconnected', (e) => {
  if (controller.disconnect(e.gamepad.index)) controllerLost();
});

function controllerSheet() {
  return optionsOpen ? $('options') : helpOpen ? $('help') : doneOpen ? $('tutorial-done')
    : game.paused ? $('paused') : game.state === 'finished' ? $('results') : game.state === 'menu' ? $('menu') : null;
}

function menuControls(sheet) {
  if (sheet === $('menu')) return [...titleStops(), soundButton].filter((el) => !el.disabled && el.getClientRects().length);
  return [...sheet.querySelectorAll('button, input'), soundButton].filter((el) => !el.disabled && el.getClientRects().length);
}

function controllerMenu(pressed, sheet) {
  if (pressed.back) {
    if (optionsOpen) closeOptions();
    else if (helpOpen) closeHelp();
    else if (doneOpen || game.state === 'finished') returnToTitle();
    else if (game.paused) pauseOrResume();
    const nextSheet = controllerSheet();
    if (nextSheet) {
      const controls = menuControls(nextSheet);
      controllerFocus(controls.includes(document.activeElement) ? document.activeElement : controls[0]);
    }
    return;
  }
  if (pressed.pause && game.paused && !optionsOpen) { pauseOrResume(); return; }
  const controls = menuControls(sheet);
  const current = controls.indexOf(document.activeElement);
  const horizontal = pressed.right ? 1 : pressed.left ? -1 : 0;
  if (horizontal && sheet === $('menu')) {
    // As on the keyboard: the track, unless the handling choice has the focus.
    if (handlingInputs.includes(document.activeElement)) {
      stepHandling(horizontal);
      controllerFocus(handlingInputs.find((input) => input.checked));
    } else stepTrack(horizontal);
    return;
  }
  if (horizontal && document.activeElement instanceof HTMLInputElement) {
    const el = document.activeElement;
    if (el.type === 'range') {
      if (horizontal > 0) el.stepUp(); else el.stepDown();
      el.dispatchEvent(new Event('input', { bubbles: true }));
      controllerFocus(el);
      return;
    }
    if (el.type === 'radio') {
      const radios = controls.filter((c) => c instanceof HTMLInputElement && c.type === 'radio' && c.name === el.name);
      const next = radios[(radios.indexOf(el) + horizontal + radios.length) % radios.length];
      next.click();
      controllerFocus(next);
      return;
    }
  }
  const direction = pressed.down ? 1 : pressed.up ? -1 : horizontal;
  if (direction) {
    const next = current < 0 ? (direction > 0 ? 0 : controls.length - 1) : (current + direction + controls.length) % controls.length;
    controllerFocus(controls[next]);
    return;
  }
  if (pressed.confirm && !(doneOpen && performance.now() - doneOpenedAt < DONE_KEY_GUARD_MS)) {
    const el = controls[current < 0 ? 0 : current];
    controllerFocus(el);
    el.click();
    // Click handlers may have moved focus to a newly opened sheet.
    if (document.activeElement instanceof HTMLElement && document.activeElement !== document.body) controllerFocus(document.activeElement);
  }
}

function pollController() {
  if (!pageActive || document.hidden || !document.hasFocus()) return NEUTRAL_DRIVE;
  const pad = controller.poll();
  if (pad.lost) controllerLost();
  setText('controller-note', pad.unavailable ? 'Controller API unavailable. Keyboard ready.'
    : pad.connected ? 'Controller ready · D-pad move · A select · B back'
      : pad.unsupported ? 'Controller needs a standard browser mapping.' : 'Controller: press a button to connect.');
  if (Object.values(pad.pressed).some(Boolean)) instructionDevice = 'controller';
  const sheet = controllerSheet();
  if (sheet) {
    controllerMenu(pad.pressed, sheet);
    return NEUTRAL_DRIVE;
  }
  if (pad.pressed.pause) { pauseOrResume(); return NEUTRAL_DRIVE; }
  if (pad.pressed.ghost && !tutorial) { toggleGhost(game); showGhostStatus(); }
  if (pad.pressed.radio) audio.nextStation(game);
  return pad.drive;
}

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

// Tab carries on from whatever last had focus, even once that's hidden, and that can be past
// a sheet's buttons in the page. Firefox then has no way back to them. So Tab starts at the top
// of a sheet when it appears, with nothing focused until the player asks.
let tabAnchor = null;

function startTabAt(section) {
  if (section === tabAnchor) return;
  tabAnchor = section;
  if (!section) return;
  section.tabIndex = -1;
  section.focus({ preventScroll: true });
  section.blur();
}

// Condensed poster fonts are not installed everywhere. Keep the existing size
// unless fallback text overflows the available width/height; measure on menu/resize.
function fitTitle() {
  const title = document.querySelector('.title');
  if (!title.clientWidth) return;
  title.style.fontSize = '';
  const ratio = title.clientWidth / title.scrollWidth;
  if (ratio < 1) title.style.fontSize = `${parseFloat(getComputedStyle(title).fontSize) * ratio * 0.98}px`;
  // Wrapped fallback text and a storage-failure note also need vertical room.
  // Reduce only the title, keeping every record, instruction and action visible.
  const panel = title.closest('.title-panel');
  const padding = getComputedStyle(panel);
  const available = Math.min(innerHeight, panel.clientHeight) - parseFloat(padding.paddingTop) - parseFloat(padding.paddingBottom);
  const heading = title.getBoundingClientRect();
  const used = $('controller-note').getBoundingClientRect().bottom - heading.top;
  if (used > available) {
    const scale = Math.max(0.25, (heading.height - (used - available) - 4) / heading.height);
    title.style.fontSize = `${parseFloat(getComputedStyle(title).fontSize) * scale}px`;
  }
}

function syncScreens() {
  const { state, paused } = game;
  const context = optionsOpen ? 'options' : helpOpen ? 'help' : doneOpen ? 'done'
    : paused ? 'paused' : state === 'menu' || state === 'finished' ? state : 'driving';
  if (context !== controllerContext) {
    controllerContext = context;
    clearInput();
  }
  document.body.dataset.screen = state === 'menu' ? 'title' : 'game';
  // The HUD hides laps, score and combo on the pad, and names the mode.
  const practice = state !== 'menu' && !tutorial && game.mode === 'practice';
  document.body.dataset.session = state === 'menu' ? 'none' : tutorial ? 'tutorial' : game.mode;
  setText('handling-status', practice ? `Practice · ${game.handling.name}` : game.handling.name);
  $('handling-status').title = `Handling: ${game.handling.name}. Change it on the title screen.`;
  $('menu').hidden = state !== 'menu' || optionsOpen || helpOpen || doneOpen;
  if (!$('menu').hidden) fitTitle();
  $('help').hidden = !helpOpen;
  $('tutorial-done').hidden = !doneOpen;
  $('tutorial-skip').hidden = !tutorial;
  $('ghost-status').hidden = !!tutorial;
  setText('paused-note', practice
    ? (instructionDevice === 'controller' ? 'Practice pad. Menu to carry on, or Restart to put the car back.' : 'Practice pad. Press P to carry on, or R to put the car back.')
    : instructionDevice === 'controller'
      ? tutorial ? 'Menu to carry on, or Restart at the grid. You keep your place in the lesson.' : 'Menu to carry on, or Restart to start over.'
      : tutorial ? 'Press P to carry on, or R to go back to the grid. You keep your place in the lesson.' : 'Press P to carry on, or R to start over.');
  // The HUD stops updating on the menu, so nothing of it may be left showing.
  if (state === 'menu') {
    $('prompt').hidden = true;
    $('prompt').replaceChildren();
    $('banner').hidden = true;
  }
  $('hud').hidden = state === 'menu';
  $('paused').hidden = !paused || optionsOpen;
  const finished = state === 'finished';
  $('results').hidden = !finished || optionsOpen;
  $('options').hidden = !optionsOpen;
  if (finished) showResults();
  if (document.activeElement instanceof HTMLElement && state !== 'menu' && !finished && !optionsOpen) document.activeElement.blur();
  startTabAt(optionsOpen ? null : paused ? $('paused') : finished ? $('results') : null);
}

// The title shows one partition: the selected track with the selected mode.
function showPersonalBests() {
  const best = records.forTrack(selectedTrackId, selectedHandlingId);
  setText('records-heading', `${trackById(selectedTrackId).name} · ${selectedHandling().name} — Personal bests`);
  setText('pb-score', best.score === null ? '--' : formatNumber(best.score));
  setText('pb-lap', formatTime(best.fastestLap));
  setText('pb-combo', best.bestCombo === null ? '--' : formatNumber(best.bestCombo));
  const note = !records.available ? 'Record storage unavailable. New improvements cannot be saved.'
    : records.readOnly ? 'Records were saved by a newer version of Mini Drifters. They are kept, but cannot be updated here.' : '';
  setText('records-note', note);
  setText('results-records-note', note);
}

function showResults() {
  const r = game.results;
  setText('r-score', formatNumber(r.score));
  setText('r-best', formatTime(r.bestLap));
  setText('r-time', formatTime(r.runTime));
  setText('r-combo', r.bestCombo ? `${formatNumber(r.bestCombo)} (×${r.bestMultiplier})` : 'None');
  setText('r-spins', String(r.spinouts));
  setText('remark', r.remark);
  setText('r-mode', `${game.track.name} · ${game.handling.name} handling`);
  const voided = r.voidedLaps > 0;
  $('r-void').hidden = !voided;
  if (voided) {
    const laps = r.voidedLaps === 1 ? '1 lap' : `${r.voidedLaps} laps`;
    setText('r-void', `${laps} not counted: ${formatNumber(r.forfeited)} points left out of the score.`);
  }
  const best = records.newBests;
  $('new-score').hidden = !best.score;
  $('new-lap').hidden = !best.fastestLap;
  $('new-combo').hidden = !best.bestCombo;
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
      const lost = game.lastForfeit;
      showBanner('void', lost > 0 ? `LAP NOT COUNTED — ${formatNumber(lost)} POINTS LOST` : 'LAP NOT COUNTED — CHECKPOINT MISSED', now);
    }
  }
  if (now >= banner.until) $('banner').hidden = true;
}

let shownLesson = '';

function showLesson(el) {
  const view = tutorialView(tutorial, instructionDevice);
  const help = instructionDevice === 'controller'
    ? 'Menu pause · Restart / Skip / Exit in pause menu'
    : view.stuck ? 'Stuck? Press P, and you can skip this step from there.' : 'R back to the grid · P pause · Esc exit';
  el.hidden = game.paused;
  el.dataset.kind = 'tutorial';
  const lesson = [`Step ${view.number} of ${view.total}`, view.title, view.text, view.hint, help];
  const key = lesson.join('|');
  if (key === shownLesson && el.childElementCount) return;
  shownLesson = key;
  const line = (className, text) => {
    const part = document.createElement('span');
    part.className = className;
    part.textContent = text;
    return part;
  };
  el.replaceChildren(
    line('lesson-step', lesson[0]),
    line('lesson-title', lesson[1]),
    line('lesson-text', lesson[2]),
    ...(view.hint ? [line('lesson-hint', view.hint)] : []),
    line('lesson-keys', help),
  );
}

function updatePrompt() {
  const el = $('prompt');
  if (tutorial) {
    showLesson(el);
    return;
  }
  let text = '';
  let kind = '';
  // The pad has no direction, laps or clock, so it has no warnings either: only a hint at the start.
  if (game.mode === 'practice') {
    if (game.state === 'ready') {
      text = instructionDevice === 'controller'
        ? `Practice pad · ${game.handling.name}. Free driving: nothing is timed or saved. Menu to pause or leave.`
        : `Practice pad · ${game.handling.name}. Free driving: nothing is timed or saved. R puts the car back · P pause · Esc title`;
    }
    el.hidden = !text;
    if (text) { setText('prompt', text); el.dataset.kind = ''; }
    return;
  }
  if (game.state === 'ready') {
    text = instructionDevice === 'controller' ? 'Press RT to go. The clock starts when you move.' : 'Press ↑ to go. The clock starts when you move.';
  } else if (game.state === 'racing') {
    if (game.wrongWayTime > 1.2) {
      text = 'WRONG WAY';
      kind = 'warn';
    } else if (!game.laps.valid) {
      text = 'Checkpoint missed. This lap and its points will not count.';
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
  setText('score', formatNumber(countedScore(game)));
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
    ['handling', `${game.handling.id} (${game.mode})`],
    ['wheelspin', car.wheelspin === undefined ? 'n/a' : car.wheelspin.toFixed(2)],
    ['traction', car.traction.toFixed(2)],
    ['surface', car.surface],
    ['drift', scoring.qualification],
    ['angle score', angleScore(Math.abs(car.slipAngle)).toFixed(2)],
    ['progress', `${game.progressRate.toFixed(1)} m/s`],
    ['new ground', `${game.credited.toFixed(0)} m`],
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
  const padDrive = pollController();
  const drivingInput = arbiter.resolve(input, padDrive);
  if (arbiter.source === 'controller') instructionDevice = 'controller';
  else if (Object.values(input).some(Boolean)) instructionDevice = 'keyboard';
  advance(game, dt, drivingInput);
  if (tutorial) {
    updateTutorial(tutorial, game);
    if (tutorial.phase === 'complete') finishTutorial();
    else if (game.state === 'finished') restart(); // three laps mustn't end a lesson with no time limit
  }
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

selectTrack(selectedTrackId);
selectHandling(selectedHandlingId, { remember: false });
syncScreens();
showGhostStatus();
showSound(audio.snapshot());
$('start').focus();
// A small read-only hook for the browser checks and tuning from the console.
window.__miniDrifters = { game, input, projectOnTrack, selectedTrack: () => selectedTrackId,
  selectedHandling: () => selectedHandlingId, sessionKind: () => game.mode, drawnTrack: () => renderer.track.id, audio: () => audio.snapshot(), tutorial: () => tutorial && structuredClone(tutorial) };
requestAnimationFrame(frame);
