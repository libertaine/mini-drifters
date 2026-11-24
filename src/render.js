// Everything drawn on the canvas: the circuit, the car, skid marks, smoke and the
// minimap. Nothing here feeds back into the simulation.
import { TUNING } from './tuning.js';
import { ghostDisplay } from './ghost.js';
import { drawPad } from './practice-pad.js';
import { drawChallenge, drawChallengeMap } from './gymkhana-draw.js';
import { TYRE_FX, createTyreEffectState, resetTyreEffectState, tyreEmission } from './tyre-effects.js';
import { buildDockyardScenery, drawDockyardGround, drawDockyardScenery } from './dockyard-scenery.js';
import { sceneryFor } from './scenery.js';
import { buildLandscape, drawLandscapeBelow, drawLandscapeAbove } from './scenery-draw.js';
import { drawUrbanAbove, blockadeCars } from './getaway-urban-draw.js';

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
// Getaway Drift's police car: the same artwork in black and white.
const POLICE_COLORS = {
  ...COLORS,
  body: '#f2f2ee',
  bodyShade: '#1a1c22',
  stripe: '#15171c',
  glass: '#1d2c3b',
  roof: '#f2f2ee',
  outline: '#15171c',
};
const GHOST_SPRITE_SCALE = 44; // pixels per metre of the car's artwork

// The title screen's poster: the real hairpin and the real car on a night-time palette.
const TITLE_COLORS = {
  ...COLORS,
  asphalt: '#34353b',
  line: '#f6f1e4',
  dash: '#ffb627',
  curbRed: '#cf4a1b',
  curbWhite: '#f6f1e4',
};
const TITLE = {
  ground: '#17181b',
  groundBand: '#1c1d21',
  anchor: { x: -94, y: 128 },  // where on the hairpin the car is posed, nearest centreline point
  focus: { x: -92, y: 134 },   // the world point placed at the centre of the visible area
  panelShare: 0.48,            // the part of the window behind the title panel
  rotation: Math.PI,           // turns the hairpin to open toward the panel
  viewWidth: 47,               // metres that must fit across the visible area...
  viewHeight: 42,              // ...and down it
  carScale: 2.5,               // a poster's exaggeration, on top of the usual draw scale
  slip: 62 * (Math.PI / 180),  // well past what the road's own curve can hide
  outwardOffset: 1.5,          // metres toward the outside of the corner
  countersteer: -0.62,         // front wheels against the slide, in radians
  sway: 1.5 * (Math.PI / 180), // the slide breathing, so the frame isn't dead
  skidPoints: 52,              // centreline samples of rubber behind the car
  skidWidth: 1.4,              // metres, about the poster car's tyre where the mark starts
  smokePuffs: 64,
  smokeReach: 19,              // how many of those samples the smoke follows before it's gone
  smokeSprite: 96,             // pixels across the one soft puff that every puff is drawn from
};

const VIEW = {
  zoomSlow: 11.5,         // pixels per metre near a standstill
  zoomFast: 8.2,          // pixels per metre at top speed
  zoomRate: 1.2,          // how quickly zoom follows speed, per second
  lookAhead: 0.75,        // seconds of velocity the camera leads the car by
  lookAheadMax: 28,       // metres
  followRate: 5,          // how tightly the camera follows, per second
  referenceHeight: 760,   // larger windows zoom in proportionally
};

