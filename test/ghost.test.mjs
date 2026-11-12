// The previous-lap ghost, driven through whole laps of the real session.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { TUNING as T } from '../src/tuning.js';
import { buildTrack } from '../src/track.js';
import { createGame, startRun, restartRun, togglePause, toggleGhost, tick, advance, NO_INPUT } from '../src/game.js';
import {
  GHOST_FORMAT, SAMPLE_EVERY, MAX_RECORDED_TICKS,
  createGhost, beginGhostRecording, recordGhostTick, ghostPoseAt, ghostDisplay, ghostIsCompatible,
} from '../src/ghost.js';
import { gripDriver, driftDriver, recklessDriver } from './support/drivers.mjs';

const THROTTLE = { ...NO_INPUT, up: true };
const TICKS_PER_SECOND = Math.round(1 / T.simStep);

function newRun() {
  const game = createGame();
  startRun(game);
  return { game, driver: gripDriver() };
}

// Drives until the next line crossing, returning the car's pose on every tick of the lap.
function driveLap({ game, driver }, { onTick } = {}) {
  const serial = game.lapEventSerial;
  const trace = [];
  let budget = 200 * TICKS_PER_SECOND;
  while (game.lapEventSerial === serial && game.state !== 'finished') {
    assert.ok((budget -= 1) > 0, 'the lap ended');
    if (onTick) onTick(game);
    tick(game, driver(game));
    trace.push({ x: game.car.x, y: game.car.y, heading: game.car.heading });
  }
  return trace;
}

function makeRecording(track, poses) {
  const ghost = createGhost(track);
  const [first, ...rest] = poses;
  beginGhostRecording(ghost, ...first);
  rest.forEach((pose, i) => recordGhostTick(ghost, ...pose, i === rest.length - 1 ? 'lap' : null));
  return { ghost, recording: ghost.replay };
}

// --- 1. The first lap --------------------------------------------------------
test('there is no ghost at any point on the first lap', () => {
  const run = newRun();
  assert.equal(run.game.ghost.replay, null);
  assert.equal(ghostDisplay(run.game.ghost, 0, 0, 0), null);
  driveLap(run, {
    onTick(game) {
      assert.equal(game.ghost.replay, null);
      assert.equal(ghostDisplay(game.ghost, game.ghost.lapTick, game.car.x, game.car.y), null);
    },
  });
  assert.equal(run.game.laps.completed, 1);
  assert.ok(run.game.ghost.replay, 'the ghost arrives when the first valid lap ends');
});

test('nothing is recorded while the car waits on the grid', () => {
  const { game } = newRun();
  for (let i = 0; i < 300; i += 1) tick(game, { ...NO_INPUT, left: true });
  assert.equal(game.ghost.recording, null);
  assert.equal(game.ghost.lapTick, 0);
  const grid = { x: game.car.x, y: game.car.y, heading: game.car.heading };
  tick(game, THROTTLE);
  const { recording } = game.ghost;
  assert.deepEqual({ x: recording.x[0], y: recording.y[0], heading: recording.heading[0] }, grid);
  assert.equal(recording.ticks[0], 0);
  assert.equal(game.ghost.lapTick, 1);
});

// --- 2. Recording a valid lap ------------------------------------------------
test('a valid lap is recorded at about 30 samples per second, on simulation ticks', () => {
  const run = newRun();
  const trace = driveLap(run);
  const { game } = run;
  const { replay } = game.ghost;
  assert.equal(SAMPLE_EVERY, 4);
  assert.equal(replay.durationTicks, trace.length);
  const seconds = replay.durationTicks * T.simStep;
  const rate = (replay.ticks.length - 1) / seconds;
  assert.ok(rate >= 29.9 && rate <= 30.1, `${rate} samples per second`);
  assert.ok(replay.ticks.every(Number.isInteger));
  for (let i = 0; i < replay.ticks.length - 1; i += 1) {
    assert.equal(replay.ticks[i], i * SAMPLE_EVERY);
    assert.ok(replay.ticks[i + 1] > replay.ticks[i]);
  }
  // Every sample is exactly where the car was on that tick. trace[n - 1] follows tick n.
  for (let i = 1; i < replay.ticks.length; i += 1) {
    const pose = trace[replay.ticks[i] - 1];
    assert.equal(replay.x[i], pose.x);
    assert.equal(replay.y[i], pose.y);
    assert.equal(replay.heading[i], pose.heading);
  }
  assert.equal(replay.ticks.at(-1), replay.durationTicks, 'the last sample is on the line crossing');
});

