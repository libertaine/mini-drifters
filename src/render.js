// Everything drawn on the canvas: the circuit, the car, skid marks, smoke and the
// minimap. Nothing here feeds back into the simulation.
import { TUNING } from './tuning.js';
import { ghostDisplay } from './ghost.js';

const COLORS = {
  grass: '#3f9a47',
  grassStripe: '#46a64e',
  tuft: '#35873f',
  asphalt: '#2c2d31',
  line: '#f4f1e6',
  dash: '#ffc233',
  curbRed: '#e0352b',
  curbWhite: '#f6f3ea',
  wall: '#26272b',
  wallTop: '#e8e4d8',
  skid: '#111114',
  treeDark: '#1f6a35',
  treeLight: '#2d8644',
  body: '#ef4d23',
  bodyShade: '#bd3413',
  stripe: '#fff5df',
  glass: '#1d2c3b',
  roof: '#2a1b18',
  tyre: '#131316',
  headlight: '#fff6c9',
  taillight: '#ff2316',
};

// The same car in a cold colour, with an outline so it reads on asphalt and on grass.
const GHOST_COLORS = {
  ...COLORS,
  body: '#46d6ff',
  bodyShade: '#1c9ccb',
  stripe: '#effcff',
  glass: '#0e4a63',
  roof: '#0b3a4e',
  tyre: '#0a2d3c',
  outline: '#f2fdff',
};
const GHOST_WHEELS = { wheelAngle: 0, brake: 0, handbrake: false };
const GHOST_SPRITE_SCALE = 44; // pixels per metre of the car's artwork

const VIEW = {
  zoomSlow: 11.5,         // pixels per metre near a standstill
  zoomFast: 8.2,          // pixels per metre at top speed
  zoomRate: 1.2,          // how quickly zoom follows speed, per second
  lookAhead: 0.75,        // seconds of velocity the camera leads the car by
  lookAheadMax: 28,       // metres
  followRate: 5,          // how tightly the camera follows, per second
  referenceHeight: 760,   // larger windows zoom in proportionally
};

const FX = {
  skidMinSlip: 11 * (Math.PI / 180),
  skidMinSpeed: 6,
  skidCapacity: 1800,
  skidChunk: 300,
  skidBaseAlpha: 0.48,
  smokeMinSlip: 16 * (Math.PI / 180),
  smokeMinSpeed: 8,
  smokeCapacity: 110,
  smokeRate: 34,          // puffs per second at full intensity
  smokeLife: 0.85,
  dustRate: 18,
  maxDt: 0.05,
};

const CAR = {
  drawScale: 1.2,         // drawn a little larger than its physics size, so slides read clearly
  length: 4.9,
  width: 2.3,
  axle: 1.48,             // wheel distance from the car's centre, for skid marks
  track: 1.0,
};

function buildRoadPath(track, shift = 0) {
  const path = new Path2D();
  track.points.forEach((p, i) => {
    const x = p.x - p.ty * shift;
    const y = p.y + p.tx * shift;
    if (i === 0) path.moveTo(x, y);
    else path.lineTo(x, y);
  });
  path.closePath();
  return path;
}

function buildCurbPath(track) {
  // Only corners get curbs. Short runs between corners are bridged so they read as one piece.
  const path = new Path2D();
  const { points } = track;
  const n = points.length;
  const curved = points.map((p) => Math.abs(p.curvature) > track.curbCurvature);
  const start = curved.indexOf(false);
  let drawing = false;
  for (let k = 0; k <= n; k += 1) {
    const i = (start + k) % n;
    const p = points[i];
    if (curved[i]) {
      if (drawing) path.lineTo(p.x, p.y);
      else path.moveTo(p.x, p.y);
      drawing = true;
    } else {
      drawing = false;
    }
  }
  return path;
}

// Small deterministic generator so the scenery is identical on every load.
function scatter(seed) {
  let s = seed;
  return () => {
    s = (s * 1664525 + 1013904223) % 4294967296;
    return s / 4294967296;
  };
}

