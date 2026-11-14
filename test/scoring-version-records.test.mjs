// Score and best-combo records by scoring version (records.js schema 3), and the migration that
// keeps every earlier record. Score and combo depend on what drifts pay, so a run only competes
// with records from its own scoring rules; the fastest lap does not, so it stays one shared best
// per track and handling mode.
//
// Every case runs against isolated in-memory fixtures. Two released keepers, each kept byte for
// byte, play the older tabs and the rollbacks: v0.2.0's (test/support/records-v0.2.0.mjs, schema
// 1) and the handling-modes release's (test/support/records-6ffe6bf.mjs, schema 2). Both score
// with scoring-1.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { trackById } from '../src/track.js';
import { createGame, startRun, tick } from '../src/game.js';
import { handlingById, HANDLING_IDS } from '../src/handling.js';
import { padTrack } from '../src/practice-pad.js';
import { SCORING_VERSION, LEGACY_SCORING_VERSION } from '../src/scoring.js';
import {
  createRecords, readStore, readV2, readLegacy, combine, serialize,
  RECORDS_KEY, V2_RECORDS_KEY, LEGACY_RECORDS_KEY, SCORING_VERSIONS, SCORED_TYPES,
} from '../src/records.js';
import { createRecords as createV020Records } from './support/records-v0.2.0.mjs';
import { createRecords as create6ffe6bfRecords, RECORDS_KEY as KEY_6FFE6BF, SCHEMA_VERSION as SCHEMA_6FFE6BF } from './support/records-6ffe6bf.mjs';
import { gripDriver, driftDriver } from './support/drivers.mjs';

const TRACKS = ['original', 'switchback'];
const NONE = Object.freeze({ score: null, fastestLap: null, bestCombo: null });
const NO_SCORE = Object.freeze({ score: null, bestCombo: null });
const NO_BEST = Object.freeze({ score: false, fastestLap: false, bestCombo: false });

// A v0.2.0 save (schema 1, Classic only) and a 6ffe6bf save (schema 2, by mode), as those
// versions write them, with a real zero, a missing value and a retired mode.
const V020 = JSON.stringify({ version: 1, tracks: {
  original: { score: 15420, fastestLap: 47.31, bestCombo: 0 },
  switchback: { score: null, fastestLap: 52.08, bestCombo: null },
} });
const V2 = JSON.stringify({ version: 2, tracks: {
  original: {
    classic: { score: 12000, fastestLap: 46.9, bestCombo: 2400 },
    revised: { score: 21000, fastestLap: 49.5, bestCombo: 6100 },
    tuned: { score: 99999, fastestLap: 30.5, bestCombo: 88888 },
  },
  switchback: {
    classic: { score: 9000, fastestLap: 53, bestCombo: 0 },
    revised: { score: 0, fastestLap: 58.25, bestCombo: null },
  },
} });

function storage(initial = {}) {
  const map = new Map(Object.entries(initial));
  const s = {
    map, writes: [], reads: 0, failGet: false, failSet: false,
    getItem(k) { if (s.failGet) throw new Error('denied'); s.reads += 1; return map.has(k) ? map.get(k) : null; },
    setItem(k, v) { if (s.failSet) throw new Error('QuotaExceededError'); s.writes.push(k); map.set(k, String(v)); },
  };
  return s;
}
const keeper = (s) => createRecords(() => s);
let runIds = 1000;
function run(records, { track = 'original', handling = 'classic', mode = 'normal', laps = [], finish = null }) {
  const runId = (runIds += 1);
  records.handle({ type: 'start', trackId: track, runId, mode, handling });
  for (const lap of laps) records.handle({ type: 'lap', trackId: track, runId, handling, valid: lap.valid ?? true, time: lap.time });
  if (finish) records.handle({ type: 'finish', trackId: track, runId, handling, completed: finish.completed ?? 3, score: finish.score, bestCombo: finish.bestCombo });
  return records.newBests;
}
// The same run as a v0.2.0 or 6ffe6bf page sends it (v0.2.0's events carry no mode id).
function runOld(records, { track = 'original', handling = 'classic', laps = [], finish = null }) {
  const runId = (runIds += 1);
  records.handle({ type: 'start', trackId: track, runId, mode: 'normal', handling });
  for (const lap of laps) records.handle({ type: 'lap', trackId: track, runId, handling, valid: true, time: lap.time });
  if (finish) records.handle({ type: 'finish', trackId: track, runId, handling, completed: 3, score: finish.score, bestCombo: finish.bestCombo });
  return records.newBests;
}
const saved = (s) => JSON.parse(s.map.get(RECORDS_KEY));
const view = (r, t, h) => ({ ...r.forTrack(t, h), legacy: r.legacyForTrack(t, h) });
const grid = (r) => Object.fromEntries(TRACKS.flatMap((t) => HANDLING_IDS.map((h) => [`${t}/${h}`, view(r, t, h)])));

