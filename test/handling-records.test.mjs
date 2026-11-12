// Records by track and handling mode, and the migration that keeps v0.2.0's records. Every
// case runs against isolated in-memory fixtures: no real save is read or written. The released
// v0.2.0 keeper, kept byte for byte in test/support/records-v0.2.0.mjs, plays the "old tab"
// and the "rollback" in the compatibility cases.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { trackById } from '../src/track.js';
import { createGame, startRun, tick } from '../src/game.js';
import { HANDLING_IDS, RETIRED_HANDLING_IDS, handlingById } from '../src/handling.js';
import { PRACTICE_PAD_ID } from '../src/practice-pad.js';
import {
  createRecords, readStore, readLegacy, combine, serialize,
  RECORDS_KEY, LEGACY_RECORDS_KEY, SCHEMA_VERSION,
} from '../src/records.js';
import { createRecords as createV020Records, RECORDS_KEY as V020_KEY } from './support/records-v0.2.0.mjs';
import { gripDriver } from './support/drivers.mjs';

const TRACKS = ['original', 'switchback'];
const NONE = Object.freeze({ score: null, fastestLap: null, bestCombo: null });
// A v0.2.0 save as v0.2.0 writes it: one real zero, and records missing on purpose.
const V020 = JSON.stringify({ version: 1, tracks: {
  original: { score: 15420, fastestLap: 47.31, bestCombo: 0 },
  switchback: { score: null, fastestLap: 52.08, bestCombo: null },
} });

function storage(initial = {}) {
  const map = new Map(Object.entries(initial));
  const s = {
    map, writes: [], failGet: false, failSet: false,
    getItem(k) { if (s.failGet) throw new Error('denied'); return map.has(k) ? map.get(k) : null; },
    setItem(k, v) { if (s.failSet) throw new Error('QuotaExceededError'); s.writes.push(k); map.set(k, String(v)); },
  };
  return s;
}
const keeper = (s) => createRecords(() => s);
let runIds = 100;
// One run's events, as game.js sends them.
function run(records, { track = 'original', handling = 'classic', mode = 'normal', laps = [], finish = null }) {
  const runId = (runIds += 1);
  records.handle({ type: 'start', trackId: track, runId, mode, handling });
  for (const lap of laps) records.handle({ type: 'lap', trackId: track, runId, handling, valid: lap.valid ?? true, time: lap.time });
  if (finish) records.handle({ type: 'finish', trackId: track, runId, handling, completed: finish.completed ?? 3, score: finish.score, bestCombo: finish.bestCombo });
  return records.newBests;
}
const saved = (s) => JSON.parse(s.map.get(RECORDS_KEY));

// --- Keys ----------------------------------------------------------------------------
test('records are written to a new key; the v0.2.0 key is the one v0.2.0 itself uses', () => {
  assert.equal(RECORDS_KEY, 'mini-drifters-records-v2');
  assert.equal(LEGACY_RECORDS_KEY, 'mini-drifters-records');
  assert.equal(LEGACY_RECORDS_KEY, V020_KEY);
  assert.equal(SCHEMA_VERSION, 2);
});

test('the v0.2.0 keeper used as the old tab is the released file, unedited', () => {
  const bytes = readFileSync(new URL('support/records-v0.2.0.mjs', import.meta.url), 'utf8').replace(/\r\n/g, '\n');
  // SHA-256 of `git show v0.2.0:src/records.js`.
  assert.equal(createHash('sha256').update(bytes).digest('hex'), 'c981008d46a07c886b05ce2e46cb7a0284f6796062c67c5b778c0ecfac67f35f');
});

// --- Migration: legacy records survive -------------------------------------------------
test('v0.2.0 records appear under Classic on both tracks; other modes start empty; nothing is written on load', () => {
  const s = storage({ [LEGACY_RECORDS_KEY]: V020 });
  const r = keeper(s);
  assert.deepEqual(r.forTrack('original', 'classic'), { score: 15420, fastestLap: 47.31, bestCombo: 0 });
  assert.deepEqual(r.forTrack('switchback', 'classic'), { score: null, fastestLap: 52.08, bestCombo: null });
  for (const track of TRACKS) assert.deepEqual(r.forTrack(track, 'revised'), NONE, 'Power starts empty');
  assert.equal(r.forTrack('original', 'classic').bestCombo, 0, 'a real zero stays a zero');
  assert.equal(r.forTrack('switchback', 'classic').score, null, 'a missing record stays missing');
  assert.deepEqual(s.writes, []);
  assert.equal(s.map.get(LEGACY_RECORDS_KEY), V020);
  assert.equal(readStore(s.map.get(RECORDS_KEY) ?? null).status, 'empty');
  assert.equal(readLegacy(s.map.get(LEGACY_RECORDS_KEY)).status, 'ok');
});

