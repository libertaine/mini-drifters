// The radio and the sound settings against a fake Web Audio graph. Real playback and
// real keys are covered by test/radio-browser.mjs.
import test from 'node:test';
import assert from 'node:assert/strict';
import { GameAudio } from '../src/audio.js';
import { DEFAULT_EFFECTS_VOLUME, DEFAULT_MUSIC_VOLUME, readAudioPreferences, volumeGain, writeAudioPreferences } from '../src/audio-preferences.js';
import { FADE_IN, FADE_OUT, MUSIC_LEVEL, RadioPlayer, loadTrack } from '../src/radio.js';
import { DEFAULT_STATION, RADIO_FILES, RADIO_OFF, STATIONS, stationById } from '../src/radio-stations.js';
import { advance, createGame, restartRun, startRun, togglePause } from '../src/game.js';
import { driftDriver } from './support/drivers.mjs';

class Param {
  constructor() { this.value = 0; this.target = 0; this.events = []; }
  cancelAndHoldAtTime() {}
  cancelScheduledValues(time) { this.events.push(['cancel', time]); }
  setValueAtTime(value, time) { this.value = value; this.events.push(['set', value, time]); }
  setTargetAtTime(value) {
    assert.ok(Number.isFinite(value));
    this.value = value; this.target = value;
  }
  linearRampToValueAtTime(value, time) { this.value = value; this.events.push(['ramp', value, time]); }
}
class FakeNode {
  constructor(context) {
    this.context = context;
    for (const key of ['gain', 'frequency', 'Q', 'playbackRate', 'threshold', 'knee', 'ratio', 'attack', 'release', 'detune']) this[key] = new Param();
    this.startTimes = []; this.stopTimes = []; this.disconnected = 0; this.target = null;
  }
  connect(target) { this.target = target; return target; }
  disconnect() { this.disconnected += 1; }
  start(time = 0) { this.startTimes.push(time); }
  stop(time = this.context.currentTime) { this.stopTimes.push(time); }
}
class FakeContext {
  constructor() {
    this.currentTime = 0; this.sampleRate = 8000; this.state = 'suspended';
    this.destination = new FakeNode(this); this.nodes = [];
    this.resumes = 0; this.suspends = 0;
  }
  make() { const node = new FakeNode(this); this.nodes.push(node); return node; }
  createGain() { return this.make(); }
  createOscillator() { return this.make(); }
  createBufferSource() { return this.make(); }
  createBiquadFilter() { return this.make(); }
  createDynamicsCompressor() { return this.make(); }
  createBuffer(channels, length, sampleRate) {
    const data = Array.from({ length: channels }, () => new Float32Array(length));
    return { length, numberOfChannels: channels, sampleRate, duration: length / sampleRate, getChannelData: (c) => data[c] };
  }
  async resume() { this.resumes += 1; this.state = 'running'; }
  async suspend() { this.suspends += 1; this.state = 'suspended'; }
  async close() { this.state = 'closed'; }
  // Music tracks are the sources with a buffer that has a title on it.
  get tracks() { return this.nodes.filter((n) => n.buffer?.title); }
  get playing() { return this.tracks.filter((n) => n.stopTimes.length === 0); }
  // What a real context does on its own: report sources whose stop time has passed.
  settle() {
    for (const node of this.tracks) {
      if (node.onended && node.stopTimes.length && node.stopTimes[0] <= this.currentTime) node.onended();
    }
  }
}

const flush = async () => { for (let i = 0; i < 6; i++) await new Promise((r) => setImmediate(r)); };
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const memoryStorage = (saved = new Map()) => ({ saved, getItem: (k) => saved.get(k) ?? null, setItem: (k, v) => saved.set(k, String(v)) });
const buffer = (track, duration = 20) => ({ title: track.id, duration, numberOfChannels: 1 });
const engineBank = { idle: {}, mid: {}, load: {}, high: {} };

function setup(options = {}) {
  const contexts = [];
  const loads = [];
  const changes = [];
  const audio = new GameAudio({
    contextFactory: () => { const c = new FakeContext(); contexts.push(c); return c; },
    coyoteEnabled: true,
    coyoteLoader: async () => ({ buffers: engineBank, failures: [] }),
    tireLoader: async () => ({ buffer: {}, failures: [] }),
    trackLoader: async (ctx, track) => { loads.push(track.id); return buffer(track); },
    storage: memoryStorage(),
    onChange: (s) => changes.push(s),
    ...options,
  });
  return { audio, contexts, loads, changes, game: createGame() };
}
const garage = 'garage-rock', synth = 'synth-fm', redline = 'redline-radio';
const radio = (audio) => audio.snapshot().radio;

