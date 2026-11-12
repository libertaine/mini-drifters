// Handling modes: the registry, how a session carries its mode, Classic's equivalence to
// v0.2.0, ghost and practice-pad isolation, and the B1/B2 integrity rules under every mode.
// Records by mode and their migration are in handling-records.test.mjs.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { TUNING as T, TUNING } from '../src/tuning.js';
import { trackById, trackDelta } from '../src/track.js';
import { createGame, startRun, restartRun, returnToMenu, tick, NO_INPUT } from '../src/game.js';
import { createGhost, ghostDisplay, ghostIsCompatible } from '../src/ghost.js';
import { readStandardPad } from '../src/controller.js';
import { padTrack, PRACTICE_PAD_ID } from '../src/practice-pad.js';
import { HANDLING_MODES, HANDLING_IDS, DEFAULT_HANDLING, DEFAULT_HANDLING_ID, RETIRED_HANDLING_IDS, handlingById } from '../src/handling.js';
import { createRecords } from '../src/records.js';
import { gripDriver, driftDriver, recklessDriver } from './support/drivers.mjs';
import { cutterDriver } from './support/exploit-drivers.mjs';

const steps = (seconds) => Math.round(seconds / T.simStep);
const [CLASSIC, REVISED] = ['classic', 'revised'].map(handlingById); // REVISED is shown as Power
const NONE = { score: null, fastestLap: null, bestCombo: null };

function memoryStorage() {
  const map = new Map();
  const writes = [];
  return { map, writes, getItem: (k) => (map.has(k) ? map.get(k) : null), setItem: (k, v) => { writes.push(k); map.set(k, String(v)); } };
}

// A short, stable fingerprint of a mode's numbers, for the change detector below.
function tuningFingerprint(tuning) {
  const text = JSON.stringify(Object.keys(tuning).sort().map((k) => [k, tuning[k]]));
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i += 1) { hash ^= text.charCodeAt(i); hash = Math.imul(hash, 0x01000193); }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

// --- 1. The registry ------------------------------------------------------------------
test('two public modes, Classic then Power, each a complete frozen configuration', () => {
  assert.deepEqual(HANDLING_MODES.map((m) => m.id), ['classic', 'revised']);
  assert.deepEqual(HANDLING_IDS, ['classic', 'revised']);
  assert.deepEqual(HANDLING_MODES.map((m) => m.name), ['Classic', 'Power'], 'Power keeps the stable id `revised`');
  assert.deepEqual(HANDLING_MODES.map((m) => m.summary), [
    'Familiar, handbrake-focused drifting with forgiving handling.',
    'Break rear traction with throttle. More control, more consequences.',
  ]);
  for (const mode of HANDLING_MODES) {
    assert.ok(Object.isFrozen(mode) && Object.isFrozen(mode.tuning), `${mode.id} is immutable`);
    for (const key of Object.keys(TUNING)) assert.ok(key in mode.tuning, `${mode.id} defines ${key}`);
    assert.ok(mode.summary.length > 20 && mode.summary.length < 120, `${mode.id} has a short summary`);
    assert.doesNotMatch(mode.summary, /\b(easy|easier|hard|harder|difficult|beginner|expert|best)\b/i, `${mode.id}'s summary makes no difficulty claim`);
  }
  assert.equal(CLASSIC.tuning, TUNING, 'Classic is the shipped TUNING object itself');
  assert.equal(DEFAULT_HANDLING_ID, 'classic');
  assert.equal(DEFAULT_HANDLING, CLASSIC);
  for (const id of ['turbo', '__proto__', 'constructor', 'revised-low', 'tuned', 'power', 'Power', 'Classic', undefined]) assert.equal(handlingById(id), null);
});

test('Tuned Power is retired: not offered, not shipped, and its id is reserved so it can never name another mode', () => {
  assert.deepEqual(RETIRED_HANDLING_IDS, ['tuned']);
  assert.ok(Object.isFrozen(RETIRED_HANDLING_IDS));
  for (const id of RETIRED_HANDLING_IDS) {
    assert.equal(handlingById(id), null);
    assert.ok(!HANDLING_IDS.includes(id), `${id} is not a public mode`);
  }
  assert.ok(!HANDLING_MODES.some((m) => /tuned/i.test(m.name)));
  // Its tuning stays in the physics lab: the lab's distinctive numbers are not in the game.
  for (const file of readdirSync(new URL('../src/', import.meta.url))) {
    const source = readFileSync(new URL(`../src/${file}`, import.meta.url), 'utf8');
    assert.doesNotMatch(source, /powerOversteer: 0\.81|rearPowerSlideGrip: 0\.82|const TUNED\b/, file);
  }
});

