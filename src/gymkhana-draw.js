// Paints a gymkhana challenge onto the pad, in world coordinates (metres), and onto the
// minimap. Reads the challenge and its run; changes neither.
import { CONE_RADIUS } from './gymkhana.js';
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

// Cosmetic per-run world animation state (purely visual, never written onto `run`).
const animState = new WeakMap();
function getAnim(run) {
  let state = animState.get(run);
  if (!state) {
    state = {
      coneHitAt: new WeakMap(),
      pulses: [],
      reachedAt: null,
      lastGate: 0,
      lastSlalom: 0,
    };
    animState.set(run, state);
  }
  return state;
}

function drawCheckeredStrip(ctx, x1, y1, x2, y2, width = 1.4, accent = PAINT) {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const len = Math.hypot(dx, dy) || 1;
  const angle = Math.atan2(dy, dx);
  const cell = width * 0.55;
  const count = Math.max(4, Math.round(len / cell));
  const step = len / count;
  ctx.save();
  ctx.translate(x1, y1);
  ctx.rotate(angle);
  for (let i = 0; i < count; i += 1) {
    for (let j = 0; j < 2; j += 1) {
      ctx.fillStyle = (i + j) % 2 === 0 ? 'rgba(246,241,228,0.88)' : 'rgba(18,19,22,0.88)';
      ctx.fillRect(i * step, -width / 2 + j * (width / 2), step, width / 2);
    }
  }
  ctx.strokeStyle = accent;
  ctx.lineWidth = 0.22;
  ctx.strokeRect(0, -width / 2, len, width);
  ctx.restore();
}

function drawStartBox(ctx, x, y, half = 4.2) {
  ctx.save();
  ctx.strokeStyle = 'rgba(246,241,228,0.52)';
  ctx.lineWidth = 0.34;
  line(ctx, x - 3.2, y - half, x - 3.2, y + half);
  ctx.beginPath();
  ctx.moveTo(x - 3.2, y - half); ctx.lineTo(x + 2.8, y - half);
  ctx.moveTo(x - 3.2, y + half); ctx.lineTo(x + 2.8, y + half);
  ctx.stroke();
  ctx.translate(x - 4.7, y);
  ctx.rotate(-Math.PI / 2);
  label(ctx, 'START', 0, 0, 1.75, 'rgba(246,241,228,0.48)');
  ctx.restore();
}

function drawPulses(ctx, pulses, time, still) {
  for (let i = pulses.length - 1; i >= 0; i -= 1) {
    const p = pulses[i];
    const age = still ? 0.16 : time - p.at;
    if (age < 0 || age > p.dur) {
      if (!still && age > p.dur) pulses.splice(i, 1);
      continue;
    }
    const t = age / p.dur;
    const ease = 1 - (1 - t) ** 3;
    const r = p.r0 + (p.r1 - p.r0) * ease;
    ctx.save();
    ctx.globalAlpha = (1 - t) * 0.78;
    ctx.strokeStyle = p.color;
    ctx.lineWidth = 0.55 * (1 - t * 0.55);
    ctx.beginPath();
    ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
    ctx.stroke();
    if (p.tag) {
      ctx.globalAlpha = Math.min(1, (1 - t) * 1.4);
      label(ctx, p.tag, p.x, p.y - 2.6 - ease * 3.2, 2.2, p.color);
    }
    ctx.restore();
  }
}

