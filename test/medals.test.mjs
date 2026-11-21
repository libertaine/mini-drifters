// Gymkhana medals (src/medals.js): worked out from a result, never stored. Boundaries, handling
// separation, precision, and that medals come from the saved records of every version since
// v0.4.0 without anything being written.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { PRECISION_180, LINKED_DRIFT, ONE_DRIFT, SLALOM_SPRINT, GYMKHANA_CHALLENGES } from '../src/gymkhana.js';
import { HANDLING_IDS } from '../src/handling.js';
import { SCORING_VERSION } from '../src/scoring.js';
import { createGymkhanaRecords, GYMKHANA_RECORDS_KEY, recordRules } from '../src/gymkhana-records.js';
import { RECORDS_KEY } from '../src/records.js';
import {
  MEDALS, MEDAL_TARGETS, formatMedalTime, formatMedalValue, medalFor, medalRank,
  medalTargets, meets, missedTargetBy, needsMillisecondDisplay, nextMedal,
} from '../src/medals.js';

function memory(initial = {}, { failWrites = false } = {}) {
  const stored = new Map(Object.entries(initial));
  const writes = [];
  return {
    stored, writes,
    getItem: (k) => stored.get(k) ?? null,
    setItem: (k, v) => { if (failWrites) throw new Error('QuotaExceededError'); writes.push(k); stored.set(k, String(v)); },
    removeItem: (k) => stored.delete(k),
  };
}
const start = (runId, challengeId, handling = 'classic') => ({ type: 'start', trackId: 'x', runId, mode: 'gymkhana', handling, challengeId });
const finish = (runId, challengeId, value, handling = 'classic') => ({ type: 'challenge', challengeId, runId, handling, completed: value !== null, value });
const drive = (records, runId, def, value, handling = 'classic') => { records.handle(start(runId, def.id, handling)); records.handle(finish(runId, def.id, value, handling)); };

// A store exactly as v0.4.0, v0.5.0 and v0.6.0 write it (gymkhana-records.js schema 1, unchanged
// across all three: `git show v0.4.0:src/gymkhana-records.js`). v0.4.0 had no Slalom Sprint.
const v1Store = (bests) => JSON.stringify({ version: 1, challenges: bests });

// --- The table -------------------------------------------------------------------------------
test('every challenge has targets in every handling mode, filed under its current record rules', () => {
  assert.deepEqual(Object.keys(MEDAL_TARGETS).sort(), GYMKHANA_CHALLENGES.map((d) => d.id).sort());
  for (const def of GYMKHANA_CHALLENGES) {
    assert.deepEqual(Object.keys(MEDAL_TARGETS[def.id]), [recordRules(def)], `${def.id} is filed as its records are`);
    for (const h of HANDLING_IDS) {
      const t = medalTargets(def, h);
      assert.ok(t, `${def.id} ${h} has targets`);
      for (const m of MEDALS) assert.ok(Number.isFinite(t[m]) && t[m] > 0, `${def.id} ${h} ${m} is a number`);
      // Bronze easiest, Gold hardest, in the challenge's own direction.
      if (def.kind === 'time') assert.ok(t.gold < t.silver && t.silver < t.bronze, `${def.id} ${h}: lower is harder`);
      else assert.ok(t.gold > t.silver && t.silver > t.bronze, `${def.id} ${h}: higher is harder`);
    }
  }
  assert.ok(Object.isFrozen(MEDAL_TARGETS) && Object.isFrozen(MEDAL_TARGETS['linked-drift']['linked-drift-1+scoring-2'].classic));
});

