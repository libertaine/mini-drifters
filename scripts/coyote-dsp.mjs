// Small signal helpers shared by the Coyote offline scripts. Node built-ins only.
import fs from 'node:fs';

export function readPcm16(file) {
  const b = fs.readFileSync(file);
  let fmt, data;
  for (let p = 12; p + 8 <= b.length;) {
    const size = b.readUInt32LE(p + 4), id = b.toString('ascii', p, p + 4);
    if (id === 'fmt ') fmt = b.subarray(p + 8, p + 8 + size);
    if (id === 'data') data = b.subarray(p + 8, p + 8 + size);
    p += 8 + size + size % 2;
  }
  const channels = fmt.readUInt16LE(2), rate = fmt.readUInt32LE(4), frames = data.length / (2 * channels);
  const x = new Float64Array(frames);
  for (let i = 0; i < frames; i++) {
    let s = 0;
    for (let c = 0; c < channels; c++) s += data.readInt16LE((i * channels + c) * 2) / 32768;
    x[i] = s / channels;
  }
  return { x, rate };
}

export function fft(re, im) {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) { [re[i], re[j]] = [re[j], re[i]]; [im[i], im[j]] = [im[j], im[i]]; }
  }
  for (let len = 2; len <= n; len *= 2) {
    const angle = -2 * Math.PI / len;
    for (let i = 0; i < n; i += len) for (let j = 0; j < len / 2; j++) {
      const c = Math.cos(angle * j), s = Math.sin(angle * j), a = i + j, b = a + len / 2;
      const r = re[b] * c - im[b] * s, v = re[b] * s + im[b] * c;
      re[b] = re[a] - r; im[b] = im[a] - v; re[a] += r; im[a] += v;
    }
  }
}

export function magnitudes(x, start, win, nfft) {
  const re = new Float64Array(nfft), im = new Float64Array(nfft);
  for (let i = 0; i < win; i++) re[i] = (x[start + i] || 0) * (0.5 - 0.5 * Math.cos(2 * Math.PI * i / (win - 1)));
  fft(re, im);
  const m = new Float64Array(nfft / 2);
  for (let i = 0; i < nfft / 2; i++) m[i] = Math.hypot(re[i], im[i]);
  return m;
}

// Crank frequency by a comb over half-engine orders, where a V8's energy sits;
// firing rate is order 4. The search range is narrow, so this reads pitch movement.
// Calling the result "RPM" assumes that family, which the dyno pull supports by
// staying continuous from about 3200 to 6900 RPM. No tachometer confirms it.
export function combPeak(m, df, lo, hi, step = 1.0005) {
  let best = { hz: lo, score: -1 };
  for (let hz = lo; hz <= hi; hz *= step) {
    let score = 0;
    for (let k = 2; k <= 40; k++) {
      const pos = (k / 2) * hz / df, i = Math.floor(pos);
      if (i + 1 >= m.length) break;
      score += Math.sqrt(m[i] + (m[i + 1] - m[i]) * (pos - i)) / Math.sqrt(k);
    }
    if (score > best.score) best = { hz, score };
  }
  return best.hz;
}

export function trackCrank(x, rate, from, to, seedHz, { follow = true, spread = 0.2, winSeconds = 0.085, hop = 0.01 } = {}) {
  const win = Math.round(winSeconds * rate), nfft = 2 ** Math.ceil(Math.log2(win * 4)), df = rate / nfft;
  const rows = [];
  let seed = seedHz;
  for (let t = from; t + winSeconds <= to; t += hop) {
    const m = magnitudes(x, Math.round(t * rate), win, nfft);
    const range = follow ? 0.06 : spread;
    const hz = combPeak(m, df, seed * (1 - range), seed * (1 + range));
    rows.push({ t: t + winSeconds / 2, hz });
    if (follow) seed = hz;
  }
  return rows;
}

