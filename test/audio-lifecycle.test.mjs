// The controller's lifecycle against a fake Web Audio graph. Graph behaviour and
// real playback are covered by test/gameplay-audio-browser.mjs.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { GameAudio } from '../src/audio.js';
import { createProcedural, createTireVoice, loadTire } from '../src/audio-voices.js';
import { advance, createGame, restartRun, startRun, tick, togglePause } from '../src/game.js';
import { TUNING } from '../src/tuning.js';
import { driftDriver } from './support/drivers.mjs';

class Param {
  constructor(context) { this.context = context; this.value = 0; this.target = 0; this.scheduled = 0; }
  cancelAndHoldAtTime() {}
  cancelScheduledValues() {}
  setValueAtTime(value) { this.value = value; }
  setTargetAtTime(value) {
    if (!Number.isFinite(value)) throw new TypeError(`non-finite audio parameter ${value}`);
    this.value = value; this.target = value; this.scheduled += 1;
  }
}
class FakeNode {
  constructor(context) {
    this.context = context;
    for (const key of ['gain', 'frequency', 'Q', 'playbackRate', 'threshold', 'knee', 'ratio', 'attack', 'release', 'detune']) this[key] = new Param(context);
    this.started = 0; this.stopped = 0; this.disconnected = 0;
  }
  connect(target) { return target; }
  disconnect() { this.disconnected += 1; }
  start() { this.started += 1; }
  stop() { this.stopped += 1; }
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
  get sources() { return this.nodes.filter((n) => n.started > n.stopped); }
}

const TIRE = {};
const coyoteBank = { idle: {}, mid: {}, load: {}, high: {} };
const fullBank = async () => ({ buffers: coyoteBank, failures: [] });
const tireOk = async () => ({ buffer: TIRE, failures: [] });
const flush = async () => { for (let i = 0; i < 5; i++) await new Promise((r) => setImmediate(r)); };
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

function setup(options = {}) {
  const contexts = [];
  const changes = [];
  const audio = new GameAudio({
    contextFactory: () => { const c = new FakeContext(); contexts.push(c); return c; },
    coyoteEnabled: true,
    coyoteLoader: fullBank,
    tireLoader: tireOk,
    storage: null,
    onChange: (s) => changes.push(s),
    ...options,
  });
  return { audio, contexts, changes, game: createGame() };
}
const gateTarget = (audio) => audio.session.gate.gain.target;

async function startDriving(env) {
  startRun(env.game);
  env.audio.newRun(env.game);
  await flush();
  return env;
}

test('the menu is silent and creates nothing until a gesture starts a run', async () => {
  const { audio, contexts, game } = setup();
  for (let i = 0; i < 10; i++) audio.update(game, 1 / 60);
  await flush();
  assert.equal(contexts.length, 0);
  assert.equal(audio.snapshot().mode, 'silent');
  assert.equal(audio.snapshot().contextState, 'closed');
});

test('starting a run opens one context in the gesture and plays the idle engine', async () => {
  const env = setup();
  const { audio, contexts, game } = env;
  startRun(game);
  audio.newRun(game);
  assert.equal(contexts.length, 1);
  assert.equal(contexts[0].resumes, 1, 'resume ran synchronously inside the gesture');
  await flush();
  const s = audio.snapshot();
  assert.equal(s.mode, 'live');
  assert.equal(s.engine, 'coyote');
  assert.equal(s.tire, 'ready');
  assert.equal(s.sourceCount, 5, 'four Coyote layers and one tire loop');
  assert.equal(gateTarget(audio), 1);
  assert.equal(s.rpm, 750);
});

test('a context that is already running when created still loads its voices', async () => {
  const env = setup({ contextFactory: () => { const c = new FakeContext(); c.state = 'running'; env.made.push(c); return c; } });
  env.made = [];
  startRun(env.game);
  env.audio.newRun(env.game);
  await flush();
  assert.equal(env.made.length, 1);
  assert.equal(env.audio.snapshot().engine, 'coyote');
  assert.equal(env.audio.snapshot().tire, 'ready');
});

