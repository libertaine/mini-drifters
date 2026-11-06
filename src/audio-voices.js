// Native Web Audio voices shared by the game and the development audio lab. Each
// voice owns and disposes its complete graph. Nothing here touches the simulation.
export function smooth(param, value, ctx, seconds = 0.12) {
  // Holding the current interpolated value prevents jumps during rapid scrubbing.
  if (param.cancelAndHoldAtTime) param.cancelAndHoldAtTime(ctx.currentTime);
  else {
    const held = param.value;
    param.cancelScheduledValues(ctx.currentTime);
    param.setValueAtTime(held, ctx.currentTime);
  }
  param.setTargetAtTime(value, ctx.currentTime, seconds);
}

function graph() {
  const nodes = [];
  const sources = [];
  return {
    node(n) { nodes.push(n); return n; },
    source(n) { nodes.push(n); sources.push(n); return n; },
    stop() {
      for (const source of sources) { try { source.stop(); } catch { /* already stopped */ } }
      for (const node of nodes) node.disconnect();
    },
    start() { for (const source of sources) source.start(); },
    get count() { return sources.length; },
  };
}

export function createMixCompressor(ctx) {
  const compressor = ctx.createDynamicsCompressor();
  compressor.threshold.value = -10; compressor.knee.value = 8;
  compressor.ratio.value = 12; compressor.attack.value = 0.003; compressor.release.value = 0.15;
  return compressor;
}

function noise(ctx) {
  const buffer = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
  const samples = buffer.getChannelData(0);
  // Local cosmetic randomness, never the driving simulation's state.
  let seed = 0x458abb;
  for (let i = 0; i < samples.length; i++) {
    seed ^= seed << 13; seed ^= seed >>> 17; seed ^= seed << 5;
    samples[i] = ((seed >>> 0) / 4294967296 * 2 - 1) * 0.65;
  }
  return buffer;
}

// Synthesized engine parameters from RPM and throttle, in lab units.
export function mapProceduralEngine({ rpm, throttle }) {
  const rpmFraction = (rpm - 750) / 6250;
  return {
    rpmFraction, throttle,
    firingHz: rpm / 60 * 4,
    engineGain: 0.23 + 0.12 * rpmFraction + 0.15 * throttle,
    engineCutoff: 420 + 2600 * rpmFraction + 2300 * throttle,
    roughness: 0.015 + 0.035 * throttle,
  };
}

// Without a tire bus only the engine is built: the game uses the sampled tires.
export function createProcedural(ctx, engineBus, tireBus = null) {
  const g = graph();
  const engine = g.node(ctx.createGain());
  const exhaust = g.node(ctx.createBiquadFilter());
  exhaust.type = 'lowpass'; exhaust.Q.value = 0.7;
  engine.gain.value = 0;
  engine.connect(exhaust).connect(engineBus);
  const layers = [[0.25, 'triangle', 0.42], [0.5, 'sawtooth', 0.2],
    [1, 'sawtooth', 0.16], [2, 'triangle', 0.08]].map(([ratio, type, level]) => {
    const osc = g.source(ctx.createOscillator());
    const gain = g.node(ctx.createGain());
    osc.type = type; gain.gain.value = level;
    osc.connect(gain).connect(engine);
    return { osc, ratio };
  });
  const flutter = g.source(ctx.createOscillator());
  const depth = g.node(ctx.createGain());
  flutter.type = 'sine'; flutter.frequency.value = 7.3; depth.gain.value = 0;
  flutter.connect(depth).connect(engine.gain);

  const hiss = g.source(ctx.createBufferSource());
  hiss.buffer = noise(ctx); hiss.loop = true;
  const intake = g.node(ctx.createBiquadFilter()); intake.type = 'bandpass'; intake.Q.value = 0.6;
  const intakeLevel = g.node(ctx.createGain()); intakeLevel.gain.value = 0;
  hiss.connect(intake).connect(intakeLevel).connect(engineBus);

  let scrub, scrubGain, squeal, squealGain;
  if (tireBus) {
    scrub = g.node(ctx.createBiquadFilter()); scrub.type = 'bandpass'; scrub.Q.value = 0.65;
    scrubGain = g.node(ctx.createGain()); scrubGain.gain.value = 0;
    hiss.connect(scrub).connect(scrubGain).connect(tireBus);
    squeal = g.source(ctx.createOscillator()); squeal.type = 'triangle';
    squealGain = g.node(ctx.createGain()); squealGain.gain.value = 0;
    squeal.connect(squealGain).connect(tireBus);
    const wobble = g.source(ctx.createOscillator()); wobble.frequency.value = 11.7;
    const wobbleDepth = g.node(ctx.createGain()); wobbleDepth.gain.value = 19;
    wobble.connect(wobbleDepth).connect(squeal.frequency);
  }
  g.start();
  return {
    stop: () => g.stop(), sourceCount: g.count,
    update(p) {
      for (const { osc, ratio } of layers) smooth(osc.frequency, p.firingHz * ratio, ctx, p.pitchGlide ?? 0.18);
      smooth(engine.gain, p.engineGain, ctx);
      smooth(depth.gain, p.roughness, ctx);
      smooth(flutter.frequency, 6.5 + p.rpmFraction * 7, ctx);
      smooth(exhaust.frequency, p.engineCutoff, ctx);
      smooth(intake.frequency, 600 + 2000 * p.rpmFraction, ctx);
      smooth(intakeLevel.gain, p.throttle * 0.055, ctx);
      if (!tireBus) return;
      smooth(scrub.frequency, p.tireCutoff, ctx);
      smooth(scrubGain.gain, p.tireIntensity * 0.46, ctx, 0.14);
      smooth(squeal.frequency, p.squealHz, ctx);
      smooth(squealGain.gain, p.tireIntensity * p.squealMix * 0.2, ctx, 0.14);
    },
  };
}

