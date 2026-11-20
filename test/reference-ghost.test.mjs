// Which laps become the saved reference ghost, driven through whole runs of the real session with
// the real records and the real store on an in-memory localStorage. The store's own rules are in
// test/ghost-store.test.mjs.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createGame, startRun, restartRun, returnToMenu, tick, togglePause, advance, toggleGhost, NO_INPUT } from '../src/game.js';
import { trackById } from '../src/track.js';
import { handlingById } from '../src/handling.js';
import { createRecords, RECORDS_KEY } from '../src/records.js';
import { SCORING_VERSION } from '../src/scoring.js';
import { createGhostStore, GHOST_STORE_KEY, GHOST_COMPATIBILITY, entryChecksum } from '../src/ghost-store.js';
import { createReferenceGhosts, slotState, GHOST_SOURCES, DEFAULT_GHOST_SOURCE } from '../src/reference-ghost.js';
import { readGhostPreference, writeGhostPreference, GHOST_PREFERENCE_KEY } from '../src/ghost-preferences.js';
import { ghostDisplay } from '../src/ghost.js';
import { padTrack } from '../src/practice-pad.js';
import { gripDriver, driftDriver } from './support/drivers.mjs';
import { PRECISION_180 } from '../src/gymkhana.js';

function memoryStorage(initial = {}) {
  const map = new Map(Object.entries(initial));
  return { map, writes: [], failWrites: null,
    getItem(key) { return map.has(key) ? map.get(key) : null; },
    setItem(key, value) { if (this.failWrites && key === GHOST_STORE_KEY) throw this.failWrites; this.writes.push(key); map.set(key, String(value)); },
  };
}

// The game as main.js wires it: records first, then the reference ghost, which hands the run
// its reference on every start and after every save.
function rig(storage = memoryStorage(), trackId = 'original') {
  const records = createRecords(() => storage);
  const refs = createReferenceGhosts({ store: createGhostStore(() => storage),
    bestLapFor: (t, h) => records.forTrack(t, h).fastestLap });
  const events = [];
  const game = createGame(trackById(trackId), { onRunEvent: (event) => {
    events.push(event);
    records.handle(event);
    refs.handle(event);
    if (event.type === 'start' || event.type === 'ghost') game.ghostReference = refs.recording;
  } });
  return { storage, records, refs, game, events };
}

// Drives to the next line crossing (or the end), with an optional hook before each tick.
function driveLap(game, driver, onTick) {
  const serial = game.lapEventSerial;
  while (game.lapEventSerial === serial && game.state !== 'finished') {
    assert.ok(game.ticks < 80000, 'the lap ended');
    onTick?.(game);
    tick(game, driver(game));
  }
}
const driveRun = (game, driver = gripDriver()) => { while (game.state !== 'finished') driveLap(game, driver); };
const savedEntry = (storage, t = 'original', h = 'classic') => JSON.parse(storage.map.get(GHOST_STORE_KEY) ?? 'null')?.ghosts?.[t]?.[h] ?? null;
const voidThisLap = (g) => { if (g.laps.next >= 4) g.laps.valid = false; };

test('the session offers each kept lap after the records have seen it, and before the run finishes', () => {
  const { game, events } = rig();
  startRun(game);
  driveRun(game);
  const types = events.map((e) => e.type);
  assert.deepEqual(types, ['start', 'lap', 'ghost', 'lap', 'ghost', 'lap', 'ghost', 'finish']);
  const ghosts = events.filter((e) => e.type === 'ghost');
  assert.deepEqual(ghosts.map((e) => e.flying), [false, true, true], 'lap 1 is a standing start');
  const laps = events.filter((e) => e.type === 'lap');
  ghosts.forEach((g, i) => {
    assert.equal(g.time, laps[i].time, 'the same lap time the records saw');
    assert.equal(g.runId, laps[i].runId);
    assert.equal(g.trackId, 'original');
    assert.equal(g.handling, 'classic');
  });
});

