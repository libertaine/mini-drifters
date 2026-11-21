// Getaway's own personal bests (src/getaway-records.js): what qualifies, how a record is filed per
// mission, environment and handling mode, how the medal follows the saved best, how damaged or
// refused storage is survived, and that nothing else the game saves is touched. Runs are driven
// through the real session (game.js) on the production mission's environments, and storage is an
// injected in-memory object: no test reads or writes real browser data.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { TUNING } from '../src/tuning.js';
import { createGame, startRun, restartRun, returnToMenu, tick } from '../src/game.js';
import { handlingById, HANDLING_IDS } from '../src/handling.js';
import { SCORING_VERSION } from '../src/scoring.js';
import { createRecords, RECORDS_KEY } from '../src/records.js';
import { createGymkhanaRecords, GYMKHANA_RECORDS_KEY } from '../src/gymkhana-records.js';
import { createGhostStore, GHOST_STORE_KEY } from '../src/ghost-store.js';
import { createReferenceGhosts } from '../src/reference-ghost.js';
import { GHOST_PREFERENCE_KEY } from '../src/ghost-preferences.js';
import { HANDLING_PREFERENCE_KEY } from '../src/handling-preferences.js';
import { GETAWAY_MISSIONS } from '../src/getaway-missions.js';
import { createUrbanChallenge, cityFor, SHOWMANSHIP } from '../src/getaway-urban.js';
import {
  createGetawayRecords, getawayIndex, getawayMedal, readGetawayStore, serializeGetaway, validShowmanship,
  GETAWAY_RECORDS_KEY, GETAWAY_SCHEMA_VERSION, MAX_SHOWMANSHIP,
} from '../src/getaway-records.js';
import { driveUrban, urbanGrip, urbanDrift, urbanStall } from './support/urban-drivers.mjs';

const MISSION = GETAWAY_MISSIONS[0];
const [DOWNTOWN, INDUSTRIAL] = MISSION.environments;
const PARKED = { delay: 1e9 };

function memory(initial = {}) {
  const stored = new Map(Object.entries(initial));
  const writes = [];
  return {
    stored, writes,
    getItem: (k) => (stored.has(k) ? stored.get(k) : null),
    setItem: (k, v) => { writes.push(k); stored.set(k, String(v)); },
    removeItem: (k) => stored.delete(k),
  };
}
const saved = (storage) => JSON.parse(storage.getItem(GETAWAY_RECORDS_KEY));
const rulesOf = (def) => `${def.rules}+${SCORING_VERSION}`;

// One page: every keeper main.js creates, hearing the session's events in main.js's order.
function app(storage) {
  const provider = typeof storage === 'function' ? storage : () => storage;
  const records = createRecords(provider);
  const gymkhana = createGymkhanaRecords(provider);
  const getaway = createGetawayRecords(provider);
  const ghosts = createReferenceGhosts({ store: createGhostStore(provider), bestLapFor: (t, h) => records.forTrack(t, h).fastestLap });
  const game = createGame(undefined, { onRunEvent: (event) => {
    records.handle(event);
    gymkhana.handle(event);
    getaway.handle(event);
    ghosts.handle(event);
  } });
  return { records, gymkhana, getaway, ghosts, game };
}

// Drive one attempt to its end (or for `seconds`), returning the run's result.
function drive(page, def, handlingId, driver, { seconds = 200, restart = false } = {}) {
  const handling = handlingById(handlingId);
  (restart ? restartRun : startRun)(page.game, { mode: 'gymkhana', ghost: false, handling, challenge: def });
  const ticks = Math.round(seconds / TUNING.simStep);
  for (let i = 0; i < ticks && page.game.state !== 'finished'; i += 1) tick(page.game, driver(page.game));
  return page.game.challenge.result;
}

// Scripted drivers with known outcomes on the production environments (deterministic).
const RUNS = {
  downtownClassicZero: [DOWNTOWN, 'classic', () => urbanGrip()],                         // escape, 0
  downtownClassicFruit: [DOWNTOWN, 'classic', () => urbanGrip({ lateral: 9 })],          // escape, 150
  downtownClassicLow: [DOWNTOWN, 'classic', () => urbanDrift({ lateral: 10 })],          // escape, 685
  downtownClassicHigh: [DOWNTOWN, 'classic', () => urbanDrift({})],                      // escape, 854
  downtownPower: [DOWNTOWN, 'revised', () => urbanGrip()],                               // escape, 841
  industrialClassic: [INDUSTRIAL, 'classic', () => urbanDrift({})],                      // escape, 1411
  industrialPower: [INDUSTRIAL, 'revised', () => urbanGrip({ lateral: 9 })],             // escape, 1452
  downtownBust: [DOWNTOWN, 'classic', () => urbanStall(urbanGrip(), { after: 120, seconds: 6 })], // busted
};
const run = (page, name, options) => {
  const [def, handlingId, driver] = RUNS[name];
  return drive(page, def, handlingId, driver(), options);
};

