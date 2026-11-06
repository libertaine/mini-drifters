// Drift detection and combo scoring. Pure logic: the game feeds in a sample of
// the car each step and this module decides what it is worth.
//
// The anti-exploit rule is "points only on new ground": `newGround` is how far
// the car has pushed past its furthest-ever position along the circuit. Donuts
// and repeated passes through a corner earn nothing because they never add any.
import { TUNING } from './tuning.js';

const clamp01 = (v) => Math.max(0, Math.min(1, v));

export function createScoring() {
  return {
    score: 0,
    spinouts: 0,
    bestCombo: 0,
    bestMultiplier: 1,
    combo: null,          // the active, unbanked combo
    drifting: false,
    qualification: 'idle',
    driftHold: 0,
    spunOut: false,
    spinTimer: 0,
    offTrackTime: 0,
    sinceNewGround: Infinity,
    handbrakeTime: 0,
    event: null,          // the most recent banked/lost result, for the HUD
    eventSerial: 0,
  };
}

// Angle contribution: nothing below the minimum, full through the strong band,
// then tapering so that extreme angle is never automatically best.
export function angleScore(slipAbs, T = TUNING) {
  if (slipAbs < T.driftMinSlip || slipAbs >= T.spinoutSlip) return 0;
  if (slipAbs < T.driftStrongLow) {
    return 0.25 + 0.75 * (slipAbs - T.driftMinSlip) / (T.driftStrongLow - T.driftMinSlip);
  }
  if (slipAbs <= T.driftStrongHigh) return 1;
  const over = (slipAbs - T.driftStrongHigh) / (T.spinoutSlip - T.driftStrongHigh);
  return 1 + (T.driftExcessScore - 1) * over;
}

export function speedScore(speed, T = TUNING) {
  const lo = T.topSpeed * T.driftMinSpeedRatio;
  const hi = T.topSpeed * T.scoreFullSpeedRatio;
  return T.scoreSpeedFloor + (1 - T.scoreSpeedFloor) * clamp01((speed - lo) / (hi - lo));
}

// Why a sample does or does not count as a drift. Used for scoring and shown in
// the debug panel, so it returns a readable reason rather than a boolean.
export function classifyDrift(sample, wasDrifting, sinceNewGround, T = TUNING) {
  const slipAbs = Math.abs(sample.slipAngle);
  const minSlip = wasDrifting ? T.driftExitSlip : T.driftMinSlip;
  if (sample.speed < T.topSpeed * T.driftMinSpeedRatio) return 'too slow';
  if (sample.forwardSpeed <= 0) return 'reversing';
  if (slipAbs < minSlip) return 'low angle';
  if (slipAbs >= T.spinoutSlip) return 'over-rotated';
  if (sample.surface === 'grass') return 'off road';
  if (sample.progressRate < T.driftMinProgressRate) return 'no progress';
  if (sinceNewGround > T.newGroundRecentWindow) return 'repeat ground';
  return 'drifting';
}

function endCombo(state, banked, reason) {
  const combo = state.combo;
  if (!combo) return;
  const multiplier = currentMultiplier(combo);
  const points = Math.round(combo.points * multiplier);
  if (banked) {
    state.score += points;
    if (points > state.bestCombo) state.bestCombo = points;
  }
  // A flicker worth almost nothing should not interrupt the driver with a message.
  if (points >= TUNING.comboAnnounceMinimum) {
    state.event = { type: banked ? 'banked' : 'lost', points, multiplier, reason };
    state.eventSerial += 1;
  }
  state.combo = null;
  state.drifting = false;
  state.driftHold = 0;
}

export function currentMultiplier(combo, T = TUNING) {
  return T.comboTiers[combo.tier];
}

export function bankCombo(state, reason = 'banked') {
  endCombo(state, true, reason);
}

export function loseCombo(state, reason) {
  endCombo(state, false, reason);
}

function earnTier(combo, T) {
  if (combo.tier < T.comboTiers.length - 1) combo.tier += 1;
  combo.tierGround = 0;
  combo.linkGround = 0;
}

