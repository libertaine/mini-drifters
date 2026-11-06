import { loadCoyote, createCoyote } from '../audio-lab/coyote.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { DEFAULTS, PRESETS, mapAudio, normalize } from '../audio-lab/model.js';
import { AudioLab } from '../audio-lab/audio.js';
import { prepareLoop, loadSamples } from '../audio-lab/voices.js';

test('stationary tires remain silent at every slip/grip and on both surfaces', () => {
  for (const surface of ['road', 'grass']) for (let slip = 0; slip <= 90; slip++) {
    for (const grip of [1, 0.7, 0.15]) assert.equal(mapAudio({ speed: 0, slip, grip, surface }).tireIntensity, 0);
  }
  assert.equal(mapAudio({ speed: 120, slip: 0, grip: 1 }).tireIntensity, 0);
});

test('angle and grip independently increase tire intensity; grass is quieter and less tonal', () => {
  const at = (v) => mapAudio({ speed: 65, slip: 30, grip: 1, ...v });
  assert.ok(at({ slip: 40 }).tireIntensity > at({ slip: 10 }).tireIntensity);
  assert.ok(at({ grip: 0.2 }).tireIntensity > at({ grip: 1 }).tireIntensity);
  assert.ok(at({ slip: 0, grip: 0.2 }).tireIntensity > 0);
  assert.ok(at({ surface: 'grass' }).tireIntensity < at({}).tireIntensity);
  assert.ok(at({ surface: 'grass' }).squealMix < at({}).squealMix);
});

test('tire mapping is continuous through onset and recovery without a volume cliff', () => {
  let previous = 0;
  for (let speed = 0; speed <= 120; speed += 0.1) {
    const current = mapAudio({ speed, slip: 40, grip: 0.4 }).tireIntensity;
    assert.ok(current >= previous - 1e-10);
    assert.ok(current - previous < 0.02);
    previous = current;
  }
  previous = 0;
  for (let slip = 0; slip <= 90; slip += 0.1) {
    const current = mapAudio({ speed: 65, slip, grip: 1 }).tireIntensity;
    assert.ok(Math.abs(current - previous) < 0.01);
    previous = current;
  }
});

test('RPM and throttle have distinct effects; all presets produce bounded finite targets', () => {
  assert.ok(mapAudio({ rpm: 7000 }).firingHz > mapAudio({ rpm: 750 }).firingHz);
  assert.equal(mapAudio({ throttle: 1 }).firingHz, mapAudio({ throttle: 0 }).firingHz);
  assert.ok(mapAudio({ throttle: 1 }).engineCutoff > mapAudio({ throttle: 0 }).engineCutoff);
  for (const preset of PRESETS) {
    const p = mapAudio(preset.values);
    for (const value of Object.values(p)) if (typeof value === 'number') assert.ok(Number.isFinite(value));
    assert.ok(p.tireIntensity >= 0 && p.tireIntensity <= 1);
    assert.equal(p.sampleLowGain + p.sampleHighGain, 1);
  }
  assert.equal(PRESETS.length, 8);
  assert.deepEqual(normalize({ rpm: NaN, speed: Infinity, grip: -10, slip: 200 }).rpm, DEFAULTS.rpm);
  assert.equal(normalize({ grip: -10 }).grip, 0.15);
});

