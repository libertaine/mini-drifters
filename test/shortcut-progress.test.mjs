// B2: an infield shortcut must never turn road the car has already covered into new ground.
import test from 'node:test';
import assert from 'node:assert/strict';
import { TUNING as T } from '../src/tuning.js';
import { trackById, trackDelta } from '../src/track.js';
import { createGame, startRun, restartRun, tick } from '../src/game.js';
import { gripDriver, driftDriver, recklessDriver } from './support/drivers.mjs';
import { cutterDriver, creditMeter, onRoadBetween } from './support/exploit-drivers.mjs';

const steps = (seconds) => Math.round(seconds / T.simStep);
// What the scoring may still be told is new on each shortcut: the projection hops a metre
// or two on the inside of a hairpin, so a few metres either side of the high-water mark.
const PER_CUT_ALLOWANCE = 8;

// Makes `cuts` shortcuts, then stops once the car is back at the point it cut from. Only the
// road between the two ends of the cut, which the car had covered before its first cut, is
// metered: the road it carries on to while turning off is genuinely new.
function farm(trackId, makeBase, cut, cuts) {
  const game = createGame(trackById(trackId));
  startRun(game);
  const driver = cutterDriver(makeBase(), { ...cut, times: cuts });
  const meter = creditMeter(game, tick, onRoadBetween(game.track, cut.to, cut.from - 2));
  let before = null;
  while (game.ticks < steps(600) && game.state !== 'finished') {
    meter.step(driver(game));
    if (before === null && driver.cuts() === 1) before = meter.credited;
    const toCut = trackDelta(game.track, game.trackS, cut.from);
    if (driver.cuts() === cuts && !driver.cutting() && toCut > 0 && toCut < 2) break;
  }
  return { game, driver, afterFirstCut: meter.credited - before };
}

// Found by searching each circuit for road that comes close to road further back.
const BACKWARD_CUTS = [
  ['original', 'back 78 m over the hairpin infield (the smallest reliable case)', driftDriver, { from: 740, to: 662 }],
  ['original', 'back about 350 m across the infield', gripDriver, { from: 830, to: 480 }],
  ['original', 'back about 780 m, more than half a lap, so it reads as a jump forward', gripDriver, { from: 884, to: 104 }],
  ['switchback', 'back 75 m across a hairpin', gripDriver, { from: 920, to: 845 }],
];
for (const [trackId, label, base, cut] of BACKWARD_CUTS) {
  test(`${trackId}: a shortcut ${label} earns no new ground, pass after pass`, () => {
    const cuts = 6;
    const { driver, afterFirstCut, game } = farm(trackId, base, cut, cuts);
    assert.equal(driver.cuts(), cuts, 'the driver made every cut');
    assert.equal(game.laps.completed + game.laps.voided, 0, 'the loop never reaches the line');
    assert.ok(afterFirstCut <= cuts * PER_CUT_ALLOWANCE, `credited ${afterFirstCut.toFixed(0)} m of re-driven road over ${cuts} cuts`);
  });
}

// The few metres a cut may still be paid for come out of a fixed allowance: the run can
// never be paid for more ground than the checkpoints say it has really covered, plus that
// allowance. So repeating a cut a hundred times is worth no more than repeating it a few.
const STRESS = [
  ['original', driftDriver, { from: 740, to: 662 }, 200],
  ['original', gripDriver, { from: 830, to: 480 }, 60],
  ['original', gripDriver, { from: 884, to: 104 }, 40],
  ['switchback', driftDriver, { from: 920, to: 845 }, 200],
];
for (const [trackId, base, cut, loops] of STRESS) {
  test(`${trackId}: ${loops} repeated cuts back from ${cut.from} m earn nothing after the first few`, () => {
    const game = createGame(trackById(trackId));
    startRun(game);
    const driver = cutterDriver(base(), { ...cut, times: loops });
    const early = 10;
    let atEarly = null;
    let worstLead = -Infinity;
    while (game.ticks < steps(loops * 60) && !(driver.cuts() === loops && !driver.cutting())) {
      tick(game, driver(game));
      worstLead = Math.max(worstLead, game.credited - game.reached);
      if (atEarly === null && driver.cuts() === early) {
        atEarly = { credited: game.credited, score: game.scoring.score, bestCombo: game.scoring.bestCombo, reached: game.reached };
      }
    }
    assert.equal(driver.cuts(), loops, 'the driver made every cut');
    assert.equal(game.state, 'racing');
    assert.equal(game.laps.completed, 0, 'the loop never completes a valid lap');
    assert.equal(game.laps.voided, 0, 'the loop never voids a lap either: it never reaches the line');
    assert.ok(worstLead <= 4 + 1e-9, `paid ${worstLead.toFixed(2)} m beyond the furthest real position`);
    // The car turns off a few centimetres later on some passes. That road is genuinely new,
    // and it is all that may be paid for once the allowance is spent.
    const realGain = game.reached - atEarly.reached;
    const paid = game.credited - atEarly.credited;
    assert.ok(realGain < 5, `the car really got ${realGain.toFixed(2)} m further`);
    assert.ok(paid <= realGain + 1e-6, `paid ${paid.toFixed(2)} m for ${realGain.toFixed(2)} m of real progress between cut ${early} and cut ${loops}`);
    assert.equal(game.scoring.score, atEarly.score, `scored ${game.scoring.score - atEarly.score} between cut ${early} and cut ${loops}`);
    assert.equal(game.scoring.bestCombo, atEarly.bestCombo, `best combo moved from ${atEarly.bestCombo} to ${game.scoring.bestCombo}`);
  });
}