test('a valid first lap never becomes a saved ghost, though it still sets the fastest-lap record', () => {
  const { game, storage, records } = rig();
  startRun(game);
  driveLap(game, gripDriver());
  assert.equal(game.lapEvent, 'lap');
  assert.equal(records.forTrack('original', 'classic').fastestLap, game.laps.lastLap, 'lap-1 records are unchanged');
  assert.equal(storage.map.has(GHOST_STORE_KEY), false, 'no ghost write');
  assert.equal(game.ghostReference, null);
});

// The grip driver on Original in Classic laps in 48.067 s (standing start), 49.817 s and 45.983 s:
// the record set on lap 1 has no recording, and the slower lap 2 is the first flying lap.
test('a lap-1 record stays the record; the first flying lap is a reference until a lap beats the record', () => {
  const { game, storage, records, refs } = rig();
  startRun(game);
  const driver = gripDriver();
  driveLap(game, driver);
  const lap1 = game.laps.lastLap;
  assert.equal(records.forTrack('original', 'classic').fastestLap, lap1, 'lap 1 set the record');
  assert.equal(storage.map.has(GHOST_STORE_KEY), false);
  driveLap(game, driver);
  const lap2 = game.laps.lastLap;
  assert.ok(lap2 > lap1, 'this flying lap was slower than the standing start');
  let entry = savedEntry(storage);
  assert.equal(entry.lapTime, lap2);
  assert.equal(entry.kind, 'reference', 'not the record, and never claimed to be');
  assert.equal(records.forTrack('original', 'classic').fastestLap, lap1, 'the lap-1 record is kept');
  assert.equal(slotState(refs.slot, lap1), 'reference');
  assert.ok(game.ghostReference, 'the run is shown it straight away');
  assert.equal(game.ghostReference.durationTicks, game.ghost.replay.durationTicks);
  driveLap(game, driver);
  const lap3 = game.laps.lastLap;
  assert.ok(lap3 < lap1);
  entry = savedEntry(storage);
  assert.equal(entry.lapTime, lap3);
  assert.equal(entry.kind, 'best', 'lap 3 set a new record, so this recording is that record');
  assert.equal(records.forTrack('original', 'classic').fastestLap, lap3);
  assert.equal(slotState(refs.slot, lap3), 'best');
  assert.equal(refs.lastResult.saved, true);
});

test('a historical record with no recording is kept, and a slower flying lap is saved honestly as a reference', () => {
  // A best lap saved before v0.7.0 (or on a first lap): faster than this driver can go, no recording.
  const records3 = JSON.stringify({ version: 3, tracks: { original: { classic: { fastestLap: 30.5, scoring: { [SCORING_VERSION]: { score: 1234, bestCombo: 99 } } } } } });
  const storage = memoryStorage({ [RECORDS_KEY]: records3 });
  const { game, records, refs } = rig(storage);
  assert.equal(refs.peek('original', 'classic').status, 'none', 'nothing is invented for the old record');
  startRun(game);
  driveRun(game);
  const entry = savedEntry(storage);
  assert.ok(entry, 'the first flying lap set a reference');
  assert.equal(entry.kind, 'reference');
  assert.ok(entry.lapTime > 30.5);
  assert.equal(records.forTrack('original', 'classic').fastestLap, 30.5, 'the record is untouched');
  assert.equal(storage.map.get(RECORDS_KEY), records3, 'the records key byte-for-byte');
  assert.equal(slotState(refs.slot, 30.5), 'reference');
});