// --- Identity ---------------------------------------------------------------------------
test('the scoring versions and keys have explicit, stable identities', () => {
  assert.deepEqual(SCORING_VERSIONS, ['scoring-1', 'scoring-2']);
  assert.equal(SCORING_VERSION, 'scoring-2');
  assert.equal(LEGACY_SCORING_VERSION, 'scoring-1');
  assert.deepEqual(SCORED_TYPES, ['score', 'bestCombo']);
  assert.equal(RECORDS_KEY, 'mini-drifters-records-v3');
  assert.equal(V2_RECORDS_KEY, KEY_6FFE6BF, 'the schema 2 key is the one 6ffe6bf writes');
  assert.equal(SCHEMA_6FFE6BF, 2);
  assert.deepEqual(HANDLING_IDS, ['classic', 'revised'], 'scoring separation did not touch the handling ids');
});

test('the 6ffe6bf keeper used as the old tab is the released file, unedited', () => {
  const bytes = readFileSync(new URL('support/records-6ffe6bf.mjs', import.meta.url), 'utf8').replace(/\r\n/g, '\n');
  // SHA-256 of `git show 6ffe6bf:src/records.js`.
  assert.equal(createHash('sha256').update(bytes).digest('hex'), 'd0e703f692f55479a3662b5be1fedfa3c4161f7d16bdf8e53cf82a6f1dc262ad');
});

// --- 1-4. Existing records, every source, every partition -----------------------------
test('existing v0.2.0 and schema 2 records, Classic and Power, both tracks: legacy scores, shared laps, no current bests', () => {
  const s = storage({ [LEGACY_RECORDS_KEY]: V020, [V2_RECORDS_KEY]: V2 });
  const r = keeper(s);
  assert.deepEqual(grid(r), {
    // Classic folds v0.2.0 and schema 2: the better of each, per type.
    'original/classic': { score: null, fastestLap: 46.9, bestCombo: null, legacy: { score: 15420, bestCombo: 2400 } },
    'original/revised': { score: null, fastestLap: 49.5, bestCombo: null, legacy: { score: 21000, bestCombo: 6100 } },
    'switchback/classic': { score: null, fastestLap: 52.08, bestCombo: null, legacy: { score: 9000, bestCombo: 0 } },
    'switchback/revised': { score: null, fastestLap: 58.25, bestCombo: null, legacy: { score: 0, bestCombo: null } },
  });
  assert.deepEqual(s.writes, [], 'opening the game writes nothing');
  assert.equal(s.map.has(RECORDS_KEY), false);
});

test('v0.2.0 records alone, and schema 2 records alone, each appear as legacy scoring', () => {
  const only020 = keeper(storage({ [LEGACY_RECORDS_KEY]: V020 }));
  assert.deepEqual(view(only020, 'original', 'classic'), { score: null, fastestLap: 47.31, bestCombo: null, legacy: { score: 15420, bestCombo: 0 } });
  assert.deepEqual(view(only020, 'original', 'revised'), { ...NONE, legacy: NO_SCORE }, 'v0.2.0 was all Classic');
  const onlyV2 = keeper(storage({ [V2_RECORDS_KEY]: V2 }));
  assert.deepEqual(view(onlyV2, 'original', 'classic'), { score: null, fastestLap: 46.9, bestCombo: null, legacy: { score: 12000, bestCombo: 2400 } });
  assert.deepEqual(view(onlyV2, 'switchback', 'revised'), { score: null, fastestLap: 58.25, bestCombo: null, legacy: { score: 0, bestCombo: null } });
});

