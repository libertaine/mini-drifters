// Getaway & driving procedural sound effects (v0.8.0 R2). Synthesized in the browser from
// Web Audio oscillators and deterministic white noise: no recordings, no third-party material,
// nothing fetched over the network.
//
//   SMASH_SFX / playSmash   fruit stands and wooden barricades (R4C, preserved verbatim)
//   playImpact              velocity-scaled solid collision thump & scrape across all modes
//   playCone                hollow rubber-plastic cone bump for Gymkhana & Practice Pad
//   CUE_SFX / playCue       pursuit, stealth, camera shutter, bank & mission outcome cues
//   sirenTarget / createSirenVoice  distance- and sight-aware retro electromechanical police siren
//
// Every voice routes into the existing master/effects path, obeys mute/pause/focus/volume, and
// disconnects every Web Audio node cleanly on completion or cancellation.

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

export const FX_LIMITS = Object.freeze({
  impactLevel: 0.44,
  impactMaxVoices: 2,
  curbLevel: 0.24,
  curbMaxVoices: 2,
  cueLevel: 0.34,
  cueMaxVoices: 3,
  sirenLevel: 0.22,
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

// Plays one cancellable multi-layer recipe voice. Every layer disconnects on completion; stop()
// also cancels scheduled bursts so pause/resume cannot replay an old cue.
function playRecipe(ctx, destination, recipe, level) {
  const t0 = ctx.currentTime;
  if (!recipe?.length) return null;
  const sources = [];
  let cancelled = false;
  const out = ctx.createGain();
  out.gain.setValueAtTime(level, t0);
  out.connect(destination);
  let last = null;
  let end = t0;
  for (const layer of recipe) {
    const start = t0 + layer.at;
    const stop = start + layer.dur;
    const env = ctx.createGain();
    env.gain.setValueAtTime(0, t0);
    if (layer.attack) {
      env.gain.setValueAtTime(0.0001, start);
      env.gain.linearRampToValueAtTime(layer.gain, start + layer.attack);
      env.gain.setTargetAtTime(0, start + layer.attack, Math.max(0.012, (layer.dur - layer.attack) / 3.5));
    } else {
      env.gain.setValueAtTime(layer.gain, start);
      env.gain.setTargetAtTime(0, start + 0.004, Math.max(0.008, layer.dur / 4));
    }
    let source;
    if (layer.type === 'thump' || layer.type === 'tone') {
      source = ctx.createOscillator();
      source.type = layer.wave ?? 'sine';
      source.frequency.setValueAtTime(layer.freq, start);
      if (layer.to !== undefined && layer.to !== layer.freq) {
        source.frequency.setTargetAtTime(layer.to, start, layer.glide ?? layer.dur / 3);
      }
      if (layer.filter) {
        const filter = ctx.createBiquadFilter();
        filter.type = layer.filter;
        filter.frequency.setValueAtTime(layer.cutoff ?? 1800, start);
        filter.Q.setValueAtTime(layer.q ?? 0.9, start);
        source.connect(filter).connect(env);
        source.onended = () => { try { filter.disconnect(); } catch { /* already gone */ } };
      } else {
        source.connect(env);
      }
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

export function playSmash(ctx, destination, kind, sfx = SMASH_SFX) {
  return playRecipe(ctx, destination, sfx[kind], sfx.level);
}

// Solid impact (walls, buildings, containers, guardrails, trees). Scales cleanly with impact speed.
const SOFT_OBSTACLES = new Set(['tree', 'pine', 'stand', 'tyrewall', 'tyres', 'planter']);
const METAL_OBSTACLES = new Set(['container', 'guardrail', 'truck', 'van', 'trailer', 'dumpster', 'kiosk', 'blockade']);

export function playImpact(ctx, destination, intensity = 0.5, kind = 'wall') {
  const power = Math.max(0.15, Math.min(1, Number.isFinite(intensity) ? intensity : 0.5));
  const soft = SOFT_OBSTACLES.has(kind);
  const metal = METAL_OBSTACLES.has(kind);
  const recipe = soft ? [
    { type: 'thump', at: 0, freq: 95 + power * 30, to: 42, dur: 0.15, gain: 0.9 },
    { type: 'noise', at: 0, dur: 0.16, filter: 'lowpass', freq: 520 + power * 360, q: 0.8, gain: 0.52 },
  ] : metal ? [
    { type: 'thump', at: 0, freq: 135 + power * 45, to: 50, dur: 0.14, gain: 0.9 },
    { type: 'noise', at: 0, dur: 0.18, filter: 'bandpass', freq: 1650 + power * 700, q: 1.6, gain: 0.62 },
    { type: 'tone', wave: 'triangle', at: 0, freq: 420 + power * 120, to: 260, dur: 0.11, gain: 0.24 },
  ] : [
    { type: 'thump', at: 0, freq: 118 + power * 40, to: 46, dur: 0.15, gain: 0.95 },
    { type: 'noise', at: 0, dur: 0.16, filter: 'bandpass', freq: 920 + power * 550, q: 0.95, gain: 0.65 },
    { type: 'noise', at: 0.015, dur: 0.1, filter: 'highpass', freq: 2200, q: 0.7, gain: 0.28 * power },
  ];
  return playRecipe(ctx, destination, recipe, FX_LIMITS.impactLevel * (0.35 + 0.65 * power));
}

export function playCone(ctx, destination) {
  return playRecipe(ctx, destination, [
    { type: 'thump', at: 0, freq: 240, to: 115, dur: 0.09, gain: 0.8 },
    { type: 'noise', at: 0, dur: 0.075, filter: 'bandpass', freq: 1150, q: 1.8, gain: 0.45 },
  ], 0.34);
}

// Short tactile concrete rumble pulse when riding apex curbs at speed (zero persistent sources).
export function playCurb(ctx, destination, speedRatio = 0.5) {
  const s = Math.max(0.15, Math.min(1, Number.isFinite(speedRatio) ? speedRatio : 0.5));
  return playRecipe(ctx, destination, [
    { type: 'thump', at: 0, freq: 66 + s * 42, to: 42 + s * 16, dur: 0.045, gain: 0.85 },
    { type: 'noise', at: 0, dur: 0.036, filter: 'bandpass', freq: 310 + s * 220, q: 1.3, gain: 0.32 },
  ], FX_LIMITS.curbLevel * (0.45 + 0.55 * s));
}

// Cohesive retro-arcade state & mission audio cues.
export const CUE_SFX = Object.freeze({
  suspicious: Object.freeze([
    { type: 'tone', wave: 'triangle', at: 0, freq: 311, to: 294, dur: 0.16, attack: 0.012, gain: 0.42 },
    { type: 'tone', wave: 'triangle', at: 0.12, freq: 277, to: 262, dur: 0.22, attack: 0.012, gain: 0.38 },
  ]),
  spotTick: Object.freeze([
    { type: 'tone', wave: 'triangle', at: 0, freq: 740, to: 820, dur: 0.065, attack: 0.005, gain: 0.32 },
  ]),
  reported: Object.freeze([
    // Police dispatch radio squelch + crisp dual-tone chirp.
    { type: 'noise', at: 0, dur: 0.07, filter: 'bandpass', freq: 2300, q: 2.2, gain: 0.55 },
    { type: 'tone', wave: 'square', filter: 'bandpass', cutoff: 1900, q: 1.6, at: 0.04, freq: 880, to: 1175, dur: 0.09, gain: 0.34 },
    { type: 'tone', wave: 'square', filter: 'bandpass', cutoff: 1900, q: 1.6, at: 0.14, freq: 1175, to: 880, dur: 0.1, gain: 0.28 },
    { type: 'noise', at: 0.24, dur: 0.05, filter: 'bandpass', freq: 2600, q: 2.5, gain: 0.4 },
  ]),
  spotted: Object.freeze([
    // Urgent dispatch squelch + sharp ignition siren whoop.
    { type: 'noise', at: 0, dur: 0.065, filter: 'bandpass', freq: 2400, q: 2, gain: 0.65 },
    { type: 'tone', wave: 'sawtooth', filter: 'bandpass', cutoff: 1500, q: 1.5, at: 0.03, freq: 540, to: 1320, dur: 0.26, glide: 0.08, gain: 0.55 },
    { type: 'tone', wave: 'triangle', at: 0.03, freq: 270, to: 660, dur: 0.24, glide: 0.08, gain: 0.38 },
  ]),
  joined: Object.freeze([
    { type: 'noise', at: 0, dur: 0.055, filter: 'bandpass', freq: 2500, q: 2.4, gain: 0.55 },
    { type: 'tone', wave: 'sawtooth', filter: 'bandpass', cutoff: 1650, q: 1.6, at: 0.03, freq: 720, to: 1240, dur: 0.18, glide: 0.06, gain: 0.42 },
  ]),
  lost: Object.freeze([
    // Relieving emerald escape chord: clean, airy, resolves tension.
    { type: 'tone', wave: 'triangle', at: 0, freq: 440, dur: 0.24, attack: 0.015, gain: 0.44 },
    { type: 'tone', wave: 'triangle', at: 0.09, freq: 554.37, dur: 0.28, attack: 0.015, gain: 0.46 },
    { type: 'tone', wave: 'sine', at: 0.18, freq: 659.25, dur: 0.38, attack: 0.02, gain: 0.48 },
  ]),
  locked: Object.freeze([
    { type: 'thump', at: 0, freq: 150, to: 92, dur: 0.09, gain: 0.72 },
    { type: 'thump', at: 0.11, freq: 125, to: 78, dur: 0.11, gain: 0.68 },
  ]),
  bank: Object.freeze([
    { type: 'tone', wave: 'triangle', at: 0, freq: 523.25, dur: 0.11, attack: 0.008, gain: 0.26 },
    { type: 'tone', wave: 'sine', at: 0.055, freq: 659.25, dur: 0.16, attack: 0.01, gain: 0.24 },
  ]),
  'outcome-ghost': Object.freeze([
    // Cool stealth triad (Em9 feel), subtle and composed.
    { type: 'tone', wave: 'sine', at: 0, freq: 329.63, dur: 0.55, attack: 0.03, gain: 0.42 },
    { type: 'tone', wave: 'triangle', at: 0.08, freq: 493.88, dur: 0.5, attack: 0.025, gain: 0.34 },
    { type: 'tone', wave: 'sine', at: 0.16, freq: 587.33, dur: 0.52, attack: 0.03, gain: 0.36 },
    { type: 'tone', wave: 'sine', at: 0.24, freq: 739.99, dur: 0.58, attack: 0.03, gain: 0.32 },
  ]),
  'outcome-low-profile': Object.freeze([
    // Warm amber resolved chord.
    { type: 'tone', wave: 'triangle', at: 0, freq: 349.23, dur: 0.34, attack: 0.018, gain: 0.44 },
    { type: 'tone', wave: 'triangle', at: 0.11, freq: 440, dur: 0.38, attack: 0.018, gain: 0.42 },
    { type: 'tone', wave: 'sine', at: 0.22, freq: 523.25, dur: 0.48, attack: 0.02, gain: 0.44 },
  ]),
  'outcome-lost-them': Object.freeze([
    // Punchy retro getaway victory fanfare.
    { type: 'tone', wave: 'sawtooth', filter: 'lowpass', cutoff: 1400, q: 1, at: 0, freq: 293.66, dur: 0.16, attack: 0.01, gain: 0.42 },
    { type: 'tone', wave: 'sawtooth', filter: 'lowpass', cutoff: 1600, q: 1, at: 0.1, freq: 369.99, dur: 0.16, attack: 0.01, gain: 0.44 },
    { type: 'tone', wave: 'sawtooth', filter: 'lowpass', cutoff: 1900, q: 1, at: 0.2, freq: 440, dur: 0.18, attack: 0.01, gain: 0.46 },
    { type: 'tone', wave: 'triangle', at: 0.3, freq: 587.33, dur: 0.48, attack: 0.015, gain: 0.55 },
  ]),
  'outcome-escaped': Object.freeze([
    { type: 'tone', wave: 'triangle', at: 0, freq: 392, dur: 0.16, attack: 0.01, gain: 0.46 },
    { type: 'tone', wave: 'triangle', at: 0.1, freq: 493.88, dur: 0.18, attack: 0.01, gain: 0.48 },
    { type: 'tone', wave: 'triangle', at: 0.2, freq: 587.33, dur: 0.46, attack: 0.015, gain: 0.52 },
  ]),
  'outcome-busted': Object.freeze([
    // Fallback synthesized sting if the offline spoken voice asset cannot load.
    { type: 'tone', wave: 'sawtooth', filter: 'lowpass', cutoff: 950, q: 1.1, at: 0, freq: 246.94, to: 185, dur: 0.28, glide: 0.12, gain: 0.52 },
    { type: 'tone', wave: 'sawtooth', filter: 'lowpass', cutoff: 760, q: 1.1, at: 0.18, freq: 185, to: 116.54, dur: 0.46, glide: 0.18, gain: 0.56 },
    { type: 'thump', at: 0.18, freq: 110, to: 52, dur: 0.32, gain: 0.58 },
  ]),
  'outcome-failed': Object.freeze([
    // Non-bust failure sting (out of time, missed camera, Gymkhana fail).
    { type: 'tone', wave: 'sawtooth', filter: 'lowpass', cutoff: 900, q: 1.0, at: 0, freq: 233.08, to: 174.61, dur: 0.26, glide: 0.12, gain: 0.48 },
    { type: 'tone', wave: 'triangle', at: 0.16, freq: 174.61, to: 116.54, dur: 0.4, glide: 0.16, gain: 0.46 },
  ]),
  // Tracks & Gymkhana motorsport timing, combo and medal cues.
  lap: Object.freeze([
    { type: 'tone', wave: 'triangle', at: 0, freq: 587.33, dur: 0.11, attack: 0.008, gain: 0.36 },
    { type: 'tone', wave: 'sine', at: 0.075, freq: 880, dur: 0.18, attack: 0.01, gain: 0.34 },
  ]),
  'lap-best': Object.freeze([
    { type: 'tone', wave: 'triangle', at: 0, freq: 587.33, dur: 0.11, attack: 0.008, gain: 0.38 },
    { type: 'tone', wave: 'triangle', at: 0.075, freq: 739.99, dur: 0.12, attack: 0.008, gain: 0.38 },
    { type: 'tone', wave: 'sine', at: 0.15, freq: 1174.66, dur: 0.24, attack: 0.01, gain: 0.40 },
  ]),
  'lap-void': Object.freeze([
    { type: 'tone', wave: 'sawtooth', filter: 'lowpass', cutoff: 720, q: 1.0, at: 0, freq: 220, to: 196, dur: 0.13, gain: 0.38 },
    { type: 'tone', wave: 'sawtooth', filter: 'lowpass', cutoff: 640, q: 1.0, at: 0.12, freq: 174.61, to: 146.83, dur: 0.18, gain: 0.36 },
  ]),
  'combo-lost': Object.freeze([
    { type: 'tone', wave: 'triangle', at: 0, freq: 220, to: 118, dur: 0.18, glide: 0.07, gain: 0.34 },
  ]),
  'turn-zone': Object.freeze([
    // Precision 180 turn-zone lock: crisp relay click + uplifting emerald two-note cue.
    { type: 'noise', at: 0, dur: 0.028, filter: 'highpass', freq: 2400, q: 1.2, gain: 0.45 },
    { type: 'tone', wave: 'triangle', at: 0.01, freq: 659.25, dur: 0.1, attack: 0.006, gain: 0.36 },
    { type: 'tone', wave: 'sine', at: 0.075, freq: 987.77, dur: 0.16, attack: 0.008, gain: 0.38 },
  ]),
  'wrong-way': Object.freeze([
    { type: 'tone', wave: 'square', filter: 'bandpass', cutoff: 980, q: 1.8, at: 0, freq: 392, dur: 0.08, attack: 0.006, gain: 0.26 },
    { type: 'tone', wave: 'square', filter: 'bandpass', cutoff: 920, q: 1.8, at: 0.11, freq: 349.23, dur: 0.09, attack: 0.006, gain: 0.24 },
  ]),
  'outcome-circuit': Object.freeze([
    { type: 'tone', wave: 'triangle', at: 0, freq: 293.66, dur: 0.14, attack: 0.01, gain: 0.42 },
    { type: 'tone', wave: 'triangle', at: 0.09, freq: 369.99, dur: 0.15, attack: 0.01, gain: 0.44 },
    { type: 'tone', wave: 'triangle', at: 0.18, freq: 440, dur: 0.18, attack: 0.01, gain: 0.46 },
    { type: 'tone', wave: 'sine', at: 0.27, freq: 587.33, dur: 0.4, attack: 0.015, gain: 0.48 },
  ]),
  'outcome-record': Object.freeze([
    { type: 'tone', wave: 'sawtooth', filter: 'lowpass', cutoff: 1700, q: 1, at: 0, freq: 293.66, dur: 0.14, attack: 0.01, gain: 0.38 },
    { type: 'tone', wave: 'sawtooth', filter: 'lowpass', cutoff: 1900, q: 1, at: 0.09, freq: 369.99, dur: 0.15, attack: 0.01, gain: 0.4 },
    { type: 'tone', wave: 'sawtooth', filter: 'lowpass', cutoff: 2100, q: 1, at: 0.18, freq: 440, dur: 0.16, attack: 0.01, gain: 0.42 },
    { type: 'tone', wave: 'triangle', at: 0.27, freq: 587.33, dur: 0.45, attack: 0.012, gain: 0.48 },
    { type: 'tone', wave: 'sine', at: 0.34, freq: 739.99, dur: 0.46, attack: 0.015, gain: 0.4 },
  ]),
  'outcome-gold': Object.freeze([
    { type: 'tone', wave: 'sawtooth', filter: 'lowpass', cutoff: 1850, q: 1, at: 0, freq: 523.25, dur: 0.13, attack: 0.01, gain: 0.36 },
    { type: 'tone', wave: 'sawtooth', filter: 'lowpass', cutoff: 2050, q: 1, at: 0.09, freq: 659.25, dur: 0.14, attack: 0.01, gain: 0.38 },
    { type: 'tone', wave: 'triangle', at: 0.18, freq: 783.99, dur: 0.18, attack: 0.01, gain: 0.46 },
    { type: 'tone', wave: 'sine', at: 0.27, freq: 1046.5, dur: 0.44, attack: 0.012, gain: 0.48 },
  ]),
  'outcome-silver': Object.freeze([
    { type: 'tone', wave: 'triangle', at: 0, freq: 440, dur: 0.14, attack: 0.01, gain: 0.42 },
    { type: 'tone', wave: 'triangle', at: 0.09, freq: 554.37, dur: 0.16, attack: 0.01, gain: 0.44 },
    { type: 'tone', wave: 'sine', at: 0.18, freq: 659.25, dur: 0.4, attack: 0.012, gain: 0.46 },
  ]),
  'outcome-bronze': Object.freeze([
    { type: 'tone', wave: 'triangle', at: 0, freq: 349.23, dur: 0.18, attack: 0.012, gain: 0.42 },
    { type: 'tone', wave: 'sine', at: 0.11, freq: 440, dur: 0.34, attack: 0.015, gain: 0.44 },
  ]),
});

// Plays the offline deep announcer "BUSTED!" voice asset with a tight sub-bass cabinet punch,
// falling back to the synthesized bust sting when the sample is unavailable.
export function playBustedVoice(ctx, destination, buffer) {
  if (!buffer) {
    const fallback = playCue(ctx, destination, 'outcome-busted');
    return fallback ? { ...fallback, spoken: false } : null;
  }
  const t0 = ctx.currentTime;
  const out = ctx.createGain();
  out.gain.setValueAtTime(0.96, t0);
  out.connect(destination);

  const src = ctx.createBufferSource();
  src.buffer = buffer;
  src.connect(out);
  const voiceDur = Number.isFinite(buffer.duration) && buffer.duration > 0 ? buffer.duration : 0.9;
  const voiceEnd = t0 + voiceDur;
  src.start(t0);
  src.stop(voiceEnd + 0.02);

  // Subtle low cabinet punch right under the "B" plosive for retro arcade weight without mud.
  const punch = playRecipe(ctx, destination, [
    { type: 'thump', at: 0, freq: 108, to: 44, dur: 0.24, gain: 0.34 },
  ], FX_LIMITS.cueLevel);

  const cleanup = () => {
    try { src.disconnect(); } catch { /* already gone */ }
    try { out.disconnect(); } catch { /* already gone */ }
  };
  src.onended = cleanup;

  let stopped = false;
  return {
    end: Math.max(voiceEnd, punch?.end ?? voiceEnd),
    spoken: true,
    stop() {
      if (stopped) return;
      stopped = true;
      try { src.stop(); } catch { /* already ended */ }
      cleanup();
      punch?.stop();
    },
  };
}

export function playCue(ctx, destination, kind, detail = 0) {
  if (kind === 'camera') {
    // Crisp mechanical SLR shutter click + subtle ascending chime per camera (1..4).
    const step = Math.max(0, Math.min(4, detail | 0));
    const freqs = [523.25, 587.33, 659.25, 783.99, 880];
    return playRecipe(ctx, destination, [
      { type: 'noise', at: 0, dur: 0.032, filter: 'highpass', freq: 2600, q: 1.1, gain: 0.72 },
      { type: 'noise', at: 0.042, dur: 0.025, filter: 'bandpass', freq: 3400, q: 2, gain: 0.45 },
      { type: 'tone', wave: 'triangle', at: 0.02, freq: freqs[step], dur: 0.2, attack: 0.008, gain: 0.4 },
    ], FX_LIMITS.cueLevel);
  }
  if (kind === 'spotTick') {
    const frac = Math.max(0, Math.min(1, Number.isFinite(detail) ? detail : 0));
    const hz = 540 + frac * 420;
    return playRecipe(ctx, destination, [
      { type: 'tone', wave: 'triangle', at: 0, freq: hz, to: hz * 1.08, dur: 0.06, attack: 0.004, gain: 0.26 + frac * 0.18 },
    ], FX_LIMITS.cueLevel);
  }
  if (kind === 'bank') {
    const tier = Math.max(0, Math.min(3, detail | 0));
    const scale = 1 + tier * 0.12;
    return playRecipe(ctx, destination, [
      { type: 'tone', wave: 'triangle', at: 0, freq: 493.88 * scale, dur: 0.1, attack: 0.008, gain: 0.22 },
      { type: 'tone', wave: 'sine', at: 0.055, freq: 659.25 * scale, dur: 0.15, attack: 0.01, gain: 0.2 },
    ], FX_LIMITS.cueLevel * 0.75);
  }
  if (kind === 'combo-up') {
    const mult = Math.max(2, Math.min(3, Math.round(detail)));
    const base = mult >= 3 ? 659.25 : 523.25;
    return playRecipe(ctx, destination, [
      { type: 'tone', wave: 'triangle', at: 0, freq: base, dur: 0.08, attack: 0.006, gain: 0.24 },
      { type: 'tone', wave: 'sine', at: 0.045, freq: base * (mult >= 3 ? 1.5 : 1.25), dur: 0.13, attack: 0.008, gain: 0.26 },
    ], FX_LIMITS.cueLevel * 0.72);
  }
  if (kind === 'gate-pass') {
    const drifted = !!detail;
    return playRecipe(ctx, destination, drifted ? [
      { type: 'noise', at: 0, dur: 0.022, filter: 'highpass', freq: 2800, q: 1.2, gain: 0.34 },
      { type: 'tone', wave: 'triangle', at: 0.01, freq: 587.33, dur: 0.11, attack: 0.006, gain: 0.32 },
      { type: 'tone', wave: 'sine', at: 0.06, freq: 880, dur: 0.17, attack: 0.008, gain: 0.34 },
    ] : [
      { type: 'noise', at: 0, dur: 0.02, filter: 'highpass', freq: 2400, q: 1.2, gain: 0.28 },
      { type: 'tone', wave: 'triangle', at: 0.01, freq: 440, dur: 0.1, attack: 0.006, gain: 0.26 },
    ], FX_LIMITS.cueLevel * 0.85);
  }
  if (kind === 'slalom-pass') {
    const step = Math.max(0, Math.min(6, (detail | 0) - 1));
    const scale = [523.25, 587.33, 659.25, 783.99, 880, 1046.5, 1174.66];
    const hz = scale[step];
    return playRecipe(ctx, destination, [
      { type: 'tone', wave: 'triangle', at: 0, freq: hz, dur: 0.095, attack: 0.005, gain: 0.32 },
      { type: 'tone', wave: 'sine', at: 0.03, freq: hz * 1.5, dur: 0.09, attack: 0.006, gain: 0.18 },
    ], FX_LIMITS.cueLevel * 0.82);
  }
  return playRecipe(ctx, destination, CUE_SFX[kind], FX_LIMITS.cueLevel);
}

// --- Police siren telemetry (pure: reads game only, never writes) -----------------------------------
const clamp01 = (v) => (Number.isFinite(v) ? Math.max(0, Math.min(1, v)) : 0);

export function sirenTarget(game) {
  const off = { active: false, level: 0, urgency: 0, muffled: false };
  if (!game || game.mode !== 'gymkhana' || game.state !== 'racing' || game.paused) return off;
  const def = game.challengeDef;
  const run = game.challenge;
  if (!def || def.layout !== 'urban' || !run || run.phase !== 'running') return off;

  // Getaway Driver: siren plays only when at least one police unit has lights on (pursue or respond).
  if (Array.isArray(run.police)) {
    const lit = run.police.filter((u) => u.lights);
    if (!lit.length) return off;
    const car = game.car;
    let nearest = Infinity;
    let sees = false;
    let pursuing = false;
    for (const u of lit) {
      const d = Math.hypot(car.x - u.x, car.y - u.y);
      if (d < nearest) nearest = d;
      if (u.watching || u.sees) sees = true;
      if (u.mode === 'pursue') pursuing = true;
    }
    const proximity = clamp01(1 - (nearest - 10) / 145);
    const level = (0.18 + 0.82 * proximity) * (pursuing ? 1 : 0.62);
    const urgency = pursuing ? clamp01(Math.max(run.meter ?? 0, 1 - (nearest - 12) / 38)) : 0;
    return { active: true, level, urgency, muffled: !sees };
  }

  // Get the Footage: single pursuing cruiser once its start delay has elapsed.
  if (run.pursuer && run.time >= (def.pursuerTuning?.delay ?? 0)) {
    const gap = Number.isFinite(run.gap) ? run.gap : 100;
    const proximity = clamp01(1 - (gap - 10) / 145);
    const level = 0.2 + 0.8 * proximity;
    const urgency = clamp01(Math.max(run.meter ?? 0, 1 - (gap - 12) / 36));
    return { active: true, level, urgency, muffled: !run.sees };
  }
  return off;
}

// Continuous retro electromechanical police siren voice: two warm detuned oscillators shaped
// through a resonant filter, morphing from Wail to Yelp as urgency climbs, and muffling when
// buildings block line of sight. Created lazily only during active chases and stopped immediately
// once quiet, so idle/circuit audio graphs carry zero extra sources.
export function createSirenVoice(ctx, destination) {
  const out = ctx.createGain();
  out.gain.value = 0;
  const toneFilter = ctx.createBiquadFilter();
  toneFilter.type = 'bandpass';
  toneFilter.frequency.value = 1050;
  toneFilter.Q.value = 1.3;
  const occlude = ctx.createBiquadFilter();
  occlude.type = 'lowpass';
  occlude.frequency.value = 2800;
  occlude.Q.value = 0.7;

  const main = ctx.createOscillator();
  main.type = 'sawtooth';
  main.frequency.value = 680;
  const mainGain = ctx.createGain();
  mainGain.gain.value = 0.65;

  const sub = ctx.createOscillator();
  sub.type = 'triangle';
  sub.frequency.value = 680 * 1.006;
  const subGain = ctx.createGain();
  subGain.gain.value = 0.45;

  main.connect(mainGain).connect(toneFilter);
  sub.connect(subGain).connect(toneFilter);
  toneFilter.connect(occlude).connect(out).connect(destination);
  main.start();
  sub.start();

  let phase = 0;
  let currentLevel = 0.5;
  let ducked = false;
  let stopped = false;

  return {
    update({ level, urgency, muffled, dt }) {
      if (stopped || ducked) return;
      currentLevel = clamp01(level);
      const step = Math.min(0.1, Math.max(0, dt || 1 / 30));
      // Smoothly speed up sweep from classic Wail (~0.34 Hz) to urgent Yelp (~2.1 Hz).
      const rate = 0.34 + urgency * urgency * 1.78;
      phase = (phase + step * rate) % 1;
      // Asymmetric electromechanical sweep: quicker rise, slightly fuller fall.
      const wave = 0.5 - 0.5 * Math.cos(phase * Math.PI * 2);
      const shaped = wave ** (0.85 - urgency * 0.15);
      const lo = 580 + urgency * 110;
      const hi = 1220 + urgency * 180;
      const hz = lo + (hi - lo) * shaped;
      const now = ctx.currentTime;
      main.frequency.setTargetAtTime(hz, now, 0.025);
      sub.frequency.setTargetAtTime(hz * 1.006, now, 0.025);
      toneFilter.frequency.setTargetAtTime(hz * 1.15, now, 0.03);
      occlude.frequency.setTargetAtTime(muffled ? 920 : 3200, now, 0.08);
      out.gain.setTargetAtTime(FX_LIMITS.sirenLevel * currentLevel * (muffled ? 0.68 : 1), now, 0.06);
    },
    // Briefly ducks and muffles the siren when the "BUSTED!" voice hits so speech dominates cleanly.
    duck(factor = 0.22, fadeOut = 0.95) {
      if (stopped || ducked) return;
      ducked = true;
      const now = ctx.currentTime;
      const duckedGain = FX_LIMITS.sirenLevel * Math.max(0.3, currentLevel) * factor;
      occlude.frequency.setTargetAtTime(920, now, 0.04);
      out.gain.setTargetAtTime(duckedGain, now, 0.03);
      out.gain.setTargetAtTime(0, now + 0.12, Math.max(0.08, fadeOut / 3.5));
      main.frequency.setTargetAtTime(520, now + 0.08, 0.35);
      sub.frequency.setTargetAtTime(523, now + 0.08, 0.35);
    },
    stop() {
      if (stopped) return;
      stopped = true;
      for (const osc of [main, sub]) { try { osc.stop(); } catch { /* already stopped */ } }
      for (const node of [main, mainGain, sub, subGain, toneFilter, occlude, out]) {
        try { node.disconnect(); } catch { /* already gone */ }
      }
    },
  };
}