// --- Stations ---------------------------------------------------------------------

test('the list has three music stations and Radio Off, each with a name and a unique id', () => {
  assert.deepEqual(STATIONS.map((s) => s.name), ['Garage Rock', 'Synth FM', 'Redline Radio', 'Radio Off']);
  assert.equal(new Set(STATIONS.map((s) => s.id)).size, 4);
  assert.deepEqual(stationById(RADIO_OFF).tracks, []);
  for (const station of STATIONS.filter((s) => s.id !== RADIO_OFF)) {
    assert.ok(station.tracks.length >= 1, station.id);
    for (const track of station.tracks) {
      assert.ok(track.id && track.title && track.file && track.license, track.id);
      assert.ok(RADIO_FILES.includes(track.file), track.file);
    }
  }
});

test('every station, and Radio Off, can be selected', async () => {
  const { audio, game } = setup();
  for (const { id } of STATIONS) {
    audio.setStation(id, game);
    await flush();
    assert.equal(audio.snapshot().station, id);
    assert.equal(radio(audio).station, id);
    assert.equal(radio(audio).status, id === RADIO_OFF ? 'off' : 'playing');
  }
});

test('a station plays from its own track list', async () => {
  const { audio, game, contexts, loads } = setup();
  for (const { id, tracks } of STATIONS.filter((s) => s.tracks.length)) {
    loads.length = 0;
    audio.setStation(id, game);
    await flush();
    assert.deepEqual(loads, [tracks[0].id]);
    assert.equal(radio(audio).track, tracks[0].id);
  }
  assert.equal(contexts.length, 1);
});

test('an unknown station is ignored', async () => {
  const { audio, game, contexts } = setup();
  audio.setStation('polka', game);
  await flush();
  assert.equal(audio.snapshot().station, DEFAULT_STATION);
  assert.equal(contexts.length, 0);
});

test('N walks through every station in order and wraps', () => {
  const { audio, game } = setup();
  const seen = [];
  for (let i = 0; i < STATIONS.length + 1; i++) {
    audio.nextStation(game);
    seen.push(audio.snapshot().station);
  }
  assert.deepEqual(seen, [garage, synth, redline, RADIO_OFF, garage]);
});

test('a one-track station loops, and a longer list plays in order and wraps', async () => {
  const stations = [
    { id: 'one', name: 'One', tracks: [{ id: 'solo', title: 'Solo', file: 'a.wav', license: 'x' }] },
    { id: 'many', name: 'Many', tracks: ['a', 'b', 'c'].map((id) => ({ id, title: id, file: `${id}.wav`, license: 'x' })) },
    { id: RADIO_OFF, name: 'Off', tracks: [] },
  ];
  const { audio, game, contexts } = setup({ stations, trackLoader: async (_, track) => buffer(track, 5) });
  audio.setStation('one', game);
  await flush();
  assert.equal(contexts[0].playing[0].loop, true);
  audio.setStation('many', game);
  await flush();
  const seen = [radio(audio).track];
  for (let i = 0; i < 3; i++) {
    const current = contexts[0].playing.at(-1);
    assert.equal(current.loop, false);
    current.stopTimes.push(0); // what a source that has ended looks like here
    current.onended();
    await flush();
    seen.push(radio(audio).track);
    assert.equal(radio(audio).active, 1);
  }
  assert.deepEqual(seen, ['a', 'b', 'c', 'a']);
});

// --- Autoplay and lifecycle ---------------------------------------------------------

test('a saved station waits for the player: nothing exists until a key or click', async () => {
  const storage = memoryStorage();
  writeAudioPreferences(storage, { station: garage, musicVolume: 50, effectsVolume: 50 });
  const { audio, contexts, game } = setup({ storage });
  for (let i = 0; i < 10; i++) audio.update(game, 1 / 60);
  audio.setPageActive(true, game);
  await flush();
  assert.equal(contexts.length, 0);
  assert.equal(radio(audio).status, 'waiting');
  audio.interaction(game);
  assert.equal(contexts.length, 1);
  assert.equal(contexts[0].resumes, 1, 'resume ran inside the gesture');
  await flush();
  assert.equal(radio(audio).status, 'playing');
});