// --- Key, schema and identity --------------------------------------------------------------------

test('key and schema: a versioned key of its own, beside the other records\' keys', () => {
  assert.equal(GETAWAY_RECORDS_KEY, 'mini-drifters-getaway-v1');
  assert.equal(GETAWAY_SCHEMA_VERSION, 1);
  const others = [RECORDS_KEY, GYMKHANA_RECORDS_KEY, GHOST_STORE_KEY, GHOST_PREFERENCE_KEY, HANDLING_PREFERENCE_KEY, 'mini-drifters-sound', 'mini-drifters-audio'];
  assert.ok(!others.includes(GETAWAY_RECORDS_KEY));
  assert.match(GETAWAY_RECORDS_KEY, /^mini-drifters-[a-z]+-v\d+$/);
});

test('identity: every shipped environment is indexed once, by stable ids, never by its label', () => {
  const index = getawayIndex();
  const defs = GETAWAY_MISSIONS.flatMap((m) => m.environments);
  assert.equal(index.size, defs.length, 'no environment id is shared between missions');
  assert.deepEqual([...index].map(([id, e]) => [id, e.missionId, e.environmentId, e.rules]), [
    ['getaway-urban-downtown', 'get-the-footage', 'downtown', rulesOf(DOWNTOWN)],
    ['getaway-urban-industrial', 'get-the-footage', 'industrial', rulesOf(INDUSTRIAL)],
  ]);
  assert.deepEqual(HANDLING_IDS, ['classic', 'revised']);
  for (const [, e] of index) assert.notEqual(e.environmentId, e.def.shortName, 'the id, not the display name');
});

// --- 1-4: first escape, reload, restart -----------------------------------------------------------

test('1. a first qualifying escape saves its Showmanship under mission, environment, handling and rules', () => {
  const storage = memory();
  const page = app(storage);
  assert.equal(page.getaway.bestFor(DOWNTOWN.id, 'classic'), null, 'a new player has no record, not zero');
  const r = run(page, 'downtownClassicHigh');
  assert.equal(r.ended, 'escaped');
  assert.equal(r.footage, 4);
  assert.equal(r.value, r.score + r.smashBonus);
  assert.equal(r.value, 854);
  assert.equal(page.getaway.bestFor(DOWNTOWN.id, 'classic'), 854, 'visible at once');
  assert.equal(page.getaway.newBest, true);
  assert.equal(page.getaway.previousBest, null);
  assert.deepEqual(saved(storage), { version: 1, missions: { 'get-the-footage': { downtown: { classic: { [rulesOf(DOWNTOWN)]: { best: 854 } } } } } });
  assert.deepEqual(storage.writes, [GETAWAY_RECORDS_KEY], 'one write, to its own key only');
  assert.equal(getawayMedal(DOWNTOWN, 'classic', 854), 'silver');
});

test('2. reloading: a fresh page reads the saved best and derives the same medal', () => {
  const storage = memory();
  run(app(storage), 'downtownClassicHigh');
  const reloaded = app(storage);
  assert.equal(reloaded.getaway.bestFor(DOWNTOWN.id, 'classic'), 854);
  assert.equal(reloaded.getaway.newBest, false, 'loading claims nothing new');
  assert.equal(getawayMedal(DOWNTOWN, 'classic', reloaded.getaway.bestFor(DOWNTOWN.id, 'classic')), 'silver');
  assert.deepEqual(storage.writes, [GETAWAY_RECORDS_KEY], 'nothing is written on load');
});

test('3. a browser restart: only the saved strings survive, into a new storage object and page', () => {
  const first = memory();
  run(app(first), 'industrialClassic');
  const profile = JSON.parse(JSON.stringify(Object.fromEntries(first.stored)));
  const restarted = app(memory(profile));
  assert.equal(restarted.getaway.bestFor(INDUSTRIAL.id, 'classic'), 1411);
  assert.equal(getawayMedal(INDUSTRIAL, 'classic', 1411), 'gold');
});