// --- 5-8. New records under the current scoring ----------------------------------------
test('a current-scoring score and combo start with no best: the first run sets them, whatever the legacy values were', () => {
  const s = storage({ [LEGACY_RECORDS_KEY]: V020, [V2_RECORDS_KEY]: V2 });
  const r = keeper(s);
  // Far below every legacy value, and still the first current-scoring best.
  assert.deepEqual(run(r, { finish: { score: 500, bestCombo: 50 } }), { score: true, fastestLap: false, bestCombo: true });
  assert.deepEqual(view(r, 'original', 'classic'), { score: 500, fastestLap: 46.9, bestCombo: 50, legacy: { score: 15420, bestCombo: 2400 } });
  const v3 = saved(s);
  assert.deepEqual(v3.tracks.original.classic.scoring[SCORING_VERSION], { score: 500, bestCombo: 50 });
  assert.deepEqual(v3.tracks.original.classic.scoring[LEGACY_SCORING_VERSION], { score: 15420, bestCombo: 2400 }, 'legacy copied forward under its own version');
  assert.deepEqual(v3.tracks.original.revised.scoring[SCORING_VERSION], NO_SCORE, 'no old score was imported as a current record');
  assert.deepEqual(v3.tracks.switchback.classic.scoring[SCORING_VERSION], NO_SCORE);
  // Beaten only by a better current-scoring run.
  assert.deepEqual(run(r, { finish: { score: 400, bestCombo: 60 } }), { score: false, fastestLap: false, bestCombo: true });
  assert.deepEqual(run(r, { finish: { score: 16000, bestCombo: 10 } }), { score: true, fastestLap: false, bestCombo: false });
  assert.deepEqual(view(keeper(s), 'original', 'classic'), { score: 16000, fastestLap: 46.9, bestCombo: 60, legacy: { score: 15420, bestCombo: 2400 } });
});

test('historical records stay exactly as they were through many current-scoring writes', () => {
  const s = storage({ [LEGACY_RECORDS_KEY]: V020, [V2_RECORDS_KEY]: V2 });
  const r = keeper(s);
  for (let i = 1; i <= 12; i += 1) {
    for (const track of TRACKS) for (const handling of HANDLING_IDS) run(r, { track, handling, laps: [{ time: 60 - i }], finish: { score: 1000 * i, bestCombo: 100 * i } });
  }
  assert.equal(s.map.get(LEGACY_RECORDS_KEY), V020, 'the v0.2.0 key, byte for byte');
  assert.equal(s.map.get(V2_RECORDS_KEY), V2, 'the schema 2 key, byte for byte');
  assert.ok(s.writes.every((k) => k === RECORDS_KEY), 'only the new key was ever written');
  const again = keeper(s);
  assert.deepEqual(again.legacyForTrack('original', 'classic'), { score: 15420, bestCombo: 2400 });
  assert.deepEqual(again.legacyForTrack('original', 'revised'), { score: 21000, bestCombo: 6100 });
  assert.deepEqual(again.legacyForTrack('switchback', 'classic'), { score: 9000, bestCombo: 0 });
  assert.deepEqual(again.legacyForTrack('switchback', 'revised'), { score: 0, bestCombo: null });
  // The laps are shared: 48 s beats every older lap except Original Classic's 46.9 s.
  const laps = { 'original/classic': 46.9, 'original/revised': 48, 'switchback/classic': 48, 'switchback/revised': 48 };
  for (const track of TRACKS) for (const handling of HANDLING_IDS) {
    assert.deepEqual(again.forTrack(track, handling), { score: 12000, fastestLap: laps[`${track}/${handling}`], bestCombo: 1200 }, `${track}/${handling}`);
  }
});

test('best combos are partitioned too: a lower current combo is a current best, and the legacy combo is untouched', () => {
  const s = storage({ [V2_RECORDS_KEY]: V2 });
  const r = keeper(s);
  assert.deepEqual(run(r, { handling: 'revised', finish: { score: 30000, bestCombo: 3000 } }), { score: true, fastestLap: false, bestCombo: true });
  assert.deepEqual(view(r, 'original', 'revised'), { score: 30000, fastestLap: 49.5, bestCombo: 3000, legacy: { score: 21000, bestCombo: 6100 } });
  assert.deepEqual(run(r, { handling: 'revised', finish: { score: 1, bestCombo: 6000 } }), { score: false, fastestLap: false, bestCombo: true }, 'beats the current 3,000; the legacy 6,100 is irrelevant');
  assert.deepEqual(r.legacyForTrack('original', 'revised'), { score: 21000, bestCombo: 6100 });
});

