import test from 'node:test';
import assert from 'node:assert/strict';
// The keeper's own rules, against its real storage layout: schema 2 in RECORDS_KEY, with the
// v0.2.0 key (LEGACY_RECORDS_KEY) only ever read. Records by handling mode and the migration
// from v0.2.0 are in handling-records.test.mjs; here every run is Classic unless it says so.
import { createRecords, RECORDS_KEY, LEGACY_RECORDS_KEY } from '../src/records.js';
import { HANDLING_IDS } from '../src/handling.js';
import { createGame, startRun, restartRun, returnToMenu, tick } from '../src/game.js';
import { trackById } from '../src/track.js';
import { createScoring, bankCombo, loseCombo } from '../src/scoring.js';
import { driftDriver } from './support/drivers.mjs';

const blank = { score: null, fastestLap: null, bestCombo: null };
// `raw` is the schema 2 key. The v0.2.0 key may be read, and is empty here, but is never written.
function store(raw = null, legacy = null) {
  return { raw, legacy, writes: [], reads: 0,
    getItem(key) { assert.ok(key === RECORDS_KEY || key === LEGACY_RECORDS_KEY, key); this.reads++; return key === RECORDS_KEY ? this.raw : this.legacy; },
    setItem(key, value) { assert.equal(key, RECORDS_KEY, 'only the schema 2 key is ever written'); this.raw = value; this.writes.push(value); },
  };
}
const start = (r, trackId = 'original', runId = 1, mode = 'normal', handling = 'classic') => r.handle({ type: 'start', trackId, runId, mode, handling });
const lap = (r, time = 50, valid = true, runId = 1, trackId = 'original', handling = 'classic') => r.handle({ type: 'lap', trackId, runId, handling, time, valid });
const finish = (r, score = 100, bestCombo = 40, runId = 1, trackId = 'original', completed = 3, handling = 'classic') => r.handle({ type: 'finish', trackId, runId, handling, score, bestCombo, completed });
// The schema 2 save for a set of Classic bests, every other partition empty.
const savedClassic = (tracks) => ({ version: 2, tracks: Object.fromEntries(['original', 'switchback'].map((t) => [t,
  Object.fromEntries(HANDLING_IDS.map((h) => [h, h === 'classic' && tracks[t] ? tracks[t] : blank]))])) });
function rig(trackId = 'original') {
  const storage = store(); const records = createRecords(() => storage);
  const events = [];
  const game = createGame(trackById(trackId), { onRunEvent: (event) => { events.push(event); records.handle(event); } });
  return { storage, records, game, events };
}
function drive(game, stop = (g) => g.state === 'finished') {
  const driver = driftDriver();
  while (!stop(game) && game.ticks < 60000) tick(game, driver(game));
  assert.ok(stop(game), 'driver reached the requested boundary');
}

test('empty store has missing records, no writes; a completed zero-score run establishes zero', () => {
  const s = store(); const r = createRecords(() => s);
  assert.deepEqual(r.forTrack('original', 'classic'), blank);
  assert.deepEqual(r.forTrack('switchback', 'classic'), blank);
  assert.equal(s.writes.length, 0);
  start(r); finish(r, 0, 0);
  assert.deepEqual(r.forTrack('original', 'classic'), { score: 0, fastestLap: null, bestCombo: 0 });
  assert.deepEqual(r.newBests, { score: true, fastestLap: false, bestCombo: true });
  assert.equal(s.writes.length, 1);
});

test('only strict improvements write; each result flag is independent and reset on a new run', () => {
  const s = store(); const r = createRecords(() => s);
  start(r); lap(r, 50); finish(r);
  assert.equal(s.writes.length, 2);
  start(r, 'original', 2); lap(r, 50, true, 2); lap(r, 60, true, 2); finish(r, 90, 40, 2);
  assert.equal(s.writes.length, 2);
  assert.deepEqual(r.newBests, { score: false, fastestLap: false, bestCombo: false });
  start(r, 'original', 3); lap(r, 49, true, 3); finish(r, 110, 30, 3);
  assert.deepEqual(r.forTrack('original', 'classic'), { score: 110, fastestLap: 49, bestCombo: 40 });
  assert.deepEqual(r.newBests, { score: true, fastestLap: true, bestCombo: false });
  finish(r, 999, 999, 3);
  assert.equal(r.forTrack('original', 'classic').score, 110, 'a finish cannot be settled twice');
});

