// Paints Getaway's cities (Downtown and Industrial) in world coordinates (metres):
//   drawUrban       the ground: dusk asphalt, curbs, markings, streetlamp pools, breakables,
//                   cameras (with capture flash), the Safehouse garage bay / escape gate,
//                   police vision cones, dispatch intel markers, guidance arrow and bust rings.
//                   Drawn under the cars.
//   drawUrbanAbove  what stands up: building roofs with architectural detail and landmarks,
//                   awnings, streetlamp heads, props, blockade barriers, police alert badges,
//                   and SMASH +N pop-ups. Drawn over the cars.
//   drawUrbanMap    the minimap.
// Reads the challenge and its run; changes neither.
import { BREAKABLE } from './getaway-urban.js';
import { cueForGame, easeAngle, turnBearing } from './getaway-nav.js';
import { visionOutline } from './getaway-driver.js';

// Smash feedback timings (seconds after the hit). Bounded: everything but the resting debris is gone
// within POPUP, and the debris is a fixed handful of pieces per object that stop within about 1 s.
export const SMASH_FX = Object.freeze({ flash: 0.14, burst: 0.34, popup: 1.4, fade: 0.45, rise: 4 });
// The pop-up's opacity and rise (metres) `tau` seconds after the smash; null once it is gone.
export function popupAt(tau, fx = SMASH_FX) {
  if (!(tau >= 0) || tau >= fx.popup) return null;
  const alpha = tau > fx.popup - fx.fade ? (fx.popup - tau) / fx.fade : 1;
  return { alpha, rise: fx.rise * (1 - Math.exp(-3 * tau)) };
}

const AMBER = '#ffb627';
const GREEN = '#5fd38a';
const RED = '#ff5a4f';
const BURNT = '#f2542d';
const FAINT = 'rgba(246,241,228,0.28)';
const LABEL_FONT = 'Impact, Haettenschweiler, "Arial Narrow Bold", sans-serif';