test('production builds one engine voice, never all three lab voices', async () => {
  const { audio, contexts } = await startDriving(setup());
  // Coyote 4 + tire 1. The lab would run 8 + 3 + 4 = 15.
  assert.equal(contexts[0].sources.length, 5);
  assert.equal(audio.snapshot().sourceCount, 5);
  const fallback = await startDriving(setup({ coyoteEnabled: false }));
  assert.equal(fallback.audio.snapshot().engine, 'fallback');
  // Oscillators 4 + flutter + hiss for the engine, tire 1. No procedural tire oscillators.
  assert.equal(fallback.contexts[0].sources.length, 7);
});

test('public hosting never asks for the private recordings and is never called Coyote', async () => {
  let asked = 0;
  const { audio } = await startDriving(setup({ coyoteEnabled: false, coyoteLoader: async () => { asked += 1; return { buffers: {}, failures: [] }; } }));
  assert.equal(asked, 0);
  assert.equal(audio.snapshot().engine, 'fallback');
});

test('missing or partial Coyote banks fall back to the labelled synthetic engine', async () => {
  const partial = await startDriving(setup({ coyoteLoader: async () => ({ buffers: { idle: {} }, failures: ['mid.wav: HTTP 404'] }) }));
  assert.equal(partial.audio.snapshot().engine, 'fallback');
  assert.deepEqual(partial.audio.snapshot().engineFailures, ['mid.wav: HTTP 404']);
  assert.equal(partial.audio.snapshot().sourceCount, 7);
  const thrown = await startDriving(setup({ coyoteLoader: async () => { throw new Error('decode exploded'); } }));
  assert.equal(thrown.audio.snapshot().engine, 'fallback');
  assert.equal(thrown.audio.snapshot().label, 'Sound On');
});

test('a failed tire load leaves the engine running and the tires silent', async () => {
  const { audio } = await startDriving(setup({ tireLoader: async () => ({ buffer: null, failures: ['tire-foley.mp3: HTTP 404'] }) }));
  const s = audio.snapshot();
  assert.equal(s.tire, 'unavailable');
  assert.deepEqual(s.tireFailures, ['tire-foley.mp3: HTTP 404']);
  assert.equal(s.engine, 'coyote');
  assert.equal(s.mode, 'live');
});

test('tire loading reports HTTP and decode failures rather than throwing', async () => {
  const ctx = new FakeContext();
  const signal = new AbortController().signal;
  const http = await loadTire(ctx, signal, async () => ({ ok: false, status: 404 }));
  assert.equal(http.buffer, null);
  assert.match(http.failures[0], /HTTP 404/);
  ctx.decodeAudioData = async () => { throw new Error('bad mp3'); };
  const corrupt = await loadTire(ctx, signal, async () => ({ ok: true, arrayBuffer: async () => new ArrayBuffer(4) }));
  assert.match(corrupt.failures[0], /bad mp3/);
});

test('pause silences at once, suspends the context, and P brings it back', async () => {
  const { audio, contexts, game } = await startDriving(setup());
  togglePause(game);
  audio.gesture(game);
  assert.equal(audio.snapshot().mode, 'silent');
  assert.equal(gateTarget(audio), 0);
  await wait(120);
  assert.equal(contexts[0].state, 'suspended');
  togglePause(game);
  audio.gesture(game);
  await flush();
  assert.equal(audio.snapshot().mode, 'live');
  assert.equal(gateTarget(audio), 1);
  assert.equal(contexts[0].state, 'running');
  assert.equal(contexts.length, 1);
});