test('the owner-approved v0.7.0 R1 targets match the frozen table', () => {
  // Originated in R0 report section B2 (plus R1's 1-point Bronze for score challenges) and
  // approved unchanged after owner human playtesting for v0.7.0 R1.
  const want = {
    'precision-180': { classic: [7.6, 8.3, 30], revised: [7.6, 8.3, 30] },
    'linked-drift': { classic: [850, 450, 1], revised: [950, 450, 1] },
    'one-drift': { classic: [800, 400, 1], revised: [850, 400, 1] },
    'slalom-sprint': { classic: [14.8, 18.5, 40], revised: [14.8, 18.5, 40] },
  };
  for (const def of GYMKHANA_CHALLENGES) for (const h of HANDLING_IDS) {
    const t = medalTargets(def, h);
    assert.deepEqual([t.gold, t.silver, t.bronze], want[def.id][h], `${def.id} ${h}`);
  }
  assert.equal(medalTargets(PRECISION_180, 'classic').bronze, PRECISION_180.geometry.timeLimit, 'P180 Bronze is its time limit');
  assert.equal(medalTargets(SLALOM_SPRINT, 'classic').bronze, SLALOM_SPRINT.geometry.timeLimit, 'Slalom Bronze is its time limit');
});

// --- Boundaries ------------------------------------------------------------------------------
test('time boundaries: no record, below Bronze, exactly each target, between, and better than Gold', () => {
  for (const h of HANDLING_IDS) {
    const t = medalTargets(PRECISION_180, h);
    const at = (v) => medalFor(PRECISION_180, h, v);
    assert.equal(at(null), null, 'no record');
    assert.equal(at(undefined), null);
    assert.equal(at(31.5), null, 'completed, but slower than Bronze (penalties can take a finished run past 30 s)');
    assert.equal(at(t.bronze), 'bronze', 'exactly Bronze');
    assert.equal(at(t.bronze + 0.001), null, 'a millisecond slower');
    assert.equal(at(12), 'bronze', 'between Bronze and Silver');
    assert.equal(at(t.silver), 'silver', 'exactly Silver');
    assert.equal(at(t.silver + 0.001), 'bronze');
    assert.equal(at(8), 'silver', 'between Silver and Gold');
    assert.equal(at(t.gold), 'gold', 'exactly Gold');
    assert.equal(at(t.gold + 0.001), 'silver', 'a millisecond off Gold');
    assert.equal(at(7.1), 'gold', 'better than Gold');
  }
  assert.equal(medalFor(SLALOM_SPRINT, 'classic', 14.8), 'gold');
  assert.equal(medalFor(SLALOM_SPRINT, 'classic', 14.801), 'silver');
  assert.equal(medalFor(SLALOM_SPRINT, 'revised', 18.5), 'silver');
  assert.equal(medalFor(SLALOM_SPRINT, 'revised', 40), 'bronze');
  assert.equal(medalFor(SLALOM_SPRINT, 'revised', 40.001), null);
});

test('score boundaries: no record, zero, exactly each target, between, and better than Gold', () => {
  for (const def of [LINKED_DRIFT, ONE_DRIFT]) for (const h of HANDLING_IDS) {
    const t = medalTargets(def, h);
    const at = (v) => medalFor(def, h, v);
    assert.equal(at(null), null, 'no record');
    assert.equal(at(0), null, 'a completed run that scored nothing is a record, not a medal');
    assert.equal(at(t.bronze), 'bronze', 'exactly Bronze');
    assert.equal(at(t.silver - 1), 'bronze', 'between Bronze and Silver');
    assert.equal(at(t.silver), 'silver', 'exactly Silver');
    assert.equal(at(t.gold - 1), 'silver', 'between Silver and Gold');
    assert.equal(at(t.gold), 'gold', 'exactly Gold');
    assert.equal(at(t.gold + 500), 'gold', 'better than Gold');
  }
});

test('Classic and Power are judged separately', () => {
  // Linked Drift: 900 is Gold in Classic (850) but Silver in Power (950).
  assert.equal(medalFor(LINKED_DRIFT, 'classic', 900), 'gold');
  assert.equal(medalFor(LINKED_DRIFT, 'revised', 900), 'silver');
  // One Drift: 820 is Gold in Classic (800) but Silver in Power (850).
  assert.equal(medalFor(ONE_DRIFT, 'classic', 820), 'gold');
  assert.equal(medalFor(ONE_DRIFT, 'revised', 820), 'silver');
  // A handling mode the game does not have, or a retired one, has no targets and no medal.
  assert.equal(medalTargets(LINKED_DRIFT, 'tuned'), null);
  assert.equal(medalFor(LINKED_DRIFT, 'tuned', 5000), null);
  assert.equal(medalFor(PRECISION_180, 'nonsense', 7), null);
});