test('a recording carries the metadata a later version would need to check it', () => {
  const run = newRun();
  driveLap(run);
  const { ghost, track } = run.game;
  const { replay } = ghost;
  assert.equal(replay.format, GHOST_FORMAT);
  assert.equal(replay.track, createGhost(track).track);
  assert.match(replay.track, /^[0-9a-f]{8}$/);
  assert.match(replay.rules, /^[0-9a-f]{8}$/);
  assert.equal(replay.tickRate, TICKS_PER_SECOND);
  assert.equal(replay.sampleEvery, SAMPLE_EVERY);
  // No inputs, speeds or scores: this is a picture of a lap, not a way to reproduce it.
  assert.deepEqual(Object.keys(replay).sort(), ['durationTicks', 'format', 'heading', 'rules', 'sampleEvery', 'ticks', 'tickRate', 'track', 'x', 'y'].sort());
});

// --- First-lap alignment and lap timing --------------------------------------
test('the ghost clock matches the lap timer on every tick, through laps and voids', () => {
  const { game, driver } = newRun();
  let voided = false;
  while (game.state !== 'finished') {
    if (!voided && game.laps.completed === 1 && game.laps.next === game.track.gates.length) {
      game.laps.valid = false;
      voided = true;
    }
    tick(game, driver(game));
    if (game.state === 'racing') {
      assert.ok(Math.abs(game.ghost.lapTick * T.simStep - game.laps.lapTime) < 1e-6, `${game.ghost.lapTick} ticks, ${game.laps.lapTime} s`);
    }
  }
  assert.equal(game.laps.voided, 1);
  assert.equal(game.laps.completed, 3);
});

test('each recording runs for exactly the official lap time', () => {
  const run = newRun();
  for (let lap = 0; lap < 3; lap += 1) {
    driveLap(run);
    assert.ok(Math.abs(run.game.ghost.replay.durationTicks * T.simStep - run.game.laps.lastLap) < 1e-6);
  }
});

test('the first lap starts on the grid past the line, later laps start at the line', () => {
  const run = newRun();
  const { game } = run;
  const grid = { x: game.car.x, y: game.car.y };
  driveLap(run);
  const first = game.ghost.replay;
  assert.equal(first.x[0], grid.x);
  assert.equal(first.y[0], grid.y);
  assert.ok(Math.abs(grid.x - game.track.points[0].x - 6) < 0.1, 'the grid is 6 m past the line');
  const crossing = { x: game.car.x, speed: game.car.speed };

  driveLap(run);
  const second = game.ghost.replay;
  assert.equal(second.x[0], crossing.x, 'it starts where the previous lap ended');
  assert.ok(Math.abs(second.x[0] - game.track.points[0].x) <= crossing.speed * T.simStep + 1e-6, 'within one tick of the line');
  // The other half of the alignment difference: the first lap begins at rest.
  const secondsIn = (recording, t) => ghostPoseAt(recording, t * TICKS_PER_SECOND).x - recording.x[0];
  assert.ok(secondsIn(first, 1) < secondsIn(second, 1) / 1.5, 'a standing start covers less ground than a flying one');
});

