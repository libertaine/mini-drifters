// Browser glue: keyboard/controller input, the animation loop and the HUD.
import { TUNING } from './tuning.js';
import { createRecords } from './records.js';
import { Controller, NEUTRAL_DRIVE } from './controller.js';
import { InputArbiter, drivingActive } from './controls.js';
import { createGame, startRun, restartRun, returnToMenu, togglePause, toggleGhost, advance, countedScore } from './game.js';
import { createRenderer, drawFrame, effectsSnapshot, resize, resetEffects } from './render.js';
import { currentMultiplier, angleScore } from './scoring.js';
import { DEFAULT_TRACK_ID, TRACKS, projectOnTrack, trackById } from './track.js';
import { GameAudio } from './audio.js';
import { RADIO_OFF, STATIONS, hasProvisionalMusic, stationById } from './radio-stations.js';
import { createTutorial, updateTutorial, skipStep, tutorialView, tutorialEnding } from './tutorial.js';
import { HANDLING_MODES, handlingById } from './handling.js';
import { readHandlingPreference, writeHandlingPreference } from './handling-preferences.js';
import { padTrack } from './practice-pad.js';
import { createGymkhanaRecords } from './gymkhana-records.js';
import { createGymkhanaUi, hideBust } from './gymkhana-ui.js';
import { GYMKHANA_CHALLENGES } from './gymkhana.js';
import { medalFor } from './medals.js';
import { GETAWAY_SHEET } from './getaway-missions.js';
import { createGetawayRecords } from './getaway-records.js';
import { createDriverRecords } from './getaway-driver-records.js';
import { createGhostStore } from './ghost-store.js';
import { createReferenceGhosts, slotState } from './reference-ghost.js';
import { readGhostPreference, writeGhostPreference } from './ghost-preferences.js';
import { categoryOf } from './analytics.js';
import { startAnalytics } from './analytics-tracker.js';
import { createTour, recordRound, useRestart, leaveRound, retireTour, standings, jokerAllowed, tourOutcome } from './tour.js';
import { createTourStore, bestsKey } from './tour-store.js';
import { createTourUi } from './tour-ui.js';

const $ = (id) => document.getElementById(id);
const MPH_PER_MS = 2.23694;
const DEG = 180 / Math.PI;
const BANNER_TIME = 1.9;
const ANGLE_GAUGE_MAX = 90;

// The lesson's prompts and checks were written for Original, so it always drives there.
const LESSON_TRACK_ID = 'original';
// They were also written for Classic's handbrake technique, so it always drives Classic.
const LESSON_HANDLING = handlingById('classic');

// Records are kept per track and handling mode (records.js). The gymkhana challenges keep
// their own, per challenge and handling mode, under their own key (gymkhana-records.js), and
// Getaway its own, per mission, environment and handling mode (getaway-records.js).
const records = createRecords();
const gymkhanaRecords = createGymkhanaRecords();
const getawayRecords = createGetawayRecords();
// Getaway Driver keeps no bests: only how often each way home was reached, under its own key
// (getaway-driver-records.js).
const driverRecords = createDriverRecords();
// The saved reference ghost keeps one flying lap per track and mode under its own key
// (ghost-store.js). It hears each event after the records, so it can tell whether a lap has
// just set the fastest-lap record (reference-ghost.js).
const referenceGhosts = createReferenceGhosts({ store: createGhostStore(),
  bestLapFor: (trackId, handlingId) => records.forTrack(trackId, handlingId).fastestLap });
// Anonymous counts, on the published page only: null everywhere else (docs/ANALYTICS.md). An
// observer that hears the run events last and the frame loop after the simulation, and changes nothing.
const analytics = startAnalytics(window);
const analyticsCategory = () => categoryOf({ mode: game.mode, layout: game.challengeDef?.layout });
const game = createGame(undefined, { onRunEvent: (event) => {
  records.handle(event);
  gymkhanaRecords.handle(event);
  getawayRecords.handle(event);
  referenceGhosts.handle(event);
  driverRecords.handle(event, event.type === 'challenge' ? game.challenge?.result?.outcome ?? null : null);
  tourRunEvent(event); // after the records, so a Tour round knows whether it set a new best
  if (event.type === 'start' || event.type === 'ghost') showReference();
  showPersonalBests();
  analytics?.runEvent(event, { lap: game.laps.completed, category: analyticsCategory() });
} });
// The title's poster is Original's hairpin, whichever circuit is chosen for driving.
const renderer = createRenderer($('view'), game.track, trackById('original'));

// --- Track -----------------------------------------------------------------
// The circuit for the next normal run. It isn't saved, so a new visit starts on Original.
let selectedTrackId = DEFAULT_TRACK_ID;

const TRACK_DETAILS = Object.freeze({
  original: {
    tag: 'Club',
    venue: 'Grassroots Club Circuit',
    accent: '#cf4a1b',
    blurb: 'Grassroots club circuit · Fast sweepers, long bends and a tight hairpin.',
  },
  switchback: {
    tag: 'Hillside',
    venue: 'Wooded Hillside Pass',
    accent: '#52a85a',
    blurb: 'Hillside pass · Linked S-bends climbing into a tight hillside right.',
  },
  dockyard: {
    tag: 'Harbor',
    venue: 'Industrial Port Apron',
    accent: '#d4b13b',
    blurb: 'Harbor concrete apron · Technical Hook, chicane and sweeping Basin.',
  },
  'runway-27': {
    tag: 'Airfield',
    venue: 'Abandoned Airfield',
    accent: '#e2642a',
    blurb: 'Abandoned airfield · Wide sweeping bends and fast tarmac chutes that reward high-speed slides.',
  },
  'redline-mesa': {
    tag: 'Desert',
    venue: 'Desert Proving Ground',
    accent: '#cc5e38',
    blurb: 'Desert proving ground · Three wide opposing drift hairpins paired with a flowing canyon-rim return.',
  },
  'headland-run': {
    tag: 'Coastal',
    venue: 'Seaside Coastal Cliff',
    accent: '#2e87b8',
    blurb: 'Seaside coastal cliff · Fast cliff sweeper, deep marina cove and opening-radius lighthouse carousel.',
  },
  'nightshift-viaduct': {
    tag: 'Night',
    venue: 'Midnight Expressway',
    accent: '#f0b330',
    blurb: 'Midnight expressway · Headlights and sodium lamps light a 205° cloverleaf into a sweeping freight yard.',
  },
});

function trackSvgGeometry(track, width, height, pad, stride = 4) {
  const { points, start } = track;
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (const p of points) {
    if (p.x < minX) minX = p.x;
    if (p.x > maxX) maxX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.y > maxY) maxY = p.y;
  }
  const w = width - pad * 2;
  const h = height - pad * 2;
  const scale = Math.min(w / Math.max(1, maxX - minX), h / Math.max(1, maxY - minY));
  const ox = (width - (maxX - minX) * scale) / 2;
  const oy = (height - (maxY - minY) * scale) / 2;
  const sx = (x) => (ox + (x - minX) * scale).toFixed(1);
  const sy = (y) => (oy + (y - minY) * scale).toFixed(1);
  const parts = [];
  for (let i = 0; i < points.length; i += stride) {
    parts.push(`${i === 0 ? 'M' : 'L'}${sx(points[i].x)} ${sy(points[i].y)}`);
  }
  parts.push('Z');
  return { d: parts.join(' '), cx: sx(start.x), cy: sy(start.y) };
}

const SVG_NS = $('track-preview')?.namespaceURI ?? '';

const trackInputs = TRACKS.map((track) => {
  const built = trackById(track.id);
  const meta = TRACK_DETAILS[track.id] ?? { tag: 'Circuit', venue: 'Circuit', accent: '#ffb627', blurb: '' };
  const label = document.createElement('label');
  label.className = 'track';
  label.dataset.track = track.id;
  label.style.setProperty('--track-accent', meta.accent);
  const input = document.createElement('input');
  input.type = 'radio';
  input.name = 'track';
  input.value = track.id;
  const card = document.createElement('span');
  card.className = 'track-card';
  const top = document.createElement('span');
  top.className = 'track-card-top';
  if (SVG_NS) {
    const svg = document.createElementNS(SVG_NS, 'svg');
    svg.setAttribute('class', 'track-thumb');
    svg.setAttribute('viewBox', '0 0 56 34');
    svg.setAttribute('aria-hidden', 'true');
    const geom = trackSvgGeometry(built, 56, 34, 4, 8);
    const path = document.createElementNS(SVG_NS, 'path');
    path.setAttribute('d', geom.d);
    const dot = document.createElementNS(SVG_NS, 'circle');
    dot.setAttribute('cx', geom.cx);
    dot.setAttribute('cy', geom.cy);
    dot.setAttribute('r', '2.1');
    svg.append(path, dot);
    top.append(svg);
  }
  const tag = document.createElement('span');
  tag.className = 'track-tag';
  tag.textContent = meta.tag;
  top.append(tag);
  const name = document.createElement('strong');
  name.className = 'track-name';
  name.textContent = track.name;
  card.append(top, name);
  label.append(input, card);
  $('tracks').append(label);
  input.addEventListener('change', () => selectTrack(track.id));
  return input;
});

