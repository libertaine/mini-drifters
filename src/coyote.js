import { COYOTE_LAYERS } from './coyote-model.js';
import { smooth } from './audio-voices.js';
// Owner-supplied recordings, never committed or deployed: see docs/GAMEPLAY-AUDIO.md.
const COYOTE_FOLDER = '../audio-lab/assets/coyote-local/';
export const COYOTE_FILES = Object.freeze(Object.fromEntries(COYOTE_LAYERS.map(({ key }) => [key, key + '.wav'])));
export async function loadCoyote(ctx, signal, fetcher = fetch) {
  const buffers = {}, failures = [];
  await Promise.all(Object.entries(COYOTE_FILES).map(async ([key, file]) => {
    try {
      const response = await fetcher(new URL(COYOTE_FOLDER + file, import.meta.url), { signal });
      if (!response.ok) throw new Error('HTTP ' + response.status);
      const buffer = await ctx.decodeAudioData(await response.arrayBuffer());
      if (buffer.duration < 0.1 || buffer.numberOfChannels !== 1) throw new Error('Expected processed mono loop');
      if (!signal.aborted) buffers[key] = buffer; // Already seam-processed offline. Never overlap twice.
    } catch (error) { if (!signal.aborted) failures.push(file + ': ' + error.message); }
  }));
  return { buffers, failures };
}
export function createCoyote(ctx, bus, buffers) {
  const sources = [], nodes = [], loops = [];
  const node = (n) => { nodes.push(n); return n; };
  const filter = node(ctx.createBiquadFilter()); filter.type = 'lowpass'; filter.Q.value = 0.7;
  const presence = node(ctx.createBiquadFilter()); presence.type = 'highshelf'; presence.frequency.value = 1500; presence.gain.value = -3;
  filter.connect(presence).connect(bus);
  // Fail closed on an incomplete bank: avoid a surviving unrelated pitch layer
  // pretending to cover the full range. Tires and A/B remain available.
  const complete = COYOTE_LAYERS.every(({ key }) => buffers[key]);
  if (complete) for (const { key } of COYOTE_LAYERS) {
    const source = node(ctx.createBufferSource()), gain = node(ctx.createGain());
    source.buffer = buffers[key]; source.loop = true; gain.gain.value = 0;
    source.connect(gain).connect(filter); sources.push(source); loops.push({ source, gain }); source.start();
  }
  return {
    sourceCount: sources.length,
    update(p) {
      loops.forEach(({ source, gain }, i) => {
        smooth(source.playbackRate, p.coyoteRates[i], ctx, p.pitchGlide ?? 0.18);
        smooth(gain.gain, p.coyoteWeights[i] * p.coyoteGain, ctx, 0.12);
      });
      smooth(filter.frequency, p.coyoteCutoff, ctx);
      smooth(presence.gain, p.coyotePresence, ctx);
    },
    stop() { for (const source of sources) { try { source.stop(); } catch { /* stopped */ } } for (const n of nodes) n.disconnect(); },
  };
}