test('rolling back over the line on the grid does not restart the recording', () => {
  const { game } = newRun();
  const backward = { ...NO_INPUT, down: true };
  while (game.car.x > game.track.points[0].x - 4) tick(game, backward);
  const ticksSoFar = game.ghost.lapTick;
  assert.ok(ticksSoFar > 0);
  while (game.car.forwardSpeed < 0 || game.car.x < game.track.points[0].x + 4) tick(game, THROTTLE);
  assert.equal(game.lapEventSerial, 0, 'the lap rules ignored it');
  assert.ok(game.ghost.lapTick > ticksSoFar, 'the same recording carried on');
  assert.equal(game.ghost.replay, null);
  assert.equal(game.ghost.recording.ticks[0], 0);
});

// --- 3. Playback on later laps -----------------------------------------------
test('lap 2 replays lap 1, and lap 3 replays lap 2', () => {
  const run = newRun();
  const { game } = run;
  const lap1 = driveLap(run);
  const firstReplay = game.ghost.replay;
  assert.equal(game.ghost.lapTick, 0, 'playback starts from the beginning');

  const lap2 = driveLap(run, {
    onTick({ ghost, car }) {
      assert.equal(ghost.replay, firstReplay);
      if (ghost.lapTick === 0 || ghost.lapTick > lap1.length) return;
      const shown = ghostDisplay(ghost, ghost.lapTick, car.x, car.y);
      const truth = lap1[ghost.lapTick - 1];
      assert.ok(Math.hypot(shown.x - truth.x, shown.y - truth.y) < 0.1, `off by ${Math.hypot(shown.x - truth.x, shown.y - truth.y)} m at tick ${ghost.lapTick}`);
      assert.ok(Math.abs(shown.heading - truth.heading) < 0.02, `heading at tick ${ghost.lapTick}`);
    },
  });
  const secondReplay = game.ghost.replay;
  assert.notEqual(secondReplay, firstReplay, 'the second lap replaced the first');
  assert.equal(secondReplay.durationTicks, lap2.length);

  driveLap(run, {
    onTick({ ghost }) { assert.equal(ghost.replay, secondReplay); },
  });
  assert.equal(game.state, 'finished');
});

test('a whole run stops recording when it finishes', () => {
  const run = newRun();
  const { game, driver } = run;
  while (game.state !== 'finished') tick(game, driver(game));
  const { lapTick } = game.ghost;
  assert.equal(lapTick, 0);
  assert.equal(advance(game, 0.2, THROTTLE), 0);
  assert.equal(game.ghost.lapTick, lapTick);
});

// --- 4. Interpolation --------------------------------------------------------
test('position and heading are interpolated between samples', () => {
  const track = buildTrack();
  const poses = Array.from({ length: SAMPLE_EVERY * 3 }, (_, i) => [i * 2, 10, 0.1 + i * 0.05]);
  const { recording } = makeRecording(track, poses);
  for (const t of [0, 1, 2.5, 3.99, SAMPLE_EVERY, SAMPLE_EVERY + 0.5, 7.25]) {
    const pose = ghostPoseAt(recording, t);
    assert.ok(Math.abs(pose.x - t * 2) < 1e-9, `x at ${t}: ${pose.x}`);
    assert.equal(pose.y, 10);
    assert.ok(Math.abs(pose.heading - (0.1 + t * 0.05)) < 1e-9, `heading at ${t}`);
  }
});

test('heading takes the short way across the +/-180 degree seam, in both directions', () => {
  const track = buildTrack();
  const makeTurn = (from, to) => makeRecording(track, [[0, 0, from], [1, 0, from], [2, 0, from], [3, 0, from], [4, 0, to]]).recording;
  const unit = (a) => Math.atan2(Math.sin(a), Math.cos(a));
  const up = ghostPoseAt(makeTurn(Math.PI - 0.1, -Math.PI + 0.1), 2);
  assert.ok(Math.abs(Math.abs(unit(up.heading)) - Math.PI) < 1e-9, `midway is at the seam, not through zero: ${up.heading}`);
  const down = ghostPoseAt(makeTurn(-Math.PI + 0.1, Math.PI - 0.1), 2);
  assert.ok(Math.abs(Math.abs(unit(down.heading)) - Math.PI) < 1e-9, `${down.heading}`);
  // Headings in the real game keep counting past a full turn.
  const many = ghostPoseAt(makeTurn(20 * Math.PI - 0.1, 20 * Math.PI + 0.1), 2);
  assert.ok(Math.abs(unit(many.heading)) < 1e-9, `${many.heading}`);
});

