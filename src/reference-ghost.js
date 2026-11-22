// Which laps become the saved reference ghost, and which one a run is shown. Storage and
// validation are ghost-store.js; this listens to the session's run events, after the records
// (records.js) have, and never reads or writes anything of the simulation's.
//
// The policy:
// - Only a normal circuit run counts. The lesson, the practice pad and the gymkhana never do.
// - Only a valid, kept, flying lap is offered: the session's 'ghost' event with `flying`, which
//   is every lap timed from the line, so never a run's first lap (a standing start on the grid).
// - It is saved when the slot has nothing showable, or when it is strictly faster than the saved
//   lap. A tie, a slower lap, a voided or unfinished lap never replaces anything.
// - It is saved as 'best' only if this same lap has just set a new fastest-lap record, so the
//   record and the recording are known to be the same lap. Otherwise it is a 'reference': the
//   fastest recorded flying lap, which may be slower than an older record that has no recording
//   (every record from before v0.7.0, and any record set on a first lap).
// - Nothing is ever inferred for an old record, and the records are never changed here.
import { HANDLING_IDS } from './handling.js';
import { TRACKS } from './track.js';

export const GHOST_SOURCES = Object.freeze(['previous', 'reference', 'off']);
export const DEFAULT_GHOST_SOURCE = 'previous';

const TRACK_IDS = TRACKS.map((t) => t.id);
const known = (trackId, handlingId) => TRACK_IDS.includes(trackId) && HANDLING_IDS.includes(handlingId);

// `store` is createGhostStore(); `bestLapFor(trackId, handlingId)` is the current fastest-lap
// record (records.forTrack(...).fastestLap), read only.
export function createReferenceGhosts({ store, bestLapFor }) {
  let session = null;
  let slot = { status: 'none' };
  let lastResult = null;

  const matches = (event) => session && event.runId === session.runId && event.trackId === session.trackId
    && event.handling === session.handlingId;

  return {
    // The slot for the current run, or null when the run can't have a reference.
    get slot() { return session ? slot : null; },
    get session() { return session && { ...session }; },
    // The recording to show for the current run, or null.
    get recording() { return session && slot.status === 'ok' ? slot.recording : null; },
    // What happened to the last lap offered: { runId, time, saved, reason, kind }.
    get lastResult() { return lastResult && { ...lastResult }; },
    // Reads a slot afresh for a circuit and mode, for menus. Never writes.
    peek(trackId, handlingId) { return known(trackId, handlingId) ? store.slot(trackId, handlingId) : { status: 'none' }; },
    handle(event) {
      if (event.type === 'start') {
        lastResult = null;
        session = event.mode === 'normal' && known(event.trackId, event.handling)
          ? { trackId: event.trackId, handlingId: event.handling, runId: event.runId, bestBefore: bestLapFor(event.trackId, event.handling), lapPrior: null }
          : null;
        slot = session ? store.slot(session.trackId, session.handlingId) : { status: 'none' };
        return;
      }
      if (event.type === 'abandon') { session = null; lastResult = null; return; }
      if (!matches(event)) return;
      if (event.type === 'lap') {
        // The record before and after this lap, so the 'ghost' event that follows knows whether
        // this lap is the one that set it.
        session.lapPrior = session.bestBefore;
        session.bestBefore = bestLapFor(session.trackId, session.handlingId);
        return;
      }
      if (event.type === 'finish') return;
      if (event.type !== 'ghost' || event.flying !== true || !event.recording) return;
      const { lapPrior, bestBefore } = session;
      const setRecord = bestBefore === event.time && (lapPrior === null || event.time < lapPrior);
      const kind = setRecord ? 'best' : 'reference';
      const result = store.offer({ trackId: session.trackId, handlingId: session.handlingId, recording: event.recording, lapTime: event.time, kind });
      if (result.slot) slot = result.slot;
      lastResult = { runId: session.runId, time: event.time, saved: result.saved, reason: result.reason ?? null, kind };
    },
  };
}

// How a slot reads to the player, given the current fastest-lap record:
//   'best'       a recording of the lap that holds the record now
//   'reference'  a recorded lap that isn't (or is no longer known to be) the record
//   or the slot's own status: 'none' | 'incompatible' | 'corrupt' | 'newer' | 'unsupported' | 'unavailable'
export function slotState(slot, fastestLap) {
  if (!slot) return 'none';
  if (slot.status !== 'ok') return slot.status;
  return slot.kind === 'best' && slot.lapTime === fastestLap ? 'best' : 'reference';
}