test('with the radio off, interaction changes nothing, so the old behavior is untouched', async () => {
  const { audio, contexts, game } = setup();
  assert.equal(audio.snapshot().station, RADIO_OFF);
  audio.interaction(game);
  await flush();
  assert.equal(contexts.length, 0);
});

test('a muted game ignores interaction, and unmuting starts the saved station', async () => {
  const storage = memoryStorage(new Map([['mini-drifters-sound', 'off']]));
  writeAudioPreferences(storage, { station: synth, musicVolume: 50, effectsVolume: 50 });
  const { audio, contexts, game } = setup({ storage });
  audio.interaction(game);
  await flush();
  assert.equal(contexts.length, 0);
  audio.setMuted(false, game);
  await flush();
  assert.equal(contexts.length, 1);
  assert.equal(radio(audio).track, 'synth-fm-test');
});

test('menu and game transitions never restart the track or add a player', async () => {
  const { audio, contexts, loads, game } = setup();
  audio.setStation(garage, game);
  await flush();
  const before = radio(audio);
  assert.equal(before.starts, 1);
  startRun(game);
  audio.newRun(game);
  await flush();
  for (let i = 0; i < 30; i++) audio.update(game, 1 / 60);
  restartRun(game);
  audio.newRun(game);
  togglePause(game);
  audio.gesture(game);
  await wait(120);
  assert.equal(contexts[0].state, 'running', 'pausing the car does not stop the radio');
  togglePause(game);
  audio.gesture(game);
  game.state = 'finished';
  for (let i = 0; i < 30; i++) audio.update(game, 1 / 60);
  startRun(game);
  audio.newRun(game);
  await flush();
  const after = radio(audio);
  assert.equal(after.starts, 1);
  assert.equal(after.track, before.track);
  assert.equal(after.active, 1);
  assert.deepEqual(loads, ['garage-rock-test']);
  assert.equal(contexts.length, 1);
  assert.equal(contexts[0].playing.length, 1);
});

test('repeated switching ends with one track, and nothing overlaps', async () => {
  const { audio, contexts, game } = setup();
  const order = [garage, synth, redline];
  audio.setStation(garage, game);
  await flush();
  const ctx = contexts[0];
  for (let i = 0; i < 40; i++) {
    ctx.currentTime += i % 3 === 0 ? 0.05 : 0.5; // both mid-fade and settled
    ctx.settle();
    audio.setStation(order[i % 3], game);
    await flush();
    assert.ok(ctx.playing.length <= 1, `${ctx.playing.length} tracks at step ${i}`);
    assert.ok(radio(audio).active <= 2, 'one playing and the last one still fading');
  }
  assert.equal(contexts.length, 1);
  // Each track that was heard stopped before the next one began.
  const heard = ctx.tracks.filter((n) => n.startTimes.length).sort((a, b) => a.startTimes[0] - b.startTimes[0]);
  for (let i = 1; i < heard.length; i++) {
    const previous = heard[i - 1];
    if (previous.stopTimes[0] > previous.startTimes[0]) assert.ok(heard[i].startTimes[0] >= previous.stopTimes[0], `overlap at ${i}`);
  }
});

test('a change of station fades the old track out, then fades the new one in', async () => {
  const { audio, contexts, game } = setup();
  audio.setStation(garage, game);
  await flush();
  const ctx = contexts[0];
  const first = ctx.playing[0];
  ctx.currentTime = 5;
  audio.setStation(synth, game);
  await flush();
  assert.deepEqual(first.stopTimes, [5 + FADE_OUT]);
  const firstGain = ctx.nodes[ctx.nodes.indexOf(first) + 1].gain.events;
  assert.deepEqual(firstGain.slice(-3), [['cancel', 5], ['set', 1, 5], ['ramp', 0, 5 + FADE_OUT]]);
  const second = ctx.playing[0];
  assert.equal(second.buffer.title, 'synth-fm-test');
  assert.deepEqual(second.startTimes, [5 + FADE_OUT]);
  const secondGain = ctx.nodes[ctx.nodes.indexOf(second) + 1].gain.events;
  assert.deepEqual(secondGain.slice(0, 2), [['set', 0, 5 + FADE_OUT], ['ramp', 1, 5 + FADE_OUT + FADE_IN]]);
});