class Param {
  constructor() { this.value = 0; this.events = []; }
  cancelAndHoldAtTime() {}
  cancelScheduledValues() { this.events = []; }
  setValueAtTime(value) { this.value = value; this.events.push(value); }
  setTargetAtTime(value) { this.value = value; this.events.push(value); }
}
class Node {
  constructor() {
    for (const key of ['gain', 'frequency', 'Q', 'playbackRate', 'threshold', 'knee', 'ratio', 'attack', 'release']) this[key] = new Param();
    this.started = 0; this.stopped = 0; this.disconnected = 0;
  }
  connect(target) { return target; }
  disconnect() { this.disconnected++; }
  start() { this.started++; }
  stop() { this.stopped++; }
}
class Context {
  constructor() { this.currentTime = 0; this.sampleRate = 8000; this.state = 'suspended'; this.destination = new Node(); this.nodes = []; }
  make() { const node = new Node(); this.nodes.push(node); return node; }
  createGain() { return this.make(); }
  createOscillator() { return this.make(); }
  createBufferSource() { return this.make(); }
  createBiquadFilter() { return this.make(); }
  createDynamicsCompressor() { return this.make(); }
  createBuffer(channels, length, sampleRate) {
    const data = Array.from({ length: channels }, () => new Float32Array(length));
    return { length, numberOfChannels: channels, sampleRate, duration: length / sampleRate, getChannelData: (c) => data[c] };
  }
  async resume() { this.state = 'running'; }
  async close() { this.state = 'closed'; }
}
const deferred = () => { let resolve; const promise = new Promise((r) => { resolve = r; }); return { promise, resolve }; };
const emptySamples = async () => ({ buffers: {}, failures: ['test: recordings unavailable'] });
const settle = () => new Promise((r) => setImmediate(r));

test('repeated Start shares one context; mute is immediate and survives stop/restart', async () => {
  const contexts = [];
  const lab = new AudioLab({ coyoteLoader: emptySamples, contextFactory: () => { const c = new Context(); contexts.push(c); return c; }, sampleLoader: emptySamples });
  const first = lab.start(); assert.equal(first, lab.start());
  await first; await settle();
  assert.equal(contexts.length, 1); assert.equal(lab.snapshot().sourceCount, 8);
  lab.mute(true); assert.equal(lab.snapshot().outputGain, 0);
  lab.set({ masterVolume: 1, mode: 'samples' }); assert.equal(lab.snapshot().outputGain, 0);
  lab.stop(); lab.stop();
  assert.equal(contexts[0].state, 'closed'); assert.equal(lab.snapshot().sourceCount, 0);
  for (const node of contexts[0].nodes) {
    assert.equal(node.disconnected, 1);
    if (node.started) assert.equal(node.stopped, 1);
  }
  await lab.start(); assert.equal(lab.snapshot().outputGain, 0);
  lab.mute(false); assert.equal(lab.snapshot().outputGain, 1);
  lab.stop();
});

test('stop during resume cannot revive audio or begin stale sample loads', async () => {
  const pending = deferred(); let loads = 0;
  const ctx = new Context(); ctx.resume = () => pending.promise;
  const lab = new AudioLab({ coyoteLoader: emptySamples, contextFactory: () => ctx, sampleLoader: async () => { loads++; return emptySamples(); } });
  const ready = lab.start(); lab.stop(); await ready; pending.resolve(); await settle();
  assert.equal(loads, 0); assert.equal(lab.snapshot().running, false);
});

test('a native resume that never settles reports a bounded output failure and releases its graph', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const ctx = new Context(); ctx.resume = () => new Promise(() => {});
  const lab = new AudioLab({ coyoteLoader: emptySamples, contextFactory: () => ctx, sampleLoader: emptySamples });
  const ready = lab.start();
  t.mock.timers.tick(8000); await ready;
  assert.equal(lab.snapshot().running, false); assert.equal(lab.snapshot().sourceCount, 0);
  assert.match(lab.snapshot().message, /Audio output did not start/);
  assert.equal(ctx.state, 'closed');
});

test('late sample decode from an old session cannot attach to a restarted graph', async () => {
  const pending = deferred(); let signal;
  const lab = new AudioLab({ coyoteLoader: emptySamples, contextFactory: () => new Context(), sampleLoader: (_ctx, abort) => { signal = abort; return pending.promise; } });
  await lab.start(); const old = lab.session;
  lab.stop(); assert.equal(signal.aborted, true);
  lab.sampleLoader = emptySamples; await lab.start();
  pending.resolve({ buffers: { low: {} }, failures: [] }); await settle();
  assert.equal(old.samples, undefined); assert.equal(lab.snapshot().sampleState, 'unavailable');
  lab.stop();
});

