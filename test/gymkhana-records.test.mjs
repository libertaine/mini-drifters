// The gymkhana challenges' own personal bests (src/gymkhana-records.js): what qualifies, how a
// record is filed, and that they and the circuit records can never touch each other.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createGame, startRun, restartRun, returnToMenu, tick } from '../src/game.js';
import { TUNING } from '../src/tuning.js';
import { handlingById } from '../src/handling.js';
import { SCORING_VERSION } from '../src/scoring.js';
import { createRecords, RECORDS_KEY } from '../src/records.js';
import { PRECISION_180, LINKED_DRIFT, ONE_DRIFT, GYMKHANA_CHALLENGES } from '../src/gymkhana.js';
import { createGymkhanaRecords, GYMKHANA_RECORDS_KEY, GYMKHANA_SCHEMA_VERSION, recordRules, readGymkhanaStore, gymkhanaTable, serializeGymkhana } from '../src/gymkhana-records.js';
import * as D from './support/gymkhana-drivers.mjs';

const DEG = Math.PI / 180;
const classic = handlingById('classic');
const power = handlingById('revised');
const KEYS = (keys = {}) => ({ up: false, down: false, left: false, right: false, handbrake: false, ...keys });
const tidy = () => D.handbrake180({ vCap: 24, triggerX: -8, release: 110 * DEG });
const slower = () => D.gripUturn({ vTurn: 5 });   // legal, and two seconds slower
const drifter = () => D.courseDrift({ targetSlip: 32 * DEG, catchSlip: 40 * DEG, tapTime: 0.3, lateral: 9.5, cooldown: 1.4 });

function memory(initial = {}) {
  const stored = new Map(Object.entries(initial));
  const writes = [];
  return {
    stored, writes,
    getItem: (k) => stored.get(k) ?? null,
    setItem: (k, v) => { writes.push(k); stored.set(k, String(v)); },
    removeItem: (k) => stored.delete(k),
  };
}
const saved = (storage) => JSON.parse(storage.getItem(GYMKHANA_RECORDS_KEY));

// The event stream of one session, as game.js emits it.
const start = (runId, challengeId, handling = 'classic') => ({ type: 'start', trackId: 'x', runId, mode: 'gymkhana', handling, challengeId });
const finish = (runId, challengeId, value, handling = 'classic') => ({ type: 'challenge', challengeId, runId, handling, completed: value !== null, value });

test('the key and schema are the gymkhana records\' own', () => {
  assert.equal(GYMKHANA_RECORDS_KEY, 'mini-drifters-gymkhana-v1');
  assert.equal(GYMKHANA_SCHEMA_VERSION, 1);
  assert.notEqual(GYMKHANA_RECORDS_KEY, RECORDS_KEY);
  assert.equal(recordRules(PRECISION_180), 'precision-180-1', 'a time is filed under the challenge\'s rules');
  assert.equal(recordRules(LINKED_DRIFT), `linked-drift-1+${SCORING_VERSION}`, 'a score also under the scoring version');
  assert.equal(recordRules(ONE_DRIFT), `one-drift-1+${SCORING_VERSION}`);
});

test('nothing is written on load, and an empty store has no records', () => {
  const storage = memory();
  const records = createGymkhanaRecords(() => storage);
  assert.equal(records.available, true);
  assert.equal(records.readOnly, false);
  assert.equal(records.newBest, false);
  for (const def of GYMKHANA_CHALLENGES) for (const h of ['classic', 'revised']) assert.equal(records.bestFor(def.id, h), null);
  assert.equal(records.bestFor('original', 'classic'), null, 'a circuit is not a challenge');
  assert.equal(records.bestFor('precision-180', 'tuned'), null, 'a retired mode has no records');
  assert.deepEqual(storage.writes, []);
});

