// Browser-local personal bests. A record's identity is track + handling mode + record type, and
// for the two record types that depend on what drifts pay (score and best combo) also the
// scoring version they were earned under (SCORING_VERSION in scoring.js). Lap times are in seconds.
//
//   score, bestCombo  per track, handling mode AND scoring version. A run only ever competes
//                     with records from its own scoring rules.
//   fastestLap        per track and handling mode, shared by every scoring version: scoring
//                     changes leave the car, the circuits and what makes a lap valid alone.
//
// Storage. This version writes only RECORDS_KEY, schema 3:
//   { version: 3, tracks: { <trackId>: { <handlingId>: {
//       fastestLap,
//       scoring: { <scoringVersion>: { score, bestCombo } } } } } }
//
// Two earlier keys are read, never written. Every record in them was scored with
// LEGACY_SCORING_VERSION (scoring-1), so their scores and combos are shown as legacy records,
// and their lap times count toward the shared fastest lap:
//   V2_RECORDS_KEY      schema 2, written by the handling-modes release (6ffe6bf):
//                       { version: 2, tracks: { <trackId>: { <handlingId>: { score, fastestLap, bestCombo } } } }
//   LEGACY_RECORDS_KEY  schema 1, written by v0.2.0, all Classic:
//                       { version: 1, tracks: { <trackId>: { score, fastestLap, bestCombo } } }
//
// Neither older key is upgraded in place. Each older version reads its own key, rewrites the
// whole of it on its next new best, and treats any other schema there as empty, so an in-place
// upgrade would be destroyed by an older tab left open or by a rollback, and a current score
// written there would be shown by the older version as one of its own. Instead the shown
// records are, on every read:
//
//   fastest lap          = the best of (schema 3, schema 2, v0.2.0 if Classic)
//   current score/combo  = schema 3 under SCORING_VERSION only. Nothing older is ever imported.
//   legacy score/combo   = the best of (schema 3 under scoring-1, schema 2, v0.2.0 if Classic)
//
// That is the whole migration. It is a pure function of the three saved strings, it invents
// nothing, it is idempotent, and it keeps picking up whatever an older tab saves later. The
// folded values are copied into the new key, each under its own scoring version, the first time
// a new best is written there. Rollback limitation: an older version shows only its own key, so
// records set first under the current scoring don't appear there (nothing is lost; upgrading
// again shows them).
//
// Rules, unchanged: only a successful write makes a record (and a NEW BEST), every key is
// re-read at every record boundary, nothing is written on load, and unparseable or shapeless
// data in the current key is replaced by the next write. A current key holding a later schema
// (an integer version above 3) is left strictly alone: shown records fall back to the older
// keys, nothing is written and no NEW BEST is claimed. Tracks, modes, scoring versions and fields
// this version does not know are carried through every write untouched.
import { HANDLING_IDS } from '../../src/handling.js';
import { SCORING_VERSION, LEGACY_SCORING_VERSION } from '../../src/scoring.js';

export const RECORDS_KEY = 'mini-drifters-records-v3';
export const V2_RECORDS_KEY = 'mini-drifters-records-v2';
export const LEGACY_RECORDS_KEY = 'mini-drifters-records';
export const SCHEMA_VERSION = 3;
export const LEGACY_HANDLING_ID = 'classic';
export const RECORD_TYPES = Object.freeze(['score', 'fastestLap', 'bestCombo']);
// The record types filed per scoring version. fastestLap is the only shared one.
export const SCORED_TYPES = Object.freeze(['score', 'bestCombo']);
// Every scoring version this version shows. Older keys hold only the legacy one.
export const SCORING_VERSIONS = Object.freeze([LEGACY_SCORING_VERSION, SCORING_VERSION]);
const TRACK_IDS = ['original', 'switchback'];

