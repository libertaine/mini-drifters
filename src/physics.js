// A lightweight two-axle ("bicycle") car model. Heading and velocity are
// separate state, so sliding emerges from the tyre forces rather than being
// animated. Screen convention: y points down, so a positive heading change
// turns the car clockwise (to the driver's right).
import { TUNING } from './tuning.js';
import { drivingCommands } from './controls.js';

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const approach = (v, target, maxDelta) =>
  v < target ? Math.min(target, v + maxDelta) : Math.max(target, v - maxDelta);

export function createCar(pose = {}) {
  return {
    x: pose.x ?? 0,
    y: pose.y ?? 0,
    heading: pose.heading ?? 0,
    vx: 0,
    vy: 0,
    yawRate: 0,
    steer: 0,        // smoothed driver input, -1 (left) .. 1 (right)
    throttle: 0,     // smoothed, 0 .. 1
    brake: 0,        // smoothed, 0 .. 1
    reversing: false,
    handbrake: false,
    rearGrip: 1,     // 1 = free-rolling, handbrakeLateralGrip = locked
    surface: 'road',
    traction: 1,     // blended surface grip multiplier
    engineScale: 1,  // blended surface engine multiplier
    wheelAngle: 0,   // front wheel angle actually applied
    // Derived each step, kept for scoring, effects and the debug panel.
    speed: 0,
    forwardSpeed: 0,
    lateralSpeed: 0,
    slipAngle: 0,
    frontSlip: 0,
    rearSlip: 0,
  };
}

// Signed angle between where the car points and where it is going. Positive
// means the car is moving to the right of its nose.
export function slipAngleOf(forwardSpeed, lateralSpeed, floor = 1.5) {
  if (Math.hypot(forwardSpeed, lateralSpeed) < floor) return 0;
  return Math.atan2(lateralSpeed, forwardSpeed);
}

// Grip available at a tyre slip angle, as a fraction of peak: rises to 1 at
// peakSlip, then eases down to slideGrip. The result carries the slip's sign.
export function tyreCurve(slip, peakSlip, slideGrip, falloff) {
  const s = Math.abs(slip) / peakSlip;
  const grip = s <= 1
    ? s * (2 - s)
    : slideGrip + (1 - slideGrip) * Math.exp(-(s - 1) * falloff);
  return Math.sign(slip) * grip;
}

// The most lock that is useful at this speed: enough to reach the cornering
// limit plus the tyre's peak slip. This is what makes steering gentler as speed rises.
export function steerLimit(speed, T = TUNING) {
  const wheelbase = T.frontAxle + T.rearAxle;
  const v2 = Math.max(speed * speed, 1);
  return Math.min(
    T.maxWheelAngle,
    T.steerGripMargin * T.frontPeakSlip + (wheelbase * T.normalLateralGrip) / v2,
  );
}

export function surfaceFactors(surface, T = TUNING) {
  if (surface === 'grass') return { traction: T.offTrackTraction, engine: T.offTrackEngine, drag: T.offTrackDrag };
  if (surface === 'curb') return { traction: T.curbTraction, engine: T.curbEngine, drag: 0 };
  return { traction: 1, engine: 1, drag: 0 };
}