test('Original and Switchback never share records, and invalid IDs cannot write', () => {
  const s = store(); const r = createRecords(() => s);
  start(r); lap(r, 50); finish(r, 100, 40);
  start(r, 'switchback', 2); lap(r, 65, true, 2, 'switchback'); finish(r, 200, 80, 2, 'switchback');
  assert.deepEqual(r.forTrack('original', 'classic'), { score: 100, fastestLap: 50, bestCombo: 40 });
  assert.deepEqual(r.forTrack('switchback', 'classic'), { score: 200, fastestLap: 65, bestCombo: 80 });
  const n = s.writes.length;
  for (const id of ['other', '__proto__', 'constructor', undefined]) { r.handle({ type: 'start', trackId: id, runId: 1, mode: 'normal', handling: 'classic' }); lap(r, 1); finish(r, 999, 999); }
  for (const handling of ['turbo', '__proto__', 'constructor', undefined]) {
    r.handle({ type: 'start', trackId: 'original', runId: 1, mode: 'normal', handling });
    r.handle({ type: 'lap', trackId: 'original', runId: 1, handling, time: 1, valid: true });
    r.handle({ type: 'finish', trackId: 'original', runId: 1, handling, score: 999, bestCombo: 999, completed: 3 });
  }
  assert.equal(s.writes.length, n);
  assert.deepEqual(r.forTrack('__proto__', 'classic'), blank);
  assert.deepEqual(r.forTrack('original', '__proto__'), blank);
  assert.deepEqual(r.forTrack('original'), blank, 'a partition must name its mode');
});

test('only a valid completed lap qualifies, with finite positive seconds', () => {
  const s = store(); const r = createRecords(() => s); start(r);
  lap(r, 30, false);
  for (const value of [null, undefined, 0, -1, NaN, Infinity, '1', Number.MAX_VALUE]) r.handle({ type: 'lap', trackId: 'original', runId: 1, time: value, valid: true });
  assert.deepEqual(r.forTrack('original', 'classic'), blank);
  assert.equal(s.writes.length, 0);
  lap(r, 50); lap(r, 1, false);
  assert.equal(r.forTrack('original', 'classic').fastestLap, 50);
});

test('wrong-session events and incomplete finishes cannot establish records', () => {
  const s = store(); const r = createRecords(() => s); start(r);
  lap(r, 1, true, 2); lap(r, 1, true, 1, 'switchback');
  finish(r, 999, 999, 2); finish(r, 999, 999, 1, 'switchback'); finish(r, 999, 999, 1, 'original', 2);
  assert.equal(s.writes.length, 0);
});

test('abandoned and restarted real runs retain valid laps but never score or combo records', () => {
  const { records: r, game: g, storage: s } = rig(); startRun(g);
  drive(g, (v) => v.laps.completed === 1);
  assert.ok(g.scoring.score > 0 && g.scoring.bestCombo > 0);
  assert.equal(r.forTrack('original', 'classic').fastestLap, g.laps.lastLap, 'saved inside the lap-completion tick');
  assert.equal(r.forTrack('original', 'classic').score, null);
  assert.equal(r.forTrack('original', 'classic').bestCombo, null);
  const best = r.forTrack('original', 'classic').fastestLap;
  restartRun(g); returnToMenu(g);
  assert.deepEqual(r.forTrack('original', 'classic'), { score: null, fastestLap: best, bestCombo: null });
  assert.equal(s.writes.length, 1);
});

for (const track of ['original', 'switchback']) test('real three-lap finish saves settled score and combo on ' + track, () => {
  const { records: r, game: g, events } = rig(track); startRun(g); drive(g);
  assert.equal(g.laps.completed, 3);
  assert.deepEqual(r.forTrack(track, 'classic'), { score: g.results.score, fastestLap: g.results.bestLap, bestCombo: g.results.bestCombo });
  assert.ok(r.forTrack(track, 'classic').score > 0);
  assert.equal(events.at(-1).type, 'finish');
  assert.equal(events.filter((e) => e.type === 'lap' && e.valid).length, 3);
});

test('best combo comes from banked scoring, never a lost or unbanked combo', () => {
  const state = createScoring();
  state.combo = { points: 100, tier: 0 }; bankCombo(state);
  state.combo = { points: 9000, tier: 0 }; loseCombo(state, 'spun out');
  state.combo = { points: 8000, tier: 0 };
  const s = store(); const r = createRecords(() => s); start(r); finish(r, state.score, state.bestCombo);
  assert.equal(r.forTrack('original', 'classic').bestCombo, 100);
  assert.equal(state.combo.points, 8000);
});