test('a change partway through a fade-in starts from where the level had reached', async () => {
  const { audio, contexts, game } = setup();
  audio.setStation(garage, game);
  await flush();
  const ctx = contexts[0];
  const first = ctx.playing[0];
  ctx.currentTime = FADE_IN / 2;
  audio.setStation(synth, game);
  const events = ctx.nodes[ctx.nodes.indexOf(first) + 1].gain.events;
  assert.deepEqual(events.at(-2), ['set', 0.5, FADE_IN / 2]);
});

test('a track still waiting for a fade is dropped unheard if the player moves on', async () => {
  const { audio, contexts, game } = setup();
  audio.setStation(garage, game);
  await flush();
  const ctx = contexts[0];
  ctx.currentTime = 2;
  audio.setStation(synth, game);
  await flush();
  const waiting = ctx.playing[0];
  assert.ok(waiting.startTimes[0] > ctx.currentTime);
  audio.setStation(redline, game);
  await flush();
  assert.equal(waiting.stopTimes.length, 1);
  assert.equal(ctx.playing.length, 1);
  assert.equal(ctx.playing[0].buffer.title, 'redline-radio-test');
});

test('a slow load that the player has moved on from never plays', async () => {
  const gates = new Map();
  const { audio, contexts, game } = setup({
    trackLoader: (_, track) => new Promise((resolve) => gates.set(track.id, () => resolve(buffer(track)))),
  });
  audio.setStation(garage, game);
  await flush();
  audio.setStation(synth, game);
  await flush();
  gates.get('synth-fm-test')();
  await flush();
  gates.get('garage-rock-test')();
  await flush();
  assert.equal(contexts[0].playing.length, 1);
  assert.equal(radio(audio).track, 'synth-fm-test');
});

test('radio tracks are decoded once, and only the last two stay in memory', async () => {
  const { audio, loads, game } = setup();
  for (const id of [garage, synth, garage, synth]) {
    audio.setStation(id, game);
    await flush();
  }
  assert.deepEqual(loads, ['garage-rock-test', 'synth-fm-test']);
  audio.setStation(redline, game);
  await flush();
  assert.equal(audio.session.radio.buffers.size, 2);
  assert.ok(!audio.session.radio.buffers.has(stationById(garage).tracks[0].file));
});

// --- Independent controls -----------------------------------------------------------

test('Radio Off stops the music and leaves effects playing', async () => {
  const { audio, contexts, game } = setup();
  startRun(game);
  audio.setStation(redline, game);
  audio.newRun(game);
  await flush();
  const engineSources = audio.snapshot().sourceCount;
  const ctx = contexts[0];
  assert.equal(ctx.playing.length, 1);
  audio.setStation(RADIO_OFF, game);
  await flush();
  assert.equal(ctx.playing.length, 0);
  assert.equal(radio(audio).status, 'off');
  assert.equal(audio.snapshot().mode, 'live');
  assert.equal(audio.session.gate.gain.target, 1);
  assert.equal(audio.session.effects.gain.value, volumeGain(100));
  assert.equal(audio.snapshot().sourceCount, engineSources);
  assert.equal(engineSources, 5);
});

test('Radio Off on a quiet screen lets the context suspend once its fade is done', async () => {
  const { audio, contexts, game } = setup();
  audio.setStation(garage, game);
  await flush();
  assert.equal(contexts[0].state, 'running');
  audio.setStation(RADIO_OFF, game);
  await wait(FADE_OUT * 1000 / 2);
  assert.equal(contexts[0].state, 'running', 'the fade gets to finish');
  await wait(FADE_OUT * 1000 / 2 + 150);
  assert.equal(contexts[0].state, 'suspended');
});