// A change detector, not a design rule. These are the physics lab's fingerprints for the
// configurations the owner accepted (lab/HANDLING-MODES.md): Classic and Revised, shown as Power.
// They also prove the move out of the lab and the rename changed no number. If one fails, a mode's driving has changed: decide whether its
// records are still comparable, and if not give the mode a new id instead of new values here.
test('each mode\'s numbers are pinned to the accepted prototype (records are only comparable while these hold)', () => {
  const pinned = Object.fromEntries(HANDLING_MODES.map((m) => [m.id, tuningFingerprint(m.tuning)]));
  assert.deepEqual(pinned, { classic: 'a28e0bdc', revised: 'fbaaabad' });
});

test('no physics-lab code ships: no lab module, URL switch or lab-only mode in src/', () => {
  const files = readdirSync(new URL('../src/', import.meta.url));
  assert.ok(!files.includes('physics-lab.js') && !files.includes('handling-records.js'));
  for (const file of files) {
    const source = readFileSync(new URL(`../src/${file}`, import.meta.url), 'utf8');
    assert.doesNotMatch(source, /physics-lab|labSetup|migration-fixture|revised-low|PROTOTYPE/i, file);
  }
});

// --- 2. Classic is v0.2.0 -------------------------------------------------------------
// The v0.2.0 keyboard baseline hashes the car, scoring, laps and run time on every tick, then
// the whole ghost, including its identity. test/controller.test.mjs runs it, unchanged, through
// createGame's default mode. Here Classic is chosen explicitly from the registry, and the
// controller pass runs on a game that has just driven Revised, so a mode change provably
// leaves nothing behind. Every hash, tick count and score must match v0.2.0 exactly.
const baseline = JSON.parse(readFileSync(new URL('support/keyboard-baseline.json', import.meta.url)));
// The same mock pad as test/controller.test.mjs.
function asPad(keys) {
  const p = { index: 0, id: 'Mock standard controller', mapping: 'standard', connected: true,
    axes: [(keys.right ? 1 : 0) - (keys.left ? 1 : 0), 0, 0, 0], buttons: Array.from({ length: 17 }, () => ({ value: 0, pressed: false })) };
  p.buttons[7].value = keys.up ? 1 : 0;
  p.buttons[6].value = keys.down ? 1 : 0;
  p.buttons[0].pressed = !!keys.handbrake;
  return p;
}
for (const expected of baseline.results) {
  test(`Classic chosen from the registry is tick-for-tick v0.2.0 (${baseline.baseline}): ${expected.track} / ${expected.driver}`, () => {
    for (const controller of [false, true]) {
      const game = createGame(trackById(expected.track));
      if (controller) {
        startRun(game, { handling: REVISED });
        for (let i = 0; i < steps(8); i += 1) tick(game, { ...NO_INPUT, up: true, right: i > steps(2) });
        assert.ok(game.car.wheelspin > 0 && game.scoring.spinouts + game.car.speed > 0, 'the Revised run really drove');
      }
      startRun(game, { handling: CLASSIC });
      assert.equal(game.tuning, TUNING);
      const driver = { gripDriver, driftDriver, recklessDriver }[expected.driver]();
      const hash = createHash('sha256');
      while (game.ticks < 60000 && game.state !== 'finished') {
        const keys = driver(game);
        tick(game, controller ? readStandardPad(asPad(keys)).drive : keys);
        hash.update(JSON.stringify([game.car, game.scoring, game.laps, game.runTime]));
      }
      hash.update(JSON.stringify(game.ghost));
      assert.equal(hash.digest('hex'), expected.hash, controller ? 'controller, after Revised' : 'keyboard');
      assert.equal(game.ticks, expected.ticks);
      assert.equal(game.scoring.score, expected.score);
    }
  });
}

