// Browser-local personal bests for Getaway missions. They are kept apart from the circuit records
// (records.js), the Gymkhana records (gymkhana-records.js) and the saved reference ghosts
// (ghost-store.js) under a key of their own, so nothing here can change any of those and nothing
// there can change these. A Getaway run still never records a lap, a circuit record or a ghost.
//
// A record's identity is mission + environment + handling mode + rules, all stable ids, never
// display labels:
//
//   mission       the mission id in getaway-missions.js ('get-the-footage')
//   environment   the environment's variant ('downtown' | 'industrial')
//   handling      the handling id ('classic' | 'revised'; Power is displayed for 'revised')
//   rules         the environment's rules id plus the drift scoring version (recordRules), so a
//                 future change to the mission's rules or to what drifts pay starts new records
//                 instead of comparing scores earned under different rules
//
// The best is the highest Showmanship (banked drift + destruction bonus) of a qualifying run:
// one that filmed every camera and escaped (the challenge completes only through the open escape
// gate). A bust, an expired clock, a cancelled upload, a retry or an abandoned run never sets one.
// Ties and lower scores do not improve a record and write nothing. Zero is a real score (a grip
// escape earns Bronze); null is "no record".
//
// Medals are never stored. They are derived from the saved best with the environment's own
// accepted targets (getawayMedal, the same function the results sheet uses), so the medal shown
// for a record can never disagree with its score.
//
// Storage. One key, GETAWAY_RECORDS_KEY, schema 1:
//   { version: 1, missions: { <missionId>: { <environmentId>: { <handlingId>: { <rulesId>: { best } } } } } }
//
// The rules are the Gymkhana records' own: only a successful write makes a record (and a NEW
// BEST), the key is re-read at every record boundary so another tab's bests are kept, nothing is
// written on load, and unparseable or shapeless data is replaced by the next write. A key holding a
// later schema (an integer version above 1) is left strictly alone: nothing is shown from it,
// nothing is written and no NEW BEST is claimed. Missions, environments, modes, rules ids and fields
// this version does not know are carried through every write untouched. A saved best that is not a
// whole number from 0 to MAX_SHOWMANSHIP is ignored (shown as no record) and replaced by the next
// qualifying run. If storage cannot be opened, read or written, the game plays on and the sheet says
// that improvements cannot be saved.
import { HANDLING_IDS } from './handling.js';
import { MEDALS } from './medals.js';
import { recordRules } from './gymkhana-records.js';
import { GETAWAY_MISSIONS } from './getaway-missions.js';

export const GETAWAY_RECORDS_KEY = 'mini-drifters-getaway-v1';
export const GETAWAY_SCHEMA_VERSION = 1;
// No run can score near this: 120 s of full-angle, full-speed drift at the top ×3 multiplier is
// about 50,400, and every breakable in a city adds at most 550 (unit test). Anything above it is
// damaged data, never a record.
export const MAX_SHOWMANSHIP = 1_000_000;

const object = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
export const validShowmanship = (v) => Number.isSafeInteger(v) && v >= 0 && v <= MAX_SHOWMANSHIP;

// The medal a Showmanship score earns in an environment and handling mode, from the environment's
// accepted targets: 'gold' | 'silver' | 'bronze', or null for no score (a failed run, no record).
export function getawayMedal(def, handlingId, value) {
  const targets = def?.medalTargets?.[handlingId] ?? null;
  if (!targets || !Number.isFinite(value) || value < 0) return null;
  return MEDALS.find((medal) => Math.round(value) >= targets[medal]) ?? null;
}

// challengeId -> { missionId, environmentId, rules } for every environment of every mission. An
// environment id offered by two missions would be ambiguous, so it is left out (never recorded);
// a unit test keeps the shipped missions free of that.
export function getawayIndex(missions = GETAWAY_MISSIONS) {
  const index = new Map();
  const dupes = new Set();
  for (const mission of missions) {
    for (const def of mission.environments) {
      if (index.has(def.id)) dupes.add(def.id);
      index.set(def.id, Object.freeze({ missionId: mission.id, environmentId: def.variant, rules: recordRules(def), def }));
    }
  }
  for (const id of dupes) index.delete(id);
  return index;
}