const STYLE = {
  downtown: {
    sidewalk: '#6e6c66',
    curb: 'rgba(224,218,205,0.45)',
    gutter: 'rgba(14,15,18,0.26)',
    road: '#2f3137',
    dash: 'rgba(246,241,228,0.34)',
    avenueLine: 'rgba(255,182,39,0.52)',
    zebra: 'rgba(246,241,228,0.30)',
    stopBar: 'rgba(246,241,228,0.42)',
    roofs: ['#454a56', '#544e48', '#43504d', '#555249', '#4c4956', '#4e555e'],
    penthouse: ['#3a3f4a', '#48423d', '#384441', '#49463e', '#403d4a', '#424851'],
    parapet: 'rgba(255,248,232,0.11)',
    edge: 'rgba(0,0,0,0.42)',
    awnings: [
      ['#c9412b', '#f4eee0'],
      ['#2d6870', '#f4eee0'],
      ['#d67a29', '#f4eee0'],
      ['#6b3c4a', '#f4eee0'],
    ],
  },
  industrial: {
    sidewalk: '#61605b',
    curb: 'rgba(255,196,64,0.22)',
    gutter: 'rgba(14,15,18,0.2)',
    road: '#454643',
    dash: 'rgba(255,196,64,0.5)',
    avenueLine: 'rgba(255,196,64,0.55)',
    zebra: 'rgba(255,196,64,0.28)',
    stopBar: 'rgba(255,196,64,0.38)',
    roofs: ['#646e71', '#706a5f', '#5d6760', '#697076'],
    penthouse: ['#555f62', '#605a50', '#505953', '#5a6066'],
    parapet: 'rgba(255,248,232,0.09)',
    edge: 'rgba(0,0,0,0.38)',
    awnings: [],
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

const visible = (b, v, pad = 4) => !v || (b.maxX >= v.x - v.hw - pad && b.minX <= v.x + v.hw + pad && b.maxY >= v.y - v.hh - pad && b.minY <= v.y + v.hh + pad);
const pointVisible = (x, y, v, pad = 16) => !v || (x >= v.x - v.hw - pad && x <= v.x + v.hw + pad && y >= v.y - v.hh - pad && y <= v.y + v.hh + pad);

// Pre-rendered soft sodium-vapor streetlamp pool sprite, shared across cities.
let lampSprite = null;
function getLampSprite() {
  if (lampSprite) return lampSprite;
  if (typeof document === 'undefined') return null;
  const size = 96;
  const c = document.createElement('canvas');
  c.width = size;
  c.height = size;
  const g = c.getContext('2d');
  const grad = g.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  grad.addColorStop(0, 'rgba(255, 212, 130, 0.24)');
  grad.addColorStop(0.32, 'rgba(255, 188, 92, 0.13)');
  grad.addColorStop(0.68, 'rgba(255, 166, 70, 0.045)');
  grad.addColorStop(1, 'rgba(255, 166, 70, 0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, size, size);
  lampSprite = c;
  return lampSprite;
}

// --- Static city geometry & visual details, built once per city --------------------------------------
const cache = new WeakMap();
function pathsFor(city) {
  if (cache.has(city)) return cache.get(city);
  const S = STYLE[city.style];
  const downtown = city.style === 'downtown';

  const pavement = new Path2D();
  for (const r of city.paved) pavement.rect(r.minX, r.minY, r.maxX - r.minX, r.maxY - r.minY);

  const road = new Path2D();
  const curb = new Path2D();
  const gutter = new Path2D();
  const sidewalkJoints = new Path2D();
  for (const e of city.edges) {
    const h = e.half - e.sidewalk;
    if (e.horizontal) {
      const x0 = Math.min(e.ax, e.bx);
      const len = Math.abs(e.bx - e.ax);
      road.rect(x0, e.ay - h, len, 2 * h);
      if (e.sidewalk > 0) {
        for (const side of [-1, 1]) {
          const cy = e.ay + side * h;
          curb.moveTo(x0, cy); curb.lineTo(x0 + len, cy);
          gutter.moveTo(x0, cy - side * 0.45); gutter.lineTo(x0 + len, cy - side * 0.45);
          for (let d = 4; d < len - 4; d += 4) {
            sidewalkJoints.moveTo(x0 + d, cy);
            sidewalkJoints.lineTo(x0 + d, cy + side * e.sidewalk);
          }
        }
      }
    } else {
      const y0 = Math.min(e.ay, e.by);
      const len = Math.abs(e.by - e.ay);
      road.rect(e.ax - h, y0, 2 * h, len);
      if (e.sidewalk > 0) {
        for (const side of [-1, 1]) {
          const cx = e.ax + side * h;
          curb.moveTo(cx, y0); curb.lineTo(cx, y0 + len);
          gutter.moveTo(cx - side * 0.45, y0); gutter.lineTo(cx - side * 0.45, y0 + len);
          for (let d = 4; d < len - 4; d += 4) {
            sidewalkJoints.moveTo(cx, y0 + d);
            sidewalkJoints.lineTo(cx + side * e.sidewalk, y0 + d);
          }
        }
      }
    }
  }
  for (const n of Object.values(city.nodes)) {
    const roadHalf = Math.max(...n.edges.map((i) => city.edges[i].half - city.edges[i].sidewalk));
    road.rect(n.x - roadHalf, n.y - roadHalf, 2 * roadHalf, 2 * roadHalf);
  }

  // Centre lines (double amber on Downtown avenues, crisp dashes on side streets), crosswalks,
  // stop bars, asphalt patches, manholes, and streetlamps.
  const dashes = new Path2D();
  const avenueLines = new Path2D();
  const zebra = new Path2D();
  const stopBars = new Path2D();
  const patches = new Path2D();
  const manholes = new Path2D();
  const lamps = [];
  const lampSet = new Set();
  const addLamp = (x, y, radius = 14) => {
    const key = `${Math.round(x / 6)},${Math.round(y / 6)}`;
    if (lampSet.has(key)) return;
    lampSet.add(key);
    lamps.push({ x, y, radius });
  };

  for (const e of city.edges) {
    const A = city.nodes[e.a];
    const B = city.nodes[e.b];
    const from = A.half + 2.5;
    const to = e.len - B.half - 2.5;
    const roadHalf = e.half - e.sidewalk;

    // Subtle deterministic asphalt wear patches & storm drains / manholes along every street.
    let s = (e.index + 17) * 48271;
    const rnd = () => { s = (s * 16807) % 2147483647; return s / 2147483647; };
    for (let d = from + 8; d < to - 6; d += 22 + rnd() * 18) {
      const off = (rnd() - 0.5) * (roadHalf * 1.1);
      const px = e.ax + e.dx * d - e.dy * off;
      const py = e.ay + e.dy * d + e.dx * off;
      const pw = 1.8 + rnd() * 2.4;
      const ph = 1.2 + rnd() * 1.8;
      patches.rect(px - pw / 2, py - ph / 2, pw, ph);
    }
    if (e.len > 36) {
      const md = e.len * (0.35 + (e.index % 3) * 0.14);
      const mx = e.ax + e.dx * md - e.dy * (e.kind === 'alley' ? 0 : roadHalf * 0.52);
      const my = e.ay + e.dy * md + e.dx * (e.kind === 'alley' ? 0 : roadHalf * 0.52);
      manholes.moveTo(mx + 0.55, my);
      manholes.arc(mx, my, 0.55, 0, Math.PI * 2);
    }

    if (e.kind === 'alley' || e.kind === 'lane' || e.kind === 'yard') continue;
    const isAvenue = downtown && e.width >= 20;
    if (isAvenue && to > from + 4) {
      for (const sep of [-0.24, 0.24]) {
        avenueLines.moveTo(e.ax + e.dx * from - e.dy * sep, e.ay + e.dy * from + e.dx * sep);
        avenueLines.lineTo(e.ax + e.dx * to - e.dy * sep, e.ay + e.dy * to + e.dx * sep);
      }
    } else {
      for (let d = from; d < to; d += 7) {
        const d2 = Math.min(to, d + 3);
        dashes.moveTo(e.ax + e.dx * d, e.ay + e.dy * d);
        dashes.lineTo(e.ax + e.dx * d2, e.ay + e.dy * d2);
      }
    }

    // Streetlamps along avenues and mid-blocks on sidewalks (purely visual).
    if (e.len >= 45 && (isAvenue || !downtown)) {
      const step = isAvenue ? 38 : 48;
      const offset = e.half - (e.sidewalk > 0 ? 0.65 : 0.8);
      let toggle = e.index % 2;
      for (let d = from + 10; d < to - 8; d += step) {
        const side = toggle % 2 === 0 ? 1 : -1;
        toggle += 1;
        addLamp(e.ax + e.dx * d - e.dy * offset * side, e.ay + e.dy * d + e.dx * offset * side, downtown ? 13.5 : 16);
      }
    }

    if (!downtown) continue;
    for (const [N, sign, base] of [[A, 1, 0], [B, -1, e.len]]) {
      if (N.edges.length < 3) continue;
      const at = base + sign * (N.half + 1.8);
      const cx = e.ax + e.dx * at;
      const cy = e.ay + e.dy * at;
      const h = roadHalf - 0.6;
      for (let k = -h; k <= h; k += 1.3) {
        const px = cx - e.dy * k;
        const py = cy + e.dx * k;
        zebra.moveTo(px - e.dx * 1.5, py - e.dy * 1.5);
        zebra.lineTo(px + e.dx * 1.5, py + e.dy * 1.5);
      }
      // White stop bar just behind the crosswalk on the approach half of the street.
      const stopAt = base + sign * (N.half + 4.3);
      if (stopAt > 2 && stopAt < e.len - 2) {
        const sx = e.ax + e.dx * stopAt;
        const sy = e.ay + e.dy * stopAt;
        const side = sign; // right-hand approach lane
        stopBars.moveTo(sx - e.dy * 0.5 * side, sy + e.dx * 0.5 * side);
        stopBars.lineTo(sx - e.dy * (roadHalf - 0.5) * side, sy + e.dx * (roadHalf - 0.5) * side);
      }
    }
  }

  // Warm corner streetlamps at busy junctions.
  for (const n of Object.values(city.nodes)) {
    if (n.edges.length < 3) continue;
    const corner = n.half - (downtown ? 0.8 : 1.0);
    const sx = (n.x + n.y) % 2 === 0 ? 1 : -1;
    addLamp(n.x + corner * sx, n.y - corner * sx, downtown ? 15 : 18);
  }

  // Pre-compute architectural roof plans & storefront awnings per building (zero per-frame work).
  const buildingPlans = city.buildings.map((b) => {
    const h = hash(b);
    const w = b.maxX - b.minX;
    const d = b.maxY - b.minY;
    const tone = h % S.roofs.length;
    const plan = {
      b, w, d, h,
      roof: S.roofs[tone],
      penthouse: S.penthouse[tone],
      tier: null,
      helipad: false,
      waterTower: null,
      skylights: [],
      hvacs: [],
      awnings: [],
    };
    if (w < 6 || d < 6) return plan;

    if (downtown) {
      // Landmark: Downtown Helipad on the prominent central-north block (between x=95..180, y=0..75).
      const cx = (b.minX + b.maxX) / 2;
      const cy = (b.minY + b.maxY) / 2;
      if (w > 24 && d > 24 && cx > 98 && cx < 176 && cy > 4 && cy < 72) {
        plan.helipad = true;
      }

      // Stepped upper penthouse tier on large Downtown blocks for genuine visual depth.
      if (w > 18 && d > 18 && !plan.helipad) {
        const insetX = 3.2 + (h % 3) * 1.4;
        const insetY = 3.2 + ((h >>> 3) % 3) * 1.4;
        const tw = w - insetX * 2;
        const td = d - insetY * 2;
        if (tw > 8 && td > 8) {
          plan.tier = {
            x: b.minX + insetX + ((h >>> 6) % 2 === 0 ? 0 : 1.2),
            y: b.minY + insetY,
            w: Math.min(tw, w - insetX * 2 - 1.2),
            d: td,
          };
        }
      }

      // Rooftop water tower on select tall blocks.
      if (!plan.helipad && w > 22 && d > 22 && (h % 3 === 0)) {
        const wx = b.minX + 5.5 + ((h >>> 9) % Math.max(1, Math.floor(w - 14)));
        const wy = b.minY + 5.5 + ((h >>> 12) % Math.max(1, Math.floor(d - 14)));
        plan.waterTower = { x: wx, y: wy, r: 2.3 + (h % 2) * 0.4 };
      }

      // Skylight bays on wide blocks.
      if (!plan.helipad && w > 20 && d > 16 && (h % 2 === 1)) {
        const sx = b.minX + w * 0.25;
        const sy = b.minY + d * 0.28;
        const sw = Math.min(10, w * 0.32);
        const sd = Math.min(4.8, d * 0.22);
        plan.skylights.push({ x: sx, y: sy, w: sw, d: sd });
      }

      // HVAC units with circular fan grilles.
      const count = plan.helipad ? 2 : w > 24 && d > 24 ? 4 : 2;
      for (let k = 0; k < count; k += 1) {
        const ux = b.minX + 3.2 + ((h >>> (k * 5 + 2)) % Math.max(1, Math.floor(w - 8.5)));
        const uy = b.minY + 3.2 + ((h >>> (k * 7 + 4)) % Math.max(1, Math.floor(d - 8.5)));
        if (plan.helipad && Math.hypot(ux - cx, uy - cy) < 11) continue;
        plan.hvacs.push({ x: ux, y: uy, w: 2.6 + (k % 2) * 0.8, d: 1.9 + ((k + 1) % 2) * 0.5 });
      }

      // Storefront striped awnings along building edges facing interior Downtown streets (purely decorative).
      const B = city.bounds;
      if (S.awnings.length && b.minX > B.minX + 4 && b.maxX < B.maxX - 4 && b.minY > B.minY + 4 && b.maxY < B.maxY - 4) {
        const palette = S.awnings[h % S.awnings.length];
        if (w > 22) {
          plan.awnings.push({ x: b.minX + 5, y: b.maxY, w: Math.min(11, w * 0.28), h: 1.45, horizontal: true, palette });
        }
        if (d > 22 && (h % 2 === 0)) {
          plan.awnings.push({ x: b.maxX, y: b.minY + 6, w: 1.45, h: Math.min(10, d * 0.28), horizontal: false, palette });
        }
      }
    } else if (w > 18 && d > 18) {
      // Industrial warehouse roof skylights & vents.
      const alongX = w > d;
      const strips = alongX ? Math.min(3, Math.floor((d - 8) / 10)) : Math.min(3, Math.floor((w - 8) / 10));
      for (let k = 0; k < strips; k += 1) {
        if (alongX) plan.skylights.push({ x: b.minX + 4, y: b.minY + 5 + k * 10, w: w - 8, d: 2.1 });
        else plan.skylights.push({ x: b.minX + 5 + k * 10, y: b.minY + 4, w: 2.1, d: d - 8 });
      }
    }
    return plan;
  });

  const built = {
    S, pavement, road, curb, gutter, sidewalkJoints, dashes, avenueLines,
    zebra, stopBars, patches, manholes, lamps, buildingPlans,
  };
  cache.set(city, built);
  return built;
}

// --- Cameras and the escape gate / Safehouse -----------------------------------------------------------
function cameraColor(run, i) {
  if (run.cameras[i]) return GREEN;
  if (i === run.nextCamera && run.phase === 'running') return run.missed[i] ? RED : AMBER;
  if (i === run.nextCamera && run.phase === 'failed') return RED;
  return FAINT;
}

function drawCamera(ctx, cam, color, active, time, filmedAt = null) {
  ctx.fillStyle = active ? 'rgba(255,182,39,0.14)' : color === GREEN ? 'rgba(95,211,138,0.08)' : 'rgba(246,241,228,0.03)';
  ctx.beginPath();
  ctx.moveTo(cam.x, cam.y);
  ctx.lineTo(cam.x1 + cam.tx * 3, cam.y1 + cam.ty * 3);
  ctx.lineTo(cam.x2 + cam.tx * 3, cam.y2 + cam.ty * 3);
  ctx.closePath();
  ctx.fill();

  // Camera capture strobe flash when just filmed!
  if (filmedAt !== null) {
    const tau = Math.max(0, time - filmedAt);
    if (tau < 0.48) {
      const flash = (1 - tau / 0.48) ** 1.6;
      ctx.save();
      ctx.fillStyle = `rgba(255,252,235,${0.72 * flash})`;
      ctx.beginPath();
      ctx.moveTo(cam.x, cam.y);
      ctx.lineTo(cam.x1 + cam.tx * 5, cam.y1 + cam.ty * 5);
      ctx.lineTo(cam.x2 + cam.tx * 5, cam.y2 + cam.ty * 5);
      ctx.closePath();
      ctx.fill();
      ctx.strokeStyle = `rgba(95,211,138,${0.85 * flash})`;
      ctx.lineWidth = 0.55;
      ctx.beginPath();
      ctx.arc(cam.cx, cam.cy, 2 + tau * 24, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
    }
  }

  ctx.strokeStyle = color;
  ctx.lineWidth = active ? 0.72 : 0.45;
  ctx.setLineDash([1.6, 1.1]);
  line(ctx, cam.x1, cam.y1, cam.x2, cam.y2);
  ctx.setLineDash([]);
  // Direction chevron on the band.
  ctx.save();
  ctx.translate(cam.cx, cam.cy);
  ctx.rotate(Math.atan2(cam.ty, cam.tx));
  ctx.strokeStyle = color;
  ctx.lineWidth = 0.42;
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

// Safehouse Garage Bay (Getaway Driver) & Escape Gateway (Get the Footage).
function drawExitBay(ctx, exit, driver, open, run, city, time) {
  const angle = Math.atan2(exit.ty, exit.tx);
  const half = exit.half - (city.sidewalk ?? 0);
  const available = run.phase === 'complete' || open;
  const color = available ? GREEN : RED;

  ctx.save();
  ctx.translate(exit.cx, exit.cy);
  ctx.rotate(angle);

  if (driver) {
    // Approach bay apron markings & entry framing.
    ctx.fillStyle = available ? 'rgba(95,211,138,0.10)' : 'rgba(255,90,79,0.08)';
    ctx.fillRect(-10, -half + 0.4, 10, (half - 0.4) * 2);

    // Warm emerald-cream garage light spilling onto the approach when open.
    if (available) {
      const grad = ctx.createLinearGradient(6, 0, -13, 0);
      grad.addColorStop(0, 'rgba(130, 245, 172, 0.34)');
      grad.addColorStop(0.55, 'rgba(95, 211, 138, 0.14)');
      grad.addColorStop(1, 'rgba(95, 211, 138, 0)');
      ctx.fillStyle = grad;
      ctx.fillRect(-13, -half + 0.6, 19, (half - 0.6) * 2);

      // Animated flowing entry chevrons guiding the driver into the bay.
      const shift = (time * 3.2) % 3.2;
      ctx.strokeStyle = 'rgba(95,211,138,0.52)';
      ctx.lineWidth = 0.55;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      for (let d = -9 + shift; d < -1.5; d += 3.2) {
        const a = Math.max(0, Math.min(1, 1 - Math.abs(d + 5.2) / 4.2));
        ctx.globalAlpha = 0.25 + 0.65 * a;
        ctx.beginPath();
        ctx.moveTo(d - 1.4, -2.5);
        ctx.lineTo(d + 0.4, 0);
        ctx.lineTo(d - 1.4, 2.5);
        ctx.stroke();
      }
      ctx.globalAlpha = 1;
    }

    // Garage interior bay floor past the threshold.
    ctx.fillStyle = available ? '#23302b' : '#25262b';
    ctx.fillRect(0.6, -half + 0.5, 11, (half - 0.5) * 2);
    ctx.strokeStyle = available ? 'rgba(95,211,138,0.35)' : 'rgba(255,90,79,0.28)';
    ctx.lineWidth = 0.35;
    ctx.strokeRect(0.6, -half + 0.5, 11, (half - 0.5) * 2);

    // Painted corner brackets on the approach apron.
    ctx.strokeStyle = available ? 'rgba(246,241,228,0.55)' : 'rgba(255,90,79,0.55)';
    ctx.lineWidth = 0.42;
    for (const s of [-1, 1]) {
      const y = s * (half - 0.8);
      ctx.beginPath();
      ctx.moveTo(-9.5, y - s * 2.2);
      ctx.lineTo(-9.5, y);
      ctx.lineTo(-0.8, y);
      ctx.stroke();
    }

    // Roll-up steel shutter across the safehouse doorway:
    // OPEN = slim rolled-up header threshold; SHUT = slammed ribbed hazard door!
    if (!available) {
      ctx.fillStyle = '#383a42';
      ctx.fillRect(-1.1, -half + 0.3, 2.2, (half - 0.3) * 2);
      ctx.save();
      ctx.beginPath();
      ctx.rect(-1.1, -half + 0.3, 2.2, (half - 0.3) * 2);
      ctx.clip();
      ctx.strokeStyle = 'rgba(255,90,79,0.85)';
      ctx.lineWidth = 0.65;
      for (let k = -half - 3; k < half + 3; k += 2.2) line(ctx, -1.6, k, 1.6, k + 1.8);
      ctx.restore();
      ctx.strokeStyle = RED;
      ctx.lineWidth = 0.35;
      ctx.strokeRect(-1.1, -half + 0.3, 2.2, (half - 0.3) * 2);
    } else {
      ctx.strokeStyle = GREEN;
      ctx.lineWidth = 0.9;
      ctx.setLineDash([1.2, 0.9]);
      line(ctx, 0, -half + 0.3, 0, half - 0.3);
      ctx.setLineDash([]);
    }

    // Flanking bay status beacon pillars on both sidewalks.
    const blink = Math.floor(time * 4) % 2 === 0;
    for (const s of [-1, 1]) {
      const py = s * (half + 0.9);
      ctx.fillStyle = '#1b1c20';
      ctx.fillRect(-1.3, py - 0.85, 2.6, 1.7);
      const lit = available || (s > 0 ? blink : !blink);
      ctx.fillStyle = available ? GREEN : lit ? RED : '#5c1f1c';
      ctx.beginPath();
      ctx.arc(0, py, 0.58, 0, Math.PI * 2);
      ctx.fill();
      if (lit) {
        ctx.fillStyle = available ? 'rgba(95,211,138,0.28)' : 'rgba(255,90,79,0.34)';
        ctx.beginPath();
        ctx.arc(0, py, 2.4, 0, Math.PI * 2);
        ctx.fill();
      }
    }
  } else {
    // Get the Footage: stylized escape gateway with beacon pylons & lane light spill.
    if (available) {
      const grad = ctx.createLinearGradient(4, 0, -10, 0);
      grad.addColorStop(0, 'rgba(95, 211, 138, 0.28)');
      grad.addColorStop(1, 'rgba(95, 211, 138, 0)');
      ctx.fillStyle = grad;
      ctx.fillRect(-10, -half + 0.4, 14, (half - 0.4) * 2);
    }
    ctx.strokeStyle = color;
    ctx.lineWidth = 1;
    ctx.setLineDash([1, 1]);
    line(ctx, 0, -exit.half, 0, exit.half);
    ctx.setLineDash([]);
    for (const s of [-1, 1]) {
      const py = s * (half + 0.8);
      ctx.fillStyle = '#1b1c20';
      ctx.beginPath();
      ctx.arc(0, py, 0.9, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.arc(0, py, 0.48, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  ctx.restore();

  // Crisp road label with dark halo so it stays legible over light wash.
  const lx = exit.cx + exit.tx * 5.2;
  const ly = exit.cy + exit.ty * 5.2;
  const text = driver ? (available ? 'SAFEHOUSE' : 'SAFEHOUSE · SHUT')
    : available ? 'ESCAPE' : `ESCAPE · LOCKED ${run.nextCamera}/${city.cameras.length}`;
  ctx.save();
  ctx.font = `2.4px ${LABEL_FONT}`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.lineWidth = 0.5;
  ctx.strokeStyle = 'rgba(15,16,19,0.85)';
  ctx.strokeText(text, lx, ly);
  ctx.fillStyle = color;
  ctx.fillText(text, lx, ly);
  ctx.restore();
}

// --- Breakables -----------------------------------------------------------------------------------------
const FRUIT = ['#f08a24', '#7cc24a', '#e2412f', '#f3c43d', '#f08a24', '#b64fd0'];
const JUICE = ['rgba(240,138,36,0.34)', 'rgba(226,65,47,0.34)', 'rgba(243,196,61,0.32)', 'rgba(124,194,74,0.30)'];
function pieces(br, hit, count) {
  const out = [];
  let seed = (br.index + 1) * 9301;
  const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
  const speed = Math.max(4, hit.speed);
  const dirLen = Math.hypot(hit.vx ?? 1, hit.vy ?? 0) || 1;
  const ux = (hit.vx ?? 1) / dirLen;
  const uy = (hit.vy ?? 0) / dirLen;
  for (let i = 0; i < count; i += 1) {
    const x0 = br.minX + rnd() * (br.maxX - br.minX);
    const y0 = br.minY + rnd() * (br.maxY - br.minY);
    const along = speed * (0.35 + rnd() * 0.55);
    const side = speed * (rnd() - 0.5) * 0.95;
    out.push({ x0, y0, vx: ux * along - uy * side, vy: uy * along + ux * side, spin: (rnd() - 0.5) * 14, size: 0.25 + rnd() * 0.36, k: i });
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
  // Ground shadow.
  ctx.fillStyle = 'rgba(0,0,0,0.28)';
  ctx.fillRect(b.minX + 0.4, b.minY + 0.5, w, h);
  ctx.fillStyle = '#7a4f28';
  ctx.fillRect(b.minX, b.minY, w, h);
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
  ctx.fillStyle = 'rgba(0,0,0,0.28)';
  ctx.fillRect(b.minX + 0.35, b.minY + 0.45, w, h);
  ctx.save();
  ctx.beginPath();
  ctx.rect(b.minX, b.minY, w, h);
  ctx.clip();
  ctx.fillStyle = '#f6f1e4';
  ctx.fillRect(b.minX, b.minY, w, h);
  ctx.strokeStyle = BURNT;
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
  const parts = debrisOf(br, hit);

  // Splattered juice stains on the pavement beneath fruit stand wreckage.
  if (br.kind === 'fruit') {
    const grow = Math.min(1, tau * 6);
    for (let i = 0; i < Math.min(6, parts.length); i += 1) {
      const p = parts[i];
      const sx = p.x0 + settle(p.vx, Math.min(tau, 0.22));
      const sy = p.y0 + settle(p.vy, Math.min(tau, 0.22));
      ctx.fillStyle = JUICE[i % JUICE.length];
      ctx.beginPath();
      ctx.ellipse(sx, sy, (0.55 + (i % 3) * 0.28) * grow, (0.35 + ((i + 1) % 2) * 0.22) * grow, p.k, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  // White impact flash + expanding golden shockwave ring.
  if (tau < SMASH_FX.flash) {
    ctx.fillStyle = `rgba(255,248,230,${0.8 * (1 - tau / SMASH_FX.flash)})`;
    ctx.beginPath();
    ctx.arc(br.cx, br.cy, 3.6, 0, Math.PI * 2);
    ctx.fill();
  }
  if (tau < SMASH_FX.burst) {
    const t = tau / SMASH_FX.burst;
    ctx.strokeStyle = `rgba(255,182,39,${0.85 * (1 - t)})`;
    ctx.lineWidth = 0.48 * (1 - t * 0.5);
    ctx.beginPath();
    ctx.arc(br.cx, br.cy, 1.4 + tau * 16, 0, Math.PI * 2);
    ctx.stroke();
  }

  // Splintered remains where the stand/barricade stood.
  ctx.fillStyle = br.kind === 'fruit' ? 'rgba(122,79,40,0.58)' : 'rgba(138,106,68,0.52)';
  for (const s of [0.2, 0.7]) ctx.fillRect(br.minX + (br.maxX - br.minX) * s, br.minY + (br.maxY - br.minY) * s, 0.55, 0.55);

  for (const p of parts) {
    const x = p.x0 + settle(p.vx, tau);
    const y = p.y0 + settle(p.vy, tau);
    if (br.kind === 'fruit') {
      ctx.fillStyle = p.k % 5 === 0 ? '#7a4f28' : p.k % 7 === 0 ? (p.k % 2 ? '#d93a2b' : '#f6f1e4') : FRUIT[p.k % FRUIT.length];
      if (p.k % 5 === 0 || p.k % 7 === 0) {
        ctx.save();
        ctx.translate(x, y);
        ctx.rotate(settle(p.spin, tau));
        ctx.fillRect(-0.5, -0.32, 1.0, 0.64);
        ctx.restore();
      } else {
        ctx.beginPath();
        ctx.arc(x, y, p.size * 0.82, 0, Math.PI * 2);
        ctx.fill();
      }
    } else {
      ctx.save();
      ctx.translate(x, y);
      ctx.rotate(settle(p.spin, tau) + p.k);
      ctx.fillStyle = p.k % 2 ? BURNT : '#f6f1e4';
      ctx.fillRect(-1.15, -0.24, 2.3, 0.48);
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
  // Crisp bottom-right shadow for every raised prop.
  ctx.fillStyle = 'rgba(0,0,0,0.28)';
  ctx.fillRect(p.minX + 0.55, p.minY + 0.7, w, h);
  switch (p.kind) {
    case 'container': {
      const col = CONTAINERS[p.color % CONTAINERS.length];
      ctx.fillStyle = col;
      ctx.fillRect(p.minX, p.minY, w, h);
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
        ctx.fillStyle = 'rgba(255,255,255,0.22)';
        ctx.fillRect(p.minX + 0.4, p.minY + 0.4, w - 2.2, 0.45);
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
      ctx.fillStyle = '#2a5f42';
      ctx.fillRect(p.minX, p.minY, w, h);
      ctx.fillStyle = 'rgba(0,0,0,0.34)';
      ctx.fillRect(p.minX + 0.22, p.minY + 0.22, w - 0.44, h - 0.44);
      ctx.strokeStyle = 'rgba(255,255,255,0.14)';
      ctx.lineWidth = 0.12;
      line(ctx, p.minX + 0.2, (p.minY + p.maxY) / 2, p.maxX - 0.2, (p.minY + p.maxY) / 2);
      break;
    case 'kiosk':
      ctx.fillStyle = '#334459';
      ctx.fillRect(p.minX, p.minY, w, h);
      ctx.fillStyle = AMBER;
      ctx.fillRect(p.minX, p.minY, w, 0.55);
      ctx.fillStyle = '#f6f1e4';
      ctx.fillRect(p.minX + 0.4, p.minY + 0.9, w - 0.8, 0.5);
      break;
    case 'planter':
      ctx.fillStyle = '#857f74';
      ctx.fillRect(p.minX, p.minY, w, h);
      ctx.fillStyle = '#2d6d37';
      ctx.beginPath();
      ctx.arc(p.minX + w / 2, p.minY + h / 2, Math.min(w, h) * 0.42, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#479650';
      ctx.beginPath();
      ctx.arc(p.minX + w * 0.44, p.minY + h * 0.44, Math.min(w, h) * 0.25, 0, Math.PI * 2);
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
  // Reflective flashing red/amber warning bar across the blocks.
  const pulse = Math.floor(time * 3.5) % 2;
  ctx.fillStyle = pulse ? 'rgba(255,90,79,0.92)' : 'rgba(255,182,39,0.62)';
  const cx = (bl.minX + bl.maxX) / 2;
  const cy = (bl.minY + bl.maxY) / 2;
  if (bl.horizontal) ctx.fillRect(cx - 0.32, bl.minY + 1, 0.64, bl.maxY - bl.minY - 2);
  else ctx.fillRect(bl.minX + 1, cy - 0.32, bl.maxX - bl.minX - 2, 0.64);
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
  ctx.fillStyle = 'rgba(19,20,23,0.90)';
  ctx.beginPath();
  ctx.roundRect(sign.x - w / 2, sign.y - 1.5, w, 3, 0.35);
  ctx.fill();
  ctx.strokeStyle = sign.text === 'NO EXIT' ? AMBER : RED;
  ctx.lineWidth = 0.25;
  ctx.stroke();
  label(ctx, text, sign.x, sign.y + 0.1, 2, sign.text === 'NO EXIT' ? AMBER : (Math.floor(time * 2.5) % 2 ? RED : '#ff8f87'));
}

// --- Guidance (R4C) ----------------------------------------------------------------------------------
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
  const {
    S, pavement, road, curb, gutter, sidewalkJoints, dashes, avenueLines,
    zebra, stopBars, patches, manholes, lamps,
  } = pathsFor(city);

  const b = city.bounds;
  ctx.fillStyle = '#202226';
  ctx.fillRect(b.minX, b.minY, b.maxX - b.minX, b.maxY - b.minY);
  ctx.fillStyle = S.sidewalk;
  ctx.fill(pavement);
  // Subtle sidewalk expansion joints.
  ctx.strokeStyle = 'rgba(0,0,0,0.12)';
  ctx.lineWidth = 0.12;
  ctx.stroke(sidewalkJoints);

  ctx.fillStyle = S.road;
  ctx.fill(road);
  // Asphalt wear patches & manholes.
  ctx.fillStyle = 'rgba(0,0,0,0.11)';
  ctx.fill(patches);
  ctx.strokeStyle = 'rgba(246,241,228,0.12)';
  ctx.lineWidth = 0.16;
  ctx.fillStyle = 'rgba(20,21,24,0.34)';
  ctx.fill(manholes);
  ctx.stroke(manholes);

  // Road curb rims & dark curb gutters.
  ctx.strokeStyle = S.gutter;
  ctx.lineWidth = 0.9;
  ctx.stroke(gutter);
  ctx.strokeStyle = S.curb;
  ctx.lineWidth = 0.24;
  ctx.stroke(curb);

  // Avenue double lines, side-street dashes, crosswalks and stop bars.
  ctx.strokeStyle = S.avenueLine;
  ctx.lineWidth = 0.22;
  ctx.stroke(avenueLines);
  ctx.strokeStyle = S.dash;
  ctx.lineWidth = city.style === 'industrial' ? 0.35 : 0.28;
  ctx.stroke(dashes);
  ctx.strokeStyle = S.zebra;
  ctx.lineWidth = 0.6;
  ctx.stroke(zebra);
  ctx.strokeStyle = S.stopBar;
  ctx.lineWidth = 0.55;
  ctx.stroke(stopBars);

  // The container yard's painted bays.
  if (city.style === 'industrial') {
    const yard = city.edges.find((e) => e.kind === 'yard');
    if (yard) {
      ctx.strokeStyle = 'rgba(255,196,64,0.24)';
      ctx.lineWidth = 0.28;
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
    ctx.strokeStyle = 'rgba(255,182,39,0.38)';
    ctx.lineWidth = 0.42;
    for (let k = -e.half + 1; k < e.half; k += 2) {
      const sx = N.x - e.dy * k;
      const sy = N.y + e.dx * k;
      line(ctx, sx - e.dx * 1.5, sy - e.dy * 1.5, sx + e.dx * 1.5 - e.dy * 1.5, sy + e.dy * 1.5 + e.dx * 1.5);
    }
  }

  // Warm dusk streetlamp pools on sidewalks & intersections (pre-rendered sprite).
  const glow = getLampSprite();
  if (glow) {
    for (const lamp of lamps) {
      if (!pointVisible(lamp.x, lamp.y, view, lamp.radius + 4)) continue;
      ctx.drawImage(glow, lamp.x - lamp.radius, lamp.y - lamp.radius, lamp.radius * 2, lamp.radius * 2);
    }
  }

  // The breakables.
  for (const br of city.breakables) {
    const hit = run.broken[br.index];
    if (hit) drawBroken(ctx, br, hit, run.time);
    else if (br.kind === 'fruit') drawFruitStand(ctx, br);
    else drawBarricade(ctx, br);
  }

  // Cameras and the Safehouse / Escape gateway.
  city.cameras.forEach((cam, i) => drawCamera(
    ctx, cam, cameraColor(run, i), i === run.nextCamera && run.phase === 'running',
    run.time, run.cameras[i]?.time ?? null,
  ));
  const driver = def.mission === 'driver';
  drawExitBay(ctx, city.exit, driver, run.exitOpen, run, city, time);

  if (driver) {
    drawDriverSight(ctx, def, run, time);
    drawDriverIntel(ctx, run, time);
  }

  for (const sign of city.signs) drawSign(ctx, sign, time);

  if (run.phase === 'running' && game) {
    drawTurnChevrons(ctx, run, game, time);
    drawGuideArrow(ctx, run, game);
  }

  if (driver) {
    for (const u of run.police) if (u.mode === 'pursue') drawBustRing(ctx, def, run, u, time);
    return;
  }
  const p = run.pursuer;
  drawBustRing(ctx, def, run, p, time);
}

// --- Getaway Driver ----------------------------------------------------------------------------------
// Soft gradient-filled police vision cones: cool blue patrolling, warm amber watching,
// burning red-orange while spotting lock-on fills, crimson in pursuit.
const SIGHT_RGB = {
  patrol: [130, 178, 255],
  watching: [255, 182, 39],
  spotting: [255, 112, 52],
  pursue: [255, 86, 78],
  looking: [255, 176, 62],
};

function drawDriverSight(ctx, def, run, time) {
  const { city } = def.geometry;
  const D = def.driverTuning;
  for (const u of run.police) {
    const spotting = u.spotting > 0 && u.mode !== 'pursue';
    const key = u.mode === 'pursue' ? 'pursue' : spotting ? 'spotting' : u.watching ? 'watching'
      : u.mode === 'patrol' || u.mode === 'return' ? 'patrol' : 'looking';
    const [r, g, b] = SIGHT_RGB[key];
    const pts = visionOutline(city, u, D);
    const range = (u.mode === 'patrol' || u.mode === 'return') ? D.visionRange : 80;
    const peak = key === 'spotting' ? 0.30 : key === 'watching' ? 0.24 : key === 'pursue' ? 0.16 : 0.14;
    const edgeA = key === 'spotting' ? 0.78 : key === 'watching' ? 0.65 : key === 'pursue' ? 0.42 : 0.30;

    ctx.save();
    ctx.beginPath();
    ctx.moveTo(u.x, u.y);
    for (const [x, y] of pts) ctx.lineTo(x, y);
    ctx.closePath();

    const grad = ctx.createRadialGradient(u.x, u.y, 1.5, u.x, u.y, range);
    grad.addColorStop(0, `rgba(${r},${g},${b},${peak})`);
    grad.addColorStop(0.65, `rgba(${r},${g},${b},${peak * 0.55})`);
    grad.addColorStop(1, `rgba(${r},${g},${b},${peak * 0.12})`);
    ctx.fillStyle = grad;
    ctx.fill();

    ctx.strokeStyle = `rgba(${r},${g},${b},${edgeA})`;
    ctx.lineWidth = spotting ? 0.42 : 0.3;
    ctx.stroke();

    // Subtle rotating sweep beam when a cruiser is actively searching or responding.
    if (u.mode === 'search' || u.mode === 'respond') {
      ctx.clip();
      const sweep = (time * 2.1 + u.index * 1.7) % (Math.PI * 2);
      ctx.strokeStyle = `rgba(${r},${g},${b},0.35)`;
      ctx.lineWidth = 0.6;
      line(ctx, u.x, u.y, u.x + Math.cos(sweep) * range, u.y + Math.sin(sweep) * range);
    }
    ctx.restore();
  }
}

// Last-known / reported dispatch beacon on the street so the player reads the stealth AI at speed.
function drawDriverIntel(ctx, run, time) {
  const seen = new Set();
  for (const u of run.police) {
    const spot = u.mode === 'respond' ? u.report : u.mode === 'search' ? u.known : null;
    if (!spot) continue;
    const key = `${Math.round(spot.x)},${Math.round(spot.y)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const respond = u.mode === 'respond';
    const color = respond ? BURNT : AMBER;
    const pulse = (time * 1.4) % 1;
    ctx.save();
    ctx.strokeStyle = color;
    ctx.globalAlpha = 0.72 * (1 - pulse);
    ctx.lineWidth = 0.35;
    ctx.beginPath();
    ctx.arc(spot.x, spot.y, 2.5 + pulse * 6.5, 0, Math.PI * 2);
    ctx.stroke();
    ctx.globalAlpha = 0.78;
    ctx.setLineDash([1.1, 0.9]);
    ctx.lineWidth = 0.38;
    ctx.beginPath();
    ctx.arc(spot.x, spot.y, 3.2, 0, Math.PI * 2);
    ctx.stroke();
    ctx.setLineDash([]);
    label(ctx, respond ? 'REPORTED' : 'LAST SEEN', spot.x, spot.y - 4.8, 1.75, color);
    ctx.restore();
  }
}

function drawBustRing(ctx, def, run, p, time) {
  const r = def.captureModel.radius;
  const inside = run.gap < r && run.sees && run.phase === 'running';
  ctx.save();
  if (inside) {
    const pulse = 0.5 + 0.5 * Math.sin(time * 14);
    ctx.fillStyle = `rgba(255,90,79,${0.08 + 0.14 * run.meter * (0.7 + 0.3 * pulse)})`;
    ctx.beginPath();
    ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.strokeStyle = inside ? `rgba(255,90,79,${0.55 + 0.4 * run.meter})` : 'rgba(255,90,79,0.24)';
  ctx.lineWidth = inside ? 0.58 : 0.3;
  ctx.setLineDash(inside ? [] : [1.2, 1.2]);
  ctx.beginPath();
  ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
  ctx.stroke();
  ctx.setLineDash([]);
  ctx.restore();
}

// Over the roofs: alert badge above each police car that is onto you, with a live radial
// lock-on ring filling during the 0.6 s spotting window before pursuit ignites.
function drawDriverMarks(ctx, def, run, time) {
  const D = def.driverTuning;
  for (const u of run.police) {
    let text = null;
    let color = AMBER;
    const spotFrac = u.mode !== 'pursue' && u.spotting > 0 ? Math.min(1, u.spotting / D.spotTime) : 0;
    if (u.mode === 'pursue') { text = '!'; color = RED; }
    else if (spotFrac > 0) { text = '?'; color = spotFrac > 0.55 ? RED : '#ff8c38'; }
    else if (u.watching && run.attention >= D.suspectAt) text = '?';
    else if (u.mode === 'respond' || u.mode === 'search') text = '…';
    if (!text) continue;
    const bob = Math.sin(time * (spotFrac > 0 || u.mode === 'pursue' ? 11 : 6)) * 0.4;
    const bx = u.x;
    const by = u.y - 5.3 + bob;
    const rad = spotFrac > 0 ? 2.25 + spotFrac * 0.35 : 2.15;
    ctx.save();
    ctx.fillStyle = 'rgba(19,20,23,0.88)';
    ctx.beginPath();
    ctx.arc(bx, by, rad, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = u.mode === 'pursue' ? RED : spotFrac > 0 ? 'rgba(246,241,228,0.22)' : 'rgba(246,241,228,0.25)';
    ctx.lineWidth = 0.28;
    ctx.stroke();
    // Radial lock-on fill arc showing exact spotting countdown before pursuit!
    if (spotFrac > 0) {
      ctx.strokeStyle = spotFrac > 0.6 ? RED : AMBER;
      ctx.lineWidth = 0.48;
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.arc(bx, by, rad + 0.35, -Math.PI / 2, -Math.PI / 2 + spotFrac * Math.PI * 2);
      ctx.stroke();
    }
    label(ctx, text, bx, by + 0.1, 3.05, color);
    ctx.restore();
  }
}

function drawAwning(ctx, a) {
  const stripes = 6;
  ctx.fillStyle = 'rgba(0,0,0,0.24)';
  ctx.fillRect(a.x + 0.3, a.y + 0.35, a.w, a.h);
  for (let i = 0; i < stripes; i += 1) {
    ctx.fillStyle = a.palette[i % 2];
    if (a.horizontal) ctx.fillRect(a.x + (a.w / stripes) * i, a.y, a.w / stripes, a.h);
    else ctx.fillRect(a.x, a.y + (a.h / stripes) * i, a.w, a.h / stripes);
  }
  ctx.strokeStyle = 'rgba(0,0,0,0.35)';
  ctx.lineWidth = 0.12;
  ctx.strokeRect(a.x, a.y, a.w, a.h);
}

export function drawUrbanAbove(ctx, def, run, view, time) {
  const { city } = def.geometry;
  const { S, lamps, buildingPlans } = pathsFor(city);
  const downtown = city.style === 'downtown';

  // Beyond the bounds the town carries on out to the edge of the view.
  const B = city.bounds;
  ctx.fillStyle = S.roofs[0];
  const far = 400;
  ctx.fillRect(B.minX - far, B.minY - far, B.maxX - B.minX + 2 * far, far);
  ctx.fillRect(B.minX - far, B.maxY, B.maxX - B.minX + 2 * far, far);
  ctx.fillRect(B.minX - far, B.minY, far, B.maxY - B.minY);
  ctx.fillRect(B.maxX, B.minY, far, B.maxY - B.minY);

  const visiblePlans = buildingPlans.filter((p) => visible(p.b, view, 6));

  // Deep south-east canyon shadows over sidewalks & street edges.
  ctx.fillStyle = 'rgba(0,0,0,0.30)';
  for (const p of visiblePlans) ctx.fillRect(p.b.minX + 1.5, p.b.minY + 2.1, p.w, p.d);

  // Storefront awnings tucked against building facades.
  for (const p of visiblePlans) {
    for (const a of p.awnings) drawAwning(ctx, a);
  }

  for (const p of visiblePlans) {
    const { b, w, d } = p;
    ctx.fillStyle = p.roof;
    ctx.fillRect(b.minX, b.minY, w, d);
    if (w < 4 || d < 4) continue;

    // Parapet bevel: subtle warm edge north-west, darker parapet inner ring.
    ctx.strokeStyle = S.parapet;
    ctx.lineWidth = 0.55;
    ctx.strokeRect(b.minX + 0.9, b.minY + 0.9, w - 1.8, d - 1.8);

    if (!downtown) {
      // Industrial corrugated ribs + factory skylight bays.
      ctx.strokeStyle = 'rgba(0,0,0,0.14)';
      ctx.lineWidth = 0.2;
      if (w > d) for (let y = b.minY + 2; y < b.maxY - 1; y += 2.2) line(ctx, b.minX + 1, y, b.maxX - 1, y);
      else for (let x = b.minX + 2; x < b.maxX - 1; x += 2.2) line(ctx, x, b.minY + 1, x, b.maxY - 1);
      for (const sk of p.skylights) {
        ctx.fillStyle = 'rgba(135,175,180,0.24)';
        ctx.fillRect(sk.x, sk.y, sk.w, sk.d);
        ctx.strokeStyle = 'rgba(20,24,26,0.38)';
        ctx.lineWidth = 0.16;
        ctx.strokeRect(sk.x, sk.y, sk.w, sk.d);
      }
    } else {
      // Stepped upper penthouse tier.
      if (p.tier) {
        const t = p.tier;
        ctx.fillStyle = 'rgba(0,0,0,0.22)';
        ctx.fillRect(t.x + 0.8, t.y + 1.0, t.w, t.d);
        ctx.fillStyle = p.penthouse;
        ctx.fillRect(t.x, t.y, t.w, t.d);
        ctx.strokeStyle = 'rgba(255,248,232,0.08)';
        ctx.lineWidth = 0.35;
        ctx.strokeRect(t.x + 0.45, t.y + 0.45, t.w - 0.9, t.d - 0.9);
      }

      // Rooftop skylight bays.
      for (const sk of p.skylights) {
        ctx.fillStyle = 'rgba(105,136,158,0.28)';
        ctx.fillRect(sk.x, sk.y, sk.w, sk.d);
        ctx.strokeStyle = 'rgba(20,22,26,0.45)';
        ctx.lineWidth = 0.2;
        ctx.strokeRect(sk.x, sk.y, sk.w, sk.d);
        line(ctx, sk.x + sk.w / 2, sk.y, sk.x + sk.w / 2, sk.y + sk.d);
      }

      // Downtown Landmark: Central Helipad.
      if (p.helipad) {
        const cx = (b.minX + b.maxX) / 2;
        const cy = (b.minY + b.maxY) / 2;
        const rad = Math.min(w, d) * 0.28;
        ctx.fillStyle = 'rgba(20,22,26,0.26)';
        ctx.beginPath();
        ctx.arc(cx, cy, rad + 1.2, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = 'rgba(255,182,39,0.52)';
        ctx.lineWidth = 0.6;
        ctx.beginPath();
        ctx.arc(cx, cy, rad, 0, Math.PI * 2);
        ctx.stroke();
        label(ctx, 'H', cx, cy + 0.3, rad * 1.15, 'rgba(246,241,228,0.55)');
      }

      // HVAC units with dark fan grilles.
      for (const u of p.hvacs) {
        ctx.fillStyle = 'rgba(0,0,0,0.24)';
        ctx.fillRect(u.x + 0.3, u.y + 0.35, u.w, u.d);
        ctx.fillStyle = 'rgba(130,134,138,0.28)';
        ctx.fillRect(u.x, u.y, u.w, u.d);
        ctx.fillStyle = 'rgba(20,22,26,0.45)';
        ctx.beginPath();
        ctx.arc(u.x + u.w * 0.5, u.y + u.d * 0.5, Math.min(u.w, u.d) * 0.32, 0, Math.PI * 2);
        ctx.fill();
      }

      // Classic wooden rooftop water tower.
      if (p.waterTower) {
        const wt = p.waterTower;
        ctx.fillStyle = 'rgba(0,0,0,0.3)';
        ctx.beginPath();
        ctx.arc(wt.x + 0.7, wt.y + 0.9, wt.r, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = '#6f553c';
        ctx.beginPath();
        ctx.arc(wt.x, wt.y, wt.r, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = '#85694d';
        ctx.beginPath();
        ctx.arc(wt.x - wt.r * 0.15, wt.y - wt.r * 0.15, wt.r * 0.6, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = 'rgba(20,20,22,0.45)';
        ctx.lineWidth = 0.18;
        ctx.beginPath();
        ctx.arc(wt.x, wt.y, wt.r, 0, Math.PI * 2);
        ctx.stroke();
      }
    }

    ctx.strokeStyle = S.edge;
    ctx.lineWidth = 0.32;
    ctx.strokeRect(b.minX, b.minY, w, d);
  }

  for (const p of city.props) if (visible(p, view)) drawProp(ctx, p);
  for (const bl of city.blockades) if (visible(bl, view, 10)) drawBlockade(ctx, bl, time);

  // Subtle streetlamp post heads above shadows.
  for (const lamp of lamps) {
    if (!pointVisible(lamp.x, lamp.y, view, 4)) continue;
    ctx.fillStyle = '#24262b';
    ctx.beginPath();
    ctx.arc(lamp.x, lamp.y, 0.45, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#ffe5a3';
    ctx.beginPath();
    ctx.arc(lamp.x, lamp.y, 0.24, 0, Math.PI * 2);
    ctx.fill();
  }

  if (def.mission === 'driver') { drawDriverMarks(ctx, def, run, time); return; }
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
  for (const bl of city.blockades) {
    ctx.fillStyle = RED;
    ctx.fillRect(bl.cx - 4 * px, bl.cy - 4 * px, 8 * px, 8 * px);
  }
  for (const br of city.breakables) {
    if (br.kind !== 'barricade' || run.broken[br.index]) continue;
    ctx.fillStyle = BURNT;
    ctx.fillRect(br.cx - 2.5 * px, br.cy - 2.5 * px, 5 * px, 5 * px);
  }
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
      ctx.arc(x, y, (8 + 16 * (1 - Math.min(1, sweep / 0.8))) * px, 0, Math.PI * 2);
      ctx.stroke();
      ctx.globalAlpha = 1;
    }
  };
  const tag = (text, x, y, color) => {
    const b = city.bounds;
    const padX = 16 * px;
    const padY = 8 * px;
    const tx = Math.max(b.minX + padX, Math.min(b.maxX - padX, x));
    const ty = Math.max(b.minY + padY, Math.min(b.maxY - padY, y));
    ctx.font = `${9 * px}px ${LABEL_FONT}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = color;
    ctx.fillText(text, tx, ty);
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
  const driver = def.mission === 'driver';
  if (live && run.exitOpen) {
    ring(exit.cx, exit.cy, GREEN);
    // Keep the label neatly inside the map bounds so SAFE never clips the right border.
    tag(driver ? 'SAFE' : 'EXIT', exit.cx - exit.tx * 2 * px, exit.cy + (driver ? 15 * px : exit.ty * 16 * px), GREEN);
  }
  if (driver) {
    const flash = Math.floor(performance.now() / 220) % 2;
    // Dispatch ping rings for reported / searching locations on the minimap.
    for (const u of run.police) {
      const spot = u.mode === 'respond' ? u.report : u.mode === 'search' ? u.known : null;
      if (!spot) continue;
      ctx.strokeStyle = u.mode === 'respond' ? BURNT : AMBER;
      ctx.lineWidth = 1.2 * px;
      ctx.beginPath();
      ctx.arc(spot.x, spot.y, (5 + ((now * 6) % 5)) * px, 0, Math.PI * 2);
      ctx.stroke();
    }
    for (const u of run.police) {
      const col = u.lights ? (flash ? '#3d7bff' : RED) : u.watching ? AMBER : 'rgba(160,190,255,0.95)';
      if (u.lights) {
        ctx.fillStyle = flash ? 'rgba(61,123,255,0.28)' : 'rgba(255,90,79,0.28)';
        ctx.beginPath();
        ctx.arc(u.x, u.y, 7.5 * px, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.fillStyle = col;
      ctx.beginPath();
      ctx.arc(u.x, u.y, 3.4 * px, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = col;
      ctx.lineWidth = 1.4 * px;
      line(ctx, u.x, u.y, u.x + Math.cos(u.heading) * 8 * px, u.y + Math.sin(u.heading) * 8 * px);
    }
  }
  const p = driver ? null : run.pursuer;
  if (p) {
    const flash = Math.floor(performance.now() / 220) % 2;
    ctx.fillStyle = flash ? 'rgba(61,123,255,0.3)' : 'rgba(255,90,79,0.3)';
    ctx.beginPath();
    ctx.arc(p.x, p.y, 7.5 * px, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = flash ? '#3d7bff' : RED;
    ctx.beginPath();
    ctx.arc(p.x, p.y, 3.6 * px, 0, Math.PI * 2);
    ctx.fill();
  }
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
