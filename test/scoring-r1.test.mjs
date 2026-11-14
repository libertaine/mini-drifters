// The low-speed scoring fade (scoring-2): a drift's speed score is scaled by a share that is 0 at
// the minimum drift speed (10.5 m/s), rises linearly, and is 1 from 15 m/s up. Pay only: what
// counts as a drift, combos, tiers, links, grace, the handbrake penalty and lap rules are
// unchanged, and so is the car. This is the only scoring implementation the game ships.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { TUNING as T, SCORE_LOW_SPEED_FADE_END_RATIO } from '../src/tuning.js';
import {
  createScoring, updateScoring, classifyDrift, angleScore, speedScore, lowSpeedFade, bankCombo,
  SCORING_VERSION, LEGACY_SCORING_VERSION,
} from '../src/scoring.js';
import { trackById } from '../src/track.js';
import { handlingById, HANDLING_MODES } from '../src/handling.js';
import { createGame, startRun, tick, NO_INPUT } from '../src/game.js';
import { gripDriver, driftDriver } from './support/drivers.mjs';

const DEG = Math.PI / 180;
const dt = T.simStep;
const MIN = T.topSpeed * T.driftMinSpeedRatio; // 10.5 m/s
const FULL = T.topSpeed * T.scoreFullSpeedRatio; // 29.4 m/s
const clamp01 = (v) => Math.max(0, Math.min(1, v));
// The speed score as it was before the fade (scoring-1), written out independently.
const before = (v) => T.scoreSpeedFloor + (1 - T.scoreSpeedFloor) * clamp01((v - MIN) / (FULL - MIN));

const drifting = (over = {}) => ({
  speed: 25, forwardSpeed: 20, slipAngle: -35 * DEG, surface: 'road', progressRate: 22,
  newGround: 25 * dt, handbrake: false, impact: 0, ...over,
});
function run(state, sample, seconds) {
  for (let i = 0, n = Math.round(seconds / dt); i < n; i += 1) updateScoring(state, sample, dt);
}

// --- The fade -------------------------------------------------------------------------
test('the fade runs from 10.5 m/s to exactly 15 m/s, stored as a fraction of topSpeed', () => {
  assert.equal(MIN, 10.5);
  assert.equal(SCORE_LOW_SPEED_FADE_END_RATIO, 15 / 42);
  assert.equal(T.topSpeed * SCORE_LOW_SPEED_FADE_END_RATIO, 15, 'exactly 15 in binary');
  assert.ok(!('scoreLowSpeedFadeEndRatio' in T), 'TUNING itself (Classic\'s physics configuration) is unchanged');
  assert.equal(SCORING_VERSION, 'scoring-2');
  assert.equal(LEGACY_SCORING_VERSION, 'scoring-1');
});

test('endpoints: nothing at 10.5 m/s, everything from 15 m/s', () => {
  assert.equal(lowSpeedFade(10.5), 0);
  assert.equal(speedScore(10.5), 0);
  assert.equal(lowSpeedFade(15), 1);
  assert.equal(speedScore(15), before(15));
  assert.equal(lowSpeedFade(12.75), 0.5, 'exactly half way');
  for (const v of [0, 5, 10, 10.49]) assert.equal(lowSpeedFade(v), 0, `${v} m/s`);
});

test('between 10.5 and 15 m/s the multiplier rises linearly', () => {
  for (const v of [10.6, 11, 11.5, 12, 12.75, 13, 13.5, 14, 14.5, 14.99]) {
    const share = (v - 10.5) / 4.5;
    assert.ok(Math.abs(lowSpeedFade(v) - share) < 1e-12, `${v} m/s fade`);
    assert.ok(Math.abs(speedScore(v) - before(v) * share) < 1e-12, `${v} m/s score`);
    assert.ok(speedScore(v) < before(v));
  }
  let last = -1;
  for (let v = 10.5; v <= 42; v += 0.01) { assert.ok(speedScore(v) >= last, `rising at ${v}`); last = speedScore(v); }
});

test('from 15 m/s up the speed score is bit-for-bit the one it replaced', () => {
  for (let v = 15; v <= 50; v += 0.125) assert.ok(Object.is(speedScore(v), before(v)), `${v} m/s`);
  for (const v of [15, 15.000000000000002, 21.1, 28.9, FULL, 35, 42]) assert.ok(Object.is(speedScore(v), before(v)), `${v} m/s`);
});