function buildScenery(track) {
  const { bounds } = track;
  const rand = scatter(7);
  const trees = [];
  const margin = 70;
  const w = bounds.maxX - bounds.minX + margin * 2;
  const h = bounds.maxY - bounds.minY + margin * 2;
  for (let i = 0; i < 90; i += 1) {
    const x = bounds.minX - margin + rand() * w;
    const y = bounds.minY - margin + rand() * h;
    const outside = x < bounds.minX - 6 || x > bounds.maxX + 6 || y < bounds.minY - 6 || y > bounds.maxY + 6;
    if (outside) trees.push({ x, y, r: 4 + rand() * 4 });
  }
  const tufts = new Path2D();
  for (let i = 0; i < 520; i += 1) {
    const x = bounds.minX + rand() * (bounds.maxX - bounds.minX);
    const y = bounds.minY + rand() * (bounds.maxY - bounds.minY);
    const r = 0.5 + rand() * 1.1;
    tufts.moveTo(x + r, y);
    tufts.arc(x, y, r, 0, Math.PI * 2);
  }
  return { trees, tufts };
}

export function createRenderer(canvas, track) {
  const ctx = canvas.getContext('2d', { alpha: false });
  const road = buildRoadPath(track);
  const curbs = buildCurbPath(track);
  const scenery = buildScenery(track);
  const startPoint = track.points[0];

  const r = {
    ctx,
    canvas,
    track,
    road,
    curbs,
    scenery,
    startPoint,
    cam: { x: track.start.x, y: track.start.y, zoom: VIEW.zoomSlow },
    skids: [],
    skidHead: 0,
    lastWheels: null,
    smoke: [],
    smokeCarry: 0,
    ghostSprite: buildGhostSprite(),
    width: 0,
    height: 0,
    dpr: 1,
  };
  resize(r);
  return r;
}

export function resize(r) {
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const width = window.innerWidth;
  const height = window.innerHeight;
  r.canvas.width = Math.round(width * dpr);
  r.canvas.height = Math.round(height * dpr);
  r.width = width;
  r.height = height;
  r.dpr = dpr;
}

export function resetEffects(r, car) {
  r.skids.length = 0;
  r.skidHead = 0;
  r.lastWheels = null;
  r.smoke.length = 0;
  r.smokeCarry = 0;
  r.cam.x = car.x;
  r.cam.y = car.y;
}

function wheelPositions(x, y, heading) {
  const c = Math.cos(heading);
  const s = Math.sin(heading);
  const bx = x - c * CAR.axle;
  const by = y - s * CAR.axle;
  return [
    { x: bx - s * CAR.track, y: by + c * CAR.track },
    { x: bx + s * CAR.track, y: by - c * CAR.track },
  ];
}

function updateEffects(r, game, pose, dt) {
  const { car } = game;
  const slipAbs = Math.abs(car.slipAngle);
  const onGrass = car.surface === 'grass';
  const rearSliding = Math.abs(car.rearSlip) > FX.skidMinSlip || slipAbs > FX.skidMinSlip;
  const skidding = !onGrass && car.speed > FX.skidMinSpeed && rearSliding;

  const wheels = wheelPositions(pose.x, pose.y, pose.heading);
  if (skidding && r.lastWheels) {
    const alpha = Math.min(1, slipAbs / (35 * (Math.PI / 180)) + 0.35);
    for (let i = 0; i < 2; i += 1) {
      const seg = { ax: r.lastWheels[i].x, ay: r.lastWheels[i].y, bx: wheels[i].x, by: wheels[i].y, alpha };
      if (r.skids.length < FX.skidCapacity) r.skids.push(seg);
      else r.skids[r.skidHead] = seg;
      r.skidHead = (r.skidHead + 1) % FX.skidCapacity;
    }
  }
  r.lastWheels = wheels;

  // Smoke on the road, dust on the grass; both are capped and short-lived.
  let rate = 0;
  let kind = 'smoke';
  if (!onGrass && car.speed > FX.smokeMinSpeed && slipAbs > FX.smokeMinSlip) {
    rate = FX.smokeRate * Math.min(1, slipAbs / (45 * (Math.PI / 180)));
  } else if (onGrass && car.speed > FX.smokeMinSpeed) {
    rate = FX.dustRate * Math.min(1, car.speed / 25);
    kind = 'dust';
  }
  r.smokeCarry += rate * dt;
  while (r.smokeCarry >= 1) {
    r.smokeCarry -= 1;
    const w = wheels[Math.random() < 0.5 ? 0 : 1];
    const puff = {
      x: w.x,
      y: w.y,
      vx: car.vx * 0.12 + (Math.random() - 0.5) * 3,
      vy: car.vy * 0.12 + (Math.random() - 0.5) * 3,
      age: 0,
      kind,
      size: 0.9 + Math.random() * 0.8,
    };
    if (r.smoke.length >= FX.smokeCapacity) r.smoke.shift();
    r.smoke.push(puff);
  }
  for (let i = r.smoke.length - 1; i >= 0; i -= 1) {
    const p = r.smoke[i];
    p.age += dt;
    if (p.age >= FX.smokeLife) {
      r.smoke.splice(i, 1);
    } else {
      p.x += p.vx * dt;
      p.y += p.vy * dt;
    }
  }
}