test('precision: times are compared to the millisecond a record is saved at, scores in whole points', () => {
  // Float sums that land a hair either side of a target still compare at the saved precision.
  assert.equal(medalFor(PRECISION_180, 'classic', 7.1 + 0.5), 'gold', '7.6000000000000005 is 7.600');
  assert.equal(medalFor(PRECISION_180, 'classic', 7.6004), 'gold', 'rounds to 7.600');
  assert.equal(medalFor(PRECISION_180, 'classic', 7.6006), 'silver', 'rounds to 7.601');
  assert.equal(medalFor(SLALOM_SPRINT, 'classic', 0.1 + 0.2 + 14.5 - 0.000000001), 'gold');
  assert.equal(meets(LINKED_DRIFT, 849.6, 850), true, 'a score is whole points');
  assert.equal(meets(LINKED_DRIFT, 849.4, 850), false);
  // Values no record could hold earn nothing.
  for (const bad of [NaN, Infinity, -1, 0, '7.5']) assert.equal(medalFor(PRECISION_180, 'classic', bad), null, String(bad));
  for (const bad of [NaN, -Infinity, -5, '900']) assert.equal(medalFor(LINKED_DRIFT, 'classic', bad), null, String(bad));
});

test('timed display precision: near-boundary results and targets show three decimal places without misleading', () => {
  // Targets always format to three decimal places.
  assert.equal(formatMedalTime(7.6), '7.600 s');
  assert.equal(formatMedalTime(8.3), '8.300 s');
  assert.equal(formatMedalTime(30), '30.000 s');
  assert.equal(formatMedalTime(14.8), '14.800 s');
  assert.equal(formatMedalTime(18.5), '18.500 s');
  assert.equal(formatMedalTime(40), '40.000 s');

  // Precision 180 Gold boundary: 7.599, 7.600, 7.601, 7.604 (plus 7.605 IEEE 754 edge and 7.610).
  for (const h of HANDLING_IDS) {
    const cases = [
      [7.599, 'gold', '7.599 s', null, null],
      [7.600, 'gold', '7.600 s', null, null],
      [7.601, 'silver', '7.601 s', 'gold', 0.001],
      [7.604, 'silver', '7.604 s', 'gold', 0.004],
      [7.605, 'silver', '7.605 s', 'gold', 0.005],
      [7.609, 'silver', '7.609 s', 'gold', 0.009],
      [7.610, 'silver', '7.61 s', 'gold', null],
      // Silver boundary (8.300 s)
      [8.299, 'silver', '8.299 s', 'gold', null],
      [8.300, 'silver', '8.300 s', 'gold', null],
      [8.301, 'bronze', '8.301 s', 'silver', 0.001],
      [8.304, 'bronze', '8.304 s', 'silver', 0.004],
      // Bronze boundary (30.000 s)
      [29.999, 'bronze', '29.999 s', 'silver', null],
      [30.000, 'bronze', '30.000 s', 'silver', null],
      [30.001, null, '30.001 s', 'bronze', 0.001],
      [30.004, null, '30.004 s', 'bronze', 0.004],
    ];
    for (const [value, wantMedal, wantText, wantNext, wantGap] of cases) {
      assert.equal(medalFor(PRECISION_180, h, value), wantMedal, `P180 ${h} ${value} medal`);
      assert.equal(formatMedalValue(PRECISION_180, h, value), wantText, `P180 ${h} ${value} text`);
      const next = nextMedal(PRECISION_180, h, value);
      assert.equal(next?.medal ?? null, wantNext, `P180 ${h} ${value} next`);
      if (next) assert.equal(missedTargetBy(PRECISION_180, value, next.target), wantGap, `P180 ${h} ${value} gap`);
    }
  }

  // Slalom Sprint Gold (14.800 s), Silver (18.500 s), and Bronze (40.000 s) boundaries.
  for (const h of HANDLING_IDS) {
    const cases = [
      [14.799, 'gold', '14.799 s', null, null],
      [14.800, 'gold', '14.800 s', null, null],
      [14.801, 'silver', '14.801 s', 'gold', 0.001],
      [14.804, 'silver', '14.804 s', 'gold', 0.004],
      [18.499, 'silver', '18.499 s', 'gold', null],
      [18.500, 'silver', '18.500 s', 'gold', null],
      [18.501, 'bronze', '18.501 s', 'silver', 0.001],
      [18.504, 'bronze', '18.504 s', 'silver', 0.004],
      [39.999, 'bronze', '39.999 s', 'silver', null],
      [40.000, 'bronze', '40.000 s', 'silver', null],
      [40.001, null, '40.001 s', 'bronze', 0.001],
      [40.004, null, '40.004 s', 'bronze', 0.004],
    ];
    for (const [value, wantMedal, wantText, wantNext, wantGap] of cases) {
      assert.equal(medalFor(SLALOM_SPRINT, h, value), wantMedal, `Slalom ${h} ${value} medal`);
      assert.equal(formatMedalValue(SLALOM_SPRINT, h, value), wantText, `Slalom ${h} ${value} text`);
      const next = nextMedal(SLALOM_SPRINT, h, value);
      assert.equal(next?.medal ?? null, wantNext, `Slalom ${h} ${value} next`);
      if (next) assert.equal(missedTargetBy(SLALOM_SPRINT, value, next.target), wantGap, `Slalom ${h} ${value} gap`);
    }
  }

  // Display rounding agrees with meets() at sub-millisecond edges.
  assert.equal(medalFor(PRECISION_180, 'classic', 7.6004), 'gold');
  assert.equal(formatMedalValue(PRECISION_180, 'classic', 7.6004), '7.600 s');
  assert.equal(medalFor(PRECISION_180, 'classic', 7.6005), 'silver');
  assert.equal(formatMedalValue(PRECISION_180, 'classic', 7.6005), '7.601 s');
  assert.equal(missedTargetBy(PRECISION_180, 7.6005, 7.6), 0.001);
  assert.equal(medalFor(PRECISION_180, 'classic', 7.6006), 'silver');
  assert.equal(formatMedalValue(PRECISION_180, 'classic', 7.6006), '7.601 s');
  assert.equal(missedTargetBy(PRECISION_180, 7.6006, 7.6), 0.001);

  // Away from target boundaries, timed results stay hundredths; scores and nulls are unaffected.
  assert.equal(needsMillisecondDisplay(PRECISION_180, 'classic', 7.358), false);
  assert.equal(formatMedalValue(PRECISION_180, 'classic', 7.358), '7.36 s');
  assert.equal(formatMedalValue(PRECISION_180, 'classic', 6.543), '6.54 s');
  assert.equal(formatMedalValue(PRECISION_180, 'classic', 8.1), '8.10 s');
  assert.equal(formatMedalValue(SLALOM_SPRINT, 'classic', 13.524), '13.52 s');
  assert.equal(formatMedalValue(PRECISION_180, 'classic', null), '--');
  assert.equal(needsMillisecondDisplay(LINKED_DRIFT, 'classic', 850), false);
  assert.equal(formatMedalValue(LINKED_DRIFT, 'classic', 1240), '1,240');
  assert.equal(missedTargetBy(LINKED_DRIFT, 849, 850), null);
});

