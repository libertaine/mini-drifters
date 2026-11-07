// Generates the radio's TEMPORARY TEST LOOPS. They exist so the radio can be built and
// tested before real music is chosen, and they are not finished music. Everything here
// is synthesized from scratch: no samples, no downloads and no external tools.
//
//   node scripts/radio-test-tracks.mjs
//
// The output is deterministic for a given Node version. Mono, 16-bit, 22.05 kHz WAV keeps
// a loop seamless without an encoder's padding, at about 44 KB a second.
import { createHash } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const RATE = 22050;
const TARGET_RMS = 0.16;
const PEAK_LIMIT = 0.7;
const OUT = new URL('../radio/test-tracks/', import.meta.url);

const midi = (note) => 440 * 2 ** ((note - 69) / 12);

function random(seed) {
  let x = seed;
  return () => {
    x ^= x << 13; x ^= x >>> 17; x ^= x << 5;
    return (x >>> 0) / 4294967296 * 2 - 1;
  };
}

const blank = (seconds) => new Float64Array(Math.round(seconds * RATE));

// Everything wraps around the end of the buffer, so tails ring into the loop's start.
function addAt(buffer, index, value) {
  buffer[index % buffer.length] += value;
}

function saw(buffer, at, length, hz, { level = 0.2, partials = 14, attack = 0.004, decay = Infinity, release = 0.02 } = {}) {
  const start = Math.round(at * RATE);
  const count = Math.round(length * RATE);
  const top = Math.min(partials, Math.floor(0.45 * RATE / hz));
  for (let i = 0; i < count; i++) {
    const t = i / RATE;
    const envelope = Math.min(1, t / attack) * Math.min(1, (length - t) / release) * Math.exp(-t / decay);
    let sum = 0;
    for (let k = 1; k <= top; k++) sum += Math.sin(2 * Math.PI * k * hz * t) / k;
    addAt(buffer, start + i, sum * envelope * level);
  }
}

function square(buffer, at, length, hz, { level = 0.2, decay = Infinity } = {}) {
  const start = Math.round(at * RATE);
  const count = Math.round(length * RATE);
  const top = Math.floor(0.45 * RATE / hz);
  for (let i = 0; i < count; i++) {
    const t = i / RATE;
    const envelope = Math.min(1, t / 0.003) * Math.min(1, (length - t) / 0.01) * Math.exp(-t / decay);
    let sum = 0;
    for (let k = 1; k <= Math.min(top, 15); k += 2) sum += Math.sin(2 * Math.PI * k * hz * t) / k;
    addAt(buffer, start + i, sum * envelope * level);
  }
}

function kick(buffer, at, level = 0.8) {
  const start = Math.round(at * RATE);
  let phase = 0;
  for (let i = 0; i < 0.22 * RATE; i++) {
    const t = i / RATE;
    phase += 2 * Math.PI * (46 + 120 * Math.exp(-t / 0.035)) / RATE;
    addAt(buffer, start + i, Math.sin(phase) * Math.exp(-t / 0.075) * level);
  }
}

function snare(buffer, at, noise, level = 0.5, tail = 0.09) {
  const start = Math.round(at * RATE);
  for (let i = 0; i < tail * 4 * RATE; i++) {
    const t = i / RATE;
    const body = Math.sin(2 * Math.PI * 190 * t) * Math.exp(-t / 0.04) * 0.6;
    addAt(buffer, start + i, (noise() * Math.exp(-t / tail) + body) * level);
  }
}

function hat(buffer, at, noise, level = 0.14) {
  const start = Math.round(at * RATE);
  let last = 0;
  for (let i = 0; i < 0.05 * RATE; i++) {
    const n = noise();
    addAt(buffer, start + i, (n - last) * Math.exp(-i / RATE / 0.016) * level);
    last = n;
  }
}

function fuzz(buffer, drive) {
  for (let i = 0; i < buffer.length; i++) buffer[i] = Math.tanh(buffer[i] * drive);
  return buffer;
}