test('music volume never changes effects, and effects volume never changes music', async () => {
  const { audio, game } = setup();
  startRun(game);
  audio.setStation(garage, game);
  audio.newRun(game);
  await flush();
  const { musicBus, effects, gate, musicGate } = audio.session;
  const reading = () => [musicBus.gain.value, effects.gain.value, gate.gain.target, musicGate.gain.target];
  let [music, fx, fxGate, mGate] = reading();
  audio.setMusicVolume(25);
  assert.equal(musicBus.gain.value, MUSIC_LEVEL * volumeGain(25));
  assert.notEqual(musicBus.gain.value, music);
  assert.deepEqual([effects.gain.value, gate.gain.target, musicGate.gain.target], [fx, fxGate, mGate]);
  [music, fx, fxGate, mGate] = reading();
  audio.setEffectsVolume(40);
  assert.equal(effects.gain.value, volumeGain(40));
  assert.notEqual(effects.gain.value, fx);
  assert.deepEqual([musicBus.gain.value, gate.gain.target, musicGate.gain.target], [music, fxGate, mGate]);
  assert.equal(audio.snapshot().musicVolume, 25);
  assert.equal(audio.snapshot().effectsVolume, 40);
});

test('each volume sits on its own path to the output', async () => {
  const { audio, contexts, game } = setup();
  startRun(game);
  audio.setStation(garage, game);
  audio.newRun(game);
  await flush();
  const { musicBus, musicGate, effects, gate, master } = audio.session;
  const { destination } = contexts[0];
  assert.equal(master.target, gate);
  assert.equal(gate.target, effects);
  assert.equal(effects.target, destination);
  assert.equal(musicBus.target, musicGate);
  assert.equal(musicGate.target, destination);
});

test('effects at 100% are exactly the mix from before volumes existed', () => {
  assert.equal(volumeGain(100), 1);
  assert.equal(volumeGain(0), 0);
  assert.equal(volumeGain(50), 0.25);
});

test('music volume 0 is silent and keeps the station', async () => {
  const { audio, game } = setup();
  audio.setStation(synth, game);
  await flush();
  audio.setMusicVolume(0);
  assert.equal(audio.session.musicBus.gain.value, 0);
  assert.equal(audio.snapshot().station, synth);
  assert.equal(radio(audio).status, 'playing');
  audio.setMusicVolume(60);
  assert.equal(audio.session.musicBus.gain.value, MUSIC_LEVEL * volumeGain(60));
  assert.equal(radio(audio).starts, 1, 'turning it back up does not restart the track');
});

test('master mute silences music and effects, and unmuting restores every setting', async () => {
  const { audio, contexts, game } = setup();
  startRun(game);
  audio.setStation(redline, game);
  audio.newRun(game);
  audio.setMusicVolume(35);
  audio.setEffectsVolume(45);
  await flush();
  audio.setMuted(true, game);
  assert.equal(audio.session.gate.gain.target, 0);
  assert.equal(audio.session.musicGate.gain.target, 0);
  await wait(120);
  assert.equal(contexts[0].state, 'suspended');
  const s = audio.snapshot();
  assert.deepEqual([s.station, s.musicVolume, s.effectsVolume], [redline, 35, 45]);
  audio.setMuted(false, game);
  await flush();
  const back = audio.snapshot();
  assert.deepEqual([back.station, back.musicVolume, back.effectsVolume], [redline, 35, 45]);
  assert.equal(audio.session.gate.gain.target, 1);
  assert.equal(audio.session.musicGate.gain.target, 1);
  assert.equal(audio.session.musicBus.gain.value, MUSIC_LEVEL * volumeGain(35));
  assert.equal(audio.session.effects.gain.value, volumeGain(45));
  assert.equal(contexts[0].state, 'running');
  assert.equal(radio(audio).starts, 1, 'the same track carries on');
  assert.equal(contexts.length, 1);
});

test('changing station while muted makes no sound, and is what plays on unmuting', async () => {
  const { audio, contexts, game } = setup();
  audio.setStation(garage, game);
  await flush();
  audio.setMuted(true, game);
  await wait(120);
  const ctx = contexts[0];
  const old = ctx.playing[0];
  audio.setStation(synth, game);
  await flush();
  assert.equal(ctx.state, 'suspended');
  assert.equal(old.stopTimes.length, 1, 'stopped outright: there is nothing to fade');
  audio.setMuted(false, game);
  await flush();
  assert.equal(radio(audio).track, 'synth-fm-test');
  assert.equal(ctx.playing.length, 1);
  assert.equal(ctx.state, 'running');
});

// --- Page state ---------------------------------------------------------------------

