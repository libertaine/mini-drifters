// Paints Getaway Drift's city (EXPERIMENTAL, v0.7.0 R4B research) in world coordinates (metres):
//   drawUrban       the ground: pavement, road, markings, the cameras and the escape gate, the
//                   breakables (intact or in pieces), signs, the guidance arrow and the bust ring.
//                   Drawn under the cars.
//   drawUrbanAbove  what stands up: building roofs and their shadows, props, blockade barriers.
//                   Drawn over the cars, so a nose pressed to a wall tucks under the roof line.
//   drawUrbanMap    the minimap.
// Reads the challenge and its run; changes neither. The police cars themselves (the pursuer and
// the parked ones at a blockade) are drawn by render.js, which owns the car artwork.
// R4C adds: the route-aware arrow and its turn call (getaway-nav.js), chevrons on the road at the
// next turn, the smash flash and SMASH +N pop-up, and a minimap that marks the next objective.
import { BREAKABLE } from './getaway-urban.js';
import { cueForGame, easeAngle, turnBearing } from './getaway-nav.js';

// Smash feedback timings (seconds after the hit). Bounded: everything but the resting debris is gone
// within POPUP, and the debris is a fixed handful of pieces per object that stop within about 1 s.
export const SMASH_FX = Object.freeze({ flash: 0.12, burst: 0.3, popup: 1.4, fade: 0.45, rise: 4 });
// The pop-up's opacity and rise (metres) `tau` seconds after the smash; null once it is gone.
export function popupAt(tau, fx = SMASH_FX) {
  if (!(tau >= 0) || tau >= fx.popup) return null;
  const alpha = tau > fx.popup - fx.fade ? (fx.popup - tau) / fx.fade : 1;
  return { alpha, rise: fx.rise * (1 - Math.exp(-3 * tau)) };
}

const AMBER = '#ffb627';
const GREEN = '#5fd38a';
const RED = '#ff5a4f';
const CYAN = '#34e0ff';
const FAINT = 'rgba(246,241,228,0.28)';
const LABEL_FONT = 'Impact, Haettenschweiler, "Arial Narrow Bold", sans-serif';

const STYLE = {
  downtown: {
    sidewalk: '#7b7973', curb: 'rgba(214,210,200,0.55)', road: '#36383d', dash: 'rgba(246,241,228,0.38)',
    zebra: 'rgba(246,241,228,0.32)', roofs: ['#4d525d', '#5b5650', '#4a5754', '#5d5a52', '#53505c', '#585e66'],
    parapet: 'rgba(255,255,255,0.10)', edge: 'rgba(0,0,0,0.35)',
  },
  industrial: {
    sidewalk: '#6a6862', curb: 'rgba(255,196,64,0.0)', road: '#4c4c48', dash: 'rgba(255,196,64,0.55)',
    zebra: 'rgba(255,196,64,0.3)', roofs: ['#6f787b', '#7a7468', '#68716a', '#747b80'],
    parapet: 'rgba(255,255,255,0.08)', edge: 'rgba(0,0,0,0.3)',
  },
};
const CONTAINERS = ['#94684e', '#597477', '#7e805b', '#6b5d7a', '#3f6b8a'];

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

// A small integer hash of a box, for steady per-building colours and details.
const hash = (b) => {
  let h = Math.imul(Math.round(b.minX * 7 + b.maxY * 13), 2654435761) ^ Math.round(b.maxX * 3 + b.minY * 5);
  h = Math.imul(h ^ (h >>> 15), 2246822519);
  return (h ^ (h >>> 13)) >>> 0;
};

const visible = (b, v, pad = 4) => b.maxX >= v.x - v.hw - pad && b.minX <= v.x + v.hw + pad && b.maxY >= v.y - v.hh - pad && b.minY <= v.y + v.hh + pad;

// --- Static paths, built once per city ---------------------------------------------------------------
const cache = new WeakMap();
function pathsFor(city) {
  if (cache.has(city)) return cache.get(city);
  const S = STYLE[city.style];
  const pavement = new Path2D();
  for (const r of city.paved) pavement.rect(r.minX, r.minY, r.maxX - r.minX, r.maxY - r.minY);
  // The road: each street's rectangle less its sidewalks, and each junction's square less the
  // widest sidewalk at it.
  const road = new Path2D();
  for (const e of city.edges) {
    const h = e.half - e.sidewalk;
    if (e.horizontal) road.rect(Math.min(e.ax, e.bx), e.ay - h, Math.abs(e.bx - e.ax), 2 * h);
    else road.rect(e.ax - h, Math.min(e.ay, e.by), 2 * h, Math.abs(e.by - e.ay));
  }
  for (const n of Object.values(city.nodes)) {
    const roadHalf = Math.max(...n.edges.map((i) => city.edges[i].half - city.edges[i].sidewalk));
    road.rect(n.x - roadHalf, n.y - roadHalf, 2 * roadHalf, 2 * roadHalf);
  }
  // Centre-line dashes, between the junction squares.
  const dashes = new Path2D();
  const zebra = new Path2D();
  for (const e of city.edges) {
    if (e.kind === 'alley' || e.kind === 'lane' || e.kind === 'yard') continue;
    const A = city.nodes[e.a];
    const B = city.nodes[e.b];
    const from = A.half + 2;
    const to = e.len - B.half - 2;
    for (let d = from; d < to; d += 7) {
      const d2 = Math.min(to, d + 3);
      dashes.moveTo(e.ax + e.dx * d, e.ay + e.dy * d);
      dashes.lineTo(e.ax + e.dx * d2, e.ay + e.dy * d2);
    }
    // Crosswalks at busy junctions (three streets or more), across the road just outside the square.
    if (city.style !== 'downtown') continue;
    for (const [N, sign, base] of [[A, 1, 0], [B, -1, e.len]]) {
      if (N.edges.length < 3) continue;
      const at = base + sign * (N.half + 1.8);
      const cx = e.ax + e.dx * at;
      const cy = e.ay + e.dy * at;
      const h = e.half - e.sidewalk - 0.6;
      for (let k = -h; k <= h; k += 1.3) {
        // A stripe 0.6 m wide, 3 m long along the street.
        const px = cx + -e.dy * k;
        const py = cy + e.dx * k;
        zebra.moveTo(px - e.dx * 1.5, py - e.dy * 1.5);
        zebra.lineTo(px + e.dx * 1.5, py + e.dy * 1.5);
      }
    }
  }
  const built = { S, pavement, road, dashes, zebra };
  cache.set(city, built);
  return built;
}