const object = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const points = (v) => Number.isSafeInteger(v) && v >= 0;
const lapTime = (v) => Number.isFinite(v) && v > 0 && v <= Number.MAX_SAFE_INTEGER;
const valid = (type, v) => (type === 'fastestLap' ? lapTime(v) : points(v));
const lower = (type) => type === 'fastestLap';
const emptyEntry = () => ({ score: null, fastestLap: null, bestCombo: null });
const emptyScored = () => ({ score: null, bestCombo: null });
const flags = () => ({ score: false, fastestLap: false, bestCombo: false });
// null is "no record"; 0 is a real score or combo and is kept.
const keep = (type, v) => (valid(type, v) ? v : null);
const sanitize = (entry) => (object(entry) ? Object.fromEntries(RECORD_TYPES.map((t) => [t, keep(t, entry[t])])) : emptyEntry());
const sanitizeScored = (entry) => (object(entry) ? Object.fromEntries(SCORED_TYPES.map((t) => [t, keep(t, entry[t])])) : emptyScored());
const better = (type, a, b) => (a === null ? b : b === null ? a : lower(type) ? Math.min(a, b) : Math.max(a, b));
const improves = (type, value, old) => valid(type, value) && (old === null || (lower(type) ? value < old : value > old));

// The current key: 'empty' | 'ok' | 'corrupt' (unparseable, shapeless or not a real schema
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

