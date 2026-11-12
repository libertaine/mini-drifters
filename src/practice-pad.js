// The practice pad: an open square of asphalt with a few painted markers, for driving with no
// objective. It is a "track" only so the session code can run unchanged: its road is as wide as
// the whole pad, it has no checkpoints, and its finish line is a point nobody can cross. A pad
// session is started with { mode: 'practice' }, which game.js never scores, times or records.
import { buildTrack } from './track.js';

export const PRACTICE_PAD_ID = 'practice-pad';

const PAD_HALF = 130;
export const PAD_MARKERS = Object.freeze([
  // Donut: one cone to circle.
  { x: -70, y: -60, kind: 'cone', note: 'donut' },
  // Figure-eight: two cones 36 m apart.
  { x: 20, y: -60, kind: 'cone', note: 'eight' }, { x: 56, y: -60, kind: 'cone', note: 'eight' },
  // 180: drive through the gate, turn round the far cone, come back through.
  { x: -90, y: 30, kind: 'gate' }, { x: -90, y: 44, kind: 'gate' }, { x: -20, y: 37, kind: 'cone', note: '180' },
  // Slalom: five cones 22 m apart.
  ...[0, 1, 2, 3, 4].map((i) => ({ x: 10 + i * 22, y: 70, kind: 'cone', note: 'slalom' })),
].map((marker) => Object.freeze(marker)));

let pad = null;
export function padTrack() {
  if (pad) return pad;
  // A ring only gives the session something to project the car onto. It is not drawn as road.
  const ring = Array.from({ length: 24 }, (_, i) => [Math.cos(i / 24 * Math.PI * 2) * 60, Math.sin(i / 24 * Math.PI * 2) * 60]);
  pad = Object.freeze({
    ...buildTrack(ring),
    id: PRACTICE_PAD_ID,
    name: 'Practice Pad',
    pad: true,
    halfWidth: 1e6,               // every point is "road": one surface, one traction
    gates: [],
    finish: { s: 0, x1: 1e9, y1: 1e9, x2: 1e9, y2: 1e9, tx: 1, ty: 0 },
    bounds: { minX: -PAD_HALF, maxX: PAD_HALF, minY: -PAD_HALF, maxY: PAD_HALF },
    // 60 m or more of open asphalt all round the grid.
    start: { x: -60, y: 0, heading: 0 },
    markers: PAD_MARKERS,
  });
  return pad;
}

// Draws the pad in world coordinates, in place of grass and road.
export function drawPad(ctx, track) {
  const { bounds } = track;
  ctx.fillStyle = '#3b3d42';
  ctx.fillRect(bounds.minX, bounds.minY, bounds.maxX - bounds.minX, bounds.maxY - bounds.minY);
  // A 20 m grid, so that speed and radius are readable on a featureless surface.
  ctx.strokeStyle = 'rgba(246,241,228,0.07)';
  ctx.lineWidth = 0.25;
  ctx.beginPath();
  for (let v = bounds.minX; v <= bounds.maxX; v += 20) { ctx.moveTo(v, bounds.minY); ctx.lineTo(v, bounds.maxY); }
  for (let v = bounds.minY; v <= bounds.maxY; v += 20) { ctx.moveTo(bounds.minX, v); ctx.lineTo(bounds.maxX, v); }
  ctx.stroke();
  for (const m of track.markers) {
    if (m.note === 'donut') {
      ctx.strokeStyle = 'rgba(246,241,228,0.16)';
      ctx.lineWidth = 0.3;
      for (const r of [8, 14]) { ctx.beginPath(); ctx.arc(m.x, m.y, r, 0, Math.PI * 2); ctx.stroke(); }
    }
    ctx.fillStyle = m.kind === 'gate' ? '#f7f7f2' : '#f08a24';
    ctx.beginPath();
    ctx.arc(m.x, m.y, 0.7, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = 'rgba(20,21,24,0.55)';
    ctx.beginPath();
    ctx.arc(m.x, m.y, 0.28, 0, Math.PI * 2);
    ctx.fill();
  }
}