test('original: road skipped by a cut forward cannot be spent on cuts back, beyond the allowance', () => {
  const game = createGame(trackById('original'));
  startRun(game);
  // The forward chord skips about 160 m of road; each cut back then re-drives 350 m.
  const forward = cutterDriver(gripDriver(), { from: 562, to: 800, times: 1 });
  const back = cutterDriver(forward, { from: 830, to: 480, times: 20 });
  let worstLead = -Infinity;
  let reachedAtFirst = null;
  let creditedAtFirst = null;
  while (game.ticks < steps(1500) && !(back.cuts() === 20 && !back.cutting())) {
    tick(game, back(game));
    worstLead = Math.max(worstLead, game.credited - game.reached);
    if (reachedAtFirst === null && back.cuts() === 1) { reachedAtFirst = game.reached; creditedAtFirst = game.credited; }
  }
  assert.equal(back.cuts(), 20);
  assert.ok(worstLead <= 4 + 1e-9);
  // Everything paid after the first cut back fits inside what the forward cut skipped.
  assert.ok(game.credited - creditedAtFirst <= reachedAtFirst + 4 - creditedAtFirst + (game.reached - reachedAtFirst));
  assert.ok(game.credited - creditedAtFirst <= 4 * 20, `paid ${(game.credited - creditedAtFirst).toFixed(0)} m over 20 cuts back`);
});

test('original: a shortcut forward and then repeated ones back earn nothing either', () => {
  const game = createGame(trackById('original'));
  startRun(game);
  const forward = cutterDriver(gripDriver(), { from: 562, to: 800, times: 1 });
  const back = cutterDriver(forward, { from: 830, to: 480, times: 3 });
  const meter = creditMeter(game, tick, onRoadBetween(game.track, 480, 828));
  let before = null;
  while (game.ticks < steps(400) && !(back.cuts() === 3 && !back.cutting() && game.trackS > 820)) {
    meter.step(back(game));
    if (before === null && back.cuts() === 1) before = meter.credited;
  }
  assert.equal(forward.cuts(), 1);
  assert.equal(back.cuts(), 3);
  assert.ok(meter.credited - before <= 3 * PER_CUT_ALLOWANCE, `credited ${(meter.credited - before).toFixed(0)} m of re-driven road`);
});

test('original: turning round on the start straight and coming back over the line earns nothing twice', () => {
  const game = createGame(trackById('original'));
  startRun(game);
  const driver = cutterDriver(gripDriver(), { from: 150, to: game.track.length - 100, times: 1, rejoin: 8 });
  const meter = creditMeter(game, tick, onRoadBetween(game.track, game.track.length - 100, 140));
  let before = null;
  while (game.ticks < steps(90)) {
    meter.step(driver(game));
    if (before === null && driver.cuts() === 1) before = meter.credited;
    if (driver.cuts() === 1 && !driver.cutting() && game.trackS > 140 && game.trackS < 150) break;
  }
  assert.equal(driver.cuts(), 1);
  assert.ok(meter.credited - before <= PER_CUT_ALLOWANCE, `credited ${(meter.credited - before).toFixed(0)} m`);
});

// Guards: legitimate driving must keep every metre of new ground it earns today.
for (const trackId of ['original', 'switchback']) {
  for (const [name, make] of Object.entries({ gripDriver, driftDriver, recklessDriver })) {
    test(`${trackId} / ${name}: every step that reaches new ground is credited, over a whole run`, () => {
      const game = createGame(trackById(trackId));
      startRun(game);
      const driver = make();
      let withheld = 0;
      while (game.state !== 'finished' && game.ticks < steps(600)) {
        const furthest = game.furthest;
        tick(game, driver(game));
        if (game.state === 'racing' && game.furthest > furthest && game.scoring.sinceNewGround !== 0) withheld += 1;
      }
      assert.equal(game.state, 'finished');
      assert.equal(game.laps.completed, T.runLaps);
      assert.equal(withheld, 0);
    });
  }
}

test('original: a restart after farming starts from fresh ground, the same as a brand-new run', () => {
  const { game } = farm('original', gripDriver, { from: 740, to: 662 }, 3);
  restartRun(game);
  const fresh = createGame(trackById('original'));
  startRun(fresh);
  // The drivers read the game clock, so line the two clocks up.
  game.ticks = fresh.ticks;
  const a = gripDriver();
  const b = gripDriver();
  const ma = creditMeter(game, tick);
  const mb = creditMeter(fresh, tick);
  while (fresh.ticks < steps(90)) {
    ma.step(a(game));
    mb.step(b(fresh));
  }
  assert.equal(game.progress, fresh.progress);
  assert.equal(ma.credited, mb.credited);
  assert.ok(mb.credited > 500);
});