test('a faster flying lap improves a reference even while the historical record stands', () => {
  const records3 = JSON.stringify({ version: 3, tracks: { original: { classic: { fastestLap: 30.5, scoring: {} } } } });
  const storage = memoryStorage({ [RECORDS_KEY]: records3 });
  const { game, records } = rig(storage);
  startRun(game);
  const driver = gripDriver();
  driveLap(game, driver);
  driveLap(game, driver);
  const first = savedEntry(storage).lapTime;
  driveLap(game, driver);
  const lap3 = game.laps.lastLap;
  assert.ok(lap3 < first, 'lap 3 (45.983 s) is quicker than lap 2 (49.817 s)');
  assert.equal(savedEntry(storage).lapTime, lap3, 'so it replaced the reference');
  assert.equal(savedEntry(storage).kind, 'reference', 'still not the record');
  assert.equal(records.forTrack('original', 'classic').fastestLap, 30.5, 'which stands');
  assert.equal(JSON.parse(storage.map.get(RECORDS_KEY)).tracks.original.classic.fastestLap, 30.5);
});

test('a slower run never overwrites a personal-best recording, and the reference persists across runs', () => {
  const { game, storage, refs } = rig();
  startRun(game);
  driveRun(game, gripDriver()); // grip laps are the quick ones
  const best = savedEntry(storage);
  assert.equal(best.kind, 'best');
  const writes = storage.writes.filter((k) => k === GHOST_STORE_KEY).length;
  startRun(game); // a new run reloads the reference
  assert.equal(refs.slot.status, 'ok');
  assert.equal(refs.slot.lapTime, best.lapTime);
  assert.ok(game.ghostReference);
  driveRun(game, driftDriver()); // sideways and slower
  assert.deepEqual(savedEntry(storage), best, 'byte-for-byte the same lap');
  assert.equal(storage.writes.filter((k) => k === GHOST_STORE_KEY).length, writes, 'and not even rewritten');
  assert.equal(refs.lastResult.saved, false);
  assert.equal(refs.lastResult.reason, 'not faster');
});

test('a tie with the saved lap keeps what is saved', () => {
  const { game, storage, refs } = rig();
  startRun(game);
  driveRun(game, gripDriver());
  const before = storage.map.get(GHOST_STORE_KEY);
  // The identical run again: the same driver gives the same laps to the tick.
  startRun(game);
  driveRun(game, gripDriver());
  assert.equal(storage.map.get(GHOST_STORE_KEY), before);
  assert.equal(refs.lastResult.reason, 'not faster');
});

test('a voided lap is never offered or saved, and the next valid lap after it is a flying lap', () => {
  const { game, storage, events } = rig();
  startRun(game);
  const driver = gripDriver();
  driveLap(game, driver, voidThisLap); // lap 1 voided
  assert.equal(game.lapEvent, 'void');
  assert.equal(events.filter((e) => e.type === 'ghost').length, 0);
  driveLap(game, driver, voidThisLap); // and again
  assert.equal(storage.map.has(GHOST_STORE_KEY), false);
  driveLap(game, driver);
  assert.equal(game.lapEvent, 'lap');
  const offered = events.filter((e) => e.type === 'ghost');
  assert.equal(offered.length, 1);
  assert.equal(offered[0].flying, true, 'timed from the line, at speed');
  assert.equal(savedEntry(storage).lapTime, game.laps.lastLap);
});

test('a voided flying lap leaves the saved lap alone', () => {
  const { game, storage } = rig();
  startRun(game);
  const driver = gripDriver();
  driveLap(game, driver);
  driveLap(game, driver);
  const saved = storage.map.get(GHOST_STORE_KEY);
  driveLap(game, driver, voidThisLap);
  assert.equal(game.lapEvent, 'void');
  assert.equal(storage.map.get(GHOST_STORE_KEY), saved);
});

test('abandoned or restarted laps are never saved', () => {
  for (const leave of [(g) => returnToMenu(g), (g) => restartRun(g), (g) => startRun(g, { track: trackById('switchback') })]) {
    const { game, storage } = rig();
    startRun(game);
    const driver = gripDriver();
    driveLap(game, driver);
    for (let i = 0; i < 4000; i += 1) tick(game, driver(game)); // well into lap 2
    leave(game);
    assert.equal(storage.map.has(GHOST_STORE_KEY), false);
  }
});