test('losing focus silences the music, and it carries on when the page returns', async () => {
  const { audio, contexts, game } = setup();
  audio.setStation(garage, game);
  await flush();
  audio.setPageActive(false, game);
  assert.equal(audio.session.musicGate.gain.target, 0);
  await wait(120);
  assert.equal(contexts[0].state, 'suspended');
  audio.setPageActive(true, game);
  await flush();
  assert.equal(audio.session.musicGate.gain.target, 1);
  assert.equal(contexts[0].state, 'running');
  assert.equal(radio(audio).starts, 1);
  assert.equal(contexts[0].playing.length, 1);
});

test('returning to a paused race brings back the radio but not the engine', async () => {
  const { audio, contexts, game } = setup();
  startRun(game);
  audio.setStation(garage, game);
  audio.newRun(game);
  await flush();
  togglePause(game);
  audio.setPageActive(false, game);
  await wait(120);
  audio.setPageActive(true, game);
  await flush();
  assert.equal(audio.snapshot().mode, 'silent');
  assert.equal(audio.session.gate.gain.target, 0);
  assert.equal(audio.session.musicGate.gain.target, 1);
  assert.equal(contexts[0].state, 'running');
});

test('a hidden tab stays silent even if a frame slips through', async () => {
  let hidden = false;
  const { audio, contexts, game } = setup({ isHidden: () => hidden });
  audio.setStation(garage, game);
  await flush();
  hidden = true;
  audio.setPageActive(false, game);
  audio.update(game, 1 / 60);
  await wait(120);
  assert.equal(audio.session.musicGate.gain.target, 0);
  assert.equal(contexts[0].state, 'suspended');
  assert.equal(contexts[0].resumes, 1);
  hidden = false;
});

test('a system interruption on the menu is revived while the radio is wanted', async () => {
  const { audio, contexts, game } = setup();
  audio.setStation(garage, game);
  await flush();
  contexts[0].state = 'interrupted';
  await wait(1100);
  audio.update(game, 1 / 60);
  await flush();
  assert.equal(contexts[0].state, 'running');
});

test('dispose stops the track, disconnects everything and allows no late start', async () => {
  let release;
  const { audio, contexts, game } = setup({
    trackLoader: (_, track) => new Promise((resolve) => { release = () => resolve(buffer(track)); }),
  });
  audio.setStation(garage, game);
  await flush();
  audio.dispose();
  release();
  await flush();
  const ctx = contexts[0];
  assert.equal(ctx.state, 'closed');
  assert.equal(ctx.playing.length, 0);
  assert.equal(ctx.tracks.length, 0, 'the late result never built a source');
});

test('dispose with a track playing releases every node once', async () => {
  const { audio, contexts, game } = setup();
  audio.setStation(garage, game);
  await flush();
  audio.dispose();
  const ctx = contexts[0];
  assert.equal(ctx.playing.length, 0);
  for (const node of ctx.nodes) assert.equal(node.disconnected, 1);
});

// --- Failures -----------------------------------------------------------------------

test('a missing track never stops the game or the effects, and is reported', async () => {
  const { audio, game } = setup({ trackLoader: async () => { throw new Error('HTTP 404'); } });
  startRun(game);
  audio.setStation(garage, game);
  audio.newRun(game);
  await flush();
  const s = audio.snapshot();
  assert.equal(s.radio.status, 'unavailable');
  assert.match(s.radio.failures[0], /garage-rock-test\.wav: HTTP 404/);
  assert.equal(s.failure, null);
  assert.equal(s.label, 'Sound On');
  assert.equal(s.mode, 'live');
  assert.equal(s.engine, 'coyote');
  assert.equal(s.sourceCount, 5);
  assert.doesNotThrow(() => { for (let i = 0; i < 10; i++) audio.update(game, 1 / 60); });
});

test('a failed station is retried only when the player selects it, then recovers', async () => {
  let broken = true;
  const loads = [];
  const { audio, game } = setup({
    trackLoader: async (_, track) => {
      loads.push(track.id);
      if (broken) throw new Error('HTTP 503');
      return buffer(track);
    },
  });
  audio.setStation(garage, game);
  await flush();
  assert.equal(radio(audio).status, 'unavailable');
  for (let i = 0; i < 30; i++) audio.update(game, 1 / 60);
  audio.gesture(game);
  await flush();
  assert.equal(loads.length, 1, 'frames and gestures do not hammer the server');
  broken = false;
  audio.setStation(garage, game);
  await flush();
  assert.equal(radio(audio).status, 'playing');
  assert.deepEqual(radio(audio).failures, []);
});

