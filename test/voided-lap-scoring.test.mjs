// B1: only counted laps score. Points banked on a voided lap are handed back at the line,
// a combo still running there is lost, and the run still ends after three counted laps.
import test from 'node:test';
import assert from 'node:assert/strict';
import { TUNING as T } from '../src/tuning.js';
import { trackById } from '../src/track.js';
import { createGame, startRun, restartRun, returnToMenu, tick, countedScore, NO_INPUT } from '../src/game.js';
import { gripDriver, driftDriver, recklessDriver } from './support/drivers.mjs';
import { cutterDriver } from './support/exploit-drivers.mjs';

const THROTTLE = { ...NO_INPUT, up: true };
const steps = (seconds) => Math.round(seconds / T.simStep);
// Forward cuts that pass inside a checkpoint's reach, so the lap is voided at the line.
const VOIDING_CUTS = { original: { from: 562, to: 800 }, switchback: { from: 734, to: 972 } };

// Plays a run and keeps its own books from what can be seen from outside: the score at each
// lap event, and the combo banked on each step. The game's results must agree with them.
function play(trackId, makeDriver, { onStep } = {}) {
  const game = createGame(trackById(trackId));
  startRun(game);
  const driver = makeDriver();
  const books = { counted: 0, voidedPoints: 0, bestCountedCombo: 0, laps: [] };
  let lapStart = 0;
  let lapBest = 0;
  let serial = 0;
  while (game.state !== 'finished' && game.ticks < steps(3600)) {
    const before = game.scoring.score;
    tick(game, driver(game));
    const banked = game.scoring.score - before;
    if (banked > lapBest) lapBest = banked;
    if (game.lapEventSerial !== serial) {
      serial = game.lapEventSerial;
      const points = game.scoring.score - lapStart;
      // A combo banked on the step that finishes the run belongs to the final, counted lap.
      if (game.state === 'finished') continue;
      books.laps.push({ result: game.lapEvent, points });
      if (game.lapEvent === 'lap') {
        books.counted += points;
        books.bestCountedCombo = Math.max(books.bestCountedCombo, lapBest);
      } else {
        books.voidedPoints += points;
      }
      lapStart = game.scoring.score;
      lapBest = 0;
    }
    onStep?.(game);
  }
  return { game, books };
}

const voider = (trackId, times) => () => cutterDriver(driftDriver(), { ...VOIDING_CUTS[trackId], times });

for (const trackId of ['original', 'switchback']) {
  test(`${trackId}: clean runs finish exactly as before, with every point and combo counted`, () => {
    for (const make of [gripDriver, driftDriver, recklessDriver]) {
      const { game } = play(trackId, make);
      assert.equal(game.state, 'finished');
      assert.equal(game.laps.completed, T.runLaps);
      assert.equal(game.laps.voided, 0);
      assert.equal(game.results.score, game.scoring.score);
      assert.equal(game.results.bestCombo, game.scoring.bestCombo);
      assert.equal(game.results.bestMultiplier, game.scoring.bestMultiplier);
      assert.equal(game.results.forfeited, 0);
      assert.equal(game.results.voidedLaps, 0);
    }
  });

  test(`${trackId}: twenty voided laps score nothing, so the result is just the three counted laps`, () => {
    const { game, books } = play(trackId, voider(trackId, 20));
    assert.equal(game.laps.voided, 20, 'every requested lap was voided');
    assert.equal(game.laps.completed, T.runLaps);
    assert.equal(game.state, 'finished');
    const finalBank = game.scoring.score - books.counted - books.voidedPoints;
    assert.equal(game.results.score, books.counted + finalBank);
    assert.equal(game.results.forfeited, books.voidedPoints);
    assert.equal(game.results.voidedLaps, 20);
    const clean = play(trackId, driftDriver).game.results.score;
    assert.ok(game.results.score <= 2 * clean, `scored ${game.results.score} after 20 voided laps; a clean run scores ${clean}`);
  });

  test(`${trackId}: the best combo comes only from counted laps`, () => {
    const { game, books } = play(trackId, voider(trackId, 20));
    assert.ok(game.results.bestCombo <= game.scoring.bestCombo);
    // The finishing step can bank one more, on the final counted lap.
    assert.ok(game.results.bestCombo >= books.bestCountedCombo);
    assert.ok(game.results.bestCombo <= Math.max(books.bestCountedCombo, game.results.score));
  });

  test(`${trackId}: one voided lap costs that lap, and the run carries on to three counted laps`, () => {
    const { game, books } = play(trackId, voider(trackId, 1));
    assert.equal(game.state, 'finished');
    assert.equal(game.laps.voided, 1);
    assert.equal(game.laps.completed, T.runLaps);
    assert.ok(game.results.bestLap !== null);
    assert.equal(books.laps[0].result, 'void');
    assert.equal(game.results.forfeited, books.laps[0].points);
    assert.equal(game.results.score, game.scoring.score - books.laps[0].points);
  });

  test(`${trackId}: several voided laps in a row are each handed back`, () => {
    const { game, books } = play(trackId, voider(trackId, 5));
    assert.deepEqual(books.laps.slice(0, 5).map((l) => l.result), ['void', 'void', 'void', 'void', 'void']);
    assert.equal(game.results.forfeited, books.voidedPoints);
    assert.equal(game.results.score, game.scoring.score - books.voidedPoints);
  });
}