// --- 3. The session carries the mode --------------------------------------------------
test('a run takes the mode it is started with, names it in every event, and keeps it through restarts', () => {
  const events = [];
  const game = createGame(trackById('original'), { onRunEvent: (e) => events.push(e) });
  assert.equal(game.handling, CLASSIC, 'a new game is Classic');
  for (const mode of HANDLING_MODES) {
    startRun(game, { handling: mode });
    assert.equal(game.handling, mode);
    assert.equal(game.tuning, mode.tuning);
    restartRun(game);
    assert.equal(game.handling, mode, 'restart keeps the mode');
    restartRun(game, { mode: 'normal', ghost: true });
    assert.equal(game.tuning, mode.tuning);
  }
  const starts = events.filter((e) => e.type === 'start');
  assert.deepEqual(starts.map((e) => e.handling), ['classic', 'classic', 'classic', 'revised', 'revised', 'revised']);
  // Lap and finish events name it too.
  startRun(game, { handling: REVISED });
  const driver = gripDriver();
  while (game.state !== 'finished' && game.ticks < steps(400)) tick(game, driver(game));
  const tail = events.filter((e) => e.type === 'lap' || e.type === 'finish');
  assert.ok(tail.length >= 4);
  assert.ok(tail.every((e) => e.handling === 'revised'));
});

test('each mode drives with its own physics: only Revised builds wheelspin', () => {
  for (const mode of HANDLING_MODES) {
    const game = createGame(trackById('original'));
    startRun(game, { handling: mode });
    for (let i = 0; i < steps(1.5); i += 1) tick(game, { ...NO_INPUT, up: true, right: i > steps(0.5) });
    if (mode === REVISED) assert.equal(typeof game.car.wheelspin, 'number', mode.id);
    else assert.equal(game.car.wheelspin, undefined, `${mode.id} has no wheelspin state`);
  }
  // Same inputs, different results: the configurations really differ in play.
  const finalPose = (mode) => {
    const game = createGame(trackById('original'));
    startRun(game, { handling: mode });
    for (let i = 0; i < steps(6); i += 1) tick(game, { ...NO_INPUT, up: true, right: i > steps(2) });
    return `${game.car.x.toFixed(3)},${game.car.y.toFixed(3)}`;
  };
  assert.equal(new Set(HANDLING_MODES.map(finalPose)).size, 2);
});

test('switching modes starts from a fresh car, laps, score, combo and ghost', () => {
  const game = createGame(trackById('switchback'));
  startRun(game, { handling: REVISED });
  const driver = driftDriver();
  while (game.laps.completed < 1 && game.ticks < steps(200)) tick(game, driver(game));
  for (let i = 0; i < steps(2); i += 1) tick(game, { ...NO_INPUT, up: true, right: true });
  assert.ok(game.scoring.score > 0 && game.ghost.replay, 'the Revised run has a score and a ghost');
  assert.ok(game.car.wheelspin > 0, 'and its rear wheels are spinning');
  const oldRun = game.runId;

  startRun(game, { handling: CLASSIC });
  assert.equal(game.handling, CLASSIC);
  assert.equal(game.car.wheelspin, undefined, 'no wheelspin state carried into Classic');
  assert.deepEqual([game.car.x, game.car.y, game.car.heading, game.car.vx, game.car.vy, game.car.yawRate, game.car.throttle], [game.track.start.x, game.track.start.y, game.track.start.heading, 0, 0, 0, 0]);
  assert.equal(game.scoring.score, 0);
  assert.equal(game.scoring.combo, null);
  assert.equal(game.laps.completed, 0);
  assert.equal(game.laps.bestLap, null);
  assert.equal(game.credited, 0);
  assert.equal(game.forfeited, 0);
  assert.equal(game.results, null);
  assert.equal(game.ghost.replay, null, 'no ghost carried over');
  assert.equal(game.ghost.rules, createGhost(game.track).rules, 'the ghost has Classic\'s (v0.2.0\'s) identity');
  assert.equal(game.runId, oldRun + 1);
  assert.equal(game.state, 'ready');
});

test('the mode cannot change during a run, even if something assigns it', () => {
  const game = createGame(trackById('original'));
  startRun(game, { handling: CLASSIC });
  for (let i = 0; i < steps(1); i += 1) tick(game, { ...NO_INPUT, up: true });
  game.handling = REVISED; // a stray write: tick drives with the tuning fixed at the start
  for (let i = 0; i < steps(3); i += 1) tick(game, { ...NO_INPUT, up: true, right: true });
  assert.equal(game.tuning, TUNING);
  assert.equal(game.car.wheelspin, undefined, 'still Classic');
});

