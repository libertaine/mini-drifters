import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { Controller, readStandardPad, NEUTRAL_DRIVE, STICK_DEAD_ZONE, TRIGGER_DEAD_ZONE } from '../src/controller.js';
import { drivingCommands, InputArbiter } from '../src/controls.js';
import { createCar, stepCar } from '../src/physics.js';
import { createGame, startRun, tick } from '../src/game.js';
import { trackById } from '../src/track.js';
import { TUNING as T } from '../src/tuning.js';
import { createTutorial, updateTutorial, TUTORIAL_STEPS, tutorialView } from '../src/tutorial.js';
import { gripDriver, driftDriver, recklessDriver, lessonDriver } from './support/drivers.mjs';

const pad = (extra = {}) => ({ index: 0, id: 'Mock standard controller', mapping: 'standard', connected: true,
  axes: [0, 0, 0, 0], buttons: Array.from({ length: 17 }, () => ({ value: 0, pressed: false })), ...extra });
function rig() {
  let pads = [pad()];
  const controller = new Controller(() => pads);
  controller.poll();
  const set = (change) => { Object.assign(pads[0], change); return controller.poll(); };
  const button = (i, value) => { pads[0].buttons[i] = { value, pressed: value > 0.5 }; return controller.poll(); };
  return { controller, set, button, pads: (value) => { pads = value; return controller.poll(); } };
}
function asPad(keys, partial = false) {
  const p = pad({ axes: [(keys.right ? 1 : 0) - (keys.left ? 1 : 0), 0, 0, 0] });
  p.buttons[7].value = keys.up ? (partial ? 0.8 : 1) : 0;
  p.buttons[6].value = keys.down ? (partial ? 0.8 : 1) : 0;
  p.buttons[0].pressed = !!keys.handbrake;
  return p;
}

test('only connected, complete standard mappings are recognized; no hardware ID assumptions', () => {
  for (const id of ['Xbox', 'DualSense', 'Unknown USB']) assert.ok(readStandardPad(pad({ id })));
  for (const p of [null, {}, pad({ connected: false }), pad({ mapping: '' }), pad({ axes: [0] }), pad({ buttons: [] })]) assert.equal(readStandardPad(p), null);
});

test('stick dead zone is rescaled continuously and preserves both full boundaries', () => {
  for (const x of [0, STICK_DEAD_ZONE, -STICK_DEAD_ZONE, NaN, Infinity, undefined]) {
    assert.equal(readStandardPad(pad({ axes: [x, 0, 0, 0] })).drive.steer, 0);
  }
  for (const x of [-2, -1, -0.575, 0.575, 1, 2]) {
    const steer = readStandardPad(pad({ axes: [x, 0, 0, 0] })).drive.steer;
    assert.ok(Math.abs(steer - Math.sign(x) * (Math.abs(x) === 0.575 ? 0.5 : 1)) < 1e-12);
  }
});

test('RT and LT retain partial travel, rejecting noise and invalid values', () => {
  for (const value of [0, TRIGGER_DEAD_ZONE, -1, NaN, Infinity, undefined, 0.5, 1, 2]) {
    const p = pad();
    p.buttons[6].value = p.buttons[7].value = value;
    const drive = readStandardPad(p).drive;
    const expected = Number.isFinite(value) && value > TRIGGER_DEAD_ZONE ? Math.min(1, value) : 0;
    assert.equal(drive.accelerator, expected);
    assert.equal(drive.brake, expected);
  }
});

test('A/B/X/Y/Menu and all D-pad actions use rising edges, including release then repress', () => {
  for (const [name, index] of Object.entries({ confirm: 0, back: 1, ghost: 2, radio: 3, pause: 9, up: 12, down: 13, left: 14, right: 15 })) {
    const r = rig();
    assert.equal(r.button(index, 1).pressed[name], true);
    assert.equal(r.controller.poll().pressed[name], false);
    assert.equal(r.button(index, 0).pressed[name], false);
    assert.equal(r.button(index, 1).pressed[name], true);
  }
});

test('connect, reset and reconnect require all mapped controls neutral; held A cannot become handbrake', () => {
  const r = rig();
  r.button(0, 1);
  r.button(7, 1);
  r.controller.reset();
  assert.deepEqual(r.controller.poll().drive, NEUTRAL_DRIVE);
  r.button(0, 0);
  assert.deepEqual(r.controller.poll().drive, NEUTRAL_DRIVE);
  r.button(7, 0);
  assert.equal(r.button(7, 0.5).drive.accelerator, 0.5);
  assert.equal(r.pads([]).lost, true);
  const held = pad(); held.buttons[7].value = 1;
  assert.deepEqual(r.pads([held]).drive, NEUTRAL_DRIVE);
  r.button(7, 0);
  assert.equal(r.button(7, 1).drive.accelerator, 1);
});

test('missing/throwing Gamepad APIs fail closed and loss is reported once', () => {
  assert.equal(new Controller(null).poll().unavailable, true);
  const c = new Controller(() => { throw new Error('Denied'); });
  assert.equal(c.poll().unavailable, true);
  const r = rig();
  assert.equal(r.pads([]).lost, true);
  assert.equal(r.controller.poll().lost, false);
});

test('the selected controller is sticky; unplugging an unused pad does not lose it', () => {
  const r = rig();
  const second = pad({ index: 1, id: 'Second' });
  r.pads([second, pad()]);
  assert.equal(r.controller.current.index, 0);
  assert.equal(r.controller.disconnect(1), false);
  assert.equal(r.pads([pad()]).lost, false);
  assert.equal(r.controller.disconnect(0), true);
  assert.equal(r.controller.current, null);
});

