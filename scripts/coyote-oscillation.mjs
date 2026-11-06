// Measures periodic pitch and level changes in the Coyote engine. Evidence for
// docs/COYOTE-OSCILLATION.md. Node 24 and Playwright; it changes no project file.
//
//   node scripts/coyote-oscillation.mjs <playwright index.mjs> [--bank name=dir ...]
//     [--master path/to/Mustang-Dyno.wav] [--seconds 20]
//
// Audio and JSON go to the ignored .local/coyote/oscillation/. Every capture is
// rendered by the real voice in src/coyote.js through the game's mix compressor,
// in Chromium's OfflineAudioContext. Numbers describe the signal, not how it sounds.
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createGame, startRun, tick } from '../src/game.js';
import { AUDIO_TUNING, createAudioState, readTelemetry, stepAudioState } from '../src/audio-telemetry.js';
import { COYOTE_LAYERS, mapCoyote } from '../src/coyote-model.js';
import { driftDriver, gripDriver } from '../test/support/drivers.mjs';
import { fft, magnitudes, readPcm16 as readWav, trackCrank } from './coyote-dsp.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const out = path.join(root, '.local/coyote/oscillation');
fs.mkdirSync(out, { recursive: true });

const option = (name, fallback) => {
  const i = process.argv.indexOf(name);
  return i > 0 ? process.argv[i + 1] : fallback;
};
const SECONDS = Number(option('--seconds', 20));
const SETTLE = 1.5; // the voice glides in from silence
const RENDER_RATE = 48000;
// The anchors the first bank shipped with. Kept here so "before" stays reproducible.
const V1_ANCHORS = [1100, 2700, 4400, 6600];

// --- Signal helpers ---------------------------------------------------------

function wavBytes(samples, rate) {
  const b = Buffer.alloc(44 + samples.length * 2);
  b.write('RIFF'); b.writeUInt32LE(b.length - 8, 4); b.write('WAVEfmt ', 8);
  b.writeUInt32LE(16, 16); b.writeUInt16LE(1, 20); b.writeUInt16LE(1, 22); b.writeUInt32LE(rate, 24);
  b.writeUInt32LE(rate * 2, 28); b.writeUInt16LE(2, 32); b.writeUInt16LE(16, 34); b.write('data', 36); b.writeUInt32LE(samples.length * 2, 40);
  samples.forEach((v, i) => b.writeInt16LE(Math.max(-32768, Math.min(32767, Math.round(v * 32767))), 44 + i * 2));
  return b;
}

const percentile = (values, p) => {
  const s = [...values].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor(s.length * p))];
};

// The strongest periodicity in a slowly sampled series, after removing its mean.
function modulation(series, sampleRate, loHz = 0.8, hiHz = 25) {
  const mean = series.reduce((a, b) => a + b, 0) / series.length;
  const nfft = 2 ** Math.ceil(Math.log2(series.length * 4));
  const re = new Float64Array(nfft), im = new Float64Array(nfft);
  series.forEach((v, i) => { re[i] = (v - mean) * (0.5 - 0.5 * Math.cos(2 * Math.PI * i / (series.length - 1))); });
  fft(re, im);
  const df = sampleRate / nfft, norm = 4 / series.length; // Hann-corrected peak amplitude
  const peaks = [];
  for (let i = Math.ceil(loHz / df); i < hiHz / df && i < nfft / 2 - 1; i++) {
    const v = Math.hypot(re[i], im[i]) * norm;
    if (v > Math.hypot(re[i - 1], im[i - 1]) * norm && v >= Math.hypot(re[i + 1], im[i + 1]) * norm) peaks.push({ hz: i * df, amp: v });
  }
  peaks.sort((a, b) => b.amp - a.amp);
  const keep = [];
  for (const p of peaks) {
    if (keep.every((k) => Math.abs(k.hz - p.hz) > 0.4)) keep.push(p);
    if (keep.length === 3) break;
  }
  const rms = Math.sqrt(series.reduce((sum, v) => sum + (v - mean) ** 2, 0) / series.length);
  return { rms, p1p99: percentile(series, 0.99) - percentile(series, 0.01), peaks: keep.map((p) => ({ hz: +p.hz.toFixed(2), amplitude: +p.amp.toFixed(3) })) };
}