test('the fastest lap is shared across scoring versions, still separate by track and mode', () => {
  const s = storage({ [LEGACY_RECORDS_KEY]: V020, [V2_RECORDS_KEY]: V2 });
  const r = keeper(s);
  assert.deepEqual(run(r, { laps: [{ time: 47 }] }), NO_BEST, '47 s does not beat the schema 2 lap of 46.9 s');
  assert.deepEqual(run(r, { laps: [{ time: 46.5 }] }), { score: false, fastestLap: true, bestCombo: false });
  assert.equal(r.forTrack('original', 'classic').fastestLap, 46.5);
  assert.equal(r.forTrack('original', 'revised').fastestLap, 49.5, 'Power keeps its own');
  assert.equal(r.forTrack('switchback', 'classic').fastestLap, 52.08, 'Switchback keeps its own (the v0.2.0 lap beats schema 2\'s 53 s)');
  assert.equal(JSON.parse(s.map.get(V2_RECORDS_KEY)).tracks.original.classic.fastestLap, 46.9, 'the old key keeps its lap');
  assert.equal(saved(s).tracks.original.classic.fastestLap, 46.5);
  assert.equal(saved(s).tracks.switchback.classic.fastestLap, 52.08, 'and the shared laps are copied forward');
});

// --- 9. Zero and missing ------------------------------------------------------------------
test('zero and missing stay distinct in both partitions', () => {
  const s = storage({ [V2_RECORDS_KEY]: V2 });
  const r = keeper(s);
  assert.deepEqual(r.legacyForTrack('switchback', 'revised'), { score: 0, bestCombo: null }, 'a legacy zero and a legacy gap');
  assert.deepEqual(r.forTrack('switchback', 'revised'), { score: null, fastestLap: 58.25, bestCombo: null }, 'the current score is missing, not zero');
  assert.deepEqual(run(r, { track: 'switchback', handling: 'revised', finish: { score: 0, bestCombo: 0 } }), { score: true, fastestLap: false, bestCombo: true }, 'a first current zero is a record');
  assert.deepEqual(run(r, { track: 'switchback', handling: 'revised', finish: { score: 0, bestCombo: 0 } }), NO_BEST, 'equal is not better');
  assert.deepEqual(keeper(s).forTrack('switchback', 'revised'), { score: 0, fastestLap: 58.25, bestCombo: 0 });
  assert.deepEqual(keeper(s).legacyForTrack('switchback', 'revised'), { score: 0, bestCombo: null });
});

// --- 10-12. Unavailable, failing and corrupt storage ----------------------------------------
test('storage unavailable: nothing shown, nothing saved, no NEW BEST, no error into the game', () => {
  for (const provider of [() => { throw new Error('SecurityError'); }, () => null, () => ({}), () => ({ getItem() { throw new Error('denied'); }, setItem() { throw new Error('must not write'); } })]) {
    const r = createRecords(provider);
    assert.equal(r.available, false);
    assert.deepEqual(view(r, 'original', 'classic'), { ...NONE, legacy: NO_SCORE });
    assert.deepEqual(run(r, { laps: [{ time: 40 }], finish: { score: 5000, bestCombo: 100 } }), NO_BEST);
  }
});

test('a failed write is never a NEW BEST, in either partition, and leaves every key as it was', () => {
  const s = storage({ [LEGACY_RECORDS_KEY]: V020, [V2_RECORDS_KEY]: V2 });
  const r = keeper(s);
  s.failSet = true;
  assert.deepEqual(run(r, { laps: [{ time: 30 }], finish: { score: 99999, bestCombo: 99999 } }), NO_BEST);
  assert.equal(r.available, false);
  assert.deepEqual(view(r, 'original', 'classic'), { score: null, fastestLap: 46.9, bestCombo: null, legacy: { score: 15420, bestCombo: 2400 } }, 'nothing unsaved is shown');
  assert.equal(s.map.has(RECORDS_KEY), false);
  assert.equal(s.map.get(V2_RECORDS_KEY), V2);
  assert.equal(s.map.get(LEGACY_RECORDS_KEY), V020);
  s.failSet = false;
  assert.deepEqual(run(r, { finish: { score: 10, bestCombo: 1 } }), { score: true, fastestLap: false, bestCombo: true }, 'a later write succeeds');
  assert.equal(r.available, true);
  // A read that fails at the record boundary: nothing written, nothing claimed.
  s.failGet = true;
  const writes = s.writes.length;
  assert.deepEqual(run(r, { finish: { score: 20, bestCombo: 2 } }), NO_BEST);
  assert.equal(s.writes.length, writes);
});