// Overlap the end with the head, then remove the overlapped head. The resulting
// last sample leads into the first sample naturally; no scheduler/timer loops.
export function prepareLoop(ctx, original, start = 0, end = original.duration) {
  const first = Math.floor(start * original.sampleRate);
  const last = Math.min(original.length, Math.floor(end * original.sampleRate));
  const length = last - first;
  if (length < 128) throw new Error('Sample is too short to loop');
  const overlap = Math.min(Math.floor(original.sampleRate * 0.06), Math.floor(length / 5));
  const result = ctx.createBuffer(original.numberOfChannels, length - overlap, original.sampleRate);
  let peak = 0;
  for (let channel = 0; channel < original.numberOfChannels; channel++) {
    const src = original.getChannelData(channel);
    const dst = result.getChannelData(channel);
    dst.set(src.subarray(first + overlap, last));
    for (let i = 0; i < overlap; i++) {
      const mix = i / (overlap - 1);
      dst[dst.length - overlap + i] = src[last - overlap + i] * (1 - mix) + src[first + i] * mix;
    }
    for (const value of dst) peak = Math.max(peak, Math.abs(value));
  }
  // Normalize down only, preserving headroom and not boosting quiet backgrounds.
  if (peak > 0.75) {
    for (let channel = 0; channel < result.numberOfChannels; channel++) {
      const dst = result.getChannelData(channel);
      for (let i = 0; i < dst.length; i++) dst[i] *= 0.75 / peak;
    }
  }
  return result;
}

// The tire asset contains discrete foley events. This is a provisional excerpt,
// not a claim that a continuous real-tire recording has been found.
export function prepareTireLoop(ctx, original) {
  return prepareLoop(ctx, original, 0.3, Math.min(2.5, original.duration));
}

// CC0 and redistributable: see audio-lab/assets/ATTRIBUTION.md.
const TIRE_FILE = '../audio-lab/assets/tire-foley.mp3';

export async function loadTire(ctx, signal, fetcher = fetch) {
  try {
    const response = await fetcher(new URL(TIRE_FILE, import.meta.url), { signal });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const original = await ctx.decodeAudioData(await response.arrayBuffer());
    if (signal.aborted) return { buffer: null, failures: [] };
    return { buffer: prepareTireLoop(ctx, original), failures: [] };
  } catch (error) {
    return { buffer: null, failures: signal.aborted ? [] : [`tire-foley.mp3: ${error.message}`] };
  }
}

export function createTireVoice(ctx, tireBus, buffer) {
  const g = graph();
  const filter = g.node(ctx.createBiquadFilter()); filter.type = 'lowpass'; filter.Q.value = 0.65;
  filter.connect(tireBus);
  const source = g.source(ctx.createBufferSource());
  source.buffer = buffer; source.loop = true;
  const gain = g.node(ctx.createGain()); gain.gain.value = 0;
  source.connect(gain).connect(filter);
  g.start();
  return {
    stop: () => g.stop(), sourceCount: g.count,
    update(p) {
      smooth(source.playbackRate, p.tireRate, ctx);
      smooth(gain.gain, p.tireIntensity * 0.38, ctx, 0.14);
      smooth(filter.frequency, p.tireCutoff, ctx);
    },
  };
}

export function createSampleVoice(ctx, engineBus, tireBus, buffers) {
  const g = graph();
  const filter = g.node(ctx.createBiquadFilter()); filter.type = 'lowpass'; filter.Q.value = 0.7;
  filter.connect(engineBus);
  const loops = {};
  for (const key of ['low', 'high']) {
    if (!buffers[key]) continue;
    const source = g.source(ctx.createBufferSource());
    source.buffer = buffers[key]; source.loop = true;
    const gain = g.node(ctx.createGain()); gain.gain.value = 0;
    source.connect(gain).connect(filter);
    loops[key] = { source, gain };
  }
  g.start();
  const tire = buffers.tire ? createTireVoice(ctx, tireBus, buffers.tire) : null;
  return {
    stop() { g.stop(); tire?.stop(); },
    sourceCount: g.count + (tire?.sourceCount ?? 0),
    update(p) {
      // A missing engine layer uses the surviving recording across the full range.
      const both = loops.low && loops.high;
      for (const key of ['low', 'high']) {
        if (!loops[key]) continue;
        smooth(loops[key].source.playbackRate, key === 'low' ? p.sampleLowRate : p.sampleHighRate, ctx, 0.18);
        const blend = both ? (key === 'low' ? p.sampleLowGain : p.sampleHighGain) : 1;
        smooth(loops[key].gain.gain, blend * p.engineGain * 0.65, ctx);
      }
      tire?.update(p);
      smooth(filter.frequency, p.engineCutoff, ctx);
    },
  };
}