test('millisecond boundary records keep exact storage precision and qualify properly', () => {
  const storage = memory();
  const records = createGymkhanaRecords(() => storage);
  drive(records, 1, PRECISION_180, 7.604);
  assert.equal(records.bestFor(PRECISION_180.id, 'classic'), 7.604, 'saved to exact millisecond, not rounded');
  assert.equal(JSON.parse(storage.getItem(GYMKHANA_RECORDS_KEY)).challenges['precision-180'].classic['precision-180-1'].best, 7.604);
  assert.equal(medalFor(PRECISION_180, 'classic', records.bestFor(PRECISION_180.id, 'classic')), 'silver');
  assert.equal(formatMedalValue(PRECISION_180, 'classic', records.bestFor(PRECISION_180.id, 'classic')), '7.604 s');
  drive(records, 2, PRECISION_180, 7.600);
  assert.equal(records.newBest, true);
  assert.equal(records.previousBest, 7.604);
  assert.equal(records.bestFor(PRECISION_180.id, 'classic'), 7.6);
  assert.equal(medalFor(PRECISION_180, 'classic', records.bestFor(PRECISION_180.id, 'classic')), 'gold');
  assert.ok(medalRank(medalFor(PRECISION_180, 'classic', 7.6)) > medalRank(medalFor(PRECISION_180, 'classic', records.previousBest)));
});