test('returning to the menu abandons the run; the next one starts clean in whatever mode is chosen', () => {
  const events = [];
  const game = createGame(trackById('original'), { onRunEvent: (e) => events.push(e) });
  startRun(game, { handling: REVISED });
  const driver = driftDriver();
  for (let i = 0; i < steps(30); i += 1) tick(game, driver(game));
  returnToMenu(game);
  assert.equal(events.at(-1).type, 'abandon');
  assert.equal(game.state, 'menu');
  startRun(game, { handling: CLASSIC });
  assert.equal(game.scoring.score, 0);
  assert.equal(game.car.wheelspin, undefined);
  assert.equal(events.at(-1).handling, 'classic');
});

test('game.js reads the mode\'s tuning only for the car and its ghost; every rule still reads TUNING', () => {
  const source = readFileSync(new URL('../src/game.js', import.meta.url), 'utf8');
  assert.equal(source.match(/game\.tuning/g).length, 3, 'set once in resetRun, then given to the ghost identity and stepCar');
  assert.match(source, /game\.tuning = game\.handling\.tuning;/);
  assert.match(source, /createGhost\(track, game\.tuning\)/);
  assert.match(source, /stepCar\(car, input, surfaceFromDistance\(track, game\.trackInfo\.distance\), dt, game\.tuning\)/);
  assert.match(source, /updateScoring\(game\.scoring, \{[\s\S]*?\}, dt, T\);/);
  assert.match(source, /function resolveBarrier\(game\) \{\s*const \{ car, track \} = game;\s*const T = TUNING;/);
});

// --- 4. Ghosts ------------------------------------------------------------------------
// A ghost's `rules` identity is a fingerprint of the tuning its lap was driven with, so a lap
// from another mode is refused by the same check that refuses another rule set.
test('a ghost recorded in one mode is never shown in another, and is not carried across a mode change', () => {
  const game = createGame(trackById('original'));
  startRun(game, { handling: CLASSIC });
  const driver = gripDriver();
  while (game.laps.completed < 1 && game.ticks < steps(200)) tick(game, driver(game));
  const classicLap = game.ghost.replay;
  assert.ok(classicLap);
  assert.ok(ghostIsCompatible(game.ghost, classicLap));
  const identities = HANDLING_MODES.map((m) => createGhost(game.track, m.tuning).rules);
  assert.equal(new Set(identities).size, 2, 'every mode has its own identity');
  assert.equal(classicLap.rules, createGhost(game.track).rules, 'Classic keeps v0.2.0\'s identity');

  for (const mode of [REVISED]) {
    startRun(game, { handling: mode });
    assert.equal(game.ghost.replay, null, 'a new run has no ghost');
    // Even handed one directly, the session refuses the Classic lap.
    assert.equal(ghostIsCompatible(game.ghost, classicLap), false);
    game.ghost.replay = classicLap;
    assert.equal(ghostDisplay(game.ghost, 100, 0, 0), null);
  }
  // The same mode on another circuit refuses it as well.
  startRun(game, { handling: CLASSIC, track: trackById('switchback') });
  assert.equal(ghostIsCompatible(game.ghost, classicLap), false);
  // And the same mode on the same circuit accepts it: the check is on identity, not luck.
  startRun(game, { handling: CLASSIC, track: trackById('original') });
  assert.ok(ghostIsCompatible(game.ghost, classicLap));
});

test('a Power lap is shown to a later Power lap of the same run, and never to Classic', () => {
  const game = createGame(trackById('original'));
  startRun(game, { handling: REVISED });
  const driver = gripDriver();
  while (game.laps.completed < 2 && game.ticks < steps(300)) tick(game, driver(game));
  const revisedLap = game.ghost.replay;
  assert.ok(revisedLap && ghostIsCompatible(game.ghost, revisedLap));
  assert.ok(ghostDisplay(game.ghost, 50, game.car.x, game.car.y) !== undefined);
  assert.equal(ghostIsCompatible(createGhost(game.track, CLASSIC.tuning), revisedLap), false, 'classic');
  // Nor to a run on the other circuit in the same mode.
  assert.equal(ghostIsCompatible(createGhost(trackById('switchback'), REVISED.tuning), revisedLap), false, 'switchback');
});

test('restart keeps the mode, and its ghost starts again from nothing, as in v0.2.0', () => {
  const game = createGame(trackById('original'));
  startRun(game, { handling: REVISED });
  const driver = gripDriver();
  while (game.laps.completed < 1 && game.ticks < steps(200)) tick(game, driver(game));
  assert.ok(game.ghost.replay);
  restartRun(game);
  assert.equal(game.handling, REVISED);
  assert.equal(game.ghost.replay, null);
  assert.equal(game.ghost.rules, createGhost(game.track, REVISED.tuning).rules);
});

// --- 5. The practice pad --------------------------------------------------------------
function practice(mode, records, seconds = 40) {
  const events = [];
  const game = createGame(trackById('original'), { onRunEvent: (e) => { events.push(e); records?.handle(e); } });
  startRun(game, { track: padTrack(), mode: 'practice', ghost: false, handling: mode });
  for (let i = 0; i < steps(seconds); i += 1) {
    const t = i * T.simStep;
    // Donut attempts, figure-eights, handbrake pulls and a hard run into the wall.
    const phase = Math.floor(t / 5) % 4;
    tick(game, { up: true, down: false, left: phase === 1 || phase === 3, right: phase === 0 || phase === 2, handbrake: phase === 2 && t % 5 < 0.3 });
  }
  return { game, events };
}

for (const mode of HANDLING_MODES) {
  test(`practice pad with ${mode.name}: its mode, free driving, no score, laps, ghost or record writes`, () => {
    const storage = memoryStorage();
    const records = createRecords(() => storage);
    const { game, events } = practice(mode, records);
    assert.equal(game.handling, mode);
    assert.equal(game.tuning, mode.tuning);
    assert.equal(game.track.id, PRACTICE_PAD_ID);
    assert.equal(game.mode, 'practice');
    assert.equal(game.state, 'racing', 'a pad session never finishes');
    assert.ok(game.runTime > 30, 'the car was driven');
    assert.ok(Math.hypot(game.car.x - game.track.start.x, game.car.y - game.track.start.y) > 20, 'the car left the grid');
    // Scoring is skipped, not merely hidden: nothing is ever counted on the pad.
    assert.equal(game.scoring.score, 0);
    assert.equal(game.scoring.combo, null);
    assert.equal(game.scoring.spinouts, 0);
    assert.equal(game.scoring.eventSerial, 0);
    assert.equal(game.laps.completed + game.laps.voided, 0);
    assert.equal(game.laps.next, 0);
    assert.equal(game.ghost, null);
    assert.equal(game.results, null);
    assert.deepEqual(events.map((e) => e.type), ['start']);
    assert.equal(events[0].mode, 'practice');
    assert.deepEqual(storage.writes, []);
    // Restart on the pad: same mode, back at the start.
    restartRun(game, { ghost: false, mode: 'practice' });
    assert.equal(game.handling, mode);
    assert.equal(game.track.id, PRACTICE_PAD_ID);
    assert.deepEqual([game.car.x, game.car.y, game.car.vx], [game.track.start.x, game.track.start.y, 0]);
    assert.deepEqual(storage.writes, []);
  });
}

test('even with a ghost asked for, a practice session has none', () => {
  const game = createGame();
  startRun(game, { track: padTrack(), mode: 'practice', ghost: true, handling: REVISED });
  assert.equal(game.ghost, null);
  for (let i = 0; i < steps(20); i += 1) tick(game, { ...NO_INPUT, up: true, right: Math.floor(i / steps(3)) % 2 === 0, left: Math.floor(i / steps(3)) % 2 === 1 });
  assert.equal(game.ghost, null);
  restartRun(game, { mode: 'practice' });
  assert.equal(game.ghost, null, 'nor after a restart that forgets to say so');
});

test('the pad\'s own guards hold even if it were driven as a normal run: no lap, no ghost lap, no record', () => {
  const storage = memoryStorage();
  const records = createRecords(() => storage);
  const game = createGame(trackById('original'), { onRunEvent: (e) => records.handle(e) });
  startRun(game, { track: padTrack(), handling: REVISED }); // mode 'normal', ghost on
  for (let i = 0; i < steps(60); i += 1) tick(game, { ...NO_INPUT, up: true, right: Math.floor(i / steps(3)) % 2 === 0, left: Math.floor(i / steps(3)) % 2 === 1 });
  assert.equal(game.laps.completed + game.laps.voided, 0, 'the pad has no line to cross');
  assert.equal(game.ghost.replay, null);
  assert.deepEqual(storage.writes, [], 'and its id is not a circuit the records keeper accepts');
});

test('a circuit run after the pad starts clean, and records only its own track and mode', () => {
  const storage = memoryStorage();
  const records = createRecords(() => storage);
  const { game } = practice(REVISED, records, 30);
  startRun(game, { track: trackById('original'), handling: REVISED });
  assert.equal(game.mode, 'normal');
  assert.equal(game.scoring.score, 0);
  assert.equal(game.credited, 0);
  assert.equal(game.runTime, 0);
  assert.ok(game.ghost && game.ghost.replay === null);
  const driver = gripDriver();
  while (game.state !== 'finished' && game.ticks < steps(400)) tick(game, driver(game));
  assert.equal(game.state, 'finished');
  assert.equal(records.forTrack('original', 'revised').fastestLap, game.results.bestLap);
  assert.equal(records.forTrack('original', 'revised').score, game.results.score);
  for (const id of HANDLING_IDS.filter((h) => h !== 'revised')) assert.deepEqual(records.forTrack('original', id), NONE);
  assert.deepEqual(records.forTrack('switchback', 'revised'), NONE);
});

// --- 6. Scoring integrity (B1, B2) under every mode ------------------------------------
// The rules are shared, so the v0.2.0 protections must hold whatever the car does. The
// exploit drivers were written for Classic, so each check also confirms the exploit was
// actually attempted before judging the result.
const VOIDING_CUTS = { original: { from: 562, to: 800 }, switchback: { from: 734, to: 972 } };
for (const mode of HANDLING_MODES) {
  for (const trackId of ['original', 'switchback']) {
    test(`B1 with ${mode.name} on ${trackId}: points from voided laps never reach the result or the records`, () => {
      const storage = memoryStorage();
      const records = createRecords(() => storage);
      const game = createGame(trackById(trackId), { onRunEvent: (e) => records.handle(e) });
      startRun(game, { handling: mode });
      const driver = cutterDriver(gripDriver(), { ...VOIDING_CUTS[trackId], times: 3 });
      let voidedPoints = 0;
      let lapStart = 0;
      let serial = 0;
      while (game.state !== 'finished' && game.ticks < steps(900)) {
        tick(game, driver(game));
        if (game.lapEventSerial !== serial) {
          serial = game.lapEventSerial;
          if (game.state !== 'finished' && game.lapEvent === 'void') voidedPoints += game.scoring.score - lapStart;
          lapStart = game.scoring.score;
        }
      }
      assert.equal(game.state, 'finished', 'the run finished');
      assert.ok(game.laps.voided >= 1, `the exploit voided ${game.laps.voided} laps`);
      assert.equal(game.results.forfeited, voidedPoints);
      assert.equal(game.results.score, game.scoring.score - voidedPoints);
      assert.equal(records.forTrack(trackId, mode.id).score, game.results.score);
      assert.ok(records.forTrack(trackId, mode.id).bestCombo <= game.results.score + 1);
      for (const other of HANDLING_IDS.filter((h) => h !== mode.id)) assert.deepEqual(records.forTrack(trackId, other), NONE);
    });
  }

  test(`B2 with ${mode.name}: forty cuts back across Original's hairpin infield earn nothing after the first few`, () => {
    const game = createGame(trackById('original'));
    startRun(game, { handling: mode });
    const cut = { from: 830, to: 480 };
    const loops = 40;
    const driver = cutterDriver(gripDriver(), { ...cut, times: loops });
    let worstLead = -Infinity;
    let early = null;
    while (game.ticks < steps(loops * 60) && !(driver.cuts() === loops && !driver.cutting()) && game.state !== 'finished') {
      tick(game, driver(game));
      worstLead = Math.max(worstLead, game.credited - game.reached);
      if (early === null && driver.cuts() === 5) early = { score: game.scoring.score, reached: game.reached, credited: game.credited };
    }
    assert.equal(driver.cuts(), loops, 'every cut was made');
    assert.equal(game.laps.completed, 0);
    assert.ok(worstLead <= 4 + 1e-9, `paid ${worstLead.toFixed(2)} m beyond the furthest real position`);
    const paid = game.credited - early.credited;
    assert.ok(paid <= game.reached - early.reached + 1e-6, `paid ${paid.toFixed(2)} m for no real progress`);
    assert.ok(trackDelta(game.track, game.trackS, cut.from) < 400);
  });
}