// `penalty` is the seconds a fallen cone cost, painted in a crisp pill beside it; 0 paints nothing.
function drawCones(ctx, cones, penalty, anim, time, still) {
  for (const cone of cones) {
    if (cone.hit) {
      let hitAt = anim.coneHitAt.get(cone);
      if (hitAt === undefined) { hitAt = time; anim.coneHitAt.set(cone, hitAt); }
      const slide = still ? 1 : Math.min(1, Math.max(0, (time - hitAt) / 0.18));
      const ease = 1 - (1 - slide) ** 3;
      const x = cone.x + cone.dx * ease;
      const y = cone.y + cone.dy * ease;
      const dir = Math.atan2(cone.dy, cone.dx);
      // Knocked over: flattened tipped cone sliding along car's travel with dark base & shadow.
      ctx.save();
      ctx.translate(x, y);
      ctx.rotate(dir);
      ctx.fillStyle = 'rgba(0,0,0,0.34)';
      ctx.beginPath();
      ctx.ellipse(0.18, 0.25, CONE_RADIUS * 1.65, CONE_RADIUS * 0.82, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#1c1d22';
      ctx.fillRect(-CONE_RADIUS * 1.55, -CONE_RADIUS * 0.8, CONE_RADIUS * 0.65, CONE_RADIUS * 1.6);
      ctx.fillStyle = 'rgba(240,138,36,0.82)';
      ctx.beginPath();
      ctx.moveTo(-CONE_RADIUS * 1.1, -CONE_RADIUS * 0.72);
      ctx.lineTo(CONE_RADIUS * 1.65, 0);
      ctx.lineTo(-CONE_RADIUS * 1.1, CONE_RADIUS * 0.72);
      ctx.closePath();
      ctx.fill();
      ctx.fillStyle = 'rgba(246,241,228,0.78)';
      ctx.fillRect(-CONE_RADIUS * 0.25, -CONE_RADIUS * 0.42, CONE_RADIUS * 0.58, CONE_RADIUS * 0.84);
      ctx.restore();
      if (penalty) {
        const px = cone.x;
        const py = cone.y - 2.35;
        ctx.fillStyle = 'rgba(18,19,23,0.84)';
        ctx.beginPath();
        ctx.roundRect(px - 2.4, py - 1.1, 4.8, 2.2, 0.5);
        ctx.fill();
        ctx.strokeStyle = RED;
        ctx.lineWidth = 0.2;
        ctx.stroke();
        label(ctx, `+${penalty} s`, px, py + 0.08, 1.55, RED);
      }
      continue;
    }
    const x = cone.x;
    const y = cone.y;
    // Standing 3D-shaded autocross cone: soft ground shadow, weighted square rubber base, orange cone, reflective collar.
    ctx.fillStyle = 'rgba(0,0,0,0.36)';
    ctx.beginPath();
    ctx.ellipse(x + 0.26, y + 0.34, CONE_RADIUS * 1.75, CONE_RADIUS * 1.65, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#181a1f';
    ctx.fillRect(x - CONE_RADIUS * 1.55, y - CONE_RADIUS * 1.55, CONE_RADIUS * 3.1, CONE_RADIUS * 3.1);
    ctx.fillStyle = '#f08a24';
    ctx.beginPath();
    ctx.arc(x, y, CONE_RADIUS * 1.48, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#f7f7f2';
    ctx.beginPath();
    ctx.arc(x, y, CONE_RADIUS * 0.88, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#ef7e1a';
    ctx.beginPath();
    ctx.arc(x, y, CONE_RADIUS * 0.46, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#ffd59c';
    ctx.beginPath();
    ctx.arc(x - CONE_RADIUS * 0.14, y - CONE_RADIUS * 0.14, CONE_RADIUS * 0.18, 0, Math.PI * 2);
    ctx.fill();
  }
}

function drawPrecision(ctx, def, run, anim, time, still) {
  const { box, gate, zoneFrom, start } = def.geometry;
  const zoneX = box.minX + zoneFrom;
  const live = run.phase === 'running';
  const { goingOut } = run;

  if (run.reached && anim.reachedAt === null) {
    anim.reachedAt = time;
    anim.pulses.push({ x: (zoneX + box.maxX) / 2, y: 0, r0: 3, r1: 18, at: time, dur: 0.65, color: GREEN, tag: 'TURN!' });
  }

  // Darkened staging tarmac inside the precision box so boundaries pop clearly.
  ctx.fillStyle = 'rgba(20,22,26,0.34)';
  ctx.fillRect(box.minX, box.minY, box.maxX - box.minX, box.maxY - box.minY);

  // Subtle turn-zone fill + crisp diagonal hatch + live emerald pulse once reached.
  const reachedPulse = run.reached && !still ? 0.04 * Math.sin(time * 8) : 0;
  ctx.fillStyle = run.reached ? `rgba(95,211,138,${(0.2 + reachedPulse).toFixed(3)})` : 'rgba(255,182,39,0.18)';
  ctx.fillRect(zoneX, box.minY, box.maxX - zoneX, box.maxY - box.minY);
  ctx.save();
  ctx.beginPath();
  ctx.rect(zoneX, box.minY, box.maxX - zoneX, box.maxY - box.minY);
  ctx.clip();
  ctx.strokeStyle = run.reached ? 'rgba(95,211,138,0.28)' : 'rgba(255,182,39,0.26)';
  ctx.lineWidth = 0.38;
  for (let x = zoneX - 16; x < box.maxX; x += 2.4) line(ctx, x, box.maxY, x + 14, box.minY);
  ctx.restore();
  label(ctx, run.reached ? 'GO BACK OUT' : 'TURN ZONE', (zoneX + box.maxX) / 2, 0, run.reached ? 2.2 : 2.6,
    run.reached ? 'rgba(130,240,168,0.82)' : 'rgba(255,198,84,0.72)');

  // The box: three crisp chalk edges, corner brackets, and open mouth.
  const boxColor = run.reason === 'left the box' ? RED : PAINT;
  ctx.strokeStyle = boxColor;
  ctx.lineWidth = 0.48;
  ctx.beginPath();
  ctx.moveTo(box.minX, box.minY);
  ctx.lineTo(box.maxX, box.minY);
  ctx.lineTo(box.maxX, box.maxY);
  ctx.lineTo(box.minX, box.maxY);
  ctx.stroke();
  ctx.strokeStyle = run.reached ? 'rgba(95,211,138,0.55)' : 'rgba(246,241,228,0.38)';
  ctx.lineWidth = 0.28;
  ctx.setLineDash([1.2, 1.2]);
  line(ctx, box.minX, box.minY, box.minX, box.maxY);
  line(ctx, zoneX, box.minY, zoneX, box.maxY);
  ctx.setLineDash([]);

  // The gate: pulsing active beam + flowing directional chevron arrows.
  const gateCol = live && goingOut ? GREEN : live && !run.gateIn ? CYAN : run.reached ? GREEN : FAINT;
  if (live && (!run.gateIn || goingOut)) {
    const glow = still ? 0.24 : 0.16 + 0.12 * Math.sin(time * 6.5);
    ctx.strokeStyle = goingOut ? `rgba(95,211,138,${glow.toFixed(3)})` : `rgba(52,224,255,${glow.toFixed(3)})`;
    ctx.lineWidth = 2.4;
    line(ctx, gate.x1, gate.y1, gate.x2, gate.y2);
  }
  ctx.strokeStyle = gateCol;
  ctx.lineWidth = 0.55;
  ctx.setLineDash([1.4, 1]);
  line(ctx, gate.x1, gate.y1, gate.x2, gate.y2);
  ctx.setLineDash([]);
  const shift = still ? 0 : Math.sin(time * 5.2) * 0.9;
  if (goingOut && live) arrow(ctx, gate.cx + 6.5 - shift, gate.cy, Math.PI, 7.2, 'rgba(95,211,138,0.85)');
  else if (!run.entered) arrow(ctx, gate.cx - 7.5 + shift, gate.cy, 0, 7.2, 'rgba(52,224,255,0.72)');

  drawStartBox(ctx, start.x, start.y, 4.2);
}

// The course ribbon & edges, built once per layout: dark drift corridor + white sidelines + apex curbs.
const edges = new WeakMap();
function courseEdges(def) {
  if (edges.has(def.geometry)) return edges.get(def.geometry);
  const { course, corridor, finishS } = def.geometry;
  const left = new Path2D();
  const right = new Path2D();
  const centre = new Path2D();
  const ribbon = new Path2D();
  const insideCurbs = new Path2D();
  const leftPts = [];
  const rightPts = [];
  let inCurb = false;
  course.points.forEach((p, i) => {
    if (p.s > finishS + 12) return;
    const lx = p.x + p.ty * corridor;
    const ly = p.y - p.tx * corridor;
    const rx = p.x - p.ty * corridor;
    const ry = p.y + p.tx * corridor;
    leftPts.push([lx, ly]);
    rightPts.push([rx, ry]);
    if (i === 0) { left.moveTo(lx, ly); right.moveTo(rx, ry); centre.moveTo(p.x, p.y); }
    else { left.lineTo(lx, ly); right.lineTo(rx, ry); centre.lineTo(p.x, p.y); }
    if (Math.abs(p.bend) > 0.015) {
      // Inside apex edge of each bend.
      const ax = p.bend > 0 ? rx : lx;
      const ay = p.bend > 0 ? ry : ly;
      if (!inCurb) { insideCurbs.moveTo(ax, ay); inCurb = true; }
      else insideCurbs.lineTo(ax, ay);
    } else {
      inCurb = false;
    }
  });
  if (leftPts.length) {
    ribbon.moveTo(leftPts[0][0], leftPts[0][1]);
    for (let i = 1; i < leftPts.length; i += 1) ribbon.lineTo(leftPts[i][0], leftPts[i][1]);
    for (let i = rightPts.length - 1; i >= 0; i -= 1) ribbon.lineTo(rightPts[i][0], rightPts[i][1]);
    ribbon.closePath();
  }
  const built = { left, right, centre, ribbon, insideCurbs };
  edges.set(def.geometry, built);
  return built;
}

function gateColor(run, i) {
  const passed = run.gates[i];
  if (passed) return passed.drifting ? GREEN : 'rgba(246,241,228,0.45)';
  if (i === run.nextGate && run.phase === 'running') return CYAN;
  if (i === run.nextGate && run.phase === 'failed') return RED;
  return FAINT;
}

function drawLinked(ctx, def, run, anim, time, still) {
  const { gates, course } = def.geometry;
  const { left, right, centre, ribbon, insideCurbs } = courseEdges(def);

  // Trigger a crisp world ring when a gate is newly crossed.
  if (run.nextGate > anim.lastGate) {
    for (let i = anim.lastGate; i < run.nextGate; i += 1) {
      const g = gates[i];
      const info = run.gates[i];
      if (g) {
        anim.pulses.push({
          x: g.cx, y: g.cy, r0: 2.5, r1: 14, at: time, dur: 0.55,
          color: info?.drifting ? GREEN : '#f6f1e4',
          tag: g.label === 'finish' ? 'FINISH!' : info?.drifting ? 'SIDEWAYS!' : null,
        });
      }
    }
    anim.lastGate = run.nextGate;
  }

  // Shaded drift corridor tarmac + subtle painted apex clipping curbs on bends.
  ctx.fillStyle = run.offCourse && run.phase === 'running' ? 'rgba(130,36,30,0.22)' : 'rgba(20,22,27,0.42)';
  ctx.fill(ribbon);

  ctx.strokeStyle = 'rgba(246,241,228,0.65)';
  ctx.lineWidth = 1.1;
  ctx.stroke(insideCurbs);
  ctx.strokeStyle = 'rgba(214,62,42,0.82)';
  ctx.lineWidth = 1.1;
  ctx.setLineDash([2.4, 2.4]);
  ctx.stroke(insideCurbs);
  ctx.setLineDash([]);

  ctx.strokeStyle = run.offCourse && run.phase === 'running' ? 'rgba(255,90,79,0.9)' : 'rgba(246,241,228,0.62)';
  ctx.lineWidth = 0.42;
  ctx.stroke(left);
  ctx.stroke(right);
  ctx.strokeStyle = 'rgba(255,194,51,0.22)';
  ctx.lineWidth = 0.28;
  ctx.setLineDash([3.5, 5.5]);
  ctx.stroke(centre);
  ctx.setLineDash([]);

  const first = course.points[0];
  drawStartBox(ctx, first.x, first.y, 5.8);

  gates.forEach((gate, i) => {
    const finish = gate.label === 'finish';
    const color = gateColor(run, i);
    const active = i === run.nextGate && run.phase === 'running';
    if (finish) {
      drawCheckeredStrip(ctx, gate.x1, gate.y1, gate.x2, gate.y2, 1.5, color);
    } else {
      if (active) {
        const glow = still ? 0.24 : 0.16 + 0.12 * Math.sin(time * 6.5);
        ctx.strokeStyle = `rgba(52,224,255,${glow.toFixed(3)})`;
        ctx.lineWidth = 2.4;
        line(ctx, gate.x1, gate.y1, gate.x2, gate.y2);
        // Subtle directional chevron just behind the active gate so entry reads at high slip.
        arrow(ctx, gate.cx - gate.tx * 4.5, gate.cy - gate.ty * 4.5, Math.atan2(gate.ty, gate.tx), 5.2, 'rgba(52,224,255,0.62)');
      }
      ctx.strokeStyle = color;
      ctx.lineWidth = active ? 0.65 : 0.42;
      ctx.setLineDash([1.6, 1.1]);
      line(ctx, gate.x1, gate.y1, gate.x2, gate.y2);
      ctx.setLineDash([]);
    }
    // Crisp gate number plaque outside the right-hand cone, clear of the driving line.
    const out = gate.half + 2.8;
    const lx = gate.cx - gate.ty * out;
    const ly = gate.cy + gate.tx * out;
    if (active || finish) {
      ctx.fillStyle = 'rgba(18,19,23,0.72)';
      const bw = finish ? 7.2 : 3.2;
      ctx.beginPath();
      ctx.roundRect(lx - bw / 2, ly - 1.6, bw, 3.2, 0.5);
      ctx.fill();
    }
    label(ctx, finish ? 'FINISH' : gate.label, lx, ly + 0.08, finish ? 1.9 : 2.6, color);
  });
}

// Slalom Sprint: shaded sprint lane, sinusoidal weave hint, pulsing next-cone gate, and chequered finish.
function slalomColor(run, i) {
  if (i < run.next) return GREEN;
  if (i === run.failedAt) return RED;
  if (i === run.next && run.phase === 'running') return CYAN;
  return FAINT;
}

function drawSlalom(ctx, def, run, anim, time, still) {
  const { slalom, finish, lane, start, count, spacing } = def.geometry;
  const first = slalom[0].x;
  const last = slalom[count - 1].x;
  const live = run.phase === 'running';

  if (run.next > anim.lastSlalom) {
    for (let i = anim.lastSlalom; i < run.next; i += 1) {
      const c = slalom[i];
      if (c) {
        anim.pulses.push({ x: c.x, y: c.side * 4.2, r0: 1.5, r1: 8.5, at: time, dur: 0.45, color: GREEN });
      }
    }
    anim.lastSlalom = run.next;
  }

  // Shaded sprint lane tarmac.
  ctx.fillStyle = /^left the lane/.test(run.reason) ? 'rgba(130,36,30,0.22)' : 'rgba(20,22,27,0.38)';
  ctx.fillRect(first - 12, -lane, last - first + 24, lane * 2);

  // Subtle sinusoidal weave guide threading left-right through the seven cones.
  ctx.strokeStyle = 'rgba(255,182,39,0.20)';
  ctx.lineWidth = 0.42;
  ctx.setLineDash([2.4, 2]);
  ctx.beginPath();
  for (let sx = first - 10; sx <= last + 10; sx += 1.5) {
    const sy = Math.cos(((sx - first) / spacing) * Math.PI) * slalom[0].side * 4.4;
    if (sx === first - 10) ctx.moveTo(sx, sy); else ctx.lineTo(sx, sy);
  }
  ctx.stroke();
  ctx.setLineDash([]);

  // The lane's two edges.
  ctx.strokeStyle = /^left the lane/.test(run.reason) ? RED : 'rgba(246,241,228,0.62)';
  ctx.lineWidth = 0.42;
  line(ctx, first - 12, -lane, last + 12, -lane);
  line(ctx, first - 12, lane, last + 12, lane);
  // The line of cones, faintly, so the weave reads as crossing it.
  ctx.strokeStyle = 'rgba(246,241,228,0.14)';
  ctx.lineWidth = 0.25;
  ctx.setLineDash([3, 5]);
  line(ctx, first - 12, 0, last + 12, 0);
  ctx.setLineDash([]);

  drawStartBox(ctx, start.x, 0, 4.2);

  slalom.forEach((cone, i) => {
    const color = slalomColor(run, i);
    const active = i === run.next && live;
    if (active) {
      const glow = still ? 0.16 : 0.11 + 0.08 * Math.sin(time * 7);
      ctx.fillStyle = `rgba(52,224,255,${glow.toFixed(3)})`;
      ctx.fillRect(cone.x - 4.2, cone.side > 0 ? 1.2 : -lane, 8.4, lane - 1.2);
      ctx.strokeStyle = color;
      ctx.lineWidth = 0.58;
      ctx.setLineDash([1.6, 1.1]);
      line(ctx, cone.x, cone.side * 1.2, cone.x, cone.side * lane);
      ctx.setLineDash([]);
    }
    const shift = active && !still ? Math.sin(time * 6) * 0.7 : 0;
    arrow(ctx, cone.x + shift, cone.side * 4.2, 0, active ? 6.6 : 5.8, color);
    // The number sits on the far side, clear of the driving line.
    label(ctx, String(cone.number), cone.x, -cone.side * 3.5, active ? 2.9 : 2.5, color);
  });

  const done = run.next >= count;
  const finishColor = run.phase === 'complete' || (done && live) ? GREEN : run.reason === 'missed the finish' ? RED : FAINT;
  drawCheckeredStrip(ctx, finish.x1, finish.y1, finish.x2, finish.y2, 1.5, finishColor);
  label(ctx, 'FINISH', finish.cx, finish.half + 3.0, 2.0, finishColor);
}

// Called by render.js after the pad is painted and before the skid marks and the car.
export function drawChallenge(ctx, game, view = null, time = 0, still = false) {
  const def = game.challengeDef;
  const run = game.challenge;
  if (!def || !run) return;
  ctx.save();
  ctx.lineCap = 'butt';
  const anim = getAnim(run);
  if (def.layout === 'box') drawPrecision(ctx, def, run, anim, time, still);
  else if (def.layout === 'slalom') drawSlalom(ctx, def, run, anim, time, still);
  else if (def.layout === 'urban') drawUrban(ctx, def, run, game, time || performance.now() / 1000, view);
  else drawLinked(ctx, def, run, anim, time, still);
  if (def.layout !== 'urban') drawPulses(ctx, anim.pulses, time, still);
  drawCones(ctx, run.cones, def.kind === 'time' ? def.geometry.conePenalty : 0, anim, time, still);
  ctx.restore();
}

// Called by render.js inside the minimap's own transform. `px` is one screen pixel in metres.
export function drawChallengeMap(ctx, game, px) {
  const def = game.challengeDef;
  const run = game.challenge;
  if (!def || !run) return;
  ctx.save();
  ctx.lineJoin = 'round';
  if (def.layout === 'urban') drawUrbanMap(ctx, game, px);
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