test('tutorial runs, lap events and restarts never write, while the next normal run can', () => {
  const { records: r, game: g, storage: s } = rig();
  startRun(g, { mode: 'tutorial', ghost: false }); drive(g);
  assert.equal(g.laps.completed, 3); assert.ok(g.results.score > 0);
  assert.equal(s.writes.length, 0);
  restartRun(g, { mode: 'tutorial', ghost: false }); drive(g);
  assert.equal(s.writes.length, 0);
  returnToMenu(g); startRun(g); drive(g);
  assert.ok(r.forTrack('original', 'classic').score > 0);
});

test('records survive a new keeper and expose only copies of saved state', () => {
  const s = store(); const r = createRecords(() => s); start(r); lap(r, 48.321); finish(r);
  const copy = r.forTrack('original', 'classic'); copy.score = 999;
  const loaded = createRecords(() => s);
  assert.deepEqual(loaded.forTrack('original', 'classic'), { score: 100, fastestLap: 48.321, bestCombo: 40 });
  assert.deepEqual(JSON.parse(s.raw), savedClassic({ original: loaded.forTrack('original', 'classic') }));
  assert.deepEqual(loaded.newBests, { score: false, fastestLap: false, bestCombo: false });
});

// v0.2.0 also replaced a save with an unknown version here. Schema 2 replaces only data that is
// not a real later schema (a non-integer, missing, or lower version); a later schema is never
// written (the next test, and handling-records.test.mjs).
test('corrupt, outdated or wrong-shaped saves recover empty without eager writes', () => {
  for (const raw of ['{', 'null', '[]', 'true', '7', '{"version":2,"tracks":[]}', '{"version":2}', '{"version":1,"tracks":{}}', '{"version":"2","tracks":{}}', '{"tracks":{}}']) {
    const s = store(raw); const r = createRecords(() => s);
    assert.deepEqual(r.forTrack('original', 'classic'), blank); assert.equal(s.writes.length, 0);
    assert.equal(r.readOnly, false, raw);
    start(r); finish(r); assert.equal(r.forTrack('original', 'classic').score, 100);
    assert.equal(JSON.parse(s.raw).version, 2);
  }
});

test('a save from a later schema is never overwritten and never claims a NEW BEST', () => {
  for (const raw of ['{"version":3,"tracks":{}}', '{"version":99}']) {
    const s = store(raw); const r = createRecords(() => s);
    assert.equal(r.readOnly, true); assert.equal(r.available, true);
    start(r); lap(r); finish(r);
    assert.equal(s.writes.length, 0); assert.equal(s.raw, raw);
    assert.deepEqual(r.newBests, { score: false, fastestLap: false, bestCombo: false });
    assert.deepEqual(r.forTrack('original', 'classic'), blank);
  }
});

// v0.2.0 dropped unknown tracks at the next write. Schema 2 keeps them, untouched and never
// shown, so that a later version's tracks and modes survive this version's writes.
test('invalid saved numbers become missing; known valid fields survive and unknown tracks are kept but ignored', () => {
  for (const value of [null, true, '100', -1, 0.5, 1e100]) {
    const s = store(JSON.stringify({ version: 2, tracks: { original: { classic: { score: value, bestCombo: value, fastestLap: 50 } }, fake: { classic: { score: 999 } } } }));
    const r = createRecords(() => s);
    assert.deepEqual(r.forTrack('original', 'classic'), { score: null, bestCombo: null, fastestLap: 50 });
    assert.deepEqual(r.forTrack('fake', 'classic'), blank);
    start(r); finish(r);
    assert.deepEqual(Object.keys(JSON.parse(s.raw).tracks), ['original', 'fake', 'switchback']);
    assert.deepEqual(JSON.parse(s.raw).tracks.fake, { classic: { score: 999 } });
    assert.deepEqual(JSON.parse(s.raw).tracks.original.classic, { score: 100, bestCombo: 40, fastestLap: 50 });
  }
  for (const value of [null, true, '50', -1, 0, 1e100]) {
    const r = createRecords(() => store(JSON.stringify({ version: 2, tracks: { original: { classic: { score: 0, bestCombo: 0, fastestLap: value } } } })));
    assert.deepEqual(r.forTrack('original', 'classic'), { score: 0, bestCombo: 0, fastestLap: null });
    // The same rules apply to the v0.2.0 key, read through the migration.
    const legacy = createRecords(() => store(null, JSON.stringify({ version: 1, tracks: { original: { score: 0, bestCombo: 0, fastestLap: value } } })));
    assert.deepEqual(legacy.forTrack('original', 'classic'), { score: 0, bestCombo: 0, fastestLap: null });
  }
});