// Two trips round the loop, so the filter's memory at the seam matches its steady state.
function lowpass(buffer, cutoff) {
  const a = 1 - Math.exp(-2 * Math.PI * cutoff / RATE);
  let y = 0;
  for (let pass = 0; pass < 2; pass++) {
    for (let i = 0; i < buffer.length; i++) {
      y += a * (buffer[i] - y);
      if (pass === 1) buffer[i] = y;
    }
  }
  return buffer;
}

function mix(...stems) {
  const out = new Float64Array(stems[0].length);
  for (const stem of stems) for (let i = 0; i < out.length; i++) out[i] += stem[i];
  return out;
}

// --- Garage Rock: fuzzy power chords, a plain beat, a little ragged ------------------
function garageRock() {
  const beat = 60 / 138;
  const bars = 8;
  const guitar = blank(bars * 4 * beat);
  const bass = blank(bars * 4 * beat);
  const drums = blank(bars * 4 * beat);
  const noise = random(0x6a2d11);
  const roots = [40, 40, 43, 45, 40, 40, 38, 45]; // E E G A E E D A
  const rhythm = [1, 0, 1, 1, 0, 1, 1, 0]; // eighth notes, offbeat and shoving forward
  for (let bar = 0; bar < bars; bar++) {
    for (let step = 0; step < 8; step++) {
      const at = (bar * 4 + step / 2) * beat;
      if (rhythm[step]) {
        for (const [interval, detune] of [[0, 0.998], [7, 1.002], [12, 1.001]]) {
          saw(guitar, at, beat * 0.46, midi(roots[bar] + interval) * detune, { level: 0.22, partials: 10, decay: 0.5 });
        }
      }
      square(bass, at, beat * 0.42, midi(roots[bar] - 12), { level: 0.26, decay: 0.3 });
      hat(drums, at, noise, step % 2 ? 0.09 : 0.15);
    }
    for (const at of [0, 1.5, 2.5]) kick(drums, (bar * 4 + at) * beat, 0.75);
    for (const at of [1, 3]) snare(drums, (bar * 4 + at) * beat, noise, 0.48);
  }
  fuzz(guitar, 3.6);
  lowpass(guitar, 3400);
  lowpass(bass, 900);
  return mix(guitar.map((v) => v * 0.42), bass, drums);
}

// --- Synth FM: gated pads, a sequenced bass and an arpeggio, at a cruising tempo ------
function synthFm() {
  const beat = 60 / 96;
  const bars = 4;
  const pad = blank(bars * 4 * beat);
  const bass = blank(bars * 4 * beat);
  const arp = blank(bars * 4 * beat);
  const drums = blank(bars * 4 * beat);
  const noise = random(0x35c7e9);
  const chords = [[57, 60, 64], [53, 57, 60], [48, 52, 55], [55, 59, 62]]; // Am F C G
  const pattern = [0, 1, 2, 3, 2, 1, 2, 3];
  for (let bar = 0; bar < bars; bar++) {
    const chord = chords[bar];
    for (const note of chord) {
      for (const detune of [0.996, 1.004]) {
        saw(pad, bar * 4 * beat, 4 * beat, midi(note) * detune, { level: 0.07, partials: 8, attack: 0.4, release: 0.3 });
      }
    }
    for (let step = 0; step < 16; step++) {
      const at = (bar * 4 + step / 4) * beat;
      square(bass, at, beat * 0.22, midi(chord[0] - 24), { level: 0.22, decay: 0.2 });
      const degree = pattern[step % 8];
      const note = degree === 3 ? chord[0] + 12 : chord[degree];
      saw(arp, at, beat * 0.2, midi(note + 12), { level: 0.13, partials: 6, decay: 0.09 });
      hat(drums, at, noise, step % 4 === 2 ? 0.11 : 0.05);
    }
    for (let at = 0; at < 4; at++) kick(drums, (bar * 4 + at) * beat, 0.7);
    for (const at of [1, 3]) snare(drums, (bar * 4 + at) * beat, noise, 0.34, 0.2); // a long, gated-sounding tail
  }
  lowpass(pad, 1800);
  lowpass(bass, 700);
  lowpass(arp, 3800);
  return mix(pad, bass, arp, drums);
}