test('corrupt data in any key is never turned into a record or a write', () => {
  for (const bad of ['{', '[]', 'null', '"x"', '{"version":"3","tracks":{}}', '{"version":3.5}', '{"tracks":{}}']) {
    const s = storage({ [RECORDS_KEY]: bad, [V2_RECORDS_KEY]: V2, [LEGACY_RECORDS_KEY]: V020 });
    const r = keeper(s);
    assert.equal(r.readOnly, false, bad);
    assert.deepEqual(view(r, 'original', 'classic'), { score: null, fastestLap: 46.9, bestCombo: null, legacy: { score: 15420, bestCombo: 2400 } }, bad);
    assert.deepEqual(s.writes, [], 'not repaired just by loading');
    run(r, { finish: { score: 7, bestCombo: 3 } });
    assert.equal(saved(s).version, 3, 'the next real best replaces it with a valid save');
    assert.deepEqual(saved(s).tracks.original.classic.scoring[SCORING_VERSION], { score: 7, bestCombo: 3 });
  }
  for (const bad of ['{', '[]', '{"version":2,"tracks":[]}', '{"version":"2"}', '{"version":1,"tracks":{}}']) {
    const s = storage({ [V2_RECORDS_KEY]: bad });
    const r = keeper(s);
    assert.deepEqual(view(r, 'original', 'classic'), { ...NONE, legacy: NO_SCORE }, bad);
    run(r, { finish: { score: 7, bestCombo: 3 } });
    assert.equal(s.map.get(V2_RECORDS_KEY), bad, 'an unreadable older key is left exactly as it was');
  }
  // Field by field: bad values in a schema 3 entry are missing, never records.
  const fields = JSON.stringify({ version: 3, tracks: { original: { classic: { fastestLap: -2, scoring: {
    [SCORING_VERSION]: { score: '900', bestCombo: 1.5 }, [LEGACY_SCORING_VERSION]: { score: 1e300, bestCombo: -1 } } } } } });
  assert.deepEqual(view(keeper(storage({ [RECORDS_KEY]: fields })), 'original', 'classic'), { ...NONE, legacy: NO_SCORE });
});

// --- 13-14. Unknown versions, modes, tracks and fields ---------------------------------------
test('a later schema in the new key is protected: shown records fall back to the older keys, nothing is written', () => {
  for (const future of [JSON.stringify({ version: 4, tracks: { original: { classic: { score: 1 } } } }), JSON.stringify({ version: 40 })]) {
    const s = storage({ [RECORDS_KEY]: future, [V2_RECORDS_KEY]: V2 });
    const r = keeper(s);
    assert.equal(r.readOnly, true);
    assert.deepEqual(view(r, 'original', 'classic'), { score: null, fastestLap: 46.9, bestCombo: null, legacy: { score: 12000, bestCombo: 2400 } });
    assert.deepEqual(run(r, { laps: [{ time: 1 }], finish: { score: 1e6, bestCombo: 1e6 } }), NO_BEST);
    assert.deepEqual(s.writes, []);
    assert.equal(s.map.get(RECORDS_KEY), future);
  }
  // A later schema in the schema 2 key is not this version's to read; it is ignored, never written.
  const s = storage({ [V2_RECORDS_KEY]: JSON.stringify({ version: 7, tracks: { original: { classic: { score: 5 } } } }) });
  assert.deepEqual(keeper(s).legacyForTrack('original', 'classic'), NO_SCORE);
  assert.equal(readV2(s.map.get(V2_RECORDS_KEY)).status, 'ignored');
});

