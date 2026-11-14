// Browser-local personal bests, per track AND handling mode. A record's identity is
// track + handling mode + record type. Lap times are in seconds.
//
// Storage. v0.3.0 writes only RECORDS_KEY, schema 2:
//   { version: 2, tracks: { <trackId>: { <handlingId>: { score, fastestLap, bestCombo } } } }
// v0.2.0 wrote LEGACY_RECORDS_KEY, schema 1: { version: 1, tracks: { <trackId>: { ... } } }.
//
// The legacy key is never written. v0.2.0 reads anything that isn't schema 1 as empty, and its
// next new best then overwrites the whole key, so upgrading that key in place would be destroyed
// by a v0.2.0 tab left open or by a rollback. Instead the legacy key is only read, with v0.2.0's
// own rules, and folded into Classic (every v0.2.0 record was driven with Classic) on every read:
//
//   shown Classic best = the better of (the schema 2 Classic best, the v0.2.0 best), per type
//
// That is the whole migration. It is a pure function of the two saved strings, it invents
// nothing, it is idempotent, and it keeps picking up anything a v0.2.0 tab saves later. The
// folded values are copied into the new key the first time a new best is written there.
// Rollback limitation: v0.2.0 shows only its own key, so bests set first in v0.3.0 don't
// appear there (nothing is lost; upgrading again shows them).
//
// Rules, unchanged from v0.2.0: only a successful write makes a record (and a NEW BEST), both
// keys are re-read at every record boundary, nothing is written on load, and unparseable or
// shapeless data in the key is replaced by the next write. New: a key holding a later schema
// (an integer version above 2) is left strictly alone: shown records fall back to v0.2.0's,
// nothing is written and no NEW BEST is claimed.
import { HANDLING_IDS } from './handling.js';

export const RECORDS_KEY = 'mini-drifters-records-v2';
export const LEGACY_RECORDS_KEY = 'mini-drifters-records';
export const SCHEMA_VERSION = 2;
export const LEGACY_HANDLING_ID = 'classic';
export const RECORD_TYPES = Object.freeze(['score', 'fastestLap', 'bestCombo']);
const TRACK_IDS = ['original', 'switchback'];

const object = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const points = (v) => Number.isSafeInteger(v) && v >= 0;
const lapTime = (v) => Number.isFinite(v) && v > 0 && v <= Number.MAX_SAFE_INTEGER;
const valid = (type, v) => (type === 'fastestLap' ? lapTime(v) : points(v));
const lower = (type) => type === 'fastestLap';
const emptyEntry = () => ({ score: null, fastestLap: null, bestCombo: null });
const flags = () => ({ score: false, fastestLap: false, bestCombo: false });
// null is "no record"; 0 is a real score or combo and is kept.
const sanitize = (entry) => (object(entry) ? Object.fromEntries(RECORD_TYPES.map((t) => [t, valid(t, entry[t]) ? entry[t] : null])) : emptyEntry());
const better = (type, a, b) => (a === null ? b : b === null ? a : lower(type) ? Math.min(a, b) : Math.max(a, b));
const improves = (type, value, old) => valid(type, value) && (old === null || (lower(type) ? value < old : value > old));

// The schema 2 key: 'empty' | 'ok' | 'corrupt' (unparseable, shapeless or not a real schema
// version: the next write replaces it) | 'unsupported' (a later schema: never written).
export function readStore(raw) {
  if (raw === null || raw === undefined) return { status: 'empty', saved: null };
  let parsed;
  try { parsed = JSON.parse(raw); } catch { return { status: 'corrupt', saved: null }; }
  if (!object(parsed)) return { status: 'corrupt', saved: null };
  if (parsed.version === SCHEMA_VERSION) return { status: 'ok', saved: parsed };
  if (Number.isSafeInteger(parsed.version) && parsed.version > SCHEMA_VERSION) return { status: 'unsupported', saved: null };
  return { status: 'corrupt', saved: null };
}

// The v0.2.0 key, read exactly as v0.2.0 decodes it: 'empty' | 'ok' | 'ignored'.
export function readLegacy(raw) {
  if (raw === null || raw === undefined) return { status: 'empty', tracks: null };
  let saved;
  try { saved = JSON.parse(raw); } catch { return { status: 'ignored', tracks: null }; }
  if (!object(saved) || saved.version !== 1 || !object(saved.tracks)) return { status: 'ignored', tracks: null };
  const tracks = {};
  for (const id of TRACK_IDS) tracks[id] = sanitize(saved.tracks[id]);
  return { status: 'ok', tracks };
}

