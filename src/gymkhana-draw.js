// Paints a gymkhana challenge onto the pad, in world coordinates (metres), and onto the
// minimap. Reads the challenge and its run; changes neither.
import { CONE_RADIUS } from './gymkhana.js';
import { drawGetaway, drawGetawayMap } from './getaway-draw.js';
import { drawUrban, drawUrbanMap } from './getaway-urban-draw.js';

const PAINT = 'rgba(246,241,228,0.78)';
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

// An arrow painted on the asphalt, pointing along `heading`.
function arrow(ctx, x, y, heading, length, color) {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(heading);
  ctx.strokeStyle = color;
  ctx.fillStyle = color;
  ctx.lineWidth = 0.5;
  line(ctx, -length / 2, 0, length / 2 - 1.2, 0);
  ctx.beginPath();
  ctx.moveTo(length / 2, 0);
  ctx.lineTo(length / 2 - 1.8, 1.1);
  ctx.lineTo(length / 2 - 1.8, -1.1);
  ctx.closePath();
  ctx.fill();
  ctx.restore();
}

// `penalty` is the seconds a fallen cone cost, painted beside it; 0 paints nothing.
function drawCones(ctx, cones, penalty) {
  for (const cone of cones) {
    const x = cone.x + cone.dx;
    const y = cone.y + cone.dy;
    if (cone.hit) {
      // Knocked over: pushed along the car's travel, flattened and dulled.
      ctx.fillStyle = 'rgba(240,138,36,0.55)';
      ctx.beginPath();
      ctx.ellipse(x, y, CONE_RADIUS * 1.5, CONE_RADIUS * 0.75, Math.atan2(cone.dy, cone.dx), 0, Math.PI * 2);
      ctx.fill();
      if (penalty) label(ctx, `+${penalty} s`, cone.x, cone.y - 2.2, 1.7, RED);
      continue;
    }
    ctx.fillStyle = '#f08a24';
    ctx.beginPath();
    ctx.arc(x, y, CONE_RADIUS * 1.5, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#f7f7f2';
    ctx.beginPath();
    ctx.arc(x, y, CONE_RADIUS * 0.85, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#f08a24';
    ctx.beginPath();
    ctx.arc(x, y, CONE_RADIUS * 0.4, 0, Math.PI * 2);
    ctx.fill();
  }
}

function drawPrecision(ctx, def, run) {
  const { box, gate, zoneFrom, start } = def.geometry;
  const zoneX = box.minX + zoneFrom;
  const live = run.phase === 'running';
  const { goingOut } = run;

  // The turn zone: where the car has to get to before it comes back.
  ctx.fillStyle = run.reached ? 'rgba(95,211,138,0.16)' : 'rgba(255,182,39,0.16)';
  ctx.fillRect(zoneX, box.minY, box.maxX - zoneX, box.maxY - box.minY);
  ctx.save();
  ctx.beginPath();
  ctx.rect(zoneX, box.minY, box.maxX - zoneX, box.maxY - box.minY);
  ctx.clip();
  ctx.strokeStyle = run.reached ? 'rgba(95,211,138,0.22)' : 'rgba(255,182,39,0.22)';
  ctx.lineWidth = 0.35;
  for (let x = zoneX - 16; x < box.maxX; x += 2.4) line(ctx, x, box.maxY, x + 14, box.minY);
  ctx.restore();
  label(ctx, 'TURN ZONE', (zoneX + box.maxX) / 2, 0, 2.6, run.reached ? 'rgba(95,211,138,0.6)' : 'rgba(255,182,39,0.6)');

  // The box: three painted edges and an open mouth.
  ctx.strokeStyle = run.reason === 'left the box' ? RED : PAINT;
  ctx.lineWidth = 0.4;
  ctx.beginPath();
  ctx.moveTo(box.minX, box.minY);
  ctx.lineTo(box.maxX, box.minY);
  ctx.lineTo(box.maxX, box.maxY);
  ctx.lineTo(box.minX, box.maxY);
  ctx.stroke();
  ctx.strokeStyle = FAINT;
  ctx.lineWidth = 0.25;
  ctx.setLineDash([1.2, 1.2]);
  line(ctx, box.minX, box.minY, box.minX, box.maxY);
  line(ctx, zoneX, box.minY, zoneX, box.maxY);
  ctx.setLineDash([]);

  // The gate: the way in, and then the way out.
  ctx.strokeStyle = live && goingOut ? GREEN : live && !run.gateIn ? CYAN : FAINT;
  ctx.lineWidth = 0.45;
  ctx.setLineDash([1.4, 1]);
  line(ctx, gate.x1, gate.y1, gate.x2, gate.y2);
  ctx.setLineDash([]);
  if (goingOut && live) arrow(ctx, gate.cx + 6, gate.cy, Math.PI, 7, 'rgba(95,211,138,0.7)');
  else if (!run.entered) arrow(ctx, gate.cx - 7, gate.cy, 0, 7, 'rgba(52,224,255,0.55)');

  // The start line.
  ctx.strokeStyle = FAINT;
  ctx.lineWidth = 0.3;
  line(ctx, start.x - 3.2, start.y - 4, start.x - 3.2, start.y + 4);
}

// The course edges, built once per layout: two lines the corridor's width from the course.
const edges = new WeakMap();
function courseEdges(def) {
  if (edges.has(def.geometry)) return edges.get(def.geometry);
  const { course, corridor, finishS } = def.geometry;
  const left = new Path2D();
  const right = new Path2D();
  const centre = new Path2D();
  course.points.forEach((p, i) => {
    if (p.s > finishS + 12) return;
    const lx = p.x + p.ty * corridor;
    const ly = p.y - p.tx * corridor;
    const rx = p.x - p.ty * corridor;
    const ry = p.y + p.tx * corridor;
    if (i === 0) { left.moveTo(lx, ly); right.moveTo(rx, ry); centre.moveTo(p.x, p.y); }
    else { left.lineTo(lx, ly); right.lineTo(rx, ry); centre.lineTo(p.x, p.y); }
  });
  const built = { left, right, centre };
  edges.set(def.geometry, built);
  return built;
}

function gateColor(run, i) {
  const passed = run.gates[i];
  if (passed) return passed.drifting ? GREEN : 'rgba(246,241,228,0.35)';
  if (i === run.nextGate && run.phase === 'running') return CYAN;
  if (i === run.nextGate && run.phase === 'failed') return RED;
  return FAINT;
}

function drawLinked(ctx, def, run) {
  const { gates, course } = def.geometry;
  const { left, right, centre } = courseEdges(def);

  ctx.strokeStyle = run.offCourse && run.phase === 'running' ? 'rgba(255,90,79,0.8)' : 'rgba(246,241,228,0.5)';
  ctx.lineWidth = 0.35;
  ctx.stroke(left);
  ctx.stroke(right);
  ctx.strokeStyle = 'rgba(246,241,228,0.12)';
  ctx.lineWidth = 0.25;
  ctx.setLineDash([3, 5]);
  ctx.stroke(centre);
  ctx.setLineDash([]);

  const first = course.points[0];
  ctx.strokeStyle = FAINT;
  ctx.lineWidth = 0.3;
  line(ctx, first.x - 3.2, first.y - 6, first.x - 3.2, first.y + 6);

  gates.forEach((gate, i) => {
    const finish = gate.label === 'finish';
    ctx.strokeStyle = gateColor(run, i);
    ctx.lineWidth = finish ? 0.9 : i === run.nextGate ? 0.6 : 0.4;
    ctx.setLineDash(finish ? [1, 1] : [1.6, 1.1]);
    line(ctx, gate.x1, gate.y1, gate.x2, gate.y2);
    ctx.setLineDash([]);
    // The number sits just outside the right-hand cone, clear of the driving line.
    const out = gate.half + 2.6;
    label(ctx, finish ? 'FINISH' : gate.label, gate.cx - gate.ty * out, gate.cy + gate.tx * out, finish ? 2 : 2.8, gateColor(run, i));
  });
}

// Slalom Sprint: the lane, the start line, an arrow on the side each cone
// is passed on, the next cone's gate, and the finish.
function slalomColor(run, i) {
  if (i < run.next) return GREEN;
  if (i === run.failedAt) return RED;
  if (i === run.next && run.phase === 'running') return CYAN;
  return FAINT;
}

function drawSlalom(ctx, def, run) {
  const { slalom, finish, lane, start, count } = def.geometry;
  const first = slalom[0].x;
  const last = slalom[count - 1].x;
  const live = run.phase === 'running';

  // The lane's two edges.
  ctx.strokeStyle = /^left the lane/.test(run.reason) ? RED : 'rgba(246,241,228,0.5)';
  ctx.lineWidth = 0.35;
  line(ctx, first - 10, -lane, last + 10, -lane);
  line(ctx, first - 10, lane, last + 10, lane);
  // The line of cones, faintly, so the weave reads as crossing it.
  ctx.strokeStyle = 'rgba(246,241,228,0.12)';
  ctx.lineWidth = 0.25;
  ctx.setLineDash([3, 5]);
  line(ctx, first - 10, 0, last + 10, 0);
  ctx.setLineDash([]);

  // The start line.
  ctx.strokeStyle = FAINT;
  ctx.lineWidth = 0.3;
  line(ctx, start.x - 3.2, -4, start.x - 3.2, 4);

  slalom.forEach((cone, i) => {
    const color = slalomColor(run, i);
    // The next cone's gate: from the cone out to the lane edge, on the side to pass.
    if (i === run.next && live) {
      ctx.strokeStyle = color;
      ctx.lineWidth = 0.5;
      ctx.setLineDash([1.6, 1.1]);
      line(ctx, cone.x, cone.side * 1.2, cone.x, cone.side * lane);
      ctx.setLineDash([]);
    }
    arrow(ctx, cone.x, cone.side * 4, 0, 6, color);
    // The number sits on the far side, clear of the driving line.
    label(ctx, String(cone.number), cone.x, -cone.side * 3.4, 2.6, color);
  });

  const done = run.next >= count;
  const finishColor = run.phase === 'complete' || (done && live) ? GREEN : run.reason === 'missed the finish' ? RED : FAINT;
  ctx.strokeStyle = finishColor;
  ctx.lineWidth = 0.9;
  ctx.setLineDash([1, 1]);
  line(ctx, finish.x1, finish.y1, finish.x2, finish.y2);
  ctx.setLineDash([]);
  label(ctx, 'FINISH', finish.cx, finish.half + 2.8, 2, finishColor);
}

// Called by render.js after the pad is painted and before the skid marks and the car.
export function drawChallenge(ctx, game) {
  const def = game.challengeDef;
  const run = game.challenge;
  if (!def || !run) return;
  ctx.save();
  ctx.lineCap = 'butt';
  if (def.layout === 'box') drawPrecision(ctx, def, run);
  else if (def.layout === 'slalom') drawSlalom(ctx, def, run);
  else if (def.layout === 'getaway') drawGetaway(ctx, def, run, performance.now() / 1000);  // experimental (R4)
  else if (def.layout === 'urban') drawUrban(ctx, def, run, game, performance.now() / 1000);  // experimental (R4B)
  else drawLinked(ctx, def, run);
  drawCones(ctx, run.cones, def.kind === 'time' ? def.geometry.conePenalty : 0);
  ctx.restore();
}

// Called by render.js inside the minimap's own transform. `px` is one screen pixel in metres.
export function drawChallengeMap(ctx, game, px) {
  const def = game.challengeDef;
  const run = game.challenge;
  if (!def || !run) return;
  ctx.save();
  ctx.lineJoin = 'round';
  if (def.layout === 'getaway') drawGetawayMap(ctx, game, px);  // experimental (R4)
  else if (def.layout === 'urban') drawUrbanMap(ctx, game, px);  // experimental (R4B)
  else if (def.layout === 'box') {
    const { box, gate, zoneFrom } = def.geometry;
    ctx.fillStyle = run.reached ? 'rgba(95,211,138,0.5)' : 'rgba(255,182,39,0.5)';
    ctx.fillRect(box.minX + zoneFrom, box.minY, box.maxX - box.minX - zoneFrom, box.maxY - box.minY);
    ctx.strokeStyle = 'rgba(246,241,228,0.85)';
    ctx.lineWidth = 1.5 * px;
    ctx.beginPath();
    ctx.moveTo(box.minX, box.minY);
    ctx.lineTo(box.maxX, box.minY);
    ctx.lineTo(box.maxX, box.maxY);
    ctx.lineTo(box.minX, box.maxY);
    ctx.stroke();
    ctx.strokeStyle = CYAN;
    ctx.lineWidth = 2 * px;
    line(ctx, gate.x1, gate.y1, gate.x2, gate.y2);
  } else if (def.layout === 'slalom') {
    // Slalom Sprint: the lane, a dot for each cone, and the finish.
    const { slalom, finish, lane, count } = def.geometry;
    ctx.strokeStyle = 'rgba(246,241,228,0.6)';
    ctx.lineWidth = 1.2 * px;
    line(ctx, slalom[0].x - 10, -lane, slalom[count - 1].x + 10, -lane);
    line(ctx, slalom[0].x - 10, lane, slalom[count - 1].x + 10, lane);
    slalom.forEach((cone, i) => {
      ctx.fillStyle = i < run.next ? GREEN : i === run.failedAt ? RED : i === run.next ? CYAN : '#f08a24';
      ctx.beginPath();
      ctx.arc(cone.x, cone.y, 2.4 * px, 0, Math.PI * 2);
      ctx.fill();
    });
    ctx.strokeStyle = run.next >= count ? GREEN : 'rgba(246,241,228,0.85)';
    ctx.lineWidth = 2.2 * px;
    line(ctx, finish.cx, -finish.half - 5 * px, finish.cx, finish.half + 5 * px);
  } else {
    const { gates } = def.geometry;
    ctx.strokeStyle = 'rgba(246,241,228,0.85)';
    ctx.lineWidth = 3.4 * px;
    ctx.stroke(courseEdges(def).centre);
    gates.forEach((gate, i) => {
      ctx.strokeStyle = gateColor(run, i);
      ctx.lineWidth = 2.2 * px;
      const reach = gate.half + 5 * px; // long enough to see at this scale
      line(ctx, gate.cx - gate.ty * reach, gate.cy + gate.tx * reach, gate.cx + gate.ty * reach, gate.cy - gate.tx * reach);
    });
  }
  ctx.restore();
}