test('unknown scoring versions, retired and unknown modes, unknown tracks and fields are carried through writes untouched and never shown', () => {
  const later = { score: 77777, bestCombo: 7777, style: 'kept' };
  const raw = JSON.stringify({ version: 3, note: 'kept', tracks: {
    original: {
      classic: { fastestLap: 50, bestAngle: 48, scoring: { 'scoring-3': later, [SCORING_VERSION]: { score: 100, bestCombo: 10, flair: 1 } } },
      tuned: { fastestLap: 29, scoring: { [SCORING_VERSION]: { score: 5e5, bestCombo: 5e4 } } },
      rally: { anything: true },
    },
    canyon: { classic: { fastestLap: 10 } },
  } });
  const s = storage({ [RECORDS_KEY]: raw, [V2_RECORDS_KEY]: V2 });
  const r = keeper(s);
  assert.deepEqual(view(r, 'original', 'classic'), { score: 100, fastestLap: 46.9, bestCombo: 10, legacy: { score: 12000, bestCombo: 2400 } }, 'a later scoring version is not shown as current or legacy');
  for (const h of ['tuned', 'rally']) assert.deepEqual(view(r, 'original', h), { ...NONE, legacy: NO_SCORE }, h);
  assert.deepEqual(view(r, 'canyon', 'classic'), { ...NONE, legacy: NO_SCORE });
  assert.deepEqual(run(r, { handling: 'tuned', laps: [{ time: 1 }], finish: { score: 1e7, bestCombo: 1e7 } }), NO_BEST, 'the retired mode sets nothing');
  run(r, { laps: [{ time: 45 }], finish: { score: 200, bestCombo: 5 } });
  const v3 = saved(s);
  assert.equal(v3.note, 'kept');
  assert.deepEqual(v3.tracks.original.classic.scoring['scoring-3'], later);
  assert.deepEqual(v3.tracks.original.classic.scoring[SCORING_VERSION], { score: 200, bestCombo: 10, flair: 1 });
  assert.equal(v3.tracks.original.classic.bestAngle, 48);
  assert.deepEqual(v3.tracks.original.tuned, JSON.parse(raw).tracks.original.tuned);
  assert.deepEqual(v3.tracks.original.rally, { anything: true });
  assert.deepEqual(v3.tracks.canyon, { classic: { fastestLap: 10 } });
  assert.deepEqual(JSON.parse(s.map.get(V2_RECORDS_KEY)).tracks.original.tuned, { score: 99999, fastestLap: 30.5, bestCombo: 88888 }, 'schema 2\'s Tuned Power records are still there');
});

// --- 15. Repeated migration reads --------------------------------------------------------
test('the migration is pure and idempotent: repeated reads give the same table and never write', () => {
  const s = storage({ [LEGACY_RECORDS_KEY]: V020, [V2_RECORDS_KEY]: V2 });
  const first = grid(keeper(s));
  for (let i = 0; i < 10; i += 1) assert.deepEqual(grid(keeper(s)), first);
  assert.deepEqual(s.writes, []);
  const store = readStore(null);
  const v2 = readV2(V2);
  const legacy = readLegacy(V020);
  const table = combine(store, v2, legacy);
  const written = JSON.stringify(serialize(store, table));
  const again = combine(readStore(written), v2, legacy);
  assert.deepEqual(again, table, 'reading the written copy with the old keys still there changes nothing');
  assert.equal(JSON.stringify(serialize(readStore(written), again)), written, 'writing again changes nothing');
  // After a real write, reloading and re-reading still agree.
  run(keeper(s), { finish: { score: 3, bestCombo: 1 } });
  const after = s.map.get(RECORDS_KEY);
  for (let i = 0; i < 5; i += 1) { const r = keeper(s); run(r, { finish: { score: 1, bestCombo: 0 } }); }
  assert.equal(s.map.get(RECORDS_KEY), after, 'worse runs after reloads write nothing');
});

// --- 16. Older tabs still open ------------------------------------------------------------
test('a 6ffe6bf tab still open: its scores are legacy here, its laps are shared, and neither tab disturbs the other\'s key', () => {
  const s = storage({ [V2_RECORDS_KEY]: V2 });
  const current = keeper(s);
  const old = create6ffe6bfRecords(() => s);
  run(current, { handling: 'revised', laps: [{ time: 49 }], finish: { score: 8000, bestCombo: 900 } });
  const v3 = s.map.get(RECORDS_KEY);
  // The old tab scores with scoring-1 and saves into its own key, as it always did.
  assert.deepEqual(runOld(old, { handling: 'revised', laps: [{ time: 48 }], finish: { score: 25000, bestCombo: 7000 } }), { score: true, fastestLap: true, bestCombo: true });
  assert.deepEqual(JSON.parse(s.map.get(V2_RECORDS_KEY)).tracks.original.revised, { score: 25000, fastestLap: 48, bestCombo: 7000 });
  assert.equal(s.map.get(RECORDS_KEY), v3, 'the old tab never touches the new key');
  assert.equal(old.forTrack('original', 'revised').score, 25000, 'and does not see current-scoring records as its own');
  // The current tab, at its next record boundary: the old score is legacy, never current.
  assert.deepEqual(run(current, { handling: 'revised', laps: [{ time: 48.5 }], finish: { score: 8500, bestCombo: 850 } }), { score: true, fastestLap: false, bestCombo: false });
  assert.deepEqual(view(current, 'original', 'revised'), { score: 8500, fastestLap: 48, bestCombo: 900, legacy: { score: 25000, bestCombo: 7000 } });
  // And the old tab keeps working with what it can see.
  assert.deepEqual(runOld(old, { handling: 'revised', laps: [{ time: 47 }] }), { score: false, fastestLap: true, bestCombo: false });
  assert.equal(keeper(s).forTrack('original', 'revised').fastestLap, 47, 'its faster lap is the shared best');
  assert.equal(s.writes.filter((k) => k === V2_RECORDS_KEY).length, 3, 'only the old tab wrote the old key');
});