function updateTrackPreview(id) {
  const pathEl = $('track-preview-path');
  const dotEl = $('track-preview-start');
  if (!pathEl || !dotEl) return;
  const track = trackById(id);
  const meta = TRACK_DETAILS[id] ?? { venue: 'Circuit', accent: '#ffb627', blurb: '' };
  const geom = trackSvgGeometry(track, 120, 76, 10, 4);
  pathEl.setAttribute('d', geom.d);
  dotEl.setAttribute('cx', geom.cx);
  dotEl.setAttribute('cy', geom.cy);
  const details = $('track-details');
  if (details) details.style.setProperty('--track-accent', meta.accent);
  setText('track-meta', `${meta.venue} · ${(track.length / 1000).toFixed(2)} km`);
  setText('track-blurb', meta.blurb);
}

function selectTrack(id) {
  selectedTrackId = id;
  for (const input of trackInputs) input.checked = input.value === id;
  updateTrackPreview(id);
  showPersonalBests();
}

// Left and Right, wrapping. Focus follows only if it was already on the choice.
function stepTrack(direction) {
  const i = TRACKS.findIndex((t) => t.id === selectedTrackId);
  selectTrack(TRACKS[(i + direction + TRACKS.length) % TRACKS.length].id);
  if (trackInputs.includes(document.activeElement)) trackInputs.find((input) => input.checked).focus();
}

// --- Handling ----------------------------------------------------------------
// The mode for the next run, chosen on the title or its selection sheets. Unlike the track it is remembered: a
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
  if (picker === 'tracks') showTracksHandling();
  if (challengePicker()) showGymkhanaMenu();
  if (picker === 'tour') showTourMenu();
}

function stepHandling(direction) {
  const i = MENU_MODES.findIndex((m) => m.id === selectedHandlingId);
  selectHandling(MENU_MODES[(i + direction + MENU_MODES.length) % MENU_MODES.length].id);
  if (handlingInputs.includes(document.activeElement)) handlingInputs.find((input) => input.checked).focus();
}

const selectedHandling = () => handlingById(selectedHandlingId);

// --- Ghost -------------------------------------------------------------------
// Which ghost a circuit run shows, chosen in Options and remembered like the handling mode. G
// still only shows or hides the chosen one. The lesson, the pad and the gymkhana have none.
const GHOST_CHOICES = [
  { id: 'previous', name: 'Previous lap' },
  { id: 'reference', name: 'Saved reference' },
  { id: 'off', name: 'Off' },
];
game.ghostSource = readGhostPreference(preferenceStorage);

const ghostInputs = GHOST_CHOICES.map((choice) => {
  const label = document.createElement('label');
  label.className = 'station';
  const input = document.createElement('input');
  input.type = 'radio';
  input.name = 'ghost-source';
  input.value = choice.id;
  input.setAttribute('aria-describedby', 'ghost-note');
  const name = document.createElement('span');
  name.textContent = choice.name;
  label.append(input, name);
  $('ghost-sources').append(label);
  input.addEventListener('change', () => selectGhostSource(choice.id));
  return input;
});

function selectGhostSource(id) {
  if (!GHOST_CHOICES.some((c) => c.id === id)) return;
  game.ghostSource = id;
  writeGhostPreference(preferenceStorage, id); // only ever on the player's own choice
  showGhostStatus();
  showGhostOptions();
}

// The reference this run may show, handed to the renderer. Only a lap the store accepted.
function showReference() {
  game.ghostReference = referenceGhosts.recording;
  showGhostStatus();
  if (optionsOpen) showGhostOptions();
}

const circuitRun = () => game.state !== 'menu' && game.mode === 'normal' && !tutorial;

// A sentence on what the chosen ghost will do, for the run in progress or, on the title, for
// the selected track and mode.
function ghostNote() {
  if (game.state !== 'menu' && !circuitRun()) return 'Ghosts are only shown on circuit runs, never in lessons, practice or Gymkhana.';
  if (game.ghostSource === 'previous') return 'Races your last clean lap of this run. Press G to hide or show it.';
  if (game.ghostSource === 'off') return 'No ghost is shown. Clean laps still update your saved reference.';
  const trackId = circuitRun() ? game.track.id : selectedTrackId;
  const handlingId = circuitRun() ? game.handling.id : selectedHandlingId;
  const slot = circuitRun() ? referenceGhosts.slot : referenceGhosts.peek(trackId, handlingId);
  const best = records.forTrack(trackId, handlingId).fastestLap;
  const where = `${trackById(trackId).name} · ${handlingById(handlingId).name}`;
  const state = slotState(slot, best);
  if (state === 'best') return `${where}: saved personal best, ${formatTime(slot.lapTime)}. It joins you from lap 2.`;
  if (state === 'reference') {
    const unrecorded = best !== null && best < slot.lapTime ? ` Your best lap, ${formatTime(best)}, has no recording.` : '';
    return `${where}: saved reference, ${formatTime(slot.lapTime)}.${unrecorded} It joins you from lap 2.`;
  }
  if (state === 'incompatible') return `${where}: the saved lap was driven under older physics, so it isn't shown. Your next clean lap after lap 1 replaces it.`;
  if (state === 'corrupt') return `${where}: the saved lap couldn't be read. Your next clean lap after lap 1 replaces it.`;
  if (state === 'newer' || state === 'unsupported') return `${where}: the saved lap is from a newer version of Mini Drifters. It is kept, but can't be shown or replaced here.`;
  if (state === 'unavailable') return 'Ghost storage is unavailable, so laps can\'t be saved or loaded. Previous lap still works.';
  return `${where}: no saved reference yet. Your first clean lap after lap 1 is saved.`;
}

function showGhostOptions() {
  for (const input of ghostInputs) input.checked = input.value === game.ghostSource;
  setText('ghost-note', ghostNote());
}

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
// 'tutorial', 'practice' (the pad: free driving, never scored, timed or saved) or 'gymkhana'
// (one challenge on its own pad). The circuit records only listen to 'normal', and the
// gymkhana records only to 'gymkhana'.

function beginRun() {
  picker = null;
  doneOpen = false;
  tutorial = null;
  endTourSession();
  startRun(game, { track: trackById(selectedTrackId), handling: selectedHandling() });
  resetEffects(renderer, game.car);
  clearInput();
  syncScreens();
  audio.newRun(game);
}

// The practice pad: the selected mode on open asphalt. No ghost, no laps, no records.
function beginPractice() {
  picker = null;
  doneOpen = false;
  tutorial = null;
  endTourSession();
  startRun(game, { track: padTrack(), mode: 'practice', ghost: false, handling: selectedHandling() });
  resetEffects(renderer, game.car);
  clearInput();
  syncScreens();
  audio.newRun(game);
}

// The category sheets share the same keyboard and controller navigation as Gymkhana.
const PICKER_SHEETS = {
  tracks: 'tracks-menu', challenges: 'gymkhana-menu',
  missions: 'getaway-menu', environments: 'gymkhana-menu', tour: 'tour-menu',
};
const CATEGORY_BUTTON = { tracks: 'tracks-open', tour: 'tour-open', challenges: 'gymkhana', missions: 'getaway' };
let picker = null;
let mission = null;
const gymkhana = createGymkhanaUi({ records: gymkhanaRecords, getawayRecords, driverRecords, onChoose: () => showGymkhanaMenu() });
const inGymkhana = () => game.mode === 'gymkhana' && game.state !== 'menu';
const inGetaway = () => inGymkhana() && game.challengeDef.layout === 'urban';
const challengePicker = () => picker === 'challenges' || picker === 'environments';
const pickerSheet = () => $(PICKER_SHEETS[picker]);