// When the tyres mark, smoke or throw dust is decided in tyre-effects.js. These are the limits
// on what is kept and how it is drawn.
const FX = {
  skidCapacity: 1800,
  skidChunk: 300,
  skidBaseAlpha: 0.48,
  smokeCapacity: 110,
  smokeLife: 0.85,
  spinSmokeDrift: 1.2,    // m/s a wheelspin puff is thrown back from the spinning tyre
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

// Everything drawn for one circuit that only depends on its shape, worked out once.
function buildCourse(track) {
  return {
    track,
    road: buildRoadPath(track),
    curbs: buildCurbPath(track),
    scenery: buildScenery(track),
    dockyard: buildDockyardScenery(track),
    landscape: undefined, // Original's and Switchback's (scenery.js), built on first use: see landscapeOf
    startPoint: track.points[0],
  };
}

// The v0.6.0 R2 landscape for a circuit that has one, worked out the first time it is driven (the
// title poster's course never needs it).
function landscapeOf(course) {
  if (course.landscape === undefined) {
    const scenery = sceneryFor(course.track);
    course.landscape = scenery ? buildLandscape(course.track, scenery) : null;
  }
  return course.landscape;
}

// The poster always shows `titleTrack`, whichever circuit is being driven.
export function createRenderer(canvas, track, titleTrack = track) {
  const ctx = canvas.getContext('2d', { alpha: false });
  const courses = new Map();
  const r = {
    ctx,
    canvas,
    courses,
    course: null,
    track: null,
    cam: { x: track.start.x, y: track.start.y, zoom: VIEW.zoomSlow },
    skids: [],
    skidHead: 0,
    lastWheels: null,
    markAnchor: null,
    tyreState: createTyreEffectState(),
    smoke: [],
    smokeCarry: 0,
    // R2 visual polish state: purely cosmetic, bounded, cleared on reset, frozen on pause.
    sparks: [],
    papers: [],
    policeSkids: [],
    policeSkidHead: 0,
    policeSmoke: [],
    policeVisuals: new WeakMap(),
    paperCooldown: new Map(),
    shake: { mag: 0, x: 0, y: 0, phase: 0 },
    exhaust: { pop: 0, prevThrottle: 0 },
    lastImpactTick: -1,
    lastSmashCount: 0,
    lastChallengeRun: null,
    celebrate: null,
    fxTime: 0,
    ghostSprite: buildGhostSprite(),
    titleCourse: buildCourse(titleTrack),
    title: buildTitleScene(titleTrack),
    titleTime: 0,
    titleSmoke: buildSmokeSprite(),
    dustSprite: buildDustSprite(),
    glowRed: buildGlowSprite(255, 52, 48),
    glowBlue: buildGlowSprite(54, 128, 255),
    glowWarm: buildGlowSprite(255, 232, 168),
    titleStill: window.matchMedia('(prefers-reduced-motion: reduce)').matches,
    width: 0,
    height: 0,
    dpr: 1,
  };
  useTrack(r, track);
  resize(r);
  return r;
}

// Switches the driving view to another circuit. drawFrame calls this whenever the session's
// track differs, so the picture and the simulation can never show different circuits.
export function useTrack(r, track) {
  if (r.track === track) return;
  if (!r.courses.has(track)) r.courses.set(track, buildCourse(track));
  r.course = r.courses.get(track);
  r.track = track;
  clearTyreMarks(r);
  r.cam.x = track.start.x;
  r.cam.y = track.start.y;
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

// Every mark, puff and piece of tyre memory goes together, so nothing survives into a new run.
function clearTyreMarks(r) {
  r.skids.length = 0;
  r.skidHead = 0;
  r.lastWheels = null;
  r.markAnchor = null;
  resetTyreEffectState(r.tyreState);
  r.smoke.length = 0;
  r.smokeCarry = 0;
  r.sparks.length = 0;
  r.papers.length = 0;
  r.policeSkids.length = 0;
  r.policeSkidHead = 0;
  r.policeSmoke.length = 0;
  r.policeVisuals = new WeakMap();
  r.paperCooldown.clear();
  r.shake.mag = 0;
  r.shake.x = 0;
  r.shake.y = 0;
  r.exhaust.pop = 0;
  r.exhaust.prevThrottle = 0;
  r.lastImpactTick = -1;
  r.lastSmashCount = 0;
  r.lastChallengeRun = null;
  r.celebrate = null;
  r.fxTime = 0;
}

// A copy of what the effects hold, for the browser checks. Read-only.
export function effectsSnapshot(r) {
  const puffs = (test) => r.smoke.filter(test).length;
  return {
    skids: r.skids.length, skidCapacity: FX.skidCapacity, smoke: r.smoke.length, smokeCapacity: FX.smokeCapacity,
    spinPuffs: puffs((p) => p.spin), dust: puffs((p) => p.kind === 'dust'),
    oldestPuff: r.smoke.reduce((a, p) => Math.max(a, p.age), 0), spinMarking: r.tyreState.spinMarking,
    anchored: r.markAnchor !== null,
  };
}

export function resetEffects(r, car) {
  clearTyreMarks(r);
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

function pushSkid(r, a, b, alpha) {
  for (let i = 0; i < 2; i += 1) {
    const seg = { ax: a[i].x, ay: a[i].y, bx: b[i].x, by: b[i].y, alpha };
    if (r.skids.length < FX.skidCapacity) r.skids.push(seg);
    else r.skids[r.skidHead] = seg;
    r.skidHead = (r.skidHead + 1) % FX.skidCapacity;
  }
}

function updateEffects(r, game, pose, dt) {
  r.fxTime += dt;
  const { car } = game;
  const emit = tyreEmission(car, r.tyreState);

  // A slide's mark follows the tyres frame by frame, as it always has. Wheelspin alone lays its
  // rubber in pieces at least spinMarkMinLength long, joined end to end from where the last mark
  // stopped, so it is continuous, never a row of dots, and can't grow while the car stands still.
  const wheels = wheelPositions(pose.x, pose.y, pose.heading);
  if (emit.mark > 0 && !emit.spinMark) {
    const from = r.markAnchor ?? r.lastWheels; // the previous frame, or the end of a wheelspin mark
    if (from) pushSkid(r, from, wheels, emit.mark);
    r.markAnchor = wheels;
  } else if (emit.spinMark) {
    const anchor = r.markAnchor ?? r.lastWheels;
    const moved = anchor ? Math.hypot(wheels[0].x - anchor[0].x, wheels[0].y - anchor[0].y) : 0;
    if (!anchor || moved > TYRE_FX.spinMarkMaxJump) {
      r.markAnchor = wheels;
    } else if (moved >= TYRE_FX.spinMarkMinLength) {
      pushSkid(r, anchor, wheels, emit.mark);
      r.markAnchor = wheels;
    } else {
      r.markAnchor = anchor;
    }
  } else {
    r.markAnchor = null;
  }
  r.lastWheels = wheels;

  // Smoke on the road, dust on the grass; both are capped and short-lived. Wheelspin smoke is
  // thrown back off the spinning tyres and hangs where it was made, rather than following the car.
  const { smokeKind: kind, smokeStrength: strength, wheelspinSmoke } = emit;
  const carry = wheelspinSmoke ? 0.06 : 0.12;
  const back = wheelspinSmoke ? FX.spinSmokeDrift : 0;
  const hx = Math.cos(pose.heading);
  const hy = Math.sin(pose.heading);
  r.smokeCarry += emit.smokeRate * dt;
  while (r.smokeCarry >= 1) {
    r.smokeCarry -= 1;
    const w = wheels[Math.random() < 0.5 ? 0 : 1];
    const puff = {
      x: w.x,
      y: w.y,
      vx: car.vx * carry - hx * back + (Math.random() - 0.5) * 3,
      vy: car.vy * carry - hy * back + (Math.random() - 0.5) * 3,
      age: 0,
      kind,
      strength,
      spin: wheelspinSmoke,
      size: 0.95 + Math.random() * 0.85,
      rot: Math.random() * Math.PI * 2,
      vrot: (Math.random() - 0.5) * 1.8,
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
      p.rot += (p.vrot ?? 0) * dt;
    }
  }

  updatePolishEffects(r, game, pose, dt);
}

// Secondary cosmetic effects: impact sparks & shake, twin exhaust pops, urban slipstream
// flyers, and pursuing police skid marks / smoke. Strictly bounded and read-only on `game`.
const SOFT_IMPACT = new Set(['tree', 'pine', 'stand', 'tyrewall', 'tyres', 'planter']);
function pushPoliceSkid(r, a, b, alpha) {
  for (let i = 0; i < 2; i += 1) {
    const seg = { ax: a[i].x, ay: a[i].y, bx: b[i].x, by: b[i].y, alpha };
    if (r.policeSkids.length < 320) r.policeSkids.push(seg);
    else r.policeSkids[r.policeSkidHead] = seg;
    r.policeSkidHead = (r.policeSkidHead + 1) % 320;
  }
}

function addShake(r, amount) {
  if (r.titleStill) return;
  r.shake.mag = Math.min(5.2, Math.max(r.shake.mag, amount));
}

function updatePolishEffects(r, game, pose, dt) {
  const { car } = game;

  // 1. Twin exhaust backfire pop on sharp throttle lift from high speed/load.
  if (r.exhaust.prevThrottle > 0.65 && car.throttle < 0.2 && car.speed > 14) {
    r.exhaust.pop = 0.13;
  } else {
    r.exhaust.pop = Math.max(0, r.exhaust.pop - dt);
  }
  r.exhaust.prevThrottle = car.throttle;

  // 2. Impact sparks (cream-gold, 0.28 s max life) and micro-camera shake.
  const hit = game.lastContact;
  const freshObstacle = hit && hit.tick !== r.lastImpactTick && (game.ticks - hit.tick) <= 4 && hit.impact > 3;
  const freshBarrier = !freshObstacle && game.lastImpact > 3.5 && game.ticks !== r.lastImpactTick;
  if (freshObstacle || freshBarrier) {
    r.lastImpactTick = freshObstacle ? hit.tick : game.ticks;
    const impact = freshObstacle ? hit.impact : game.lastImpact;
    const power = Math.min(1, impact / 22);
    addShake(r, 1.4 + power * 3.6);
    const soft = freshObstacle && SOFT_IMPACT.has(hit.kind);
    const sx = freshObstacle ? hit.x : pose.x + Math.cos(pose.heading) * 1.8;
    const sy = freshObstacle ? hit.y : pose.y + Math.sin(pose.heading) * 1.8;
    const nx = freshObstacle ? hit.nx : -Math.cos(pose.heading);
    const ny = freshObstacle ? hit.ny : -Math.sin(pose.heading);
    const baseAngle = Math.atan2(ny, nx);
    const count = Math.round(5 + power * 9);
    for (let i = 0; i < count; i += 1) {
      const spread = (Math.random() - 0.5) * 1.9;
      const spd = (6 + Math.random() * 14) * (0.5 + 0.7 * power);
      const a = baseAngle + spread;
      if (r.sparks.length >= 48) r.sparks.shift();
      r.sparks.push({
        x: sx + (Math.random() - 0.5) * 0.6,
        y: sy + (Math.random() - 0.5) * 0.6,
        vx: Math.cos(a) * spd + car.vx * 0.25,
        vy: Math.sin(a) * spd + car.vy * 0.25,
        age: 0,
        life: 0.14 + Math.random() * 0.14,
        soft,
      });
    }
  }

  // Advance sparks.
  for (let i = r.sparks.length - 1; i >= 0; i -= 1) {
    const sp = r.sparks[i];
    sp.age += dt;
    if (sp.age >= sp.life) {
      r.sparks.splice(i, 1);
    } else {
      sp.x += sp.vx * dt;
      sp.y += sp.vy * dt;
      sp.vx *= Math.exp(-5 * dt);
      sp.vy *= Math.exp(-5 * dt);
    }
  }

  // 3. Urban reactions: smash camera jolt, slipstream street flyers, and police pursuit skids/smoke.
  const urban = game.mode === 'gymkhana' && game.challengeDef?.layout === 'urban' && game.challenge;
  if (urban) {
    const run = game.challenge;
    const city = game.challengeDef.geometry.city;
    if (run !== r.lastChallengeRun) {
      r.lastChallengeRun = run;
      r.lastSmashCount = run.smashes ?? 0;
    }
    if ((run.smashes ?? 0) > r.lastSmashCount) {
      r.lastSmashCount = run.smashes;
      addShake(r, 2.8);
    }

    // Slipstream newspapers/flyers swirling up when speeding past newsstands, dumpsters or stalls.
    if (car.speed > 19) {
      const now = run.time;
      const hx = Math.cos(pose.heading);
      const hy = Math.sin(pose.heading);
      for (const prop of city.props) {
        if (prop.kind !== 'kiosk' && prop.kind !== 'dumpster') continue;
        const px = (prop.minX + prop.maxX) / 2;
        const py = (prop.minY + prop.maxY) / 2;
        if (Math.hypot(pose.x - px, pose.y - py) > 11) continue;
        const readyAt = r.paperCooldown.get(prop.source) ?? -Infinity;
        if (now < readyAt) continue;
        r.paperCooldown.set(prop.source, now + 2.6);
        const burst = Math.min(6, Math.round(3 + (car.speed - 19) * 0.2));
        for (let k = 0; k < burst; k += 1) {
          if (r.papers.length >= 28) r.papers.shift();
          const side = (Math.random() - 0.5) * 2;
          r.papers.push({
            x: px + (Math.random() - 0.5) * 2.2,
            y: py + (Math.random() - 0.5) * 2.2,
            vx: car.vx * (0.28 + Math.random() * 0.22) - hy * side * 3.5,
            vy: car.vy * (0.28 + Math.random() * 0.22) + hx * side * 3.5,
            rot: Math.random() * Math.PI * 2,
            vrot: (Math.random() - 0.5) * 14,
            age: 0,
            life: 1.0 + Math.random() * 0.55,
            tint: k % 3 === 0 ? '#e4decb' : '#f6f1e4',
          });
        }
      }
    }

    // Police cruiser visual kinematics (front wheel steer, brake lights, pursuit skids & smoke).
    const units = run.police ?? (run.pursuer ? [run.pursuer] : []);
    for (const u of units) {
      const vis = r.policeVisuals.get(u) ?? {
        prevSpeed: u.speed ?? 0,
        prevHeading: u.heading ?? 0,
        wheelAngle: 0,
        braking: 0,
        lastWheels: null,
        smokeCarry: 0,
      };
      const stepDt = Math.max(dt, 1 / 120);
      const dh = Math.atan2(Math.sin(u.heading - vis.prevHeading), Math.cos(u.heading - vis.prevHeading));
      const yawRate = dh / stepDt;
      const targetWheel = Math.max(-0.55, Math.min(0.55, yawRate * 0.26));
      vis.wheelAngle += (targetWheel - vis.wheelAngle) * Math.min(1, 14 * dt);
      const decel = (vis.prevSpeed - (u.speed ?? 0)) / stepDt;
      const targetBrake = decel > 2.2 || u.state === 'reversing' ? 1 : 0;
      vis.braking += (targetBrake - vis.braking) * Math.min(1, 16 * dt);
      vis.prevSpeed = u.speed ?? 0;
      vis.prevHeading = u.heading;

      const chasing = u.lights || u.mode === 'pursue' || u.mode === 'respond' || (!run.police && run.time >= (game.challengeDef.pursuerTuning?.delay ?? 0));
      const latAccel = Math.abs(yawRate) * Math.abs(u.speed ?? 0);
      const hardSlide = chasing && Math.abs(u.speed ?? 0) > 8 && (latAccel > 7.2 || decel > 8.5);
      const pWheels = wheelPositions(u.x, u.y, u.heading);
      if (hardSlide && vis.lastWheels) {
        const jump = Math.hypot(pWheels[0].x - vis.lastWheels[0].x, pWheels[0].y - vis.lastWheels[0].y);
        if (jump < 6) pushPoliceSkid(r, vis.lastWheels, pWheels, Math.min(0.85, 0.35 + latAccel * 0.04));
        vis.smokeCarry += 16 * dt;
        while (vis.smokeCarry >= 1) {
          vis.smokeCarry -= 1;
          const w = pWheels[Math.random() < 0.5 ? 0 : 1];
          if (r.policeSmoke.length >= 36) r.policeSmoke.shift();
          r.policeSmoke.push({
            x: w.x, y: w.y,
            vx: (Math.random() - 0.5) * 2.4, vy: (Math.random() - 0.5) * 2.4,
            age: 0, size: 0.75 + Math.random() * 0.55,
          });
        }
      }
      vis.lastWheels = pWheels;
      r.policeVisuals.set(u, vis);
    }
  }

  for (let i = r.papers.length - 1; i >= 0; i -= 1) {
    const f = r.papers[i];
    f.age += dt;
    if (f.age >= f.life) {
      r.papers.splice(i, 1);
    } else {
      f.x += f.vx * dt;
      f.y += f.vy * dt;
      f.vx *= Math.exp(-2.1 * dt);
      f.vy *= Math.exp(-2.1 * dt);
      f.rot += f.vrot * dt;
      f.vrot *= Math.exp(-1.8 * dt);
    }
  }
  for (let i = r.policeSmoke.length - 1; i >= 0; i -= 1) {
    const p = r.policeSmoke[i];
    p.age += dt;
    if (p.age >= 0.65) r.policeSmoke.splice(i, 1);
    else { p.x += p.vx * dt; p.y += p.vy * dt; }
  }

  // 4. Decay micro-camera shake smoothly.
  if (r.shake.mag > 0.05) {
    r.shake.phase += dt * 62;
    r.shake.mag *= Math.exp(-15 * dt);
    r.shake.x = Math.cos(r.shake.phase) * r.shake.mag;
    r.shake.y = Math.sin(r.shake.phase * 1.37) * r.shake.mag;
  } else {
    r.shake.mag = 0;
    r.shake.x = 0;
    r.shake.y = 0;
  }
}

function updateCamera(r, car, pose, dt, game) {
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
  // Before a gymkhana run starts, the view sits between the car and the challenge, so what is
  // being asked can be read from the line.
  const focus = game.mode === 'gymkhana' && game.state === 'ready' ? game.challengeDef?.focus : null;
  if (focus) {
    lx = (focus.x - pose.x) / 2;
    ly = (focus.y - pose.y) / 2;
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
  ctx.fill(r.course.scenery.tufts);

  // Darken the world beyond the perimeter barrier.
  ctx.fillStyle = '#2f7f3a';
  ctx.fillRect(cam.x - hw - 1, cam.y - hh - 1, hw * 2 + 2, bounds.minY - (cam.y - hh - 1));
  ctx.fillRect(cam.x - hw - 1, bounds.maxY, hw * 2 + 2, Math.max(0, cam.y + hh + 1 - bounds.maxY));
  ctx.fillRect(cam.x - hw - 1, bounds.minY, bounds.minX - (cam.x - hw - 1), bounds.maxY - bounds.minY);
  ctx.fillRect(bounds.maxX, bounds.minY, Math.max(0, cam.x + hw + 1 - bounds.maxX), bounds.maxY - bounds.minY);
}

function drawRoad(ctx, course, colors = COLORS) {
  const { track, road, curbs, startPoint } = course;
  const width = track.halfWidth * 2;
  ctx.lineJoin = 'round';
  ctx.lineCap = 'butt';

  ctx.setLineDash([]);
  ctx.strokeStyle = colors.curbWhite;
  ctx.lineWidth = width + track.curbWidth * 2;
  ctx.stroke(curbs);
  ctx.setLineDash([3.5, 3.5]);
  ctx.strokeStyle = colors.curbRed;
  ctx.stroke(curbs);
  ctx.setLineDash([]);

  ctx.strokeStyle = colors.line;
  ctx.lineWidth = width + 0.9;
  ctx.stroke(road);
  ctx.strokeStyle = colors.asphalt;
  ctx.lineWidth = width - 0.9;
  ctx.stroke(road);

  ctx.setLineDash([5, 9]);
  ctx.strokeStyle = colors.dash;
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
  const { ctx, skids, policeSkids } = r;
  ctx.strokeStyle = COLORS.skid;
  ctx.lineCap = 'round';
  if (policeSkids.length) {
    ctx.lineWidth = 0.44;
    ctx.beginPath();
    for (const s of policeSkids) {
      ctx.moveTo(s.ax, s.ay);
      ctx.lineTo(s.bx, s.by);
    }
    ctx.globalAlpha = 0.34;
    ctx.stroke();
  }
  if (skids.length) {
    // Batching by chunk keeps this to a few stroke calls per frame.
    ctx.lineWidth = 0.58;
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
  for (const t of r.course.scenery.trees) {
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
  const { ctx, smoke, policeSmoke, titleSmoke, dustSprite } = r;
  for (const p of policeSmoke) {
    const life = p.age / 0.65;
    const radius = p.size * (0.75 + Math.sqrt(life) * 2.1);
    ctx.globalAlpha = 0.42 * (1 - life) ** 1.4;
    ctx.drawImage(titleSmoke, p.x - radius, p.y - radius, radius * 2, radius * 2);
  }
  for (const p of smoke) {
    const life = p.age / FX.smokeLife;
    const sprite = p.kind === 'dust' ? dustSprite : titleSmoke;
    const radius = p.size * (0.85 + Math.sqrt(life) * 2.65);
    const fadeIn = Math.min(1, life * 16);
    const base = p.kind === 'dust' ? 0.54 : 0.62;
    ctx.globalAlpha = base * fadeIn * (1 - life) ** 1.55 * p.strength;
    ctx.drawImage(sprite, p.x - radius, p.y - radius, radius * 2, radius * 2);
  }
  ctx.globalAlpha = 1;
}

function drawSparksAndPapers(r) {
  const { ctx, sparks, papers } = r;
  if (papers.length) {
    for (const f of papers) {
      const life = f.age / f.life;
      ctx.save();
      ctx.globalAlpha = Math.min(1, (1 - life) * 1.4) * 0.88;
      ctx.translate(f.x, f.y);
      ctx.rotate(f.rot);
      ctx.fillStyle = f.tint;
      const flutter = 0.45 + 0.55 * Math.abs(Math.cos(f.age * 11 + f.rot));
      ctx.fillRect(-0.42, -0.28 * flutter, 0.84, 0.56 * flutter);
      ctx.restore();
    }
  }
  if (sparks.length) {
    ctx.lineCap = 'round';
    for (const sp of sparks) {
      const life = sp.age / sp.life;
      const a = 1 - life;
      if (sp.soft) {
        ctx.globalAlpha = 0.72 * a;
        ctx.fillStyle = '#8b9e5a';
        ctx.beginPath();
        ctx.arc(sp.x, sp.y, 0.24 + life * 0.2, 0, Math.PI * 2);
        ctx.fill();
      } else {
        // White-hot steel-on-concrete spark streaks (clean high-contrast & distinct from debug orange).
        ctx.globalAlpha = 0.95 * a;
        ctx.strokeStyle = life < 0.45 ? '#fffef5' : '#dceeff';
        ctx.lineWidth = 0.22 * (1 - life * 0.4);
        ctx.beginPath();
        ctx.moveTo(sp.x, sp.y);
        ctx.lineTo(sp.x - sp.vx * 0.032, sp.y - sp.vy * 0.032);
        ctx.stroke();
      }
    }
    ctx.globalAlpha = 1;
    ctx.lineCap = 'butt';
  }
}

function drawHeadlightCones(ctx, x, y, heading, range = 16, width = 5.2, alpha = 0.22) {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(heading);
  const grad = ctx.createLinearGradient(2.4, 0, 2.4 + range, 0);
  grad.addColorStop(0, `rgba(255, 240, 185, ${alpha})`);
  grad.addColorStop(0.55, `rgba(255, 232, 162, ${alpha * 0.42})`);
  grad.addColorStop(1, 'rgba(255, 232, 162, 0)');
  ctx.fillStyle = grad;
  ctx.beginPath();
  ctx.moveTo(2.4, -1.1);
  ctx.lineTo(2.4 + range, -width);
  ctx.lineTo(2.4 + range, width);
  ctx.lineTo(2.4, 1.1);
  ctx.closePath();
  ctx.fill();
  ctx.restore();
}

function drawSpeedLines(r, car) {
  if (r.titleStill || car.speed < 32) return;
  const { ctx, width, height } = r;
  const strength = Math.min(1, (car.speed - 32) / 10);
  const dir = Math.atan2(car.vy, car.vx);
  const cos = Math.cos(dir);
  const sin = Math.sin(dir);
  const now = r.fxTime;
  ctx.save();
  ctx.setTransform(r.dpr, 0, 0, r.dpr, 0, 0);
  ctx.strokeStyle = `rgba(246, 241, 228, ${(0.07 + 0.09 * strength).toFixed(3)})`;
  ctx.lineWidth = 1.5;
  ctx.lineCap = 'round';
  const count = 10;
  const cx = width / 2;
  const cy = height / 2;
  const rad = Math.hypot(cx, cy);
  for (let i = 0; i < count; i += 1) {
    const a = (i / count) * Math.PI * 2 + 0.31;
    // Only around the outer 28% perimeter so the centre road stays completely clear.
    const band = ((now * 2.6 + i * 0.37) % 1);
    const dist = rad * (0.68 + band * 0.28);
    const px = cx + Math.cos(a) * dist;
    const py = cy + Math.sin(a) * dist;
    const len = (24 + strength * 36) * (0.6 + 0.4 * band);
    ctx.beginPath();
    ctx.moveTo(px - cos * len * 0.5, py - sin * len * 0.5);
    ctx.lineTo(px + cos * len * 0.5, py + sin * len * 0.5);
    ctx.stroke();
  }
  ctx.restore();
}

function roundedRect(ctx, x, y, w, h, radius) {
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, radius);
}

function drawCar(ctx, car, pose, urban = false, exhaustPop = 0) {
  const L = CAR.length;
  const W = CAR.width;
  if (urban) drawHeadlightCones(ctx, pose.x, pose.y, pose.heading, 17, 5.2, 0.20);
  ctx.save();
  ctx.translate(pose.x, pose.y);
  ctx.scale(CAR.drawScale, CAR.drawScale);

  // The shadow keeps a fixed offset in world space, so it reads while rotating.
  ctx.save();
  ctx.translate(0.28, 0.38);
  ctx.rotate(pose.heading);
  ctx.fillStyle = 'rgba(0,0,0,0.34)';
  roundedRect(ctx, -L / 2, -W / 2, L, W, 0.55);
  ctx.fill();
  ctx.restore();

  ctx.rotate(pose.heading);
  // Subtle red brake-light pool spilled onto the asphalt behind the tail under braking.
  if (car.brake > 0.2 || car.handbrake) {
    ctx.fillStyle = urban ? 'rgba(255,48,36,0.28)' : 'rgba(255,48,36,0.16)';
    ctx.beginPath();
    ctx.ellipse(-L / 2 - 0.85, 0, 1.35, W * 0.62, 0, 0, Math.PI * 2);
    ctx.fill();
  }
  // Twin exhaust backfire flame flicker on sharp throttle lift from speed.
  if (exhaustPop > 0) {
    const t = exhaustPop / 0.13;
    const len = (0.65 + 0.55 * t);
    for (const py of [-0.42, 0.42]) {
      ctx.fillStyle = `rgba(185, 222, 255, ${(0.82 * t).toFixed(2)})`;
      ctx.beginPath();
      ctx.moveTo(-L / 2 + 0.05, py - 0.14);
      ctx.lineTo(-L / 2 - len, py);
      ctx.lineTo(-L / 2 + 0.05, py + 0.14);
      ctx.closePath();
      ctx.fill();
      ctx.fillStyle = `rgba(255, 252, 232, ${(0.95 * t).toFixed(2)})`;
      ctx.beginPath();
      ctx.moveTo(-L / 2 + 0.05, py - 0.07);
      ctx.lineTo(-L / 2 - len * 0.55, py);
      ctx.lineTo(-L / 2 + 0.05, py + 0.07);
      ctx.closePath();
      ctx.fill();
    }
  }
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
  drawDebugContact(ctx, game, pose);
}

// Debug only: the solid scenery's collision boxes (filled gaps dashed), the car's contact circle,
// and the most recent hit, which fades over a second.
function drawDebugContact(ctx, game, pose) {
  const boxes = game.obstacles ?? [];
  if (!boxes.length) return;
  ctx.save();
  ctx.lineWidth = 0.3;
  for (const b of boxes) {
    ctx.strokeStyle = b.filled ? 'rgba(255,140,60,0.6)' : '#ff8c3c';
    ctx.setLineDash(b.filled ? [0.8, 0.6] : []);
    if (b.shape === 'capsule') {
      // The capsule's true outline: two sides and the round ends (a circle when it has no length).
      const a = Math.atan2(b.by - b.ay, b.bx - b.ax);
      ctx.beginPath();
      ctx.arc(b.bx, b.by, b.radius, a - Math.PI / 2, a + Math.PI / 2);
      ctx.arc(b.ax, b.ay, b.radius, a + Math.PI / 2, a + Math.PI * 1.5);
      ctx.closePath();
      ctx.stroke();
    } else if (b.shape === 'poly') {
      ctx.beginPath();
      b.points.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
      ctx.closePath();
      ctx.stroke();
    } else ctx.strokeRect(b.minX, b.minY, b.maxX - b.minX, b.maxY - b.minY);
  }
  ctx.setLineDash([]);
  ctx.strokeStyle = game.onCourse ? 'rgba(90,255,140,0.8)' : 'rgba(255,90,90,0.9)';
  ctx.beginPath();
  ctx.arc(pose.x, pose.y, TUNING.carRadius, 0, Math.PI * 2);
  ctx.stroke();
  const hit = game.lastContact;
  const age = hit ? (game.ticks - hit.tick) * TUNING.simStep : Infinity;
  if (age < 1) {
    const hard = hit.impact >= TUNING.barrierSignificantImpact;
    ctx.globalAlpha = 1 - age;
    ctx.strokeStyle = hard ? '#ff3b3b' : '#ffe14d';
    ctx.lineWidth = 0.4;
    ctx.beginPath();
    ctx.arc(hit.x, hit.y, 0.6 + Math.min(hit.impact, 30) * 0.08, 0, Math.PI * 2);
    ctx.moveTo(hit.x, hit.y);
    ctx.lineTo(hit.x + hit.nx * 4, hit.y + hit.ny * 4);
    ctx.stroke();
  }
  ctx.restore();
}

function drawMinimap(r, car, ghost, game) {
  const { ctx, track } = r;
  const { bounds } = track;
  // Getaway Drift in town: a larger map, with the HUD's navigation chip on it.
  const urban = game.mode === 'gymkhana' && game.challengeDef?.layout === 'urban';
  const maxW = urban ? 210 : 170;
  const scale = Math.min(maxW / (bounds.maxX - bounds.minX), (urban ? 150 : 130) / (bounds.maxY - bounds.minY));
  const w = (bounds.maxX - bounds.minX) * scale;
  const h = (bounds.maxY - bounds.minY) * scale;
  const ox = r.width - w - 16;
  const oy = r.height - h - 16;
  ctx.fillStyle = 'rgba(19,20,23,0.84)';
  ctx.beginPath();
  ctx.roundRect(ox - 6, oy - 6, w + 12, h + 12, 6);
  ctx.fill();
  ctx.strokeStyle = 'rgba(246,241,228,0.14)';
  ctx.lineWidth = 1;
  ctx.stroke();
  ctx.save();
  ctx.beginPath();
  ctx.roundRect(ox - 6, oy - 6, w + 12, h + 12, 6);
  ctx.clip();
  ctx.translate(ox - bounds.minX * scale, oy - bounds.minY * scale);
  ctx.scale(scale, scale);
  ctx.strokeStyle = 'rgba(246,241,228,0.85)';
  ctx.lineWidth = 3.4 / scale;
  ctx.lineJoin = 'round';
  if (!track.pad) ctx.stroke(r.course.road);
  if (game.mode === 'gymkhana' && game.challenge) drawChallengeMap(ctx, game, 1 / scale);
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

// Works out the posed slide once: the car, the rubber it has laid and its smoke.
export function buildTitleScene(track) {
  const { points } = track;
  const n = points.length;
  let at = 0;
  let nearest = Infinity;
  points.forEach((p, i) => {
    const d = Math.hypot(p.x - TITLE.anchor.x, p.y - TITLE.anchor.y);
    if (d < nearest) {
      nearest = d;
      at = i;
    }
  });
  // The hairpin turns right, so left of travel, (ty, -tx), is the outside of the corner.
  const poseAt = (i, slip, offset) => {
    const p = points[(i + n) % n];
    return { x: p.x + p.ty * offset, y: p.y - p.tx * offset, heading: Math.atan2(p.ty, p.tx) + slip };
  };
  // Where the poster car's rear tyres are at a pose, at the size the car is drawn.
  const size = TITLE.carScale * CAR.drawScale;
  const tyres = (pose) => wheelPositions(pose.x, pose.y, pose.heading).map((w) => ({
    x: pose.x + (w.x - pose.x) * size,
    y: pose.y + (w.y - pose.y) * size,
  }));
  const pose = poseAt(at, TITLE.slip, TITLE.outwardOffset);
  // Row 0 is under the tyres. Going back in time the slide eases out, so the marks swing in
  // from a straight entry the way a car's would, with no jump anywhere along them.
  const skids = Array.from({ length: TITLE.skidPoints }, (_, k) => {
    const ease = 1 - k / TITLE.skidPoints;
    const fade = ease * ease * (3 - 2 * ease);
    return tyres(poseAt(at - k, TITLE.slip * fade, TITLE.outwardOffset * fade));
  });
  const rand = scatter(11);
  const puffs = Array.from({ length: TITLE.smokePuffs }, (_, i) => ({
    phase: i / TITLE.smokePuffs,
    side: i % 2,
    across: rand() - 0.5,
    reach: 0.75 + rand() * 0.5,
    size: 0.8 + rand() * 0.5,
  }));
  return { pose, size, travel: Math.atan2(points[at].ty, points[at].tx), skids, puffs };
}

function buildSmokeSprite() {
  const size = TITLE.smokeSprite;
  const sprite = document.createElement('canvas');
  sprite.width = size;
  sprite.height = size;
  const ctx = sprite.getContext('2d');
  const glow = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  // Nearly solid to most of its width, so puffs read as billows and not as a glow.
  glow.addColorStop(0, 'rgba(240,237,230,1)');
  glow.addColorStop(0.62, 'rgba(240,237,230,0.82)');
  glow.addColorStop(0.86, 'rgba(240,237,230,0.22)');
  glow.addColorStop(1, 'rgba(240,237,230,0)');
  ctx.fillStyle = glow;
  ctx.fillRect(0, 0, size, size);
  return sprite;
}

function buildDustSprite() {
  const size = TITLE.smokeSprite;
  const sprite = document.createElement('canvas');
  sprite.width = size;
  sprite.height = size;
  const ctx = sprite.getContext('2d');
  const glow = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  glow.addColorStop(0, 'rgba(202,181,134,1)');
  glow.addColorStop(0.58, 'rgba(194,171,122,0.78)');
  glow.addColorStop(0.85, 'rgba(182,158,108,0.22)');
  glow.addColorStop(1, 'rgba(182,158,108,0)');
  ctx.fillStyle = glow;
  ctx.fillRect(0, 0, size, size);
  return sprite;
}

function buildGlowSprite(r, g, b) {
  const size = 96;
  const sprite = document.createElement('canvas');
  sprite.width = size;
  sprite.height = size;
  const ctx = sprite.getContext('2d');
  const grad = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  grad.addColorStop(0, `rgba(${r},${g},${b},0.65)`);
  grad.addColorStop(0.35, `rgba(${r},${g},${b},0.32)`);
  grad.addColorStop(0.7, `rgba(${r},${g},${b},0.09)`);
  grad.addColorStop(1, `rgba(${r},${g},${b},0)`);
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, size, size);
  return sprite;
}

// Solid colours that fade into the asphalt: translucent segments would show their joins.
function drawTitleSkids(ctx, skids) {
  ctx.lineCap = 'round';
  for (let k = 1; k < skids.length; k += 1) {
    const left = 1 - k / skids.length;
    const rubber = 0.95 * Math.sqrt(left);
    const [r, g, b] = [[52, 8], [53, 8], [59, 10]].map(([road, mark]) => Math.round(road + (mark - road) * rubber));
    ctx.strokeStyle = `rgb(${r},${g},${b})`;
    ctx.lineWidth = TITLE.skidWidth * (0.55 + 0.45 * left);
    ctx.beginPath();
    for (const side of [0, 1]) {
      ctx.moveTo(skids[k - 1][side].x, skids[k - 1][side].y);
      ctx.lineTo(skids[k][side].x, skids[k][side].y);
    }
    ctx.stroke();
  }
}

// The puffs loop on a fixed cycle: each leaves a rear tyre small and dense, then follows
// its skid mark back along the road, swelling and thinning as it goes.
function drawTitleSmoke(ctx, scene, sprite, time) {
  const { skids, puffs } = scene;
  for (const puff of puffs) {
    const life = (puff.phase + time * 0.34) % 1;
    const along = Math.min(skids.length - 2, TITLE.smokeReach * puff.reach * life);
    const row = Math.floor(along);
    const a = skids[row][puff.side];
    const b = skids[row + 1][puff.side];
    const t = along - row;
    // The path's own sideways direction, so the spread stays across the trail around the bend.
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const length = Math.hypot(dx, dy) || 1;
    const spread = 4 * puff.across * life;
    const x = a.x + dx * t - (dy / length) * spread;
    const y = a.y + dy * t + (dx / length) * spread;
    const radius = puff.size * (1.4 + Math.sqrt(life) * 3.9);
    ctx.globalAlpha = 0.58 * (1 - life) ** 2.4 * Math.min(1, life * 24);
    ctx.drawImage(sprite, x - radius, y - radius, radius * 2, radius * 2);
  }
  ctx.globalAlpha = 1;
}

// The car's shadow goes under the smoke and its body over it, so the tyres stay crisp and
// the smoke comes out from beneath them. The shadow would dirty the smoke the other way up.
function drawTitleCar(ctx, scene, sprite, time) {
  const { pose, size } = scene;
  const heading = pose.heading + Math.sin(time * 1.3) * TITLE.sway;
  ctx.save();
  ctx.translate(pose.x, pose.y);
  ctx.scale(size, size);
  ctx.save();
  ctx.translate(-0.22, -0.3);
  ctx.rotate(heading);
  ctx.fillStyle = 'rgba(0,0,0,0.4)';
  roundedRect(ctx, -CAR.length / 2, -CAR.width / 2, CAR.length, CAR.width, 0.55);
  ctx.fill();
  ctx.restore();
  ctx.restore();

  drawTitleSmoke(ctx, scene, sprite, time);

  ctx.save();
  ctx.translate(pose.x, pose.y);
  ctx.scale(size, size);
  ctx.rotate(heading);
  drawCarBody(ctx, { wheelAngle: TITLE.countersteer, brake: 0, handbrake: false }, COLORS);
  ctx.restore();
}

function drawTitleScene(r, step) {
  const { ctx, title: scene, width, height } = r;
  if (!r.titleStill) r.titleTime += step;
  const time = r.titleTime;
  const visibleWidth = width * (1 - TITLE.panelShare);
  const zoom = Math.min(visibleWidth / TITLE.viewWidth, height / TITLE.viewHeight);

  ctx.setTransform(r.dpr, 0, 0, r.dpr, 0, 0);
  ctx.fillStyle = TITLE.ground;
  ctx.fillRect(0, 0, width, height);
  ctx.fillStyle = TITLE.groundBand;
  const band = Math.max(width, height) / 12;
  for (let i = -6; i < 16; i += 2) {
    ctx.beginPath();
    ctx.moveTo(i * band, height);
    ctx.lineTo((i + 1) * band, height);
    ctx.lineTo((i + 1) * band + height * 0.5, 0);
    ctx.lineTo(i * band + height * 0.5, 0);
    ctx.fill();
  }

  ctx.save();
  ctx.translate(width * TITLE.panelShare + visibleWidth / 2, height / 2);
  ctx.scale(zoom, zoom);
  ctx.rotate(TITLE.rotation);
  ctx.translate(-TITLE.focus.x, -TITLE.focus.y);
  drawRoad(ctx, r.titleCourse, TITLE_COLORS);
  drawTitleSkids(ctx, scene.skids);
  drawTitleCar(ctx, scene, r.titleSmoke, time);
  ctx.restore();
}

// Distinctive retro black-and-white interceptor police cruiser: black hood/trunk, white doors
// and roof, front steel push-bumper, turning front wheels, brake lights, headlight cones, and
// alternating red/blue strobe wash cast onto the street when lights are active.
function drawPoliceBody(ctx, wheelAngle, braking, live, flash, unitNum = null) {
  const L = CAR.length;
  const W = CAR.width;

  const tyre = (x, y, angle) => {
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(angle);
    ctx.fillStyle = '#121316';
    roundedRect(ctx, -0.5, -0.26, 1, 0.52, 0.12);
    ctx.fill();
    ctx.restore();
  };
  const wheelY = W / 2 - 0.08;
  tyre(1.45, -wheelY, wheelAngle);
  tyre(1.45, wheelY, wheelAngle);
  tyre(-1.48, -wheelY, 0);
  tyre(-1.48, wheelY, 0);

  // Classic cruiser sedan body: charcoal-black base with crisp cream-white cabin & doors.
  ctx.fillStyle = '#181a20';
  roundedRect(ctx, -L / 2, -W * 0.45, L, W * 0.9, 0.42);
  ctx.fill();
  ctx.fillStyle = '#f2f1eb';
  ctx.fillRect(-1.25, -W * 0.45, 2.35, W * 0.9);
  ctx.strokeStyle = '#0d0e12';
  ctx.lineWidth = 0.15;
  roundedRect(ctx, -L / 2, -W * 0.45, L, W * 0.9, 0.42);
  ctx.stroke();

  // Steel push-bumper across the nose.
  ctx.fillStyle = '#31343d';
  ctx.fillRect(L / 2 - 0.05, -W * 0.34, 0.28, W * 0.68);
  ctx.fillStyle = '#535866';
  ctx.fillRect(L / 2 + 0.02, -W * 0.24, 0.16, 0.14);
  ctx.fillRect(L / 2 + 0.02, W * 0.24 - 0.14, 0.16, 0.14);

  // Greenhouse & white roof.
  ctx.fillStyle = '#1b2b3a';
  roundedRect(ctx, -1.32, -W * 0.36, 2.1, W * 0.72, 0.24);
  ctx.fill();
  ctx.fillStyle = '#f2f1eb';
  roundedRect(ctx, -0.98, -W * 0.31, 1.32, W * 0.62, 0.14);
  ctx.fill();

  // Subtle roof unit number behind the lightbar.
  if (unitNum !== null) {
    ctx.save();
    ctx.rotate(-Math.PI / 2);
    ctx.font = 'bold 0.56px monospace';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = '#242730';
    ctx.fillText(String(unitNum), 0, -0.62);
    ctx.restore();
  }

  // Headlights (subtle wig-wag flare when lights are active).
  const wigLeft = live && flash;
  const wigRight = live && !flash;
  ctx.fillStyle = wigLeft ? '#ffffff' : '#fff4c4';
  roundedRect(ctx, L / 2 - 0.32, -W * 0.38, 0.26, 0.42, 0.09);
  ctx.fill();
  ctx.fillStyle = wigRight ? '#ffffff' : '#fff4c4';
  roundedRect(ctx, L / 2 - 0.32, W * 0.38 - 0.42, 0.26, 0.42, 0.09);
  ctx.fill();

  // Tail lights + brake light flare when hard braking or reversing.
  ctx.fillStyle = '#ff281c';
  ctx.fillRect(-L / 2 + 0.06, -W * 0.40, 0.2, 0.56);
  ctx.fillRect(-L / 2 + 0.06, W * 0.40 - 0.56, 0.2, 0.56);
  if (braking > 0.25) {
    ctx.fillStyle = `rgba(255, 52, 38, ${(0.55 * braking).toFixed(2)})`;
    ctx.beginPath();
    ctx.arc(-L / 2 + 0.08, -W * 0.28, 0.52, 0, Math.PI * 2);
    ctx.arc(-L / 2 + 0.08, W * 0.28, 0.52, 0, Math.PI * 2);
    ctx.fill();
  }

  // Roof lightbar housing with vibrant red/blue strobes & center chrome strip.
  ctx.fillStyle = '#15171c';
  roundedRect(ctx, -0.44, -W * 0.35, 0.46, W * 0.7, 0.08);
  ctx.fill();
  ctx.fillStyle = live && flash ? '#ff3a30' : '#631919';
  ctx.fillRect(-0.38, -W * 0.32, 0.34, W * 0.27);
  ctx.fillStyle = live && !flash ? '#3882ff' : '#1b2f63';
  ctx.fillRect(-0.38, W * 0.05, 0.34, W * 0.27);
  ctx.fillStyle = live ? '#fff5df' : '#696c75';
  ctx.fillRect(-0.36, -0.05, 0.3, 0.1);
}

function drawPolice(r, p, alpha, live, unitNum = null) {
  const { ctx } = r;
  const x = p.prevX + (p.x - p.prevX) * alpha;
  const y = p.prevY + (p.y - p.prevY) * alpha;
  const heading = p.prevHeading + Math.atan2(Math.sin(p.heading - p.prevHeading), Math.cos(p.heading - p.prevHeading)) * alpha;
  const L = CAR.length;
  const W = CAR.width;
  const vis = r.policeVisuals.get(p);
  const wheelAngle = vis?.wheelAngle ?? 0;
  const braking = vis?.braking ?? 0;

  // Headlights on every cruiser so oncoming patrol cars read down dark avenues.
  drawHeadlightCones(ctx, x, y, heading, live ? 16 : 13, 4.6, live ? 0.21 : 0.15);

  // Alternating red/blue strobe light wash cast onto the street around lit cruisers!
  const phase = r.titleStill ? 0 : Math.floor((r.fxTime * 1000 + (unitNum ?? 0) * 85) / 145) % 2;
  const flash = live && phase === 0;
  if (live) {
    const cos = Math.cos(heading);
    const sin = Math.sin(heading);
    const off = 2.6;
    const rad = 11.5;
    if (r.titleStill) {
      ctx.globalAlpha = 0.42;
      ctx.drawImage(r.glowRed, x + sin * off - rad, y - cos * off - rad, rad * 2, rad * 2);
      ctx.drawImage(r.glowBlue, x - sin * off - rad, y + cos * off - rad, rad * 2, rad * 2);
      ctx.globalAlpha = 1;
    } else {
      const sprite = flash ? r.glowRed : r.glowBlue;
      const side = flash ? -1 : 1;
      const gx = x - sin * off * side;
      const gy = y + cos * off * side;
      ctx.globalAlpha = 0.72;
      ctx.drawImage(sprite, gx - rad, gy - rad, rad * 2, rad * 2);
      ctx.globalAlpha = 1;
    }
  }

  ctx.save();
  ctx.translate(x, y);
  ctx.scale(CAR.drawScale, CAR.drawScale);
  ctx.save();
  ctx.translate(0.28, 0.38);
  ctx.rotate(heading);
  ctx.fillStyle = 'rgba(0,0,0,0.34)';
  roundedRect(ctx, -L / 2, -W / 2, L, W, 0.42);
  ctx.fill();
  ctx.restore();
  ctx.rotate(heading);
  drawPoliceBody(ctx, wheelAngle, braking, live, flash, unitNum);
  ctx.restore();
}

// When the police car is off screen, a sleek directional badge at the edge of the view points at
// it with its distance, so a bust never comes out of nowhere.
function drawPoliceMarker(r, run, pose, bottom = 0) {
  if (run.phase !== 'running') return;
  const { ctx, cam } = r;
  const p = run.pursuer;
  const sx = r.width / 2 + (p.x - cam.x) * cam.zoom;
  const sy = r.height / 2 + (p.y - cam.y) * cam.zoom;
  const margin = 38;
  if (sx > margin && sx < r.width - margin && sy > margin && sy < r.height - margin - bottom) return;
  const cx = r.width / 2;
  const cy = (r.height - bottom) / 2;
  const a = Math.atan2(sy - cy, sx - cx);
  const k = Math.min(Math.abs((cx - margin) / Math.cos(a) || Infinity), Math.abs((cy - margin) / Math.sin(a) || Infinity));
  const ex = cx + Math.cos(a) * k;
  const ey = cy + Math.sin(a) * k;
  const gap = Math.hypot(p.x - pose.x, p.y - pose.y);
  const chasing = !run.police || p.mode === 'pursue';
  const strobe = !r.titleStill && Math.floor((r.fxTime * 1000) / 180) % 2 === 0;
  const accent = !chasing ? '#ffb627' : gap < 30 ? (strobe ? '#ff5a4f' : '#4a8cff') : 'rgba(255,90,79,0.88)';

  ctx.save();
  ctx.setTransform(r.dpr, 0, 0, r.dpr, 0, 0);
  ctx.translate(ex, ey);
  // Crisp directional arrow head.
  ctx.save();
  ctx.rotate(a);
  ctx.fillStyle = accent;
  ctx.strokeStyle = 'rgba(15,16,19,0.88)';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(15, 0);
  ctx.lineTo(-5, -9);
  ctx.lineTo(-2, 0);
  ctx.lineTo(-5, 9);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
  ctx.restore();
  // Clean pill tag behind the distance text so it stays readable over bright or dark streets.
  const lx = -Math.cos(a) * 34;
  const ly = -Math.sin(a) * 20;
  const text = `COP ${Math.round(gap)} m`;
  ctx.font = '700 11px "Trebuchet MS", "Segoe UI", sans-serif';
  const tw = ctx.measureText(text).width + 12;
  ctx.fillStyle = 'rgba(19,20,23,0.86)';
  ctx.beginPath();
  ctx.roundRect(lx - tw / 2, ly - 10, tw, 20, 4);
  ctx.fill();
  ctx.strokeStyle = accent;
  ctx.lineWidth = 1.4;
  ctx.stroke();
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = '#f6f1e4';
  ctx.fillText(text, lx, ly + 0.5);
  ctx.restore();
}

// The player's car is drawn one step behind the simulation, blending toward its
// latest position by `alpha`, so the ghost is sampled at that same moment.
// The selected ghost: the previous lap, the saved reference, or none. Both run on the same lap
// clock. The reference is a flying lap, timed from the line, so it waits for the first line
// crossing rather than racing a standing start from the grid.
function ghostForFrame(game, pose, alpha) {
  if (!game.ghost || !game.ghostVisible || game.state !== 'racing' || game.ghostSource === 'off') return null;
  const tick = game.ghost.lapTick - 1 + alpha;
  if (game.ghostSource === 'reference') {
    if (game.laps.completed + game.laps.voided === 0) return null;
    return ghostDisplay(game.ghost, tick, pose.x, pose.y, game.ghostReference);
  }
  return ghostDisplay(game.ghost, tick, pose.x, pose.y);
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
  useTrack(r, game.track);
  const step = Math.min(dt, FX.maxDt);
  if (!game.paused && game.state !== 'finished' && game.state !== 'menu') updateEffects(r, game, pose, step);
  updateCamera(r, car, pose, step, game);
  if (game.state === 'menu') {
    drawTitleScene(r, step);
    return;
  }
  const ghost = ghostForFrame(game, pose, blend);

  ctx.setTransform(r.dpr, 0, 0, r.dpr, 0, 0);
  ctx.save();
  ctx.translate(r.width / 2 + r.shake.x, r.height / 2 + r.shake.y);
  ctx.scale(r.cam.zoom, r.cam.zoom);
  ctx.translate(-r.cam.x, -r.cam.y);
  const yard = r.course.dockyard;
  const land = yard ? null : landscapeOf(r.course);
  const view = { x: r.cam.x, y: r.cam.y, hw: r.width / 2 / r.cam.zoom, hh: r.height / 2 / r.cam.zoom };
  if (yard) {
    drawDockyardGround(ctx, view);
    drawDockyardScenery(ctx, yard, view);
  } else if (land) {
    if (land.style === 'grassroots') drawGrass(r);
    drawLandscapeBelow(ctx, r.track, land, view);
  } else drawGrass(r);
  if (r.track.pad) drawPad(ctx, r.track);
  else drawRoad(ctx, r.course);
  // A gymkhana challenge paints its gates, zones and cones on its pad.
  if (game.mode === 'gymkhana' && game.challenge) drawChallenge(ctx, game, view);
  drawSkids(r);
  if (!land && !(game.mode === 'gymkhana' && game.challengeDef?.layout === 'urban')) drawWall(r); // a landscape draws its own perimeter, under its scenery
  if (ghost) drawGhost(r, ghost);
  // Getaway Drift in town: the parked police cars of a blockade, lights on.
  const urban = game.mode === 'gymkhana' && game.challengeDef?.layout === 'urban' && game.challenge ? game.challengeDef : null;
  const liveLights = game.state === 'racing' && !game.paused;
  if (urban) {
    blockadeCars(urban.geometry.city).forEach((c, idx) => drawPolice(
      r,
      { prevX: c.x, x: c.x, prevY: c.y, y: c.y, prevHeading: c.heading, heading: c.heading },
      1, true, idx + 8,
    ));
  }
  // Getaway Driver: every police car, lights only on those responding or chasing.
  if (game.challenge?.police) {
    game.challenge.police.forEach((u, idx) => drawPolice(r, u, blend, u.lights && liveLights, idx + 1));
  } else if (game.challenge?.pursuer) {
    drawPolice(r, game.challenge.pursuer, blend, liveLights, 1);
  }
  drawCar(ctx, car, pose, !!urban, r.exhaust.pop);
  drawSmoke(r);
  drawSparksAndPapers(r);
  if (urban) drawUrbanAbove(ctx, urban, game.challenge, view, r.fxTime);
  else if (land) drawLandscapeAbove(ctx, land, view);
  else if (!yard) drawTrees(r);
  // Satisfying safehouse / escape arrival light ring on mission completion (reduced-motion safe).
  if (urban && game.challenge.phase === 'complete') {
    if (!r.celebrate || r.celebrate.run !== game.challenge) {
      const outcome = game.challenge.result?.outcome;
      const color = outcome === 'low profile' ? '#ffb627' : outcome === 'lost them' ? '#ff7a3d' : '#5fd38a';
      r.celebrate = { run: game.challenge, x: pose.x, y: pose.y, age: 0, color };
    } else if (!game.paused && !r.titleStill) {
      r.celebrate.age = Math.min(1.4, r.celebrate.age + step);
    }
    const c = r.celebrate;
    const t = r.titleStill ? 0.35 : c.age / 1.4;
    if (t < 1) {
      const ease = 1 - (1 - t) ** 3;
      const radius = 3.5 + ease * 24;
      ctx.save();
      ctx.globalAlpha = (1 - t) * 0.72;
      ctx.strokeStyle = c.color;
      ctx.lineWidth = 0.65 * (1 - t * 0.6);
      ctx.beginPath();
      ctx.arc(c.x, c.y, radius, 0, Math.PI * 2);
      ctx.stroke();
      ctx.globalAlpha = (1 - t) * 0.24;
      ctx.fillStyle = c.color;
      ctx.beginPath();
      ctx.arc(c.x, c.y, 4 + ease * 11, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }
  } else if (r.celebrate) {
    r.celebrate = null;
  }
  if (debug) drawDebugWorld(r, game, pose);
  ctx.restore();
  if (game.state === 'racing' && !game.paused) drawSpeedLines(r, car);
  if (game.challenge?.pursuer && (!game.challenge.police || game.challenge.pursuer.lights)) drawPoliceMarker(r, game.challenge, pose, urban ? 96 : 0);
  drawMinimap(r, car, ghost, game);
}
