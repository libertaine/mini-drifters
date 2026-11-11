// Records, B1 and B2 together: personal bests are taken from the run's qualifying results,
// after voided laps are handed back and shortcuts are paid nothing, never from the raw score.
// Every run here is driven through tick() with key-pressing drivers, as in play.
import test from 'node:test';
import assert from 'node:assert/strict';
import { TUNING as T } from '../src/tuning.js';
import { trackById } from '../src/track.js';
import { createGame, startRun, returnToMenu, tick, countedScore } from '../src/game.js';
import { bankCombo } from '../src/scoring.js';
import { createRecords, RECORDS_KEY } from '../src/records.js';
import { driftDriver } from './support/drivers.mjs';
import { cutterDriver } from './support/exploit-drivers.mjs';

const steps = (seconds) => Math.round(seconds / T.simStep);
// The same forward cuts the B1 tests use: they pass inside a checkpoint's reach, so the lap
// is voided at the line. And the B2 stress test's cut back across the infield.
const VOIDING_CUTS = { original: { from: 562, to: 800 }, switchback: { from: 734, to: 972 } };
const BACK_CUTS = { original: { from: 740, to: 662 }, switchback: { from: 920, to: 845 } };

function store(raw = null) {
  return { raw, writes: 0,
    getItem(key) { assert.equal(key, RECORDS_KEY); return this.raw; },
    setItem(key, value) { assert.equal(key, RECORDS_KEY); this.raw = value; this.writes += 1; },
  };
}

// A game wired to a records keeper, as main.js wires them, that also keeps its own books
// from outside: each lap's points and best banked combo, and whether the lap counted.
function rig(trackId, storage = store()) {
  const records = createRecords(() => storage);
  const events = [];
  const game = createGame(trackById(trackId), { onRunEvent: (event) => { events.push(event); records.handle(event); } });
  return { storage, records, events, game };
}

function play(game, driver, { until = (g) => g.state === 'finished', onStep } = {}) {
  const laps = [];
  let lapStart = 0;
  let lapBest = 0;
  let serial = game.lapEventSerial;
  while (!until(game) && game.ticks < steps(3600)) {
    const before = game.scoring.score;
    tick(game, driver(game));
    lapBest = Math.max(lapBest, game.scoring.score - before);
    if (game.lapEventSerial !== serial) {
      serial = game.lapEventSerial;
      laps.push({ result: game.lapEvent, points: game.scoring.score - lapStart, best: lapBest, time: game.laps.lastLap });
      lapStart = game.scoring.score;
      lapBest = 0;
    }
    onStep?.(game);
  }
  assert.ok(until(game), 'the run reached the requested point');
  return laps;
}

const skipOnce = (trackId) => cutterDriver(driftDriver(), { ...VOIDING_CUTS[trackId], times: 1 });

for (const trackId of ['original', 'switchback']) {
  test(`${trackId}: a skipped checkpoint, then more scoring and a normal finish, records only the counted laps`, () => {
    const { records, events, game } = rig(trackId);
    startRun(game);
    const laps = play(game, skipOnce(trackId));

    assert.equal(game.state, 'finished');
    assert.deepEqual(laps.map((l) => l.result), ['void', 'lap', 'lap', 'lap'], 'one voided lap, then three counted ones');
    const [voided, ...counted] = laps;
    assert.ok(voided.points > 0, 'the voided lap banked points before the line');
    assert.ok(counted.every((l) => l.points > 0), 'scoring carried on after the voided lap');

    // The qualifying result leaves the voided lap out, and the record is that result.
    assert.equal(game.results.forfeited, voided.points);
    assert.equal(game.results.score, game.scoring.score - voided.points);
    assert.equal(game.results.score, counted.reduce((sum, l) => sum + l.points, 0));
    const best = records.forTrack(trackId);
    assert.equal(best.score, game.results.score);
    assert.ok(best.score < game.scoring.score, 'the record is below the raw score');

    // Best combo only from counted laps (the finishing step's bank is on the last counted lap).
    assert.equal(best.bestCombo, game.results.bestCombo);
    assert.equal(best.bestCombo, Math.max(...counted.map((l) => l.best)));

    // Fastest lap: only counted laps reach the keeper as valid, and the best of them is kept.
    assert.deepEqual(events.filter((e) => e.type === 'lap').map((e) => e.valid), [false, true, true, true]);
    assert.equal(best.fastestLap, Math.min(...counted.map((l) => l.time)));
    assert.equal(best.fastestLap, game.results.bestLap);
    assert.deepEqual(records.newBests, { score: true, fastestLap: true, bestCombo: true });
  });

  test(`${trackId}: twenty voided laps of farming cannot lift the score record above the counted laps`, () => {
    const clean = rig(trackId);
    startRun(clean.game);
    play(clean.game, driftDriver());

    const { records, game } = rig(trackId);
    startRun(game);
    const laps = play(game, cutterDriver(driftDriver(), { ...VOIDING_CUTS[trackId], times: 20 }));
    assert.equal(game.laps.voided, 20);
    assert.equal(game.laps.completed, T.runLaps);
    const forfeited = laps.filter((l) => l.result === 'void').reduce((sum, l) => sum + l.points, 0);
    assert.ok(forfeited > 0);
    assert.equal(records.forTrack(trackId).score, game.scoring.score - forfeited);
    assert.equal(records.forTrack(trackId).score, game.results.score);
    assert.ok(records.forTrack(trackId).score <= 2 * clean.records.forTrack(trackId).score,
      `record ${records.forTrack(trackId).score} after farming; a clean run records ${clean.records.forTrack(trackId).score}`);
  });

  test(`${trackId}: cutting back across the infield, then finishing normally, records what the checkpoints allow`, () => {
    const loops = 30;
    const { records, game } = rig(trackId);
    startRun(game);
    const driver = cutterDriver(driftDriver(), { ...BACK_CUTS[trackId], times: loops });
    let atTen = null;
    play(game, driver, {
      until: (g) => driver.cuts() === loops && !driver.cutting(),
      onStep: (g) => { if (atTen === null && driver.cuts() === 10) atTen = g.scoring.score; },
    });
    assert.equal(game.scoring.score, atTen, 'cuts 10 to 30 scored nothing');
    const laps = play(game, driver);
    assert.equal(game.state, 'finished');
    assert.equal(game.laps.voided, 0);
    assert.deepEqual(laps.map((l) => l.result), ['lap', 'lap', 'lap']);
    assert.equal(game.results.score, game.scoring.score, 'no lap was voided, so nothing is handed back');
    assert.deepEqual(records.forTrack(trackId),
      { score: game.results.score, fastestLap: game.results.bestLap, bestCombo: game.results.bestCombo });
  });
}