test('losing focus or hiding the tab silences, and returning does not restart sound', async () => {
  let hidden = false;
  const { audio, contexts, game } = await startDriving(setup({ isHidden: () => hidden }));
  // What main.js does: the game pauses, then the audio is told directly.
  togglePause(game);
  audio.setPageActive(false, game);
  assert.equal(gateTarget(audio), 0);
  await wait(120);
  assert.equal(contexts[0].state, 'suspended');
  audio.setPageActive(true, game);
  for (let i = 0; i < 5; i++) audio.update(game, 1 / 60);
  await flush();
  assert.equal(audio.snapshot().mode, 'silent', 'the game is still paused');
  assert.equal(contexts[0].state, 'suspended');
  assert.equal(contexts[0].resumes, 1);

  // Tab hidden, with no frames running to notice it.
  togglePause(game);
  audio.gesture(game);
  await flush();
  assert.equal(audio.snapshot().mode, 'live');
  hidden = true;
  audio.setPageActive(false, game);
  assert.equal(gateTarget(audio), 0);
  audio.update(game, 1 / 60);
  assert.equal(audio.snapshot().mode, 'silent', 'still silent if a frame slips through');
  hidden = false;
});

test('focus lost during the finish fade cuts the sound, and returning stays quiet', async () => {
  const { audio, contexts, game } = await startDriving(setup());
  game.state = 'finished';
  audio.update(game, 1 / 60);
  assert.equal(audio.snapshot().mode, 'fade');
  audio.setPageActive(false, game);
  assert.equal(audio.snapshot().mode, 'silent');
  await wait(120);
  audio.setPageActive(true, game);
  assert.equal(contexts[0].state, 'suspended');
  assert.equal(contexts[0].resumes, 1);
});

test('finishing fades the engine, forces the tires quiet and then suspends', async () => {
  const { audio, game } = await startDriving(setup());
  game.car.speed = 30; game.car.forwardSpeed = 30; game.car.throttle = 1; game.car.rearSlip = 0.7;
  for (let i = 0; i < 60; i++) audio.update(game, 1 / 60);
  assert.ok(audio.snapshot().tireIntensity > 0.5);
  assert.ok(audio.snapshot().rpm > 4000);
  game.state = 'finished';
  for (let i = 0; i < 60 * 6; i++) audio.update(game, 1 / 60);
  assert.equal(audio.snapshot().mode, 'fade');
  assert.equal(gateTarget(audio), 0);
  assert.ok(audio.snapshot().tireIntensity < 1e-3, `tires ${audio.snapshot().tireIntensity}`);
  assert.equal(audio.snapshot().rpm, 750);
});

test('repeated restarts share one context and never duplicate voices', async () => {
  const env = await startDriving(setup());
  const { audio, contexts, game } = env;
  for (let i = 0; i < 25; i++) {
    game.car.speed = 30; game.car.forwardSpeed = 30; game.car.throttle = 1;
    audio.update(game, 1 / 60);
    restartRun(game);
    audio.newRun(game);
    assert.equal(audio.snapshot().rpm, 750, 'a restart is back at idle immediately');
    assert.equal(audio.snapshot().tireIntensity, 0);
  }
  await flush();
  assert.equal(contexts.length, 1);
  assert.equal(audio.snapshot().sourceCount, 5);
  assert.equal(contexts[0].sources.length, 5);
  const bank = contexts[0].nodes.filter((n) => n.started).length;
  assert.equal(bank, 5, 'no source was ever started twice');
});

test('a run restarted while the loaders are still busy ends with one voice of each', async () => {
  let release;
  const slow = new Promise((resolve) => { release = () => resolve({ buffers: coyoteBank, failures: [] }); });
  const { audio, contexts, game } = setup({ coyoteLoader: () => slow });
  startRun(game);
  audio.newRun(game);
  await flush();
  for (let i = 0; i < 5; i++) { restartRun(game); audio.newRun(game); }
  release();
  await flush();
  assert.equal(contexts.length, 1);
  assert.equal(audio.snapshot().sourceCount, 5);
});