// --- Cameras and the escape gate (R4's art) -------------------------------------------------------------
function cameraColor(run, i) {
  if (run.cameras[i]) return GREEN;
  if (i === run.nextCamera && run.phase === 'running') return run.missed[i] ? RED : AMBER;
  if (i === run.nextCamera && run.phase === 'failed') return RED;
  return FAINT;
}

function drawCamera(ctx, cam, color, active, time) {
  ctx.fillStyle = active ? 'rgba(255,182,39,0.12)' : color === GREEN ? 'rgba(95,211,138,0.07)' : 'rgba(246,241,228,0.03)';
  ctx.beginPath();
  ctx.moveTo(cam.x, cam.y);
  ctx.lineTo(cam.x1 + cam.tx * 3, cam.y1 + cam.ty * 3);
  ctx.lineTo(cam.x2 + cam.tx * 3, cam.y2 + cam.ty * 3);
  ctx.closePath();
  ctx.fill();
  ctx.strokeStyle = color;
  ctx.lineWidth = active ? 0.7 : 0.45;
  ctx.setLineDash([1.6, 1.1]);
  line(ctx, cam.x1, cam.y1, cam.x2, cam.y2);
  ctx.setLineDash([]);
  // Which way it films: a small arrow on the band.
  ctx.save();
  ctx.translate(cam.cx, cam.cy);
  ctx.rotate(Math.atan2(cam.ty, cam.tx));
  ctx.strokeStyle = color;
  ctx.lineWidth = 0.4;
  ctx.beginPath();
  ctx.moveTo(-1.2, -1.6);
  ctx.lineTo(0.6, 0);
  ctx.lineTo(-1.2, 1.6);
  ctx.stroke();
  ctx.restore();
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
  ctx.fillRect(0.9, -0.45, 0.7, 0.9);
  if (active && Math.floor(time * 2.5) % 2 === 0) {
    ctx.fillStyle = RED;
    ctx.beginPath();
    ctx.arc(-0.6, -0.35, 0.28, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
  label(ctx, `CAM ${cam.number}`, cam.x - Math.cos(cam.aim) * 3.2, cam.y - Math.sin(cam.aim) * 3.2, 2.2, color);
}

// --- Breakables -----------------------------------------------------------------------------------------
// The pieces of a smashed thing fly the way it was hit and slide to rest within about a second:
// worked out from the moment and direction of the hit, so they are the same every frame, belong to
// the run (a restart restores the intact object) and cost nothing once they stop.
const FRUIT = ['#f08a24', '#7cc24a', '#e2412f', '#f3c43d', '#f08a24', '#b64fd0'];
function pieces(br, hit, count) {
  const out = [];
  let seed = (br.index + 1) * 9301;
  const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
  const speed = Math.max(4, hit.speed);
  const dirLen = Math.hypot(hit.vx, hit.vy) || 1;
  const ux = hit.vx / dirLen;
  const uy = hit.vy / dirLen;
  for (let i = 0; i < count; i += 1) {
    const x0 = br.minX + rnd() * (br.maxX - br.minX);
    const y0 = br.minY + rnd() * (br.maxY - br.minY);
    const along = speed * (0.35 + rnd() * 0.5);
    const side = speed * (rnd() - 0.5) * 0.9;
    out.push({ x0, y0, vx: ux * along - uy * side, vy: uy * along + ux * side, spin: (rnd() - 0.5) * 12, size: 0.25 + rnd() * 0.35, k: i });
  }
  return out;
}
const debrisCache = new WeakMap();
function debrisOf(br, hit) {
  if (!debrisCache.has(hit)) debrisCache.set(hit, pieces(br, hit, BREAKABLE[br.kind].pieces));
  return debrisCache.get(hit);
}
const settle = (v0, tau, k = 3.2) => (v0 * (1 - Math.exp(-k * tau))) / k;

function drawFruitStand(ctx, b) {
  const w = b.maxX - b.minX;
  const h = b.maxY - b.minY;
  ctx.fillStyle = '#7a4f28';
  ctx.fillRect(b.minX, b.minY, w, h);
  // The striped awning over half of it, then the fruit.
  const n = 6;
  for (let i = 0; i < n; i += 1) {
    ctx.fillStyle = i % 2 ? '#f6f1e4' : '#d93a2b';
    if (w > h) ctx.fillRect(b.minX + (w / n) * i, b.minY, w / n, h * 0.45);
    else ctx.fillRect(b.minX, b.minY + (h / n) * i, w * 0.45, h / n);
  }
  for (let i = 0; i < 10; i += 1) {
    ctx.fillStyle = FRUIT[i % FRUIT.length];
    const fx = w > h ? b.minX + 0.3 + ((i * 0.53) % (w - 0.6)) : b.minX + w * 0.55 + ((i * 0.37) % (w * 0.4));
    const fy = w > h ? b.minY + h * 0.55 + ((i * 0.31) % (h * 0.4)) : b.minY + 0.3 + ((i * 0.53) % (h - 0.6));
    ctx.beginPath();
    ctx.arc(fx, fy, 0.22, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.strokeStyle = 'rgba(0,0,0,0.45)';
  ctx.lineWidth = 0.12;
  ctx.strokeRect(b.minX, b.minY, w, h);
}

function drawBarricade(ctx, b) {
  const w = b.maxX - b.minX;
  const h = b.maxY - b.minY;
  const long = Math.max(w, h);
  // Orange and white boards on light posts: plainly not concrete.
  ctx.save();
  ctx.beginPath();
  ctx.rect(b.minX, b.minY, w, h);
  ctx.clip();
  ctx.fillStyle = '#f6f1e4';
  ctx.fillRect(b.minX, b.minY, w, h);
  ctx.strokeStyle = '#f2542d';
  ctx.lineWidth = 0.55;
  for (let d = -long; d < long * 2; d += 1.4) {
    if (w > h) line(ctx, b.minX + d, b.maxY, b.minX + d + h, b.minY);
    else line(ctx, b.minX, b.minY + d, b.maxX, b.minY + d + w);
  }
  ctx.restore();
  ctx.fillStyle = '#8a6a44';
  const posts = 3;
  for (let i = 0; i < posts; i += 1) {
    const f = (i + 0.5) / posts;
    if (w > h) ctx.fillRect(b.minX + w * f - 0.2, b.minY - 0.15, 0.4, h + 0.3);
    else ctx.fillRect(b.minX - 0.15, b.minY + h * f - 0.2, w + 0.3, 0.4);
  }
}

function drawBroken(ctx, br, hit, time) {
  const tau = Math.max(0, time - hit.time);
  // A white flash, then a brief burst where it was hit.
  if (tau < SMASH_FX.flash) {
    ctx.fillStyle = `rgba(255,248,230,${0.75 * (1 - tau / SMASH_FX.flash)})`;
    ctx.beginPath();
    ctx.arc(br.cx, br.cy, 3.2, 0, Math.PI * 2);
    ctx.fill();
  }
  if (tau < SMASH_FX.burst) {
    ctx.strokeStyle = `rgba(255,182,39,${0.8 * (1 - tau / SMASH_FX.burst)})`;
    ctx.lineWidth = 0.4;
    ctx.beginPath();
    ctx.arc(br.cx, br.cy, 1.5 + tau * 14, 0, Math.PI * 2);
    ctx.stroke();
  }
  // What is left where it stood.
  ctx.fillStyle = br.kind === 'fruit' ? 'rgba(122,79,40,0.55)' : 'rgba(138,106,68,0.5)';
  for (const s of [0.2, 0.7]) ctx.fillRect(br.minX + (br.maxX - br.minX) * s, br.minY + (br.maxY - br.minY) * s, 0.5, 0.5);
  for (const p of debrisOf(br, hit)) {
    const x = p.x0 + settle(p.vx, tau);
    const y = p.y0 + settle(p.vy, tau);
    if (br.kind === 'fruit') {
      ctx.fillStyle = p.k % 5 === 0 ? '#7a4f28' : p.k % 7 === 0 ? (p.k % 2 ? '#d93a2b' : '#f6f1e4') : FRUIT[p.k % FRUIT.length];
      if (p.k % 5 === 0 || p.k % 7 === 0) {
        ctx.save();
        ctx.translate(x, y);
        ctx.rotate(settle(p.spin, tau));
        ctx.fillRect(-0.45, -0.3, 0.9, 0.6);
        ctx.restore();
      } else {
        ctx.beginPath();
        ctx.arc(x, y, p.size * 0.8, 0, Math.PI * 2);
        ctx.fill();
      }
    } else {
      ctx.save();
      ctx.translate(x, y);
      ctx.rotate(settle(p.spin, tau) + p.k);
      ctx.fillStyle = p.k % 2 ? '#f2542d' : '#f6f1e4';
      ctx.fillRect(-1.1, -0.22, 2.2, 0.44);
      ctx.restore();
    }
  }
}

// SMASH +N, rising from the wreck and fading (the player's smashes only: the police earns nothing).
function drawPopup(ctx, br, hit, time) {
  if (!(hit.bonus > 0)) return;
  const pop = popupAt(time - hit.time);
  if (!pop) return;
  ctx.save();
  ctx.globalAlpha = pop.alpha;
  ctx.font = `2.6px ${LABEL_FONT}`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.lineWidth = 0.5;
  ctx.strokeStyle = 'rgba(19,20,23,0.85)';
  const text = `SMASH +${hit.bonus}`;
  ctx.strokeText(text, br.cx, br.cy - 3 - pop.rise);
  ctx.fillStyle = GREEN;
  ctx.fillText(text, br.cx, br.cy - 3 - pop.rise);
  ctx.restore();
}

// --- Props, buildings, blockades -----------------------------------------------------------------------
function drawProp(ctx, p) {
  const w = p.maxX - p.minX;
  const h = p.maxY - p.minY;
  switch (p.kind) {
    case 'container': {
      const col = CONTAINERS[p.color % CONTAINERS.length];
      ctx.fillStyle = col;
      ctx.fillRect(p.minX, p.minY, w, h);
      // Stacked boxes, ribbed.
      ctx.strokeStyle = 'rgba(0,0,0,0.28)';
      ctx.lineWidth = 0.15;
      const long = w > h;
      const unit = 6;
      for (let d = unit; d < (long ? w : h) - 0.5; d += unit) {
        if (long) line(ctx, p.minX + d, p.minY, p.minX + d, p.maxY);
        else line(ctx, p.minX, p.minY + d, p.maxX, p.minY + d);
      }
      ctx.strokeStyle = 'rgba(255,255,255,0.12)';
      for (let d = 0.6; d < (long ? h : w); d += 0.6) {
        if (long) line(ctx, p.minX, p.minY + d, p.maxX, p.minY + d);
        else line(ctx, p.minX + d, p.minY, p.minX + d, p.maxY);
      }
      break;
    }
    case 'truck':
    case 'trailer':
    case 'van': {
      const long = w > h;
      ctx.fillStyle = p.kind === 'van' ? '#c9ccd3' : '#d8d2c2';
      ctx.fillRect(p.minX, p.minY, w, h);
      if (p.kind === 'truck') {
        ctx.fillStyle = '#2f5d8a';
        if (long) ctx.fillRect(p.maxX - 3.2, p.minY, 3.2, h); else ctx.fillRect(p.minX, p.maxY - 3.2, w, 3.2);
        ctx.fillStyle = '#1d2c3b';
        if (long) ctx.fillRect(p.maxX - 1.1, p.minY + 0.4, 0.7, h - 0.8); else ctx.fillRect(p.minX + 0.4, p.maxY - 1.1, w - 0.8, 0.7);
      } else if (p.kind === 'van') {
        ctx.fillStyle = '#1d2c3b';
        ctx.fillRect(p.maxX - 1.4, p.minY + 0.3, 0.8, h - 0.6);
      }
      ctx.strokeStyle = 'rgba(0,0,0,0.4)';
      ctx.lineWidth = 0.15;
      ctx.strokeRect(p.minX, p.minY, w, h);
      break;
    }
    case 'barrier':
      ctx.fillStyle = '#b9b5ab';
      ctx.fillRect(p.minX, p.minY, w, h);
      ctx.strokeStyle = 'rgba(0,0,0,0.35)';
      ctx.lineWidth = 0.12;
      for (let d = 2; d < Math.max(w, h); d += 2) {
        if (w > h) line(ctx, p.minX + d, p.minY, p.minX + d, p.maxY); else line(ctx, p.minX, p.minY + d, p.maxX, p.minY + d);
      }
      ctx.strokeRect(p.minX, p.minY, w, h);
      break;
    case 'dumpster':
      ctx.fillStyle = '#2f6b4a';
      ctx.fillRect(p.minX, p.minY, w, h);
      ctx.fillStyle = 'rgba(0,0,0,0.3)';
      ctx.fillRect(p.minX + 0.2, p.minY + 0.2, w - 0.4, h - 0.4);
      break;
    case 'kiosk':
      ctx.fillStyle = '#3b4c63';
      ctx.fillRect(p.minX, p.minY, w, h);
      ctx.fillStyle = AMBER;
      ctx.fillRect(p.minX, p.minY, w, 0.5);
      break;
    case 'planter':
      ctx.fillStyle = '#8a8478';
      ctx.fillRect(p.minX, p.minY, w, h);
      ctx.fillStyle = '#3f8a47';
      ctx.beginPath();
      ctx.arc(p.minX + w / 2, p.minY + h / 2, Math.min(w, h) * 0.38, 0, Math.PI * 2);
      ctx.fill();
      break;
    case 'crates':
      ctx.fillStyle = '#9a7646';
      ctx.fillRect(p.minX, p.minY, w, h);
      ctx.strokeStyle = 'rgba(0,0,0,0.35)';
      ctx.lineWidth = 0.12;
      line(ctx, p.minX, p.minY, p.maxX, p.maxY);
      line(ctx, p.maxX, p.minY, p.minX, p.maxY);
      ctx.strokeRect(p.minX, p.minY, w, h);
      break;
    default:
      ctx.fillStyle = '#777';
      ctx.fillRect(p.minX, p.minY, w, h);
  }
}

// The concrete blocks of a blockade; render.js parks the two police cars behind them.
function drawBlockade(ctx, bl, time) {
  const n = Math.max(3, Math.round((bl.half * 2) / 3));
  for (let i = 0; i < n; i += 1) {
    const f0 = i / n;
    const f1 = (i + 1) / n - 0.06;
    ctx.fillStyle = i % 2 ? '#c9c4b8' : '#b3aea3';
    if (bl.horizontal) ctx.fillRect(bl.minX + 0.6, bl.minY + (bl.maxY - bl.minY) * f0, (bl.maxX - bl.minX) - 1.2, (bl.maxY - bl.minY) * (f1 - f0));
    else ctx.fillRect(bl.minX + (bl.maxX - bl.minX) * f0, bl.minY + 0.6, (bl.maxX - bl.minX) * (f1 - f0), (bl.maxY - bl.minY) - 1.2);
  }
  // Red and white reflective chevrons on its face.
  ctx.fillStyle = Math.floor(time * 3) % 2 ? 'rgba(255,90,79,0.9)' : 'rgba(255,90,79,0.55)';
  const cx = (bl.minX + bl.maxX) / 2;
  const cy = (bl.minY + bl.maxY) / 2;
  if (bl.horizontal) ctx.fillRect(cx - 0.3, bl.minY + 1, 0.6, bl.maxY - bl.minY - 2);
  else ctx.fillRect(bl.minX + 1, cy - 0.3, bl.maxX - bl.minX - 2, 0.6);
}

// Where the parked police cars of a blockade stand: two, nose to nose, on the far side of the blocks.
export function blockadeCars(city) {
  return city.blockades.flatMap((bl) => {
    const back = 4.6;
    const bx = bl.cx + bl.dx * back;
    const by = bl.cy + bl.dy * back;
    const across = Math.atan2(bl.dx, -bl.dy);   // perpendicular to the street
    const off = bl.half * 0.42;
    const nx = -bl.dy;
    const ny = bl.dx;
    return [
      { x: bx + nx * off, y: by + ny * off, heading: across + Math.PI + 0.35 },
      { x: bx - nx * off, y: by - ny * off, heading: across - 0.35 },
    ];
  });
}

function drawSign(ctx, sign, time) {
  const text = sign.text;
  const w = text.length * 1.05 + 1.6;
  ctx.fillStyle = 'rgba(19,20,23,0.88)';
  ctx.beginPath();
  ctx.roundRect(sign.x - w / 2, sign.y - 1.5, w, 3, 0.4);
  ctx.fill();
  ctx.strokeStyle = sign.text === 'NO EXIT' ? AMBER : RED;
  ctx.lineWidth = 0.25;
  ctx.stroke();
  label(ctx, text, sign.x, sign.y + 0.1, 2, sign.text === 'NO EXIT' ? AMBER : (Math.floor(time * 2) % 2 ? RED : '#ff8f87'));
}

// --- Guidance (R4C) ----------------------------------------------------------------------------------
// The arrow by the car: R4B's chevron aimed 14 m along the route, which turned only at the corner
// itself. Now (getaway-nav.js navCue):
//   - it aims 18-50 m along the route (further at speed), at a point the car can see, so it leans
//     into a turn as the junction opens up and never points through a building;
//   - once the next turn is within notice (70 m, or 3.5 s at speed) and still more than 24 m off, it
//     becomes a bent turn arrow with the distance beside it; a U for turning round;
//   - its bearing is eased (about 0.12 s), so it never snaps or flickers.
// Display state only (per run, in this page): nothing here is run data.
const shown = new WeakMap();
const ARROW = Object.freeze({ gap: 8.5, bendFrom: 24 });
function arrowColor(run) {
  return run.exitOpen ? 'rgba(95,211,138,0.92)' : run.missed.some(Boolean) ? 'rgba(255,90,79,0.92)' : 'rgba(255,182,39,0.92)';
}

function drawStraightArrow(ctx) {
  ctx.beginPath();
  ctx.moveTo(2.4, 0);
  ctx.lineTo(-1.5, -2);
  ctx.lineTo(-0.7, 0);
  ctx.lineTo(-1.5, 2);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
}

// A turn arrow, drawn heading +x: a shaft, then a bend of 90 degrees to `side` (+1 right, -1 left),
// or a U for turning round.
function drawTurnArrow(ctx, side, around) {
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.beginPath();
  if (around) {
    ctx.moveTo(-1.6, -1.4);
    ctx.lineTo(1, -1.4);
    ctx.arc(1, 0, 1.4, -Math.PI / 2, Math.PI / 2, false);
    ctx.lineTo(-0.4, 1.4);
  } else {
    ctx.moveTo(-2, 0);
    ctx.lineTo(0.4, 0);
    ctx.quadraticCurveTo(1.6, 0, 1.6, side * 1.3);
  }
  const end = around ? [-0.4, 1.4, Math.PI] : [1.6, side * 1.3, side * Math.PI / 2];
  ctx.lineWidth = 1.5;
  ctx.strokeStyle = 'rgba(19,20,23,0.8)';
  ctx.stroke();
  ctx.lineWidth = 0.9;
  ctx.strokeStyle = ctx.fillStyle;
  ctx.stroke();
  // The head.
  ctx.save();
  ctx.translate(end[0], end[1]);
  ctx.rotate(end[2]);
  ctx.beginPath();
  ctx.moveTo(1.4, 0);
  ctx.lineTo(-0.5, -1.3);
  ctx.lineTo(-0.5, 1.3);
  ctx.closePath();
  ctx.strokeStyle = 'rgba(19,20,23,0.8)';
  ctx.lineWidth = 0.3;
  ctx.fill();
  ctx.stroke();
  ctx.restore();
}

function drawGuideArrow(ctx, run, game) {
  const cue = cueForGame(game);
  if (!cue) return;
  const car = game.car;
  const now = performance.now() / 1000;
  const state = shown.get(run) ?? { dir: null, at: now, turn: null };
  const dt = Math.min(0.1, Math.max(0, now - state.at));
  state.at = now;
  const turn = cue.around ? { side: 'around', in: 0, from: car.heading }
    : cue.announce && cue.announce.in > ARROW.bendFrom ? cue.announce : null;
  // The arrow sits ahead of the car along where it is heading; it shows the aim, or the coming turn
  // on the leg it leads from.
  const target = turn ? turnBearing(cue, car) : cue.dir;
  state.dir = easeAngle(state.dir, target, dt);
  shown.set(run, state);
  const ax = car.x + Math.cos(state.dir) * ARROW.gap;
  const ay = car.y + Math.sin(state.dir) * ARROW.gap;
  ctx.save();
  ctx.translate(ax, ay);
  ctx.rotate(state.dir);
  ctx.fillStyle = arrowColor(run);
  ctx.strokeStyle = 'rgba(19,20,23,0.75)';
  ctx.lineWidth = 0.3;
  if (turn) drawTurnArrow(ctx, turn.side === 'left' ? -1 : 1, turn.side === 'around');
  else drawStraightArrow(ctx);
  ctx.restore();
  // The distance to the turn, beside the arrow (rounded to 10 m, so it counts down calmly).
  if (turn && turn.side !== 'around') {
    const nx = -Math.sin(state.dir) * (turn.side === 'left' ? 1 : -1);
    const ny = Math.cos(state.dir) * (turn.side === 'left' ? 1 : -1);
    ctx.save();
    ctx.font = `2.2px ${LABEL_FONT}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.lineWidth = 0.45;
    ctx.strokeStyle = 'rgba(19,20,23,0.85)';
    const text = `${Math.max(10, Math.round(turn.in / 10) * 10)} m`;
    ctx.strokeText(text, ax + nx * 3.4, ay + ny * 3.4);
    ctx.fillStyle = arrowColor(run);
    ctx.fillText(text, ax + nx * 3.4, ay + ny * 3.4);
    ctx.restore();
  }
}

// Chevrons painted across the junction of the next turn, pointing the way out of it: as soon as
// the junction is on screen, the exit to take is marked on the road itself.
function drawTurnChevrons(ctx, run, game, time) {
  const cue = cueForGame(game);
  const t = cue?.turn;
  if (!t || t.side === 'around' || t.in > 140) return;
  ctx.save();
  ctx.translate(t.x, t.y);
  ctx.rotate(t.to);
  const pulse = 0.55 + 0.35 * Math.sin(time * 6);
  ctx.strokeStyle = run.exitOpen ? `rgba(95,211,138,${pulse})` : `rgba(255,182,39,${pulse})`;
  ctx.lineWidth = 0.9;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  for (const d of [-2.5, 1, 4.5]) {
    ctx.beginPath();
    ctx.moveTo(d - 1.6, -2.4);
    ctx.lineTo(d, 0);
    ctx.lineTo(d - 1.6, 2.4);
    ctx.stroke();
  }
  ctx.restore();
}

// --- Entry points -----------------------------------------------------------------------------------------
export function drawUrban(ctx, def, run, game, time, view) {
  const { city } = def.geometry;
  const { S, pavement, road, dashes, zebra } = pathsFor(city);
  // Under everything: the city's own ground (where the buildings stand, the roofs cover it).
  const b = city.bounds;
  ctx.fillStyle = '#26282c';
  ctx.fillRect(b.minX, b.minY, b.maxX - b.minX, b.maxY - b.minY);
  ctx.fillStyle = S.sidewalk;
  ctx.fill(pavement);
  ctx.fillStyle = S.road;
  ctx.fill(road);
  ctx.strokeStyle = S.dash;
  ctx.lineWidth = city.style === 'industrial' ? 0.35 : 0.3;
  ctx.stroke(dashes);
  ctx.strokeStyle = S.zebra;
  ctx.lineWidth = 0.6;
  ctx.stroke(zebra);
  // The container yard's painted bays.
  if (city.style === 'industrial') {
    const yard = city.edges.find((e) => e.kind === 'yard');
    if (yard) {
      ctx.strokeStyle = 'rgba(255,196,64,0.22)';
      ctx.lineWidth = 0.25;
      for (let d = 30; d < yard.len - 30; d += 8) {
        const x = yard.ax + yard.dx * d;
        line(ctx, x, yard.ay - yard.half + 1, x, yard.ay - yard.half + 6);
        line(ctx, x, yard.ay + yard.half - 6, x, yard.ay + yard.half - 1);
      }
    }
  }
  // Dead ends: hatching across the closed end.
  for (const e of city.edges) {
    if (e.kind !== 'deadend') continue;
    const end = city.nodes[e.b].edges.length === 1 ? e.b : e.a;
    const N = city.nodes[end];
    ctx.strokeStyle = 'rgba(255,182,39,0.35)';
    ctx.lineWidth = 0.4;
    for (let k = -e.half + 1; k < e.half; k += 2) {
      const sx = N.x + -e.dy * k;
      const sy = N.y + e.dx * k;
      line(ctx, sx - e.dx * 1.5, sy - e.dy * 1.5, sx + e.dx * 1.5 + -e.dy * 1.5, sy + e.dy * 1.5 + e.dx * 1.5);
    }
  }

  // The breakables.
  for (const br of city.breakables) {
    const hit = run.broken[br.index];
    if (hit) drawBroken(ctx, br, hit, run.time);
    else if (br.kind === 'fruit') drawFruitStand(ctx, br);
    else drawBarricade(ctx, br);
  }

  // Cameras and the escape gate.
  city.cameras.forEach((cam, i) => drawCamera(ctx, cam, cameraColor(run, i), i === run.nextCamera && run.phase === 'running', time));
  const exit = city.exit;
  const open = run.exitOpen;
  const color = run.phase === 'complete' || open ? GREEN : RED;
  ctx.strokeStyle = color;
  ctx.lineWidth = 1;
  ctx.setLineDash([1, 1]);
  line(ctx, exit.x1, exit.y1, exit.x2, exit.y2);
  ctx.setLineDash([]);
  label(ctx, open || run.phase === 'complete' ? 'ESCAPE' : `ESCAPE · LOCKED ${run.nextCamera}/${city.cameras.length}`,
    exit.cx + exit.tx * 5, exit.cy + exit.ty * 5, 2.4, color);

  for (const sign of city.signs) drawSign(ctx, sign, time);

  // The guidance, while the run is on: chevrons at the next turn, and the arrow by the car.
  if (run.phase === 'running' && game) {
    drawTurnChevrons(ctx, run, game, time);
    drawGuideArrow(ctx, run, game);
  }

  // The ring the police car arrests within (solid while it is close and can see you).
  const p = run.pursuer;
  const r = def.captureModel.radius;
  const inside = run.gap < r && run.sees && run.phase === 'running';
  ctx.strokeStyle = inside ? `rgba(255,90,79,${0.5 + 0.4 * run.meter})` : 'rgba(255,90,79,0.2)';
  ctx.lineWidth = inside ? 0.55 : 0.3;
  ctx.setLineDash(inside ? [] : [1.2, 1.2]);
  ctx.beginPath();
  ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
  ctx.stroke();
  ctx.setLineDash([]);
}

export function drawUrbanAbove(ctx, def, run, view, time) {
  const { city } = def.geometry;
  const S = STYLE[city.style];
  // Beyond the bounds the town carries on: one roof colour out to the edge of the view.
  const B = city.bounds;
  ctx.fillStyle = S.roofs[0];
  const far = 400;
  ctx.fillRect(B.minX - far, B.minY - far, B.maxX - B.minX + 2 * far, far);
  ctx.fillRect(B.minX - far, B.maxY, B.maxX - B.minX + 2 * far, far);
  ctx.fillRect(B.minX - far, B.minY, far, B.maxY - B.minY);
  ctx.fillRect(B.maxX, B.minY, far, B.maxY - B.minY);
  const roofs = city.buildings.filter((b) => visible(b, view, 6));
  // Shadows to the south-east, over the street (and over a car beside the wall).
  ctx.fillStyle = 'rgba(0,0,0,0.26)';
  for (const b of roofs) ctx.fillRect(b.minX + 1.2, b.minY + 1.8, b.maxX - b.minX, b.maxY - b.minY);
  for (const b of roofs) {
    const h = hash(b);
    const w = b.maxX - b.minX;
    const d = b.maxY - b.minY;
    ctx.fillStyle = S.roofs[h % S.roofs.length];
    ctx.fillRect(b.minX, b.minY, w, d);
    if (w < 4 || d < 4) continue;
    // Parapet and roof detail.
    ctx.strokeStyle = S.parapet;
    ctx.lineWidth = 0.5;
    ctx.strokeRect(b.minX + 0.9, b.minY + 0.9, w - 1.8, d - 1.8);
    if (city.style === 'industrial') {
      ctx.strokeStyle = 'rgba(0,0,0,0.13)';
      ctx.lineWidth = 0.2;
      if (w > d) for (let y = b.minY + 2; y < b.maxY - 1; y += 2.2) line(ctx, b.minX + 1, y, b.maxX - 1, y);
      else for (let x = b.minX + 2; x < b.maxX - 1; x += 2.2) line(ctx, x, b.minY + 1, x, b.maxY - 1);
    } else if (w > 14 && d > 14) {
      ctx.fillStyle = 'rgba(0,0,0,0.2)';
      for (let k = 0; k < 3; k += 1) {
        const ux = b.minX + 3 + ((h >>> (k * 5)) % Math.max(1, Math.floor(w - 8)));
        const uy = b.minY + 3 + ((h >>> (k * 7 + 3)) % Math.max(1, Math.floor(d - 8)));
        ctx.fillRect(ux, uy, 2.4, 1.6);
      }
    }
    ctx.strokeStyle = S.edge;
    ctx.lineWidth = 0.3;
    ctx.strokeRect(b.minX, b.minY, w, d);
  }
  for (const p of city.props) if (visible(p, view)) drawProp(ctx, p);
  for (const bl of city.blockades) if (visible(bl, view, 10)) drawBlockade(ctx, bl, time);
  // SMASH +N pop-ups, over the roofs so a building beside the stand never hides one.
  for (const br of city.breakables) {
    const hit = run.broken[br.index];
    if (hit) drawPopup(ctx, br, hit, run.time);
  }
}

// Inside the minimap's own transform. `px` is one screen pixel in metres.
export function drawUrbanMap(ctx, game, px) {
  const def = game.challengeDef;
  const run = game.challenge;
  const { city } = def.geometry;
  ctx.strokeStyle = 'rgba(246,241,228,0.55)';
  ctx.lineCap = 'butt';
  for (const e of city.edges) {
    ctx.lineWidth = Math.max(2 * px, e.width * 0.55);
    line(ctx, e.ax, e.ay, e.bx, e.by);
  }
  // A barricade shortcut, when smashing through would save real distance: offered, dashed, faint.
  const alt = run.shortcut?.points;
  if (alt && run.phase === 'running') {
    ctx.strokeStyle = 'rgba(242,84,45,0.75)';
    ctx.lineWidth = 1.6 * px;
    ctx.setLineDash([3 * px, 3 * px]);
    ctx.beginPath();
    alt.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
    ctx.stroke();
    ctx.setLineDash([]);
  }
  // The way to the next objective (and, faint, on to the one after it).
  const pts = run.guide?.points;
  const ahead = run.guide?.ahead;
  if (pts && ahead?.length && run.phase === 'running') {
    ctx.strokeStyle = 'rgba(255,182,39,0.35)';
    ctx.lineWidth = 1.6 * px;
    ctx.beginPath();
    [pts[pts.length - 1], ...ahead].forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
    ctx.stroke();
  }
  if (pts && run.phase === 'running') {
    ctx.strokeStyle = run.exitOpen ? 'rgba(95,211,138,0.95)' : 'rgba(255,182,39,0.95)';
    ctx.lineWidth = 2.6 * px;
    ctx.beginPath();
    pts.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
    ctx.stroke();
  }
  // Closed streets.
  for (const bl of city.blockades) {
    ctx.fillStyle = RED;
    ctx.fillRect(bl.cx - 4 * px, bl.cy - 4 * px, 8 * px, 8 * px);
  }
  for (const br of city.breakables) {
    if (br.kind !== 'barricade' || run.broken[br.index]) continue;
    ctx.fillStyle = '#f2542d';
    ctx.fillRect(br.cx - 2.5 * px, br.cy - 2.5 * px, 5 * px, 5 * px);
  }
  // R4C: the next objective stands out: bigger, numbered, ringed, and for 2.5 s after a camera is
  // filmed (or missed) a ring sweeps in on it. Filmed cameras are green, later ones faint.
  const now = performance.now() / 1000;
  const live = run.phase === 'running';
  const sweep = live ? run.time - run.objectiveAt : Infinity;
  const ring = (x, y, color) => {
    ctx.strokeStyle = color;
    ctx.lineWidth = 1.6 * px;
    ctx.beginPath();
    ctx.arc(x, y, (7.5 + 1.5 * Math.sin(now * 5)) * px, 0, Math.PI * 2);
    ctx.stroke();
    if (sweep < 2.5) {
      ctx.globalAlpha = 1 - sweep / 2.5;
      ctx.beginPath();
      ctx.arc(x, y, (8 + 26 * (1 - Math.min(1, sweep / 0.8))) * px, 0, Math.PI * 2);
      ctx.stroke();
      ctx.globalAlpha = 1;
    }
  };
  const tag = (text, x, y, color) => {
    ctx.font = `${9 * px}px ${LABEL_FONT}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = color;
    ctx.fillText(text, x, y);
  };
  city.cameras.forEach((cam, i) => {
    const c = cameraColor(run, i);
    const next = live && i === run.nextCamera && !run.exitOpen;
    ctx.fillStyle = c === FAINT ? 'rgba(246,241,228,0.55)' : c;
    ctx.beginPath();
    ctx.arc(cam.cx, cam.cy, (next ? 4.6 : 2.8) * px, 0, Math.PI * 2);
    ctx.fill();
    if (next) {
      ring(cam.cx, cam.cy, c);
      tag(String(cam.number), cam.cx, cam.cy - 13 * px, c);
    }
  });
  const exit = city.exit;
  ctx.strokeStyle = run.exitOpen ? GREEN : RED;
  ctx.lineWidth = (run.exitOpen ? 3.4 : 2.6) * px;
  line(ctx, exit.x1, exit.y1, exit.x2, exit.y2);
  if (live && run.exitOpen) {
    ring(exit.cx, exit.cy, GREEN);
    tag('EXIT', exit.cx + exit.tx * 16 * px, exit.cy + exit.ty * 16 * px, GREEN);
  }
  const p = run.pursuer;
  ctx.fillStyle = Math.floor(performance.now() / 250) % 2 ? '#3d7bff' : RED;
  ctx.beginPath();
  ctx.arc(p.x, p.y, 3.6 * px, 0, Math.PI * 2);
  ctx.fill();
  // The player's heading: a nose in front of the car's dot (render.js draws the dot over it).
  const car = game.car;
  const h = car.heading;
  ctx.fillStyle = '#f6f1e4';
  ctx.beginPath();
  ctx.moveTo(car.x + Math.cos(h) * 9 * px, car.y + Math.sin(h) * 9 * px);
  ctx.lineTo(car.x + Math.cos(h + 2.4) * 5 * px, car.y + Math.sin(h + 2.4) * 5 * px);
  ctx.lineTo(car.x + Math.cos(h - 2.4) * 5 * px, car.y + Math.sin(h - 2.4) * 5 * px);
  ctx.closePath();
  ctx.fill();
}