test('a run only ever sees its own track and mode\'s reference', () => {
  const storage = memoryStorage();
  const { game, refs } = rig(storage);
  startRun(game);
  driveRun(game);
  const original = refs.slot.lapTime;
  startRun(game, { track: trackById('switchback') });
  assert.equal(game.ghostReference, null, 'nothing carried over to another circuit');
  assert.equal(refs.slot.status, 'none');
  driveRun(game);
  assert.equal(savedEntry(storage, 'switchback').kind, 'best');
  startRun(game, { track: trackById('original'), handling: handlingById('revised') });
  assert.equal(game.ghostReference, null, 'nor to another mode');
  assert.equal(refs.slot.status, 'none');
  startRun(game, { track: trackById('original'), handling: handlingById('classic') });
  assert.equal(refs.slot.lapTime, original);
  assert.ok(game.ghostReference);
  assert.equal(game.ghostReference.track, game.ghost.track);
  assert.equal(game.ghostReference.rules, game.ghost.rules);
  // Even handed one by mistake, the other circuit's ghost.js identity check refuses to draw it.
  const elsewhere = game.ghostReference;
  startRun(game, { track: trackById('dockyard') });
  assert.equal(ghostDisplay(game.ghost, 100, 0, 0, elsewhere), null);
});

test('lessons, the practice pad and gymkhana challenges never record, offer, save or show a reference', () => {
  const { game, storage, refs, events } = rig();
  startRun(game);
  driveRun(game);
  const saved = storage.map.get(GHOST_STORE_KEY);
  const offeredBefore = events.filter((e) => e.type === 'ghost').length;
  assert.equal(offeredBefore, 3, 'the circuit run offered its laps');
  const sessions = [
    { ghost: false, mode: 'tutorial' },
    { track: padTrack(), mode: 'practice', ghost: false },
    { mode: 'gymkhana', ghost: false, challenge: PRECISION_180 },
  ];
  for (const options of sessions) {
    startRun(game, options);
    assert.equal(game.ghost, null, options.mode);
    assert.equal(game.ghostReference, null, options.mode);
    assert.equal(refs.slot, null, options.mode);
    const driver = gripDriver();
    for (let i = 0; i < 12000 && game.state !== 'finished'; i += 1) tick(game, driver(game));
  }
  assert.equal(events.filter((e) => e.type === 'ghost').length, offeredBefore, 'none of them offered a lap');
  assert.ok(events.filter((e) => e.type === 'start').length === 4);
  assert.equal(storage.map.get(GHOST_STORE_KEY), saved);
});

test('choosing Off, or hiding the ghost with G, still saves qualifying laps', () => {
  for (const setup of [(g) => { g.ghostSource = 'off'; }, (g) => { g.ghostSource = 'reference'; toggleGhost(g); }]) {
    const { game, storage } = rig();
    setup(game);
    startRun(game);
    driveRun(game);
    assert.equal(savedEntry(storage).kind, 'best');
  }
});

test('a failed ghost write keeps the old reference, says so, and never touches the records', () => {
  const { game, storage, refs, records } = rig();
  startRun(game);
  const driver = gripDriver();
  driveLap(game, driver);
  driveLap(game, driver);
  const kept = storage.map.get(GHOST_STORE_KEY);
  const shown = game.ghostReference;
  storage.failWrites = Object.assign(new Error('full'), { name: 'QuotaExceededError' });
  driveLap(game, driver);
  const lap3 = game.laps.lastLap;
  assert.ok(lap3 < JSON.parse(kept).ghosts.original.classic.lapTime, 'lap 3 was faster, so it was offered');
  assert.equal(refs.lastResult.saved, false);
  assert.equal(refs.lastResult.reason, 'write failed');
  assert.equal(storage.map.get(GHOST_STORE_KEY), kept);
  assert.equal(game.ghostReference.durationTicks, shown.durationTicks, 'the run keeps showing what is really saved');
  assert.deepEqual(game.ghostReference, shown);
  assert.equal(records.forTrack('original', 'classic').fastestLap, lap3, 'the record still saved');
});