test('a completed run sets a record: lower is better for a time, higher for a score, and ties are not improvements', () => {
  const storage = memory();
  const records = createGymkhanaRecords(() => storage);
  const run = (id, challengeId, value) => { records.handle(start(id, challengeId)); records.handle(finish(id, challengeId, value)); return records.newBest; };

  assert.equal(run(1, 'precision-180', 8.5), true);
  assert.equal(records.bestFor('precision-180', 'classic'), 8.5);
  assert.equal(run(2, 'precision-180', 9.1), false, 'slower');
  assert.equal(run(3, 'precision-180', 8.5), false, 'a tie');
  assert.equal(run(4, 'precision-180', 7.875), true, 'quicker');
  assert.equal(records.bestFor('precision-180', 'classic'), 7.875);

  assert.equal(run(5, 'linked-drift', 0), true, 'zero is a real score');
  assert.equal(run(6, 'linked-drift', 0), false);
  assert.equal(run(7, 'linked-drift', 900), true);
  assert.equal(run(8, 'linked-drift', 640), false);
  assert.equal(records.bestFor('linked-drift', 'classic'), 900);
  assert.equal(storage.writes.length, 4, 'one write per improvement and none otherwise');

  assert.deepEqual(saved(storage), { version: 1, challenges: {
    'precision-180': { classic: { 'precision-180-1': { best: 7.875 } } },
    'linked-drift': { classic: { [`linked-drift-1+${SCORING_VERSION}`]: { best: 900 } } },
  } });
});

test('each challenge and each handling mode keeps its own record', () => {
  const storage = memory();
  const records = createGymkhanaRecords(() => storage);
  records.handle(start(1, 'linked-drift', 'classic')); records.handle(finish(1, 'linked-drift', 500, 'classic'));
  records.handle(start(2, 'linked-drift', 'revised')); records.handle(finish(2, 'linked-drift', 1200, 'revised'));
  records.handle(start(3, 'one-drift', 'classic')); records.handle(finish(3, 'one-drift', 300, 'classic'));
  assert.equal(records.newBest, true, 'a lower One Drift score is still that challenge\'s first record');
  assert.equal(records.bestFor('linked-drift', 'classic'), 500);
  assert.equal(records.bestFor('linked-drift', 'revised'), 1200);
  assert.equal(records.bestFor('one-drift', 'classic'), 300);
  assert.equal(records.bestFor('one-drift', 'revised'), null);
  assert.equal(records.bestFor('precision-180', 'classic'), null);
});

test('what does not qualify: failed, abandoned, restarted, mismatched and malformed results', () => {
  const storage = memory();
  const records = createGymkhanaRecords(() => storage);
  const none = (message) => { assert.equal(records.bestFor('precision-180', 'classic'), null, message); assert.equal(records.newBest, false, message); };

  records.handle(start(1, 'precision-180')); records.handle(finish(1, 'precision-180', null));
  none('a failed run');
  records.handle(start(2, 'precision-180')); records.handle({ type: 'challenge', challengeId: 'precision-180', runId: 2, handling: 'classic', completed: false, value: 7 });
  none('a failed run that names a value anyway');
  records.handle(start(3, 'precision-180')); records.handle({ type: 'abandon' }); records.handle(finish(3, 'precision-180', 7));
  none('an abandoned run');
  records.handle(start(4, 'precision-180')); records.handle(start(5, 'precision-180')); records.handle(finish(4, 'precision-180', 7));
  none('the run before a restart');
  records.handle(start(6, 'precision-180')); records.handle(finish(6, 'linked-drift', 7));
  none('another challenge\'s result');
  records.handle(start(7, 'precision-180')); records.handle(finish(7, 'precision-180', 7, 'revised'));
  none('another handling mode\'s result');
  for (const bad of [0, -1, NaN, Infinity, '7', undefined]) {
    records.handle(start(8, 'precision-180')); records.handle({ type: 'challenge', challengeId: 'precision-180', runId: 8, handling: 'classic', completed: true, value: bad });
    none(`a time of ${bad}`);
  }
  for (const bad of [-1, 1.5, NaN, '900']) {
    records.handle(start(9, 'linked-drift')); records.handle({ type: 'challenge', challengeId: 'linked-drift', runId: 9, handling: 'classic', completed: true, value: bad });
    assert.equal(records.bestFor('linked-drift', 'classic'), null, `a score of ${bad}`);
  }
  // Sessions that are not gymkhana ones, and things that are not challenges.
  records.handle({ type: 'start', trackId: 'original', runId: 10, mode: 'normal', handling: 'classic' });
  records.handle(finish(10, 'precision-180', 7));
  none('a circuit run');
  records.handle({ type: 'start', trackId: 'practice-pad', runId: 11, mode: 'practice', handling: 'classic' });
  records.handle(finish(11, 'precision-180', 7));
  none('the practice pad');
  records.handle(start(12, 'original')); records.handle(finish(12, 'original', 7));
  records.handle(start(13, 'precision-180', 'tuned')); records.handle(finish(13, 'precision-180', 7, 'tuned'));
  none('an unknown challenge or mode');
  // A run settles once.
  records.handle(start(14, 'precision-180')); records.handle(finish(14, 'precision-180', 9));
  assert.equal(records.bestFor('precision-180', 'classic'), 9);
  records.handle(finish(14, 'precision-180', 8));
  assert.equal(records.bestFor('precision-180', 'classic'), 9, 'a second result for the same run is ignored');
  assert.equal(storage.writes.length, 1);
});

