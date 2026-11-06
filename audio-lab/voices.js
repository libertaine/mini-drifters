// Native Web Audio voices. Each voice owns and disposes its complete graph.
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

function graph(ctx) {
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

export function createProcedural(ctx, engineBus, tireBus) {
  const g = graph(ctx);
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

  const scrub = g.node(ctx.createBiquadFilter()); scrub.type = 'bandpass'; scrub.Q.value = 0.65;
  const scrubGain = g.node(ctx.createGain()); scrubGain.gain.value = 0;
  hiss.connect(scrub).connect(scrubGain).connect(tireBus);
  const squeal = g.source(ctx.createOscillator()); squeal.type = 'triangle';
  const squealGain = g.node(ctx.createGain()); squealGain.gain.value = 0;
  squeal.connect(squealGain).connect(tireBus);
  const wobble = g.source(ctx.createOscillator()); wobble.frequency.value = 11.7;
  const wobbleDepth = g.node(ctx.createGain()); wobbleDepth.gain.value = 19;
  wobble.connect(wobbleDepth).connect(squeal.frequency);
  g.start();
  return {
    stop: () => g.stop(), sourceCount: g.count,
    update(p) {
      for (const { osc, ratio } of layers) smooth(osc.frequency, p.firingHz * ratio, ctx, 0.18);
      smooth(engine.gain, p.engineGain, ctx);
      smooth(depth.gain, p.roughness, ctx);
      smooth(flutter.frequency, 6.5 + p.rpmFraction * 7, ctx);
      smooth(exhaust.frequency, p.engineCutoff, ctx);
      smooth(intake.frequency, 600 + 2000 * p.rpmFraction, ctx);
      smooth(intakeLevel.gain, p.throttle * 0.055, ctx);
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

export const SAMPLE_FILES = Object.freeze({
  low: 'engine-low.wav', high: 'engine-high.wav', tire: 'tire-foley.mp3',
});

export async function loadSamples(ctx, signal, fetcher = fetch) {
  const buffers = {};
  const failures = [];
  await Promise.all(Object.entries(SAMPLE_FILES).map(async ([key, file]) => {
    try {
      const response = await fetcher(new URL(`assets/${file}`, import.meta.url), { signal });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const original = await ctx.decodeAudioData(await response.arrayBuffer());
      if (signal.aborted) return;
      // Tire asset contains discrete foley events. This is a provisional excerpt,
      // not a claim that a continuous real-tire recording has been found.
      buffers[key] = prepareLoop(ctx, original, key === 'tire' ? 0.3 : 0,
        key === 'tire' ? Math.min(2.5, original.duration) : original.duration);
    } catch (error) {
      if (!signal.aborted) failures.push(`${file}: ${error.message}`);
    }
  }));
  return { buffers, failures };
}

export function createSampleVoice(ctx, engineBus, tireBus, buffers) {
  const g = graph(ctx);
  const filter = g.node(ctx.createBiquadFilter()); filter.type = 'lowpass'; filter.Q.value = 0.7;
  filter.connect(engineBus);
  const tireFilter = g.node(ctx.createBiquadFilter()); tireFilter.type = 'lowpass'; tireFilter.Q.value = 0.65;
  tireFilter.connect(tireBus);
  const loops = {};
  for (const key of ['low', 'high', 'tire']) {
    if (!buffers[key]) continue;
    const source = g.source(ctx.createBufferSource());
    source.buffer = buffers[key]; source.loop = true;
    const gain = g.node(ctx.createGain()); gain.gain.value = 0;
    source.connect(gain).connect(key === 'tire' ? tireFilter : filter);
    loops[key] = { source, gain };
  }
  g.start();
  return {
    stop: () => g.stop(), sourceCount: g.count,
    update(p) {
      // A missing engine layer uses the surviving recording across the full range.
      const both = loops.low && loops.high;
      for (const key of ['low', 'high']) {
        if (!loops[key]) continue;
        smooth(loops[key].source.playbackRate, key === 'low' ? p.sampleLowRate : p.sampleHighRate, ctx, 0.18);
        const blend = both ? (key === 'low' ? p.sampleLowGain : p.sampleHighGain) : 1;
        smooth(loops[key].gain.gain, blend * p.engineGain * 0.65, ctx);
      }
      if (loops.tire) {
        smooth(loops.tire.source.playbackRate, p.tireRate, ctx);
        smooth(loops.tire.gain.gain, p.tireIntensity * 0.38, ctx, 0.14);
      }
      smooth(filter.frequency, p.engineCutoff, ctx);
      smooth(tireFilter.frequency, p.tireCutoff, ctx);
    },
  };
}