test('a v0.2.0 tab still open alongside: its Classic score is legacy, its lap is shared', () => {
  const s = storage({ [LEGACY_RECORDS_KEY]: V020, [V2_RECORDS_KEY]: V2 });
  const current = keeper(s);
  const old = createV020Records(() => s);
  old.handle({ type: 'start', trackId: 'switchback', runId: 1, mode: 'normal' });
  old.handle({ type: 'lap', trackId: 'switchback', runId: 1, valid: true, time: 50 });
  old.handle({ type: 'finish', trackId: 'switchback', runId: 1, completed: 3, score: 30000, bestCombo: 4000 });
  assert.deepEqual(run(current, { track: 'switchback', laps: [{ time: 51 }], finish: { score: 6000, bestCombo: 500 } }), { score: true, fastestLap: false, bestCombo: true });
  assert.deepEqual(view(current, 'switchback', 'classic'), { score: 6000, fastestLap: 50, bestCombo: 500, legacy: { score: 30000, bestCombo: 4000 } });
});

// --- 17. Rollback and upgrade -------------------------------------------------------------
test('rolling back to 6ffe6bf shows its own records, its writes stay legacy, and upgrading again shows everything', () => {
  const s = storage({ [V2_RECORDS_KEY]: V2, [LEGACY_RECORDS_KEY]: V020 });
  run(keeper(s), { laps: [{ time: 45 }], finish: { score: 7000, bestCombo: 700 } });
  run(keeper(s), { track: 'switchback', handling: 'revised', laps: [{ time: 57 }], finish: { score: 6000, bestCombo: 600 } });
  const v3 = s.map.get(RECORDS_KEY);
  // The rolled-back page reads only its own key: records first set under current scoring don't appear there.
  const back = create6ffe6bfRecords(() => s);
  assert.deepEqual(back.forTrack('original', 'classic'), { score: 15420, fastestLap: 46.9, bestCombo: 2400 }, 'its own key plus v0.2.0, as before');
  assert.deepEqual(back.forTrack('switchback', 'revised'), { score: 0, fastestLap: 58.25, bestCombo: null }, 'current-scoring records are not visible (documented)');
  assert.deepEqual(runOld(back, { laps: [{ time: 44 }], finish: { score: 16000, bestCombo: 100 } }), { score: true, fastestLap: true, bestCombo: false });
  assert.equal(s.map.get(RECORDS_KEY), v3, 'the new key is exactly as it was left');
  // Upgrading again: the current records are back, the rollback-era score is legacy, its lap shared.
  const up = keeper(s);
  assert.deepEqual(view(up, 'original', 'classic'), { score: 7000, fastestLap: 44, bestCombo: 700, legacy: { score: 16000, bestCombo: 2400 } });
  assert.deepEqual(view(up, 'switchback', 'revised'), { score: 6000, fastestLap: 57, bestCombo: 600, legacy: { score: 0, bestCombo: null } });
  assert.deepEqual(run(up, { laps: [{ time: 44.5 }] }), NO_BEST, 'the rollback-era lap is the shared best now');
});

test('rolling back to v0.2.0 and upgrading again: the same, for the oldest key', () => {
  const s = storage({ [LEGACY_RECORDS_KEY]: V020 });
  run(keeper(s), { finish: { score: 7000, bestCombo: 700 } });
  const old = createV020Records(() => s);
  assert.deepEqual(old.forTrack('original'), { score: 15420, fastestLap: 47.31, bestCombo: 0 });
  old.handle({ type: 'start', trackId: 'original', runId: 5, mode: 'normal' });
  old.handle({ type: 'finish', trackId: 'original', runId: 5, completed: 3, score: 17000, bestCombo: 1 });
  assert.deepEqual(view(keeper(s), 'original', 'classic'), { score: 7000, fastestLap: 47.31, bestCombo: 700, legacy: { score: 17000, bestCombo: 1 } });
});