function updateCamera(r, car, pose, dt) {
  const T = TUNING;
  const ratio = Math.min(1, car.speed / T.topSpeed);
  const scale = Math.max(0.75, r.height / VIEW.referenceHeight);
  const targetZoom = (VIEW.zoomSlow + (VIEW.zoomFast - VIEW.zoomSlow) * ratio) * scale;
  r.cam.zoom += (targetZoom - r.cam.zoom) * Math.min(1, VIEW.zoomRate * dt);

  let lx = car.vx * VIEW.lookAhead;
  let ly = car.vy * VIEW.lookAhead;
  const len = Math.hypot(lx, ly);
  if (len > VIEW.lookAheadMax) {
    lx *= VIEW.lookAheadMax / len;
    ly *= VIEW.lookAheadMax / len;
  }
  const f = Math.min(1, VIEW.followRate * dt);
  r.cam.x += (pose.x + lx - r.cam.x) * f;
  r.cam.y += (pose.y + ly - r.cam.y) * f;
}

function drawGrass(r) {
  const { ctx, track, cam } = r;
  const { bounds } = track;
  ctx.fillStyle = COLORS.grass;
  const hw = r.width / 2 / cam.zoom;
  const hh = r.height / 2 / cam.zoom;
  ctx.fillRect(cam.x - hw - 1, cam.y - hh - 1, hw * 2 + 2, hh * 2 + 2);

  // Mown stripes and tufts make speed readable when the car is off the road.
  ctx.fillStyle = COLORS.grassStripe;
  const band = 24;
  const first = Math.floor((cam.x - hw) / band);
  const last = Math.ceil((cam.x + hw) / band);
  for (let i = first; i <= last; i += 1) {
    if (i % 2 === 0) ctx.fillRect(i * band, cam.y - hh - 1, band, hh * 2 + 2);
  }
  ctx.fillStyle = COLORS.tuft;
  ctx.fill(r.scenery.tufts);

  // Darken the world beyond the perimeter barrier.
  ctx.fillStyle = '#2f7f3a';
  ctx.fillRect(cam.x - hw - 1, cam.y - hh - 1, hw * 2 + 2, bounds.minY - (cam.y - hh - 1));
  ctx.fillRect(cam.x - hw - 1, bounds.maxY, hw * 2 + 2, Math.max(0, cam.y + hh + 1 - bounds.maxY));
  ctx.fillRect(cam.x - hw - 1, bounds.minY, bounds.minX - (cam.x - hw - 1), bounds.maxY - bounds.minY);
  ctx.fillRect(bounds.maxX, bounds.minY, Math.max(0, cam.x + hw + 1 - bounds.maxX), bounds.maxY - bounds.minY);
}

function drawRoad(r) {
  const { ctx, track, road, curbs, startPoint } = r;
  const width = track.halfWidth * 2;
  ctx.lineJoin = 'round';
  ctx.lineCap = 'butt';

  ctx.setLineDash([]);
  ctx.strokeStyle = COLORS.curbWhite;
  ctx.lineWidth = width + track.curbWidth * 2;
  ctx.stroke(curbs);
  ctx.setLineDash([3.5, 3.5]);
  ctx.strokeStyle = COLORS.curbRed;
  ctx.stroke(curbs);
  ctx.setLineDash([]);

  ctx.strokeStyle = COLORS.line;
  ctx.lineWidth = width + 0.9;
  ctx.stroke(road);
  ctx.strokeStyle = COLORS.asphalt;
  ctx.lineWidth = width - 0.9;
  ctx.stroke(road);

  ctx.setLineDash([5, 9]);
  ctx.strokeStyle = COLORS.dash;
  ctx.lineWidth = 0.42;
  ctx.stroke(road);
  ctx.setLineDash([]);

  // Chequered start/finish line.
  ctx.save();
  ctx.translate(startPoint.x, startPoint.y);
  ctx.rotate(Math.atan2(startPoint.ty, startPoint.tx));
  const size = 1.25;
  const across = Math.round(width / size);
  for (let i = 0; i < across; i += 1) {
    for (let j = 0; j < 2; j += 1) {
      ctx.fillStyle = (i + j) % 2 ? '#f7f7f2' : '#121214';
      ctx.fillRect(-size + j * size, -width / 2 + i * (width / across), size, width / across);
    }
  }
  ctx.restore();
}