test('original: a voided lap after a counted one keeps the counted lap\'s points', () => {
  // Drive a clean first lap, then cut on the second.
  const make = () => {
    const clean = driftDriver();
    let cutting = null;
    return (game) => {
      if (game.laps.completed === 0) return clean(game);
      cutting ??= cutterDriver(driftDriver(), { ...VOIDING_CUTS.original, times: 1 });
      return cutting(game);
    };
  };
  const { game, books } = play('original', make);
  assert.deepEqual(books.laps.slice(0, 2).map((l) => l.result), ['lap', 'void']);
  assert.ok(books.laps[0].points > 0);
  assert.equal(game.results.forfeited, books.laps[1].points);
  assert.equal(game.results.score, game.scoring.score - books.laps[1].points);
});

// Puts the car just short of the line with a live combo and the lap in the given state.
function atTheLine({ valid, completed = 0 }) {
  const game = createGame();
  startRun(game);
  tick(game, THROTTLE);
  game.scoring.combo = { points: 100, tier: 2, grace: 2, tierGround: 0, linkGround: 0, stallTimer: 0, stallGround: 0, side: 1 };
  game.laps.completed = completed;
  game.laps.next = game.track.gates.length;
  game.laps.valid = valid;
  game.car.x -= 12;
  return game;
}
const crossLine = (game) => {
  for (let i = 0; i < steps(3) && game.lapEventSerial === 0; i += 1) tick(game, THROTTLE);
};

test('a combo running across a voided line is lost, and the HUD is told what the lap cost', () => {
  const game = atTheLine({ valid: false });
  game.scoring.score = 300;
  crossLine(game);
  assert.equal(game.lapEvent, 'void');
  assert.equal(game.scoring.combo, null);
  assert.equal(game.scoring.event.type, 'lost');
  assert.equal(game.scoring.event.reason, 'lap not counted');
  assert.equal(game.forfeited, 300);
  assert.equal(game.lastForfeit, 300 + 200);
  assert.equal(countedScore(game), 0);
});

test('a combo running across a counted line carries on, and counts when it banks', () => {
  const game = atTheLine({ valid: true });
  crossLine(game);
  assert.equal(game.lapEvent, 'lap');
  assert.ok(game.scoring.combo, 'the combo is still running');
  for (let i = 0; i < steps(5) && game.scoring.combo; i += 1) tick(game, NO_INPUT);
  assert.equal(game.scoring.combo, null);
  assert.equal(game.scoring.event.type, 'banked');
  assert.equal(countedScore(game), game.scoring.score);
  assert.ok(countedScore(game) >= 200);
});

test('a combo banked on the finishing line counts, and is the best combo', () => {
  const game = atTheLine({ valid: true, completed: T.runLaps - 1 });
  crossLine(game);
  assert.equal(game.state, 'finished');
  assert.equal(game.results.score, 200);
  assert.equal(game.results.bestCombo, 200);
  assert.equal(game.results.bestMultiplier, T.comboTiers[2]);
});

test('restarting or leaving a run clears everything that was held against it', () => {
  const { game } = play('original', voider('original', 2));
  assert.ok(game.forfeited > 0);
  for (const reset of [(g) => restartRun(g), (g) => returnToMenu(g)]) {
    reset(game);
    assert.equal(game.forfeited, 0);
    assert.equal(game.lastForfeit, 0);
    assert.equal(game.lapScoreStart, 0);
    assert.equal(game.countedBestCombo, 0);
    assert.equal(countedScore(game), 0);
  }
});

test('the HUD score drops back to where the lap began at each voided line, and ends as the result', () => {
  let lapStart = 0;
  let serial = 0;
  let voids = 0;
  const { game } = play('switchback', voider('switchback', 3), {
    onStep: (g) => {
      if (g.lapEventSerial === serial) return;
      serial = g.lapEventSerial;
      if (g.lapEvent === 'void') {
        voids += 1;
        assert.equal(countedScore(g), lapStart);
      }
      lapStart = countedScore(g);
    },
  });
  assert.equal(voids, 3);
  assert.equal(countedScore(game), game.results.score);
});