// The accepted playable prototype (D:\Projects\mini-drifters-scoring-prototype-v0.3.0, variant
// `fade`, R1) gives this hash over the same grid: its speedScore and lowSpeedFade, with its R1
// rules. Production must reproduce every value exactly, not approximately.
test('the speed score equals the accepted R1 prototype\'s at every one of 10,008 speeds', () => {
  const speeds = [];
  for (let i = 0; i <= 10000; i += 1) speeds.push(i * 0.005);
  speeds.push(10.5, 12.75, 15, 29.4, 42, 10.500000000000002, 14.999999999999998);
  const values = speeds.map((v) => [speedScore(v), lowSpeedFade(v)]);
  assert.equal(createHash('sha256').update(JSON.stringify(values)).digest('hex'), 'dc2967958245d94dea60633b52d4b8a7c3dcdbdff483e6a884ce459d2089745b');
});

// --- Pay only ---------------------------------------------------------------------------
test('what counts as a drift is unchanged: the minimum speed and the slip rules', () => {
  const reason = (over, was = false) => classifyDrift(drifting(over), was, 0);
  assert.equal(reason({ speed: 10.49 }), 'too slow');
  assert.equal(reason({ speed: 10.5 }), 'drifting', 'a 10.5 m/s slide still counts');
  assert.equal(reason({ speed: 11, slipAngle: 11 * DEG }), 'low angle');
  assert.equal(reason({ speed: 11, slipAngle: 13 * DEG }), 'drifting');
  assert.equal(reason({ speed: 11, slipAngle: 10 * DEG }, true), 'drifting', 'exit hysteresis unchanged');
  assert.equal(reason({ speed: 11, slipAngle: T.spinoutSlip }), 'over-rotated');
  // The angle score does not read speed at all.
  assert.equal(angleScore(30 * DEG), 1);
  assert.equal(angleScore(12 * DEG), 0.25);
  assert.equal(angleScore(T.driftStrongHigh), 1);
});

test('a slow drift keeps and grows its combo exactly as a fast one does; it just pays less', () => {
  const sides = [-35 * DEG, 35 * DEG];
  const drive = (speed) => {
    const s = createScoring();
    const trace = [];
    for (let i = 0; i < 6; i += 1) {
      run(s, drifting({ speed, slipAngle: sides[i % 2] }), 1.2);
      trace.push(s.combo && [s.combo.tier, s.combo.side, s.drifting]);
    }
    return { s, trace };
  };
  const slow = drive(11);
  const edge = drive(10.5);
  const fast = drive(20);
  assert.deepEqual(slow.trace, fast.trace, 'the same tiers, sides and drifting state, tick for tick');
  assert.deepEqual(edge.trace, fast.trace, 'even at exactly 10.5 m/s');
  assert.ok(slow.s.combo.tier > 0, 'the combo climbed');
  assert.equal(edge.s.combo.points, 0, 'nothing is paid at 10.5 m/s');
  assert.ok(slow.s.combo.points > 0 && slow.s.combo.points < fast.s.combo.points * 0.2);
  // A slow hairpin can bridge two fast corners without breaking the combo.
  const s = createScoring();
  run(s, drifting({ speed: 22 }), 1);
  const combo = s.combo;
  run(s, drifting({ speed: 10.6, slipAngle: 35 * DEG }), 1.5);
  run(s, drifting({ speed: 22 }), 1);
  assert.equal(s.combo, combo, 'one combo throughout');
  bankCombo(s);
  assert.ok(s.score > 0 && s.bestCombo === s.score);
});

test('the handbrake penalty, combo tiers and grace are unchanged', () => {
  const s = createScoring();
  run(s, drifting({ handbrake: true }), T.handbrakeScoreGrace + 0.1);
  assert.ok(s.handbrakeTime > T.handbrakeScoreGrace);
  updateScoring(s, drifting({ handbrake: false }), dt);
  assert.equal(s.handbrakeTime, 0, 'a release still resets the penalty timer at once (no wind-down)');
  assert.deepEqual(T.comboTiers, [1, 1.5, 2, 3]);
  assert.equal(T.comboGrace, 2);
  assert.equal(T.handbrakeScoreFactor, 0.3);
  const source = readFileSync(new URL('../src/scoring.js', import.meta.url), 'utf8');
  assert.match(source, /state\.handbrakeTime = sample\.handbrake \? state\.handbrakeTime \+ dt : 0;/);
  assert.match(source, /handbrakeShare = state\.handbrakeTime > T\.handbrakeScoreGrace \? T\.handbrakeScoreFactor : 1;/);
});

