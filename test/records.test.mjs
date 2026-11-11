import test from 'node:test';
import assert from 'node:assert/strict';
import { createRecords, RECORDS_KEY } from '../src/records.js';
import { createGame, startRun, restartRun, returnToMenu, tick } from '../src/game.js';
import { trackById } from '../src/track.js';
import { createScoring, bankCombo, loseCombo } from '../src/scoring.js';
import { driftDriver } from './support/drivers.mjs';

const blank = { score: null, fastestLap: null, bestCombo: null };
function store(raw = null) {
  return { raw, writes: [], reads: 0,
    getItem(key) { assert.equal(key, RECORDS_KEY); this.reads++; return this.raw; },
    setItem(key, value) { assert.equal(key, RECORDS_KEY); this.raw = value; this.writes.push(value); },
  };
}
const start = (r, trackId = 'original', runId = 1, mode = 'normal') => r.handle({ type: 'start', trackId, runId, mode });
const lap = (r, time = 50, valid = true, runId = 1, trackId = 'original') => r.handle({ type: 'lap', trackId, runId, time, valid });
const finish = (r, score = 100, bestCombo = 40, runId = 1, trackId = 'original', completed = 3) => r.handle({ type: 'finish', trackId, runId, score, bestCombo, completed });
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
  assert.deepEqual(r.forTrack('original'), blank);
  assert.deepEqual(r.forTrack('switchback'), blank);
  assert.equal(s.writes.length, 0);
  start(r); finish(r, 0, 0);
  assert.deepEqual(r.forTrack('original'), { score: 0, fastestLap: null, bestCombo: 0 });
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
  assert.deepEqual(r.forTrack('original'), { score: 110, fastestLap: 49, bestCombo: 40 });
  assert.deepEqual(r.newBests, { score: true, fastestLap: true, bestCombo: false });
  finish(r, 999, 999, 3);
  assert.equal(r.forTrack('original').score, 110, 'a finish cannot be settled twice');
});

test('Original and Switchback never share records, and invalid IDs cannot write', () => {
  const s = store(); const r = createRecords(() => s);
  start(r); lap(r, 50); finish(r, 100, 40);
  start(r, 'switchback', 2); lap(r, 65, true, 2, 'switchback'); finish(r, 200, 80, 2, 'switchback');
  assert.deepEqual(r.forTrack('original'), { score: 100, fastestLap: 50, bestCombo: 40 });
  assert.deepEqual(r.forTrack('switchback'), { score: 200, fastestLap: 65, bestCombo: 80 });
  const n = s.writes.length;
  for (const id of ['other', '__proto__', 'constructor', undefined]) { r.handle({ type: 'start', trackId: id, runId: 1, mode: 'normal' }); lap(r, 1); finish(r, 999, 999); }
  assert.equal(s.writes.length, n);
  assert.deepEqual(r.forTrack('__proto__'), blank);
});

test('only a valid completed lap qualifies, with finite positive seconds', () => {
  const s = store(); const r = createRecords(() => s); start(r);
  lap(r, 30, false);
  for (const value of [null, undefined, 0, -1, NaN, Infinity, '1', Number.MAX_VALUE]) r.handle({ type: 'lap', trackId: 'original', runId: 1, time: value, valid: true });
  assert.deepEqual(r.forTrack('original'), blank);
  assert.equal(s.writes.length, 0);
  lap(r, 50); lap(r, 1, false);
  assert.equal(r.forTrack('original').fastestLap, 50);
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
  assert.equal(r.forTrack('original').fastestLap, g.laps.lastLap, 'saved inside the lap-completion tick');
  assert.equal(r.forTrack('original').score, null);
  assert.equal(r.forTrack('original').bestCombo, null);
  const best = r.forTrack('original').fastestLap;
  restartRun(g); returnToMenu(g);
  assert.deepEqual(r.forTrack('original'), { score: null, fastestLap: best, bestCombo: null });
  assert.equal(s.writes.length, 1);
});

for (const track of ['original', 'switchback']) test('real three-lap finish saves settled score and combo on ' + track, () => {
  const { records: r, game: g, events } = rig(track); startRun(g); drive(g);
  assert.equal(g.laps.completed, 3);
  assert.deepEqual(r.forTrack(track), { score: g.results.score, fastestLap: g.results.bestLap, bestCombo: g.results.bestCombo });
  assert.ok(r.forTrack(track).score > 0);
  assert.equal(events.at(-1).type, 'finish');
  assert.equal(events.filter((e) => e.type === 'lap' && e.valid).length, 3);
});

test('best combo comes from banked scoring, never a lost or unbanked combo', () => {
  const state = createScoring();
  state.combo = { points: 100, tier: 0 }; bankCombo(state);
  state.combo = { points: 9000, tier: 0 }; loseCombo(state, 'spun out');
  state.combo = { points: 8000, tier: 0 };
  const s = store(); const r = createRecords(() => s); start(r); finish(r, state.score, state.bestCombo);
  assert.equal(r.forTrack('original').bestCombo, 100);
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
  assert.ok(r.forTrack('original').score > 0);
});