test('motion is continuous: interpolated steps stay in proportion through a real drift lap', () => {
  const game = createGame();
  startRun(game);
  const driver = driftDriver();
  while (game.laps.completed < 1) tick(game, driver(game));
  const { replay } = game.ghost;
  let previous = ghostPoseAt(replay, 0);
  const frame = TICKS_PER_SECOND / 60;
  for (let t = frame; t < replay.durationTicks; t += frame) {
    const pose = ghostPoseAt(replay, t);
    // Nothing on four wheels covers more than this in a 60 Hz frame.
    assert.ok(Math.hypot(pose.x - previous.x, pose.y - previous.y) < T.topSpeed * 1.2 / 60, `position jump at tick ${t}`);
    assert.ok(Math.abs(pose.heading - previous.heading) < 0.35, `heading jump at tick ${t}`);
    previous = pose;
  }
});

test('playback holds at both ends of the recording', () => {
  const { recording } = makeRecording(buildTrack(), [[1, 2, 0.5], [2, 2, 0.5], [3, 2, 0.5], [4, 2, 0.5], [5, 2, 0.5]]);
  assert.equal(ghostPoseAt(recording, -1).x, 1, 'before the start');
  assert.equal(ghostPoseAt(recording, 0).x, 1);
  assert.equal(ghostPoseAt(recording, 4).x, 5);
  assert.equal(ghostPoseAt(recording, 400).x, 5, 'after the end');
});

test('a lap ending between sample ticks is still placed exactly on its final pose', () => {
  const poses = Array.from({ length: SAMPLE_EVERY + 3 }, (_, i) => [i, 0, 0]); // ends off the grid
  const { recording } = makeRecording(buildTrack(), poses);
  assert.deepEqual(recording.ticks, [0, SAMPLE_EVERY, SAMPLE_EVERY + 2]);
  assert.ok(Math.abs(ghostPoseAt(recording, SAMPLE_EVERY + 1).x - (SAMPLE_EVERY + 1)) < 1e-9);
  assert.equal(ghostPoseAt(recording, SAMPLE_EVERY + 2).x, SAMPLE_EVERY + 2);
});

// --- Staying out of the player's way -----------------------------------------
test('the ghost fades in at the lap start and fades out at the end of its recording', () => {
  const { ghost, recording } = makeRecording(buildTrack(), Array.from({ length: 600 }, (_, i) => [i, 0, 0]));
  const far = (t) => ghostDisplay(ghost, t, 1e6, 1e6);
  assert.equal(far(-1).opacity, 0);
  assert.equal(far(0).opacity, 0);
  assert.ok(far(10).opacity > 0 && far(10).opacity < far(100).opacity, 'fading in');
  const full = far(100).opacity;
  assert.ok(full >= 0.4 && full <= 0.8, `translucent, but visible: ${full}`);
  const end = recording.durationTicks;
  assert.equal(far(end).opacity, full);
  assert.ok(far(end + 30).opacity < full, 'fading out on the line');
  assert.equal(far(end + 30).x, recording.x.at(-1), 'and no longer moving');
  assert.equal(far(end + 60), null, 'then gone for the rest of a slow lap');
});

test('the ghost thins out when it overlaps the player, and always stays translucent', () => {
  const { ghost } = makeRecording(buildTrack(), Array.from({ length: 600 }, () => [0, 0, 0]));
  const at = (distance) => ghostDisplay(ghost, 100, distance, 0).opacity;
  assert.ok(at(0) < at(100) / 3, `${at(0)} against ${at(100)}`);
  assert.ok(at(0) > 0, 'still there');
  assert.ok(at(5) > at(0) && at(5) < at(9));
  assert.equal(at(9), at(100));
  assert.ok(at(100) < 1);
});