function drawSkids(r) {
  const { ctx, skids } = r;
  if (!skids.length) return;
  // Batching by chunk keeps this to a few stroke calls per frame.
  ctx.strokeStyle = COLORS.skid;
  ctx.lineWidth = 0.55;
  ctx.lineCap = 'round';
  for (let c = 0; c < skids.length; c += FX.skidChunk) {
    const end = Math.min(c + FX.skidChunk, skids.length);
    let alpha = 0;
    ctx.beginPath();
    for (let i = c; i < end; i += 1) {
      const s = skids[i];
      alpha += s.alpha;
      ctx.moveTo(s.ax, s.ay);
      ctx.lineTo(s.bx, s.by);
    }
    ctx.globalAlpha = FX.skidBaseAlpha * (alpha / (end - c));
    ctx.stroke();
  }
  ctx.globalAlpha = 1;
  ctx.lineCap = 'butt';
}

function drawWall(r) {
  const { ctx, track } = r;
  const { minX, maxX, minY, maxY } = track.bounds;
  ctx.setLineDash([]);
  ctx.strokeStyle = COLORS.wall;
  ctx.lineWidth = 1.6;
  ctx.strokeRect(minX - 0.8, minY - 0.8, maxX - minX + 1.6, maxY - minY + 1.6);
  ctx.strokeStyle = COLORS.wallTop;
  ctx.lineWidth = 0.7;
  ctx.setLineDash([2.4, 2.4]);
  ctx.strokeRect(minX - 0.8, minY - 0.8, maxX - minX + 1.6, maxY - minY + 1.6);
  ctx.setLineDash([]);
}