// --- Legacy values can never be labelled NEW BEST under the current scoring ----------------
test('no old score or combo can ever be claimed as a current NEW BEST, or be beaten, or change by playing', () => {
  const s = storage({ [LEGACY_RECORDS_KEY]: V020, [V2_RECORDS_KEY]: V2 });
  const r = keeper(s);
  const legacyBefore = Object.fromEntries(TRACKS.flatMap((t) => HANDLING_IDS.map((h) => [`${t}/${h}`, r.legacyForTrack(t, h)])));
  // Events that replay old values exactly, or try to land just above or below them.
  for (const [score, bestCombo] of [[15420, 2400], [15421, 2401], [12000, 0], [21000, 6100], [null, null]]) {
    const flags = run(r, { finish: { score, bestCombo } });
    const now = r.forTrack('original', 'classic');
    // A flag is only ever about the current record it just replaced.
    if (flags.score) assert.equal(now.score, score);
    if (flags.bestCombo) assert.equal(now.bestCombo, bestCombo);
  }
  const legacyAfter = Object.fromEntries(TRACKS.flatMap((t) => HANDLING_IDS.map((h) => [`${t}/${h}`, keeper(s).legacyForTrack(t, h)])));
  assert.deepEqual(legacyAfter, legacyBefore, 'no run changed a legacy record');
  // Nothing in the records' API sets a legacy value: they are read-only history.
  assert.deepEqual(Object.keys(r).sort(), ['available', 'forTrack', 'handle', 'legacyForTrack', 'newBests', 'readOnly']);
});

// --- Real sessions: normal runs record under the current scoring; practice and lessons never do
test('real sessions in both modes save their settled results under the current scoring only', () => {
  const s = storage({ [LEGACY_RECORDS_KEY]: V020, [V2_RECORDS_KEY]: V2 });
  const r = keeper(s);
  for (const mode of ['classic', 'revised']) {
    const game = createGame(trackById('original'), { onRunEvent: (e) => r.handle(e) });
    startRun(game, { handling: handlingById(mode) });
    const driver = driftDriver();
    while (game.state !== 'finished' && game.ticks < 60000) tick(game, driver(game));
    assert.equal(game.state, 'finished');
    assert.deepEqual(r.newBests, { score: true, fastestLap: r.newBests.fastestLap, bestCombo: true }, `${mode}: first current-scoring bests`);
    assert.equal(r.forTrack('original', mode).score, game.results.score);
    assert.equal(r.forTrack('original', mode).bestCombo, game.results.bestCombo);
  }
  assert.deepEqual(r.legacyForTrack('original', 'classic'), { score: 15420, bestCombo: 2400 });
  assert.deepEqual(r.legacyForTrack('original', 'revised'), { score: 21000, bestCombo: 6100 });
  assert.equal(s.map.get(V2_RECORDS_KEY), V2);
  assert.equal(s.map.get(LEGACY_RECORDS_KEY), V020);
});

test('the practice pad and the lesson write nothing under any scoring version, in either mode', () => {
  const s = storage({ [LEGACY_RECORDS_KEY]: V020, [V2_RECORDS_KEY]: V2 });
  const r = keeper(s);
  for (const mode of ['classic', 'revised']) {
    const game = createGame(trackById('original'), { onRunEvent: (e) => r.handle(e) });
    startRun(game, { track: padTrack(), mode: 'practice', ghost: false, handling: handlingById(mode) });
    const driver = gripDriver();
    for (let i = 0; i < 120 * 60; i += 1) tick(game, { ...driver(game), handbrake: i % 40 < 8 });
    assert.equal(game.scoring.score, 0, 'the pad is never scored');
    startRun(game, { mode: 'tutorial', ghost: false, track: trackById('original'), handling: handlingById('classic') });
    const lesson = driftDriver();
    while (game.state !== 'finished' && game.ticks < 60000) tick(game, lesson(game));
    assert.ok(game.results.score > 0, 'the lesson really scored');
  }
  assert.deepEqual(s.writes, []);
  assert.equal(s.map.has(RECORDS_KEY), false);
});