// --- 5. Voided laps ----------------------------------------------------------
test('a voided lap does not replace the last valid recording', () => {
  const run = newRun();
  const { game } = run;
  driveLap(run);
  const valid = game.ghost.replay;
  const copy = JSON.stringify(valid);

  driveLap(run, {
    onTick(g) { if (g.laps.next >= 4) g.laps.valid = false; },
  });
  assert.equal(game.lapEvent, 'void');
  assert.equal(game.laps.voided, 1);
  assert.equal(game.laps.completed, 1, 'still counting the same lap');
  assert.equal(game.ghost.replay, valid);
  assert.equal(JSON.stringify(game.ghost.replay), copy);
  assert.equal(game.ghost.lapTick, 0, 'the ghost restarts at the line with the player');
  assert.ok(ghostDisplay(game.ghost, 100, game.car.x, game.car.y), 'and is still showing');

  driveLap(run);
  assert.equal(game.lapEvent, 'lap');
  assert.notEqual(game.ghost.replay, valid, 'the next valid lap takes over');
});

test('a voided first lap leaves no ghost, and the next valid lap creates one', () => {
  const run = newRun();
  const { game } = run;
  driveLap(run, {
    onTick(g) { if (g.laps.next >= 4) g.laps.valid = false; },
  });
  assert.equal(game.lapEvent, 'void');
  assert.equal(game.ghost.replay, null);
  const flying = driveLap(run);
  assert.equal(game.lapEvent, 'lap');
  assert.equal(game.ghost.replay.durationTicks, flying.length);
  assert.ok(Math.abs(game.ghost.replay.durationTicks * T.simStep - game.laps.lastLap) < 1e-6, 'measured from the line, not the grid');
});

test('an unreasonably long lap is not kept, and memory stays bounded', () => {
  const track = buildTrack();
  const ghost = createGhost(track);
  beginGhostRecording(ghost, 0, 0, 0);
  recordGhostTick(ghost, 1, 0, 0, 'lap');
  const kept = ghost.replay;
  for (let i = 0; i < MAX_RECORDED_TICKS + 500; i += 1) recordGhostTick(ghost, i, 0, 0, null);
  const samples = ghost.recording.ticks.length;
  assert.ok(samples <= MAX_RECORDED_TICKS / SAMPLE_EVERY + 1, `${samples} samples`);
  recordGhostTick(ghost, 1, 0, 0, 'lap');
  assert.equal(ghost.replay, kept);
  assert.equal(ghost.lapTick, 0);
});

// --- 6. Pausing --------------------------------------------------------------
test('pausing freezes the ghost, and resuming continues from the same place', () => {
  const run = newRun();
  const { game, driver } = run;
  driveLap(run);
  for (let i = 0; i < 1000; i += 1) tick(game, driver(game));

  const pausedAt = game.ghost.lapTick;
  const seen = ghostDisplay(game.ghost, pausedAt, game.car.x, game.car.y);
  const length = game.ghost.recording.ticks.length;
  togglePause(game);
  for (let i = 0; i < 20; i += 1) assert.equal(advance(game, 0.1, THROTTLE), 0);
  assert.equal(game.ghost.lapTick, pausedAt);
  assert.equal(game.ghost.recording.ticks.length, length);
  assert.deepEqual(ghostDisplay(game.ghost, game.ghost.lapTick, game.car.x, game.car.y), seen);

  togglePause(game);
  const stepped = advance(game, 0.1, driver(game));
  assert.equal(game.ghost.lapTick, pausedAt + stepped);
  assert.ok(stepped > 0);
});