const missionButtons = GETAWAY_SHEET.map((entry) => {
  const button = document.createElement('button');
  button.type = 'button';
  button.id = entry.id;
  button.textContent = entry.title;
  const descriptionId = entry.id + '-description';
  button.setAttribute('aria-describedby', descriptionId);
  const text = document.createElement('p');
  text.id = descriptionId;
  text.className = 'pitch';
  text.textContent = entry.description;
  const choice = document.createElement('div');
  choice.append(button, text);
  $('getaway-missions').append(choice);
  button.addEventListener('click', () => openPicker('environments', entry));
  return button;
});

function showTracksHandling() {
  const el = $('tracks-handling');
  if (el) el.dataset.handling = selectedHandlingId;
  setText('tracks-handling', selectedHandling().name + ' handling.' + (instructionDevice === 'keyboard' ? ' Press H to change it.' : ''));
}

function showGymkhanaMenu() {
  gymkhana.showMenu(selectedHandling(), instructionDevice);
}

function openPicker(level, selectedMission = null) {
  if (game.state !== 'menu') return;
  picker = level;
  mission = selectedMission;
  if (challengePicker()) {
    const getaway = picker === 'environments';
    $('gymkhana-menu').dataset.category = getaway ? 'getaway' : 'gymkhana';
    setText('gymkhana-title', getaway ? mission.title : 'Gymkhana');
    setText('challenge-category', getaway ? 'Getaway · Choose an environment' : 'Short challenges on open asphalt');
    gymkhana.setChoices(getaway ? mission.environments : GYMKHANA_CHALLENGES);
    showGymkhanaMenu();
  }
  if (picker === 'tracks') showTracksHandling();
  if (picker === 'tour') showTourMenu();
  syncScreens();
  const first = {
    tracks: $('start'), challenges: $('gymkhana-start'), missions: missionButtons[0], environments: $('gymkhana-start'),
    tour: picker === 'tour' ? tourPrimary() : null,
  };
  first[picker].focus();
}

function closePicker({ restoreFocus = true } = {}) {
  if (picker === 'environments') {
    const button = $(mission.id);
    openPicker('missions');
    settleFocus(button, restoreFocus);
    return;
  }
  const opener = $(CATEGORY_BUTTON[picker]);
  picker = null;
  syncScreens();
  settleFocus(opener, restoreFocus);
}

function stepChallenge(direction) {
  gymkhana.step(direction);
  showGymkhanaMenu();
  if (gymkhana.inputs.includes(document.activeElement)) gymkhana.inputs.find((input) => input.checked).focus();
}

function pickerStops() {
  if (picker === 'tracks') return [trackInputs.find((input) => input.checked), $('start'), $('practice'), $('tracks-back')];
  if (picker === 'missions') return [...missionButtons, $('getaway-back')];
  if (picker === 'tour') return tourMenuStops();
  return [gymkhana.inputs.find((input) => input.checked), $('gymkhana-start'), $('gymkhana-back')];
}

function beginGymkhana() {
  picker = null;
  doneOpen = false;
  tutorial = null;
  endTourSession();
  startRun(game, { mode: 'gymkhana', ghost: false, handling: selectedHandling(), challenge: gymkhana.selected() });
  resetEffects(renderer, game.car);
  clearInput();
  syncScreens();
  audio.newRun(game);
}

// After a normal run, Enter and Drive again start another. After a challenge they retry it.
function driveAgain() {
  if (game.mode === 'gymkhana') restart();
  else beginRun();
}

// Same track, same mode, same kind of session: only the car and the run start over.
function restart() {
  if (tourRoundLive) { tourRestart(); return; }
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
  endTourSession();
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
  endTourSession();
  tutorial = null;
  picker = null;
  mission = null;
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
  // In a Tour round, leaving goes to the Tour sheet and may cost a restart (leaveTourRound).
  if (tourRoundLive) { leaveTourRound(); return; }
  const button = inGetaway() ? $('getaway') : inGymkhana() ? $('gymkhana') : $('tracks-open');
  leaveSession();
  button.focus();
}

