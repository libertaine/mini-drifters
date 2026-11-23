// Getaway Driver completion counts (getaway-driver-records.js): what counts, once, per environment,
// handling mode and outcome; the storage key and its schema; damaged, later-version and unavailable
// storage; and that no other key is ever touched.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  DRIVER_RECORDS_KEY, DRIVER_SCHEMA_VERSION, MAX_COUNT, createDriverRecords, readDriverStore, savedCounts, serializeDriver,
} from '../src/getaway-driver-records.js';
import { GETAWAY_RECORDS_KEY } from '../src/getaway-records.js';
import { GETAWAY_DRIVER } from '../src/getaway-driver.js';
import { GETAWAY_MISSIONS } from '../src/getaway-missions.js';

const ID = GETAWAY_DRIVER.environments[0].id;
const FOOTAGE = GETAWAY_MISSIONS[0].environments[0].id;
const ZERO = { ghost: 0, 'low-profile': 0, 'lost-them': 0 };

function memory(initial = {}) {
  const data = new Map(Object.entries(initial));
  const writes = [];
  return {
    data, writes,
    getItem: (k) => (data.has(k) ? data.get(k) : null),
    setItem: (k, v) => { writes.push(k); data.set(k, String(v)); },
    removeItem: (k) => data.delete(k),
  };
}
let runId = 0;
// One run, start to end, through the same events game.js sends.
function drive(records, { challengeId = ID, handling = 'classic', completed = true, outcome = 'ghost', mode = 'gymkhana', end = 'challenge' } = {}) {
  runId += 1;
  records.handle({ type: 'start', mode, challengeId, handling, runId });
  if (end === 'abandon') { records.handle({ type: 'abandon', runId }); return; }
  records.handle({ type: 'challenge', challengeId, handling, runId, completed, value: null }, completed ? outcome : null);
}
const saved = (storage) => JSON.parse(storage.getItem(DRIVER_RECORDS_KEY));

test('counts: each completed outcome adds one, per handling mode, under its own key only', () => {
  const storage = memory();
  const records = createDriverRecords(() => storage);
  assert.equal(records.available, true);
  assert.deepEqual(records.countsFor(ID, 'classic'), ZERO);
  assert.deepEqual(storage.writes, [], 'nothing is written on load');
  drive(records, { outcome: 'ghost' });
  assert.equal(records.counted, 'ghost');
  drive(records, { outcome: 'ghost' });
  drive(records, { outcome: 'low profile' });
  drive(records, { outcome: 'lost them', handling: 'revised' });
  assert.deepEqual(records.countsFor(ID, 'classic'), { ghost: 2, 'low-profile': 1, 'lost-them': 0 });
  assert.deepEqual(records.countsFor(ID, 'revised'), { ghost: 0, 'low-profile': 0, 'lost-them': 1 });
  assert.deepEqual(saved(storage), { version: 1, environments: { downtown: {
    classic: { ghost: 2, 'low-profile': 1 }, revised: { 'lost-them': 1 } } } });
  assert.deepEqual([...new Set(storage.writes)], [DRIVER_RECORDS_KEY]);
  assert.ok(!storage.data.has(GETAWAY_RECORDS_KEY));
  // A new page reads them back.
  assert.deepEqual(createDriverRecords(() => storage).countsFor(ID, 'classic'), { ghost: 2, 'low-profile': 1, 'lost-them': 0 });
});

test('counts: a bust, a timeout, a retry, an abandoned run, another challenge or a mismatched event count nothing', () => {
  const storage = memory();
  const records = createDriverRecords(() => storage);
  drive(records, { completed: false });
  assert.equal(records.counted, null);
  drive(records, { end: 'abandon' });
  drive(records, { challengeId: FOOTAGE });
  drive(records, { handling: 'unknown' });
  drive(records, { mode: 'normal' });
  drive(records, { outcome: 'busted' });
  drive(records, { outcome: null });
  // A start for one run and an end naming another.
  records.handle({ type: 'start', mode: 'gymkhana', challengeId: ID, handling: 'classic', runId: 900 });
  records.handle({ type: 'challenge', challengeId: ID, handling: 'classic', runId: 901, completed: true }, 'ghost');
  records.handle({ type: 'challenge', challengeId: ID, handling: 'revised', runId: 900, completed: true }, 'ghost');
  // The real end, then the same event again: once.
  records.handle({ type: 'challenge', challengeId: ID, handling: 'classic', runId: 900, completed: true }, 'ghost');
  records.handle({ type: 'challenge', challengeId: ID, handling: 'classic', runId: 900, completed: true }, 'ghost');
  assert.deepEqual(records.countsFor(ID, 'classic'), { ...ZERO, ghost: 1 });
  assert.equal(storage.writes.length, 1);
  // The next start clears "counted".
  records.handle({ type: 'start', mode: 'gymkhana', challengeId: ID, handling: 'classic', runId: 902 });
  assert.equal(records.counted, null);
});