// The saved key: 'empty' | 'ok' | 'corrupt' (the next write replaces it) | 'unsupported' (a later
// schema: never written).
export function readGetawayStore(raw) {
  if (raw === null || raw === undefined) return { status: 'empty', saved: null };
  let parsed;
  try { parsed = JSON.parse(raw); } catch { return { status: 'corrupt', saved: null }; }
  if (!object(parsed)) return { status: 'corrupt', saved: null };
  if (parsed.version === GETAWAY_SCHEMA_VERSION) return { status: 'ok', saved: parsed };
  if (Number.isSafeInteger(parsed.version) && parsed.version > GETAWAY_SCHEMA_VERSION) return { status: 'unsupported', saved: null };
  return { status: 'corrupt', saved: null };
}

const tableKey = (challengeId, handlingId) => `${challengeId}|${handlingId}`;

// The saved best for one identity, or null. Pure.
function savedBest(store, entry, handlingId) {
  let node = store.saved?.missions;
  for (const step of [entry.missionId, entry.environmentId, handlingId, entry.rules]) {
    if (!object(node)) return null;
    node = node[step];
  }
  const best = object(node) ? node.best : null;
  return validShowmanship(best) ? best : null;
}

// table['<challengeId>|<handlingId>'] = the current best, or null. Pure.
export function getawayTable(store, index = getawayIndex()) {
  const table = new Map();
  for (const [challengeId, entry] of index) {
    for (const handlingId of HANDLING_IDS) table.set(tableKey(challengeId, handlingId), savedBest(store, entry, handlingId));
  }
  return table;
}

// What a write stores: the saved object with one record replaced, and everything else in it
// carried over untouched.
export function serializeGetaway(store, entry, handlingId, best) {
  const out = store.status === 'ok' ? structuredClone(store.saved) : {};
  out.version = GETAWAY_SCHEMA_VERSION;
  if (!object(out.missions)) out.missions = {};
  let node = out.missions;
  for (const step of [entry.missionId, entry.environmentId, handlingId]) {
    if (!object(node[step])) node[step] = {};
    node = node[step];
  }
  node[entry.rules] = { ...(object(node[entry.rules]) ? node[entry.rules] : {}), best };
  return out;
}

export function createGetawayRecords(storageProvider = () => globalThis.localStorage, missions = GETAWAY_MISSIONS) {
  const index = getawayIndex(missions);
  let table = getawayTable(readGetawayStore(null), index);
  let storage = null;
  let available = true;
  let readOnly = false;
  let session = null;
  let newBest = false;
  let previousBest = null; // what a NEW BEST replaced: the saved best just before the write

  function load() {
    const store = readGetawayStore(storage.getItem(GETAWAY_RECORDS_KEY));
    table = getawayTable(store, index);
    readOnly = store.status === 'unsupported';
    return store;
  }

  try {
    storage = storageProvider();
    if (!storage || typeof storage.getItem !== 'function' || typeof storage.setItem !== 'function') throw new Error('No storage');
    load();
  } catch { storage = null; available = false; }

  const known = (challengeId, handlingId) => index.has(challengeId) && HANDLING_IDS.includes(handlingId);

  function improve(challengeId, handlingId, value) {
    if (!storage || !validShowmanship(value)) return;
    // Another tab may have saved since this page opened: compare with what is saved now.
    let store;
    try { store = load(); } catch { available = false; return; }
    if (readOnly) return; // a later version's data: never overwritten, never a NEW BEST
    const key = tableKey(challengeId, handlingId);
    const before = table.get(key);
    if (before !== null && value <= before) return;
    try {
      storage.setItem(GETAWAY_RECORDS_KEY, JSON.stringify(serializeGetaway(store, index.get(challengeId), handlingId, value)));
      table = new Map(table).set(key, value);
      available = true;
      newBest = true;
      previousBest = before;
    } catch { available = false; }
  }

  return {
    get available() { return available; },
    get readOnly() { return readOnly; },
    // True if the run just driven saved an improvement.
    get newBest() { return newBest; },
    // When newBest is true, the best it replaced (null if it was the first).
    get previousBest() { return newBest ? previousBest : null; },
    // Is this challenge id a Getaway environment these records keep?
    has(challengeId) { return index.has(challengeId); },
    // The saved best Showmanship for an environment in a handling mode, or null for none.
    bestFor(challengeId, handlingId) {
      return known(challengeId, handlingId) ? table.get(tableKey(challengeId, handlingId)) : null;
    },
    // The same run events the other records see (game.js). Only a challenge session on a known
    // Getaway environment in a known handling mode can set a record, and only its own 'challenge'
    // event, naming the same run, environment and mode, settles it: once.
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
      if (event.completed === true) improve(session.challengeId, session.handling, event.value);
      session = null;
    },
  };
}
