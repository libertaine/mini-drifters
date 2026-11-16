// What the rear tyres leave behind each rendered frame: a skid mark, smoke or dust. A pure
// decision from the car's own state, so the tests can check it without a canvas. render.js draws
// what it decides. Nothing here feeds back into the simulation, and nothing simulates the tyres:
// wheelspin is the physics' own `car.wheelspin` (Power's rear grip budget, physics.js), which a
// Classic car never has.
//
// Two sources, and the larger of the two wins, so they never stack into extra smoke or ink:
//   - the slide: body and rear slip angle, exactly as every release before v0.5.0 R2 drew it;
//   - wheelspin: the rear wheels turning faster than the road, which can happen with the car
//     pointing almost straight, so the slide alone never showed it.
const DEG = Math.PI / 180;

export const TYRE_FX = Object.freeze({
  // --- The slide (unchanged from v0.4.0's render.js) ----------------------------------------
  skidMinSlip: 11 * DEG,
  skidMinSpeed: 6,
  skidFullSlip: 35 * DEG,    // mark alpha rises with body slip to here...
  skidAlphaFloor: 0.35,      // ...from this
  smokeMinSlip: 16 * DEG,
  smokeMinSpeed: 8,
  smokeFullSlip: 45 * DEG,
  smokeRate: 34,             // puffs per second at full intensity
  dustRate: 18,
  dustFullSpeed: 25,

  // --- Wheelspin ------------------------------------------------------------------------------
  // Smoke builds from spinOnset to spinFull. Light spin, the kind a tidy corner exit in Power
  // makes, gives a thin wisp rather than a cloud.
  spinSmokeOnset: 0.3,
  spinSmokeFull: 0.85,
  spinSmokeRate: 30,
  spinSmokeStillShare: 0.35, // a burnout on the spot (pinned to a wall, say) smokes this share...
  spinSmokeFullSpeed: 8,     // ...rising to the full rate by this speed
  spinSmokeStrengthFloor: 0.5, // the faintest wheelspin puff, against a slide puff's 1
  spinDustRate: 22,          // on grass, spinning tyres throw dirt instead: no smoke, no rubber
  // Rubber: on above spinMarkOn, off below spinMarkOff, so a wheelspin that flickers around
  // one value still lays one continuous mark rather than a dashed line. Speed has the same kind
  // of gap, so a donut turning at about 4 to 5 m/s draws one ring rather than dashes.
  spinMarkOn: 0.4,
  spinMarkOff: 0.25,
  spinMarkMinSpeed: 2.5,     // a mark starts only above this...
  spinMarkStopSpeed: 2,      // ...and ends below this: none at all while (nearly) stopped
  spinMarkFullSpeed: 12,     // below this a mark is lighter, so a slow one never looks heavy
  spinMarkAlphaFloor: 0.3,
  spinMarkAlphaFull: 0.85,
  spinMarkMinLength: 0.5,    // metres a tyre must move before its mark grows, so no dots
  spinMarkMaxJump: 6,        // metres: anything longer is a reset or a teleport, never a mark
});

const clamp01 = (v) => (Number.isFinite(v) ? Math.max(0, Math.min(1, v)) : 0);
function smoothstep(lo, hi, v) {
  const x = clamp01((v - lo) / (hi - lo));
  return x * x * (3 - 2 * x);
}

// The renderer's memory of the wheelspin mark: whether one is being laid. Cleared with the marks.
export function createTyreEffectState() {
  return { spinMarking: false };
}

export function resetTyreEffectState(state) {
  state.spinMarking = false;
}

// One frame's decision. `mark` is 0 (none) or the mark's alpha; `spinMark` says the mark comes
// from wheelspin alone, which render.js lays in longer pieces. `smokeRate` is puffs per second
// of `smokeKind`, each drawn at `smokeStrength` of a slide puff's opacity.
export function tyreEmission(car, state, F = TYRE_FX) {
  const slipAbs = Math.abs(car.slipAngle);
  const onGrass = car.surface === 'grass';
  const speed = car.speed;

  // The slide, as before.
  const rearSliding = Math.abs(car.rearSlip) > F.skidMinSlip || slipAbs > F.skidMinSlip;
  const skidding = !onGrass && speed > F.skidMinSpeed && rearSliding;
  const slideAlpha = skidding ? Math.min(1, slipAbs / F.skidFullSlip + F.skidAlphaFloor) : 0;
  let slideSmoke = 0;
  let smokeKind = 'smoke';
  if (!onGrass && speed > F.smokeMinSpeed && slipAbs > F.smokeMinSlip) {
    slideSmoke = F.smokeRate * Math.min(1, slipAbs / F.smokeFullSlip);
  } else if (onGrass && speed > F.smokeMinSpeed) {
    slideSmoke = F.dustRate * Math.min(1, speed / F.dustFullSpeed);
    smokeKind = 'dust';
  }

  // Wheelspin. A car without the state (Classic) reads as never spinning, so it gets exactly
  // the slide's effects above.
  const spin = clamp01(car.wheelspin ?? 0);
  if (state) {
    const fast = Number.isFinite(speed) && speed >= F.spinMarkMinSpeed;
    if (onGrass || !(speed >= F.spinMarkStopSpeed)) state.spinMarking = false;
    else if (spin >= F.spinMarkOn && (fast || state.spinMarking)) state.spinMarking = true;
    else if (spin < F.spinMarkOff) state.spinMarking = false;
  }
  const spinMarking = !!state?.spinMarking;
  const spinLevel = smoothstep(F.spinSmokeOnset, F.spinSmokeFull, spin);
  const moving = Number.isFinite(speed) ? smoothstep(0, F.spinSmokeFullSpeed, speed) : 0;
  const spinSmoke = (onGrass ? F.spinDustRate : F.spinSmokeRate) * spinLevel
    * (F.spinSmokeStillShare + (1 - F.spinSmokeStillShare) * moving);
  const spinAlpha = spinMarking
    ? (F.spinMarkAlphaFloor + (F.spinMarkAlphaFull - F.spinMarkAlphaFloor) * smoothstep(F.spinMarkOff, F.spinSmokeFull, spin))
      * (0.6 + 0.4 * smoothstep(F.spinMarkMinSpeed, F.spinMarkFullSpeed, speed))
    : 0;

  const wheelspinSmoke = spinSmoke > slideSmoke;
  return {
    mark: Math.max(slideAlpha, spinAlpha),
    spinMark: !skidding && spinAlpha > 0,
    smokeRate: wheelspinSmoke ? spinSmoke : slideSmoke,
    smokeKind: wheelspinSmoke ? (onGrass ? 'dust' : 'smoke') : smokeKind,
    smokeStrength: wheelspinSmoke ? F.spinSmokeStrengthFloor + (1 - F.spinSmokeStrengthFloor) * spinLevel : 1,
    wheelspinSmoke,
  };
}