test('4. a higher escape improves the best and says what it replaced', () => {
  const storage = memory();
  const page = app(storage);
  run(page, 'downtownClassicLow');
  assert.equal(page.getaway.bestFor(DOWNTOWN.id, 'classic'), 685);
  run(page, 'downtownClassicHigh', { restart: true });
  assert.equal(page.getaway.bestFor(DOWNTOWN.id, 'classic'), 854);
  assert.equal(page.getaway.newBest, true);
  assert.equal(page.getaway.previousBest, 685);
  assert.equal(saved(storage).missions['get-the-footage'].downtown.classic[rulesOf(DOWNTOWN)].best, 854);
  assert.equal(storage.writes.length, 2);
});

// --- 5-9: lower, equal, failed, zero ----------------------------------------------------------------

test('5. a lower successful escape keeps the best and writes nothing', () => {
  const storage = memory();
  const page = app(storage);
  run(page, 'downtownClassicHigh');
  const before = storage.getItem(GETAWAY_RECORDS_KEY);
  const r = run(page, 'downtownClassicLow', { restart: true });
  assert.equal(r.ended, 'escaped');
  assert.equal(r.value, 685);
  assert.equal(getawayMedal(DOWNTOWN, 'classic', r.value), 'silver', 'the run still earns its own medal');
  assert.equal(page.getaway.bestFor(DOWNTOWN.id, 'classic'), 854);
  assert.equal(page.getaway.newBest, false);
  assert.equal(page.getaway.previousBest, null);
  assert.equal(storage.getItem(GETAWAY_RECORDS_KEY), before);
  assert.equal(storage.writes.length, 1);
});

test('6. an equal escape is not an improvement and writes nothing', () => {
  const storage = memory();
  const page = app(storage);
  run(page, 'downtownClassicHigh');
  run(page, 'downtownClassicHigh', { restart: true });
  assert.equal(page.getaway.newBest, false);
  assert.equal(storage.writes.length, 1);
});

test('7. a bust, an expired clock, a retry or an abandoned run after a best never changes it', () => {
  const storage = memory();
  const page = app(storage);
  run(page, 'downtownClassicHigh');
  const before = storage.getItem(GETAWAY_RECORDS_KEY);
  const busted = run(page, 'downtownBust', { restart: true });
  assert.equal(busted.ended, 'busted');
  assert.equal(busted.value, null);
  assert.equal(page.getaway.newBest, false);
  // Out of time: the same environment id with a parked cruiser and a short clock.
  const slow = createUrbanChallenge({ variant: 'downtown', pursuer: PARKED, timeLimit: 30 });
  assert.equal(slow.id, DOWNTOWN.id);
  let k = 0;
  const expired = drive(page, slow, 'classic', () => ({ up: (k += 1) < 5, down: false, left: false, right: false, handbrake: false }));
  assert.equal(expired.ended, 'out of time');
  // Incomplete: three cameras, then a retry; then three cameras and back to the menu.
  drive(page, DOWNTOWN, 'classic', urbanDrift({}), { seconds: 30 });
  assert.equal(page.game.state, 'racing', 'still driving, not finished');
  assert.ok(page.game.challenge.cameras.filter(Boolean).length < 4);
  drive(page, DOWNTOWN, 'classic', urbanDrift({}), { seconds: 30, restart: true });
  returnToMenu(page.game);
  assert.equal(page.getaway.bestFor(DOWNTOWN.id, 'classic'), 854);
  assert.equal(storage.getItem(GETAWAY_RECORDS_KEY), before);
  assert.equal(storage.writes.length, 1);
});

test('7b. only the run that started can settle: a stale or mismatched event is ignored', () => {
  const storage = memory();
  const page = createGetawayRecords(() => storage);
  page.handle({ type: 'start', trackId: 'x', runId: 4, mode: 'gymkhana', handling: 'classic', challengeId: DOWNTOWN.id });
  page.handle({ type: 'challenge', challengeId: DOWNTOWN.id, runId: 3, handling: 'classic', completed: true, value: 900 });
  page.handle({ type: 'challenge', challengeId: INDUSTRIAL.id, runId: 4, handling: 'classic', completed: true, value: 900 });
  page.handle({ type: 'challenge', challengeId: DOWNTOWN.id, runId: 4, handling: 'revised', completed: true, value: 900 });
  page.handle({ type: 'challenge', challengeId: DOWNTOWN.id, runId: 4, handling: 'classic', completed: false, value: 900 });
  page.handle({ type: 'challenge', challengeId: DOWNTOWN.id, runId: 4, handling: 'classic', completed: true, value: 901 });
  assert.equal(page.bestFor(DOWNTOWN.id, 'classic'), null, 'settled once, by the failed result');
  assert.deepEqual(storage.writes, []);
  // A Gymkhana challenge, a circuit or an unknown handling mode is never a Getaway record.
  for (const start of [{ challengeId: 'linked-drift', handling: 'classic' }, { challengeId: DOWNTOWN.id, handling: 'tuned' }]) {
    page.handle({ type: 'start', trackId: 'x', runId: 5, mode: 'gymkhana', ...start });
    page.handle({ type: 'challenge', runId: 5, completed: true, value: 900, ...start });
  }
  page.handle({ type: 'start', trackId: 'original', runId: 6, mode: 'normal', handling: 'classic' });
  page.handle({ type: 'challenge', challengeId: DOWNTOWN.id, runId: 6, handling: 'classic', completed: true, value: 900 });
  assert.deepEqual(storage.writes, []);
});