test('a new best in Classic is written to the new key with the v0.2.0 records copied forward; the old key is untouched', () => {
  const s = storage({ [LEGACY_RECORDS_KEY]: V020 });
  const r = keeper(s);
  assert.deepEqual(run(r, { track: 'switchback', laps: [{ time: 51.5 }] }), { score: false, fastestLap: true, bestCombo: false });
  assert.deepEqual(s.writes, [RECORDS_KEY]);
  assert.equal(s.map.get(LEGACY_RECORDS_KEY), V020, 'byte-for-byte the same');
  const v2 = saved(s);
  assert.equal(v2.version, 2);
  assert.deepEqual(v2.tracks.original.classic, { score: 15420, fastestLap: 47.31, bestCombo: 0 });
  assert.deepEqual(v2.tracks.switchback.classic, { score: null, fastestLap: 51.5, bestCombo: null });
  assert.deepEqual(v2.tracks.original.revised, NONE);
});

test('a Classic run that does not beat the v0.2.0 record is not a new best, and writes nothing', () => {
  const s = storage({ [LEGACY_RECORDS_KEY]: V020 });
  const r = keeper(s);
  assert.deepEqual(run(r, { laps: [{ time: 48 }, { time: 47.5 }, { time: 49 }], finish: { score: 9000, bestCombo: 0 } }), { score: false, fastestLap: false, bestCombo: false });
  assert.deepEqual(s.writes, []);
});

test('migration is a pure function: the same saves always give the same table, however often it runs', () => {
  const store = readStore(null);
  const legacy = readLegacy(V020);
  const once = combine(store, legacy, TRACKS, HANDLING_IDS);
  for (let i = 0; i < 5; i += 1) assert.deepEqual(combine(store, legacy, TRACKS, HANDLING_IDS), once);
  // After a write, reading again (with the old key still there) still gives the same values.
  const written = JSON.stringify(serialize(store, once));
  const again = combine(readStore(written), legacy, TRACKS, HANDLING_IDS);
  assert.deepEqual(again, once);
  assert.equal(JSON.stringify(serialize(readStore(written), again)), written, 'writing again changes nothing');
});

test('reloading many times and writing again neither duplicates nor drifts the records', () => {
  const s = storage({ [LEGACY_RECORDS_KEY]: V020 });
  run(keeper(s), { handling: 'revised', laps: [{ time: 50 }], finish: { score: 7000, bestCombo: 1200 } });
  const first = s.map.get(RECORDS_KEY);
  for (let i = 0; i < 5; i += 1) {
    const r = keeper(s);
    assert.deepEqual(r.forTrack('original', 'classic'), { score: 15420, fastestLap: 47.31, bestCombo: 0 });
    assert.deepEqual(r.forTrack('original', 'revised'), { score: 7000, fastestLap: 50, bestCombo: 1200 });
    run(r, { handling: 'revised', laps: [{ time: 55 }], finish: { score: 10, bestCombo: 0 } }); // worse: no write
  }
  assert.equal(s.map.get(RECORDS_KEY), first);
  assert.deepEqual(Object.keys(saved(s).tracks), ['original', 'switchback']);
});