function drawTrees(r) {
  const { ctx, cam } = r;
  const hw = r.width / 2 / cam.zoom + 10;
  const hh = r.height / 2 / cam.zoom + 10;
  for (const t of r.scenery.trees) {
    if (Math.abs(t.x - cam.x) > hw || Math.abs(t.y - cam.y) > hh) continue;
    ctx.fillStyle = COLORS.treeDark;
    ctx.beginPath();
    ctx.arc(t.x, t.y, t.r, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = COLORS.treeLight;
    ctx.beginPath();
    ctx.arc(t.x - t.r * 0.25, t.y - t.r * 0.25, t.r * 0.62, 0, Math.PI * 2);
    ctx.fill();
  }
}

function drawSmoke(r) {
  const { ctx, smoke } = r;
  for (const p of smoke) {
    const life = p.age / FX.smokeLife;
    const radius = p.size * (0.7 + life * 2.2);
    if (p.kind === 'dust') {
      ctx.fillStyle = '#c6b184';
      ctx.globalAlpha = 0.42 * (1 - life);
    } else {
      ctx.fillStyle = '#ece9e2';
      ctx.globalAlpha = 0.46 * (1 - life);
    }
    ctx.beginPath();
    ctx.arc(p.x, p.y, radius, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.globalAlpha = 1;
}

function roundedRect(ctx, x, y, w, h, radius) {
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, radius);
}

function drawCar(ctx, car, pose) {
  const L = CAR.length;
  const W = CAR.width;
  ctx.save();
  ctx.translate(pose.x, pose.y);
  ctx.scale(CAR.drawScale, CAR.drawScale);

  // The shadow keeps a fixed offset in world space, so it reads while rotating.
  ctx.save();
  ctx.translate(0.28, 0.38);
  ctx.rotate(pose.heading);
  ctx.fillStyle = 'rgba(0,0,0,0.3)';
  roundedRect(ctx, -L / 2, -W / 2, L, W, 0.55);
  ctx.fill();
  ctx.restore();

  ctx.rotate(pose.heading);
  drawCarBody(ctx, car, COLORS);
  ctx.restore();
}

// Drawn nose-toward +x at the origin. Original artwork: a long-hooded, wide-hipped
// two-door shape, not based on any particular model.
function drawCarBody(ctx, car, colors) {
  const L = CAR.length;
  const W = CAR.width;

  // Tyres: the front pair turn with the steering, so input is visible.
  const tyre = (x, y, angle) => {
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(angle);
    ctx.fillStyle = colors.tyre;
    roundedRect(ctx, -0.5, -0.26, 1, 0.52, 0.12);
    ctx.fill();
    ctx.restore();
  };
  const wheelY = W / 2 - 0.1;
  tyre(1.45, -wheelY, car.wheelAngle);
  tyre(1.45, wheelY, car.wheelAngle);
  tyre(-1.48, -wheelY, 0);
  tyre(-1.48, wheelY, 0);

  // Body with haunches: narrower at the nose, widest over the rear wheels.
  ctx.fillStyle = colors.body;
  ctx.beginPath();
  ctx.moveTo(L / 2 - 0.12, -W * 0.34);
  ctx.quadraticCurveTo(L / 2, 0, L / 2 - 0.12, W * 0.34);
  ctx.quadraticCurveTo(L / 2 - 0.4, W * 0.45, 1.0, W * 0.46);
  ctx.lineTo(-0.7, W * 0.44);
  ctx.quadraticCurveTo(-1.4, W * 0.5, -L / 2 + 0.16, W * 0.45);
  ctx.quadraticCurveTo(-L / 2 - 0.02, 0, -L / 2 + 0.16, -W * 0.45);
  ctx.quadraticCurveTo(-1.4, -W * 0.5, -0.7, -W * 0.44);
  ctx.lineTo(1.0, -W * 0.46);
  ctx.quadraticCurveTo(L / 2 - 0.4, -W * 0.45, L / 2 - 0.12, -W * 0.34);
  ctx.closePath();
  ctx.fill();
  if (colors.outline) {
    ctx.strokeStyle = colors.outline;
    ctx.lineWidth = 0.16;
    ctx.stroke();
  }

  // Twin racing stripes, nose to tail.
  ctx.fillStyle = colors.stripe;
  ctx.fillRect(-L / 2 + 0.05, -0.34, L - 0.14, 0.24);
  ctx.fillRect(-L / 2 + 0.05, 0.1, L - 0.14, 0.24);

  // Greenhouse set well back: a long hood and a short rear deck.
  ctx.fillStyle = colors.glass;
  roundedRect(ctx, -1.35, -W * 0.36, 1.95, W * 0.72, 0.28);
  ctx.fill();
  ctx.fillStyle = colors.roof;
  roundedRect(ctx, -1.08, -W * 0.3, 1.1, W * 0.6, 0.16);
  ctx.fill();

  // Hood scoop.
  ctx.fillStyle = colors.bodyShade;
  roundedRect(ctx, 1.1, -0.18, 0.72, 0.36, 0.08);
  ctx.fill();

  // Bright lights at both ends, so front and rear can't be confused mid-spin.
  ctx.fillStyle = colors.headlight;
  roundedRect(ctx, L / 2 - 0.3, -W * 0.38, 0.26, 0.44, 0.1);
  ctx.fill();
  roundedRect(ctx, L / 2 - 0.3, W * 0.38 - 0.44, 0.26, 0.44, 0.1);
  ctx.fill();
  ctx.fillStyle = colors.taillight;
  ctx.fillRect(-L / 2 + 0.06, -W * 0.42, 0.2, 0.62);
  ctx.fillRect(-L / 2 + 0.06, W * 0.42 - 0.62, 0.2, 0.62);

  // The tail lights flare under braking or handbrake.
  if (car.brake > 0.2 || car.handbrake) {
    ctx.fillStyle = 'rgba(255,60,40,0.5)';
    ctx.beginPath();
    ctx.arc(-L / 2 + 0.1, -W * 0.3, 0.55, 0, Math.PI * 2);
    ctx.arc(-L / 2 + 0.1, W * 0.3, 0.55, 0, Math.PI * 2);
    ctx.fill();
  }
}

// One image, drawn once. Translucent layers would otherwise show through each other,
// and a single drawImage costs less each frame than repainting the car's shapes.
function buildGhostSprite() {
  const sprite = document.createElement('canvas');
  sprite.width = Math.ceil((CAR.length + 1) * GHOST_SPRITE_SCALE);
  sprite.height = Math.ceil((CAR.width + 1) * GHOST_SPRITE_SCALE);
  const ctx = sprite.getContext('2d');
  ctx.translate(sprite.width / 2, sprite.height / 2);
  ctx.scale(GHOST_SPRITE_SCALE, GHOST_SPRITE_SCALE);
  drawCarBody(ctx, GHOST_WHEELS, GHOST_COLORS);
  return sprite;
}

function drawGhost(r, ghost) {
  const { ctx, ghostSprite: sprite } = r;
  const scale = CAR.drawScale / GHOST_SPRITE_SCALE;
  ctx.save();
  ctx.translate(ghost.x, ghost.y);
  ctx.rotate(ghost.heading);
  ctx.scale(scale, scale);
  ctx.globalAlpha = ghost.opacity;
  ctx.drawImage(sprite, -sprite.width / 2, -sprite.height / 2);
  ctx.restore();
}

function drawDebugWorld(r, game, pose) {
  const { ctx, track } = r;
  const { car, laps } = game;
  ctx.lineWidth = 0.5;
  track.gates.forEach((g, i) => {
    ctx.strokeStyle = i === laps.next ? '#34e0ff' : i < laps.next ? 'rgba(90,255,140,0.7)' : 'rgba(255,255,255,0.45)';
    ctx.beginPath();
    ctx.moveTo(g.x1, g.y1);
    ctx.lineTo(g.x2, g.y2);
    ctx.stroke();
  });
  ctx.strokeStyle = '#34e0ff';
  ctx.lineWidth = 0.35;
  ctx.beginPath();
  ctx.moveTo(pose.x, pose.y);
  ctx.lineTo(pose.x + car.vx * 0.4, pose.y + car.vy * 0.4);
  ctx.stroke();
  ctx.strokeStyle = '#ffe14d';
  ctx.beginPath();
  ctx.moveTo(pose.x, pose.y);
  ctx.lineTo(pose.x + Math.cos(pose.heading) * 7, pose.y + Math.sin(pose.heading) * 7);
  ctx.stroke();
}

function drawMinimap(r, car, ghost) {
  const { ctx, track } = r;
  const { bounds } = track;
  const maxW = 170;
  const scale = Math.min(maxW / (bounds.maxX - bounds.minX), 130 / (bounds.maxY - bounds.minY));
  const w = (bounds.maxX - bounds.minX) * scale;
  const h = (bounds.maxY - bounds.minY) * scale;
  const ox = r.width - w - 16;
  const oy = r.height - h - 16;
  ctx.fillStyle = 'rgba(20,21,24,0.72)';
  ctx.beginPath();
  ctx.roundRect(ox - 6, oy - 6, w + 12, h + 12, 6);
  ctx.fill();
  ctx.save();
  ctx.translate(ox - bounds.minX * scale, oy - bounds.minY * scale);
  ctx.scale(scale, scale);
  ctx.strokeStyle = 'rgba(246,241,228,0.85)';
  ctx.lineWidth = 3.4 / scale;
  ctx.lineJoin = 'round';
  ctx.stroke(r.road);
  if (ghost) {
    ctx.fillStyle = GHOST_COLORS.body;
    ctx.beginPath();
    ctx.arc(ghost.x, ghost.y, 3.2 / scale, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.fillStyle = COLORS.body;
  ctx.beginPath();
  ctx.arc(car.x, car.y, 4 / scale, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

// The player's car is drawn one step behind the simulation, blending toward its
// latest position by `alpha`, so the ghost is sampled at that same moment.
function ghostForFrame(game, pose, alpha) {
  if (!game.ghost || !game.ghostVisible || game.state !== 'racing') return null;
  return ghostDisplay(game.ghost, game.ghost.lapTick - 1 + alpha, pose.x, pose.y);
}

// Draw one frame. `alpha` blends between the last two physics steps.
export function drawFrame(r, game, alpha, dt, debug) {
  const { ctx } = r;
  const { car, prev } = game;
  const blend = alpha;
  const pose = {
    x: prev.x + (car.x - prev.x) * blend,
    y: prev.y + (car.y - prev.y) * blend,
    heading: prev.heading + (car.heading - prev.heading) * blend,
  };
  const step = Math.min(dt, FX.maxDt);
  if (!game.paused && game.state !== 'finished' && game.state !== 'menu') updateEffects(r, game, pose, step);
  updateCamera(r, car, pose, step);
  const ghost = ghostForFrame(game, pose, blend);

  ctx.setTransform(r.dpr, 0, 0, r.dpr, 0, 0);
  ctx.save();
  ctx.translate(r.width / 2, r.height / 2);
  ctx.scale(r.cam.zoom, r.cam.zoom);
  ctx.translate(-r.cam.x, -r.cam.y);
  drawGrass(r);
  drawRoad(r);
  drawSkids(r);
  drawWall(r);
  if (ghost) drawGhost(r, ghost);
  drawCar(ctx, car, pose);
  drawSmoke(r);
  drawTrees(r);
  if (debug) drawDebugWorld(r, game, pose);
  ctx.restore();
  if (game.state !== 'menu') drawMinimap(r, car, ghost);
}