test('NEW BEST belongs to the run just driven, and is cleared by the next start', () => {
  const storage = memory();
  const records = createGymkhanaRecords(() => storage);
  records.handle(start(1, 'precision-180')); records.handle(finish(1, 'precision-180', 8));
  assert.equal(records.newBest, true);
  records.handle(start(2, 'precision-180'));
  assert.equal(records.newBest, false);
  records.handle(finish(2, 'precision-180', 8.4));
  assert.equal(records.newBest, false);
  records.handle({ type: 'abandon' });
  assert.equal(records.newBest, false);
});

test('storage that fails: no record and no NEW BEST without a successful write', () => {
  const none = createGymkhanaRecords(() => { throw new Error('denied'); });
  assert.equal(none.available, false);
  none.handle(start(1, 'precision-180')); none.handle(finish(1, 'precision-180', 8));
  assert.equal(none.bestFor('precision-180', 'classic'), null);
  assert.equal(none.newBest, false);

  const storage = memory();
  let failing = true;
  const flaky = { getItem: storage.getItem, setItem: (k, v) => { if (failing) throw new Error('quota'); storage.setItem(k, v); } };
  const records = createGymkhanaRecords(() => flaky);
  records.handle(start(1, 'precision-180')); records.handle(finish(1, 'precision-180', 8));
  assert.equal(records.available, false);
  assert.equal(records.bestFor('precision-180', 'classic'), null, 'an unsaved time is not a record');
  assert.equal(records.newBest, false);
  failing = false;
  records.handle(start(2, 'precision-180')); records.handle(finish(2, 'precision-180', 8.2));
  assert.equal(records.available, true);
  assert.equal(records.bestFor('precision-180', 'classic'), 8.2);
  assert.equal(records.newBest, true);
});

test('another tab\'s better record is kept: the key is re-read before every write', () => {
  const storage = memory();
  const a = createGymkhanaRecords(() => storage);
  const b = createGymkhanaRecords(() => storage);
  a.handle(start(1, 'precision-180')); a.handle(finish(1, 'precision-180', 7.5));
  b.handle(start(1, 'linked-drift')); b.handle(finish(1, 'linked-drift', 800));
  assert.equal(saved(storage).challenges['precision-180'].classic['precision-180-1'].best, 7.5, 'b\'s write kept a\'s record');
  b.handle(start(2, 'precision-180')); b.handle(finish(2, 'precision-180', 7.9));
  assert.equal(b.newBest, false, 'slower than what the other tab saved');
  assert.equal(b.bestFor('precision-180', 'classic'), 7.5);
});