// --- Independence by mode ------------------------------------------------------------
test('each track and mode pair keeps its own records', () => {
  const s = storage();
  const r = keeper(s);
  run(r, { track: 'original', handling: 'revised', laps: [{ time: 50 }], finish: { score: 20000, bestCombo: 5000 } });
  assert.deepEqual(r.forTrack('original', 'classic'), NONE, 'a Revised best does not reach Classic');
  run(r, { track: 'original', handling: 'classic', laps: [{ time: 46 }], finish: { score: 9000, bestCombo: 900 } });
  assert.deepEqual(r.forTrack('original', 'revised'), { score: 20000, fastestLap: 50, bestCombo: 5000 }, 'a lower Classic run does not touch Revised');
  run(r, { track: 'switchback', handling: 'revised', laps: [{ time: 60 }], finish: { score: 1, bestCombo: 1 } });
  const grid = Object.fromEntries(TRACKS.flatMap((t) => HANDLING_IDS.map((h) => [`${t}/${h}`, r.forTrack(t, h).score])));
  assert.deepEqual(grid, {
    'original/classic': 9000, 'original/revised': 20000,
    'switchback/classic': null, 'switchback/revised': 1,
  });
  // All four partitions survive a reload.
  const again = keeper(s);
  for (const t of TRACKS) for (const h of HANDLING_IDS) assert.deepEqual(again.forTrack(t, h), r.forTrack(t, h), `${t}/${h}`);
});

test('real sessions: Revised and Classic on the same circuit each record their own run', () => {
  const s = storage({ [LEGACY_RECORDS_KEY]: V020 });
  const r = keeper(s);
  const results = {};
  for (const id of ['revised', 'classic']) {
    const game = createGame(trackById('original'), { onRunEvent: (e) => r.handle(e) });
    startRun(game, { handling: handlingById(id) });
    const driver = gripDriver();
    while (game.state !== 'finished' && game.ticks < 120 * 400) tick(game, driver(game));
    assert.equal(game.state, 'finished');
    results[id] = game.results;
  }
  assert.deepEqual(r.forTrack('original', 'revised'), { score: results.revised.score, fastestLap: results.revised.bestLap, bestCombo: results.revised.bestCombo });
  const classic = r.forTrack('original', 'classic');
  assert.equal(classic.fastestLap, Math.min(47.31, results.classic.bestLap));
  assert.equal(classic.score, Math.max(15420, results.classic.score));
  assert.equal(s.map.get(LEGACY_RECORDS_KEY), V020);
});

// --- Zero and missing ------------------------------------------------------------------
test('a zero score or combo is a real record; it is kept, and only beaten by more', () => {
  const s = storage();
  const r = keeper(s);
  assert.deepEqual(run(r, { handling: 'revised', laps: [{ time: 70 }, { time: 70 }, { time: 70 }], finish: { score: 0, bestCombo: 0 } }), { score: true, fastestLap: true, bestCombo: true });
  assert.deepEqual(r.forTrack('original', 'revised'), { score: 0, fastestLap: 70, bestCombo: 0 });
  assert.deepEqual(keeper(s).forTrack('original', 'revised'), { score: 0, fastestLap: 70, bestCombo: 0 }, 'zero survives a reload');
  assert.deepEqual(run(r, { handling: 'revised', finish: { score: 0, bestCombo: 0 } }), { score: false, fastestLap: false, bestCombo: false }, 'equal is not better');
  assert.deepEqual(r.forTrack('original', 'classic'), NONE, 'and Classic is still missing, not zero');
});

test('malformed values are dropped field by field, never turned into records', () => {
  const v2 = JSON.stringify({ version: 2, tracks: { original: {
    classic: { score: 'abc', fastestLap: -1, bestCombo: 1.5 },
    revised: { score: 0, fastestLap: 0, bestCombo: null },
    tuned: 'nonsense',
  } } });
  const r = keeper(storage({ [RECORDS_KEY]: v2, [LEGACY_RECORDS_KEY]: V020 }));
  assert.deepEqual(r.forTrack('original', 'classic'), { score: 15420, fastestLap: 47.31, bestCombo: 0 }, 'the v0.2.0 values fill the gaps');
  assert.deepEqual(r.forTrack('original', 'revised'), { score: 0, fastestLap: null, bestCombo: null }, 'a 0 s lap is not a lap');
  assert.deepEqual(r.forTrack('original', 'tuned'), NONE);
});