test('the recording is the same at any frame rate, including very low ones', () => {
  const play = (fps) => {
    const game = createGame();
    startRun(game);
    const frames = Math.round(4 * fps);
    for (let i = 0; i < frames; i += 1) advance(game, 1 / fps, { ...THROTTLE, right: i / fps >= 2 });
    return game;
  };
  // Input changes on the 2 s mark, which each of these frame rates lands on.
  const reference = play(120);
  for (const fps of [10, 15, 30, 60, 240]) {
    const game = play(fps);
    assert.equal(game.ghost.lapTick, reference.ghost.lapTick, `${fps} fps`);
    assert.deepEqual(game.ghost.recording.ticks, reference.ghost.recording.ticks, `${fps} fps`);
    for (const axis of ['x', 'y', 'heading']) {
      game.ghost.recording[axis].forEach((value, i) => {
        assert.ok(Math.abs(value - reference.ghost.recording[axis][i]) < 1e-6, `${fps} fps ${axis} sample ${i}`);
      });
    }
  }
});

// --- 7. Restart --------------------------------------------------------------
test('restarting clears the ghost and the recording in progress', () => {
  const run = newRun();
  const { game, driver } = run;
  driveLap(run);
  for (let i = 0; i < 200; i += 1) tick(game, driver(game));
  assert.ok(game.ghost.replay);
  assert.ok(game.ghost.lapTick > 0);

  restartRun(game);
  assert.equal(game.ghost.replay, null);
  assert.equal(game.ghost.recording, null);
  assert.equal(game.ghost.lapTick, 0);
  assert.equal(ghostDisplay(game.ghost, 100, 0, 0), null);
  for (let i = 0; i < 10; i += 1) tick(game, THROTTLE);
  assert.equal(game.ghost.replay, null, 'the new run starts with no ghost');
});

test('a run started from the results screen has no ghost either', () => {
  const { game, driver } = newRun();
  while (game.state !== 'finished') tick(game, driver(game));
  assert.ok(game.ghost.replay);
  startRun(game);
  assert.equal(game.ghost.replay, null);
});

// --- 8. The visibility toggle ------------------------------------------------
test('the toggle only changes visibility, keeps recording, and survives a restart', () => {
  const run = newRun();
  const { game } = run;
  assert.equal(game.ghostVisible, true);
  assert.equal(toggleGhost(game), false);
  assert.equal(game.ghostVisible, false);
  driveLap(run);
  assert.ok(game.ghost.replay, 'it records while hidden, so it can be brought back mid-run');
  assert.equal(toggleGhost(game), true);
  assert.equal(toggleGhost(game), false);
  restartRun(game);
  assert.equal(game.ghostVisible, false, 'a preference, not part of the run');
  assert.equal(game.ghost.replay, null);
  toggleGhost(game);
  assert.equal(game.ghostVisible, true);
});

test('G is free: no other control uses it', () => {
  const main = readFileSync(new URL('../src/main.js', import.meta.url), 'utf8');
  assert.equal(main.match(/KeyG/g).length, 1);
  const codes = [...main.matchAll(/\b(Key[A-Z]|Arrow[A-Za-z]+|Space|Enter)\b/g)].map((m) => m[1]);
  // v0.3.0 added H (handling, on the title only); the inventory is otherwise v0.2.0's.
  assert.deepEqual([...new Set(codes)].sort(), ['ArrowDown', 'ArrowLeft', 'ArrowRight', 'ArrowUp', 'Enter', 'KeyD', 'KeyG', 'KeyH', 'KeyN', 'KeyO', 'KeyP', 'KeyR', 'Space']);
});

// --- 9. Compatibility with the active track ----------------------------------
test('a recording from another track, format or rule set is never shown', () => {
  const home = buildTrack();
  const elsewhere = buildTrack([[-60, -110], [120, -110], [192, -4], [118, 62], [0, 156], [-96, 128], [-20, 6], [-204, -66]]);
  assert.notEqual(createGhost(home).track, createGhost(elsewhere).track);
  assert.equal(createGhost(home).track, createGhost(buildTrack()).track, 'the same circuit is recognised after a rebuild');

  const { ghost, recording } = makeRecording(home, Array.from({ length: 100 }, (_, i) => [i, 0, 0]));
  assert.equal(ghostIsCompatible(ghost, recording), true);
  assert.ok(ghostDisplay(ghost, 50, 0, 0));

  const wrong = createGhost(elsewhere);
  wrong.replay = recording;
  assert.equal(ghostIsCompatible(wrong, recording), false);
  assert.equal(ghostDisplay(wrong, 50, 0, 0), null);

  for (const change of [{ format: GHOST_FORMAT + 1 }, { rules: '00000000' }, { tickRate: 60 }]) {
    ghost.replay = { ...recording, ...change };
    assert.equal(ghostDisplay(ghost, 50, 0, 0), null, JSON.stringify(change));
  }
});