test('8. a zero-point escape is a real record and a Bronze, and is shown as 0, not as no record', () => {
  const storage = memory();
  const page = app(storage);
  const r = run(page, 'downtownClassicZero');
  assert.equal(r.ended, 'escaped');
  assert.equal(r.value, 0);
  assert.equal(page.getaway.bestFor(DOWNTOWN.id, 'classic'), 0);
  assert.equal(page.getaway.newBest, true);
  assert.equal(getawayMedal(DOWNTOWN, 'classic', 0), 'bronze');
  assert.equal(app(storage).getaway.bestFor(DOWNTOWN.id, 'classic'), 0);
  run(page, 'downtownClassicZero', { restart: true });
  assert.equal(page.getaway.newBest, false, 'a second zero is a tie');
  run(page, 'downtownClassicFruit', { restart: true });
  assert.equal(page.getaway.bestFor(DOWNTOWN.id, 'classic'), 150);
  assert.equal(page.getaway.previousBest, 0);
});

test('9. the four environment and handling combinations keep separate bests', () => {
  const storage = memory();
  const page = app(storage);
  const expected = [
    ['downtownClassicHigh', DOWNTOWN, 'classic', 854, 'silver'],
    ['downtownPower', DOWNTOWN, 'revised', 841, 'bronze'],
    ['industrialClassic', INDUSTRIAL, 'classic', 1411, 'gold'],
    ['industrialPower', INDUSTRIAL, 'revised', 1452, 'silver'],
  ];
  for (const [name, def, handlingId, value] of expected) {
    const others = expected.filter(([n]) => n !== name).map(([, d, h]) => page.getaway.bestFor(d.id, h));
    assert.equal(run(page, name).value, value, name);
    assert.deepEqual(expected.filter(([n]) => n !== name).map(([, d, h]) => page.getaway.bestFor(d.id, h)), others, `${name} changed nothing else`);
    assert.equal(page.getaway.bestFor(def.id, handlingId), value);
  }
  const reloaded = app(storage);
  for (const [, def, handlingId, value, medal] of expected) {
    assert.equal(reloaded.getaway.bestFor(def.id, handlingId), value);
    assert.equal(getawayMedal(def, handlingId, value), medal);
  }
  assert.deepEqual(saved(storage), { version: 1, missions: { 'get-the-footage': {
    downtown: { classic: { [rulesOf(DOWNTOWN)]: { best: 854 } }, revised: { [rulesOf(DOWNTOWN)]: { best: 841 } } },
    industrial: { classic: { [rulesOf(INDUSTRIAL)]: { best: 1411 } }, revised: { [rulesOf(INDUSTRIAL)]: { best: 1452 } } },
  } } });
});

// --- 10: missions -----------------------------------------------------------------------------------