// --- The retired Tuned Power mode -------------------------------------------------------
// Tuned Power was offered while v0.3.0 was built, and a schema 2 save may hold its records
// (every write of that build stored a `tuned` entry for each track). They are never shown,
// never folded into Classic or Power, and never deleted.
test('records saved under the retired Tuned Power mode are kept through every write, and never shown or remapped', () => {
  const tuned = { score: 99999, fastestLap: 30.5, bestCombo: 88888, bestAngle: 61 };
  const raw = JSON.stringify({ version: 2, tracks: {
    original: { classic: { score: 9000, fastestLap: 48, bestCombo: 700 }, revised: { score: 11000, fastestLap: 49, bestCombo: 900 }, tuned },
    switchback: { tuned: { score: 0, fastestLap: null, bestCombo: 0 } },
  } });
  const s = storage({ [RECORDS_KEY]: raw, [LEGACY_RECORDS_KEY]: V020 });
  const r = keeper(s);
  assert.deepEqual(RETIRED_HANDLING_IDS, ['tuned']);
  // Not shown, and not merged into a public mode, though every value would beat theirs.
  assert.deepEqual(r.forTrack('original', 'tuned'), NONE);
  assert.deepEqual(r.forTrack('original', 'classic'), { score: 15420, fastestLap: 47.31, bestCombo: 700 }, "Classic: its own and v0.2.0's, nothing from Tuned Power");
  assert.deepEqual(r.forTrack('original', 'revised'), { score: 11000, fastestLap: 49, bestCombo: 900 }, 'Power: its own only');
  assert.deepEqual(s.writes, [], 'loading wrote nothing');
  // An event naming the retired mode (an old page's, or a forged one) sets nothing.
  assert.deepEqual(run(r, { handling: 'tuned', laps: [{ time: 1 }], finish: { score: 1e6, bestCombo: 1e6 } }), { score: false, fastestLap: false, bestCombo: false });
  assert.deepEqual(s.writes, []);
  // New bests in both public modes, on both tracks, and several reloads.
  run(r, { handling: 'classic', laps: [{ time: 46 }] });
  run(keeper(s), { handling: 'revised', track: 'switchback', laps: [{ time: 55 }], finish: { score: 12000, bestCombo: 1000 } });
  for (let i = 0; i < 3; i += 1) run(keeper(s), { handling: 'revised', laps: [{ time: 47 - i }] });
  const v2 = saved(s);
  assert.equal(s.writes.length, 6, 'one per record boundary with a new best: the Switchback run saves its lap, then its finish');
  assert.deepEqual(v2.tracks.original.tuned, tuned, 'every Tuned Power value, and its unknown field, is still there');
  assert.deepEqual(v2.tracks.switchback.tuned, { score: 0, fastestLap: null, bestCombo: 0 }, 'zeros and a missing lap too');
  assert.deepEqual(v2.tracks.original.classic.fastestLap, 46);
  assert.deepEqual(v2.tracks.original.revised.fastestLap, 45);
  assert.deepEqual(v2.tracks.switchback.revised, { score: 12000, fastestLap: 55, bestCombo: 1000 });
  assert.equal(s.map.get(LEGACY_RECORDS_KEY), V020);
});

// --- Old tabs, rollback, and both versions at once -------------------------------------
test('a v0.2.0 tab still open saves a better Classic record later: v0.3.0 picks it up, and never writes the old key', () => {
  const s = storage({ [LEGACY_RECORDS_KEY]: V020 });
  const r = keeper(s);
  run(r, { handling: 'revised', laps: [{ time: 49 }] });
  const old = createV020Records(() => s); // v0.2.0's own keeper
  old.handle({ type: 'start', trackId: 'original', runId: 1, mode: 'normal' });
  old.handle({ type: 'lap', trackId: 'original', runId: 1, valid: true, time: 45 });
  assert.equal(JSON.parse(s.map.get(LEGACY_RECORDS_KEY)).tracks.original.fastestLap, 45);
  assert.equal(keeper(s).forTrack('original', 'classic').fastestLap, 45, 'seen on the next load');
  // And at the next record boundary in an already-open v0.3.0 page.
  assert.deepEqual(run(r, { laps: [{ time: 46 }] }), { score: false, fastestLap: false, bestCombo: false }, '46 s is not a best any more');
  assert.equal(r.forTrack('original', 'classic').fastestLap, 45);
  assert.ok(s.writes.filter((k) => k === LEGACY_RECORDS_KEY).length === 1, 'only the v0.2.0 keeper wrote the old key');
});