test('mute takes effect at once, survives restarts and persists', async () => {
  const saved = new Map();
  const storage = { getItem: (k) => saved.get(k) ?? null, setItem: (k, v) => saved.set(k, v) };
  const { audio, contexts, game } = await startDriving(setup({ storage }));
  audio.setMuted(true, game);
  assert.equal(audio.snapshot().label, 'Sound Off');
  assert.equal(gateTarget(audio), 0);
  restartRun(game);
  audio.newRun(game);
  await flush();
  assert.equal(audio.snapshot().mode, 'silent');
  assert.equal(gateTarget(audio), 0);
  audio.setMuted(false, game);
  await flush();
  assert.equal(audio.snapshot().mode, 'live');
  assert.equal(audio.snapshot().label, 'Sound On');
  assert.equal(contexts.length, 1);

  audio.setMuted(true, game);
  audio.dispose();
  const again = setup({ storage });
  assert.equal(again.audio.snapshot().muted, true, 'a new visit remembers');
  startRun(again.game);
  again.audio.newRun(again.game);
  await flush();
  assert.equal(again.contexts.length, 0, 'a muted run opens no context at all');
  again.audio.setMuted(false, again.game);
  await flush();
  assert.equal(again.contexts.length, 1, 'unmuting is a gesture, so it starts then');
  assert.equal(again.audio.snapshot().mode, 'live');
});

test('unavailable or hostile storage only costs the memory, and defaults to on', async () => {
  const hostile = { getItem() { throw new Error('denied'); }, setItem() { throw new Error('denied'); } };
  const { audio, game } = await startDriving(setup({ storage: hostile }));
  assert.equal(audio.snapshot().muted, false);
  audio.setMuted(true, game);
  assert.equal(audio.snapshot().muted, true);
  assert.equal(setup({ storage: null }).audio.snapshot().muted, false);
});

test('no Web Audio at all reports unavailable, and clicking retries', async () => {
  let fail = true;
  const contexts = [];
  const env = setup({ contextFactory: () => {
    if (fail) throw new ReferenceError('AudioContext is not defined');
    const c = new FakeContext(); contexts.push(c); return c;
  } });
  const { audio, game } = env;
  startRun(game);
  assert.doesNotThrow(() => audio.newRun(game));
  assert.equal(audio.snapshot().label, 'Sound Unavailable');
  assert.doesNotThrow(() => audio.update(game, 1 / 60));
  fail = false;
  audio.setMuted(false, game);
  await flush();
  assert.equal(audio.snapshot().label, 'Sound On');
  assert.equal(contexts.length, 1);
  assert.equal(audio.snapshot().mode, 'live');
});

test('a denied output releases its whole graph and closes the context', async () => {
  const env = setup({ contextFactory: () => {
    const c = new FakeContext();
    c.resume = async () => { throw new Error('denied'); };
    env.made.push(c);
    return c;
  } });
  env.made = [];
  const { audio, game } = env;
  startRun(game);
  audio.newRun(game);
  await flush();
  const s = audio.snapshot();
  assert.equal(s.label, 'Sound Unavailable');
  assert.match(s.failure, /denied/);
  assert.equal(s.sourceCount, 0);
  assert.equal(env.made[0].state, 'closed');
  for (const node of env.made[0].nodes) assert.equal(node.disconnected, 1);
});

test('an output that never starts fails on a deadline, with nothing left behind', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const env = setup({ contextFactory: () => { const c = new FakeContext(); c.resume = () => new Promise(() => {}); env.made.push(c); return c; } });
  env.made = [];
  const { audio, game } = env;
  startRun(game);
  audio.newRun(game);
  await Promise.resolve();
  assert.equal(audio.snapshot().label, 'Sound On', 'still hopeful');
  t.mock.timers.tick(8000);
  await Promise.resolve(); await Promise.resolve(); await Promise.resolve();
  assert.equal(audio.snapshot().label, 'Sound Unavailable');
  assert.match(audio.snapshot().failure, /did not start/);
  assert.equal(env.made[0].state, 'closed');
  assert.doesNotThrow(() => { for (let i = 0; i < 5; i++) audio.update(game, 1 / 60); });
});

test('a context interrupted by the system is revived while driving, and only then', async () => {
  const { audio, contexts, game } = await startDriving(setup());
  contexts[0].state = 'interrupted';
  await wait(1100); // resume retries are spaced out
  audio.update(game, 1 / 60);
  await flush();
  assert.equal(contexts[0].state, 'running');
  assert.equal(audio.snapshot().mode, 'live');
  togglePause(game);
  audio.gesture(game);
  contexts[0].state = 'interrupted';
  await wait(1100);
  audio.update(game, 1 / 60);
  await flush();
  assert.equal(contexts[0].state, 'interrupted', 'a paused game stays quiet');
});