test('10. missions are isolated: a second mission\'s environment files its own records', () => {
  const other = Object.freeze({ ...INDUSTRIAL, id: 'other-mission-industrial' });
  const missions = [MISSION, { id: 'other-mission', environments: [other] }];
  const storage = memory(); // and an unknown future mission's data, carried through untouched
  storage.setItem(GETAWAY_RECORDS_KEY, JSON.stringify({ version: 1, missions: { 'future-mission': { harbour: { classic: { r9: { best: 5, note: 'kept' } } } } }, extra: [1] }));
  storage.writes.length = 0;
  const records = createGetawayRecords(() => storage, missions);
  const game = createGame(undefined, { onRunEvent: (e) => records.handle(e) });
  const page = { game, getaway: records };
  drive(page, other, 'classic', urbanDrift({}));
  assert.equal(records.bestFor(other.id, 'classic'), 1411);
  assert.equal(records.bestFor(INDUSTRIAL.id, 'classic'), null, 'the same city in another mission is another record');
  drive(page, INDUSTRIAL, 'classic', urbanGrip({ lateral: 9 }));
  assert.equal(records.bestFor(INDUSTRIAL.id, 'classic'), 793);
  assert.equal(records.bestFor(other.id, 'classic'), 1411);
  const data = saved(storage);
  assert.equal(data.missions['other-mission'].industrial.classic[rulesOf(INDUSTRIAL)].best, 1411);
  assert.equal(data.missions['get-the-footage'].industrial.classic[rulesOf(INDUSTRIAL)].best, 793);
  assert.deepEqual(data.missions['future-mission'], { harbour: { classic: { r9: { best: 5, note: 'kept' } } } });
  assert.deepEqual(data.extra, [1]);
  // An environment id offered by two missions is ambiguous, so it is never recorded.
  const twice = createGetawayRecords(() => memory(), [MISSION, { id: 'copy', environments: [DOWNTOWN] }]);
  assert.equal(twice.has(DOWNTOWN.id), false);
  assert.equal(twice.has(INDUSTRIAL.id), true);
});

test('rules partition: a best saved under other rules or another scoring version is kept but never shown', () => {
  const storage = memory({ [GETAWAY_RECORDS_KEY]: JSON.stringify({ version: 1, missions: { 'get-the-footage': { downtown: { classic: {
    'getaway-r4b-downtown-network-standard-x-recover-120+scoring-2': { best: 3000 },
    [`${DOWNTOWN.rules}+scoring-1`]: { best: 2900 },
  } } } } }) });
  const page = app(storage);
  assert.equal(page.getaway.bestFor(DOWNTOWN.id, 'classic'), null);
  run(page, 'downtownClassicLow');
  const classic = saved(storage).missions['get-the-footage'].downtown.classic;
  assert.equal(classic[rulesOf(DOWNTOWN)].best, 685);
  assert.equal(classic['getaway-r4b-downtown-network-standard-x-recover-120+scoring-2'].best, 3000);
  assert.equal(classic[`${DOWNTOWN.rules}+scoring-1`].best, 2900);
});

// --- 11-17: damaged and refused storage --------------------------------------------------------------

test('11. corrupted JSON: no record is shown, the game plays on, and the next escape replaces it', () => {
  for (const raw of ['{oops', '', 'null', '42', '"text"', '[1,2]', '{"missions":{}}']) {
    const storage = memory({ [GETAWAY_RECORDS_KEY]: raw });
    assert.equal(readGetawayStore(raw).status, 'corrupt', raw);
    const page = app(storage);
    assert.equal(page.getaway.available, true);
    assert.equal(page.getaway.readOnly, false);
    assert.equal(page.getaway.bestFor(DOWNTOWN.id, 'classic'), null);
    assert.equal(run(page, 'downtownClassicLow').value, 685);
    assert.equal(page.getaway.newBest, true);
    assert.deepEqual(saved(storage), { version: 1, missions: { 'get-the-footage': { downtown: { classic: { [rulesOf(DOWNTOWN)]: { best: 685 } } } } } });
  }
});

test('12. an unsupported schema: a later version is left strictly alone, an unknown older one is replaced', () => {
  const later = JSON.stringify({ version: 2, missions: { 'get-the-footage': { downtown: { classic: { [rulesOf(DOWNTOWN)]: { best: 100 } } } } } });
  const storage = memory({ [GETAWAY_RECORDS_KEY]: later });
  const page = app(storage);
  assert.equal(page.getaway.readOnly, true);
  assert.equal(page.getaway.bestFor(DOWNTOWN.id, 'classic'), null, 'nothing is shown from it');
  run(page, 'downtownClassicHigh');
  assert.equal(page.getaway.newBest, false, 'no NEW BEST is claimed');
  assert.equal(storage.getItem(GETAWAY_RECORDS_KEY), later, 'never overwritten');
  assert.deepEqual(storage.writes, []);
  for (const version of [0, -1, 1.5, '1', null, undefined, 'two']) {
    const raw = JSON.stringify({ version, missions: {} });
    assert.equal(readGetawayStore(raw).status, 'corrupt', String(version));
    const s = memory({ [GETAWAY_RECORDS_KEY]: raw });
    const p = app(s);
    assert.equal(p.getaway.readOnly, false);
    run(p, 'downtownClassicLow');
    assert.equal(saved(s).version, 1);
  }
});