test('rolling back to v0.2.0 shows its own records as they were, and its writes leave the new key alone', () => {
  const s = storage({ [LEGACY_RECORDS_KEY]: V020 });
  const r = keeper(s);
  run(r, { handling: 'revised', laps: [{ time: 52 }], finish: { score: 30000, bestCombo: 9000 } });
  run(r, { handling: 'classic', track: 'switchback', laps: [{ time: 50 }] });
  const v3 = s.map.get(RECORDS_KEY);
  const old = createV020Records(() => s);
  assert.deepEqual(old.forTrack('original'), { score: 15420, fastestLap: 47.31, bestCombo: 0 });
  assert.deepEqual(old.forTrack('switchback'), { score: null, fastestLap: 52.08, bestCombo: null }, 'v0.3.0 Classic gains are not visible after a rollback (documented)');
  old.handle({ type: 'start', trackId: 'original', runId: 9, mode: 'normal' });
  old.handle({ type: 'finish', trackId: 'original', runId: 9, completed: 3, score: 16000, bestCombo: 10 });
  assert.equal(s.map.get(RECORDS_KEY), v3, 'the new key is exactly as v0.3.0 left it');
  assert.equal(keeper(s).forTrack('original', 'classic').score, 16000, 'and upgrading again merges the rollback-era best');
});

// --- Unsupported, corrupt and unavailable storage --------------------------------------
// The prototype also treated { version: '2' } and { version: 1 } in this key as a future
// format, which would lock records forever behind a false "newer version" note. Only a later
// integer schema is a future format; those two are corrupt (the next test).
test('a save from a future version is never overwritten and never produces NEW BEST', () => {
  const future = JSON.stringify({ version: 3, records: { 'original:classic:score': 99999 } });
  for (const raw of [future, JSON.stringify({ version: 4, tracks: {} })]) {
    const s = storage({ [RECORDS_KEY]: raw, [LEGACY_RECORDS_KEY]: V020 });
    const r = keeper(s);
    assert.equal(r.readOnly, true);
    assert.equal(r.available, true);
    assert.deepEqual(r.forTrack('original', 'classic'), { score: 15420, fastestLap: 47.31, bestCombo: 0 }, 'the v0.2.0 values are still shown');
    assert.deepEqual(run(r, { handling: 'revised', laps: [{ time: 1 }], finish: { score: 1e6, bestCombo: 1e6 } }), { score: false, fastestLap: false, bestCombo: false });
    assert.deepEqual(s.writes, []);
    assert.equal(s.map.get(RECORDS_KEY), raw);
  }
});

test('unknown tracks, modes and fields in a version-2 save are carried through a write untouched', () => {
  const raw = JSON.stringify({ version: 2, note: 'kept', tracks: {
    original: { classic: { score: 5, fastestLap: 60, bestCombo: 1, bestAngle: 52 }, rally: { score: 77 } },
    canyon: { classic: { score: 123 } },
  } });
  const s = storage({ [RECORDS_KEY]: raw });
  run(keeper(s), { laps: [{ time: 55 }] });
  const v2 = saved(s);
  assert.equal(v2.note, 'kept');
  assert.deepEqual(v2.tracks.original.classic, { score: 5, fastestLap: 55, bestCombo: 1, bestAngle: 52 });
  assert.deepEqual(v2.tracks.original.rally, { score: 77 });
  assert.deepEqual(v2.tracks.canyon, { classic: { score: 123 } });
});

test('corrupt new-key data shows the v0.2.0 records, and the next real best replaces it with a valid save', () => {
  for (const raw of ['{not json', '[]', '"text"', JSON.stringify({ tracks: {} }), JSON.stringify({ version: '2', tracks: {} }), JSON.stringify({ version: 1, tracks: {} }), JSON.stringify({ version: 2.5 })]) {
    const s = storage({ [RECORDS_KEY]: raw, [LEGACY_RECORDS_KEY]: V020 });
    const r = keeper(s);
    assert.equal(r.readOnly, false);
    assert.deepEqual(r.forTrack('original', 'classic').score, 15420);
    assert.deepEqual(s.writes, [], 'nothing is written just for loading');
    run(r, { handling: 'revised', laps: [{ time: 50 }] });
    assert.equal(saved(s).version, 2);
    assert.equal(saved(s).tracks.original.revised.fastestLap, 50);
    assert.equal(saved(s).tracks.original.classic.score, 15420);
  }
});