test('dispose stops every source, disconnects every node and closes the context', async () => {
  const { audio, contexts } = await startDriving(setup());
  audio.dispose();
  const ctx = contexts[0];
  assert.equal(ctx.state, 'closed');
  for (const node of ctx.nodes) {
    assert.equal(node.disconnected, 1);
    if (node.started) assert.equal(node.stopped, 1);
  }
  assert.equal(audio.snapshot().sourceCount, 0);
  audio.dispose();
});

test('late loader results cannot attach after teardown, and a new run starts clean', async () => {
  let release;
  const pending = new Promise((resolve) => { release = () => resolve({ buffers: coyoteBank, failures: [] }); });
  const { audio, contexts, game } = setup({ coyoteLoader: () => pending });
  startRun(game);
  audio.newRun(game);
  await flush();
  audio.dispose();
  release();
  await flush();
  assert.equal(contexts[0].sources.length, 0);
  audio.coyoteLoader = fullBank;
  audio.newRun(game);
  await flush();
  assert.equal(contexts.length, 2);
  assert.equal(audio.snapshot().sourceCount, 5);
});

test('a steady idle stops scheduling automation altogether', async () => {
  const { audio, contexts, game } = await startDriving(setup());
  for (let i = 0; i < 30; i++) audio.update(game, 1 / 60);
  const count = () => contexts[0].nodes.reduce((n, node) => n + node.gain.scheduled + node.frequency.scheduled + node.playbackRate.scheduled, 0);
  const before = count();
  for (let i = 0; i < 600; i++) audio.update(game, 1 / 60);
  assert.equal(count(), before);
});

test('driving updates reach the graph no faster than the apply interval', async () => {
  const { audio, contexts, game } = await startDriving(setup());
  const rate = () => contexts[0].nodes.reduce((n, node) => n + node.playbackRate.scheduled, 0);
  game.car.speed = 25; game.car.forwardSpeed = 25; game.car.throttle = 1;
  const before = rate();
  for (let i = 0; i < 60; i++) { game.car.speed += 0.1; audio.update(game, 1 / 240); }
  // 60 frames at 240 Hz is a quarter second, so about 8 updates to 5 sources each.
  assert.ok(rate() - before <= 9 * 5, `${rate() - before} playback-rate events`);
  assert.ok(rate() - before > 0);
});

test('a failure inside the graph falls back to silence and never reaches the caller', async () => {
  const { audio, game, contexts } = await startDriving(setup());
  audio.session.engine.update = () => { throw new Error('graph exploded'); };
  game.car.speed = 20; game.car.forwardSpeed = 20;
  assert.doesNotThrow(() => { for (let i = 0; i < 10; i++) audio.update(game, 1 / 30); });
  assert.equal(audio.snapshot().label, 'Sound Unavailable');
  assert.equal(contexts[0].state, 'closed');
});

test('the synthetic engine omits the tire branch; the lab form keeps it', () => {
  const ctx = new FakeContext();
  const engineOnly = createProcedural(ctx, ctx.destination);
  assert.equal(engineOnly.sourceCount, 6);
  assert.doesNotThrow(() => engineOnly.update({ firingHz: 50, engineGain: 0.3, roughness: 0.02, rpmFraction: 0, engineCutoff: 500, throttle: 0 }));
  engineOnly.stop();
  const lab = createProcedural(ctx, ctx.destination, ctx.destination);
  assert.equal(lab.sourceCount, 8);
  lab.stop();
  const tire = createTireVoice(ctx, ctx.destination, TIRE);
  assert.equal(tire.sourceCount, 1);
  tire.stop();
});

// --- Audio must never change the game ---------------------------------------