test('13. invalid scores and record fields are ignored, and replaced only where a run improves them', () => {
  const R = rulesOf(DOWNTOWN);
  const I = rulesOf(INDUSTRIAL);
  for (const best of [-5, 1.5, MAX_SHOWMANSHIP + 1, 1e300, '854', null, true, [854], { v: 1 }]) {
    assert.equal(validShowmanship(best), false, JSON.stringify(best));
    const storage = memory({ [GETAWAY_RECORDS_KEY]: JSON.stringify({ version: 1, missions: { 'get-the-footage': {
      downtown: { classic: { [R]: { best, by: 'tester' } } },
      industrial: { revised: { [I]: { best: 1000 } } },
    } } }) });
    const page = app(storage);
    assert.equal(page.getaway.bestFor(DOWNTOWN.id, 'classic'), null, JSON.stringify(best));
    assert.equal(page.getaway.bestFor(INDUSTRIAL.id, 'revised'), 1000, 'a valid neighbour still shows');
    run(page, 'downtownClassicZero');
    assert.equal(page.getaway.newBest, true, 'even a zero beats an impossible value');
    const data = saved(storage);
    assert.deepEqual(data.missions['get-the-footage'].downtown.classic[R], { best: 0, by: 'tester' });
    assert.deepEqual(data.missions['get-the-footage'].industrial.revised[I], { best: 1000 }, 'unrelated data is never overwritten');
  }
  // NaN and Infinity cannot be JSON; shapes that are not objects at any level are no record.
  for (const missions of [[], 'x', { 'get-the-footage': [] }, { 'get-the-footage': { downtown: 'x' } }, { 'get-the-footage': { downtown: { classic: [] } } }, { 'get-the-footage': { downtown: { classic: { [R]: 854 } } } }]) {
    const page = app(memory({ [GETAWAY_RECORDS_KEY]: JSON.stringify({ version: 1, missions }) }));
    assert.equal(page.getaway.bestFor(DOWNTOWN.id, 'classic'), null, JSON.stringify(missions));
    run(page, 'downtownClassicLow');
    assert.equal(page.getaway.bestFor(DOWNTOWN.id, 'classic'), 685);
  }
  for (const value of [NaN, Infinity, -1, 2.5, MAX_SHOWMANSHIP + 1, '5']) {
    const storage = memory();
    const records = createGetawayRecords(() => storage);
    records.handle({ type: 'start', trackId: 'x', runId: 1, mode: 'gymkhana', handling: 'classic', challengeId: DOWNTOWN.id });
    records.handle({ type: 'challenge', challengeId: DOWNTOWN.id, runId: 1, handling: 'classic', completed: true, value });
    assert.deepEqual(storage.writes, [], `an impossible result is never saved: ${value}`);
  }
});

test('the ceiling is far above anything a run can score', () => {
  const tiers = TUNING.comboTiers;
  for (const def of MISSION.environments) {
    const destruction = cityFor(def.variant).breakables.reduce((sum, br) => sum + SHOWMANSHIP.bonus[br.kind], 0);
    const drift = def.timeLimit * TUNING.driftPointsPerSecond * Math.max(...tiers);
    assert.ok(drift + destruction < MAX_SHOWMANSHIP / 10, `${def.variant}: ${drift + destruction}`);
  }
});

test('14. storage denied on read: unavailable, the game plays on, and nothing is claimed', () => {
  const denied = () => { throw new DOMException('denied', 'SecurityError'); };
  const throwingGet = { getItem: denied, setItem: () => {} };
  for (const provider of [denied, () => throwingGet, () => null, () => ({})]) {
    const page = app(provider);
    assert.equal(page.getaway.available, false);
    assert.equal(page.getaway.bestFor(DOWNTOWN.id, 'classic'), null);
    const r = run(page, 'downtownClassicHigh');
    assert.equal(r.ended, 'escaped');
    assert.equal(r.value, 854, 'the run is scored as ever');
    assert.equal(page.getaway.newBest, false);
  }
});

test('15. storage denied on write: the escape is shown but never claimed as saved', () => {
  const storage = memory();
  storage.setItem = () => { throw new DOMException('denied', 'SecurityError'); };
  const page = app(storage);
  assert.equal(page.getaway.available, true);
  const r = run(page, 'downtownClassicHigh');
  assert.equal(r.value, 854);
  assert.equal(page.getaway.newBest, false);
  assert.equal(page.getaway.bestFor(DOWNTOWN.id, 'classic'), null);
  assert.equal(page.getaway.available, false);
});