test('counts: another tab\'s counts are kept, and unknown environments, modes, outcomes and fields carried', () => {
  const storage = memory({ [DRIVER_RECORDS_KEY]: JSON.stringify({ version: 1, note: 'kept', environments: {
    downtown: { classic: { ghost: 4, future: 9 }, hyper: { ghost: 1 } }, industrial: { classic: { ghost: 3 } } } }) });
  const records = createDriverRecords(() => storage);
  assert.deepEqual(records.countsFor(ID, 'classic'), { ...ZERO, ghost: 4 });
  // Another tab adds two while this page is open.
  const other = saved(storage);
  other.environments.downtown.classic.ghost = 6;
  storage.data.set(DRIVER_RECORDS_KEY, JSON.stringify(other));
  drive(records, { outcome: 'ghost' });
  assert.deepEqual(saved(storage), { version: 1, note: 'kept', environments: {
    downtown: { classic: { ghost: 7, future: 9 }, hyper: { ghost: 1 } }, industrial: { classic: { ghost: 3 } } } });
});

test('storage: damaged data reads as zero and the next completion replaces it; a later schema is never written', () => {
  for (const raw of ['{not json', '[]', '"text"', JSON.stringify({ version: 0 }), JSON.stringify({ environments: {} })]) {
    const storage = memory({ [DRIVER_RECORDS_KEY]: raw });
    const records = createDriverRecords(() => storage);
    assert.deepEqual(records.countsFor(ID, 'classic'), ZERO, raw);
    drive(records, { outcome: 'low profile' });
    assert.deepEqual(saved(storage), { version: 1, environments: { downtown: { classic: { 'low-profile': 1 } } } }, raw);
  }
  // A damaged count reads as 0, and only that count is replaced.
  for (const bad of [-1, 1.5, '3', null, MAX_COUNT + 1]) {
    const storage = memory({ [DRIVER_RECORDS_KEY]: JSON.stringify({ version: 1, environments: { downtown: { classic: { ghost: bad, 'lost-them': 2 } } } }) });
    const records = createDriverRecords(() => storage);
    assert.deepEqual(records.countsFor(ID, 'classic'), { ...ZERO, 'lost-them': 2 }, String(bad));
    drive(records, { outcome: 'ghost' });
    assert.deepEqual(saved(storage).environments.downtown.classic, { ghost: 1, 'lost-them': 2 }, String(bad));
  }
  const later = JSON.stringify({ version: 2, environments: { downtown: { classic: { ghost: 5 } } } });
  const storage = memory({ [DRIVER_RECORDS_KEY]: later });
  const records = createDriverRecords(() => storage);
  assert.equal(records.readOnly, true);
  assert.deepEqual(records.countsFor(ID, 'classic'), ZERO);
  drive(records, { outcome: 'ghost' });
  assert.equal(records.counted, null);
  assert.deepEqual(storage.writes, []);
  assert.equal(storage.getItem(DRIVER_RECORDS_KEY), later);
});

test('storage: unavailable, unreadable or full storage never stops play and is reported', () => {
  for (const provider of [() => { throw new Error('denied'); }, () => null, () => ({ getItem: 1 })]) {
    const records = createDriverRecords(provider);
    assert.equal(records.available, false);
    assert.deepEqual(records.countsFor(ID, 'classic'), ZERO);
    drive(records);
    assert.equal(records.counted, null);
  }
  const full = memory();
  full.setItem = () => { throw new Error('QuotaExceededError'); };
  const records = createDriverRecords(() => full);
  assert.equal(records.available, true);
  drive(records);
  assert.equal(records.available, false);
  assert.equal(records.counted, null);
  // Readable again later: the next completion is saved and the note clears.
  full.setItem = (k, v) => full.data.set(k, v);
  drive(records);
  assert.equal(records.available, true);
  assert.deepEqual(records.countsFor(ID, 'classic'), { ...ZERO, ghost: 1 });
});

test('schema: the pure readers and writer', () => {
  assert.equal(DRIVER_RECORDS_KEY, 'mini-drifters-getaway-driver-v1');
  assert.equal(DRIVER_SCHEMA_VERSION, 1);
  assert.deepEqual(readDriverStore(null), { status: 'empty', saved: null });
  assert.equal(readDriverStore('{').status, 'corrupt');
  assert.equal(readDriverStore('{"version":3}').status, 'unsupported');
  const ok = readDriverStore('{"version":1,"environments":{"downtown":{"revised":{"ghost":2}}}}');
  assert.deepEqual(savedCounts(ok, 'downtown', 'revised'), { ...ZERO, ghost: 2 });
  assert.deepEqual(savedCounts(ok, 'downtown', 'classic'), ZERO);
  assert.deepEqual(serializeDriver(ok, 'downtown', 'revised', 'ghost'), { version: 1, environments: { downtown: { revised: { ghost: 3 } } } });
  assert.deepEqual(ok.saved.environments.downtown.revised, { ghost: 2 }, 'the store read is not changed');
  const top = readDriverStore(JSON.stringify({ version: 1, environments: { downtown: { classic: { ghost: MAX_COUNT } } } }));
  assert.equal(serializeDriver(top, 'downtown', 'classic', 'ghost').environments.downtown.classic.ghost, MAX_COUNT);
  // No bests, so the shared sheet's medal code finds none.
  assert.equal(createDriverRecords(() => memory()).bestFor(ID, 'classic'), null);
});