test('a Gold result holds all three, and the next medal is always the one directly above', () => {
  assert.ok(medalRank('gold') > medalRank('silver') && medalRank('silver') > medalRank('bronze') && medalRank('bronze') > medalRank(null));
  assert.deepEqual(nextMedal(PRECISION_180, 'classic', null), { medal: 'bronze', target: 30 });
  assert.deepEqual(nextMedal(PRECISION_180, 'classic', 31), { medal: 'bronze', target: 30 });
  assert.deepEqual(nextMedal(PRECISION_180, 'classic', 12), { medal: 'silver', target: 8.3 });
  assert.deepEqual(nextMedal(PRECISION_180, 'classic', 8), { medal: 'gold', target: 7.6 });
  assert.equal(nextMedal(PRECISION_180, 'classic', 7.2), null, 'Gold held');
  assert.deepEqual(nextMedal(LINKED_DRIFT, 'revised', 900), { medal: 'gold', target: 950 });
  assert.equal(nextMedal(LINKED_DRIFT, 'tuned', 900), null, 'no targets, no next medal');
});

test('rules the table does not know earn no medal, so a change of rules or scoring starts medals afresh', () => {
  const changedRules = { ...PRECISION_180, rules: 'precision-180-2' };
  assert.equal(medalTargets(changedRules, 'classic'), null);
  assert.equal(medalFor(changedRules, 'classic', 7), null);
  assert.equal(recordRules(LINKED_DRIFT), `linked-drift-1+${SCORING_VERSION}`);
  assert.equal(medalFor({ ...LINKED_DRIFT, id: 'not-a-challenge' }, 'classic', 5000), null);
});

// --- Records: retroactive, read-only, never written --------------------------------------------
test('records saved by v0.4.0, v0.5.0 and v0.6.0 earn their medals on load, and nothing is written', () => {
  const v040 = v1Store({
    'precision-180': { classic: { 'precision-180-1': { best: 7.45 } }, revised: { 'precision-180-1': { best: 9.2 } } },
    'linked-drift': { classic: { 'linked-drift-1+scoring-2': { best: 900 } }, revised: { 'linked-drift-1+scoring-2': { best: 900 } } },
    'one-drift': { classic: { 'one-drift-1+scoring-2': { best: 0 } } },
  });
  const v060 = v1Store({
    'precision-180': { classic: { 'precision-180-1': { best: 7.45 } } },
    'slalom-sprint': { revised: { 'slalom-sprint-1': { best: 18.5 } } },
  });
  for (const raw of [v040, v060]) {
    const storage = memory({ [GYMKHANA_RECORDS_KEY]: raw });
    const records = createGymkhanaRecords(() => storage);
    const medal = (def, h) => medalFor(def, h, records.bestFor(def.id, h));
    assert.equal(medal(PRECISION_180, 'classic'), 'gold', 'an old 7.45 s is Gold at once');
    if (raw === v040) {
      assert.equal(medal(PRECISION_180, 'revised'), 'bronze');
      assert.equal(medal(LINKED_DRIFT, 'classic'), 'gold');
      assert.equal(medal(LINKED_DRIFT, 'revised'), 'silver', 'the same score, judged by its own mode');
      assert.equal(medal(ONE_DRIFT, 'classic'), null, 'a 0-point record stays a record, with no medal');
      assert.equal(records.bestFor(ONE_DRIFT.id, 'classic'), 0);
      assert.equal(medal(SLALOM_SPRINT, 'classic'), null, 'v0.4.0 had no Slalom Sprint');
    } else {
      assert.equal(medal(SLALOM_SPRINT, 'revised'), 'silver', 'exactly the Silver time');
    }
    assert.deepEqual(storage.writes, [], 'loading never writes');
    assert.equal(storage.getItem(GYMKHANA_RECORDS_KEY), raw, 'the saved records are byte for byte as they were');
  }
});

