// Tuning and capture helpers shared by the urban Getaway sessions.
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

export const PURSUER = Object.freeze({
  vMax: 35,              // m/s; the car's top speed is 42
  accel: 7,              // m/s^2, flat to vMax
  brake: 13,
  grip: 7.2,             // cornering acceleration, m/s^2 (the car's tyres peak at about 15)
  gripPlan: 8.1,         // what it brakes for: a little optimistic, so it sometimes runs wide
  turnRadius: 6.5,       // smallest turning circle (radius), metres
  crawl: 3,              // m/s: its speed while turning round
  startGap: 25,          // parked this far behind the grid
  delay: 1.0,            // seconds after the player first moves before it sets off
  interceptRange: 26,
  lead: 0.45,            // seconds of lead at most when aiming at the player
  holdGap: 3.5,          // the bumper distance it closes to when matching speed
  closeRate: 1.4,        // closing speed per metre of gap beyond holdGap
  crumbSpacing: 2,
});

export const CAPTURE_MODELS = Object.freeze({
  proximity: Object.freeze({ id: 'proximity', radius: 9, fillTime: 2.0, drain: 0.35 }),
  pressure: Object.freeze({ id: 'pressure', radius: 10, fillTime: 2.6, inner: 4, drain: 0.35, passing: 12, passingFactor: 0.5 }),
});

export function captureRate(model, gap, relSpeed) {
  if (gap >= model.radius) return -model.drain;
  const base = 1 / model.fillTime;
  if (model.id !== 'pressure') return base;
  const closeness = clamp((model.radius - gap) / (model.radius - model.inner), 0, 1);
  return base * (1 + closeness) * (relSpeed > model.passing ? model.passingFactor : 1);
}

export function createPursuer(start, P = PURSUER) {
  const x = start.x - Math.cos(start.heading) * P.startGap;
  const y = start.y - Math.sin(start.heading) * P.startGap;
  return {
    x, y, heading: start.heading, speed: 0, prevX: x, prevY: y, prevHeading: start.heading,
    state: 'parked', crumb: 0, targetX: x, targetY: y,
    overshoots: 0, overshotTime: 0, recoveries: 0, reverses: 0, reverseTime: 0, stuckTime: 0, longestStuck: 0, distance: 0,
  };
}