// Results and Back can return to the selection for the run that just ended.
function changeChallenge() {
  const chosenMission = mission;
  leaveSession();
  openPicker(chosenMission ? 'environments' : 'challenges', chosenMission);
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

// --- Circuit Tour (v0.9.0) ---------------------------------------------------------------
// A Tour round is an ordinary circuit run (mode 'normal'), so the records, reference ghosts,
// audio, analytics and HUD treat it exactly like any run. This block chooses the next circuit,
// shows the Tour's sheets, and hands each run's final counted score to tour.js. Saving is
// tour-store.js, under its own key (docs/CIRCUIT-TOUR.md).
const TOUR_SHEETS = Object.freeze({ intro: 'tour-round', result: 'tour-result', final: 'tour-final' });
const TOUR_KEY_GUARD_MS = 500; // a sheet that appears by itself ignores Enter and Space this long
const tourStore = createTourStore();
const tourChoice = { length: 'sprint', field: 'club' };
const tourUi = createTourUi({
  $,
  trackName: (id) => trackById(id).name,
  trackMeta: (id) => TRACK_DETAILS[id] ?? { venue: 'Circuit', accent: '#ffb627', blurb: '' },
  formatNumber: (n) => formatNumber(n),
  onChoice: (group, id) => chooseTour(group, id),
});
let tour = null;            // the active Tour as last saved (or as played, if storage failed)
let tourScreen = null;      // 'intro' | 'result' | 'final' | null
let tourRoundLive = false;  // this session is a Tour round, from its sheet to its result
let tourJoker = false;      // the Joker is selected for this round (spent only when the round is recorded)
let tourDriving = null;     // the round whose car has moved (and so costs a restart to leave)
let tourRunId = null;       // the run that is the round in play
let tourBefore = null;      // the standings before this round, for the movement arrows
let tourFinish = null;      // a finished round, settled after the frame's simulation steps
let tourNotice = '';
let tourLivePlace = null;   // where the HUD last placed the player, for the overtaking banners
let tourPendingBanner = null;
let tourShownAt = 0;
let tourUnsaved = false;    // this Tour could not be saved when it began: it lives in this window only

const tourActive = () => (tour && tour.status === 'active' ? tour : null);

function endTourSession() {
  tourRoundLive = false;
  tourScreen = null;
  tourJoker = false;
  tourDriving = null;
  tourRunId = null;
  tourFinish = null;
  tourLivePlace = null;
  tourPendingBanner = null;
}

function loadTour() {
  if (!tourStore) return { active: null, history: [], bests: {}, setAside: false };
  const loaded = tourStore.load();
  // A Tour that could not be saved is kept in this window, not replaced by what storage holds.
  if (tourUnsaved && tourActive()) return { ...loaded, active: tour };
  tourUnsaved = false;
  tour = loaded.active;
  return loaded;
}

// Every change to the active Tour goes through here. { ok, reason }: 'moved' means another tab
// carried the Tour on; 'unsaved' and 'write failed' mean it carries on in this window only.
function saveTour(previous, next) {
  if (!tourStore || tourUnsaved) return { ok: false, reason: 'unsaved' };
  return tourStore.update(previous, next);
}

const tourPrimary = () => (tourActive() ? $('tour-resume') : $('tour-start'));

function tourMenuStops() {
  const checked = (group) => tourUi.inputs[group].find((input) => input.checked);
  return [...(tourActive() ? [$('tour-resume'), $('tour-retire')] : []), checked('length'), checked('field'),
    $('tour-start'), $('tour-back')].filter(Boolean);
}

function tourStoreNote() {
  if (!tourStore || tourStore.available === false) return 'Tour storage is unavailable: a Tour can be driven, but not saved or resumed.';
  if (tourStore.readOnly) return 'Tours were saved by a newer version of Mini Drifters. They are kept, but cannot be continued here.';
  return '';
}

function showTourMenu() {
  const loaded = loadTour();
  tourUi.renderMenu({ choice: tourChoice, handlingName: selectedHandling().name, handlingId: selectedHandlingId, active: tourActive(),
    bests: loaded.bests, notice: tourNotice || (loaded.setAside ? 'A saved Tour could not be read, so it was set aside.' : ''),
    storeNote: tourStoreNote(), device: instructionDevice });
}

function chooseTour(group, id) {
  tourChoice[group] = id;
  showTourMenu();
}

function stepTourChoice(el, direction) {
  const list = tourUi.inputs[tourUi.groupOf(el)];
  const next = list[(list.findIndex((input) => input.checked) + direction + list.length) % list.length];
  next.click();
  next.focus();
}

function newTourSeed() {
  try { return crypto.getRandomValues(new Uint32Array(1))[0]; } catch { return Math.floor(Math.random() * 0x100000000) >>> 0; }
}

// A new Tour: with a new draw, or a rematch (the same seed and settings: the same circuits in the
// same order, against the same posted scores).
function startTour(seed = newTourSeed(), settings = { ...tourChoice, handling: selectedHandlingId }) {
  const fresh = createTour({ seed, length: settings.length, field: settings.field, handling: settings.handling });
  tourUnsaved = !(tourStore && tourStore.begin(fresh));
  tour = fresh;
  tourNotice = '';
  beginTourRound();
}

// Continue the saved Tour. A round left while the car was moving (the page was closed, say)
// costs what leaving it costs now: a restart, or a DNF with none left.
function continueTour() {
  loadTour();
  const t = tourActive();
  if (!t) { showTourMenu(); return; }
  if (t.driving === t.round) {
    const { tour: next, cost } = leaveRound({ ...t, driving: null }); // charged once, here
    const saved = saveTour(t, next);
    if (!saved.ok && saved.reason === 'moved') { tourNotice = 'This Tour was carried on elsewhere. Continue it again.'; showTourMenu(); return; }
    tour = next;
    tourNotice = cost === 'restart' ? `Round ${t.round + 1} was left while driving: that used a restart (${next.restartsLeft} left).`
      : `Round ${t.round + 1} was left while driving with no restarts left: it counts as a DNF.`;
    if (next.status === 'complete') { showTourFinalFromMenu(t); return; }
  }
  beginTourRound();
}

function retireActiveTour() {
  const t = tourActive();
  if (!t) return;
  saveTour(t, retireTour(t));
  tour = null;
  tourUnsaved = false;
  tourNotice = 'Tour retired. It is kept in your Tour history.';
  showTourMenu();
  syncScreens();
  settleFocus($('tour-start'), true);
}

// The round's sheet over the grid: the car waits there, paused, until Drive.
function beginTourRound() {
  const t = tourActive();
  if (!t) return;
  picker = null;
  doneOpen = false;
  tutorial = null;
  endTourSession();
  tourRoundLive = true;
  tourBefore = standings(t);
  startRun(game, { track: trackById(t.lineup[t.round]), handling: handlingById(t.handling) });
  tourRunId = game.runId;
  if (!game.paused) togglePause(game);
  resetEffects(renderer, game.car);
  clearInput();
  tourScreen = 'intro';
  tourShownAt = performance.now();
  showTourIntro();
  syncScreens();
  audio.newRun(game);
}

function showTourIntro() {
  const t = tourActive();
  if (!t) return;
  tourUi.renderIntro(t, { jokerArmed: tourJoker, pb: records.forTrack(t.lineup[t.round], t.handling).score });
}

function tourDrive() {
  if (tourScreen !== 'intro') return;
  tourScreen = null;
  if (game.paused) togglePause(game);
  clearInput();
  syncScreens();
  audio.gesture(game);
}

function toggleTourJoker() {
  const t = tourActive();
  if (tourScreen !== 'intro' || !t || !jokerAllowed(t)) return;
  tourJoker = !tourJoker;
  showTourIntro();
  if (tourJoker) audio.cue('combo-up', 2);
}

function markTourDriving() {
  const t = tourActive();
  if (!t) return;
  tourDriving = t.round;
  if (tourStore && !tourUnsaved) tourStore.setDriving(t, t.round);
}

// R in a Tour round. Before the car moves it is free; after, it uses one of the Tour's restarts.
function tourRestart() {
  const t = tourActive();
  if (!t || tourScreen || game.state === 'finished') return;
  const moved = tourDriving === t.round;
  if (moved && t.restartsLeft <= 0) {
    tourPendingBanner = { kind: 'void', text: 'NO RESTARTS LEFT' };
    return;
  }
  if (moved) {
    const next = useRestart(t);
    const saved = saveTour(t, next);
    if (!saved.ok && saved.reason === 'moved') { tourMovedElsewhere(); return; }
    tour = next;
  }
  tourDriving = null;
  tourLivePlace = null;
  clearInput();
  restartRun(game, { ghost: true, mode: 'normal' });
  tourRunId = game.runId;
  resetEffects(renderer, game.car);
  syncScreens();
  audio.newRun(game);
  if (moved) tourPendingBanner = { kind: 'lap', text: `RESTART — ${tour.restartsLeft} LEFT` };
}

// Leaving a round: free before the car has moved, a restart (or a DNF) after it has.
function leaveTourRound() {
  const t = tourActive();
  let notice = 'Tour saved. Continue it from here whenever you like.';
  if (t && game.state !== 'finished' && tourDriving === t.round) {
    const { tour: next, cost } = leaveRound(t);
    const saved = saveTour(t, next);
    if (!saved.ok && saved.reason === 'moved') { tourMovedElsewhere(); return; }
    tour = next;
    notice = cost === 'restart' ? `You left round ${t.round + 1} while driving: that used a restart (${next.restartsLeft} left).`
      : `You left round ${t.round + 1} with no restarts left: it counts as a DNF.`;
  }
  leaveSession();
  tourNotice = notice;
  if (t && tour?.status === 'complete') { showTourFinalFromMenu(t); return; }
  openPicker('tour');
}

function tourMovedElsewhere() {
  leaveSession();
  tourNotice = 'This Tour was carried on in another tab or window, so this round was not added to it.';
  openPicker('tour');
}

// Esc and the controller's Back on a Tour sheet.
function tourBack() {
  if (tourScreen === 'intro') leaveTourRound();
  else if (tourScreen) { leaveSession(); tourNotice = ''; openPicker('tour'); }
}

function tourRunEvent(event) {
  if (!tourRoundLive || event.type !== 'finish' || event.runId !== tourRunId) return;
  const r = game.results;
  tourFinish = { score: r.score, newBests: records.newBests,
    run: { bestLap: r.bestLap, bestCombo: r.bestCombo, spinouts: r.spinouts, voidedLaps: r.voidedLaps, forfeited: r.forfeited } };
}

// A round's run is over: record it, save it, and show what it was worth.
function settleTourRound() {
  const done = tourFinish;
  tourFinish = null;
  const t = tourActive();
  if (!t || !tourRoundLive) return;
  const next = recordRound(t, { score: done.score, joker: tourJoker, run: done.run });
  const key = bestsKey(t);
  const previousBest = tourStore ? tourStore.load().bests[key] ?? null : null;
  const saved = saveTour(t, next);
  if (!saved.ok && saved.reason === 'moved') { tourMovedElsewhere(); return; }
  const notice = saved.ok ? '' : 'This round could not be saved: the Tour carries on in this window only.';
  tour = next;
  tourDriving = null;
  tourShownAt = performance.now();
  if (next.status === 'complete') {
    tourScreen = 'final';
    tourUi.renderFinal(next, { before: tourBefore, best: tourStore ? tourStore.load().bests[key] ?? null : null, previousBest, notice });
  } else {
    tourScreen = 'result';
    tourUi.renderResult(next, { before: tourBefore, newBests: done.newBests, run: done.run, notice });
  }
  syncScreens();
}

// The final sheet, reached from the Tour menu when a DNF ends the last round.
function showTourFinalFromMenu(before) {
  const key = bestsKey(tour);
  picker = null;
  tourScreen = 'final';
  tourShownAt = performance.now();
  tourUi.renderFinal(tour, { before: standings(before), best: tourStore ? tourStore.load().bests[key] ?? null : null, previousBest: null, notice: tourNotice });
  tourNotice = '';
  syncScreens();
}

function tourTrophyCue() {
  const trophy = tour?.status === 'complete' ? tourOutcome(tour).trophy : null;
  return trophy ? `outcome-${trophy}` : 'outcome-circuit';
}

function tourPauseNote() {
  const t = tourActive();
  if (!t) return '';
  const moved = tourDriving === t.round;
  const controller = instructionDevice === 'controller';
  const restarts = `${t.restartsLeft} ${t.restartsLeft === 1 ? 'restart' : 'restarts'} left for the Tour.`;
  if (!moved) return `${controller ? 'Menu' : 'P'} to carry on. Nothing is lost by leaving from the grid. ${restarts}`;
  return t.restartsLeft > 0
    ? `${controller ? 'Menu' : 'P'} to carry on. Restarting or leaving this round uses a restart. ${restarts}`
    : `${controller ? 'Menu' : 'P'} to carry on. No restarts left: leaving now ends this round as a DNF.`;
}

// The pause sheet's Restart and Return buttons say what they cost in a Tour round.
function showTourPause() {
  const restartButton = $('restart');
  const leave = document.querySelector('#paused .return-title');
  const t = tourRoundLive ? tourActive() : null;
  const moved = t && tourDriving === t.round;
  restartButton.firstChild.textContent = !moved ? 'Restart ' : t.restartsLeft > 0 ? `Restart (${t.restartsLeft} left) ` : 'No restarts left ';
  restartButton.disabled = !!(moved && t.restartsLeft <= 0);
  leave.textContent = !t ? 'Return to title' : !moved ? 'Save & leave' : t.restartsLeft > 0 ? 'Leave (uses a restart)' : 'Leave (DNF)';
}

const tourSheetButtons = () => [...$(TOUR_SHEETS[tourScreen]).querySelectorAll('button')].filter((el) => !el.disabled && el.getClientRects().length);
const tourPrimaryButton = () => ({ intro: $('tour-drive'), result: $('tour-next'), final: $('tour-rematch') })[tourScreen];

function tourKey(e) {
  const plain = !(e.ctrlKey || e.metaKey || e.altKey);
  const tooSoon = performance.now() - tourShownAt < TOUR_KEY_GUARD_MS;
  const vertical = e.code === 'ArrowDown' || e.code === 'ArrowRight' ? 1 : e.code === 'ArrowUp' || e.code === 'ArrowLeft' ? -1 : 0;
  if (vertical) {
    e.preventDefault();
    if (!e.repeat) moveMenuFocus(tourSheetButtons(), vertical);
    return;
  }
  if (e.code === 'Space' || e.code === 'Enter') {
    const onButton = e.target instanceof HTMLButtonElement && tourSheetButtons().includes(e.target);
    if (e.repeat || tooSoon || !onButton) e.preventDefault();
    if (!e.repeat && !tooSoon && !onButton && e.code === 'Enter' && plain) tourPrimaryButton().click();
    return;
  }
  if (e.repeat || !plain) return;
  if (e.code === 'Escape') { e.preventDefault(); tourBack(); }
  else if (e.code === 'KeyN') audio.nextStation(game);
  else if (e.code === 'KeyO') openOptions(document.activeElement instanceof HTMLButtonElement ? document.activeElement : null);
}

// The HUD panel, and a banner whenever the player passes (or drops behind) a posted score.
function updateTourHud(now) {
  const t = tourActive();
  if (!t || tourScreen === 'result' || tourScreen === 'final') return;
  const { combo } = game.scoring;
  const comboValue = combo ? Math.round(combo.points * currentMultiplier(combo)) : 0;
  const s = tourUi.updateHud(t, t.round, { score: countedScore(game), comboValue, jokerArmed: tourJoker });
  const place = s.position;
  if (game.state === 'racing' && tourLivePlace !== null && place !== tourLivePlace) {
    const better = place < tourLivePlace;
    const passed = better ? t.marks[t.round].slice(place - 1, tourLivePlace - 1) : [];
    const names = passed.map((m) => (m.name.split(' ')[0] ?? m.name).toUpperCase());
    const text = better ? `P${place} — PASSED ${names.length > 2 ? `${names.length} DRIVERS` : names.join(' & ')}` : `DOWN TO P${place}`;
    const el = $('banner');
    const justBanked = !el.hidden && el.dataset.kind === 'banked' && banner.until - now > BANNER_TIME - 0.1;
    showBanner(better ? 'tour' : 'void', justBanked && better ? `${el.textContent} · ${text}` : text, now);
    if (better) audio.cue('gate-pass', 1);
  }
  tourLivePlace = place;
  if (tourPendingBanner) {
    showBanner(tourPendingBanner.kind, tourPendingBanner.text, now);
    tourPendingBanner = null;
  }
}

{
  $('tour-start').addEventListener('click', () => startTour());
  $('tour-resume').addEventListener('click', continueTour);
  $('tour-retire').addEventListener('click', retireActiveTour);
  $('tour-drive').addEventListener('click', tourDrive);
  $('tour-joker').addEventListener('click', toggleTourJoker);
  $('tour-round-leave').addEventListener('click', leaveTourRound);
  $('tour-next').addEventListener('click', beginTourRound);
  $('tour-result-leave').addEventListener('click', tourBack);
  $('tour-rematch').addEventListener('click', () => { const t = tour; startTour(t.seed, t); });
  $('tour-new').addEventListener('click', () => { const t = tour; startTour(newTourSeed(), t); });
  $('tour-exit').addEventListener('click', tourBack);
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
  showGhostOptions();
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

function moveMenuFocus(buttons, direction) {
  const current = buttons.indexOf(document.activeElement);
  const next = current < 0 ? (direction > 0 ? 0 : buttons.length - 1) : (current + direction + buttons.length) % buttons.length;
  buttons[next].focus();
}

// These keep Enter, and Space when the car isn't being driven, for their own use.
const keepsKeys = (target) => target instanceof Element && target.matches('#sound, .options-open, #how-to-play, #practice, #gymkhana, #gymkhana-again, #gymkhana-change, #again, #resume, #restart, .return-title, #tutorial-skip');

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
  if (tourScreen) {
    tourKey(e);
    return;
  }
  if (picker) {
    const plain = !(e.ctrlKey || e.metaKey || e.altKey);
    const horizontal = e.code === 'ArrowRight' ? 1 : e.code === 'ArrowLeft' ? -1 : 0;
    const vertical = e.code === 'ArrowDown' ? 1 : e.code === 'ArrowUp' ? -1 : 0;
    if (horizontal || vertical) {
      e.preventDefault();
      if (e.repeat) return;
      if (horizontal && picker === 'tracks') stepTrack(horizontal);
      else if (horizontal && challengePicker()) stepChallenge(horizontal);
      else if (horizontal && picker === 'tour' && tourUi.groupOf(document.activeElement)) stepTourChoice(document.activeElement, horizontal);
      else moveMenuFocus(pickerStops(), vertical || horizontal);
    } else if (e.repeat) {
      e.preventDefault();
    } else if (e.code === 'Escape') {
      e.preventDefault();
      closePicker();
    } else if (e.code === 'KeyH' && plain) {
      stepHandling(e.shiftKey ? -1 : 1);
    } else if (e.code === 'KeyO' && plain) {
      openOptions(document.activeElement);
    } else if (e.code === 'Enter' && plain && !(e.target instanceof HTMLButtonElement)) {
      e.preventDefault();
      if (picker === 'tracks') beginRun();
      else if (challengePicker()) beginGymkhana();
      else if (picker === 'tour') tourPrimary().click();
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
  // The lesson and the practice pad have nothing to finish, and a challenge is a few seconds
  // long, so Esc leaves them directly.
  if ((tutorial || game.mode === 'practice' || game.mode === 'gymkhana') && game.state !== 'menu' && !game.paused && e.code === 'Escape' && !e.repeat) {
    e.preventDefault();
    if (inGetaway()) changeChallenge();
    else returnToTitle();
    return;
  }
  if (game.state === 'menu' && (e.code === 'ArrowUp' || e.code === 'ArrowDown')) {
    e.preventDefault();
    if (!e.repeat) moveMenuFocus(titleStops(), e.code === 'ArrowDown' ? 1 : -1);
    return;
  }
  if (game.state === 'menu' && (e.code === 'ArrowLeft' || e.code === 'ArrowRight')) {
    e.preventDefault();
    const direction = e.code === 'ArrowRight' ? 1 : -1;
    if (!e.repeat) {
      if (handlingInputs.includes(document.activeElement)) stepHandling(direction);
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
  if (e.code === 'Enter' && (keepsKeys(e.target) || (game.state === 'menu' && e.target instanceof HTMLButtonElement))) {
    // Left to the browser, so Enter presses the focused button.
  } else if (e.code === 'Enter' && (game.state === 'menu' || game.state === 'finished')) {
    e.preventDefault();
    if (game.state === 'menu') openPicker('tracks');
    else driveAgain();
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
  if (optionsOpen || helpOpen || doneOpen || picker || tourScreen) {
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
for (const [level, button] of Object.entries(CATEGORY_BUTTON)) {
  $(button).addEventListener('click', () => openPicker(level));
}
for (const id of ['tracks-back', 'getaway-back', 'gymkhana-back', 'tour-back']) {
  $(id).addEventListener('click', (e) => closePicker({ restoreFocus: e.detail === 0 }));
}
$('gymkhana-start').addEventListener('click', beginGymkhana);
$('gymkhana-again').addEventListener('click', restart);
$('gymkhana-change').addEventListener('click', changeChallenge);
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
  if (tourScreen === 'intro') { tourDrive(); return; }
  if (tourScreen) return;
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

// A circuit run and a gymkhana challenge each end on a sheet of their own.
const resultsSheet = () => (game.mode === 'gymkhana' ? $('gymkhana-results') : $('results'));

function controllerSheet() {
  return optionsOpen ? $('options') : helpOpen ? $('help') : tourScreen ? $(TOUR_SHEETS[tourScreen]) : doneOpen ? $('tutorial-done') : picker ? pickerSheet()
    : game.paused ? $('paused') : game.state === 'finished' ? resultsSheet() : game.state === 'menu' ? $('menu') : null;
}

function menuControls(sheet) {
  if (sheet === $('menu')) return [...titleStops(), soundButton].filter((el) => !el.disabled && el.getClientRects().length);
  if (picker && sheet === pickerSheet()) return [...pickerStops(), soundButton];
  return [...sheet.querySelectorAll('button, input'), soundButton].filter((el) => !el.disabled && el.getClientRects().length);
}

function controllerMenu(pressed, sheet) {
  if (pressed.back) {
    if (optionsOpen) closeOptions();
    else if (helpOpen) closeHelp();
    else if (tourScreen) tourBack();
    else if (picker) closePicker();
    else if (inGetaway() && game.state === 'finished') changeChallenge();
    else if (doneOpen || game.state === 'finished') returnToTitle();
    else if (game.paused) pauseOrResume();
    const nextSheet = controllerSheet();
    if (nextSheet) {
      const controls = menuControls(nextSheet);
      controllerFocus(controls.includes(document.activeElement) ? document.activeElement : controls[0]);
    }
    return;
  }
  if (pressed.pause && game.paused && !optionsOpen && (!tourScreen || tourScreen === 'intro')) { pauseOrResume(); return; }
  const controls = menuControls(sheet);
  const current = controls.indexOf(document.activeElement);
  const horizontal = pressed.right ? 1 : pressed.left ? -1 : 0;
  if (horizontal && sheet === pickerSheet() && picker === 'tracks') {
    stepTrack(horizontal);
    if (trackInputs.includes(document.activeElement)) controllerFocus(document.activeElement);
    return;
  }
  if (horizontal && sheet === pickerSheet() && challengePicker()) {
    stepChallenge(horizontal);
    if (gymkhana.inputs.includes(document.activeElement)) controllerFocus(document.activeElement);
    return;
  }
  if (horizontal && sheet === $('menu') && !handlingInputs.includes(document.activeElement)) return;
  if (horizontal && document.activeElement instanceof HTMLInputElement) {
    const el = document.activeElement;
    if (el.type === 'range') {
      if (horizontal > 0) el.stepUp(); else el.stepDown();
      el.dispatchEvent(new Event('input', { bubbles: true }));
      controllerFocus(el);
      return;
    }
    if (el.type === 'radio') {
      // The whole group, even where only its chosen radio is a stop (the Gymkhana sheet).
      const radios = [...sheet.querySelectorAll('input[type="radio"]')].filter((c) => c.name === el.name && !c.disabled && c.getClientRects().length);
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
  if (pressed.confirm && !(doneOpen && performance.now() - doneOpenedAt < DONE_KEY_GUARD_MS)
    && !(tourScreen && performance.now() - tourShownAt < TOUR_KEY_GUARD_MS)) {
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
  if (pad.pressed.back && inGetaway()) { changeChallenge(); return NEUTRAL_DRIVE; }
  if (pad.pressed.pause) { pauseOrResume(); return NEUTRAL_DRIVE; }
  // A challenge has no ghost to show or hide, so there X is a quick retry.
  if (pad.pressed.ghost && inGymkhana()) { restart(); return NEUTRAL_DRIVE; }
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

// The tag under the Sound button names the chosen ghost and whether G has hidden it. A saved
// reference that can't be shown says why, briefly; Options has the full sentence.
const REFERENCE_MISSING = { none: 'No Reference Yet', incompatible: 'Reference Outdated', corrupt: 'No Reference Yet',
  newer: 'Reference: Newer Version', unsupported: 'Reference: Newer Version', unavailable: 'Reference Unavailable' };
function showGhostStatus() {
  const el = $('ghost-status');
  const source = game.ghostSource;
  let text;
  let state;
  if (source === 'off') {
    text = 'Ghost Off';
    state = 'off';
    el.title = 'No ghost. Choose one in Options.';
  } else if (source === 'reference') {
    const slot = referenceGhosts.slot;
    if (game.ghostReference) {
      text = game.ghostVisible ? 'Reference On' : 'Reference Off';
      state = game.ghostVisible ? 'on' : 'off';
    } else {
      text = REFERENCE_MISSING[slot?.status] ?? REFERENCE_MISSING.none;
      state = 'none';
    }
    el.title = 'Press G to show or hide your saved reference lap. It joins you from lap 2.';
  } else {
    text = game.ghostVisible ? 'Ghost On' : 'Ghost Off';
    state = game.ghostVisible ? 'on' : 'off';
    el.title = 'Press G to show or hide the ghost of your last valid lap';
  }
  el.dataset.state = state;
  el.dataset.source = source;
  setText('ghost-status', text);
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
  // Keep the complete menu visible if the fallback title font takes extra room.
  const panel = title.closest('.title-panel');
  const padding = getComputedStyle(panel);
  const available = Math.min(innerHeight, panel.clientHeight) - parseFloat(padding.paddingTop) - parseFloat(padding.paddingBottom);
  const heading = title.getBoundingClientRect();
  // With Circuit Tour the menu has a fourth category button, which can push the analytics note
  // off a short window, so the whole column is measured (v0.9.0).
  const used = $('analytics-note').getBoundingClientRect().bottom - heading.top;
  if (used > available) {
    const scale = Math.max(0.2, (heading.height - (used - available) - 4) / heading.height);
    title.style.fontSize = `${parseFloat(getComputedStyle(title).fontSize) * scale}px`;
  }
}

let shownState = game.state;

function syncScreens() {
  const { state, paused } = game;
  shownState = state;
  const context = optionsOpen ? 'options' : helpOpen ? 'help' : tourScreen ? 'tour-' + tourScreen : doneOpen ? 'done' : picker ? picker
    : paused ? 'paused' : state === 'menu' || state === 'finished' ? state : 'driving';
  if (context !== controllerContext) {
    controllerContext = context;
    clearInput();
  }
  document.body.dataset.screen = state === 'menu' ? 'title' : 'game';
  // The HUD hides laps, score and combo on the pad, and names the mode.
  const practice = state !== 'menu' && !tutorial && game.mode === 'practice';
  document.body.dataset.session = state === 'menu' ? 'none' : tutorial ? 'tutorial' : game.mode;
  // A timed challenge shows no score or combo; a scored one keeps them.
  // Getaway Driver does not keep drift scores, so its mission tag lets CSS clear the score box.
  if (inGymkhana()) {
    document.body.dataset.challenge = game.challengeDef.kind;
    if (game.challengeDef.mission) document.body.dataset.mission = game.challengeDef.mission;
    else delete document.body.dataset.mission;
  } else {
    delete document.body.dataset.challenge;
    delete document.body.dataset.mission;
  }
  $('gym-panel').hidden = !inGymkhana();
  if (!inGymkhana()) hideBust();
  setText('handling-status', practice ? `Practice · ${game.handling.name}` : game.handling.name);
  $('handling-status').title = `Handling: ${game.handling.name}. Change it on the title screen.`;
  $('menu').hidden = state !== 'menu' || optionsOpen || helpOpen || doneOpen || picker !== null || tourScreen !== null;
  if (!$('menu').hidden) fitTitle();
  $('help').hidden = !helpOpen;
  $('tracks-menu').hidden = optionsOpen || picker !== 'tracks';
  $('getaway-menu').hidden = optionsOpen || picker !== 'missions';
  $('gymkhana-menu').hidden = optionsOpen || !challengePicker();
  $('tour-menu').hidden = optionsOpen || picker !== 'tour';
  for (const [screen, id] of Object.entries(TOUR_SHEETS)) $(id).hidden = optionsOpen || tourScreen !== screen;
  $('tour-hud').hidden = !tourRoundLive || state === 'menu' || tourScreen === 'result' || tourScreen === 'final';
  if (tourRoundLive) document.body.dataset.tour = 'round';
  else delete document.body.dataset.tour;
  showTourPause();
  $('tutorial-done').hidden = !doneOpen;
  $('tutorial-skip').hidden = !tutorial;
  $('ghost-status').hidden = !!tutorial;
  setText('paused-note', tourRoundLive ? tourPauseNote() : inGymkhana()
    ? (instructionDevice === 'controller' ? `${game.challengeDef.name}. Menu to carry on, or Restart to try again.` : `${game.challengeDef.name}. Press P to carry on, or R to try again.`)
    : practice
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
  $('paused').hidden = !paused || optionsOpen || tourScreen !== null;
  const finished = state === 'finished';
  $('results').hidden = !finished || optionsOpen || game.mode === 'gymkhana' || tourRoundLive;
  $('gymkhana-results').hidden = !finished || optionsOpen || game.mode !== 'gymkhana';
  $('options').hidden = !optionsOpen;
  if (finished && game.mode === 'gymkhana') {
    setText('gymkhana-change', inGetaway() ? 'Environments' : 'Challenges');
    gymkhana.showResults(game);
  }
  else if (finished && !tourRoundLive) showResults();
  if (document.activeElement instanceof HTMLElement && state !== 'menu' && !finished && !optionsOpen && !tourScreen) document.activeElement.blur();
  startTabAt(optionsOpen ? null : tourScreen ? $(TOUR_SHEETS[tourScreen]) : paused ? $('paused') : finished ? resultsSheet() : null);
}

// The title shows one partition: the selected track with the selected mode.
function showPersonalBests() {
  const best = records.forTrack(selectedTrackId, selectedHandlingId);
  setText('records-heading', `${trackById(selectedTrackId).name} · ${selectedHandling().name} — Personal bests`);
  setText('pb-score', best.score === null ? '--' : formatNumber(best.score));
  setText('pb-lap', formatTime(best.fastestLap));
  setText('pb-combo', best.bestCombo === null ? '--' : formatNumber(best.bestCombo));
  // Score and combo records from the earlier scoring rules stay visible, apart and quiet. They
  // are history: no run competes with them. The fastest lap above already includes theirs.
  const legacy = records.legacyForTrack(selectedTrackId, selectedHandlingId);
  const legacyParts = [
    legacy.score === null ? '' : `score ${formatNumber(legacy.score)}`,
    legacy.bestCombo === null ? '' : `combo ${formatNumber(legacy.bestCombo)}`,
  ].filter(Boolean);
  setText('pb-legacy', legacyParts.length ? `Legacy scoring: ${legacyParts.join(' · ')}` : '');
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
  $('results').dataset.best = (best.score || best.fastestLap || best.bestCombo) ? 'true' : 'false';
  $('new-score').hidden = !best.score;
  $('new-lap').hidden = !best.fastestLap;
  $('new-combo').hidden = !best.bestCombo;
}

const banner = { until: 0, serialCombo: 0, serialLap: 0, serialChallenge: 0 };
let lapFlashUntil = 0;
let lapFlashKind = '';
let currentRunId = -1;

function showBanner(kind, text, now) {
  const el = $('banner');
  el.dataset.kind = kind;
  el.dataset.pop = el.dataset.pop === 'a' ? 'b' : 'a';
  el.textContent = text;
  el.hidden = false;
  banner.until = now + BANNER_TIME;
}

function updateBanners(now) {
  const { scoring, laps } = game;
  if (currentRunId !== game.runId) {
    currentRunId = game.runId;
    banner.serialCombo = 0;
    banner.serialLap = 0;
    banner.serialChallenge = 0;
    banner.until = 0;
    lapFlashUntil = 0;
  }
  // A challenge's own news comes first, so that a combo lost to the same cone has the last word.
  if (game.challenge && game.challenge.eventSerial !== banner.serialChallenge) {
    banner.serialChallenge = game.challenge.eventSerial;
    const said = gymkhana.banner(game.challengeDef, game.challenge.event);
    if (said) showBanner(said.kind, said.text, now);
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
      lapFlashKind = best ? 'best' : 'lap';
      lapFlashUntil = now + 0.9;
      // With the saved reference chosen, a lap it saved (or failed to save) says so.
      const offered = referenceGhosts.lastResult;
      const thisLap = offered && offered.runId === game.runId && offered.time === laps.lastLap && game.ghostSource === 'reference';
      const saved = thisLap && offered.saved ? ' · REFERENCE SAVED'
        : thisLap && (offered.reason === 'write failed' || offered.reason === 'too large') ? ' · REFERENCE NOT SAVED' : '';
      showBanner('lap', `LAP ${formatTime(laps.lastLap)}${best ? ' — BEST' : ''}${saved}`, now);
    } else {
      lapFlashKind = 'void';
      lapFlashUntil = now + 0.9;
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
  // A challenge says what it asks while the car is on the line, and nothing once the clock runs.
  if (game.mode === 'gymkhana') {
    gymkhana.showPrompt(el, game, instructionDevice);
    return;
  }
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
  const angleBox = document.querySelector('.angle');
  if (angleBox) {
    angleBox.dataset.driftZone = shownSlip >= 75 ? 'spin' : shownSlip >= 50 ? 'over' : shownSlip >= 25 ? 'sweet' : '';
  }

  const comboEl = $('combo');
  const { combo } = scoring;
  comboEl.dataset.state = combo ? 'active' : 'idle';
  if (combo) {
    const mult = currentMultiplier(combo);
    comboEl.dataset.mult = String(mult);
    comboEl.dataset.lowGrace = combo.grace < 0.55 ? 'true' : 'false';
    setText('combo-points', formatNumber(combo.points));
    setText('combo-mult', `×${mult}`);
    $('combo-grace-bar').style.transform = `scaleX(${Math.max(0, combo.grace / T.comboGrace)})`;
  } else {
    comboEl.dataset.mult = '1';
    comboEl.dataset.lowGrace = 'false';
  }
  const lapsPanel = document.querySelector('#hud .laps');
  if (lapsPanel) lapsPanel.dataset.lapFlash = now < lapFlashUntil ? lapFlashKind : '';
  if (game.mode === 'gymkhana') gymkhana.updateHud(game);
  else hideBust();
  updateBanners(now);
  if (tourRoundLive) updateTourHud(now);
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
    ['course', game.onCourse ? 'on' : 'OFF (no drift points)'],
    ['contact', contactText(game)],
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

// The most recent hit on solid scenery, for the debug panel.
function contactText(game) {
  const hit = game.lastContact;
  if (!hit) return game.obstacles?.length ? 'none yet' : 'n/a';
  const ago = (game.ticks - hit.tick) * TUNING.simStep;
  const hard = hit.impact >= TUNING.barrierSignificantImpact ? ' HARD' : '';
  return `${hit.kind} ${hit.impact.toFixed(1)} m/s${hard}, ${ago.toFixed(1)} s ago`;
}

// Getaway: one smash sound per object the car breaks, in order. The run's
// smash log has one entry per object, so a broken one can never sound twice; a muted or paused
// game plays nothing, and nothing is saved up for later.
let smashHeardRun = null;
let smashHeard = 0;
function playSmashSounds() {
  const run = game.mode === 'gymkhana' ? game.challenge : null;
  if (!run?.smashLog) return;
  if (run !== smashHeardRun) { smashHeardRun = run; smashHeard = 0; }
  while (smashHeard < run.smashLog.length) {
    audio.smash(run.smashLog[smashHeard].kind);
    smashHeard += 1;
  }
}

// Cohesive R2 / R2b sound-effect cues: solid impacts, cones, apex curbs, pursuit/stealth
// transitions, spotting radar, camera shutters, laps, combo tier-ups, Gymkhana gates/slalom/turn-zone,
// banked drifts and mission/medal outcomes. Every event fires once per serial/tick; nothing queues.
let fxRunId = -1;
let fxChallengeSerial = 0;
let fxScoreSerial = 0;
let fxLapSerial = 0;
let fxImpactTick = -1;
let fxImpactCd = 0;
let fxSpotCd = 0;
let fxCurbCd = 0;
let fxWrongWayCd = 0;
let fxPrevMult = 1;
let fxPrevGate = 0;
let fxPrevSlalom = 0;
let fxPrevReached = false;
let fxFinished = false;
function playFxSounds(dt) {
  if (game.state === 'menu') {
    fxRunId = -1;
    return;
  }
  if (fxRunId !== game.runId) {
    fxRunId = game.runId;
    fxChallengeSerial = game.challenge?.eventSerial ?? 0;
    fxScoreSerial = game.scoring.eventSerial;
    fxLapSerial = game.lapEventSerial;
    fxImpactTick = -1;
    fxImpactCd = 0;
    fxSpotCd = 0;
    fxCurbCd = 0;
    fxWrongWayCd = 0;
    fxPrevMult = 1;
    fxPrevGate = 0;
    fxPrevSlalom = 0;
    fxPrevReached = false;
    fxFinished = false;
  }
  const active = game.state === 'racing' && !game.paused;
  if (active) {
    fxImpactCd = Math.max(0, fxImpactCd - dt);
    fxSpotCd = Math.max(0, fxSpotCd - dt);
    fxCurbCd = Math.max(0, fxCurbCd - dt);
    fxWrongWayCd = Math.max(0, fxWrongWayCd - dt);
    const hit = game.lastContact;
    const freshObstacle = hit && hit.tick !== fxImpactTick && (game.ticks - hit.tick) <= 6 && hit.impact > 3;
    const freshBarrier = !freshObstacle && game.lastImpact > 3 && game.ticks !== fxImpactTick;
    if ((freshObstacle || freshBarrier) && fxImpactCd <= 0) {
      fxImpactTick = freshObstacle ? hit.tick : game.ticks;
      fxImpactCd = 0.14;
      const impact = freshObstacle ? hit.impact : game.lastImpact;
      audio.impact(Math.min(1, impact / 22), freshObstacle ? hit.kind : 'wall');
    }
    // Tactile apex curb rumble cadence on circuit curbs at speed.
    if (!game.track.pad && game.car.surface === 'curb' && game.car.speed > 7 && fxCurbCd <= 0) {
      const ratio = Math.min(1, game.car.speed / TUNING.topSpeed);
      audio.curb(ratio);
      fxCurbCd = 0.11 - 0.055 * ratio;
    }
    // Gentle wrong-way nudge on circuit runs.
    if (game.mode === 'normal' && game.wrongWayTime > 1.2 && fxWrongWayCd <= 0) {
      audio.cue('wrong-way');
      fxWrongWayCd = 1.8;
    }
    // Combo multiplier step-up glint (×2 / ×3) across circuits & scored Gymkhana.
    if (game.mode !== 'practice' && game.challengeDef?.mission !== 'driver') {
      const mult = game.scoring.combo ? currentMultiplier(game.scoring.combo) : 1;
      if (mult > fxPrevMult) audio.cue('combo-up', mult);
      fxPrevMult = mult;
    }
    // Getaway Driver: subtle rising radar tick while a cruiser is locking on.
    if (game.challenge?.police && !game.challenge.pursuing) {
      const spotTime = game.challengeDef?.driverTuning?.spotTime ?? 0.5;
      let maxFrac = 0;
      for (const u of game.challenge.police) {
        if (u.spotting > 0) maxFrac = Math.max(maxFrac, u.spotting / spotTime);
      }
      if (maxFrac > 0.05 && fxSpotCd <= 0) {
        audio.cue('spotTick', maxFrac);
        fxSpotCd = 0.16;
      }
    }
  }
  const run = game.mode === 'gymkhana' ? game.challenge : null;
  const def = game.mode === 'gymkhana' ? game.challengeDef : null;
  // Non-urban Gymkhana live milestone cues (turn-zone lock, drift gates, ascending slalom weave).
  if (run && def && def.layout !== 'urban') {
    if (def.layout === 'box' && run.reached && !fxPrevReached) {
      fxPrevReached = true;
      audio.cue('turn-zone');
    } else if (def.layout === 'course' && run.nextGate > fxPrevGate) {
      const idx = run.nextGate - 1;
      fxPrevGate = run.nextGate;
      if (idx < def.geometry.gates.length - 1) audio.cue('gate-pass', run.gates[idx]?.drifting ? 1 : 0);
    } else if (def.layout === 'slalom' && run.next > fxPrevSlalom) {
      fxPrevSlalom = run.next;
      audio.cue('slalom-pass', run.next);
    }
  }
  if (run && run.eventSerial !== fxChallengeSerial) {
    fxChallengeSerial = run.eventSerial;
    const ev = run.event;
    if (ev?.type === 'cone') audio.cone();
    else if (ev?.type === 'suspicious' || ev?.type === 'reported' || ev?.type === 'spotted'
      || ev?.type === 'joined' || ev?.type === 'lost' || ev?.type === 'locked') {
      audio.cue(ev.type);
    } else if (ev?.type === 'shot') {
      audio.cue('camera', ev.camera ?? 1);
    } else if (ev?.type === 'arrived') {
      const id = (run.result?.outcome ?? 'ghost').replace(/\s+/g, '-');
      audio.cue(`outcome-${id}`);
      fxFinished = true;
    } else if (ev?.type === 'escaped') {
      audio.cue('outcome-escaped');
      fxFinished = true;
    } else if (ev?.type === 'busted') {
      if (!fxFinished) {
        audio.cue('outcome-busted');
        fxFinished = true;
      }
    }
  }
  // Circuit lap timing chimes (counted lap, best lap, or voided lap).
  if (game.lapEventSerial !== fxLapSerial) {
    fxLapSerial = game.lapEventSerial;
    if (game.state !== 'finished') {
      if (game.lapEvent === 'lap') {
        const isBest = game.laps.lastLap === game.laps.bestLap && game.laps.completed > 1;
        audio.cue(isBest ? 'lap-best' : 'lap');
      } else if (game.lapEvent === 'void') {
        audio.cue('lap-void');
      }
    }
  }
  if (!fxFinished && game.state === 'finished') {
    fxFinished = true;
    if (run && def) {
      if (run.phase === 'complete') {
        if (def.layout === 'urban') {
          audio.cue('outcome-escaped');
        } else {
          const medal = medalFor(def, game.handling.id, run.result?.value);
          audio.cue(medal ? `outcome-${medal}` : 'outcome-escaped');
        }
      } else {
        audio.cue(run.reason === 'busted' ? 'outcome-busted' : 'outcome-failed');
      }
    } else if (game.mode === 'normal') {
      const b = records.newBests;
      // The last round of a Tour ends on the Tour's own result: its trophy, if it won one.
      const trophy = tourScreen === 'final' ? tourTrophyCue() : null;
      audio.cue(trophy ?? ((b.score || b.fastestLap || b.bestCombo) ? 'outcome-record' : 'outcome-circuit'));
    }
  }
  if (game.scoring.eventSerial !== fxScoreSerial) {
    fxScoreSerial = game.scoring.eventSerial;
    const se = game.scoring.event;
    if (game.challengeDef?.mission !== 'driver' && game.mode !== 'practice') {
      if (se?.type === 'banked') {
        const tier = se.points >= 600 ? 3 : se.points >= 250 ? 2 : 1;
        audio.cue('bank', tier);
      } else if (se?.type === 'lost') {
        audio.cue('combo-lost');
      }
    }
  }
}

// --- Loop ------------------------------------------------------------------
let last = performance.now();
function frame(now) {
  const dt = Math.max(0, (now - last) / 1000);
  last = now;
  const padDrive = pollController();
  const drivingInput = arbiter.resolve(input, padDrive);
  if (arbiter.source === 'controller') instructionDevice = 'controller';
  else if (Object.values(input).some(Boolean)) instructionDevice = 'keyboard';
  advance(game, dt, drivingInput);
  if (tourRoundLive && game.state === 'racing' && tourDriving === null) markTourDriving();
  if (tourFinish) settleTourRound();
  if (tutorial) {
    updateTutorial(tutorial, game);
    if (tutorial.phase === 'complete') finishTutorial();
    else if (game.state === 'finished') restart(); // three laps mustn't end a lesson with no time limit
  }
  analytics?.frame({ runId: game.runId, category: analyticsCategory(), racing: game.state === 'racing' && !game.paused,
    active: drivingActive(drivingInput) });
  if (game.state !== shownState) {
    shownState = game.state;
    syncScreens();
  }
  audio.update(game, dt);
  playSmashSounds();
  playFxSounds(dt);
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
$('tracks-open').focus();
// A small read-only hook for the browser checks and tuning from the console.
window.__miniDrifters = { game, input, projectOnTrack, selectedTrack: () => selectedTrackId,
  selectedHandling: () => selectedHandlingId, sessionKind: () => game.mode,
  referenceGhost: () => ({ slot: referenceGhosts.slot && { ...referenceGhosts.slot, recording: undefined }, lastResult: referenceGhosts.lastResult, source: game.ghostSource, shown: !!game.ghostReference }), gymkhana: () => ({ open: challengePicker(), selected: gymkhana.selected().id }), drawnTrack: () => renderer.track.id, effects: () => effectsSnapshot(renderer), audio: () => audio.snapshot(), tutorial: () => tutorial && structuredClone(tutorial),
  smashSounds: () => ({ ...audio.smashes }), fxAudio: () => ({ ...audio.fx }),
  tour: () => ({ screen: tourScreen, live: tourRoundLive, joker: tourJoker, driving: tourDriving,
    state: tour && structuredClone(tour), choice: { ...tourChoice }, picker }) };
requestAnimationFrame(frame);
