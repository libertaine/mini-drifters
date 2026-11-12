// Handling modes: complete, named, immutable driving configurations.
//
// A run is given one mode when it starts and keeps it until the next start, so the mode cannot
// change during a run. Everything outside this file and physics.js (records, ghost, HUD, menu)
// reads only the mode's `id` or hands its `tuning` on. There is no `if (mode === 'revised')`.
//
// An `id` is permanent: it names a record partition (records.js). A mode whose physics change
// enough to make its old records unfair gets a new id rather than new numbers under the old one.
// test/handling.test.mjs pins every mode's numbers so such a change can't slip through review.
//
// Only the car's physics differ between modes. The rules (scoring, barriers, laps, session
// length) always read the shipped TUNING, whichever mode is driving.
//
// Two modes are public: Classic (v0.2.0's handling) and Power (id `revised`, kept from the
// physics lab so its records and ghosts keep their identity). The lab's other configurations,
// Tuned Power and Revised Low, stay research in the physics lab and do not ship.
import { TUNING } from './tuning.js';

// Power (id `revised`): the shipped numbers plus the rear grip budget and wheelspin state in physics.js
// (physics lab search sample 28, to two decimals).
const REVISED = Object.freeze({
  ...TUNING,
  tractionModel: 'budget',
  driveGripRatio: 1.38,      // straight-line traction as a multiple of cornering grip (an ellipse)
  driveCorneringCost: 1.37,  // how much of that traction a unit of cornering load uses up
  wheelspinRise: 7.04,       // wheelspin gained per second, per unit of excess demand
  wheelspinFall: 4.35,       // wheelspin lost per second once the engine asks for less
  wheelspinGripLoss: 0.7,    // share of rear cornering grip lost with the wheels fully spinning
  wheelspinThrustLoss: 0.67, // share of the excess thrust that is lost to wheelspin
  wheelspinFadeFrom: 21.1,   // m/s: below this the tyres can be spun up fully...
  wheelspinFadeTo: 28.9,     // ...and above this not at all (the higher gears)
});

const mode = (id, name, summary, tuning) => Object.freeze({ id, name, summary, tuning });

// Shown on the title in this order. Summaries say what the car does, not how hard it is, and
// neither mode is presented as the better one. Classic's tuning is the shipped TUNING object
// itself, not a copy, so it is v0.2.0 exactly. Power's display name is not its id: `revised`
// names its record partition and stays, whatever the mode is called on screen.
export const HANDLING_MODES = Object.freeze([
  mode('classic', 'Classic', 'Familiar, handbrake-focused drifting with forgiving handling.', TUNING),
  mode('revised', 'Power', 'Break rear traction with throttle. More control, more consequences.', REVISED),
]);

// Ids that once named a mode and must never name a different one. Tuned Power (`tuned`) was
// offered while v0.3.0 was being built; any records saved under it are carried through every
// write untouched (records.js), so the id stays reserved rather than reused.
export const RETIRED_HANDLING_IDS = Object.freeze(['tuned']);

export const HANDLING_IDS = Object.freeze(HANDLING_MODES.map((m) => m.id));
export const DEFAULT_HANDLING_ID = 'classic';

export function handlingById(id) {
  return HANDLING_MODES.find((m) => m.id === id) ?? null;
}

export const DEFAULT_HANDLING = handlingById(DEFAULT_HANDLING_ID);