test('invalid event point values never write or become NEW BEST', () => {
  for (const value of [null, '1', -1, 1.5, NaN, Infinity, Number.MAX_VALUE]) {
    const s = store(); const r = createRecords(() => s); start(r); finish(r, value, value);
    assert.equal(s.writes.length, 0); assert.deepEqual(r.forTrack('original', 'classic'), blank);
  }
});

test('denied access, failing reads and absent storage never escape into gameplay', () => {
  for (const provider of [() => { throw new Error('denied'); }, () => null, () => ({}), () => ({ getItem() { throw new Error('denied'); }, setItem() { throw new Error('must not write'); } })]) {
    const r = createRecords(provider);
    const g = createGame(undefined, { onRunEvent: (event) => r.handle(event) });
    startRun(g); drive(g);
    assert.equal(g.state, 'finished'); assert.equal(r.available, false);
    assert.deepEqual(r.forTrack('original', 'classic'), blank);
    assert.deepEqual(r.newBests, { score: false, fastestLap: false, bestCombo: false });
  }
});

test('a full store keeps the last saved bests and does not claim an unsaved improvement', () => {
  const s = store(); const r = createRecords(() => s); start(r); lap(r); finish(r);
  const saved = s.raw; const setItem = s.setItem;
  s.setItem = () => { throw new Error('quota'); };
  start(r, 'original', 2); lap(r, 40, true, 2); finish(r, 200, 100, 2);
  assert.equal(r.available, false); assert.equal(s.raw, saved);
  assert.deepEqual(r.forTrack('original', 'classic'), { score: 100, fastestLap: 50, bestCombo: 40 });
  assert.deepEqual(r.newBests, { score: false, fastestLap: false, bestCombo: false });
  s.setItem = setItem;
  start(r, 'original', 3); lap(r, 40, true, 3); finish(r, 200, 100, 3);
  assert.equal(r.available, true);
  assert.deepEqual(r.forTrack('original', 'classic'), { score: 200, fastestLap: 40, bestCombo: 100 });
});

test('ordinary simulation ticks do not scan or write storage', () => {
  const { game: g, storage: s } = rig(); startRun(g);
  const reads = s.reads;
  for (let i = 0; i < 1000; i++) tick(g, {});
  assert.equal(s.reads, reads); assert.equal(s.writes.length, 0);
});

test('a second already-open keeper preserves the other track and better records from another tab', () => {
  const s = store(); const a = createRecords(() => s); const b = createRecords(() => s);
  start(a); lap(a, 50); finish(a, 100, 40);
  start(b, 'switchback', 2); lap(b, 65, true, 2, 'switchback'); finish(b, 200, 80, 2, 'switchback');
  start(a, 'original', 3); lap(a, 49, true, 3); finish(a, 110, 50, 3);
  const loaded = createRecords(() => s);
  assert.deepEqual(loaded.forTrack('original', 'classic'), { score: 110, fastestLap: 49, bestCombo: 50 });
  assert.deepEqual(loaded.forTrack('switchback', 'classic'), { score: 200, fastestLap: 65, bestCombo: 80 });
  start(b, 'original', 4); lap(b, 60, true, 4); finish(b, 10, 5, 4);
  assert.deepEqual(b.forTrack('original', 'classic'), loaded.forTrack('original', 'classic'));
});

test('a later storage-read failure prevents overwriting unreadable data and does not escape', () => {
  const s = store(); const r = createRecords(() => s); start(r); lap(r); finish(r);
  const raw = s.raw; const writes = s.writes.length;
  s.getItem = () => { throw new Error('denied after startup'); };
  start(r, 'original', 2); lap(r, 40, true, 2); finish(r, 999, 999, 2);
  assert.equal(r.available, false); assert.equal(s.raw, raw); assert.equal(s.writes.length, writes);
  assert.deepEqual(r.newBests, { score: false, fastestLap: false, bestCombo: false });
});

test('a real voided lap event cannot reuse a previous valid last-lap time', () => {
  const { game: g, records: r, events } = rig(); startRun(g);
  g.laps.valid = false; // simulate a missed gate; existing validation must emit void
  drive(g, (v) => v.laps.voided > 0);
  assert.equal(events.at(-1).type, 'lap'); assert.equal(events.at(-1).valid, false);
  assert.deepEqual(r.forTrack('original', 'classic'), blank);
});
