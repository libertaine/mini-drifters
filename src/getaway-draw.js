// Paints Getaway Drift (EXPERIMENTAL, v0.7.0 R4 research) onto the pad, in world coordinates
// (metres), and onto the minimap: the road or the suggested line, the cameras and the bands they
// film, the escape gate, and the ring the police car arrests within. The police car itself is
// drawn by render.js, which owns the car artwork. Reads the challenge and its run; changes neither.
const PAINT = 'rgba(246,241,228,0.5)';
const FAINT = 'rgba(246,241,228,0.28)';
const AMBER = '#ffb627';
const GREEN = '#5fd38a';
const CYAN = '#34e0ff';
const RED = '#ff5a4f';
const LABEL_FONT = 'Impact, Haettenschweiler, "Arial Narrow Bold", sans-serif';

function label(ctx, text, x, y, size, color) {
  ctx.font = `${size}px ${LABEL_FONT}`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = color;
  ctx.fillText(text, x, y);
}

function line(ctx, x1, y1, x2, y2) {
  ctx.beginPath();
  ctx.moveTo(x1, y1);
  ctx.lineTo(x2, y2);
  ctx.stroke();
}

const paths = new WeakMap();
function coursePaths(def) {
  if (paths.has(def.geometry)) return paths.get(def.geometry);
  const { course, corridor, exitS } = def.geometry;
  const left = new Path2D();
  const right = new Path2D();
  const centre = new Path2D();
  const arrows = [];
  course.points.forEach((p, i) => {
    if (p.s > exitS + 30) return;
    const lx = p.x + p.ty * corridor;
    const ly = p.y - p.tx * corridor;
    const rx = p.x - p.ty * corridor;
    const ry = p.y + p.tx * corridor;
    if (i === 0) { left.moveTo(lx, ly); right.moveTo(rx, ry); centre.moveTo(p.x, p.y); }
    else { left.lineTo(lx, ly); right.lineTo(rx, ry); centre.lineTo(p.x, p.y); }
    if (i > 20 && i % 45 === 0 && i < exitS - 15) arrows.push(p);
  });
  const built = { left, right, centre, arrows };
  paths.set(def.geometry, built);
  return built;
}

// A chevron on the asphalt, pointing along the course.
function chevron(ctx, p, color) {
  ctx.save();
  ctx.translate(p.x, p.y);
  ctx.rotate(Math.atan2(p.ty, p.tx));
  ctx.strokeStyle = color;
  ctx.lineWidth = 0.55;
  ctx.beginPath();
  ctx.moveTo(-1.4, -2.2);
  ctx.lineTo(1.2, 0);
  ctx.lineTo(-1.4, 2.2);
  ctx.stroke();
  ctx.restore();
}

function cameraColor(run, i) {
  if (run.cameras[i]) return GREEN;
  if (i === run.nextCamera && run.phase === 'running') return run.missed[i] ? RED : AMBER;
  if (i === run.nextCamera && run.phase === 'failed') return RED;
  return FAINT;
}