function levelSeries(x, rate, from, to, band) {
  const hop = Math.round(rate * 0.005);
  if (!band) {
    const win = Math.round(rate * 0.05), w = Float64Array.from({ length: win }, (_, i) => 0.5 - 0.5 * Math.cos(2 * Math.PI * i / (win - 1)));
    const series = [];
    for (let s = Math.round(from * rate); s + win < to * rate; s += hop) {
      let sum = 0;
      for (let i = 0; i < win; i++) sum += (x[s + i] * w[i]) ** 2;
      series.push(10 * Math.log10(sum / win + 1e-12));
    }
    return { series, sampleRate: rate / hop };
  }
  const win = Math.round(rate * 0.05), nfft = 2 ** Math.ceil(Math.log2(win * 2)), df = rate / nfft;
  const series = [];
  for (let s = Math.round(from * rate); s + win < to * rate; s += hop * 2) {
    const m = magnitudes(x, s, win, nfft);
    let sum = 0;
    for (let i = Math.ceil(band[0] / df); i < band[1] / df; i++) sum += m[i] ** 2;
    series.push(10 * Math.log10(sum + 1e-12));
  }
  return { series, sampleRate: rate / (hop * 2) };
}

const round = (v, d = 2) => +v.toFixed(d);

// Long-term tone in third-octave bands, for comparing banks at the same setting.
function thirdOctaves(x, rate, from) {
  const win = 8192, hop = 4096, df = rate / win, power = new Float64Array(win / 2);
  let frames = 0;
  for (let s = Math.round(from * rate); s + win < x.length; s += hop) {
    const m = magnitudes(x, s, win, win);
    for (let i = 0; i < power.length; i++) power[i] += m[i] ** 2;
    frames += 1;
  }
  const bands = {};
  for (let centre = 100; centre < 7000; centre *= 2 ** (1 / 3)) {
    let sum = 0;
    for (let i = Math.ceil(centre * 2 ** (-1 / 6) / df); i < centre * 2 ** (1 / 6) / df && i < power.length; i++) sum += power[i];
    bands[Math.round(centre)] = round(10 * Math.log10(sum / frames + 1e-12), 1);
  }
  return bands;
}

function describeSignal(x, rate, expectedCrankHz, from = SETTLE) {
  const to = x.length / rate;
  const { series, sampleRate } = levelSeries(x, rate, from, to);
  // Eight revolutions long: at low RPM a shorter window cannot separate the half orders.
  const pitch = trackCrank(x, rate, from, to, expectedCrankHz, { follow: false, spread: 0.3, winSeconds: 8 / expectedCrankHz });
  const centre = percentile(pitch.map((r) => r.hz), 0.5);
  const cents = pitch.map((r) => 1200 * Math.log2(r.hz / centre));
  const bands = {};
  for (const [name, band] of Object.entries({ low: [80, 300], mid: [300, 800], upper: [800, 2000] })) {
    const b = levelSeries(x, rate, from, to, band);
    bands[name] = modulation(b.series, b.sampleRate);
    bands[name] = { rmsDb: round(bands[name].rms), p1p99Db: round(bands[name].p1p99), peaks: bands[name].peaks };
  }
  const level = modulation(series, sampleRate);
  const fm = modulation(cents, 100);
  let sum = 0, peak = 0;
  for (let i = Math.round(from * rate); i < x.length; i++) { sum += x[i] ** 2; peak = Math.max(peak, Math.abs(x[i])); }
  return {
    rmsDbfs: round(10 * Math.log10(sum / (x.length - from * rate) + 1e-12)), peak: round(peak, 3),
    level: { rmsDb: round(level.rms), p1p99Db: round(level.p1p99), peaks: level.peaks },
    pitch: { medianCrankHz: round(centre), medianRpm: Math.round(centre * 60), rmsCents: round(fm.rms, 1), p1p99Cents: round(fm.p1p99, 1), peaks: fm.peaks },
    bands, thirdOctaves: thirdOctaves(x, rate, from),
  };
}

// --- Rendering in Chromium --------------------------------------------------

const TYPES = { '.js': 'text/javascript; charset=utf-8', '.html': 'text/html; charset=utf-8', '.wav': 'audio/wav' };

function serve(banks) {
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://x');
    let file = null;
    if (url.pathname === '/') { res.writeHead(200, { 'Content-Type': TYPES['.html'] }); res.end('<!doctype html>'); return; }
    if (/^\/src\/[a-z-]+\.js$/.test(url.pathname)) file = path.join(root, url.pathname);
    const bank = url.pathname.match(/^\/bank\/([a-z0-9-]+)\/([a-z]+\.wav)$/);
    if (bank && banks[bank[1]]) file = path.join(banks[bank[1]], bank[2]);
    if (!file || !fs.existsSync(file)) { res.writeHead(404); res.end(); return; }
    res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] });
    res.end(fs.readFileSync(file));
  });
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve({ url: `http://127.0.0.1:${server.address().port}/`, stop: () => server.close() })));
}