test('corrupt data is replaced by the next write; a later schema is never written', () => {
  for (const raw of ['{', 'null', '[]', '"x"', '{"version":0}', '{"version":"1"}', '{"challenges":{}}']) {
    assert.equal(readGymkhanaStore(raw).status, 'corrupt', raw);
    const storage = memory({ [GYMKHANA_RECORDS_KEY]: raw });
    const records = createGymkhanaRecords(() => storage);
    assert.equal(records.bestFor('precision-180', 'classic'), null);
    records.handle(start(1, 'precision-180')); records.handle(finish(1, 'precision-180', 8));
    assert.deepEqual(saved(storage), { version: 1, challenges: { 'precision-180': { classic: { 'precision-180-1': { best: 8 } } } } }, raw);
  }
  const later = JSON.stringify({ version: 2, challenges: { 'precision-180': { classic: { 'precision-180-1': { best: 1 } } } } });
  assert.equal(readGymkhanaStore(later).status, 'unsupported');
  const storage = memory({ [GYMKHANA_RECORDS_KEY]: later });
  const records = createGymkhanaRecords(() => storage);
  assert.equal(records.readOnly, true);
  assert.equal(records.bestFor('precision-180', 'classic'), null, 'nothing is guessed from a later schema');
  records.handle(start(1, 'precision-180')); records.handle(finish(1, 'precision-180', 8));
  assert.equal(records.newBest, false);
  assert.equal(storage.getItem(GYMKHANA_RECORDS_KEY), later, 'left exactly as it was');
  assert.deepEqual(storage.writes, []);
});

test('bad saved values read as no record; unknown challenges, modes, rules and fields are carried through', () => {
  const raw = JSON.stringify({
    version: 1,
    note: 'kept',
    challenges: {
      'precision-180': {
        classic: { 'precision-180-1': { best: -3, set: 'kept' }, 'precision-180-0': { best: 6.1 } },
        revised: { 'precision-180-1': { best: '7' } },
        tuned: { 'precision-180-1': { best: 6.9 } },
      },
      'linked-drift': { classic: { 'linked-drift-1+scoring-1': { best: 5000 }, [`linked-drift-1+${SCORING_VERSION}`]: { best: 12.5 } } },
      slalom: { classic: { 'slalom-1': { best: 20 } } },
    },
  });
  const storage = memory({ [GYMKHANA_RECORDS_KEY]: raw });
  const records = createGymkhanaRecords(() => storage);
  assert.equal(records.bestFor('precision-180', 'classic'), null, 'a negative time');
  assert.equal(records.bestFor('precision-180', 'revised'), null, 'a string');
  assert.equal(records.bestFor('linked-drift', 'classic'), null, 'a fractional score; the earlier scoring\'s record is not shown');
  records.handle(start(1, 'precision-180')); records.handle(finish(1, 'precision-180', 8.25));
  assert.equal(records.newBest, true);
  const after = saved(storage);
  const before = JSON.parse(raw);
  before.challenges['precision-180'].classic['precision-180-1'] = { best: 8.25, set: 'kept' };
  assert.deepEqual(after, before, 'only the one record changed');
});

test('the table and the serializer are pure', () => {
  const store = readGymkhanaStore(JSON.stringify({ version: 1, challenges: { 'one-drift': { revised: { [recordRules(ONE_DRIFT)]: { best: 410 } } } } }));
  const copy = structuredClone(store);
  const table = gymkhanaTable(store);
  assert.equal(table['one-drift'].revised, 410);
  assert.equal(table['one-drift'].classic, null);
  const out = serializeGymkhana(store, PRECISION_180, 'classic', 7.7);
  assert.deepEqual(store, copy, 'the inputs are not changed');
  assert.equal(out.challenges['one-drift'].revised[recordRules(ONE_DRIFT)].best, 410);
  assert.equal(out.challenges['precision-180'].classic['precision-180-1'].best, 7.7);
  assert.deepEqual(gymkhanaTable(readGymkhanaStore(null)), gymkhanaTable(readGymkhanaStore('junk')));
});