test('a bad track moves on to the next one, and only an all-bad station is unavailable', async () => {
  const stations = [
    { id: 'mixed', name: 'Mixed', tracks: ['bad', 'good'].map((id) => ({ id, title: id, file: `${id}.wav`, license: 'x' })) },
    { id: RADIO_OFF, name: 'Off', tracks: [] },
  ];
  const { audio, game } = setup({
    stations,
    trackLoader: async (_, track) => {
      if (track.id === 'bad') throw new Error('decode failed');
      return buffer(track);
    },
  });
  audio.setStation('mixed', game);
  await flush();
  assert.equal(radio(audio).track, 'good');
  assert.equal(radio(audio).status, 'playing');
  assert.equal(radio(audio).failures.length, 1);
});

test('a station with no tracks is unavailable, and harmless', async () => {
  const stations = [{ id: 'empty', name: 'Empty', tracks: [] }, { id: RADIO_OFF, name: 'Off', tracks: [] }];
  const { audio, game } = setup({ stations });
  audio.setStation('empty', game);
  await flush();
  assert.equal(radio(audio).status, 'unavailable');
  assert.equal(audio.snapshot().failure, null);
});

test('a graph failure while starting a track costs only the music', async () => {
  const contexts = [];
  const { audio, game } = setup({
    contextFactory: () => {
      const c = new FakeContext();
      const make = c.createBufferSource.bind(c);
      c.createBufferSource = () => {
        const node = make();
        const start = node.start.bind(node);
        node.start = (...a) => {
          if (node.buffer?.title) throw new Error('source refused');
          start(...a);
        };
        return node;
      };
      contexts.push(c);
      return c;
    },
  });
  startRun(game);
  audio.setStation(garage, game);
  audio.newRun(game);
  await flush();
  const s = audio.snapshot();
  assert.equal(s.radio.status, 'unavailable');
  assert.equal(s.failure, null);
  assert.equal(s.engine, 'coyote');
  assert.equal(contexts[0].state, 'running');
});

test('with no Web Audio at all, driving keys do not keep trying to rebuild it', () => {
  let attempts = 0;
  const storage = memoryStorage();
  writeAudioPreferences(storage, { station: garage, musicVolume: 70, effectsVolume: 100 });
  const { audio, game } = setup({ storage, contextFactory: () => { attempts += 1; throw new ReferenceError('AudioContext is not defined'); } });
  audio.interaction(game);
  assert.equal(attempts, 1);
  for (let i = 0; i < 10; i++) audio.interaction(game);
  assert.equal(attempts, 1);
  assert.equal(audio.snapshot().label, 'Sound Unavailable');
});