test('records survive a new keeper and expose only copies of saved state', () => {
  const s = store(); const r = createRecords(() => s); start(r); lap(r, 48.321); finish(r);
  const copy = r.forTrack('original'); copy.score = 999;
  const loaded = createRecords(() => s);
  assert.deepEqual(loaded.forTrack('original'), { score: 100, fastestLap: 48.321, bestCombo: 40 });
  assert.deepEqual(JSON.parse(s.raw), { version: 1, tracks: { original: loaded.forTrack('original'), switchback: blank } });
  assert.deepEqual(loaded.newBests, { score: false, fastestLap: false, bestCombo: false });
});

test('corrupt, unsupported or wrong-shaped saves recover empty without eager writes', () => {
  for (const raw of ['{', 'null', '[]', 'true', '7', '{"version":2,"tracks":{}}', '{"version":1,"tracks":[]}', '{"version":1}']) {
    const s = store(raw); const r = createRecords(() => s);
    assert.deepEqual(r.forTrack('original'), blank); assert.equal(s.writes.length, 0);
    start(r); finish(r); assert.equal(r.forTrack('original').score, 100);
  }
});

test('invalid saved numbers become missing; known valid fields survive and unknown tracks are ignored', () => {
  for (const value of [null, true, '100', -1, 0.5, 1e100]) {
    const s = store(JSON.stringify({ version: 1, tracks: { original: { score: value, bestCombo: value, fastestLap: 50 }, fake: { score: 999 } } }));
    const r = createRecords(() => s);
    assert.deepEqual(r.forTrack('original'), { score: null, bestCombo: null, fastestLap: 50 });
    start(r); finish(r);
    assert.deepEqual(Object.keys(JSON.parse(s.raw).tracks), ['original', 'switchback']);
  }
  for (const value of [null, true, '50', -1, 0, 1e100]) {
    const r = createRecords(() => store(JSON.stringify({ version: 1, tracks: { original: { score: 0, bestCombo: 0, fastestLap: value } } })));
    assert.deepEqual(r.forTrack('original'), { score: 0, bestCombo: 0, fastestLap: null });
  }
});

test('invalid event point values never write or become NEW BEST', () => {
  for (const value of [null, '1', -1, 1.5, NaN, Infinity, Number.MAX_VALUE]) {
    const s = store(); const r = createRecords(() => s); start(r); finish(r, value, value);
    assert.equal(s.writes.length, 0); assert.deepEqual(r.forTrack('original'), blank);
  }
});

test('denied access, failing reads and absent storage never escape into gameplay', () => {
  for (const provider of [() => { throw new Error('denied'); }, () => null, () => ({}), () => ({ getItem() { throw new Error('denied'); }, setItem() { throw new Error('must not write'); } })]) {
    const r = createRecords(provider);
    const g = createGame(undefined, { onRunEvent: (event) => r.handle(event) });
    startRun(g); drive(g);
    assert.equal(g.state, 'finished'); assert.equal(r.available, false);
    assert.deepEqual(r.forTrack('original'), blank);
    assert.deepEqual(r.newBests, { score: false, fastestLap: false, bestCombo: false });
  }
});

test('a full store keeps the last saved bests and does not claim an unsaved improvement', () => {
  const s = store(); const r = createRecords(() => s); start(r); lap(r); finish(r);
  const saved = s.raw; const setItem = s.setItem;
  s.setItem = () => { throw new Error('quota'); };
  start(r, 'original', 2); lap(r, 40, true, 2); finish(r, 200, 100, 2);
  assert.equal(r.available, false); assert.equal(s.raw, saved);
  assert.deepEqual(r.forTrack('original'), { score: 100, fastestLap: 50, bestCombo: 40 });
  assert.deepEqual(r.newBests, { score: false, fastestLap: false, bestCombo: false });
  s.setItem = setItem;
  start(r, 'original', 3); lap(r, 40, true, 3); finish(r, 200, 100, 3);
  assert.equal(r.available, true);
  assert.deepEqual(r.forTrack('original'), { score: 200, fastestLap: 40, bestCombo: 100 });
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
  assert.deepEqual(loaded.forTrack('original'), { score: 110, fastestLap: 49, bestCombo: 50 });
  assert.deepEqual(loaded.forTrack('switchback'), { score: 200, fastestLap: 65, bestCombo: 80 });
  start(b, 'original', 4); lap(b, 60, true, 4); finish(b, 10, 5, 4);
  assert.deepEqual(b.forTrack('original'), loaded.forTrack('original'));
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
  assert.deepEqual(r.forTrack('original'), blank);
});
