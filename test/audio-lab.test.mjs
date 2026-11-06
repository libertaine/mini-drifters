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
  const lab = new AudioLab({ contextFactory: () => { const c = new Context(); contexts.push(c); return c; }, sampleLoader: emptySamples });
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
  const lab = new AudioLab({ contextFactory: () => ctx, sampleLoader: async () => { loads++; return emptySamples(); } });
  const ready = lab.start(); lab.stop(); pending.resolve(); await ready;
  assert.equal(loads, 0); assert.equal(lab.snapshot().running, false);
});

test('late sample decode from an old session cannot attach to a restarted graph', async () => {
  const pending = deferred(); let signal;
  const lab = new AudioLab({ contextFactory: () => new Context(), sampleLoader: (_ctx, abort) => { signal = abort; return pending.promise; } });
  await lab.start(); const old = lab.session;
  lab.stop(); assert.equal(signal.aborted, true);
  lab.sampleLoader = emptySamples; await lab.start();
  pending.resolve({ buffers: { low: {} }, failures: [] }); await settle();
  assert.equal(old.samples, undefined); assert.equal(lab.snapshot().sampleState, 'unavailable');
  lab.stop();
});

test('partial samples and resume failure are reported without duplicate sources', async () => {
  const lab = new AudioLab({ contextFactory: () => new Context(), sampleLoader: async () => ({ buffers: { low: {} }, failures: ['high/tire missing'] }) });
  await lab.start(); await settle();
  assert.equal(lab.snapshot().sampleState, 'partial'); assert.equal(lab.snapshot().sourceCount, 9);
  lab.set({ mode: 'samples', rpm: 7000 });
  assert.deepEqual(lab.snapshot().failures, ['high/tire missing']); lab.stop();
  const ctx = new Context(); ctx.resume = async () => { throw new Error('denied'); };
  const failed = new AudioLab({ contextFactory: () => ctx });
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
  assert.doesNotMatch(workflow, /cp[^\n]*audio-lab/);
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
    for (const path of ['/audio-lab/assets/.env', '/audio-lab/nope.js', '/package.json', '/docs/AUDIO-LAB.md', '/.git/config']) {
      assert.equal((await fetch(`${base}${path}`)).status, 404, path);
    }
    assert.equal((await fetch(`${base}/audio-lab/`, { method: 'POST' })).status, 404);
  } finally { server.kill(); }
});