test('when the record can\'t be saved, the lap is only ever a reference, never claimed as the best', () => {
  // Records written by a later version are read-only (records.js), so no lap sets a record here.
  const storage = memoryStorage({ [RECORDS_KEY]: JSON.stringify({ version: 99 }) });
  const { game, records } = rig(storage);
  startRun(game);
  driveRun(game);
  assert.equal(records.readOnly, true);
  assert.equal(savedEntry(storage).kind, 'reference');
});

test('an outdated compatibility version is not shown, and the next flying lap replaces it', () => {
  const storage = memoryStorage();
  const { game } = rig(storage);
  startRun(game);
  driveRun(game);
  const saved = JSON.parse(storage.map.get(GHOST_STORE_KEY));
  const old = saved.ghosts.original.classic;
  old.compatibility = GHOST_COMPATIBILITY - 1;
  old.lapTime = old.durationTicks / 120; // still self-consistent
  old.checksum = entryChecksum(old);
  storage.map.set(GHOST_STORE_KEY, JSON.stringify(saved));
  const fresh = rig(storage);
  startRun(fresh.game);
  assert.equal(fresh.refs.slot.status, 'incompatible');
  assert.equal(fresh.game.ghostReference, null, 'never shown');
  driveRun(fresh.game, driftDriver()); // even a slower lap replaces an unshowable one
  assert.equal(savedEntry(storage).compatibility, GHOST_COMPATIBILITY);
  assert.equal(fresh.refs.slot.status, 'ok');
});

test('slotState: a personal best only while the record is still that lap', () => {
  const slot = { status: 'ok', kind: 'best', lapTime: 45 };
  assert.equal(slotState(slot, 45), 'best');
  assert.equal(slotState(slot, 44), 'reference', 'beaten since by a lap with no recording, say a lap 1');
  assert.equal(slotState({ ...slot, kind: 'reference' }, 45), 'reference');
  assert.equal(slotState({ ...slot, kind: 'reference' }, null), 'reference');
  for (const status of ['none', 'incompatible', 'corrupt', 'newer', 'unsupported', 'unavailable']) assert.equal(slotState({ status }, 45), status);
  assert.equal(slotState(null, 45), 'none');
});

// --- No effect on driving ----------------------------------------------------------------
function simulationState(game) {
  const { ghost, ghostVisible, ghostSource, ghostReference, track, onRunEvent, ...rest } = game;
  return JSON.stringify(rest);
}

test('showing the saved reference changes nothing about the run, tick for tick', () => {
  const storage = memoryStorage();
  const seeded = rig(storage);
  startRun(seeded.game);
  driveRun(seeded.game);
  const shown = rig(storage);
  shown.game.ghostSource = 'reference';
  const plain = createGame();
  startRun(shown.game);
  startRun(plain);
  plain.ghost = null;
  assert.ok(shown.game.ghostReference);
  const a = driftDriver();
  const b = driftDriver();
  let n = 0;
  while (plain.state !== 'finished') {
    tick(shown.game, a(shown.game));
    tick(plain, b(plain));
    // What the renderer asks for every frame, at an awkward fraction.
    if (shown.game.laps.completed > 0) ghostDisplay(shown.game.ghost, shown.game.ghost.lapTick - 0.3, shown.game.car.x, shown.game.car.y, shown.game.ghostReference);
    if (n % 500 === 0) assert.equal(simulationState(shown.game), simulationState(plain), `tick ${n}`);
    n += 1;
  }
  assert.deepEqual(shown.game.results, plain.results);
  assert.equal(simulationState(shown.game), simulationState(plain));
});