test('the track loader reports HTTP and decode failures, and asks only for its own path', async () => {
  const ctx = new FakeContext();
  const { signal } = new AbortController();
  const track = stationById(garage).tracks[0];
  await assert.rejects(() => loadTrack(ctx, track, signal, async () => ({ ok: false, status: 404 })), /HTTP 404/);
  ctx.decodeAudioData = async () => { throw new Error('bad wav'); };
  await assert.rejects(() => loadTrack(ctx, track, signal, async () => ({ ok: true, arrayBuffer: async () => new ArrayBuffer(4) })), /bad wav/);
  let asked;
  ctx.decodeAudioData = async () => ({ duration: 1 });
  await loadTrack(ctx, track, signal, async (url) => { asked = url; return { ok: true, arrayBuffer: async () => new ArrayBuffer(4) }; });
  assert.match(String(asked), /\/radio\/test-tracks\/garage-rock-test\.wav$/);
  assert.doesNotMatch(String(asked), /\/src\//);
});

test('switching stations aborts the load in progress', async () => {
  const signals = [];
  const ctx = new FakeContext();
  const player = new RadioPlayer(ctx, ctx.destination, { loader: (_, __, signal) => { signals.push(signal); return new Promise(() => {}); } });
  player.tune(garage);
  await flush();
  player.tune(synth);
  assert.equal(signals[0].aborted, true);
  await flush();
  player.dispose();
  assert.equal(signals[1].aborted, true);
});

// --- Preferences --------------------------------------------------------------------

test('settings come back after a reload', async () => {
  const storage = memoryStorage();
  const first = setup({ storage });
  first.audio.setStation(redline, first.game);
  first.audio.setMusicVolume(35);
  first.audio.setEffectsVolume(55);
  first.audio.setMuted(true, first.game);
  await flush();
  first.audio.dispose();
  const s = setup({ storage }).audio.snapshot();
  assert.deepEqual([s.station, s.musicVolume, s.effectsVolume, s.muted], [redline, 35, 55, true]);
});

test('the master mute keeps its original key, so existing choices survive', () => {
  const saved = new Map([['mini-drifters-sound', 'off']]);
  assert.equal(readAudioPreferences(memoryStorage(saved)).muted, true);
  const { audio, game } = setup({ storage: memoryStorage(saved) });
  audio.setMuted(false, game);
  assert.equal(saved.get('mini-drifters-sound'), 'on');
});

test('a first visit gets the defaults, with the radio off and effects at full', () => {
  const s = setup().audio.snapshot();
  assert.deepEqual([s.station, s.musicVolume, s.effectsVolume, s.muted], [RADIO_OFF, DEFAULT_MUSIC_VOLUME, DEFAULT_EFFECTS_VOLUME, false]);
  assert.equal(DEFAULT_STATION, RADIO_OFF);
  assert.equal(DEFAULT_EFFECTS_VOLUME, 100);
});

test('corrupt or out-of-range settings fall back safely, one value at a time', () => {
  const read = (value) => readAudioPreferences(memoryStorage(new Map([['mini-drifters-audio', value]])));
  assert.deepEqual(read('{oops'), { muted: false, station: DEFAULT_STATION, musicVolume: DEFAULT_MUSIC_VOLUME, effectsVolume: DEFAULT_EFFECTS_VOLUME });
  assert.equal(read('"garage-rock"').station, DEFAULT_STATION);
  assert.equal(read('null').station, DEFAULT_STATION);
  const mixed = read(JSON.stringify({ station: 'polka', musicVolume: 999, effectsVolume: -4 }));
  assert.deepEqual([mixed.station, mixed.musicVolume, mixed.effectsVolume], [DEFAULT_STATION, 100, 0]);
  const wrongType = read(JSON.stringify({ station: synth, musicVolume: '40', effectsVolume: null }));
  assert.deepEqual([wrongType.station, wrongType.musicVolume, wrongType.effectsVolume], [synth, DEFAULT_MUSIC_VOLUME, DEFAULT_EFFECTS_VOLUME]);
});

test('hostile storage only costs the memory', async () => {
  const hostile = { getItem() { throw new Error('denied'); }, setItem() { throw new Error('denied'); } };
  const { audio, game } = setup({ storage: hostile });
  assert.equal(audio.snapshot().station, DEFAULT_STATION);
  audio.setStation(garage, game);
  audio.setMusicVolume(10);
  audio.setEffectsVolume(20);
  await flush();
  const s = audio.snapshot();
  assert.deepEqual([s.station, s.musicVolume, s.effectsVolume, s.failure], [garage, 10, 20, null]);
  assert.equal(setup({ storage: null }).audio.snapshot().station, DEFAULT_STATION);
});

// --- The driving experience ---------------------------------------------------------

test('a full run is identical to the last digit with the radio changing throughout', async () => {
  const fingerprint = (game) => {
    const { car, scoring, laps } = game;
    return JSON.stringify({
      state: game.state, ticks: game.ticks, runTime: game.runTime, x: car.x, y: car.y, heading: car.heading, vx: car.vx, vy: car.vy,
      score: scoring.score, spinouts: scoring.spinouts, completed: laps.completed, bestLap: laps.bestLap, results: game.results,
      ghostFrames: game.ghost?.replay?.length ?? null,
    });
  };
  const run = (withRadio) => {
    const game = createGame();
    startRun(game);
    const driver = driftDriver();
    const { audio } = withRadio ? setup() : { audio: null };
    audio?.newRun(game);
    for (let frame = 0; frame < 60 * 240 && game.state !== 'finished'; frame++) {
      advance(game, 1 / 60, driver(game));
      audio?.update(game, 1 / 60);
      if (frame % 300 === 0) audio?.nextStation(game);
      if (frame % 700 === 0) audio?.setMusicVolume(frame % 100);
      if (frame % 900 === 0) audio?.setEffectsVolume(frame % 100);
    }
    audio?.dispose();
    return fingerprint(game);
  };
  assert.equal(run(true), run(false));
  await flush();
});