// The migration. Pure: the same inputs give the same table, however many times it runs.
export function combine(store, legacy, trackIds = TRACK_IDS, handlingIds = HANDLING_IDS) {
  const tracks = object(store.saved?.tracks) ? store.saved.tracks : {};
  const table = {};
  for (const trackId of trackIds) {
    const modes = object(tracks[trackId]) ? tracks[trackId] : {};
    table[trackId] = Object.fromEntries(handlingIds.map((id) => [id, sanitize(modes[id])]));
    const old = legacy.tracks?.[trackId];
    if (old && handlingIds.includes(LEGACY_HANDLING_ID)) {
      const classic = table[trackId][LEGACY_HANDLING_ID];
      for (const type of RECORD_TYPES) classic[type] = better(type, classic[type], old[type]);
    }
  }
  return table;
}

// What a write stores: the saved object with the known entries replaced. Tracks, modes and
// fields this version does not know about are carried over untouched. That includes records
// saved under a retired mode id (RETIRED_HANDLING_IDS in handling.js, such as Tuned Power's
// `tuned`): they are not shown or offered, but never deleted or folded into another mode.
export function serialize(store, table) {
  const out = store.status === 'ok' ? structuredClone(store.saved) : {};
  out.version = SCHEMA_VERSION;
  if (!object(out.tracks)) out.tracks = {};
  for (const [trackId, modes] of Object.entries(table)) {
    if (!object(out.tracks[trackId])) out.tracks[trackId] = {};
    for (const [id, entry] of Object.entries(modes)) {
      const kept = object(out.tracks[trackId][id]) ? out.tracks[trackId][id] : {};
      out.tracks[trackId][id] = { ...kept, ...entry };
    }
  }
  return out;
}

export function createRecords(storageProvider = () => globalThis.localStorage) {
  let table = combine(readStore(null), readLegacy(null));
  let storage = null;
  let available = true;
  let readOnly = false;
  let session = null;
  let newBests = flags();

  const read = () => ({ store: readStore(storage.getItem(RECORDS_KEY)), legacy: readLegacy(storage.getItem(LEGACY_RECORDS_KEY)) });
  function apply({ store, legacy }) {
    table = combine(store, legacy);
    readOnly = store.status === 'unsupported';
    return store;
  }

  try {
    storage = storageProvider();
    if (!storage || typeof storage.getItem !== 'function' || typeof storage.setItem !== 'function') throw new Error('No storage');
    apply(read());
  } catch { storage = null; available = false; }

  function improve(values) {
    if (!storage) return;
    // Another tab (this version or v0.2.0) may have saved since this page opened. Re-read
    // only at record boundaries so this write preserves its latest saved bests.
    let snapshot;
    try { snapshot = read(); } catch { available = false; return; }
    const store = apply(snapshot);
    if (readOnly) return; // a later version's data: never overwritten, never a NEW BEST
    const { trackId, handling } = session;
    const old = table[trackId][handling];
    const next = { ...old };
    const improved = flags();
    for (const [type, value] of Object.entries(values)) {
      if (improves(type, value, old[type])) { next[type] = value; improved[type] = true; }
    }
    if (!Object.values(improved).some(Boolean)) return;
    const candidate = { ...table, [trackId]: { ...table[trackId], [handling]: next } };
    try {
      storage.setItem(RECORDS_KEY, JSON.stringify(serialize(store, candidate)));
      table = candidate;
      available = true;
      for (const type of RECORD_TYPES) newBests[type] ||= improved[type];
    } catch { available = false; }
  }

  return {
    get available() { return available; },
    get readOnly() { return readOnly; },
    get newBests() { return { ...newBests }; },
    forTrack(trackId, handlingId) {
      return TRACK_IDS.includes(trackId) && HANDLING_IDS.includes(handlingId) ? { ...table[trackId][handlingId] } : emptyEntry();
    },
    // Only a normal run on a known circuit in a known handling mode can set a record. The
    // lesson and the practice pad never can. Events carry copies of session results, never
    // mutable physics or scoring state, and must name the same run, track and mode.
    handle(event) {
      if (event.type === 'start') {
        session = event.mode === 'normal' && TRACK_IDS.includes(event.trackId) && HANDLING_IDS.includes(event.handling)
          ? { trackId: event.trackId, handling: event.handling, runId: event.runId } : null;
        newBests = flags();
        return;
      }
      if (event.type === 'abandon') { session = null; newBests = flags(); return; }
      if (!session || event.runId !== session.runId || event.trackId !== session.trackId || event.handling !== session.handling) return;
      if (event.type === 'lap' && event.valid === true) improve({ fastestLap: event.time });
      if (event.type === 'finish') {
        if (event.completed === 3) improve({ score: event.score, bestCombo: event.bestCombo });
        session = null; // finish is settled only once
      }
    },
  };
}
