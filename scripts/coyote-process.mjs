// Offline owner-audio analysis and loop construction. Node 24; no dependencies.
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
const root = fileURLToPath(new URL('../', import.meta.url));
const sourceArg = process.argv.indexOf('--source');
if (sourceArg < 0 || !process.argv[sourceArg + 1]) throw new Error('Usage: node scripts/coyote-process.mjs --source /absolute/master/directory [--analyze-only]');
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
  { key: 'load', recording: 0, start: 50.15, end: 50.55, nominalRpm: 4400, overlap: 0.025 },
  { key: 'high', recording: 0, start: 53.6, end: 53.95, nominalRpm: 6600, overlap: 0.025 },
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
const output = path.join(root, 'audio-lab/assets/coyote-local'); fs.mkdirSync(output, { recursive: true });
const manifest = { recipe: 1, rate: 24000, format: 'mono PCM16 WAV', rights: 'Owner supplied; public redistribution NOT confirmed. Do not commit audio.',
  sources: recordings.map((w) => w.info), loops: [] };
for (const selection of selections) {
  const w = recordings[selection.recording], margin = 0.015;
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