test('the game records against its own track', () => {
  const track = buildTrack();
  const game = createGame(track);
  assert.equal(game.ghost.track, createGhost(track).track);
});

// --- 10. No effect on the game -----------------------------------------------
// Everything the simulation keeps, apart from the ghost and things that hold it.
function simulationState(game) {
  const { ghost, ghostVisible, track, ...rest } = game;
  return JSON.stringify(rest);
}

const DRIVERS = { grip: gripDriver, drift: driftDriver, reckless: recklessDriver };

for (const [name, makeDriver] of Object.entries(DRIVERS)) {
  test(`a ${name} run is identical on every tick with the ghost removed, hidden or shown`, () => {
    const shown = createGame();
    const hidden = createGame();
    const removed = createGame();
    for (const game of [shown, hidden, removed]) startRun(game);
    toggleGhost(hidden);
    removed.ghost = null;
    const drivers = [makeDriver(), makeDriver(), makeDriver()];
    let checked = 0;
    while (shown.state !== 'finished') {
      assert.ok(checked < 500 * TICKS_PER_SECOND, 'the run finished');
      [shown, hidden, removed].forEach((game, i) => tick(game, drivers[i](game)));
      const expected = simulationState(removed);
      assert.equal(simulationState(shown), expected, `shown, tick ${checked}`);
      assert.equal(simulationState(hidden), expected, `hidden, tick ${checked}`);
      checked += 1;
    }
    assert.equal(hidden.state, 'finished');
    assert.equal(removed.state, 'finished');
    assert.deepEqual(shown.results, removed.results);
    assert.deepEqual(hidden.results, removed.results);
    assert.ok(shown.ghost.replay);
    assert.equal(removed.ghost, null);
  });
}

test('toggling the ghost and reading its pose mid-run change nothing', () => {
  const plain = createGame();
  const busy = createGame();
  startRun(plain);
  startRun(busy);
  const a = driftDriver();
  const b = driftDriver();
  let ticks = 0;
  while (plain.state !== 'finished') {
    tick(plain, a(plain));
    tick(busy, b(busy));
    if (ticks % 37 === 0) toggleGhost(busy);
    ghostDisplay(busy.ghost, busy.ghost.lapTick, busy.car.x, busy.car.y);
    ticks += 1;
  }
  assert.deepEqual(busy.results, plain.results);
  assert.equal(simulationState(busy), simulationState(plain));
});

test('the ghost module cannot reach the simulation: it imports only the tuning values', () => {
  const source = readFileSync(new URL('../src/ghost.js', import.meta.url), 'utf8');
  assert.deepEqual([...source.matchAll(/from\s+'([^']+)'/g)].map((m) => m[1]), ['./tuning.js']);
  // Its write side takes numbers. Only the two calls in the session feed it.
  const session = readFileSync(new URL('../src/game.js', import.meta.url), 'utf8');
  assert.match(session, /beginGhostRecording\(game\.ghost, car\.x, car\.y, car\.heading\)/);
  assert.match(session, /recordGhostTick\(game\.ghost, car\.x, car\.y, car\.heading, lapResult\)/);
  // Physics, scoring and lap rules know nothing about it.
  for (const file of ['physics.js', 'scoring.js', 'laps.js', 'track.js', 'tuning.js', 'audio.js', 'audio-telemetry.js', 'audio-voices.js', 'coyote.js', 'coyote-model.js']) {
    const text = readFileSync(new URL(`../src/${file}`, import.meta.url), 'utf8');
    assert.doesNotMatch(text, /ghost/i, file);
  }
});