function fingerprint(game) {
  const { car, scoring, laps } = game;
  return JSON.stringify({
    state: game.state, ticks: game.ticks, runTime: game.runTime, runId: game.runId,
    x: car.x, y: car.y, heading: car.heading, vx: car.vx, vy: car.vy, yawRate: car.yawRate, steer: car.steer,
    throttle: car.throttle, brake: car.brake, rearGrip: car.rearGrip,
    score: scoring.score, spinouts: scoring.spinouts, bestCombo: scoring.bestCombo,
    completed: laps.completed, bestLap: laps.bestLap, lastLap: laps.lastLap, results: game.results,
  });
}

function simulate({ withAudio, frameDt = 1 / 60 }) {
  const game = createGame();
  startRun(game);
  const driver = driftDriver();
  const audio = withAudio ? new GameAudio({ contextFactory: () => new FakeContext(), coyoteLoader: fullBank, tireLoader: tireOk, coyoteEnabled: true, storage: null }) : null;
  audio?.newRun(game);
  let keys = {};
  for (let frame = 0; frame < 60 * 240 && game.state !== 'finished'; frame++) {
    keys = driver(game);
    advance(game, frameDt, keys);
    audio?.update(game, frameDt);
    if (frame === 600) { togglePause(game); audio?.gesture(game); togglePause(game); audio?.gesture(game); }
    if (frame === 900) audio?.setMuted(true, game);
    if (frame === 1200) audio?.setMuted(false, game);
  }
  audio?.dispose();
  return fingerprint(game);
}

test('a complete driven run is identical to the last digit with and without audio', async () => {
  const silent = simulate({ withAudio: false });
  const heard = simulate({ withAudio: true });
  assert.equal(heard, silent);
  assert.match(heard, /"state":"finished"/);
  await flush();
});

test('audio holds a read-only view of the game: any write would throw', () => {
  const readOnly = (object, path = 'game') => new Proxy(object, {
    get(target, key) {
      const value = target[key];
      return value && typeof value === 'object' ? readOnly(value, `${path}.${String(key)}`) : value;
    },
    set(_, key) { throw new Error(`audio wrote ${path}.${String(key)}`); },
    defineProperty(_, key) { throw new Error(`audio defined ${path}.${String(key)}`); },
    deleteProperty(_, key) { throw new Error(`audio deleted ${path}.${String(key)}`); },
  });
  const game = createGame();
  startRun(game);
  const driver = driftDriver();
  const failures = [];
  const audio = new GameAudio({ contextFactory: () => new FakeContext(), coyoteLoader: fullBank, tireLoader: tireOk, coyoteEnabled: true, storage: null });
  // guard() would swallow a write; surface it instead.
  const original = audio.fail.bind(audio);
  audio.fail = (session, message) => { failures.push(message); original(session, message); };
  audio.newRun(readOnly(game));
  for (let i = 0; i < 2000; i++) {
    tick(game, driver(game));
    if (i % 2) audio.update(readOnly(game), 1 / 60);
  }
  audio.setMuted(true, readOnly(game));
  audio.setPageActive(false, readOnly(game));
  audio.dispose();
  assert.deepEqual(failures, []);
});

test('audio code does not import the simulation or its tuning', () => {
  const files = ['audio.js', 'audio-telemetry.js', 'audio-voices.js', 'coyote.js', 'coyote-model.js'];
  const banned = /from '\.\/(tuning|physics|scoring|laps|track|game|render|main)\.js'/;
  for (const file of files) assert.doesNotMatch(readFileSync(new URL(`../src/${file}`, import.meta.url), 'utf8'), banned, file);
  // The simulation knows nothing about audio, and game.js has no browser audio.
  for (const file of readdirSync(new URL('../src/', import.meta.url))) {
    if (files.includes(file) || file === 'main.js') continue;
    assert.doesNotMatch(readFileSync(new URL(`../src/${file}`, import.meta.url), 'utf8'), /audio|AudioContext/i, file);
  }
});

test('physics tuning has no audio values and audio tuning is separate', () => {
  assert.equal(Object.keys(TUNING).some((key) => /audio|rpm|squeal/i.test(key)), false);
});
