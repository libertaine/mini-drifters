// Offline owner-audio analysis and loop construction. Node 24; no dependencies.
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { fitPolynomial, phaseDrift, sincAt, trackCrank } from './coyote-dsp.mjs';
const root = fileURLToPath(new URL('../', import.meta.url));
const sourceArg = process.argv.indexOf('--source');
if (sourceArg < 0 || !process.argv[sourceArg + 1]) throw new Error('Usage: node scripts/coyote-process.mjs --source /absolute/master/directory [--analyze-only] [--output directory]');
const sourceDir = path.resolve(process.argv[sourceArg + 1]);
const work = path.join(root, '.local/coyote'); fs.mkdirSync(work, { recursive: true });
const sha = (b) => createHash('sha256').update(b).digest('hex');
function readWav(file) {
  const bytes = fs.readFileSync(file);
  if (bytes.toString('ascii', 0, 4) !== 'RIFF' || bytes.toString('ascii', 8, 12) !== 'WAVE') throw new Error('Expected RIFF WAVE');
  let fmt, data;
  for (let p = 12; p + 8 <= bytes.length;) {
    const size = bytes.readUInt32LE(p + 4), id = bytes.toString('ascii', p, p + 4);
    if (p + 8 + size > bytes.length) throw new Error('Truncated WAV');
    if (id === 'fmt ') fmt = bytes.subarray(p + 8, p + 8 + size);
    if (id === 'data') data = bytes.subarray(p + 8, p + 8 + size);
    p += 8 + size + size % 2;
  }
  if (!fmt || !data || fmt.readUInt16LE(0) !== 1 || fmt.readUInt16LE(14) !== 16) throw new Error('Requires PCM16 masters');
  const channels = fmt.readUInt16LE(2), rate = fmt.readUInt32LE(4), frames = data.length / (2 * channels);
  const mono = new Float64Array(frames); let peak = 0, squares = 0, clipped = 0, lr = 0, ll = 0, rr = 0;
  for (let i = 0; i < frames; i++) {
    for (let c = 0; c < channels; c++) {
      const n = data.readInt16LE((i * channels + c) * 2); const v = n / 32768;
      mono[i] += v / channels; peak = Math.max(peak, Math.abs(v)); squares += v * v;
      if (Math.abs(n) >= 32767) clipped++;
    }
    if (channels === 2) { const l = data.readInt16LE(i * 4), r = data.readInt16LE(i * 4 + 2); lr += l * r; ll += l * l; rr += r * r; }
  }
  return { mono, rate, info: { file: path.basename(file), bytes: bytes.length, sha256: sha(bytes), channels, rate, seconds: frames / rate,
    peak, rms: Math.sqrt(squares / (frames * channels)), clippedSamples: clipped, stereoCorrelation: lr / Math.sqrt(ll * rr) } };
}
function spectrum(input, rate, time, n = 65536) {
  const re = new Float64Array(n), im = new Float64Array(n), stride = 1;
  for (let i = 0; i < n; i++) re[i] = (input[Math.floor(time * rate + i * stride)] || 0) * (0.5 - 0.5 * Math.cos(2 * Math.PI * i / (n - 1)));
  for (let i = 1, j = 0; i < n; i++) { let bit = n >> 1; for (; j & bit; bit >>= 1) j ^= bit; j ^= bit;
    if (i < j) [re[i], re[j]] = [re[j], re[i]]; }
  for (let len = 2; len <= n; len *= 2) {
    const angle = -2 * Math.PI / len;
    for (let i = 0; i < n; i += len) for (let j = 0; j < len / 2; j++) {
      const c = Math.cos(angle * j), s = Math.sin(angle * j), a = i + j, b = a + len / 2;
      const r = re[b] * c - im[b] * s, v = re[b] * s + im[b] * c;
      re[b] = re[a] - r; im[b] = im[a] - v; re[a] += r; im[a] += v;
    }
  }
  return Float64Array.from(re.subarray(0, n / 2), (x, i) => Math.hypot(x, im[i]) / n);
}
function analyze(wav) {
  const blocks = [];
  for (let t = 0; t + 1.366 < wav.info.seconds; t += 0.5) {
    const spec = spectrum(wav.mono, wav.rate, t), peaks = [];
    for (let i = 45; i < 1638; i++) if (spec[i] > spec[i - 1] && spec[i] > spec[i + 1]) peaks.push({ hz: i * 6000 / 8192, amplitude: spec[i] });
    peaks.sort((a, b) => b.amplitude - a.amplitude);
    let sum = 0, peak = 0;
    for (let i = Math.floor(t * wav.rate); i < (t + 0.5) * wav.rate; i++) { const v = wav.mono[i]; sum += v * v; peak = Math.max(peak, Math.abs(v)); }
    const combs = [];
    for (let f = 35; f < 470; f += 1) {
      let score = 0;
      for (let h = 1; h <= 5; h++) { const bin = Math.round(f * h / (6000 / 8192)); score += Math.max(...spec.subarray(bin - 1, bin + 2)) / Math.sqrt(h); }
      combs.push({ hz: f, score });
    }
    combs.sort((a, b) => b.score - a.score);
    const candidates = combs.filter((c, i) => combs.slice(0, i).every((b) => Math.abs(c.hz - b.hz) > 8)).slice(0, 4);
    blocks.push({ t, peak, rms: Math.sqrt(sum / (0.5 * wav.rate)), peaks: peaks.slice(0, 8), periodicityCandidates: candidates });
  }
  return { ...wav.info, blocks };
}
const recordings = ['Mustang-Dyno.wav', 'Mustang-Dyno_alt.wav'].map((file) => readWav(path.join(sourceDir, file)));
const analysis = recordings.map(analyze);
fs.writeFileSync(path.join(work, 'analysis.json'), JSON.stringify(analysis, null, 2) + '\n');
// Local scientific overview: half-second waveform envelopes and 0-1200 Hz spectra.
let svg = '<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="640" viewBox="0 0 1200 640"><rect width="1200" height="640" fill="#101516"/>';
for (let r = 0; r < recordings.length; r++) {
  const y = 35 + r * 310, a = analysis[r], w = recordings[r];
  svg += '<text x="20" y="' + y + '" fill="white" font-size="16">' + a.file + ' — duration ' + a.seconds.toFixed(3) + ' s; peak ' + a.peak.toFixed(4) + '</text>';
  for (const b of a.blocks) {
    const x = 60 + b.t / a.seconds * 1100, width = 1100 * 0.5 / a.seconds;
    svg += '<rect x="' + x + '" y="' + (y + 55 - b.peak * 45) + '" width="' + width + '" height="' + (b.peak * 90) + '" fill="#d9f078"/>';
    const s = spectrum(w.mono, w.rate, b.t);
    for (let band = 0; band < 80; band++) {
      let power = 0; for (let j = Math.floor(band * 15 / (6000 / 8192)); j < (band + 1) * 15 / (6000 / 8192); j++) power = Math.max(power, s[j]);
      const light = Math.max(0, Math.min(80, (20 * Math.log10(power + 1e-8) + 85) * 1.2));
      svg += '<rect x="' + x + '" y="' + (y + 110 + (79 - band) * 2) + '" width="' + (width + 0.2) + '" height="2" fill="hsl(85,70%,' + light + '%)"/>';
    }
  }
  svg += '<text x="10" y="' + (y + 120) + '" fill="white" font-size="11">1200 Hz</text><text x="10" y="' + (y + 268) + '" fill="white" font-size="11">0 Hz</text>';
  for (let t = 0; t < a.seconds; t += r ? 1 : 5) svg += '<text x="' + (60 + t / a.seconds * 1100) + '" y="' + (y + 287) + '" fill="white" font-size="11">' + t + 's</text>';
}
fs.writeFileSync(path.join(work, 'overview.svg'), svg + '</svg>');
console.log(analysis.map(({ blocks, ...info }) => info));
if (process.argv.includes('--analyze-only')) process.exit(0);
// Candidate selections are intentionally explicit and reviewable. See docs/COYOTE-AUDIO.md.
const selections = [
  { key: 'idle', recording: 0, start: 0.15, end: 1.25, nominalRpm: 1100, overlap: 0.06 },
  { key: 'mid', recording: 0, start: 21.0, end: 22.15, nominalRpm: 2700, overlap: 0.04 },
  // Both pull loops hold one engine speed, because the first bank's short pull windows
  // swept audibly on every repeat. See docs/COYOTE-OSCILLATION.md.
  { key: 'load', recording: 0, start: 50.6, nominalRpm: 4400, cycles: 22, overlapCycles: 6, seedHz: 60 },
  { key: 'high', recording: 0, start: 53.3, nominalRpm: 6600, cycles: 55, overlapCycles: 9, seedHz: 104 },
  { key: 'incar-reference', recording: 1, start: 6.5, end: 7.7, nominalRpm: null, overlap: 0.04 },
];
// Windowed-sinc 65-tap 9.5 kHz lowpass before 48 -> 24 kHz decimation.
function filteredMono(wav, start, end) {
  const input = wav.mono, rate = wav.rate, out = new Float64Array(Math.floor((end - start) * 24000));
  if (rate !== 48000) throw new Error('Processing recipe requires 48 kHz masters');
  const taps = [], cutoff = 9500 / rate;
  for (let k = -32; k <= 32; k++) taps.push((k === 0 ? 2 * cutoff : Math.sin(2 * Math.PI * cutoff * k) / (Math.PI * k)) * (0.54 + 0.46 * Math.cos(Math.PI * k / 32)));
  const norm = taps.reduce((a, b) => a + b, 0);
  // First-order DC/rumble removal at 35 Hz, with 100 ms pre-roll.
  const first = Math.floor(start * rate), last = Math.ceil(end * rate), hp = new Float64Array(last - first + 4800);
  let x0 = 0, y0 = 0; const a = Math.exp(-2 * Math.PI * 35 / rate);
  for (let i = first - 4800; i < last; i++) { const x = input[Math.max(0, i)] || 0; y0 = a * (y0 + x - x0); x0 = x; hp[i - first + 4800] = y0; }
  for (let i = 0; i < out.length; i++) { let value = 0; for (let k = -32; k <= 32; k++) value += (hp[i * 2 + k + 4800] || 0) * taps[k + 32]; out[i] = value / norm; }
  return out;
}
function wav16(samples) {
  const b = Buffer.alloc(44 + samples.length * 2); b.write('RIFF'); b.writeUInt32LE(b.length - 8, 4); b.write('WAVEfmt ', 8);
  b.writeUInt32LE(16, 16); b.writeUInt16LE(1, 20); b.writeUInt16LE(1, 22); b.writeUInt32LE(24000, 24); b.writeUInt32LE(48000, 28);
  b.writeUInt16LE(2, 32); b.writeUInt16LE(16, 34); b.write('data', 36); b.writeUInt32LE(samples.length * 2, 40);
  samples.forEach((v, i) => b.writeInt16LE(Math.max(-32768, Math.min(32767, Math.round(v * 32767))), 44 + i * 2)); return b;
}
// One engine cycle is two crank revolutions. The source pull is resampled against its
// measured crank speed, so the result holds one speed for a whole number of cycles
// and its last sample leads into its first with every harmonic in step. Level is
// flattened only slowly (0.2 s), so combustion texture stays as recorded.
function stationaryLoop(w, selection, rmsTarget) {
  const rate = w.rate, margin = 0.2;
  if (rate !== 48000) throw new Error('Processing recipe requires 48 kHz masters');
  const cycleSamples = 24000 * 120 / selection.nominalRpm;
  const length = selection.cycles * cycleSamples, overlap = selection.overlapCycles * cycleSamples;
  // Only the loop length must be exact: raw[length + i] then repeats raw[i] in phase.
  if (Math.abs(length - Math.round(length)) > 1e-6) throw new Error('Loop must be a whole number of samples');
  const total = Math.round(length) + Math.round(overlap);
  // Follow the crank far enough ahead to cover every revolution the loop needs.
  const crank = trackCrank(w.mono, rate, selection.start - margin, selection.start + total / 24000 * 1.5 + margin, selection.seedHz);
  const speed = fitPolynomial(crank.map(({ t, hz }) => ({ t, y: hz })), 4);
  const dt = 1 / rate, revsPerSample = selection.nominalRpm / 60 / 24000;
  let t = selection.start, turned = 0;
  // Same first-order highpass and windowed-sinc lowpass as the plain recipe, kept at
  // the full rate so the resampling below has room to read between samples.
  const first = Math.floor((selection.start - margin) * rate), last = Math.ceil((crank.at(-1).t + margin) * rate);
  const hp = new Float64Array(last - first + 4800);
  let x0 = 0, y0 = 0; const pole = Math.exp(-2 * Math.PI * 35 / rate);
  for (let i = first - 4800; i < last; i++) { const x = w.mono[Math.max(0, i)] || 0; y0 = pole * (y0 + x - x0); x0 = x; hp[i - first + 4800] = y0; }
  const taps = [], cutoff = 9500 / rate;
  for (let k = -32; k <= 32; k++) taps.push((k === 0 ? 2 * cutoff : Math.sin(2 * Math.PI * cutoff * k) / (Math.PI * k)) * (0.54 + 0.46 * Math.cos(Math.PI * k / 32)));
  const norm = taps.reduce((a, b) => a + b, 0);
  const full = new Float64Array(last - first);
  for (let i = 0; i < full.length; i++) { let v = 0; for (let k = -32; k <= 32; k++) v += (hp[i + 4800 + k] || 0) * taps[k + 32]; full[i] = v / norm; }
  // A table of when each output sample's revolution happens, with spare revolutions
  // either side, because locking the phase below moves readings a little both ways.
  const pad = Math.round(3 * cycleSamples), search = Math.round(8 * cycleSamples), padded = total + 2 * pad + search;
  const when = new Float64Array(padded);
  for (let next = 0; next < padded; next++) {
    const wanted = next * revsPerSample;
    while (turned < wanted) { turned += speed(t) * dt; t += dt; }
    when[next] = t;
  }
  if (t > crank.at(-1).t) throw new Error('Crank track ended before the loop did');
  const timeAt = (position) => {
    const at = Math.max(0, Math.min(padded - 1.000001, position)), low = Math.floor(at);
    return when[low] + (when[low + 1] - when[low]) * (at - low);
  };
  const read = (shift) => Float64Array.from({ length: padded }, (_, n) => sincAt(full, timeAt(n - shift(n)) * rate - first));
  // Lock the phase. Three passes, each correcting what the last one left behind.
  const samplesPerRevolution = cycleSamples / 2;
  let shift = () => 0;
  for (let pass = 0; pass < 3; pass++) {
    const drift = phaseDrift(read(shift), samplesPerRevolution), previous = shift;
    shift = (n) => previous(n) + drift(n) * samplesPerRevolution;
  }
  const locked = read(shift);
  // Harmonics keep moving against each other as RPM changes, so no correction lines
  // them all up everywhere. Choose the start where the two ends of the seam agree best
  // below about 500 Hz, because cancelling the strong low harmonics is what dips the level.
  const lows = new Float64Array(locked.length);
  for (let i = 0, sum = 0; i < locked.length; i++) {
    sum += locked[i] - (locked[i - 48] ?? 0);
    lows[i] = sum / 48;
  }
  const head = Math.round(overlap), L = Math.round(length);
  let begin = pad, bestMatch = -Infinity;
  for (let candidate = pad; candidate <= pad + search; candidate += 4) {
    let dot = 0, aa = 0, bb = 0;
    for (let i = 0; i < head; i += 2) {
      const a = lows[candidate + i], b = lows[candidate + L + i];
      dot += a * b; aa += a * a; bb += b * b;
    }
    const match = dot / Math.sqrt(aa * bb + 1e-20);
    if (match > bestMatch) { bestMatch = match; begin = candidate; }
  }
  const raw = locked.slice(begin, begin + total);
  const actualEnd = timeAt(begin + total - shift(begin + total)), actualStart = timeAt(begin - shift(begin));
  // Flatten slow level changes: a Hann-weighted 0.2 s envelope.
  const span = Math.round(0.1 * 24000), envelope = new Float64Array(total);
  for (let i = 0; i < total; i++) {
    let sum = 0, weight = 0;
    for (let k = -span; k <= span; k += 8) {
      const v = raw[i + k];
      if (v === undefined) continue;
      const h = 0.5 + 0.5 * Math.cos(Math.PI * k / span);
      sum += v * v * h; weight += h;
    }
    envelope[i] = Math.sqrt(sum / weight);
  }
  const typical = Math.sqrt(envelope.reduce((a, v) => a + v * v, 0) / total);
  for (let i = 0; i < total; i++) raw[i] *= typical / envelope[i];
  const loop = raw.slice(head, L + head);
  let dot = 0, aa = 0, bb = 0;
  for (let i = 0; i < head; i++) {
    const a = raw[i], b = raw[L + i], u = i / (head - 1), mix = u * u * (3 - 2 * u);
    dot += a * b; aa += a * a; bb += b * b;
    loop[L - head + i] = b * (1 - mix) + a * mix;
  }
  let square = 0, peak = 0; for (const v of loop) { square += v * v; peak = Math.max(peak, Math.abs(v)); }
  const gain = Math.min(rmsTarget / Math.sqrt(square / L), 0.75 / peak);
  for (let i = 0; i < L; i++) loop[i] *= gain;
  const used = crank.filter((r) => r.t >= actualStart && r.t <= actualEnd);
  return {
    loop, gain, peak: peak * gain, rms: Math.sqrt(square / L) * gain, overlapCorrelation: dot / Math.sqrt(aa * bb + 1e-20),
    actualStart, actualEnd, overlap: head / 24000,
    sourceRpmFrom: Math.round(speed(actualStart) * 60), sourceRpmTo: Math.round(speed(actualEnd) * 60),
    fitResidualRpm: +Math.sqrt(used.reduce((a, r) => a + ((r.hz - speed(r.t)) * 60) ** 2, 0) / used.length).toFixed(1),
  };
}
// The first bank's level for each pull layer, so the mix stays where it was accepted.
const RMS_TARGET = { load: 0.21248573144198601, high: 0.18675700985340823 };
const outputArg = process.argv.indexOf('--output');
const output = outputArg > 0 ? path.resolve(process.argv[outputArg + 1]) : path.join(root, 'audio-lab/assets/coyote-local'); fs.mkdirSync(output, { recursive: true });
const manifest = { recipe: 2, rate: 24000, format: 'mono PCM16 WAV', rights: 'Recorded and owned by the Mini Drifters project owner, who confirmed full ownership on 2026-11-06 and authorized distribution with Mini Drifters. The four runtime loops are published on that basis. Not MIT and not CC0; no broader reuse license is granted. The masters and the in-car reference are not published. See LICENSE-AUDIO.md.',
  sources: recordings.map((w) => w.info), loops: [] };