// A small camera on a tripod, aimed at the road, with its field of view across the band it films.
function drawCamera(ctx, cam, color, active, time) {
  const { gate } = cam;
  // The field of view: a fan from the lens to the two ends of the filmed band.
  ctx.fillStyle = active ? 'rgba(255,182,39,0.10)' : color === GREEN ? 'rgba(95,211,138,0.07)' : 'rgba(246,241,228,0.03)';
  ctx.beginPath();
  ctx.moveTo(cam.x, cam.y);
  ctx.lineTo(gate.x1 + gate.tx * 3, gate.y1 + gate.ty * 3);
  ctx.lineTo(gate.x2 + gate.tx * 3, gate.y2 + gate.ty * 3);
  ctx.closePath();
  ctx.fill();
  // The band itself.
  ctx.strokeStyle = color;
  ctx.lineWidth = active ? 0.7 : 0.45;
  ctx.setLineDash([1.6, 1.1]);
  line(ctx, gate.x1, gate.y1, gate.x2, gate.y2);
  ctx.setLineDash([]);
  // Tripod and body.
  ctx.save();
  ctx.translate(cam.x, cam.y);
  ctx.strokeStyle = 'rgba(20,21,24,0.9)';
  ctx.lineWidth = 0.25;
  for (const a of [0.6, 2.7, 4.6]) line(ctx, 0, 0, Math.cos(a) * 1.3, Math.sin(a) * 1.3);
  ctx.rotate(cam.aim);
  ctx.fillStyle = '#1b1c20';
  ctx.beginPath();
  ctx.roundRect(-1.1, -0.7, 2, 1.4, 0.25);
  ctx.fill();
  ctx.fillStyle = color === FAINT ? '#55575e' : color;
  ctx.fillRect(0.9, -0.45, 0.7, 0.9);   // the lens hood
  // REC light: blinking red while this camera is waiting for its shot.
  if (active && Math.floor(time * 2.5) % 2 === 0) {
    ctx.fillStyle = RED;
    ctx.beginPath();
    ctx.arc(-0.6, -0.35, 0.28, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
  label(ctx, `CAM ${cam.number}`, cam.x - Math.cos(cam.aim) * 3, cam.y - Math.sin(cam.aim) * 3, 2.2, color);
}

export function drawGetaway(ctx, def, run, time = 0) {
  const { cameras, exit, painted, course, corridor } = def.geometry;
  const { left, right, centre, arrows } = coursePaths(def);

  if (painted === 'road') {
    // A darker band of road with painted edges, so the route reads at a glance.
    ctx.strokeStyle = 'rgba(0,0,0,0.16)';
    ctx.lineWidth = corridor * 2;
    ctx.lineJoin = 'round';
    ctx.stroke(centre);
    ctx.strokeStyle = run.offCourse && run.phase === 'running' ? 'rgba(255,90,79,0.8)' : PAINT;
    ctx.lineWidth = 0.35;
    ctx.stroke(left);
    ctx.stroke(right);
    ctx.strokeStyle = 'rgba(246,241,228,0.12)';
    ctx.lineWidth = 0.25;
    ctx.setLineDash([3, 5]);
    ctx.stroke(centre);
    ctx.setLineDash([]);
  } else {
    // The open layout: only a suggested line, faintly, with its corridor edges hinted.
    ctx.strokeStyle = 'rgba(246,241,228,0.22)';
    ctx.lineWidth = 0.5;
    ctx.setLineDash([4, 4]);
    ctx.stroke(centre);
    ctx.setLineDash([]);
    ctx.strokeStyle = run.offCourse && run.phase === 'running' ? 'rgba(255,90,79,0.35)' : 'rgba(246,241,228,0.07)';
    ctx.lineWidth = 0.3;
    ctx.stroke(left);
    ctx.stroke(right);
  }
  for (const p of arrows) chevron(ctx, p, 'rgba(246,241,228,0.2)');

  // The grid.
  const first = course.points[0];
  ctx.strokeStyle = FAINT;
  ctx.lineWidth = 0.3;
  const nx = -first.ty;
  const ny = first.tx;
  line(ctx, first.x - first.tx * 3.2 + nx * 6, first.y - first.ty * 3.2 + ny * 6, first.x - first.tx * 3.2 - nx * 6, first.y - first.ty * 3.2 - ny * 6);

  cameras.forEach((cam, i) => drawCamera(ctx, cam, cameraColor(run, i), i === run.nextCamera && run.phase === 'running', time));

  // The escape gate: shut (red) until every camera has its shot, then open (green).
  const open = run.exitOpen;
  const color = run.phase === 'complete' || open ? GREEN : RED;
  ctx.strokeStyle = color;
  ctx.lineWidth = 1;
  ctx.setLineDash([1, 1]);
  line(ctx, exit.x1, exit.y1, exit.x2, exit.y2);
  ctx.setLineDash([]);
  // The words sit just past the gate, along the road, clear of the gate line.
  label(ctx, open || run.phase === 'complete' ? 'ESCAPE' : `ESCAPE · LOCKED ${run.nextCamera}/${cameras.length}`,
    exit.cx + exit.tx * 5, exit.cy + exit.ty * 5, 2.4, color);

  // The ring the police car arrests within, so a bust is never a mystery.
  const p = run.pursuer;
  const r = def.captureModel.radius;
  const inside = run.gap < r && run.phase === 'running';
  ctx.strokeStyle = inside ? `rgba(255,90,79,${0.45 + 0.35 * run.meter})` : 'rgba(255,90,79,0.18)';
  ctx.lineWidth = inside ? 0.5 : 0.3;
  ctx.setLineDash(inside ? [] : [1.2, 1.2]);
  ctx.beginPath();
  ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
  ctx.stroke();
  ctx.setLineDash([]);
}

// Inside the minimap's own transform. `px` is one screen pixel in metres.
export function drawGetawayMap(ctx, game, px) {
  const def = game.challengeDef;
  const run = game.challenge;
  const { cameras, exit } = def.geometry;
  ctx.strokeStyle = 'rgba(246,241,228,0.85)';
  ctx.lineWidth = 3 * px;
  ctx.stroke(coursePaths(def).centre);
  cameras.forEach((cam, i) => {
    ctx.fillStyle = cameraColor(run, i) === FAINT ? 'rgba(246,241,228,0.6)' : cameraColor(run, i);
    ctx.beginPath();
    ctx.arc(cam.gate.cx, cam.gate.cy, 3 * px, 0, Math.PI * 2);
    ctx.fill();
  });
  ctx.strokeStyle = run.exitOpen ? GREEN : RED;
  ctx.lineWidth = 2.6 * px;
  const reach = exit.half + 5 * px;
  line(ctx, exit.cx - exit.ty * reach, exit.cy + exit.tx * reach, exit.cx + exit.ty * reach, exit.cy - exit.tx * reach);
  const p = run.pursuer;
  ctx.fillStyle = Math.floor(performance.now() / 250) % 2 ? '#3d7bff' : RED;
  ctx.beginPath();
  ctx.arc(p.x, p.y, 3.6 * px, 0, Math.PI * 2);
  ctx.fill();
}

// Debug only: where the police car is aiming, and its state.
export function drawGetawayDebug(ctx, run) {
  const p = run.pursuer;
  ctx.strokeStyle = CYAN;
  ctx.lineWidth = 0.3;
  ctx.setLineDash([0.8, 0.8]);
  line(ctx, p.x, p.y, p.targetX, p.targetY);
  ctx.setLineDash([]);
  label(ctx, p.state.toUpperCase(), p.x, p.y - 4.5, 1.8, CYAN);
}
