import test from 'node:test';
import assert from 'node:assert/strict';
import { buildDockyardScenery } from '../src/dockyard-scenery.js';
import { trackById, projectOnTrack } from '../src/track.js';
import { padTrack } from '../src/practice-pad.js';

const track = trackById('dockyard');

test('industrial scenery is exclusive to Dockyard, including after a track switch', () => {
  for (const t of [trackById('original'), trackById('switchback'), padTrack()]) {
    assert.equal(buildDockyardScenery(t), null);
  }
  assert.deepEqual(buildDockyardScenery(track), buildDockyardScenery(track));
});

test('every prop, board and shadow clears all road segments and curbs by at least four metres', () => {
  const { props, boards } = buildDockyardScenery(track);
  for (const p of [...props, ...boards]) {
    // Sample the entire expanded footprint, not only the centre or four corners.
    for (let x = p.x - p.w / 2 - 0.5; x <= p.x + p.w / 2 + 2; x += 0.5) {
      for (let y = p.y - p.h / 2 - 0.5; y <= p.y + p.h / 2 + 2; y += 0.5) {
        const d = projectOnTrack(track, x, y).distance;
        assert.ok(d >= track.halfWidth + track.curbWidth + 4,
          `${p.id ?? p.kind} at ${p.x},${p.y}: ${x},${y} is only ${d.toFixed(2)} m from the centreline`);
      }
    }
  }
});

test('layout construction never mutates track points, gates, bounds or start pose', () => {
  const before = structuredClone(track);
  buildDockyardScenery(track);
  assert.deepEqual(track, before);
});

test('board route diagrams follow the actual forward entry and exit directions', () => {
  const { boards } = buildDockyardScenery(track);
  const anchors = {
    hook: [[99, -78], [163, -25]], 'hook-tightens': [[163, -15], [137, 14]],
    chicane: [[2, 14], [-61, 78]], basin: [[-86, 78], [-86, -78]],
  };
  assert.equal(boards.length, 4);
  for (const b of boards) {
    const segments = [b.route.slice(0, 2), b.route.slice(-2)];
    segments.forEach(([a, z], i) => {
      const dx = z[0] - a[0], dy = z[1] - a[1];
      const { tx, ty } = projectOnTrack(track, ...anchors[b.id][i]);
      assert.ok((dx * tx + dy * ty) / Math.hypot(dx, dy) > 0.9, `${b.id} ${i} follows the real track tangent`);
    });
    assert.ok(b.w >= 15 && b.h >= 8, 'diagrams retain useful world-space size');
  }
});