// `timeline`: [{t, params}], applied like the game's 30 Hz updates.
const renderInPage = async ({ bank, seconds, rate, timeline, engineLevel, masterLevel, compressor }) => {
  const { createCoyote } = await import('/src/coyote.js');
  const { createMixCompressor } = await import('/src/audio-voices.js');
  const ctx = new OfflineAudioContext(1, Math.round(seconds * rate), rate);
  const buffers = {};
  for (const key of ['idle', 'mid', 'load', 'high']) {
    const response = await fetch(`/bank/${bank}/${key}.wav`);
    buffers[key] = await ctx.decodeAudioData(await response.arrayBuffer());
  }
  const bus = ctx.createGain(); bus.gain.value = engineLevel;
  const master = ctx.createGain(); master.gain.value = masterLevel;
  if (compressor) bus.connect(createMixCompressor(ctx)).connect(master);
  else bus.connect(master);
  master.connect(ctx.destination);
  const voice = createCoyote(ctx, bus, buffers);
  voice.update(timeline[0].params);
  for (const { t, params } of timeline.slice(1)) {
    ctx.suspend(t).then(() => { voice.update(params); ctx.resume(); });
  }
  const rendered = await ctx.startRendering();
  const samples = rendered.getChannelData(0);
  const bytes = new Uint8Array(samples.buffer, samples.byteOffset, samples.byteLength);
  let text = '';
  for (let i = 0; i < bytes.length; i += 32768) text += String.fromCharCode(...bytes.subarray(i, i + 32768));
  return btoa(text);
};

function anchorMap(anchors) {
  const layers = COYOTE_LAYERS.map((layer, i) => ({ ...layer, rpm: anchors[i] }));
  return ({ rpm, throttle }) => {
    const weights = layers.map(() => 0);
    if (rpm <= layers[0].rpm) weights[0] = 1;
    else if (rpm >= layers.at(-1).rpm) weights[3] = 1;
    else {
      const hi = layers.findIndex((l) => l.rpm >= rpm), lo = hi - 1;
      const x = Math.log(rpm / layers[lo].rpm) / Math.log(layers[hi].rpm / layers[lo].rpm);
      const t = x * x * (3 - 2 * x); weights[lo] = 1 - t; weights[hi] = t;
    }
    return {
      coyoteWeights: weights,
      coyoteRates: layers.map((l) => Math.max(0.65, Math.min(1.65, rpm / l.rpm))),
      coyoteGain: 0.38 + 0.30 * throttle,
      coyoteCutoff: 1300 + 2500 * (rpm - 750) / 6250 + 2600 * throttle,
      coyotePresence: -3 + 6 * throttle,
    };
  };
}

// --- Gameplay telemetry -----------------------------------------------------

function telemetryRows(driver, seconds = 200, frame = 1 / 60) {
  const game = createGame();
  startRun(game);
  const state = createAudioState();
  const rows = [];
  for (let i = 0; i < seconds / frame && game.state !== 'finished'; i++) {
    tick(game, driver(game));
    if (game.state !== 'finished') tick(game, driver(game));
    stepAudioState(state, readTelemetry(game.car), frame);
    rows.push({ t: i * frame, rpm: state.rpm, load: state.load, speed: game.car.speed, throttle: game.car.throttle, rear: Math.abs(game.car.rearSlip) * 180 / Math.PI, gear: state.gear ?? 0 });
  }
  return rows;
}

function sustainedThrottle(rows, frame = 1 / 60, minSeconds = 1.5) {
  const segments = [];
  let current = [];
  for (const row of rows) {
    if (row.throttle > 0.98 && row.rear < 6) current.push(row);
    else { if (current.length > minSeconds / frame) segments.push(current); current = []; }
  }
  if (current.length > minSeconds / frame) segments.push(current);
  return segments;
}

// How much RPM and load move around their own slow trend while the throttle is held.
function telemetryFluctuation(segments, frame = 1 / 60) {
  const reach = Math.round(0.5 / frame), results = [];
  for (const seg of segments) {
    const residual = seg.map((r, i) => {
      const slice = seg.slice(Math.max(0, i - reach), i + reach + 1);
      return r.rpm - slice.reduce((a, b) => a + b.rpm, 0) / slice.length;
    }).slice(reach, -reach);
    if (residual.length < 30) continue;
    const m = modulation(residual, 1 / frame, 1.5, 25);
    results.push({
      seconds: round(seg.length * frame, 1), rpmFrom: Math.round(seg[0].rpm), rpmTo: Math.round(seg.at(-1).rpm),
      loadMin: round(Math.min(...seg.map((r) => r.load)), 3), residualRmsRpm: round(m.rms, 1), peaks: m.peaks,
    });
  }
  return results;
}