for (const selection of selections) {
  const w = recordings[selection.recording], margin = 0.015;
  if (selection.cycles) {
    const { loop, ...facts } = stationaryLoop(w, selection, RMS_TARGET[selection.key]);
    const file = selection.key + '.wav', bytes = wav16(loop); fs.writeFileSync(path.join(output, file), bytes);
    let maxStep = 0; for (let i = 1; i < loop.length; i++) maxStep = Math.max(maxStep, Math.abs(loop[i] - loop[i - 1]));
    manifest.loops.push({ ...selection, source: w.info.file, recipe: 'stationary', ...facts, file, bytes: bytes.length, seconds: loop.length / 24000, sha256: sha(bytes),
      seamStep: Math.abs(loop[0] - loop.at(-1)), maxInteriorStep: maxStep });
    continue;
  }
  const raw = filteredMono(w, selection.start, selection.end + margin);
  const expected = Math.round((selection.end - selection.start) * 24000), overlap = Math.round(selection.overlap * 24000);
  let best = { score: -Infinity };
  // Search within +/-15 ms for the most correlated overlap. This aligns repeating
  // waveform structure; it cannot remove RPM drift or establish crank phase.
  for (let end = expected - 360; end <= expected + 360 && end <= raw.length; end++) {
    let dot = 0, aa = 0, bb = 0;
    for (let i = 0; i < overlap; i++) { const a = raw[i], b = raw[end - overlap + i]; dot += a * b; aa += a * a; bb += b * b; }
    const correlation = dot / Math.sqrt(aa * bb + 1e-20), score = correlation - 0.03 * Math.abs(end - expected) / 360;
    if (score > best.score) best = { score, correlation, end };
  }
  const loop = raw.slice(overlap, best.end);
  for (let i = 0; i < overlap; i++) { const t = i / (overlap - 1), mix = t * t * (3 - 2 * t); loop[loop.length - overlap + i] = raw[best.end - overlap + i] * (1 - mix) + raw[i] * mix; }
  let square = 0, peak = 0; for (const v of loop) { square += v * v; peak = Math.max(peak, Math.abs(v)); }
  const gain = Math.min(0.22 / Math.sqrt(square / loop.length), 0.75 / peak, 3);
  for (let i = 0; i < loop.length; i++) loop[i] *= gain;
  const file = selection.key + '.wav', bytes = wav16(loop); fs.writeFileSync(path.join(output, file), bytes);
  let maxStep = 0; for (let i = 1; i < loop.length; i++) maxStep = Math.max(maxStep, Math.abs(loop[i] - loop[i - 1]));
  manifest.loops.push({ ...selection, source: w.info.file, actualEnd: selection.start + best.end / 24000,
    file, bytes: bytes.length, seconds: loop.length / 24000, sha256: sha(bytes), overlapCorrelation: best.correlation,
    gain, peak: peak * gain, rms: Math.sqrt(square / loop.length) * gain,
    seamStep: Math.abs(loop[0] - loop.at(-1)), maxInteriorStep: maxStep });
}
manifest.runtimeBytes = manifest.loops.filter((l) => l.key !== 'incar-reference').reduce((n, l) => n + l.bytes, 0);
fs.writeFileSync(path.join(work, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
console.log(JSON.stringify(manifest, null, 2));