test('the v0.5.0 fixture loads unchanged and its circuit records are never touched', () => {
  const fixture = readFileSync(new URL('./fixtures/records-v0.5.0.json', import.meta.url), 'utf8');
  const storage = memory({ [RECORDS_KEY]: fixture });
  const records = createGymkhanaRecords(() => storage);
  for (const def of GYMKHANA_CHALLENGES) for (const h of HANDLING_IDS) assert.equal(medalFor(def, h, records.bestFor(def.id, h)), null);
  assert.deepEqual(storage.writes, []);
  assert.equal(storage.getItem(RECORDS_KEY), fixture);
});

test('a worse run never takes a medal away, and a better one moves it up', () => {
  const storage = memory();
  const records = createGymkhanaRecords(() => storage);
  drive(records, 1, PRECISION_180, 8.1);
  assert.equal(medalFor(PRECISION_180, 'classic', records.bestFor(PRECISION_180.id, 'classic')), 'silver');
  assert.equal(records.newBest, true);
  assert.equal(records.previousBest, null, 'the first record replaced nothing');
  drive(records, 2, PRECISION_180, 12.4);
  assert.equal(records.newBest, false);
  assert.equal(records.previousBest, null, 'no NEW BEST, so nothing was replaced');
  assert.equal(medalFor(PRECISION_180, 'classic', records.bestFor(PRECISION_180.id, 'classic')), 'silver', 'still Silver');
  drive(records, 3, PRECISION_180, 7.5);
  assert.equal(records.newBest, true);
  assert.equal(records.previousBest, 8.1, 'what the NEW BEST replaced');
  assert.equal(medalFor(PRECISION_180, 'classic', records.bestFor(PRECISION_180.id, 'classic')), 'gold');
  // A failed run is not a result: no record, no medal, previous best untouched.
  drive(records, 4, PRECISION_180, null);
  assert.equal(records.newBest, false);
  assert.equal(records.bestFor(PRECISION_180.id, 'classic'), 7.5);
});

test('a medal already held is not new: previousBest says what the saved record held', () => {
  const storage = memory({ [GYMKHANA_RECORDS_KEY]: v1Store({ 'precision-180': { classic: { 'precision-180-1': { best: 7.55 } } } }) });
  const records = createGymkhanaRecords(() => storage);
  drive(records, 1, PRECISION_180, 7.4);
  assert.equal(records.newBest, true);
  assert.equal(medalRank(medalFor(PRECISION_180, 'classic', 7.4)) > medalRank(medalFor(PRECISION_180, 'classic', records.previousBest)), false,
    'Gold improved to a faster Gold is a NEW BEST, not a new medal');
});