// --- Run --------------------------------------------------------------------

const report = { note: 'Signal measurements only. Nobody listened to produce these numbers.', generated: new Date().toISOString() };

const masterPath = option('--master');
if (masterPath) {
  const { x, rate } = readWav(masterPath);
  const rows = trackCrank(x, rate, 49.95, 55.2, 54.0);
  report.pull = rows.filter((_, i) => i % 25 === 0).map((r) => ({ t: round(r.t), crankHz: round(r.hz), rpm: Math.round(r.hz * 60) }));
  const within = (from, to) => {
    const part = rows.filter((r) => r.t >= from && r.t <= to);
    const a = part[0].hz, b = part.at(-1).hz;
    return { fromRpm: Math.round(a * 60), toRpm: Math.round(b * 60), sweepPercent: round((b / a - 1) * 100, 1), meanRpm: Math.round(part.reduce((s, r) => s + r.hz, 0) / part.length * 60) };
  };
  report.sourceWindows = { 'v1 load 50.150-50.547': within(50.15, 50.547), 'v1 high 53.600-53.940': within(53.6, 53.94) };
  report.midCheck = (() => {
    const mid = trackCrank(x, rate, 21.0, 22.136, 45.6, { follow: false, spread: 0.08, winSeconds: 0.4 });
    const c = percentile(mid.map((r) => r.hz), 0.5);
    return { medianRpm: round(c * 60, 0), p1p99Cents: round(1200 * Math.log2(percentile(mid.map((r) => r.hz), 0.99) / percentile(mid.map((r) => r.hz), 0.01)), 1) };
  })();
}

const banks = {};
for (let i = process.argv.indexOf('--bank'); i > 0; i = process.argv.indexOf('--bank', i + 1)) {
  const [name, dir] = process.argv[i + 1].split('=');
  banks[name] = path.resolve(dir);
}
if (!Object.keys(banks).length) banks.current = path.join(root, 'audio-lab/assets/coyote-local');
// --anchors name=a,b,c,d measures a bank against other anchors. That is how the
// comparison separates "wrong anchor" from "pitch moves inside the loop".
const customAnchors = {};
for (let i = process.argv.indexOf('--anchors'); i > 0; i = process.argv.indexOf('--anchors', i + 1)) {
  const [name, list] = process.argv[i + 1].split('=');
  customAnchors[name] = list.split(',').map(Number);
}
const anchorsFor = (bank) => customAnchors[bank] ?? (bank.startsWith('v1') ? V1_ANCHORS : COYOTE_LAYERS.map((l) => l.rpm));

// The loops alone, two repetitions long, so a pitch reset at the seam shows.
report.loops = {};
for (const [name, dir] of Object.entries(banks)) {
  report.loops[name] = {};
  const anchors = anchorsFor(name);
  for (const [i, key] of ['idle', 'mid', 'load', 'high'].entries()) {
    const { x, rate } = readWav(path.join(dir, `${key}.wav`));
    const twice = new Float64Array(x.length * 3);
    twice.set(x, 0); twice.set(x, x.length); twice.set(x, x.length * 2);
    if (key === 'idle') { report.loops[name][key] = { seconds: round(x.length / rate, 3) }; continue; }
    const seed = key === 'load' && name.startsWith('v1') ? 59.5 : anchors[i] / 60;
    const rows = trackCrank(twice, rate, x.length / rate, 2 * x.length / rate, seed, { follow: false, spread: 0.25, winSeconds: 8 / seed });
    const hz = rows.map((r) => r.hz), median = percentile(hz, 0.5);
    const levels = levelSeries(twice, rate, x.length / rate, 2 * x.length / rate).series;
    report.loops[name][key] = {
      seconds: round(x.length / rate, 3), repeatsPerSecondAtRateOne: round(rate / x.length),
      medianRpm: Math.round(median * 60), pitchRangeP1P99Percent: round((percentile(hz, 0.99) / percentile(hz, 0.01) - 1) * 100, 1),
      levelRangeP1P99Db: round(percentile(levels, 0.99) - percentile(levels, 0.01)),
    };
  }
}