// Advance the same car model with Boolean keyboard or proportional commands.
export function stepCar(car, input, surface, dt, T = TUNING) {
  const surf = surfaceFactors(surface, T);
  car.surface = surface;
  car.traction = approach(car.traction, surf.traction, T.surfaceBlendRate * dt);
  car.engineScale = approach(car.engineScale, surf.engine, T.surfaceBlendRate * dt);

  const cos = Math.cos(car.heading);
  const sin = Math.sin(car.heading);
  const vf = car.vx * cos + car.vy * sin;
  const vl = -car.vx * sin + car.vy * cos;
  const speed = Math.hypot(vf, vl);
  const slip = slipAngleOf(vf, vl);
  const speedRatio = clamp(speed / T.topSpeed, 0, 1);

  // --- Driver inputs, smoothed so the on/off keyboard still feels progressive.
  const commands = drivingCommands(input);
  const steerTarget = commands.steer;
  const steerRate = T.steerResponse + (T.steerResponseHighSpeed - T.steerResponse) * speedRatio;
  const returning = steerTarget === 0 || steerTarget * car.steer < 0;
  car.steer = approach(car.steer, steerTarget, steerRate * (returning ? T.steerReturnBoost : 1) * dt);

  // Down brakes while rolling forward and reverses once nearly stopped; Up does
  // the mirror image, so the car never needs a separate gear change.
  const up = commands.accelerator;
  const down = commands.brake;
  const wantsReverse = down > 0 && vf < T.reverseEngageSpeed && !up;
  const braking = (down > 0 && vf >= T.reverseEngageSpeed) || (up > 0 && !down && vf < -T.reverseEngageSpeed);
  const throttling = up > 0 && !down && vf >= -T.reverseEngageSpeed;
  car.reversing = wantsReverse;

  const pedal = throttling ? up : wantsReverse ? down : 0;
  car.throttle = approach(car.throttle, pedal, (pedal ? T.throttleRiseRate : T.throttleFallRate) * dt);
  car.brake = approach(car.brake, braking ? (down || up) : 0, (braking ? T.brakeRiseRate : T.brakeFallRate) * dt);

  car.handbrake = !!input.handbrake;
  const gripTarget = car.handbrake ? T.handbrakeLateralGrip : 1;
  car.rearGrip = approach(car.rearGrip, gripTarget,
    (car.rearGrip > gripTarget ? T.handbrakeEngageRate : T.driftRecovery) * dt);
  const handbrakeAmount = (1 - car.rearGrip) / (1 - T.handbrakeLateralGrip);
  const handbrakeHeld = car.handbrake ? handbrakeAmount : 0;

  // --- Front wheel angle. Steering toward the slide earns extra lock, which is
  // what makes catching a drift possible. The wheels also trail the slide a little.
  const slideAngle = vf > 0 ? slip : 0;
  const counterShare = Math.max(0, car.steer * Math.sign(slideAngle));
  const limit = steerLimit(Math.abs(vf), T) + counterShare * Math.abs(slideAngle) * T.counterSteerAuthority;
  const wheel = clamp(car.steer * limit + slideAngle * T.casterAssist, -T.maxCounterLock, T.maxCounterLock);
  car.wheelAngle = wheel;

  // --- Longitudinal forces.
  const wheelbase = T.frontAxle + T.rearAxle;
  const grip = T.normalLateralGrip * car.traction;
  const frontCapacity = grip * T.frontGripBias * (T.rearAxle / wheelbase) * (1 + car.brake * T.brakeRearGripLoss * 0.5);
  const rearCapacityFull = grip * T.rearGripBias * (T.frontAxle / wheelbase) * (1 - car.brake * T.brakeRearGripLoss);

  let thrust = 0;
  if (wantsReverse) {
    thrust = -car.throttle * T.reverseAcceleration * clamp(1 - Math.abs(vf) / T.reverseTopSpeed, 0, 1);
  } else if (car.throttle > 0) {
    // Fades on total speed: going sideways must not hand the car extra engine power.
    const fade = clamp(1 - (speed / T.topSpeed) ** 2, 0, 1);
    thrust = car.throttle * T.acceleration * fade * (1 - T.handbrakeThrustCut * handbrakeHeld);
  }
  thrust *= car.engineScale;

  // Friction-like forces oppose rolling and must never push the car backward
  // through zero, so each is limited to what would just stop it this step.
  const resist = Math.abs(thrust) > 0 ? 0 : T.coastDrag;
  const friction = resist
    + car.brake * T.brakeStrength * car.traction
    + handbrakeHeld * T.handbrakeDrag * car.traction
    + surf.drag * Math.abs(vf);
  const frictionForce = -Math.sign(vf) * Math.min(friction, Math.abs(vf) / dt);

  // --- Lateral tyre forces, computed from each axle's own slip angle.
  const frontLat = vl + T.frontAxle * car.yawRate;
  const rearLat = vl - T.rearAxle * car.yawRate;

  const wheelCos = Math.cos(wheel);
  const wheelSin = Math.sin(wheel);
  const frontAlong = vf * wheelCos + frontLat * wheelSin;
  const frontAcross = -vf * wheelSin + frontLat * wheelCos;
  const frontSlip = Math.atan2(frontAcross, Math.max(Math.abs(frontAlong), T.lowSpeedFloor));
  const rearSlip = Math.atan2(rearLat, Math.max(Math.abs(vf), T.lowSpeedFloor));

  // Throttle spends some of the rear tyres' grip: this is the "power" in power oversteer.
  const thrustShare = clamp(Math.abs(thrust) / Math.max(rearCapacityFull, 0.001), 0, 0.95) * T.powerOversteer;
  const rearCapacity = rearCapacityFull * car.rearGrip * Math.sqrt(1 - thrustShare * thrustShare);

  const frontForce = -frontCapacity * tyreCurve(frontSlip, T.frontPeakSlip, T.frontSlideGrip, T.slideFalloff);
  // Once the rear has broken loose, throttle keeps it loose and lifting lets it
  // hook back up. Throttle sets the angle of a drift; steering sets its direction.
  const rearSlideGrip = T.rearSlideGrip + (T.rearPowerSlideGrip - T.rearSlideGrip) * car.throttle;
  const rearForce = -rearCapacity * tyreCurve(rearSlip, T.rearPeakSlip, rearSlideGrip, T.slideFalloff);

  // --- Combine into body-frame accelerations.
  const af = thrust + frictionForce - frontForce * wheelSin;
  const al = frontForce * wheelCos + rearForce;

  let yawAccel = (T.frontAxle * frontForce * wheelCos - T.rearAxle * rearForce) / T.yawInertia
    - T.yawDamping * car.yawRate;

  // Arcade assist: past a generous slip angle the nose is drawn back toward the
  // direction of travel. Weak enough that a held handbrake (which disables it)
  // or no countersteer still spins the car.
  const excess = Math.abs(slideAngle) - T.stabilityOnset;
  if (excess > 0) {
    const scale = car.handbrake ? T.stabilityHandbrakeScale : 1;
    yawAccel += Math.sign(slideAngle) * excess * T.stabilityAssist * scale;
  }

  // --- Integrate (semi-implicit Euler, world-space velocity).
  car.vx += (af * cos - al * sin) * dt;
  car.vy += (af * sin + al * cos) * dt;
  car.yawRate += yawAccel * dt;
  car.heading += car.yawRate * dt;
  car.x += car.vx * dt;
  car.y += car.vy * dt;

  // A parked car settles fully rather than creeping from rounding error.
  if (Math.hypot(car.vx, car.vy) < 0.02 && !throttling && !wantsReverse) {
    car.vx = 0;
    car.vy = 0;
    if (Math.abs(car.yawRate) < 0.02) car.yawRate = 0;
  }

  car.frontSlip = frontSlip;
  car.rearSlip = rearSlip;
  updateDerived(car);
}

// Refreshes speed, body-frame velocity and slip angle from the world state.
export function updateDerived(car) {
  const cos = Math.cos(car.heading);
  const sin = Math.sin(car.heading);
  car.forwardSpeed = car.vx * cos + car.vy * sin;
  car.lateralSpeed = -car.vx * sin + car.vy * cos;
  car.speed = Math.hypot(car.vx, car.vy);
  car.slipAngle = slipAngleOf(car.forwardSpeed, car.lateralSpeed);
}