// --- One scoring implementation ---------------------------------------------------------
test('only the low-speed fade ships: no scoring variants, selectors, shadow scoring or other rules', () => {
  const files = readdirSync(new URL('../src/', import.meta.url));
  for (const name of ['scoring-variants.js', 'scoring-shadow.js', 'scoring-prototype.js', 'scoring-formulas.js']) assert.ok(!files.includes(name), name);
  const banned = /scoring-variants|scoring-shadow|scoring-prototype|scoring-formulas|scoringVariant|SCORING_VARIANTS|BASELINE_VARIANT|handbrakeReleaseDecay|nextHandbrakeTime|scoreLowSpeedFadeEndRatio|scoreFadeFullSpeed|createInertRecords|SCORING_AB|scoring=|shadowEnabled|ScoringShadow/;
  for (const file of files) assert.doesNotMatch(readFileSync(new URL(`../src/${file}`, import.meta.url), 'utf8'), banned, file);
  for (const file of ['index.html', 'style.css', 'server.mjs']) {
    assert.doesNotMatch(readFileSync(new URL(`../${file}`, import.meta.url), 'utf8'), /scoring-prototype|scoring-ab|scoring-variant/i, file);
  }
  // game.js still hands every rule TUNING; the fade lives inside speedScore.
  const game = readFileSync(new URL('../src/game.js', import.meta.url), 'utf8');
  assert.match(game, /updateScoring\(game\.scoring, \{[\s\S]*?\}, dt, T\);/);
});

// --- In the game: Classic and Power ----------------------------------------------------
// Classic's drive is pinned to v0.2.0 by test/support/keyboard-baseline.json. Power's is pinned
// here to 6ffe6bf, the release that introduced it: every tick's car, laps and clock and the
// final ghost, with the scores now earned under the fade.
const power = JSON.parse(readFileSync(new URL('support/power-drive-baseline.json', import.meta.url)));
const DRIVERS = { gripDriver, driftDriver, recklessDriver: (await import('./support/drivers.mjs')).recklessDriver };
test('the Power baseline is for the current scoring rules', () => {
  assert.equal(power.scoring, SCORING_VERSION);
  assert.equal(power.handling, 'revised');
});
for (const expected of power.results) {
  test(`Power drives exactly as at ${power.baseline} and scores under the fade: ${expected.track} / ${expected.driver}`, () => {
    const game = createGame(trackById(expected.track));
    startRun(game, { handling: handlingById('revised') });
    const driver = DRIVERS[expected.driver]();
    const drive = createHash('sha256');
    while (game.ticks < 60000 && game.state !== 'finished') {
      tick(game, driver(game));
      drive.update(JSON.stringify([game.car, game.laps, game.runTime]));
    }
    drive.update(JSON.stringify(game.ghost));
    assert.equal(drive.digest('hex'), expected.driveHash, 'the car, laps, clock and ghost are unchanged');
    assert.equal(game.ticks, expected.ticks);
    assert.equal(game.scoring.score, expected.score);
    assert.ok(game.scoring.score <= expected.legacyScore, 'the fade never pays more');
  });
}

test('in both modes on both circuits, low-speed handbrake pulsing now scores below skilled drifting', () => {
  // From the two baselines: recklessDriver chatters the handbrake near 12 m/s in every corner.
  const classic = JSON.parse(readFileSync(new URL('support/keyboard-baseline.json', import.meta.url)));
  for (const results of [classic.results, power.results]) {
    for (const track of ['original', 'switchback']) {
      const score = (driver) => results.find((r) => r.track === track && r.driver === driver).score;
      assert.ok(score('recklessDriver') < score('driftDriver') * 0.3, `${track}: ${score('recklessDriver')} vs ${score('driftDriver')}`);
    }
  }
});