test('replacing a device at the same index counts as a disconnect and requires neutral', () => {
  const r = rig();
  assert.equal(r.pads([pad({ id: 'Replacement' })]).lost, true);
  assert.equal(r.controller.poll().connected, true);
  assert.deepEqual(r.controller.poll().drive, NEUTRAL_DRIVE);
});

test('neutral pad never masks keyboard; keyboard wins until pad has been released', () => {
  const a = new InputArbiter();
  const keys = { up: true, left: true };
  assert.equal(a.resolve(keys, NEUTRAL_DRIVE), keys);
  const held = { ...NEUTRAL_DRIVE, accelerator: 1 };
  assert.equal(a.resolve(keys, held), keys);
  assert.deepEqual(a.resolve({}, held), {});
  a.resolve({}, NEUTRAL_DRIVE);
  assert.equal(a.resolve({}, held), held);
  assert.equal(a.source, 'controller');
  assert.deepEqual(a.resolve({}, NEUTRAL_DRIVE), NEUTRAL_DRIVE);
  a.reset();
  assert.deepEqual(a.resolve({}, held), {});
});

test('analog commands are bounded and invalid fields are neutral; Boolean keyboard retains its targets', () => {
  assert.deepEqual(drivingCommands({ up: true, down: true, left: true, right: true }), { steer: 0, accelerator: 1, brake: 1, handbrake: false });
  assert.deepEqual(drivingCommands({ steer: -3, accelerator: 4, brake: -1 }), { steer: -1, accelerator: 1, brake: 0, handbrake: false });
  assert.deepEqual(drivingCommands({ steer: NaN, accelerator: Infinity, brake: '1', up: true }), NEUTRAL_DRIVE);
});

test('half trigger and half stick settle at half targets through the same smoothing', () => {
  const car = createCar();
  for (let i = 0; i < 120; i++) stepCar(car, { steer: -0.5, accelerator: 0.5 }, 'road', T.simStep);
  assert.equal(car.steer, -0.5);
  assert.equal(car.throttle, 0.5);
  assert.equal(car.brake, 0);
  const moving = createCar(); moving.vx = 30;
  for (let i = 0; i < 30; i++) stepCar(moving, { brake: 0.5 }, 'road', T.simStep);
  assert.equal(moving.brake, 0.5);
  assert.equal(moving.reversing, false);
});

test('partial LT brakes forward then reverses; partial RT brakes reverse then accelerates', () => {
  const car = createCar(); car.vx = 10;
  for (let i = 0; i < 1200; i++) stepCar(car, { brake: 0.5 }, 'road', T.simStep);
  assert.equal(car.reversing, true);
  assert.equal(car.throttle, 0.5);
  assert.ok(car.forwardSpeed < 0);
  for (let i = 0; i < 1200; i++) stepCar(car, { accelerator: 0.5 }, 'road', T.simStep);
  assert.equal(car.reversing, false);
  assert.ok(car.forwardSpeed > 0);
});

test('simultaneous triggers preserve the keyboard both-pedals brake/neutral policy', () => {
  for (const speed of [-10, 0, 10]) {
    const car = createCar(); car.vx = speed;
    stepCar(car, { accelerator: 0.5, brake: 0.75 }, 'road', T.simStep);
    assert.equal(car.throttle, 0);
    assert.equal(car.reversing, false);
    assert.equal(car.brake > 0, speed >= T.reverseEngageSpeed);
  }
});

const baseline = JSON.parse(readFileSync(new URL('support/keyboard-baseline.json', import.meta.url)));
for (const expected of baseline.results) {
  test(`keyboard and full-travel controller match main ${baseline.baseline}: ${expected.track} / ${expected.driver}`, () => {
    for (const controller of [false, true]) {
      const game = createGame(trackById(expected.track)); startRun(game);
      const driver = { gripDriver, driftDriver, recklessDriver }[expected.driver]();
      const hash = createHash('sha256');
      while (game.ticks < 60000 && game.state !== 'finished') {
        const keys = driver(game);
        tick(game, controller ? readStandardPad(asPad(keys)).drive : keys);
        hash.update(JSON.stringify([game.car, game.scoring, game.laps, game.runTime]));
      }
      hash.update(JSON.stringify(game.ghost));
      assert.equal(hash.digest('hex'), expected.hash);
      assert.equal(game.ticks, expected.ticks);
      assert.equal(game.scoring.score, expected.score);
    }
  });
}

test('controller completes all five tutorial concepts on the real car and scoring', () => {
  const game = createGame(); startRun(game, { ghost: false });
  const t = createTutorial(); const driver = lessonDriver(); const seen = new Set();
  for (let i = 0; i < 36000 && t.phase !== 'complete'; i++) {
    const id = TUTORIAL_STEPS[t.step].id; seen.add(id);
    tick(game, readStandardPad(asPad(driver(game, id))).drive);
    if (i % 2) updateTutorial(t, game);
  }
  assert.equal(t.phase, 'complete');
  assert.equal(seen.size, 5);
  assert.deepEqual(t.skipped, []);
  assert.ok(t.bankedPoints > 0);
  assert.equal(game.ghost, null);
  const view = tutorialView(createTutorial(), 'controller');
  assert.match(view.text, /RT/);
});