test('original: a huge combo banked on a voided lap never reaches the combo or score record', () => {
  const { records, game } = rig('original');
  startRun(game);
  const driver = skipOnce('original');
  // Drive until the cut has voided the lap in progress, then bank a 60,000-point combo on it.
  play(game, driver, { until: (g) => driver.cuts() === 1 && !driver.cutting() && !g.laps.valid && !g.scoring.combo });
  game.scoring.combo = { points: 60000, tier: 0, grace: 0, tierGround: 0, linkGround: 0, stallTimer: 0, stallGround: 0, side: 1 };
  bankCombo(game.scoring, 'test');
  assert.ok(game.scoring.bestCombo >= 60000);
  const laps = play(game, driver);
  assert.equal(laps[0].result, 'void');
  assert.ok(game.results.forfeited >= 60000);
  const best = records.forTrack('original');
  assert.ok(best.bestCombo < 60000, `recorded a ${best.bestCombo} combo`);
  assert.equal(best.bestCombo, game.results.bestCombo);
  assert.equal(best.score, game.results.score);
  assert.ok(best.score < game.scoring.score - 60000 + 1);
});

test('switchback: leaving after a voided lap and a counted one keeps the counted lap time only', () => {
  const { records, storage, game } = rig('switchback');
  startRun(game);
  const laps = play(game, skipOnce('switchback'), { until: (g) => g.laps.completed === 1 });
  assert.deepEqual(laps.map((l) => l.result), ['void', 'lap']);
  assert.ok(countedScore(game) > 0);
  returnToMenu(game);
  assert.deepEqual(records.forTrack('switchback'), { score: null, fastestLap: laps[1].time, bestCombo: null });
  assert.deepEqual(records.forTrack('original'), { score: null, fastestLap: null, bestCombo: null });
  assert.equal(storage.writes, 1, 'only the counted lap time was written');
});

test('original: a lesson with a skipped checkpoint and a finish writes nothing', () => {
  const { storage, game } = rig('original');
  startRun(game, { mode: 'tutorial', ghost: false });
  play(game, skipOnce('original'));
  assert.equal(game.state, 'finished');
  assert.equal(game.laps.voided, 1);
  assert.equal(storage.writes, 0);
});

test('a failed write after a voided-lap run claims no NEW BEST, and records survive a reload', () => {
  // A first run saves corrected bests; a reload reads exactly those.
  const storage = store();
  const first = rig('original', storage);
  startRun(first.game);
  play(first.game, skipOnce('original'));
  const saved = storage.raw;
  const reloaded = createRecords(() => storage);
  assert.deepEqual(reloaded.forTrack('original'),
    { score: first.game.results.score, fastestLap: first.game.results.bestLap, bestCombo: first.game.results.bestCombo });

  assert.equal(storage.raw, saved, 'reading does not write');

  // A full store holding weak bests: the voided-lap run beats all three, but nothing can be
  // saved, so nothing is claimed and the saved bests stand.
  const weak = { score: 1, fastestLap: 999, bestCombo: 1 };
  const weakRaw = JSON.stringify({ version: 1, tracks: { original: weak, switchback: { score: null, fastestLap: null, bestCombo: null } } });
  const full = { getItem: () => weakRaw, setItem: () => { throw new Error('quota'); } };
  const second = rig('original', full);
  startRun(second.game);
  play(second.game, skipOnce('original'));
  assert.equal(second.game.laps.voided, 1);
  assert.ok(second.game.results.score > weak.score && second.game.results.bestLap < weak.fastestLap && second.game.results.bestCombo > weak.bestCombo);
  assert.equal(second.records.available, false);
  assert.deepEqual(second.records.newBests, { score: false, fastestLap: false, bestCombo: false });
  assert.deepEqual(second.records.forTrack('original'), weak);
});
