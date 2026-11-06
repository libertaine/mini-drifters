// Lap validation. A lap only counts if every checkpoint was crossed in order, in
// the forward direction, before crossing the finish line. A lap with a missed
// checkpoint is voided at the line and timing restarts there, so a mistake never
// forces the driver to turn back.
import { gateCrossing } from './track.js';

export function createLaps() {
  return {
    completed: 0,
    next: 0,         // index of the next checkpoint; gates.length means "go to the line"
    valid: true,     // false once a checkpoint has been skipped this lap
    lapTime: 0,
    bestLap: null,
    lastLap: null,
    voided: 0,
  };
}

// Returns 'lap', 'void' or null for what happened on the finish line this step.
export function updateLaps(laps, track, ax, ay, bx, by, dt) {
  laps.lapTime += dt;

  for (let i = 0; i < track.gates.length; i += 1) {
    if (gateCrossing(track.gates[i], ax, ay, bx, by) !== 1) continue;
    if (i === laps.next) {
      laps.next = i + 1;
    } else if (i > laps.next) {
      laps.next = i + 1;
      laps.valid = false;
    }
  }

  if (gateCrossing(track.finish, ax, ay, bx, by) !== 1) return null;

  // Rolling back over the line and across it again, with nothing done since, is ignored.
  if (laps.next === 0 && laps.valid) return null;

  const complete = laps.next === track.gates.length && laps.valid;
  const time = laps.lapTime;
  laps.next = 0;
  laps.valid = true;
  laps.lapTime = 0;
  if (!complete) {
    laps.voided += 1;
    return 'void';
  }
  laps.completed += 1;
  laps.lastLap = time;
  if (laps.bestLap === null || time < laps.bestLap) laps.bestLap = time;
  return 'lap';
}
