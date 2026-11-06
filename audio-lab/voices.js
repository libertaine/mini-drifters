// The voices themselves live in src/, so the game and this lab share one
// implementation. Only the B engine recordings remain specific to the lab.
import { prepareLoop, prepareTireLoop } from '../src/audio-voices.js';

export { createProcedural, createSampleVoice, prepareLoop, smooth } from '../src/audio-voices.js';

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
      buffers[key] = key === 'tire' ? prepareTireLoop(ctx, original) : prepareLoop(ctx, original);
    } catch (error) {
      if (!signal.aborted) failures.push(`${file}: ${error.message}`);
    }
  }));
  return { buffers, failures };
}