test('the reference plays on the lap clock: frozen by pause, the same at any frame rate', () => {
  const storage = memoryStorage();
  const seeded = rig(storage);
  startRun(seeded.game);
  driveRun(seeded.game);
  const play = (fps) => {
    const { game } = rig(storage);
    startRun(game);
    const driver = gripDriver();
    driveLap(game, driver); // into the first flying lap
    const poses = [];
    for (let i = 0; i < 6 * fps; i += 1) {
      advance(game, 1 / fps, driver(game));
      poses.push(ghostDisplay(game.ghost, game.ghost.lapTick, 1e6, 1e6, game.ghostReference));
    }
    return { game, poses };
  };
  const at60 = play(60);
  const at12 = play(12);
  assert.ok(at60.poses.at(-1), 'the reference is showing on the flying lap');
  assert.equal(at60.game.ghost.lapTick, at12.game.ghost.lapTick);
  assert.deepEqual(at60.poses.at(-1), at12.poses.at(-1), 'the same pose after the same time');
  const { game } = at60;
  const before = game.ghost.lapTick;
  togglePause(game);
  for (let i = 0; i < 10; i += 1) assert.equal(advance(game, 0.1, { ...NO_INPUT, up: true }), 0);
  assert.equal(game.ghost.lapTick, before);
});

test('the reference module reads the session\'s events and nothing else', () => {
  const source = readFileSync(new URL('../src/reference-ghost.js', import.meta.url), 'utf8');
  assert.deepEqual([...source.matchAll(/from\s+'([^']+)'/g)].map((m) => m[1]).sort(), ['./handling.js', './track.js']);
  const session = readFileSync(new URL('../src/game.js', import.meta.url), 'utf8');
  // In code, the session only ever declares or clears the reference and the choice; it never reads them.
  const code = session.split('\n').filter((line) => !line.trim().startsWith('//')).join('\n');
  assert.deepEqual([...code.matchAll(/ghostReference[^,;\n]*/g)].map((m) => m[0]), ['ghostReference: null', 'ghostReference = null']);
  assert.deepEqual([...code.matchAll(/ghostSource[^,;\n]*/g)].map((m) => m[0]), ["ghostSource: 'previous'"]);
});

// --- The preference ------------------------------------------------------------------------
test('the ghost choice: Previous lap by default, only known values, written only when chosen', () => {
  assert.deepEqual(GHOST_SOURCES, ['previous', 'reference', 'off']);
  assert.equal(DEFAULT_GHOST_SOURCE, 'previous');
  const s = memoryStorage();
  assert.equal(readGhostPreference(s), 'previous');
  assert.equal(s.writes.length, 0);
  for (const value of ['reference', 'off', 'previous']) {
    writeGhostPreference(s, value);
    assert.equal(readGhostPreference(s), value);
  }
  writeGhostPreference(s, 'everything');
  assert.equal(readGhostPreference(s), 'previous', 'the last good value');
  for (const raw of ['', 'Reference', 'tuned', '{"x":1}', 'off ']) {
    assert.equal(readGhostPreference(memoryStorage({ [GHOST_PREFERENCE_KEY]: raw })), 'previous', raw);
  }
  const broken = { getItem() { throw new Error('denied'); }, setItem() { throw new Error('denied'); } };
  assert.equal(readGhostPreference(broken), 'previous');
  assert.doesNotThrow(() => writeGhostPreference(broken, 'off'));
  assert.equal(readGhostPreference(null), 'previous');
  assert.equal(GHOST_PREFERENCE_KEY, 'mini-drifters-ghost-mode');
});

test('main.js restores the choice without writing it, and saves only what the player picks', () => {
  const main = readFileSync(new URL('../src/main.js', import.meta.url), 'utf8');
  assert.match(main, /game\.ghostSource = readGhostPreference\(preferenceStorage\);/);
  assert.equal(main.match(/writeGhostPreference\(/g).length, 1, 'one place saves it');
  assert.match(main, /function selectGhostSource\(id\) \{[\s\S]*?writeGhostPreference\(preferenceStorage, id\)/);
  // The reference hears every event after the records, as this file's rig does.
  assert.match(main, /records\.handle\(event\);\s*gymkhanaRecords\.handle\(event\);\s*referenceGhosts\.handle\(event\);/);
});
