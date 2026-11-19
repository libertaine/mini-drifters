// Lines off the road for the environment tests. A line becomes a track of its own, built by the
// same builder as the circuits, and the repo's scripted drivers (drivers.mjs) follow it: they steer
// and brake by whatever track they are handed, so they still press on/off keys a few times a second
// and never move the car directly. Everything else (physics, contact, laps, scoring) is the real game.
import { TUNING } from '../../src/tuning.js';
import { buildTrack } from '../../src/track.js';

function along(track, s) {
  const f = (((s % track.length) + track.length) % track.length) / track.step;
  const i = Math.floor(f);
  const n = track.points.length;
  const a = track.points[i % n];
  const b = track.points[(i + 1) % n];
  return { x: a.x + (b.x - a.x) * (f - i), y: a.y + (b.y - a.y) * (f - i), tx: a.tx, ty: a.ty, k: a.curvature };
}

// The centreline with [from, to] replaced by a straight chord, as control points.
export function chordControl(track, from, to) {
  const out = [];
  const a = along(track, from);
  const b = along(track, to);
  for (let s = 0; s < track.length; s += 6) {
    const inCut = to > from ? s > from && s < to : s > from || s < to;
    if (!inCut) out.push([along(track, s).x, along(track, s).y]);
    else if (s - from >= 0 && s - from < 6) {
      const len = Math.hypot(b.x - a.x, b.y - a.y);
      for (let d = 0; d < len; d += 6) out.push([a.x + ((b.x - a.x) * d) / len, a.y + ((b.y - a.y) * d) / len]);
    }
  }
  return out;
}

// The centreline moved `outer` metres to the outside of every corner, ramped with the bend.
export function outsideControl(track, outer) {
  const bend = (s) => { let k = 0; for (let d = -30; d <= 30; d += 2) k += along(track, s + d).k; return k / 31; };
  const out = [];
  for (let s = 0; s < track.length; s += 6) {
    const c = along(track, s);
    const k = bend(s);
    const w = Math.min(1, Math.abs(k) * 90);
    const o = w < 0.15 ? 0 : -Math.sign(k) * outer * w;
    out.push([c.x - c.ty * o, c.y + c.tx * o]);
  }
  return out;
}

// A driver for the real game that follows `control` instead of the road, and backs off with the
// wheel turned when it is pinned against something, as a person would.
export function onLine(makeDriver, control) {
  const line = buildTrack(control);
  const drive = makeDriver();
  let slowFor = 0;
  let reverseUntil = -1;
  let side = 1;
  return (game) => {
    const t = game.ticks * TUNING.simStep;
    if (t < reverseUntil) return { up: false, down: true, left: side < 0, right: side > 0, handbrake: false };
    slowFor = game.state === 'racing' && game.car.speed < 1.5 ? slowFor + TUNING.simStep : 0;
    if (slowFor > 1) { slowFor = 0; reverseUntil = t + 1.4; side = -side; }
    return drive({ ticks: game.ticks, car: game.car, track: line, scoring: game.scoring, state: game.state });
  };
}