test('partial samples and resume failure are reported without duplicate sources', async () => {
  const lab = new AudioLab({ coyoteLoader: emptySamples, contextFactory: () => new Context(), sampleLoader: async () => ({ buffers: { low: {} }, failures: ['high/tire missing'] }) });
  await lab.start(); await settle();
  assert.equal(lab.snapshot().sampleState, 'partial'); assert.equal(lab.snapshot().sourceCount, 9);
  lab.set({ mode: 'samples', rpm: 7000 });
  assert.deepEqual(lab.snapshot().failures, ['high/tire missing']); lab.stop();
  const ctx = new Context(); ctx.resume = async () => { throw new Error('denied'); };
  const failed = new AudioLab({ coyoteLoader: emptySamples, contextFactory: () => ctx });
  await failed.start(); assert.equal(failed.snapshot().running, false);
  assert.match(failed.snapshot().message, /denied/); assert.equal(ctx.state, 'closed');
});

test('loop preparation removes the overlap and keeps peak headroom', () => {
  const ctx = new Context(); const input = ctx.createBuffer(1, 8000, 8000);
  input.getChannelData(0).fill(1);
  const loop = prepareLoop(ctx, input);
  assert.equal(loop.length, 7520);
  assert.ok(loop.getChannelData(0).every((v) => v === 0.75));
  assert.throws(() => prepareLoop(ctx, input, 0, 0.001), /too short/);
});

test('failed HTTP/decode sample requests produce explicit missing layers', async () => {
  const ctx = new Context(); ctx.decodeAudioData = async () => { throw new Error('bad WAV'); };
  const result = await loadSamples(ctx, new AbortController().signal, async (url) => ({
    ok: !url.pathname.includes('high'), status: 404, arrayBuffer: async () => new ArrayBuffer(8),
  }));
  assert.deepEqual(result.buffers, {}); assert.equal(result.failures.length, 3);
  assert.ok(result.failures.some((s) => s.includes('HTTP 404')));
  assert.ok(result.failures.some((s) => s.includes('bad WAV')));
});

