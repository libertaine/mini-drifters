// Browser-local personal bests for the gymkhana challenges. They are kept apart from the
// circuit records (records.js) under a key of their own, so nothing here can change a circuit
// record and nothing there can change these.
//
// A record's identity is challenge + handling mode + rules:
//
//   time challenges   the best (lowest) total time in seconds, penalties included, filed under
//                     the challenge's own rules id (`rules` in gymkhana.js).
//   score challenges  the best (highest) score, filed under the challenge's rules id AND the
//                     scoring version it was earned under (SCORING_VERSION in scoring.js),
//                     since a change to what drifts pay makes old scores incomparable.
//
// Storage. One key, GYMKHANA_RECORDS_KEY, schema 1:
//   { version: 1, challenges: { <challengeId>: { <handlingId>: { <rulesId>: { best } } } } }
//
// The rules are the circuit records' own: only a successful write makes a record (and a NEW
// BEST), the key is re-read at every record boundary so another tab's bests are kept, nothing
// is written on load, and unparseable or shapeless data is replaced by the next write. A key
// holding a later schema (an integer version above 1) is left strictly alone: nothing is
// shown from it, nothing is written and no NEW BEST is claimed. Challenges, modes, rules ids
// and fields this version does not know are carried through every write untouched, so a record
// set under earlier rules is kept, unseen, and never competes with a current one.
//
// Qualification: only a run that completes its challenge sets a record. A failed, restarted or
// abandoned run never does. Ties do not improve a record. Zero is a real score; null is "no
// record".
import { HANDLING_IDS } from './handling.js';
import { SCORING_VERSION } from './scoring.js';
import { GYMKHANA_CHALLENGES, challengeById } from './gymkhana.js';

export const GYMKHANA_RECORDS_KEY = 'mini-drifters-gymkhana-v1';
export const GYMKHANA_SCHEMA_VERSION = 1;

const object = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const seconds = (v) => Number.isFinite(v) && v > 0 && v <= Number.MAX_SAFE_INTEGER;
const points = (v) => Number.isSafeInteger(v) && v >= 0;
const valid = (def, v) => (def.kind === 'time' ? seconds(v) : points(v));
const improves = (def, value, old) => valid(def, value) && (old === null || (def.kind === 'time' ? value < old : value > old));

// The partition a challenge's current record is filed under.
export function recordRules(def) {
  return def.kind === 'score' ? `${def.rules}+${SCORING_VERSION}` : def.rules;
}

// The saved key: 'empty' | 'ok' | 'corrupt' (the next write replaces it) | 'unsupported' (a
// later schema: never written).
export function readGymkhanaStore(raw) {
  if (raw === null || raw === undefined) return { status: 'empty', saved: null };
  let parsed;
  try { parsed = JSON.parse(raw); } catch { return { status: 'corrupt', saved: null }; }
  if (!object(parsed)) return { status: 'corrupt', saved: null };
  if (parsed.version === GYMKHANA_SCHEMA_VERSION) return { status: 'ok', saved: parsed };
  if (Number.isSafeInteger(parsed.version) && parsed.version > GYMKHANA_SCHEMA_VERSION) return { status: 'unsupported', saved: null };
  return { status: 'corrupt', saved: null };
}

// table[challengeId][handlingId] = the current best, or null. Pure.
export function gymkhanaTable(store) {
  const saved = object(store.saved?.challenges) ? store.saved.challenges : {};
  const table = {};
  for (const def of GYMKHANA_CHALLENGES) {
    const modes = object(saved[def.id]) ? saved[def.id] : {};
    table[def.id] = {};
    for (const handlingId of HANDLING_IDS) {
      const best = object(modes[handlingId]) && object(modes[handlingId][recordRules(def)]) ? modes[handlingId][recordRules(def)].best : null;
      table[def.id][handlingId] = valid(def, best) ? best : null;
    }
  }
  return table;
}

// What a write stores: the saved object with one record replaced, and everything else in it
// carried over untouched.
export function serializeGymkhana(store, def, handlingId, best) {
  const out = store.status === 'ok' ? structuredClone(store.saved) : {};
  out.version = GYMKHANA_SCHEMA_VERSION;
  if (!object(out.challenges)) out.challenges = {};
  if (!object(out.challenges[def.id])) out.challenges[def.id] = {};
  const modes = out.challenges[def.id];
  if (!object(modes[handlingId])) modes[handlingId] = {};
  const rules = recordRules(def);
  modes[handlingId][rules] = { ...(object(modes[handlingId][rules]) ? modes[handlingId][rules] : {}), best };
  return out;
}

export function createGymkhanaRecords(storageProvider = () => globalThis.localStorage) {
  let table = gymkhanaTable(readGymkhanaStore(null));
  let storage = null;
  let available = true;
  let readOnly = false;
  let session = null;
  let newBest = false;

  function load() {
    const store = readGymkhanaStore(storage.getItem(GYMKHANA_RECORDS_KEY));
    table = gymkhanaTable(store);
    readOnly = store.status === 'unsupported';
    return store;
  }

  try {
    storage = storageProvider();
    if (!storage || typeof storage.getItem !== 'function' || typeof storage.setItem !== 'function') throw new Error('No storage');
    load();
  } catch { storage = null; available = false; }

  const known = (challengeId, handlingId) => !!challengeById(challengeId) && HANDLING_IDS.includes(handlingId);

  function improve(def, handlingId, value) {
    if (!storage) return;
    // Another tab may have saved since this page opened: compare with what is saved now.
    let store;
    try { store = load(); } catch { available = false; return; }
    if (readOnly) return; // a later version's data: never overwritten, never a NEW BEST
    if (!improves(def, value, table[def.id][handlingId])) return;
    try {
      storage.setItem(GYMKHANA_RECORDS_KEY, JSON.stringify(serializeGymkhana(store, def, handlingId, value)));
      table = { ...table, [def.id]: { ...table[def.id], [handlingId]: value } };
      available = true;
      newBest = true;
    } catch { available = false; }
  }

  return {
    get available() { return available; },
    get readOnly() { return readOnly; },
    // True if the run just driven saved an improvement.
    get newBest() { return newBest; },
    // The record a run competes with: seconds or points, or null for none.
    bestFor(challengeId, handlingId) {
      return known(challengeId, handlingId) ? table[challengeId][handlingId] : null;
    },
    // The same events the circuit records see (game.js). Only a gymkhana session on a known
    // challenge in a known handling mode can set a record, and only its own 'challenge' event,
    // naming the same run, challenge and mode, settles it: once.
    handle(event) {
      if (event.type === 'start') {
        session = event.mode === 'gymkhana' && known(event.challengeId, event.handling)
          ? { challengeId: event.challengeId, handling: event.handling, runId: event.runId } : null;
        newBest = false;
        return;
      }
      if (event.type === 'abandon') { session = null; newBest = false; return; }
      if (event.type !== 'challenge' || !session) return;
      if (event.runId !== session.runId || event.challengeId !== session.challengeId || event.handling !== session.handling) return;
      if (event.completed === true) improve(challengeById(session.challengeId), session.handling, event.value);
      session = null;
    },
  };
}