// Update from one simulation step. `sample` holds speed, forwardSpeed, slipAngle,
// surface, progressRate, newGround, handbrake and (optionally) impact speed.
export function updateScoring(state, sample, dt, T = TUNING) {
  const slipAbs = Math.abs(sample.slipAngle);
  const newGround = sample.newGround ?? 0;

  state.sinceNewGround = newGround > 0 ? 0 : state.sinceNewGround + dt;
  state.handbrakeTime = sample.handbrake ? state.handbrakeTime + dt : 0;

  // A hard barrier hit ends an unbanked combo before anything else.
  if (sample.impact >= T.barrierSignificantImpact && state.combo) loseCombo(state, 'hit the wall');

  // Spinouts: past the threshold, at speed, for a moment.
  if (slipAbs >= T.spinoutSlip && sample.speed >= T.spinoutMinSpeed) state.spinTimer += dt;
  else state.spinTimer = 0;
  if (!state.spunOut && state.spinTimer >= T.spinoutHoldTime) {
    state.spunOut = true;
    state.spinouts += 1;
    if (state.combo) loseCombo(state, 'spun out');
  }
  if (state.spunOut && (slipAbs < T.spinoutRecoverSlip || sample.speed < T.spinoutMinSpeed)) {
    state.spunOut = false;
  }

  // Time on the grass eats into a live combo.
  state.offTrackTime = sample.surface === 'grass' ? state.offTrackTime + dt : 0;
  if (state.combo && state.offTrackTime >= T.comboOffTrackLimit) loseCombo(state, 'off the track');

  const reason = state.spunOut ? 'spun out' : classifyDrift(sample, state.drifting, state.sinceNewGround, T);
  state.qualification = reason;
  const valid = reason === 'drifting';

  // Require the slide to last a moment, so that one wiggle does not start a combo.
  state.driftHold = valid ? state.driftHold + dt : 0;
  const nowDrifting = valid && state.driftHold >= T.driftConfirmTime;
  const startedDrift = nowDrifting && !state.drifting;
  state.drifting = nowDrifting;

  if (startedDrift && !state.combo) {
    state.combo = {
      points: 0,
      tier: 0,
      grace: T.comboGrace,
      tierGround: 0,
      linkGround: 0,
      stallTimer: 0,
      stallGround: 0,
      side: Math.sign(sample.slipAngle),
    };
    if (state.bestMultiplier < 1) state.bestMultiplier = 1;
  } else if (startedDrift && state.combo) {
    // Relinked inside the grace window: worth a tier if the car actually moved on.
    if (state.combo.linkGround >= T.comboLinkGround) earnTier(state.combo, T);
    state.combo.side = Math.sign(sample.slipAngle);
  }

  const combo = state.combo;
  if (!combo) return;

  combo.linkGround += newGround;
  combo.stallGround += newGround;
  combo.stallTimer += dt;
  if (combo.stallGround >= T.comboStallGround) {
    combo.stallGround = 0;
    combo.stallTimer = 0;
  } else if (combo.stallTimer >= T.comboStallWindow) {
    loseCombo(state, 'stopped making progress');
    return;
  }

  if (nowDrifting) {
    combo.grace = T.comboGrace;
    combo.tierGround += newGround;
    const handbrakeShare = state.handbrakeTime > T.handbrakeScoreGrace ? T.handbrakeScoreFactor : 1;
    combo.points += T.driftPointsPerSecond * angleScore(slipAbs, T) * speedScore(sample.speed, T) * handbrakeShare * dt;

    // Flicking from one side to the other is the most skilful link.
    const side = Math.sign(sample.slipAngle);
    if (side !== 0 && side !== combo.side) {
      combo.side = side;
      if (combo.linkGround >= T.comboLinkGround) earnTier(combo, T);
    }
    if (combo.tierGround >= T.comboTierGround) earnTier(combo, T);
    if (currentMultiplier(combo, T) > state.bestMultiplier) state.bestMultiplier = currentMultiplier(combo, T);
  } else {
    combo.grace -= dt;
    if (combo.grace <= 0) bankCombo(state);
  }
}