// Stationary and near-stationary patterns stay worthless in both modes on both circuits.
for (const mode of HANDLING_MODES) {
  for (const trackId of ['original', 'switchback']) {
    test(`donuts and circling earn nothing with ${mode.name} on ${trackId}`, () => {
      const patterns = [
        () => ({ ...NO_INPUT, up: true, right: true, handbrake: true }),
        (t) => ({ ...NO_INPUT, up: true, right: true, handbrake: t % 1.6 < 0.3 }),
        (t) => ({ ...NO_INPUT, up: true, left: true, handbrake: Math.floor(t * 120) % 2 === 0 }),
        () => ({ ...NO_INPUT, down: true, left: true }),
      ];
      for (const [i, pattern] of patterns.entries()) {
        const game = createGame(trackById(trackId));
        startRun(game, { handling: mode, ghost: false });
        tick(game, { ...NO_INPUT, up: true });
        for (let t = 0; t < 40; t += dt) tick(game, pattern(t));
        const total = game.scoring.score + (game.scoring.combo?.points ?? 0);
        assert.ok(total < 50, `pattern ${i} earned ${total}`);
        assert.equal(game.laps.completed, 0);
      }
    });
  }
}

// Low-skill continuous inputs over full runs: clean racing-line steering with the handbrake
// chattered (50% duty, above 11 m/s) at eight rates, from 60 Hz down to 1.7 Hz. Each run is
// pinned, with its score under the shipped scoring-1 rules at 6ffe6bf (the same drive: the car
// is unchanged). [current, scoring-1]
const CHATTER = {
  'classic/original/2': [1971, 10976], 'classic/original/4': [1891, 11333], 'classic/original/8': [2910, 11415], 'classic/original/16': [4981, 11094],
  'classic/original/24': [9351, 14058], 'classic/original/36': [13908, 16776], 'classic/original/48': [14488, 15341], 'classic/original/72': [15342, 16128],
  'classic/switchback/2': [2029, 14186], 'classic/switchback/4': [1750, 11655], 'classic/switchback/8': [2625, 12300], 'classic/switchback/16': [5972, 14871],
  'classic/switchback/24': [8887, 14951], 'classic/switchback/36': [17009, 21483], 'classic/switchback/48': [8751, 9464], 'classic/switchback/72': [21187, 22324],
  'revised/original/2': [1859, 10932], 'revised/original/4': [1914, 10116], 'revised/original/8': [2833, 11612], 'revised/original/16': [5917, 13477],
  'revised/original/24': [11336, 17986], 'revised/original/36': [5685, 7527], 'revised/original/48': [8328, 9064], 'revised/original/72': [10953, 11393],
  'revised/switchback/2': [1903, 13301], 'revised/switchback/4': [1742, 11843], 'revised/switchback/8': [2719, 12728], 'revised/switchback/16': [5446, 15261],
  'revised/switchback/24': [7001, 13408], 'revised/switchback/36': [11434, 15832], 'revised/switchback/48': [21959, 24473], 'revised/switchback/72': [21586, 23509],
};
// What this shows. The fade never pays more than scoring-1 for the same drive, so it opens no
// new route. Fast chatter (7.5 Hz and up), the pulsing the fade targets, loses 55-86% and falls
// below skilled drifting. Slower rhythmic tapping (about 2-3 Hz) keeps the car above
// 15 m/s, so the fade barely touches it, and it still outscores driftDriver on slow laps. That
// is the known same-side relink (N3) and release-reset (N2) behaviour of the research, both
// explicitly out of scope here: these pins record it rather than accept it as intended.
test('handbrake chatter at any rate: never paid more than before, and fast chatter is crushed', () => {
  const classic = JSON.parse(readFileSync(new URL('support/keyboard-baseline.json', import.meta.url)));
  for (const mode of HANDLING_MODES) {
    const results = mode.id === 'classic' ? classic.results : power.results;
    for (const trackId of ['original', 'switchback']) {
      const skilled = results.find((r) => r.track === trackId && r.driver === 'driftDriver').score;
      for (const period of [2, 4, 8, 16, 24, 36, 48, 72]) {
        const key = `${mode.id}/${trackId}/${period}`;
        const game = createGame(trackById(trackId));
        startRun(game, { handling: mode, ghost: false });
        const steer = gripDriver();
        let n = 0;
        while (game.state !== 'finished' && game.ticks < 60000) {
          const keys = steer(game);
          n += 1;
          tick(game, { ...keys, handbrake: n % period < period / 2 && game.car.speed > 11 });
        }
        assert.equal(game.state, 'finished', key);
        const [pinned, legacy] = CHATTER[key];
        assert.equal(game.results.score, pinned, key);
        assert.ok(pinned <= legacy, `${key}: the fade never pays more`);
        if (period <= 16) {
          assert.ok(pinned < skilled, `${key}: ${pinned} vs skilled ${skilled}`);
          assert.ok(pinned < legacy * 0.45, `${key}: fast chatter loses more than half`);
        }
      }
    }
  }
});
