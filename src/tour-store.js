// Circuit Tour storage (v0.9.0). One key of its own, never another's:
//
//   TOUR_STORE_KEY  { version: 1, active, history, bests }
//     active   the Tour in progress (tour.js state, plus `driving`: the round whose car has
//              moved, so a page closed mid-round is noticed on the next visit), or null
//     history  the last HISTORY_LIMIT finished or retired Tours, newest first: settings, outcome
//              and each round's score, place and points
//     bests    per "<length>|<field>|<handling>": { finished, champion, podium, sweeps,
//              bestPlace, bestTrophy, bestPoints }
//
// The v0.9.0 R2 research build kept its Tours under 'mini-drifters-r2-tour'. Production never
// reads, writes or migrates that key: research saves stay where they are, and a production Tour
// starts clean. This key is never read or written by records.js, the ghost store or any
// preference, and it never reads or writes theirs. A Tour round is an ordinary circuit run, so
// the circuit records and reference ghosts see it exactly as they see any run.
//
// Rules, as in records.js: nothing is written on load; every write re-reads the key first and
// keeps what it does not change; a later store version (an integer above 1) is never written;
// unparseable or shapeless data reads as empty and is replaced by the next write; an active Tour
// that fails tour.js's isTour() is set aside (not resumed) and replaced by the next new Tour.
// A round's result is only written if the stored Tour is still the same Tour at the same round,
// so a second tab that has moved the Tour on is never overwritten.
import { isTour, tourOutcome } from './tour.js';

export const TOUR_STORE_KEY = 'mini-drifters-tour-v1';
// The research build's key: named only so tests can prove production leaves it alone.
export const RESEARCH_TOUR_KEY = 'mini-drifters-r2-tour';
export const TOUR_STORE_VERSION = 1;
export const HISTORY_LIMIT = 12;

const object = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const empty = () => ({ version: TOUR_STORE_VERSION, active: null, history: [], bests: {} });

export const bestsKey = (t) => `${t.length}|${t.field}|${t.handling}`;

// 'empty' | 'ok' | 'corrupt' | 'unsupported', and the data a write would start from.
export function readTourStore(raw) {
  if (raw === null || raw === undefined) return { status: 'empty', data: empty() };
  let parsed;
  try { parsed = JSON.parse(raw); } catch { return { status: 'corrupt', data: empty() }; }
  if (!object(parsed)) return { status: 'corrupt', data: empty() };
  if (Number.isSafeInteger(parsed.version) && parsed.version > TOUR_STORE_VERSION) return { status: 'unsupported', data: empty() };
  if (parsed.version !== TOUR_STORE_VERSION) return { status: 'corrupt', data: empty() };
  const data = {
    ...parsed,
    active: parsed.active ?? null,
    history: Array.isArray(parsed.history) ? parsed.history.filter(object) : [],
    bests: object(parsed.bests) ? parsed.bests : {},
  };
  return { status: 'ok', data };
}

// A finished Tour as history keeps it.
export function summarise(t) {
  return {
    code: t.code, seed: t.seed, rules: t.rules, length: t.length, field: t.field, handling: t.handling,
    status: t.status, outcome: t.status === 'complete' ? tourOutcome(t) : null,
    rounds: t.results.map((r) => ({ trackId: r.trackId, score: r.score, position: r.position, points: r.points, joker: r.joker, dnf: r.dnf })),
  };
}

// The bests after a Tour finishes. Pure. A retired Tour changes nothing.
export function foldBest(bests, t) {
  if (t.status !== 'complete') return bests;
  const key = bestsKey(t);
  const old = object(bests[key]) ? bests[key] : {};
  const o = tourOutcome(t);
  const place = o.place;
  const better = (a, b, lower) => (a === null || a === undefined ? b : b === null ? a : lower ? Math.min(a, b) : Math.max(a, b));
  return {
    ...bests,
    [key]: {
      finished: (old.finished ?? 0) + 1,
      champion: (old.champion ?? 0) + (o.champion ? 1 : 0),
      podium: (old.podium ?? 0) + (o.trophy ? 1 : 0),
      sweeps: (old.sweeps ?? 0) + (o.sweep ? 1 : 0),
      bestPlace: better(old.bestPlace ?? null, place, true),
      bestTrophy: rankTrophy(old.bestTrophy ?? null) >= rankTrophy(o.trophy) ? (old.bestTrophy ?? null) : o.trophy,
      bestPoints: better(old.bestPoints ?? null, o.points, false),
    },
  };
}
const rankTrophy = (t) => ({ gold: 3, silver: 2, bronze: 1 })[t] ?? 0;

export function createTourStore(storageProvider = () => globalThis.localStorage) {
  let storage = null;
  let available = true;
  let readOnly = false;
  try {
    storage = storageProvider();
    if (!storage || typeof storage.getItem !== 'function' || typeof storage.setItem !== 'function') throw new Error('No storage');
  } catch { storage = null; available = false; }

  function read() {
    if (!storage) return { status: 'empty', data: empty() };
    try {
      const store = readTourStore(storage.getItem(TOUR_STORE_KEY));
      readOnly = store.status === 'unsupported';
      return store;
    } catch { available = false; return { status: 'empty', data: empty() }; }
  }
  function write(data) {
    if (!storage || readOnly) return false;
    try { storage.setItem(TOUR_STORE_KEY, JSON.stringify(data)); available = true; return true; } catch { available = false; return false; }
  }
  const activeOf = (data) => (isTour(data.active) && data.active.status === 'active' ? data.active : null);

  return {
    get available() { return available; },
    get readOnly() { return readOnly; },
    // What the Tour sheet shows: the Tour to continue (or null), history and bests. Never writes.
    load() {
      const { data } = read();
      return { active: activeOf(data), history: data.history, bests: data.bests,
        setAside: data.active !== null && data.active !== undefined && activeOf(data) === null && !(isTour(data.active) && data.active.status !== 'active') };
    },
    // Start a new Tour. An unfinished one it replaces is kept in history as retired.
    begin(tour) {
      const { data } = read();
      const old = activeOf(data);
      const history = old ? [summarise({ ...old, status: 'retired' }), ...data.history] : data.history;
      return write({ ...data, active: { ...tour, driving: null }, history: history.slice(0, HISTORY_LIMIT) });
    },
    // Replace the active Tour with `next`, only if the stored one is still `expect` (same code and
    // round). Finishing moves it into history and the bests. Returns { ok, reason }.
    update(expect, next, { driving = null } = {}) {
      const { data } = read();
      const cur = activeOf(data);
      if (!cur || cur.code !== expect.code || cur.round !== expect.round || cur.restartsLeft !== expect.restartsLeft) {
        return { ok: false, reason: 'moved' };
      }
      let out;
      if (next.status === 'active') out = { ...data, active: { ...next, driving } };
      else out = { ...data, active: null, history: [summarise(next), ...data.history].slice(0, HISTORY_LIMIT), bests: foldBest(data.bests, next) };
      return write(out) ? { ok: true } : { ok: false, reason: readOnly ? 'read-only' : 'write failed' };
    },
    // Mark the active round as being driven (the car has moved) or not.
    setDriving(expect, round) {
      const { data } = read();
      const cur = activeOf(data);
      if (!cur || cur.code !== expect.code || cur.round !== expect.round) return false;
      return write({ ...data, active: { ...cur, driving: round } });
    },
  };
}