test('16. quota exceeded: the saved best stays, nothing is claimed, and a later write can recover', () => {
  const storage = memory();
  const page = app(storage);
  run(page, 'downtownClassicLow');
  const set = storage.setItem;
  storage.setItem = () => { throw new DOMException('full', 'QuotaExceededError'); };
  run(page, 'downtownClassicHigh', { restart: true });
  assert.equal(page.getaway.newBest, false);
  assert.equal(page.getaway.available, false);
  assert.equal(page.getaway.bestFor(DOWNTOWN.id, 'classic'), 685);
  assert.equal(saved(storage).missions['get-the-footage'].downtown.classic[rulesOf(DOWNTOWN)].best, 685);
  storage.setItem = set;
  run(page, 'downtownClassicHigh', { restart: true });
  assert.equal(page.getaway.newBest, true);
  assert.equal(page.getaway.available, true);
  assert.equal(page.getaway.bestFor(DOWNTOWN.id, 'classic'), 854);
});

test('another tab\'s best is respected: the key is re-read before each comparison', () => {
  const storage = memory();
  const tabA = app(storage);
  const tabB = app(storage);
  run(tabB, 'downtownClassicHigh');
  run(tabA, 'downtownClassicLow');
  assert.equal(tabA.getaway.newBest, false, 'tab B\'s 854 beats tab A\'s 685');
  assert.equal(tabA.getaway.bestFor(DOWNTOWN.id, 'classic'), 854);
  run(tabB, 'industrialPower');
  run(tabA, 'industrialClassic');
  const data = saved(storage).missions['get-the-footage'].industrial;
  assert.equal(data.revised[rulesOf(INDUSTRIAL)].best, 1452, 'tab A kept tab B\'s other record');
  assert.equal(data.classic[rulesOf(INDUSTRIAL)].best, 1411);
});

// --- 17-20: retry, isolation, ghosts, simulation ------------------------------------------------------

test('17. retry and Return to Title reset only the run: the saved best stays', () => {
  const storage = memory();
  const page = app(storage);
  run(page, 'downtownClassicHigh');
  const before = storage.getItem(GETAWAY_RECORDS_KEY);
  for (let k = 0; k < 3; k += 1) {
    drive(page, DOWNTOWN, 'classic', urbanDrift({}), { seconds: 20, restart: true });
    assert.equal(page.game.challenge.smashBonus >= 0, true);
    assert.equal(page.getaway.bestFor(DOWNTOWN.id, 'classic'), 854);
  }
  restartRun(page.game, { mode: 'gymkhana', ghost: false, handling: handlingById('classic'), challenge: DOWNTOWN });
  assert.equal(page.game.challenge.time, 0, 'the retry starts from zero');
  assert.equal(page.game.challenge.smashBonus, 0);
  returnToMenu(page.game);
  assert.equal(page.getaway.newBest, false);
  assert.equal(page.getaway.bestFor(DOWNTOWN.id, 'classic'), 854);
  assert.equal(storage.getItem(GETAWAY_RECORDS_KEY), before);
});

test('18-19. existing records, ghosts and preferences stay byte for byte, and Getaway makes no ghost', () => {
  const seeded = {
    [RECORDS_KEY]: JSON.stringify({ version: 3, tracks: { original: { classic: { 'scoring-2': { bestScore: 4321, fastestLap: 31.5 } } } } }),
    'mini-drifters-records-v2': '{"version":2}',
    'mini-drifters-records': '{"legacy":true}',
    [GYMKHANA_RECORDS_KEY]: JSON.stringify({ version: 1, challenges: { 'linked-drift': { classic: { 'linked-drift-1+scoring-2': { best: 700 } } } } }),
    [GHOST_STORE_KEY]: '{"version":1,"slots":{"opaque":"bytes"}}',
    [GHOST_PREFERENCE_KEY]: 'reference',
    [HANDLING_PREFERENCE_KEY]: 'revised',
    'mini-drifters-sound': 'off',
    'unrelated-site-key': 'keep me',
  };
  const storage = memory(seeded);
  const page = app(storage);
  page.game.ghostSource = 'reference';
  for (const name of ['downtownClassicHigh', 'downtownPower', 'industrialClassic', 'industrialPower', 'downtownBust']) {
    run(page, name);
    assert.equal(page.game.ghost, null, `${name}: no previous-lap ghost`);
    assert.equal(page.game.laps.completed ?? 0, 0, `${name}: no laps`);
  }
  for (const [key, value] of Object.entries(seeded)) assert.equal(storage.getItem(key), value, key);
  assert.deepEqual([...new Set(storage.writes)], [GETAWAY_RECORDS_KEY], 'the only key ever written');
  assert.deepEqual([...storage.stored.keys()].sort(), [...Object.keys(seeded), GETAWAY_RECORDS_KEY].sort(), 'no other key appears');
  assert.equal(page.ghosts.lastResult, null, 'the reference ghost never heard a lap');
  assert.equal(page.gymkhana.bestFor('linked-drift', 'classic'), 700);
});