// The schema 2 key, read as the version that wrote it decodes it: 'empty' | 'ok' | 'ignored'.
// Only known tracks and modes are read. Anything else in it, such as the retired `tuned`, stays
// there untouched, since this key is never written.
export function readV2(raw, trackIds = TRACK_IDS, handlingIds = HANDLING_IDS) {
  if (raw === null || raw === undefined) return { status: 'empty', tracks: null };
  let saved;
  try { saved = JSON.parse(raw); } catch { return { status: 'ignored', tracks: null }; }
  if (!object(saved) || saved.version !== 2) return { status: 'ignored', tracks: null };
  const savedTracks = object(saved.tracks) ? saved.tracks : {};
  const tracks = {};
  for (const id of trackIds) {
    const modes = object(savedTracks[id]) ? savedTracks[id] : {};
    tracks[id] = Object.fromEntries(handlingIds.map((h) => [h, sanitize(modes[h])]));
  }
  return { status: 'ok', tracks };
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

// Fold one older, scoring-1 entry ({ score, fastestLap, bestCombo }) into a table entry.
function foldLegacy(entry, old) {
  entry.fastestLap = better('fastestLap', entry.fastestLap, old.fastestLap);
  const legacy = entry.scoring[LEGACY_SCORING_VERSION];
  for (const type of SCORED_TYPES) legacy[type] = better(type, legacy[type], old[type]);
}

// The migration. Pure: the same inputs give the same table, however many times it runs.
// table[trackId][handlingId] = { fastestLap, scoring: { <scoringVersion>: { score, bestCombo } } }
export function combine(store, v2, legacy, trackIds = TRACK_IDS, handlingIds = HANDLING_IDS) {
  const tracks = object(store.saved?.tracks) ? store.saved.tracks : {};
  const table = {};
  for (const trackId of trackIds) {
    const modes = object(tracks[trackId]) ? tracks[trackId] : {};
    table[trackId] = {};
    for (const handlingId of handlingIds) {
      const saved = object(modes[handlingId]) ? modes[handlingId] : {};
      const scoring = object(saved.scoring) ? saved.scoring : {};
      const entry = {
        fastestLap: keep('fastestLap', saved.fastestLap),
        scoring: Object.fromEntries(SCORING_VERSIONS.map((id) => [id, sanitizeScored(scoring[id])])),
      };
      const fromV2 = v2.tracks?.[trackId]?.[handlingId];
      if (fromV2) foldLegacy(entry, fromV2);
      const fromV020 = handlingId === LEGACY_HANDLING_ID ? legacy.tracks?.[trackId] : null;
      if (fromV020) foldLegacy(entry, fromV020);
      table[trackId][handlingId] = entry;
    }
  }
  return table;
}

// What a write stores: the saved object with the known entries replaced. Tracks, modes, scoring
// versions and fields this version does not know about are carried over untouched. That
// includes records saved under a retired mode id (RETIRED_HANDLING_IDS in handling.js, such as
// Tuned Power's `tuned`) and under a later scoring version: they are not shown, but never
// deleted or folded into another partition.
export function serialize(store, table) {
  const out = store.status === 'ok' ? structuredClone(store.saved) : {};
  out.version = SCHEMA_VERSION;
  if (!object(out.tracks)) out.tracks = {};
  for (const [trackId, modes] of Object.entries(table)) {
    if (!object(out.tracks[trackId])) out.tracks[trackId] = {};
    const savedModes = out.tracks[trackId];
    for (const [id, entry] of Object.entries(modes)) {
      const kept = object(savedModes[id]) ? savedModes[id] : {};
      const scoring = object(kept.scoring) ? { ...kept.scoring } : {};
      for (const [version, scored] of Object.entries(entry.scoring)) {
        scoring[version] = { ...(object(scoring[version]) ? scoring[version] : {}), ...scored };
      }
      savedModes[id] = { ...kept, fastestLap: entry.fastestLap, scoring };
    }
  }
  return out;
}

export function createRecords(storageProvider = () => globalThis.localStorage) {
  let table = combine(readStore(null), readV2(null), readLegacy(null));
  let storage = null;
  let available = true;
  let readOnly = false;
  let session = null;
  let newBests = flags();

  const read = () => ({
    store: readStore(storage.getItem(RECORDS_KEY)),
    v2: readV2(storage.getItem(V2_RECORDS_KEY)),
    legacy: readLegacy(storage.getItem(LEGACY_RECORDS_KEY)),
  });
  function apply({ store, v2, legacy }) {
    table = combine(store, v2, legacy);
    readOnly = store.status === 'unsupported';
    return store;
  }

  try {
    storage = storageProvider();
    if (!storage || typeof storage.getItem !== 'function' || typeof storage.setItem !== 'function') throw new Error('No storage');
    apply(read());
  } catch { storage = null; available = false; }

  // The value a record type is compared with: the shared lap, or this scoring version's own.
  const current = (entry, type) => (type === 'fastestLap' ? entry.fastestLap : entry.scoring[SCORING_VERSION][type]);

  function improve(values) {
    if (!storage) return;
    // Another tab (this version or an older one) may have saved since this page opened.
    // Re-read only at record boundaries so this write preserves its latest saved bests.
    let snapshot;
    try { snapshot = read(); } catch { available = false; return; }
    const store = apply(snapshot);
    if (readOnly) return; // a later version's data: never overwritten, never a NEW BEST
    const { trackId, handling } = session;
    const old = table[trackId][handling];
    const next = { fastestLap: old.fastestLap, scoring: { ...old.scoring, [SCORING_VERSION]: { ...old.scoring[SCORING_VERSION] } } };
    const improved = flags();
    for (const [type, value] of Object.entries(values)) {
      if (!improves(type, value, current(old, type))) continue;
      if (type === 'fastestLap') next.fastestLap = value;
      else next.scoring[SCORING_VERSION][type] = value;
      improved[type] = true;
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

  const known = (trackId, handlingId) => TRACK_IDS.includes(trackId) && HANDLING_IDS.includes(handlingId);

  return {
    get available() { return available; },
    get readOnly() { return readOnly; },
    // NEW BEST flags for the run just driven: score and combo against the current scoring
    // version's records only, the lap against the shared fastest lap.
    get newBests() { return { ...newBests }; },
    // The records a run competes with: the current scoring version's score and combo, and the
    // shared fastest lap.
    forTrack(trackId, handlingId) {
      if (!known(trackId, handlingId)) return emptyEntry();
      const entry = table[trackId][handlingId];
      return { score: current(entry, 'score'), fastestLap: entry.fastestLap, bestCombo: current(entry, 'bestCombo') };
    },
    // The score and combo records kept from the earlier scoring rules. Read-only history: no
    // run can set or beat them, and they are never compared with current scores.
    legacyForTrack(trackId, handlingId) {
      return known(trackId, handlingId) ? { ...table[trackId][handlingId].scoring[LEGACY_SCORING_VERSION] } : emptyScored();
    },
    // Only a normal run on a known circuit in a known handling mode can set a record. The
    // lesson and the practice pad never can. Events carry copies of session results, never
    // mutable physics or scoring state, and must name the same run, track and mode.
    handle(event) {
      if (event.type === 'start') {
        session = event.mode === 'normal' && known(event.trackId, event.handling)
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
