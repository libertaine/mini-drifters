// The title's posed drift, as geometry: the pixels are checked in menus-browser.mjs.
import assert from 'node:assert/strict';
import test from 'node:test';
import { buildTitleScene } from '../src/render.js';
import { buildTrack } from '../src/track.js';

const scene = buildTitleScene(buildTrack());
// drawCarBody's rear tyres, in the artwork's own units: x along the car, y across it.
const REAR_TYRE = { x: -1.48, y: 1.05 };

test('the car is visibly sideways to the road, past what the curve could hide', () => {
  const slip = Math.abs(Math.atan2(Math.sin(scene.pose.heading - scene.travel), Math.cos(scene.pose.heading - scene.travel)));
  assert.ok(slip > 50 * (Math.PI / 180), `slip is ${(slip * 180) / Math.PI} degrees`);
});

test('the skid marks start under the rear tyres as drawn, one each side', () => {
  const { x, y, heading } = scene.pose;
  const inCarUnits = scene.skids[0].map((mark) => ({
    along: ((mark.x - x) * Math.cos(heading) + (mark.y - y) * Math.sin(heading)) / scene.size,
    across: (-(mark.x - x) * Math.sin(heading) + (mark.y - y) * Math.cos(heading)) / scene.size,
  }));
  for (const mark of inCarUnits) {
    assert.ok(Math.abs(mark.along - REAR_TYRE.x) < 0.1, `${mark.along} along the car`);
    assert.ok(Math.abs(Math.abs(mark.across) - REAR_TYRE.y) < 0.1, `${mark.across} across the car`);
  }
  assert.ok(inCarUnits[0].across * inCarUnits[1].across < 0, 'one mark for each side of the car');
});

test('the skid marks run without a jump from the tyres back along the road', () => {
  for (let k = 1; k < scene.skids.length; k += 1) {
    for (const side of [0, 1]) {
      const step = Math.hypot(scene.skids[k][side].x - scene.skids[k - 1][side].x, scene.skids[k][side].y - scene.skids[k - 1][side].y);
      assert.ok(step < 3, `${step} m between rows ${k - 1} and ${k}`);
    }
  }
});
