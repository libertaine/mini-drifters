// Browser-local completion counts for Getaway Driver: how many times this device has reached the
// safehouse each way (a Ghost run, Low profile, Lost them), per environment and handling mode. They
// are not scores, medals or records, and they are never sent anywhere: analytics hears only the
// game's own run events, which carry no outcome (docs/ANALYTICS.md).
//
// They are kept apart from everything else under a key of their own, so nothing here can change the
// circuit records, the Gymkhana records, the Get the Footage personal bests (getaway-records.js) or
// the saved ghosts, and nothing there can change these.
//
// A count's identity is environment + handling mode + outcome, all stable ids:
//   environment   the environment's variant ('downtown')
//   handling      the handling id ('classic' | 'revised'; Power is displayed for 'revised')
//   outcome       DRIVER_OUTCOMES id ('ghost' | 'low-profile' | 'lost-them')
//
// Only a completed run counts, once, and only through its own 'challenge' event naming the same
// run, environment and mode as its 'start'. A bust, an expired clock, a retry or an abandoned run
// counts nothing.
//
// Storage. One key, DRIVER_RECORDS_KEY, schema 1:
//   { version: 1, environments: { <variant>: { <handlingId>: { <outcomeId>: count } } } }
//
// The rules are the Getaway records' own: the key is re-read before each write so another tab's
// counts are kept, nothing is written on load, and unparseable or shapeless data is replaced by the
// next write. A key holding a later schema (an integer version above 1) is left strictly alone:
// nothing is shown from it and nothing is written. Environments, modes, outcomes and fields this
// version does not know are carried through every write untouched. A saved count that is not a whole
// number from 0 to MAX_COUNT reads as 0, and the next completion of that outcome replaces it. If
// storage cannot be opened, read or written, the game plays on and the sheet says so.
import { HANDLING_IDS } from './handling.js';
import { DRIVER_OUTCOMES, GETAWAY_DRIVER } from './getaway-driver.js';

export const DRIVER_RECORDS_KEY = 'mini-drifters-getaway-driver-v1';
export const DRIVER_SCHEMA_VERSION = 1;
export const MAX_COUNT = 1_000_000_000;

const object = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
export const validCount = (v) => Number.isSafeInteger(v) && v >= 0 && v <= MAX_COUNT;
const OUTCOME_IDS = DRIVER_OUTCOMES.map((o) => o.id);
const idOf = (outcome) => DRIVER_OUTCOMES.find((o) => o.outcome === outcome)?.id ?? null;

// challengeId -> variant, for every environment of the mission.
export function driverIndex(mission = GETAWAY_DRIVER) {
  return new Map(mission.environments.map((def) => [def.id, def.variant]));
}

// The saved key: 'empty' | 'ok' | 'corrupt' (the next write replaces it) | 'unsupported' (a later
// schema: never written).
export function readDriverStore(raw) {
  if (raw === null || raw === undefined) return { status: 'empty', saved: null };
  let parsed;
  try { parsed = JSON.parse(raw); } catch { return { status: 'corrupt', saved: null }; }
  if (!object(parsed)) return { status: 'corrupt', saved: null };
  if (parsed.version === DRIVER_SCHEMA_VERSION) return { status: 'ok', saved: parsed };
  if (Number.isSafeInteger(parsed.version) && parsed.version > DRIVER_SCHEMA_VERSION) return { status: 'unsupported', saved: null };
  return { status: 'corrupt', saved: null };
}

// { ghost, 'low-profile', 'lost-them' } for one environment and mode: each a whole count, 0 for none
// or damaged. Pure.
export function savedCounts(store, variant, handlingId) {
  const node = store.saved?.environments?.[variant]?.[handlingId];
  return Object.fromEntries(OUTCOME_IDS.map((id) => [id, object(node) && validCount(node[id]) ? node[id] : 0]));
}

// What a write stores: the saved object with one count raised by one, everything else carried over.
export function serializeDriver(store, variant, handlingId, outcomeId) {
  const out = store.status === 'ok' ? structuredClone(store.saved) : {};
  out.version = DRIVER_SCHEMA_VERSION;
  let node = out;
  for (const step of ['environments', variant, handlingId]) {
    if (!object(node[step])) node[step] = {};
    node = node[step];
  }
  node[outcomeId] = Math.min(MAX_COUNT, (validCount(node[outcomeId]) ? node[outcomeId] : 0) + 1);
  return out;
}

export function createDriverRecords(storageProvider = () => globalThis.localStorage, mission = GETAWAY_DRIVER) {
  const index = driverIndex(mission);
  let store = readDriverStore(null);
  let storage = null;
  let available = true;
  let readOnly = false;
  let session = null;
  let counted = null; // the outcome id the run just driven added to, or null

  function load() {
    store = readDriverStore(storage.getItem(DRIVER_RECORDS_KEY));
    readOnly = store.status === 'unsupported';
    return store;
  }

  try {
    storage = storageProvider();
    if (!storage || typeof storage.getItem !== 'function' || typeof storage.setItem !== 'function') throw new Error('No storage');
    load();
  } catch { storage = null; available = false; }

  const known = (challengeId, handlingId) => index.has(challengeId) && HANDLING_IDS.includes(handlingId);

  function count(challengeId, handlingId, outcomeId) {
    if (!storage) return;
    // Another tab may have counted since this page opened: add to what is saved now.
    try { load(); } catch { available = false; return; }
    if (readOnly) return; // a later version's data: never overwritten
    const next = serializeDriver(store, index.get(challengeId), handlingId, outcomeId);
    try {
      storage.setItem(DRIVER_RECORDS_KEY, JSON.stringify(next));
      store = { status: 'ok', saved: next };
      available = true;
      counted = outcomeId;
    } catch { available = false; }
  }

  return {
    get available() { return available; },
    get readOnly() { return readOnly; },
    // The outcome id the run just driven was counted under, or null.
    get counted() { return counted; },
    has(challengeId) { return index.has(challengeId); },
    // No personal bests: the shared challenge sheet asks every keeper for one.
    bestFor() { return null; },
    // The counts for an environment in a handling mode (zeros when unknown or unreadable).
    countsFor(challengeId, handlingId) {
      return known(challengeId, handlingId) && !readOnly ? savedCounts(store, index.get(challengeId), handlingId) : savedCounts({ saved: null }, '', '');
    },
    // The game's run events (game.js), with the result's outcome for a 'challenge' event (the event
    // itself carries none). A completed run of a known environment and mode counts once.
    handle(event, outcome = null) {
      if (event.type === 'start') {
        session = event.mode === 'gymkhana' && known(event.challengeId, event.handling)
          ? { challengeId: event.challengeId, handling: event.handling, runId: event.runId } : null;
        counted = null;
        return;
      }
      if (event.type === 'abandon') { session = null; counted = null; return; }
      if (event.type !== 'challenge' || !session) return;
      if (event.runId !== session.runId || event.challengeId !== session.challengeId || event.handling !== session.handling) return;
      const id = idOf(outcome);
      if (event.completed === true && id) count(session.challengeId, session.handling, id);
      session = null;
    },
  };
}