// Least-squares polynomial through (t, y), solved by Gaussian elimination on
// values scaled to -1..1. Returns a function of t.
export function fitPolynomial(points, degree) {
  const lo = points[0].t, hi = points.at(-1).t;
  const u = (t) => (2 * t - lo - hi) / (hi - lo);
  const n = degree + 1;
  const a = Array.from({ length: n }, () => new Float64Array(n + 1));
  for (const { t, y } of points) {
    const powers = [1];
    for (let i = 1; i < 2 * n; i++) powers.push(powers[i - 1] * u(t));
    for (let r = 0; r < n; r++) {
      for (let c = 0; c < n; c++) a[r][c] += powers[r + c];
      a[r][n] += y * powers[r];
    }
  }
  for (let i = 0; i < n; i++) {
    let pivot = i;
    for (let r = i + 1; r < n; r++) if (Math.abs(a[r][i]) > Math.abs(a[pivot][i])) pivot = r;
    [a[i], a[pivot]] = [a[pivot], a[i]];
    for (let r = 0; r < n; r++) {
      if (r === i) continue;
      const f = a[r][i] / a[i][i];
      for (let c = i; c <= n; c++) a[r][c] -= f * a[i][c];
    }
  }
  const coefficients = a.map((row, i) => row[n] / row[i]);
  return (t) => {
    let result = 0, power = 1;
    const x = u(t);
    for (const c of coefficients) { result += c * power; power *= x; }
    return result;
  };
}

// How far a constant-speed signal has drifted from perfect rotation, in revolutions.
// Each strong engine order gives its own reading of that drift through its phase;
// they are averaged by strength. Resampling against this result locks the harmonics
// in phase, not just in frequency, so a whole number of cycles later they line up.
export function phaseDrift(x, samplesPerRevolution, { revolutionsWide = 8, stride = 32 } = {}) {
  const span = Math.round(revolutionsWide * samplesPerRevolution / 2);
  const points = Math.floor(x.length / stride) + 1;
  const readings = [];
  for (let order = 1.5; order <= 12; order += 0.5) {
    const w = 2 * Math.PI * order / samplesPerRevolution;
    const phase = new Float64Array(points);
    let strength = 0;
    for (let p = 0, last = 0, offset = 0; p < points; p++) {
      const centre = p * stride;
      let re = 0, im = 0;
      for (let i = Math.max(0, centre - span); i <= Math.min(x.length - 1, centre + span); i += 4) {
        const hann = 0.5 + 0.5 * Math.cos(Math.PI * (i - centre) / span);
        re += x[i] * hann * Math.cos(w * i);
        im -= x[i] * hann * Math.sin(w * i);
      }
      strength += Math.hypot(re, im);
      let angle = Math.atan2(im, re);
      if (p > 0) {
        while (angle + offset - last > Math.PI) offset -= 2 * Math.PI;
        while (angle + offset - last < -Math.PI) offset += 2 * Math.PI;
      }
      last = angle + offset;
      phase[p] = last;
    }
    readings.push({ order, phase, strength });
  }
  readings.sort((a, b) => b.strength - a.strength);
  const strongest = readings.slice(0, 6);
  const total = strongest.reduce((sum, r) => sum + r.strength, 0);
  const drift = new Float64Array(points);
  for (const { order, phase, strength } of strongest) {
    const mean = phase.reduce((a, b) => a + b, 0) / points;
    for (let p = 0; p < points; p++) drift[p] += (phase[p] - mean) / (2 * Math.PI * order) * strength / total;
  }
  return (i) => {
    const at = Math.max(0, Math.min(points - 1.000001, i / stride)), low = Math.floor(at);
    return drift[low] + (drift[low + 1] - drift[low]) * (at - low);
  };
}

// Reads a signal between samples with a 16-point Hann-windowed sinc.
export function sincAt(x, position) {
  const base = Math.floor(position), fraction = position - base;
  if (fraction === 0) return x[base] ?? 0;
  let sum = 0;
  for (let k = -7; k <= 8; k++) {
    const d = k - fraction, window = 0.5 + 0.5 * Math.cos(Math.PI * d / 8);
    sum += (x[base + k] ?? 0) * Math.sin(Math.PI * d) / (Math.PI * d) * window;
  }
  return sum;
}
