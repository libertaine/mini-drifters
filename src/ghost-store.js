// The saved reference ghost: one recorded flying lap per circuit and handling mode, kept in the
// browser between visits. This file is the encoding, the validator and the storage. Which laps
// are offered, and when, is reference-ghost.js. Nothing in the simulation reads either.
//
// A saved lap is a picture of a lap, like the previous-lap ghost (ghost.js): poses, not inputs.
// It proves nothing about how the lap was driven, and the checksum below only catches accidental
// damage. Anyone can write a valid-looking entry by hand.
//
// Storage. One key of its own, GHOST_STORE_KEY, never the records' keys:
//   { version: 1, ghosts: { <trackId>: { <handlingId>: <entry> } } }
// Each entry (ENTRY_FORMAT 1) is quantised and delta-coded, about 15k characters for a typical lap:
//   { format: 1, compatibility, trackId, handlingId, track, rules, tickRate, sampleEvery,
//     durationTicks, lapTime, kind: 'best' | 'reference', n, dx, dy, dh, checksum }
//   dx, dy  position in centimetres: the first value absolute, then each change from the last
//   dh      heading in milliradians, the same way
//   ticks   not stored: samples sit every `sampleEvery` ticks, plus a final one on the line at
//           durationTicks, exactly as ghost.js records them
//   kind    'best' only if this lap set a new fastest-lap record (records.js) when it was saved
//
// Rules: nothing is written on load or on reading; a write happens only when a better flying lap
// is offered, after re-reading the key, and keeps every other track, mode and field it finds; a
// write is only reported as saved when setItem returned; a later store version (version above 1)
// is never written; and an entry from a later compatibility version is never replaced. A store
// that cannot be parsed, or an entry that fails any check, reads as "no reference" and is replaced
// by the next qualifying lap. The records' keys are never read or written here.
import { createGhost, GHOST_FORMAT, SAMPLE_EVERY } from './ghost.js';
import { TRACKS, trackById } from './track.js';
import { handlingById } from './handling.js';
import { TUNING } from './tuning.js';

export const GHOST_STORE_KEY = 'mini-drifters-ghosts-v1';
export const GHOST_STORE_VERSION = 1;
export const ENTRY_FORMAT = 1;

// The explicit compatibility version. Raise it by hand, in the same change, whenever anything
// that moves the car or decides a lap changes: physics.js, tuning.js and handling.js values,
// surfaces, barriers, obstacles and scenery collision, track geometry, lap timing or validation,
// or the simulation step. Saved laps from any other version are then never shown, and the next
// qualifying lap replaces them. The track and rules fingerprints below are a second line of
// defence only: R0 found they were identical between v0.5.0 and v0.6.0, although v0.6.0's
// Dockyard drives up to 119 m differently. test/ghost-store.test.mjs pins the inputs this
// version covers, so a change to them fails until it has been reviewed here. See docs/GHOST.md.
//   1  v0.6.0's physics and circuit environments (aa46ea2), unchanged in v0.7.0.
export const GHOST_COMPATIBILITY = 1;
export const GHOST_COMPATIBILITY_BASELINE = 'v0.6.0';

const TICK_RATE = Math.round(1 / TUNING.simStep);
// Laps over five minutes aren't saved (they still play as the previous-lap ghost). That keeps the
// worst case for all six slots near 0.9 MiB, well inside a typical 5 MiB origin quota.
export const MAX_SAVED_TICKS = 5 * 60 * TICK_RATE;
export const MAX_SAMPLES = Math.floor((MAX_SAVED_TICKS - 1) / SAMPLE_EVERY) + 2;
export const MAX_ENTRY_CHARS = 160_000;   // one serialised entry
export const MAX_STORE_CHARS = 2_000_000; // the whole key, before it is even parsed
const POS_Q = 100;   // centimetres
const HEAD_Q = 1000; // milliradians
const WORLD = 5000;  // metres from the origin; every circuit sits well inside 1 km
const MAX_HEADING = 10_000; // radians: headings keep counting through every turn of a run
const MAX_SPEED = 120; // m/s between samples, about three times the car's top speed

