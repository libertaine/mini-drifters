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

// Draws the airfield skidpad in world coordinates, in place of grass and road.
// Used by both the Practice Pad (with painted practice drill stations) and non-urban Gymkhana.
export function drawPad(ctx, track) {
  const { bounds } = track;
  const w = bounds.maxX - bounds.minX;
  const h = bounds.maxY - bounds.minY;

  // Base weathered airfield tarmac.
  ctx.fillStyle = '#33363c';
  ctx.fillRect(bounds.minX, bounds.minY, w, h);

  // Subtle alternating tarmac / concrete expansion bays (20 m) for depth & speed perception.
  const bay = 20;
  for (let bx = bounds.minX; bx < bounds.maxX; bx += bay) {
    for (let by = bounds.minY; by < bounds.maxY; by += bay) {
      const ix = Math.round(bx / bay);
      const iy = Math.round(by / bay);
      const hash = (ix * 13 + iy * 29) & 7;
      if (hash === 0 || hash === 5) {
        ctx.fillStyle = 'rgba(255,255,255,0.022)';
        ctx.fillRect(bx, by, Math.min(bay, bounds.maxX - bx), Math.min(bay, bounds.maxY - by));
      } else if (hash === 3) {
        ctx.fillStyle = 'rgba(12,13,16,0.06)';
        ctx.fillRect(bx, by, Math.min(bay, bounds.maxX - bx), Math.min(bay, bounds.maxY - by));
      }
    }
  }

  // Quiet perimeter safety apron stripe just inside the barrier wall.
  ctx.save();
  ctx.strokeStyle = 'rgba(246,241,228,0.16)';
  ctx.lineWidth = 0.65;
  ctx.strokeRect(bounds.minX + 3.2, bounds.minY + 3.2, w - 6.4, h - 6.4);
  ctx.strokeStyle = 'rgba(207,74,27,0.28)';
  ctx.lineWidth = 0.65;
  ctx.setLineDash([4.5, 4.5]);
  ctx.strokeRect(bounds.minX + 3.2, bounds.minY + 3.2, w - 6.4, h - 6.4);
  ctx.setLineDash([]);

  // Faded airfield runway threshold bars & center stripes (kept subtle so challenge paint dominates).
  const midY = (bounds.minY + bounds.maxY) / 2;
  ctx.fillStyle = 'rgba(246,241,228,0.045)';
  for (const edgeX of [bounds.minX + 9, bounds.maxX - 18]) {
    for (let k = -3; k <= 3; k += 1) {
      ctx.fillRect(edgeX, midY + k * 4.4 - 0.9, 9, 1.8);
    }
  }
  ctx.fillStyle = 'rgba(246,241,228,0.05)';
  ctx.font = '700 8.5px Impact, Haettenschweiler, "Arial Narrow Bold", sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(track.markers.length ? 'SKIDPAD 01' : 'AUTOCROSS PAD', (bounds.minX + bounds.maxX) / 2, bounds.minY + 13);

  // 20 m tar expansion joints + subtle 10 m crosshairs at intersections.
  ctx.strokeStyle = 'rgba(14,15,18,0.34)';
  ctx.lineWidth = 0.22;
  ctx.beginPath();
  for (let v = bounds.minX + bay; v < bounds.maxX; v += bay) { ctx.moveTo(v, bounds.minY); ctx.lineTo(v, bounds.maxY); }
  for (let v = bounds.minY + bay; v < bounds.maxY; v += bay) { ctx.moveTo(bounds.minX, v); ctx.lineTo(bounds.maxX, v); }
  ctx.stroke();

  ctx.strokeStyle = 'rgba(246,241,228,0.06)';
  ctx.lineWidth = 0.16;
  ctx.beginPath();
  for (let v = bounds.minX; v <= bounds.maxX; v += bay) { ctx.moveTo(v + 0.2, bounds.minY); ctx.lineTo(v + 0.2, bounds.maxY); }
  for (let v = bounds.minY; v <= bounds.maxY; v += bay) { ctx.moveTo(bounds.minX, v + 0.2); ctx.lineTo(bounds.maxX, v + 0.2); }
  ctx.stroke();

  // Practice Pad dedicated drill zones & painted stencils (when markers are present).
  if (track.markers.length) {
    // Starting staging box around the practice grid.
    ctx.strokeStyle = 'rgba(246,241,228,0.32)';
    ctx.lineWidth = 0.32;
    ctx.strokeRect(track.start.x - 4.2, track.start.y - 3, 8.4, 6);

    const drawStencil = (text, sx, sy) => {
      ctx.fillStyle = 'rgba(246,241,228,0.26)';
      ctx.font = '700 3.2px Impact, Haettenschweiler, "Arial Narrow Bold", sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(text, sx, sy);
    };

    // 1. Donut station (-70, -60): worn rubber ghost ring + painted target circles.
    ctx.strokeStyle = 'rgba(12,13,16,0.28)';
    ctx.lineWidth = 3.2;
    ctx.beginPath();
    ctx.arc(-70, -60, 10.5, 0, Math.PI * 2);
    ctx.stroke();
    ctx.strokeStyle = 'rgba(246,241,228,0.24)';
    ctx.lineWidth = 0.34;
    for (const r of [8, 14]) { ctx.beginPath(); ctx.arc(-70, -60, r, 0, Math.PI * 2); ctx.stroke(); }
    drawStencil('DONUT PAD', -70, -78.5);

    // 2. Figure-8 station (20, -60) & (56, -60): faint infinity guide loop & worn sweep.
    ctx.strokeStyle = 'rgba(12,13,16,0.22)';
    ctx.lineWidth = 2.6;
    ctx.beginPath();
    ctx.arc(20, -60, 11.5, 0, Math.PI * 2);
    ctx.moveTo(56 + 11.5, -60);
    ctx.arc(56, -60, 11.5, 0, Math.PI * 2);
    ctx.stroke();
    ctx.strokeStyle = 'rgba(246,241,228,0.22)';
    ctx.lineWidth = 0.32;
    ctx.setLineDash([2.2, 2.2]);
    ctx.beginPath();
    ctx.arc(20, -60, 12, 0.35, Math.PI * 2 - 0.35);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(56, -60, 12, Math.PI + 0.35, Math.PI * 3 - 0.35);
    ctx.stroke();
    ctx.setLineDash([]);
    drawStencil('FIGURE 8', 38, -78.5);

    // 3. 180-turn station (-90, 30..44 to -20, 37): painted corridor & turn arc.
    ctx.strokeStyle = 'rgba(246,241,228,0.24)';
    ctx.lineWidth = 0.3;
    ctx.setLineDash([2.4, 2]);
    ctx.beginPath();
    ctx.moveTo(-90, 30); ctx.lineTo(-10, 30);
    ctx.arc(-10, 37, 7, -Math.PI / 2, Math.PI / 2);
    ctx.lineTo(-90, 44);
    ctx.stroke();
    ctx.setLineDash([]);
    drawStencil('180 TURN', -52, 24.5);

    // 4. Slalom lane (10..98, 70): lane edges & sinusoidal weave hint.
    ctx.strokeStyle = 'rgba(246,241,228,0.22)';
    ctx.lineWidth = 0.3;
    ctx.beginPath();
    ctx.moveTo(0, 58); ctx.lineTo(108, 58);
    ctx.moveTo(0, 82); ctx.lineTo(108, 82);
    ctx.stroke();
    ctx.strokeStyle = 'rgba(255,182,39,0.22)';
    ctx.lineWidth = 0.36;
    ctx.setLineDash([2.2, 1.8]);
    ctx.beginPath();
    for (let sx = 0; sx <= 108; sx += 2) {
      const sy = 70 + Math.sin(((sx - 10) / 22) * Math.PI + Math.PI / 2) * 5.2;
      if (sx === 0) ctx.moveTo(sx, sy); else ctx.lineTo(sx, sy);
    }
    ctx.stroke();
    ctx.setLineDash([]);
    drawStencil('SLALOM LANE', 54, 53);

    // Grounded 3D-shaded markers & cones.
    for (const m of track.markers) {
      ctx.fillStyle = 'rgba(0,0,0,0.34)';
      ctx.beginPath();
      ctx.ellipse(m.x + 0.24, m.y + 0.3, 0.9, 0.85, 0, 0, Math.PI * 2);
      ctx.fill();
      if (m.kind === 'gate') {
        ctx.fillStyle = '#1d1f24';
        ctx.fillRect(m.x - 0.72, m.y - 0.72, 1.44, 1.44);
        ctx.fillStyle = '#f6f1e4';
        ctx.beginPath();
        ctx.arc(m.x, m.y, 0.62, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = '#ffb627';
        ctx.beginPath();
        ctx.arc(m.x, m.y, 0.26, 0, Math.PI * 2);
        ctx.fill();
      } else {
        ctx.fillStyle = '#18191d';
        ctx.fillRect(m.x - 0.72, m.y - 0.72, 1.44, 1.44);
        ctx.fillStyle = '#f08a24';
        ctx.beginPath();
        ctx.arc(m.x, m.y, 0.68, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = '#f7f7f2';
        ctx.beginPath();
        ctx.arc(m.x, m.y, 0.38, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = '#f08a24';
        ctx.beginPath();
        ctx.arc(m.x, m.y, 0.18, 0, Math.PI * 2);
        ctx.fill();
      }
    }
  }
  ctx.restore();
}

// Draws Practice Pad's four practice drill zones on the minimap so the driver can orient easily.
export function drawPadMap(ctx, track, px) {
  if (!track.markers?.length) return;
  ctx.save();
  ctx.strokeStyle = 'rgba(246,241,228,0.45)';
  ctx.lineWidth = 1.2 * px;
  ctx.beginPath();
  ctx.arc(-70, -60, 12, 0, Math.PI * 2);
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(20, -60, 11, 0, Math.PI * 2);
  ctx.moveTo(56 + 11, -60);
  ctx.arc(56, -60, 11, 0, Math.PI * 2);
  ctx.stroke();
  for (const m of track.markers) {
    ctx.fillStyle = m.kind === 'gate' ? '#f6f1e4' : '#f08a24';
    ctx.beginPath();
    ctx.arc(m.x, m.y, 2.2 * px, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}