test('20. the records only listen: every run is identical with records, without them, and with storage refusing', () => {
  const noListener = (def, handlingId, driver) => {
    const { result, game } = driveUrban(def, handlingById(handlingId), driver);
    return { result, car: { ...game.car }, scoring: { score: game.scoring.score, bestCombo: game.scoring.bestCombo }, ticks: game.ticks };
  };
  const withRecords = (def, handlingId, driver, storage) => {
    const page = app(storage);
    drive(page, def, handlingId, driver);
    return { result: page.game.challenge.result, car: { ...page.game.car }, scoring: { score: page.game.scoring.score, bestCombo: page.game.scoring.bestCombo }, ticks: page.game.ticks };
  };
  const refusing = memory();
  refusing.setItem = () => { throw new DOMException('full', 'QuotaExceededError'); };
  for (const name of Object.keys(RUNS)) {
    const [def, handlingId, driver] = RUNS[name];
    const bare = noListener(def, handlingId, driver());
    assert.deepEqual(withRecords(def, handlingId, driver(), memory()), bare, `${name}: with records`);
    assert.deepEqual(withRecords(def, handlingId, driver(), refusing), bare, `${name}: with storage refusing`);
    assert.deepEqual(withRecords(def, handlingId, driver(), () => { throw new Error('denied'); }), bare, `${name}: with storage denied`);
  }
});

// --- Medals -------------------------------------------------------------------------------------------

test('medals: derived from the score with the accepted targets, never stored', () => {
  const expected = {
    downtown: { classic: { gold: 1600, silver: 600, bronze: 0 }, revised: { gold: 2600, silver: 900, bronze: 0 } },
    industrial: { classic: { gold: 1300, silver: 500, bronze: 0 }, revised: { gold: 2300, silver: 700, bronze: 0 } },
  };
  for (const def of MISSION.environments) {
    for (const handlingId of HANDLING_IDS) {
      const t = expected[def.variant][handlingId];
      assert.deepEqual({ ...def.medalTargets[handlingId] }, t, `${def.variant}/${handlingId}: targets unchanged`);
      assert.equal(getawayMedal(def, handlingId, null), null);
      assert.equal(getawayMedal(def, handlingId, -1), null);
      assert.equal(getawayMedal(def, handlingId, NaN), null);
      assert.equal(getawayMedal(def, handlingId, 0), 'bronze');
      assert.equal(getawayMedal(def, handlingId, t.silver - 1), 'bronze');
      assert.equal(getawayMedal(def, handlingId, t.silver), 'silver');
      assert.equal(getawayMedal(def, handlingId, t.gold - 1), 'silver');
      assert.equal(getawayMedal(def, handlingId, t.gold), 'gold');
    }
    assert.equal(getawayMedal(def, 'tuned', 5000), null, 'a retired mode has no targets');
  }
  // A stored medal field is never read: the score alone decides.
  const storage = memory({ [GETAWAY_RECORDS_KEY]: JSON.stringify({ version: 1, missions: { 'get-the-footage': { downtown: { classic: { [rulesOf(DOWNTOWN)]: { best: 100, medal: 'gold' } } } } } }) });
  const page = app(storage);
  assert.equal(getawayMedal(DOWNTOWN, 'classic', page.getaway.bestFor(DOWNTOWN.id, 'classic')), 'bronze');
  const source = readFileSync(new URL('../src/getaway-records.js', import.meta.url), 'utf8');
  assert.doesNotMatch(source, /medal\s*:/, 'no medal is written');
});

test('serialize: one record replaced, everything else carried over', () => {
  const entry = getawayIndex().get(DOWNTOWN.id);
  const store = readGetawayStore(JSON.stringify({ version: 1, missions: { 'get-the-footage': { downtown: { classic: { [entry.rules]: { best: 1, extra: 'x' } } } } }, other: 2 }));
  const out = serializeGetaway(store, entry, 'classic', 9);
  assert.deepEqual(out, { version: 1, missions: { 'get-the-footage': { downtown: { classic: { [entry.rules]: { best: 9, extra: 'x' } } } } }, other: 2 });
  assert.equal(store.saved.missions['get-the-footage'].downtown.classic[entry.rules].best, 1, 'the input is not changed');
});
