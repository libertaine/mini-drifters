// Every number that shapes how the car drives or scores lives here.
// Units: metres, seconds, radians (DEG converts from degrees for readability).
// Force values are accelerations (m/s²) because the car's mass is normalised to 1.
const DEG = Math.PI / 180;

export const TUNING = Object.freeze({
  // --- Simulation ---------------------------------------------------------
  simStep: 1 / 120,            // fixed physics timestep
  maxFrameTime: 0.25,          // longest frame we try to catch up on

  // --- Engine and brakes --------------------------------------------------
  acceleration: 11,            // launch thrust; fades to zero at topSpeed
  topSpeed: 42,                // ~94 mph
  reverseAcceleration: 5,
  reverseTopSpeed: 9,
  reverseEngageSpeed: 0.8,     // Down brakes above this forward speed, reverses below it
  brakeStrength: 24,
  coastDrag: 1.5,              // engine braking when the throttle is released
  throttleRiseRate: 7,         // pedal travel per second (keyboard input is on/off)
  throttleFallRate: 12,
  brakeRiseRate: 9,
  brakeFallRate: 14,

  // --- Chassis ------------------------------------------------------------
  frontAxle: 1.3,              // centre of mass to front axle
  rearAxle: 1.3,               // centre of mass to rear axle
  yawInertia: 1.5,             // lower rotates more eagerly
  yawDamping: 1.1,             // arcade damping on rotation, per second
  lowSpeedFloor: 2.0,          // keeps slip angles sane near a standstill

  // --- Steering -----------------------------------------------------------
  steerResponse: 6.5,          // wheel travel per second at low speed
  steerResponseHighSpeed: 2.6, // ...and at top speed
  steerReturnBoost: 1.4,       // the wheel self-centres this much faster
  maxWheelAngle: 32 * DEG,     // lock at parking speeds
  steerGripMargin: 0.95,       // at speed, lock is limited to about the front tyres' peak
  counterSteerAuthority: 0.95, // extra lock when steering into a slide, as a fraction of slip
  casterAssist: 0.45,           // front wheels trail the slide slightly with no input
  maxCounterLock: 58 * DEG,

  // --- Tyres --------------------------------------------------------------
  normalLateralGrip: 15,       // peak cornering acceleration on asphalt
  frontGripBias: 0.94,         // front < rear makes grip driving stable (mild understeer)
  rearGripBias: 1.12,
  frontPeakSlip: 8.5 * DEG,    // tyre slip angle at maximum grip
  rearPeakSlip: 7.5 * DEG,
  frontSlideGrip: 0.90,        // fraction of peak grip left once fully sliding
  rearSlideGrip: 0.80,         // rear grip when sliding with the throttle released (it hooks up)
  rearPowerSlideGrip: 0.72,    // rear grip when sliding under full throttle (it stays loose)
  slideFalloff: 0.55,          // how quickly grip drops past the peak (gentle = no snap)

  // --- Handbrake and recovery ---------------------------------------------
  handbrakeLateralGrip: 0.26,  // rear grip fraction with the handbrake fully on
  handbrakeEngageRate: 7.5,    // rear grip lost per second while held (a tap is only partial)
  driftRecovery: 2.8,          // rear grip regained per second after release
  handbrakeDrag: 7,            // deceleration from locked rear wheels
  handbrakeThrustCut: 0.85,    // locked rear wheels cannot deliver much power
  powerOversteer: 0.4,         // throttle spends rear grip (0 = none, 1 = full friction circle)
  brakeRearGripLoss: 0.14,     // weight transfer under braking lightens the rear
  stabilityOnset: 48 * DEG,    // above this slip a mild assist pulls the nose back...
  stabilityAssist: 5.5,        // ...by this much yaw acceleration per radian of excess slip
  stabilityHandbrakeScale: 0,  // the assist is off while the handbrake is held

  // --- Surfaces -----------------------------------------------------------
  surfaceBlendRate: 7,         // traction changes over ~0.15 s, not instantly
  offTrackTraction: 0.58,      // grip multiplier on grass
  offTrackEngine: 0.6,         // engine multiplier on grass
  offTrackDrag: 0.42,          // extra rolling resistance on grass (per second of speed)
  curbTraction: 0.94,
  curbEngine: 0.97,

  // --- Barriers -----------------------------------------------------------
  carRadius: 2.2,
  barrierRestitution: 0.3,     // bounce on impact
  barrierScrub: 0.82,          // speed kept along the wall
  barrierSignificantImpact: 6, // impact speed that ends a combo

  // --- Drift qualification ------------------------------------------------
  driftMinSpeedRatio: 0.25,    // fraction of topSpeed
  driftMinSlip: 12 * DEG,
  driftExitSlip: 9 * DEG,      // hysteresis: a qualifying drift survives dips to here
  driftStrongLow: 25 * DEG,    // full angle score between Low...
  driftStrongHigh: 50 * DEG,   // ...and High
  driftExcessScore: 0.25,      // angle score as slip reaches spinoutSlip
  spinoutSlip: 75 * DEG,
  spinoutHoldTime: 0.1,        // must stay past the threshold this long
  spinoutMinSpeed: 7,          // tumbling to a stop is not a spin
  spinoutRecoverSlip: 35 * DEG,// must regain control before another spin can count
  driftConfirmTime: 0.12,      // a slide must last this long to start a combo
  driftMinProgressRate: 5,     // m/s along the track, smoothed
  progressRateSmoothing: 4,    // per second

  // --- Scoring ------------------------------------------------------------
  driftPointsPerSecond: 140,   // full angle at full speed, before the multiplier
  scoreSpeedFloor: 0.45,       // speed score at the minimum drift speed
  scoreFullSpeedRatio: 0.7,    // speed score reaches 1 at this fraction of topSpeed
  handbrakeScoreGrace: 0.35,   // the handbrake may be held this long at full points...
  handbrakeScoreFactor: 0.3,   // ...then points shrink to this share, so power-sliding pays best
  comboTiers: Object.freeze([1, 1.5, 2, 3]),
  comboAnnounceMinimum: 10,    // combos smaller than this end without a HUD message
  comboGrace: 2.0,             // seconds between drifts before the combo is banked
  comboTierGround: 55,         // metres of drifted new ground per tier
  comboLinkGround: 25,         // new ground required before a relink or transition earns a tier
  comboOffTrackLimit: 1.5,     // seconds on grass before the combo is lost
  comboStallWindow: 2.5,       // seconds to cover comboStallGround...
  comboStallGround: 8,         // ...of new ground, or the combo is lost
  newGroundRecentWindow: 0.25, // new ground this recent still counts as advancing

  // --- Session ------------------------------------------------------------
  runLaps: 3,
});
