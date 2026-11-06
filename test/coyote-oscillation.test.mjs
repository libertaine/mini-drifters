// Guards the full-throttle oscillation fix: the two pull loops hold one engine speed
// and the mapping knows what that speed is. Reads real recordings when this checkout
// has them, so it says nothing about how they sound. See docs/COYOTE-OSCILLATION.md.
import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { readPcm16, trackCrank } from '../scripts/coyote-dsp.mjs';
import { COYOTE_LAYERS, mapCoyote } from '../src/coyote-model.js';

const loopPath = (key) => fileURLToPath(new URL(`../audio-lab/assets/coyote-local/${key}.wav`, import.meta.url));
const present = ['idle', 'mid', 'load', 'high'].every((key) => existsSync(loopPath(key)));
const skip = present ? false : 'the Coyote loops are not in this checkout';
const anchor = (key) => COYOTE_LAYERS.find((layer) => layer.key === key).rpm;
const provenance = JSON.parse(readFileSync(new URL('../docs/COYOTE-PROVENANCE.json', import.meta.url), 'utf8'));

function pitchOf(key, wrap = 3) {
  const { x, rate } = readPcm16(loopPath(key));
  const repeated = new Float64Array(x.length * wrap);
  for (let i = 0; i < wrap; i++) repeated.set(x, i * x.length);
  const seed = anchor(key) / 60;
  // One whole repetition, read across its seam, so a pitch reset would show.
  const rows = trackCrank(repeated, rate, x.length / rate, 2 * x.length / rate, seed, { follow: false, spread: 0.2, winSeconds: 8 / seed });
  const sorted = rows.map((r) => r.hz).sort((a, b) => a - b);
  return {
    samples: x.length, rate,
    medianRpm: sorted[sorted.length >> 1] * 60,
    rangeCents: 1200 * Math.log2(sorted[Math.floor(sorted.length * 0.99)] / sorted[Math.floor(sorted.length * 0.01)]),
  };
}

for (const key of ['mid', 'load', 'high']) {
  test(`the ${key} loop plays at the speed its anchor claims`, { skip }, () => {
    const { medianRpm } = pitchOf(key);
    assert.ok(Math.abs(medianRpm / anchor(key) - 1) < 0.01, `${key} measured ${medianRpm} against anchor ${anchor(key)}`);
  });
}

test('the pull loops hold their pitch across a repeat', { skip }, () => {
  // The first bank measured about 264 cents on load and 33 on high.
  for (const key of ['load', 'high']) {
    const { rangeCents } = pitchOf(key);
    assert.ok(rangeCents < 30, `${key} moved ${rangeCents.toFixed(1)} cents`);
  }
});

test('the pull loops are whole engine cycles, and longer than the ones that oscillated', { skip }, () => {
  for (const [key, cycles, minimumSeconds] of [['load', 22, 0.5], ['high', 55, 0.9]]) {
    const { samples, rate } = pitchOf(key);
    const exact = cycles * 120 / anchor(key) * rate;
    assert.equal(samples, Math.round(exact), key);
    assert.ok(Math.abs(exact - samples) < 1e-6, `${key} is not a whole number of cycles`);
    assert.ok(samples / rate >= minimumSeconds, key);
  }
});

test('anchors match the provenance of the processed loops', () => {
  for (const key of ['load', 'high']) {
    const loop = provenance.loops.find((entry) => entry.key === key);
    assert.equal(loop.recipe, 'stationary', key);
    assert.equal(loop.nominalRpm, anchor(key), key);
  }
});

test('adjacent layers are asked for the same engine speed at every RPM', () => {
  // Rates divide the requested RPM by each anchor, so anything playing at its own
  // anchor speed lands on the same note. The playback limits only bind on a layer
  // that is under 3% of the mix, just above the mid anchor.
  for (let rpm = 800; rpm <= 7000; rpm += 25) {
    const { coyoteRates, coyoteWeights } = mapCoyote({ rpm, throttle: 1 });
    coyoteWeights.forEach((weight, i) => {
      if (weight < 0.03 || rpm < COYOTE_LAYERS[1].rpm) return; // idle's anchor is only an estimate
      assert.ok(Math.abs(coyoteRates[i] * COYOTE_LAYERS[i].rpm - rpm) < 1e-6, `layer ${i} at ${rpm}`);
    });
  }
});
