// Getaway Drift's smash sounds (EXPERIMENTAL, v0.7.0 R4C research). Synthesized in the browser from
// white noise and a falling sine "thump": no recordings, no third-party material, nothing loaded.
// A recipe is plain data (layers, each a short burst), so the tests read exactly what plays.
//
//   fruit stand  a dull wooden crate thump, a crunch, a soft splat, then four small rattles of crates
//                and fruit settling, quieter each time
//   barricade    a sharp crack, a thump, splintering, then two planks clattering down
//
// Every recipe is over within half a second. GameAudio.smash (audio.js) plays one per broken object,
// into the effects path, and caps how many may overlap.

export const SMASH_SFX = Object.freeze({
  level: 0.5,        // the whole smash, into the master bus (the effects volume follows it)
  maxVoices: 3,      // smashes still sounding at once; another is dropped, never queued
  fruit: Object.freeze([
    { type: 'thump', at: 0, freq: 120, to: 58, dur: 0.16, gain: 0.85 },
    { type: 'noise', at: 0, dur: 0.2, filter: 'bandpass', freq: 1300, q: 0.9, gain: 0.7 },
    { type: 'noise', at: 0.02, dur: 0.12, filter: 'lowpass', freq: 650, q: 0.7, gain: 0.45 },
    { type: 'noise', at: 0.08, dur: 0.045, filter: 'bandpass', freq: 2900, q: 2.5, gain: 0.34 },
    { type: 'noise', at: 0.15, dur: 0.04, filter: 'bandpass', freq: 3300, q: 2.5, gain: 0.26 },
    { type: 'noise', at: 0.23, dur: 0.04, filter: 'bandpass', freq: 2500, q: 2.5, gain: 0.19 },
    { type: 'noise', at: 0.33, dur: 0.035, filter: 'bandpass', freq: 3100, q: 2.5, gain: 0.13 },
  ].map(Object.freeze)),
  barricade: Object.freeze([
    { type: 'noise', at: 0, dur: 0.05, filter: 'highpass', freq: 2800, q: 0.7, gain: 1.0 },
    { type: 'thump', at: 0, freq: 170, to: 82, dur: 0.12, gain: 0.8 },
    { type: 'noise', at: 0.01, dur: 0.28, filter: 'bandpass', freq: 950, q: 1.2, gain: 0.55 },
    { type: 'noise', at: 0.13, dur: 0.06, filter: 'bandpass', freq: 1900, q: 2, gain: 0.3 },
    { type: 'noise', at: 0.22, dur: 0.05, filter: 'bandpass', freq: 1700, q: 2, gain: 0.2 },
  ].map(Object.freeze)),
});

// How long a recipe sounds, in seconds.
export function smashLength(kind, sfx = SMASH_SFX) {
  return Math.max(...(sfx[kind] ?? []).map((l) => l.at + l.dur), 0);
}

// Half a second of white noise per audio context, made once (a fixed-seed generator: the same
// noise every time).
const noiseBuffers = new WeakMap();
function noiseFor(ctx) {
  if (!noiseBuffers.has(ctx)) {
    const length = Math.max(1, Math.round(ctx.sampleRate * 0.5));
    const buffer = ctx.createBuffer(1, length, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    let seed = 2463534242;
    for (let i = 0; i < length; i += 1) {
      seed ^= seed << 13; seed >>>= 0;
      seed ^= seed >>> 17;
      seed ^= seed << 5; seed >>>= 0;
      data[i] = (seed / 4294967296) * 2 - 1;
    }
    noiseBuffers.set(ctx, buffer);
  }
  return noiseBuffers.get(ctx);
}

// Plays one cancellable voice. Every layer disconnects on completion; stop() also
// cancels scheduled rattles so pause/resume cannot replay the old impact.
export function playSmash(ctx, destination, kind, sfx = SMASH_SFX) {
  const recipe = sfx[kind];
  const t0 = ctx.currentTime;
  if (!recipe) return null;
  const sources = [];
  let cancelled = false;
  const out = ctx.createGain();
  out.gain.setValueAtTime(sfx.level, t0);
  out.connect(destination);
  let last = null;
  let end = t0;
  for (const layer of recipe) {
    const start = t0 + layer.at;
    const stop = start + layer.dur;
    const env = ctx.createGain();
    env.gain.setValueAtTime(0, t0);
    env.gain.setValueAtTime(layer.gain, start);
    env.gain.setTargetAtTime(0, start + 0.004, layer.dur / 4);
    let source;
    if (layer.type === 'thump') {
      source = ctx.createOscillator();
      source.frequency.setValueAtTime(layer.freq, start);
      source.frequency.setTargetAtTime(layer.to, start, layer.dur / 3);
      source.connect(env);
    } else {
      source = ctx.createBufferSource();
      source.buffer = noiseFor(ctx);
      const filter = ctx.createBiquadFilter();
      filter.type = layer.filter;
      filter.frequency.setValueAtTime(layer.freq, start);
      filter.Q.setValueAtTime(layer.q, start);
      source.connect(filter).connect(env);
      source.onended = () => { try { filter.disconnect(); } catch { /* already gone */ } };
    }
    env.connect(out);
    sources.push(source);
    source.start(start);
    source.stop(stop);
    const previous = source.onended;
    source.onended = () => {
      previous?.();
      try { source.disconnect(); env.disconnect(); } catch { /* already gone */ }
    };
    if (stop >= end) { end = stop; last = source; }
  }
  // The longest layer's end takes the output with it.
  if (last) {
    const own = last.onended;
    last.onended = () => { own?.(); try { out.disconnect(); } catch { /* already gone */ } };
  }
  return { end, stop() {
    if (cancelled) return;
    cancelled = true;
    for (const source of sources) {
      try { source.stop(); } catch { /* already ended */ }
      source.onended?.();
    }
    try { out.disconnect(); } catch { /* already gone */ }
  } };
}