const object = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

// FNV-1a, 32 bits: cheap and deterministic, for catching damage. Not a signature.
function fnv1a(text) {
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

const CHECKED = ['format', 'compatibility', 'trackId', 'handlingId', 'track', 'rules', 'tickRate', 'sampleEvery',
  'durationTicks', 'lapTime', 'kind', 'n'];
export function entryChecksum(entry) {
  return fnv1a(`${CHECKED.map((k) => String(entry[k])).join('|')}|${entry.dx.join(',')}|${entry.dy.join(',')}|${entry.dh.join(',')}`);
}

// What a running game expects of a saved lap on this circuit in this mode, or null for an
// unknown circuit or mode.
export function expectedIdentity(trackId, handlingId) {
  const handling = handlingById(handlingId);
  if (!TRACKS.some((t) => t.id === trackId) || !handling) return null; // trackById throws on an unknown id
  const { track: trackPrint, rules } = createGhost(trackById(trackId), handling.tuning);
  return { compatibility: GHOST_COMPATIBILITY, trackId, handlingId, track: trackPrint, rules, tickRate: TICK_RATE, sampleEvery: SAMPLE_EVERY };
}

const delta = (values, q) => {
  let last = 0;
  return values.map((v) => { const n = Math.round(v * q); const d = n - last; last = n; return d; });
};
const undelta = (deltas, q) => {
  let acc = 0;
  return deltas.map((d) => (acc += d) / q);
};

// A ghost.js recording as a saved entry. `kind` is 'best' or 'reference'.
export function encodeEntry(recording, identity, lapTime, kind) {
  const entry = {
    format: ENTRY_FORMAT,
    compatibility: identity.compatibility,
    trackId: identity.trackId,
    handlingId: identity.handlingId,
    track: recording.track,
    rules: recording.rules,
    tickRate: recording.tickRate,
    sampleEvery: recording.sampleEvery,
    durationTicks: recording.durationTicks,
    lapTime,
    kind,
    n: recording.x.length,
    dx: delta(recording.x, POS_Q),
    dy: delta(recording.y, POS_Q),
    dh: delta(recording.heading, HEAD_Q),
  };
  entry.checksum = entryChecksum(entry);
  return entry;
}

const fail = (status, reason) => ({ ok: false, status, reason });

// The strict check before a saved lap is ever drawn. Never throws. Returns { ok: true, recording,
// lapTime, kind } with a ghost.js recording, or { ok: false, status, reason } where status is
//   'newer'         saved by a later version: kept, never shown here and never replaced
//   'incompatible'  another compatibility version, circuit, mode or clock: replaced by the next lap
//   'corrupt'       damaged or not an entry at all: replaced by the next lap
export function decodeEntry(entry, expect) {
  try {
    return decode(entry, expect);
  } catch {
    return fail('corrupt', 'unreadable');
  }
}

function decode(entry, expect) {
  if (!object(entry)) return fail('corrupt', 'not an entry');
  if (!Number.isSafeInteger(entry.format)) return fail('corrupt', 'format');
  if (entry.format > ENTRY_FORMAT) return fail('newer', 'format');
  if (entry.format !== ENTRY_FORMAT) return fail('incompatible', 'format');
  if (!Number.isSafeInteger(entry.compatibility)) return fail('corrupt', 'compatibility');
  if (entry.compatibility > expect.compatibility) return fail('newer', 'compatibility');
  if (entry.compatibility !== expect.compatibility) return fail('incompatible', 'compatibility');
  for (const key of ['trackId', 'handlingId', 'track', 'rules']) {
    if (typeof entry[key] !== 'string') return fail('corrupt', key);
    if (entry[key] !== expect[key]) return fail('incompatible', key);
  }
  if (entry.tickRate !== expect.tickRate || entry.sampleEvery !== expect.sampleEvery) return fail('incompatible', 'clock');
  if (entry.kind !== 'best' && entry.kind !== 'reference') return fail('corrupt', 'kind');
  const { durationTicks: duration, n, sampleEvery } = entry;
  if (!Number.isSafeInteger(duration) || duration < 1 || duration > MAX_SAVED_TICKS) return fail('corrupt', 'duration');
  if (!Number.isSafeInteger(n) || n < 2 || n > MAX_SAMPLES) return fail('corrupt', 'sample count');
  // ghost.js samples tick 0, every sampleEvery ticks before the line, and the line crossing.
  if (n !== Math.floor((duration - 1) / sampleEvery) + 2) return fail('corrupt', 'samples vs duration');
  if (typeof entry.lapTime !== 'number' || !Number.isFinite(entry.lapTime)
    || Math.abs(entry.lapTime - duration / entry.tickRate) > 1e-6) return fail('corrupt', 'lap time vs duration');
  for (const key of ['dx', 'dy', 'dh']) {
    const column = entry[key];
    if (!Array.isArray(column) || column.length !== n) return fail('corrupt', `${key} length`);
    for (let i = 0; i < n; i += 1) if (!Number.isSafeInteger(column[i])) return fail('corrupt', `${key} values`);
  }
  if (typeof entry.checksum !== 'string' || entry.checksum !== entryChecksum(entry)) return fail('corrupt', 'checksum');

  const ticks = Array.from({ length: n }, (_, i) => (i === n - 1 ? duration : i * sampleEvery));
  const x = undelta(entry.dx, POS_Q);
  const y = undelta(entry.dy, POS_Q);
  const heading = undelta(entry.dh, HEAD_Q);
  for (let i = 0; i < n; i += 1) {
    if (Math.abs(x[i]) > WORLD || Math.abs(y[i]) > WORLD) return fail('corrupt', 'out of world');
    if (Math.abs(heading[i]) > MAX_HEADING) return fail('corrupt', 'heading');
    if (i > 0) {
      const dt = (ticks[i] - ticks[i - 1]) / entry.tickRate;
      if (Math.hypot(x[i] - x[i - 1], y[i] - y[i - 1]) / dt > MAX_SPEED) return fail('corrupt', 'teleport');
    }
  }
  const recording = { format: GHOST_FORMAT, track: entry.track, rules: entry.rules, tickRate: entry.tickRate,
    sampleEvery, durationTicks: duration, ticks, x, y, heading };
  return { ok: true, recording, lapTime: entry.lapTime, kind: entry.kind };
}

// The key: 'empty' | 'ok' | 'corrupt' (replaced by the next write) | 'unsupported' (a later
// store version: never written).
export function readGhostStore(raw) {
  if (raw === null || raw === undefined) return { status: 'empty', saved: null };
  if (typeof raw !== 'string' || raw.length > MAX_STORE_CHARS) return { status: 'corrupt', saved: null };
  let parsed;
  try { parsed = JSON.parse(raw); } catch { return { status: 'corrupt', saved: null }; }
  if (!object(parsed)) return { status: 'corrupt', saved: null };
  if (parsed.version === GHOST_STORE_VERSION) return { status: 'ok', saved: parsed };
  if (Number.isSafeInteger(parsed.version) && parsed.version > GHOST_STORE_VERSION) return { status: 'unsupported', saved: null };
  return { status: 'corrupt', saved: null };
}

const savedEntry = (store, trackId, handlingId) => {
  const ghosts = object(store.saved?.ghosts) ? store.saved.ghosts : {};
  const modes = object(ghosts[trackId]) ? ghosts[trackId] : {};
  return modes[handlingId];
};

// What a slot holds, for one circuit and mode. `status` is one of
//   'ok'            a lap that can be shown (with recording, lapTime and kind)
//   'none'          nothing saved yet
//   'incompatible'  saved under other physics or a changed circuit: not shown, replaced next time
//   'corrupt'       damaged: not shown, replaced next time
//   'newer'         saved by a later version: kept, not shown and not replaced
//   'unsupported'   the whole key is a later version's: nothing shown or written
//   'unavailable'   no browser storage
export function slotFrom(store, trackId, handlingId) {
  if (store.status === 'unsupported') return { status: 'unsupported' };
  const expect = expectedIdentity(trackId, handlingId);
  if (!expect) return { status: 'none' };
  const entry = savedEntry(store, trackId, handlingId);
  if (entry === undefined || entry === null) return { status: 'none' };
  const decoded = decodeEntry(entry, expect);
  return decoded.ok ? { status: 'ok', ...decoded } : { status: decoded.status, reason: decoded.reason };
}

// The replacement rule, given what the slot holds now and a qualifying flying lap's time:
// anything that can't be shown is replaced, a later version's lap never is, and a lap that can be
// shown only by a strictly faster one. A tie keeps what is there.
export function replaces(slot, lapTime) {
  if (slot.status === 'newer' || slot.status === 'unsupported' || slot.status === 'unavailable') return false;
  if (slot.status !== 'ok') return true;
  return lapTime < slot.lapTime;
}

export function createGhostStore(storageProvider = () => globalThis.localStorage) {
  let storage = null;
  try {
    storage = storageProvider();
    if (!storage || typeof storage.getItem !== 'function' || typeof storage.setItem !== 'function') storage = null;
  } catch { storage = null; }

  const read = () => readGhostStore(storage.getItem(GHOST_STORE_KEY));

  return {
    get available() { return storage !== null; },
    // Reads the key afresh, so a lap another tab saved is picked up at the next run.
    slot(trackId, handlingId) {
      if (!storage) return { status: 'unavailable' };
      try { return slotFrom(read(), trackId, handlingId); } catch { return { status: 'unavailable' }; }
    },
    // Offers a qualifying flying lap. Returns { saved: true, slot } with the slot as reloaded
    // from what was written, or { saved: false, reason, slot } with the slot as it still is:
    // 'unavailable' | 'not faster' | 'newer' | 'unsupported' | 'unknown slot' | 'too long' |
    // 'too large' | 'write failed'.
    offer({ trackId, handlingId, recording, lapTime, kind }) {
      if (!storage) return { saved: false, reason: 'unavailable', slot: { status: 'unavailable' } };
      const expect = expectedIdentity(trackId, handlingId);
      if (!expect) return { saved: false, reason: 'unknown slot', slot: { status: 'none' } };
      let store;
      try { store = read(); } catch { return { saved: false, reason: 'unavailable', slot: { status: 'unavailable' } }; }
      const slot = slotFrom(store, trackId, handlingId);
      if (store.status === 'unsupported') return { saved: false, reason: 'unsupported', slot };
      if (slot.status === 'newer') return { saved: false, reason: 'newer', slot };
      if (recording.durationTicks > MAX_SAVED_TICKS) return { saved: false, reason: 'too long', slot };
      if (!replaces(slot, lapTime)) return { saved: false, reason: 'not faster', slot };
      const entry = encodeEntry(recording, expect, lapTime, kind);
      // Never save what this version would refuse to show.
      const check = decodeEntry(entry, expect);
      if (!check.ok) return { saved: false, reason: `invalid: ${check.reason}`, slot };
      const out = store.status === 'ok' ? structuredClone(store.saved) : {};
      out.version = GHOST_STORE_VERSION;
      if (!object(out.ghosts)) out.ghosts = {};
      if (!object(out.ghosts[trackId])) out.ghosts[trackId] = {};
      out.ghosts[trackId][handlingId] = entry;
      const text = JSON.stringify(out);
      if (JSON.stringify(entry).length > MAX_ENTRY_CHARS || text.length > MAX_STORE_CHARS) return { saved: false, reason: 'too large', slot };
      try {
        storage.setItem(GHOST_STORE_KEY, text);
      } catch {
        return { saved: false, reason: 'write failed', slot };
      }
      return { saved: true, slot: { status: 'ok', ...check } };
    },
  };
}