// --- With the real session -------------------------------------------------------------------
function session(storage) {
  const circuit = createRecords(() => storage);
  const records = createGymkhanaRecords(() => storage);
  const game = createGame(undefined, { handling: classic, onRunEvent: (e) => { circuit.handle(e); records.handle(e); } });
  const run = (def, driver, handling = classic) => {
    startRun(game, { mode: 'gymkhana', challenge: def, handling });
    for (let i = 0; i < 60 / TUNING.simStep && game.state !== 'finished'; i += 1) tick(game, driver(game));
    return game.challenge;
  };
  return { game, circuit, records, run };
}

test('driven for real: a completed challenge saves its value, and only under the gymkhana key', () => {
  const storage = memory();
  const { records, circuit, run } = session(storage);
  const first = run(PRECISION_180, slower());
  assert.equal(first.phase, 'complete');
  assert.equal(records.newBest, true);
  assert.equal(records.bestFor('precision-180', 'classic'), first.result.total);
  const quick = run(PRECISION_180, tidy());
  assert.ok(quick.result.total < first.result.total);
  assert.equal(records.newBest, true);
  assert.equal(records.bestFor('precision-180', 'classic'), quick.result.total);
  const again = run(PRECISION_180, slower());
  assert.equal(records.newBest, false, 'a slower run after a quicker one');
  assert.equal(again.result.total, first.result.total, 'and it was the same drive as the first');
  const failed = run(PRECISION_180, D.handbrake180({ triggerX: 8, release: 110 * DEG }));
  assert.equal(failed.phase, 'failed');
  assert.equal(records.newBest, false);
  assert.equal(records.bestFor('precision-180', 'classic'), quick.result.total);

  const linked = run(LINKED_DRIFT, drifter(), power);
  assert.equal(linked.phase, 'complete');
  assert.equal(records.bestFor('linked-drift', 'revised'), linked.result.score);
  assert.equal(records.bestFor('linked-drift', 'classic'), null);
  const missed = run(LINKED_DRIFT, () => KEYS({ up: true }), power);
  assert.equal(missed.phase, 'failed');
  assert.equal(records.bestFor('linked-drift', 'revised'), linked.result.score);

  assert.deepEqual([...new Set(storage.writes)], [GYMKHANA_RECORDS_KEY], 'the circuit records key was never written');
  assert.deepEqual(circuit.newBests, { score: false, fastestLap: false, bestCombo: false });
  assert.deepEqual(circuit.forTrack('original', 'classic'), { score: null, fastestLap: null, bestCombo: null });
});

test('driven for real: restarting or leaving mid-run saves nothing, and a circuit run never sets a gymkhana record', () => {
  const storage = memory();
  const { game, records } = session(storage);
  startRun(game, { mode: 'gymkhana', challenge: PRECISION_180 });
  const driver = tidy();
  for (let i = 0; i < 3 / TUNING.simStep; i += 1) tick(game, driver(game));
  restartRun(game, { ghost: false, mode: 'gymkhana' });
  for (let i = 0; i < 3 / TUNING.simStep; i += 1) tick(game, KEYS({ up: true }));
  returnToMenu(game);
  assert.deepEqual(storage.writes, []);
  // A three-lap circuit run's own events are not challenge results.
  startRun(game, {});
  for (let i = 0; i < 20 / TUNING.simStep; i += 1) tick(game, KEYS({ up: true }));
  returnToMenu(game);
  assert.equal(storage.getItem(GYMKHANA_RECORDS_KEY), null);
  for (const def of GYMKHANA_CHALLENGES) assert.equal(records.bestFor(def.id, 'classic'), null);
});