// Hypothesis 3: does gameplay itself wobble the RPM or throttle?
{
  const grip = telemetryFluctuation(sustainedThrottle(telemetryRows(gripDriver())));
  const drift = telemetryFluctuation(sustainedThrottle(telemetryRows(driftDriver())));
  const worst = [...grip, ...drift].sort((a, b) => b.residualRmsRpm - a.residualRmsRpm)[0];
  report.telemetry = { gripSegments: grip.length, driftSegments: drift.length, grip: grip.slice(0, 8), worst };
  const held = telemetryRows(() => ({ up: true }), 14).filter((r) => r.t > 3);
  report.telemetry.fullThrottleRpmSamples = held.filter((_, i) => i % 60 === 0).map((r) => ({ t: round(r.t, 1), rpm: Math.round(r.rpm), speed: round(r.speed, 1), throttle: round(r.throttle, 2), rearSlip: round(r.rear, 1) }));
}

const { chromium } = await import(pathToFileURL(path.resolve(process.argv[2])));
const site = await serve(banks);
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage();
await page.goto(site.url);
const pageErrors = [];
page.on('pageerror', (e) => pageErrors.push(e.message));

async function render(label, bank, timeline, seconds = SECONDS, { compressor = true, save = true } = {}) {
  const base64 = await page.evaluate(renderInPage, { bank, seconds, rate: RENDER_RATE, timeline, engineLevel: AUDIO_TUNING.engineLevel, masterLevel: AUDIO_TUNING.masterLevel, compressor });
  const raw = Buffer.from(base64, 'base64');
  const x = new Float32Array(raw.buffer, raw.byteOffset, raw.length / 4);
  if (save) fs.writeFileSync(path.join(out, `${label}.wav`), wavBytes(x, RENDER_RATE));
  return Float64Array.from(x);
}

report.renders = {};
const RPMS = [3400, 4400, 4700, 5500, 5700, 5900, 6600];
for (const bank of Object.keys(banks)) {
  const map = anchorMap(anchorsFor(bank));
  report.renders[bank] = {};
  for (const rpm of RPMS) {
    const params = map({ rpm, throttle: 1 });
    const x = await render(`${bank}-fixed-${rpm}`, bank, [{ t: 0, params }]);
    const entry = { ...describeSignal(x, RENDER_RATE, rpm / 60), weights: params.coyoteWeights.map((w) => round(w, 3)), rates: params.coyoteRates.map((r) => round(r, 3)) };
    // Hypothesis 2: each layer alone at the same setting, then both without the compressor.
    if (rpm === 5500 || rpm === 4700) {
      entry.layersAlone = {};
      for (const i of [2, 3]) {
        const solo = { ...params, coyoteWeights: params.coyoteWeights.map((w, k) => (k === i ? w : 0)) };
        const s = await render(`${bank}-fixed-${rpm}-${COYOTE_LAYERS[i].key}-alone`, bank, [{ t: 0, params: solo }]);
        const d = describeSignal(s, RENDER_RATE, rpm / 60);
        entry.layersAlone[COYOTE_LAYERS[i].key] = { level: d.level, pitch: d.pitch, bands: d.bands };
      }
      const bare = describeSignal(await render(`${bank}-fixed-${rpm}-no-compressor`, bank, [{ t: 0, params }], SECONDS, { compressor: false }), RENDER_RATE, rpm / 60);
      entry.withoutCompressor = { level: bare.level };
    }
    report.renders[bank][rpm] = entry;
    console.log(bank, rpm, JSON.stringify(entry.level), JSON.stringify(entry.pitch));
  }
  // A real driven run through the same voice, at the game's 30 Hz update rate.
  for (const [name, driver, seconds] of [['full-throttle', () => ({ up: true }), 14], ['grip-lap', gripDriver(), 30], ['drift-lap', driftDriver(), 30]]) {
    const rows = telemetryRows(driver, seconds);
    const timeline = rows.filter((_, i) => i % 2 === 0).map((r) => ({ t: r.t + 0.5, params: map({ rpm: r.rpm, throttle: r.load }) }));
    await render(`${bank}-gameplay-${name}`, bank, [{ t: 0, params: map({ rpm: 750, throttle: 0 }) }, ...timeline], seconds + 1);
  }
}
await browser.close();
site.stop();
report.pageErrors = pageErrors;
const reportName = option('--report', 'report.json');
fs.writeFileSync(path.join(out, reportName), `${JSON.stringify(report, null, 2)}\n`);
console.log(`Wrote ${path.join(out, reportName)}`);