// --- Redline Radio: fast, tight and heavily driven, with a riff that keeps climbing ---
function redlineRadio() {
  const beat = 60 / 176;
  const bars = 8;
  const riff = blank(bars * 4 * beat);
  const bass = blank(bars * 4 * beat);
  const drums = blank(bars * 4 * beat);
  const noise = random(0x7f1b43);
  const lines = [
    [38, 38, 41, 38, 43, 38, 44, 45],
    [38, 38, 41, 38, 43, 41, 40, 37],
  ];
  for (let bar = 0; bar < bars; bar++) {
    const line = lines[bar % 2];
    const lift = bar >= 4 ? 5 : 0;
    for (let step = 0; step < 8; step++) {
      const at = (bar * 4 + step / 2) * beat;
      const note = line[step] + lift;
      for (const [interval, detune] of [[0, 0.997], [7, 1.003], [12, 1]]) {
        saw(riff, at, beat * 0.4, midi(note + interval) * detune, { level: 0.25, partials: 9, decay: 0.3 });
      }
      square(bass, at, beat * 0.4, midi(note - 12), { level: 0.28, decay: 0.2 });
      hat(drums, at, noise, 0.14);
      hat(drums, at + beat / 4, noise, 0.08);
    }
    for (let at = 0; at < 4; at++) kick(drums, (bar * 4 + at) * beat, 0.85);
    for (const at of [1, 3]) snare(drums, (bar * 4 + at) * beat, noise, 0.55, 0.07);
    if (bar % 2) snare(drums, (bar * 4 + 3.5) * beat, noise, 0.32, 0.05);
  }
  fuzz(riff, 6);
  lowpass(riff, 4200);
  lowpass(bass, 1100);
  return mix(riff.map((v) => v * 0.4), bass, drums);
}

// --- Output -----------------------------------------------------------------------
function normalize(samples) {
  const out = samples.map((v) => Math.tanh(v));
  let peak = 0, sum = 0;
  for (const v of out) { peak = Math.max(peak, Math.abs(v)); sum += v * v; }
  const rms = Math.sqrt(sum / out.length);
  return { samples: out.map((v) => v * Math.min(PEAK_LIMIT / peak, TARGET_RMS / rms)) };
}

function wav(samples) {
  const bytes = Buffer.alloc(44 + samples.length * 2);
  bytes.write('RIFF', 0); bytes.writeUInt32LE(36 + samples.length * 2, 4); bytes.write('WAVEfmt ', 8);
  bytes.writeUInt32LE(16, 16); bytes.writeUInt16LE(1, 20); bytes.writeUInt16LE(1, 22);
  bytes.writeUInt32LE(RATE, 24); bytes.writeUInt32LE(RATE * 2, 28); bytes.writeUInt16LE(2, 32); bytes.writeUInt16LE(16, 34);
  bytes.write('data', 36); bytes.writeUInt32LE(samples.length * 2, 40);
  samples.forEach((v, i) => bytes.writeInt16LE(Math.round(v * 32767), 44 + i * 2));
  return bytes;
}

mkdirSync(OUT, { recursive: true });
for (const [file, build] of [['garage-rock-test.wav', garageRock], ['synth-fm-test.wav', synthFm], ['redline-radio-test.wav', redlineRadio]]) {
  const { samples } = normalize(build());
  const bytes = wav(samples);
  writeFileSync(fileURLToPath(new URL(file, OUT)), bytes);
  const peak = samples.reduce((m, v) => Math.max(m, Math.abs(v)), 0);
  const rms = Math.sqrt(samples.reduce((m, v) => m + v * v, 0) / samples.length);
  console.log(`${file} | \`${createHash('sha256').update(bytes).digest('hex')}\` | ${bytes.length} bytes | ${(samples.length / RATE).toFixed(2)} s | peak ${peak.toFixed(3)} | rms ${rms.toFixed(3)}`);
}