test('storage that fails: no saved medal is ever claimed', () => {
  // Writes that throw (quota, privacy mode).
  const failing = memory({}, { failWrites: true });
  const records = createGymkhanaRecords(() => failing);
  drive(records, 1, PRECISION_180, 7.3);
  assert.equal(records.newBest, false, 'no NEW BEST without a successful write');
  assert.equal(records.previousBest, null);
  assert.equal(records.available, false);
  assert.equal(records.bestFor(PRECISION_180.id, 'classic'), null, 'so no saved best, and no saved medal');
  assert.equal(failing.getItem(GYMKHANA_RECORDS_KEY), null);
  // No storage at all.
  const none = createGymkhanaRecords(() => { throw new Error('SecurityError'); });
  drive(none, 1, LINKED_DRIFT, 2000);
  assert.equal(none.available, false);
  assert.equal(none.newBest, false);
  assert.equal(medalFor(LINKED_DRIFT, 'classic', none.bestFor(LINKED_DRIFT.id, 'classic')), null);
});

test('corrupt, shapeless and later-schema stores show no medal; a later schema is never written', () => {
  for (const raw of ['{not json', '[]', 'null', '42', JSON.stringify({ version: 1, challenges: { 'precision-180': { classic: { 'precision-180-1': { best: 'fast' } } } } })]) {
    const storage = memory({ [GYMKHANA_RECORDS_KEY]: raw });
    const records = createGymkhanaRecords(() => storage);
    for (const def of GYMKHANA_CHALLENGES) for (const h of HANDLING_IDS) assert.equal(medalFor(def, h, records.bestFor(def.id, h)), null, raw);
    assert.deepEqual(storage.writes, [], 'loading never writes');
  }
  const later = JSON.stringify({ version: 2, challenges: { 'precision-180': { classic: { 'precision-180-1': { best: 7.0 } } } } });
  const storage = memory({ [GYMKHANA_RECORDS_KEY]: later });
  const records = createGymkhanaRecords(() => storage);
  assert.equal(records.readOnly, true);
  assert.equal(medalFor(PRECISION_180, 'classic', records.bestFor(PRECISION_180.id, 'classic')), null, 'nothing is shown from a later schema');
  drive(records, 1, PRECISION_180, 7.2);
  assert.equal(records.newBest, false);
  assert.deepEqual(storage.writes, []);
  assert.equal(storage.getItem(GYMKHANA_RECORDS_KEY), later, 'left strictly alone');
});

test('medals.js never touches storage', () => {
  const source = readFileSync(new URL('../src/medals.js', import.meta.url), 'utf8');
  assert.doesNotMatch(source, /localStorage|getItem|setItem|sessionStorage|indexedDB/);
});

// --- Gameplay isolation: R1 adds medals and changes no challenge -------------------------------
test('the four challenges keep their v0.6.0 ids, rules, geometry and penalties', () => {
  assert.deepEqual(GYMKHANA_CHALLENGES.map((d) => [d.id, d.rules, d.kind]), [
    ['precision-180', 'precision-180-1', 'time'], ['linked-drift', 'linked-drift-1', 'score'],
    ['one-drift', 'one-drift-1', 'score'], ['slalom-sprint', 'slalom-sprint-1', 'time']]);
  const P = PRECISION_180.geometry;
  assert.deepEqual({ ...P.box }, { minX: 0, maxX: 30, minY: -7, maxY: 7 });
  assert.deepEqual([P.zoneFrom, P.conePenalty, P.timeLimit, P.gate.cx, P.gate.cy], [16, 2, 30, -14, 0]);
  assert.equal(Math.hypot(P.gate.x2 - P.gate.x1, P.gate.y2 - P.gate.y1), 8, 'the gate is 8 m wide');
  assert.equal(P.cones.length, 7);
  const L = LINKED_DRIFT.geometry;
  assert.deepEqual([L.corridor, L.gateHalf, L.gateMissMargin, L.timeLimit, L.gates.length], [10, 8, 10, 60, 6]);
  assert.equal(ONE_DRIFT.geometry, LINKED_DRIFT.geometry, 'One Drift is driven on the Linked Drift course');
  const S = SLALOM_SPRINT.geometry;
  assert.deepEqual([S.count, S.spacing, S.runUp, S.runOut, S.lane, S.finishHalf, S.firstSide, S.conePenalty, S.timeLimit],
    [7, 22, 36, 30, 12, 4, -1, 2, 40]);
});