test('Pages keeps its explicit game-only deployment allowlist', async () => {
  const workflow = await readFile(new URL('../.github/workflows/ci.yml', import.meta.url), 'utf8');
  assert.match(workflow, /cp -r index\.html style\.css src _site\//);
  // Of the lab's folder, only the game's recordings and their attribution go out.
  const labCopies = workflow.split('\n').filter((line) => /\bcp\b/.test(line) && line.includes('audio-lab')).map((line) => line.trim());
  assert.deepEqual(labCopies, [
    'cp audio-lab/assets/tire-foley.mp3 audio-lab/assets/ATTRIBUTION.md _site/audio-lab/assets/',
    'cp audio-lab/assets/coyote-local/idle.wav audio-lab/assets/coyote-local/mid.wav audio-lab/assets/coyote-local/load.wav audio-lab/assets/coyote-local/high.wav _site/audio-lab/assets/coyote-local/',
  ]);
  for (const file of ['../src/main.js', '../index.html']) {
    assert.doesNotMatch(await readFile(new URL(file, import.meta.url), 'utf8'), /audio-lab|AudioContext/);
  }
});

test('development server exposes only explicit lab files with correct audio MIME types', async () => {
  const server = spawn(process.execPath, [fileURLToPath(new URL('../server.mjs', import.meta.url))], {
    env: { ...process.env, PORT: '4195' }, stdio: ['ignore', 'pipe', 'inherit'],
  });
  try {
    await new Promise((resolve, reject) => {
      server.once('error', reject);
      server.once('exit', (code) => reject(new Error(`Server exited: ${code}`)));
      server.stdout.once('data', resolve);
    });
    const base = 'http://127.0.0.1:4195';
    const redirect = await fetch(`${base}/audio-lab`, { redirect: 'manual' });
    assert.equal(redirect.status, 308); assert.equal(redirect.headers.get('location'), '/audio-lab/');
    for (const [path, type] of [['/audio-lab/', 'text/html'], ['/audio-lab/lab.js', 'text/javascript'],
      ['/audio-lab/assets/engine-low.wav', 'audio/wav'], ['/audio-lab/assets/tire-foley.mp3', 'audio/mpeg'],
      ['/audio-lab/assets/ATTRIBUTION.md', 'text/plain']]) {
      const response = await fetch(`${base}${path}`, { method: 'HEAD' });
      assert.equal(response.status, 200, path);
      assert.ok(response.headers.get('content-type').startsWith(type), path);
      assert.equal((await response.arrayBuffer()).byteLength, 0);
    }
    for (const path of ['/audio-lab/assets/Mustang-Dyno.wav', '/audio-lab/assets/Mustang-Dyno_alt.wav', '/.local/coyote/analysis.json',
      '/audio-lab/assets/coyote-local/nope.wav', '/audio-lab/assets/.env', '/audio-lab/nope.js', '/package.json', '/docs/AUDIO-LAB.md', '/.git/config']) {
      assert.equal((await fetch(`${base}${path}`)).status, 404, path);
    }
    assert.equal((await fetch(`${base}/audio-lab/`, { method: 'POST' })).status, 404);
  } finally { server.kill(); }
});


test('Coyote RPM boundaries and throttle mapping are finite, continuous, and pitch independent of load', () => {
  for (const mode of ['procedural', 'samples', 'coyote']) assert.equal(normalize({ mode }).mode, mode);
  assert.equal(normalize({ mode: 'unknown' }).mode, 'procedural');
  assert.equal(mapAudio({ rpm: -1 }).rpm, 750); assert.equal(mapAudio({ rpm: 100000 }).rpm, 7000);
  let previous = mapAudio({ rpm: 750 });
  for (let rpm = 750; rpm <= 7000; rpm += 1) {
    const p = mapAudio({ rpm });
    assert.ok(Math.abs(p.coyoteWeights.reduce((a, b) => a + b) - 1) < 1e-10);
    p.coyoteWeights.forEach((v, i) => { assert.ok(v >= 0 && v <= 1); assert.ok(Math.abs(v - previous.coyoteWeights[i]) < 0.003); });
    p.coyoteRates.forEach((v) => assert.ok(v >= 0.65 && v <= 1.65)); previous = p;
  }
  const gentle = mapAudio({ rpm: 3500, throttle: 0 }), hard = mapAudio({ rpm: 3500, throttle: 1 });
  assert.deepEqual(gentle.coyoteRates, hard.coyoteRates); assert.deepEqual(gentle.coyoteWeights, hard.coyoteWeights);
  for (const key of ['coyoteGain', 'coyoteCutoff', 'coyotePresence']) assert.ok(hard[key] > gentle[key]);
});
const coyoteBank = { idle: {}, mid: {}, load: {}, high: {} };
const fullCoyote = async () => ({ buffers: coyoteBank, failures: [] });
test('Coyote switching retains conditions and tire selection; Start/Stop and mute dispose all four loops', async () => {
  const contexts = [], lab = new AudioLab({ contextFactory: () => { const ctx = new Context(); contexts.push(ctx); return ctx; }, sampleLoader: emptySamples, coyoteLoader: fullCoyote });
  await lab.start(); await settle(); const s = lab.session;
  assert.equal(lab.snapshot().coyoteState, 'ready'); assert.equal(lab.snapshot().sourceCount, 12);
  lab.set({ rpm: 3500, throttle: 0.7, tireMode: 'procedural', tireVolume: 0 });
  for (const mode of ['coyote', 'samples', 'procedural', 'coyote']) {
    lab.set({ mode }); assert.equal(lab.values.rpm, 3500); assert.equal(lab.values.throttle, 0.7);
    assert.equal(lab.values.tireMode, 'procedural'); assert.equal(s.procTire.gain.value, 1); assert.equal(s.sampleTire.gain.value, 0);
  }
  assert.equal(s.coyoteEngine.gain.value, 1); assert.equal(s.procEngine.gain.value, 0); assert.equal(s.sampleEngine.gain.value, 0);
  const same = lab.start(); await same; assert.equal(contexts.length, 1);
  lab.mute(true); assert.equal(lab.snapshot().outputGain, 0); lab.stop();
  assert.equal(contexts[0].state, 'closed');
  for (const n of contexts[0].nodes) { assert.equal(n.disconnected, 1); if (n.started) assert.equal(n.stopped, 1); }
  await lab.start(); await settle(); assert.equal(lab.snapshot().outputGain, 0); lab.stop();
});
test('incomplete Coyote bank stays silent, reports failure, and never substitutes A/B', async () => {
  const lab = new AudioLab({ contextFactory: () => new Context(), sampleLoader: emptySamples,
    coyoteLoader: async () => ({ buffers: { idle: {} }, failures: ['mid.wav: HTTP 404'] }) });
  lab.set({ mode: 'coyote' }); await lab.start(); await settle();
  assert.equal(lab.snapshot().coyoteState, 'unavailable'); assert.equal(lab.session.coyote.sourceCount, 0);
  assert.equal(lab.session.procEngine.gain.value, 0); assert.equal(lab.session.sampleEngine.gain.value, 0);
  assert.match(lab.snapshot().coyoteFailures[0], /HTTP 404/); lab.stop();
});
test('Coyote fetch and decode failures are explicit and aborted decodes cannot attach', async () => {
  const ctx = new Context(); ctx.decodeAudioData = async () => { throw new Error('invalid audio'); };
  const result = await loadCoyote(ctx, new AbortController().signal, async (url) => ({ ok: !url.pathname.includes('mid'), status: 404, arrayBuffer: async () => new ArrayBuffer(4) }));
  assert.equal(Object.keys(result.buffers).length, 0); assert.equal(result.failures.length, 4);
  assert.ok(result.failures.some((f) => f.includes('HTTP 404'))); assert.ok(result.failures.some((f) => f.includes('invalid audio')));
  const pending = deferred(), abort = new AbortController(); ctx.decodeAudioData = () => pending.promise;
  const loading = loadCoyote(ctx, abort.signal, async () => ({ ok: true, arrayBuffer: async () => new ArrayBuffer(4) }));
  await settle(); abort.abort(); pending.resolve({ duration: 1, numberOfChannels: 1 });
  assert.deepEqual((await loading).buffers, {});
});
test('late Coyote loader completion cannot attach to another session', async () => {
  const pending = deferred(), lab = new AudioLab({ contextFactory: () => new Context(), sampleLoader: emptySamples, coyoteLoader: () => pending.promise });
  await lab.start(); const old = lab.session; lab.stop(); lab.coyoteLoader = fullCoyote;
  await lab.start(); await settle(); pending.resolve({ buffers: coyoteBank, failures: [] }); await settle();
  assert.equal(old.coyote, undefined); assert.equal(lab.snapshot().sourceCount, 12); lab.stop();
});
test('Coyote loading deadline covers both banks independently', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  let signal;
  const lab = new AudioLab({ contextFactory: () => new Context(), sampleLoader: emptySamples,
    coyoteLoader: (_ctx, s) => { signal = s; return new Promise((resolve) => s.addEventListener('abort', () => resolve({ buffers: {}, failures: [] }))); } });
  await lab.start(); await settle(); t.mock.timers.tick(12000); await settle();
  assert.equal(signal.aborted, true); assert.equal(lab.snapshot().coyoteState, 'unavailable');
  assert.match(lab.snapshot().coyoteFailures.join(), /timed out/); lab.stop();
});
test('Coyote graph applies smoothed parameter automation rather than direct switching steps', () => {
  const ctx = new Context(), v = createCoyote(ctx, ctx.destination, coyoteBank);
  const targets = [];
  for (const node of ctx.nodes) for (const field of ['gain', 'frequency', 'playbackRate']) {
    const p = node[field]; p.setTargetAtTime = (value, at, tau) => targets.push({ value, at, tau });
  }
  v.update(mapAudio({ rpm: 7000, throttle: 1 }));
  assert.ok(targets.length >= 10); assert.ok(targets.every((t) => Number.isFinite(t.value) && t.tau >= 0.12)); v.stop();
});