test('an unreadable or unrecognised v0.2.0 key is ignored and never written', () => {
  for (const raw of ['{bad', JSON.stringify({ version: 2, tracks: { original: { score: 1 } } }), '[]', JSON.stringify({ version: 1 })]) {
    const s = storage({ [LEGACY_RECORDS_KEY]: raw });
    const r = keeper(s);
    assert.deepEqual(r.forTrack('original', 'classic'), NONE);
    run(r, { laps: [{ time: 50 }] });
    assert.equal(s.map.get(LEGACY_RECORDS_KEY), raw);
    assert.ok(!s.writes.includes(LEGACY_RECORDS_KEY));
  }
});

test('storage that cannot be opened: nothing shown, nothing saved, no NEW BEST', () => {
  for (const provider of [() => { throw new Error('SecurityError'); }, () => null, () => ({ getItem() { throw new Error('denied'); }, setItem() {} })]) {
    const r = createRecords(provider);
    assert.equal(r.available, false);
    assert.deepEqual(r.forTrack('original', 'classic'), NONE);
    assert.deepEqual(run(r, { laps: [{ time: 40 }], finish: { score: 5000, bestCombo: 100 } }), { score: false, fastestLap: false, bestCombo: false });
  }
});

test('a failed write is not a record: no NEW BEST, the old values stay, and a later write succeeds', () => {
  const s = storage({ [LEGACY_RECORDS_KEY]: V020 });
  const r = keeper(s);
  s.failSet = true;
  assert.deepEqual(run(r, { handling: 'revised', laps: [{ time: 50 }], finish: { score: 8000, bestCombo: 10 } }), { score: false, fastestLap: false, bestCombo: false });
  assert.equal(r.available, false);
  assert.deepEqual(r.forTrack('original', 'revised'), NONE, 'the menu does not show what was not saved');
  s.failSet = false;
  assert.deepEqual(run(r, { handling: 'revised', laps: [{ time: 51 }] }), { score: false, fastestLap: true, bestCombo: false });
  assert.equal(r.available, true);
  assert.equal(keeper(s).forTrack('original', 'revised').fastestLap, 51);
});

test('a read that fails at a record boundary writes nothing and claims nothing', () => {
  const s = storage({ [LEGACY_RECORDS_KEY]: V020 });
  const r = keeper(s);
  s.failGet = true;
  assert.deepEqual(run(r, { laps: [{ time: 30 }] }), { score: false, fastestLap: false, bestCombo: false });
  assert.deepEqual(s.writes, []);
  assert.equal(r.available, false);
});

// --- Which runs count (the v0.2.0 rules, unchanged) ------------------------------------
test('only normal runs on a known circuit, in a registered mode, finishing three counted laps, set records', () => {
  const s = storage();
  const r = keeper(s);
  const big = { laps: [{ time: 40 }], finish: { score: 50000, bestCombo: 9000 } };
  for (const mode of ['tutorial', 'practice', 'lab']) run(r, { ...big, mode });
  run(r, { ...big, track: PRACTICE_PAD_ID });
  run(r, { ...big, handling: 'unregistered' });
  run(r, { ...big, handling: 'turbo' });
  run(r, { laps: [{ time: 30, valid: false }] });                      // a voided lap
  run(r, { finish: { score: 50000, bestCombo: 9000, completed: 2 } }); // an unfinished run
  assert.deepEqual(s.writes, []);
  // Events that disagree with the run they claim to belong to are ignored.
  r.handle({ type: 'start', trackId: 'original', runId: 900, mode: 'normal', handling: 'classic' });
  r.handle({ type: 'lap', trackId: 'original', runId: 900, handling: 'revised', valid: true, time: 30 });
  r.handle({ type: 'lap', trackId: 'switchback', runId: 900, handling: 'classic', valid: true, time: 30 });
  r.handle({ type: 'lap', trackId: 'original', runId: 899, handling: 'classic', valid: true, time: 30 });
  r.handle({ type: 'abandon' });
  r.handle({ type: 'lap', trackId: 'original', runId: 900, handling: 'classic', valid: true, time: 30 });
  assert.deepEqual(s.writes, []);
  // A finish is settled once.
  r.handle({ type: 'start', trackId: 'original', runId: 901, mode: 'normal', handling: 'classic' });
  r.handle({ type: 'finish', trackId: 'original', runId: 901, handling: 'classic', completed: 3, score: 10, bestCombo: 1 });
  r.handle({ type: 'finish', trackId: 'original', runId: 901, handling: 'classic', completed: 3, score: 20, bestCombo: 2 });
  assert.equal(r.forTrack('original', 'classic').score, 10);
});
