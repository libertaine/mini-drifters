// The saved reference ghost's storage: the encoding, the validator, the key and its write rules,
// and the explicit compatibility version. The policy deciding which laps are offered is in
// test/reference-ghost.test.mjs.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { TUNING as T } from '../src/tuning.js';
import { createGame, startRun, tick } from '../src/game.js';
import { trackById, TRACKS } from '../src/track.js';
import { HANDLING_IDS, handlingById } from '../src/handling.js';
import { createGhost, ghostPoseAt, ghostIsCompatible, SAMPLE_EVERY, GHOST_FORMAT } from '../src/ghost.js';
import {
  GHOST_STORE_KEY, GHOST_STORE_VERSION, ENTRY_FORMAT, GHOST_COMPATIBILITY, GHOST_COMPATIBILITY_BASELINE,
  MAX_SAVED_TICKS, MAX_SAMPLES, MAX_ENTRY_CHARS, MAX_STORE_CHARS,
  createGhostStore, encodeEntry, decodeEntry, entryChecksum, expectedIdentity, readGhostStore, slotFrom, replaces,
} from '../src/ghost-store.js';
import { RECORDS_KEY } from '../src/records.js';
import { gripDriver, driftDriver } from './support/drivers.mjs';
import { driveHash, geometryHash, sourcesHash, SIMULATION_SOURCES } from './support/ghost-compatibility.mjs';

const TICK_RATE = Math.round(1 / T.simStep);

// Every valid kept lap of one run, with the lap time the records saw.
function drivenLaps(trackId = 'original', handlingId = 'classic', makeDriver = gripDriver) {
  const laps = [];
  const game = createGame(trackById(trackId), { onRunEvent: (e) => { if (e.type === 'ghost') laps.push(e); } });
  startRun(game, { handling: handlingById(handlingId) });
  const driver = makeDriver();
  while (game.state !== 'finished' && game.ticks < 60000) tick(game, driver(game));
  assert.equal(game.state, 'finished');
  return laps;
}
const LAPS = drivenLaps();
const FLYING = LAPS.find((e) => e.flying);
const EXPECT = expectedIdentity('original', 'classic');

// An in-memory localStorage with a write log and switchable failures.
function memoryStorage(initial = {}) {
  const map = new Map(Object.entries(initial));
  return { map, writes: [], reads: 0, failWrites: null, failReads: null,
    getItem(key) { this.reads += 1; if (this.failReads) throw this.failReads; return map.has(key) ? map.get(key) : null; },
    setItem(key, value) { if (this.failWrites) throw this.failWrites; this.writes.push(key); map.set(key, String(value)); },
  };
}
const quota = () => Object.assign(new Error('The quota has been exceeded.'), { name: 'QuotaExceededError' });
const offer = (store, event = FLYING, kind = 'reference', trackId = 'original', handlingId = 'classic') =>
  store.offer({ trackId, handlingId, recording: event.recording, lapTime: event.time, kind });
const saved = (storage) => JSON.parse(storage.map.get(GHOST_STORE_KEY));

// --- The encoding -----------------------------------------------------------------------
test('a driven lap round-trips through the encoding within 7 mm and half a milliradian', () => {
  for (const { recording, time } of LAPS) {
    const entry = encodeEntry(recording, EXPECT, time, 'reference');
    const out = decodeEntry(JSON.parse(JSON.stringify(entry)), EXPECT);
    assert.equal(out.ok, true, out.reason);
    const back = out.recording;
    assert.deepEqual(back.ticks, recording.ticks, 'every sample tick, including the line crossing');
    assert.equal(back.durationTicks, recording.durationTicks);
    assert.equal(back.format, GHOST_FORMAT);
    assert.equal(out.lapTime, time);
    for (let i = 0; i < recording.x.length; i += 1) {
      assert.ok(Math.hypot(back.x[i] - recording.x[i], back.y[i] - recording.y[i]) <= 0.0071, `sample ${i}`);
      assert.ok(Math.abs(back.heading[i] - recording.heading[i]) <= 0.0005 + 1e-12, `heading ${i}`);
    }
    // Played back on fractional ticks the way the renderer asks, it is where the lap was.
    for (let t = 0; t <= recording.durationTicks; t += 0.37) {
      const a = ghostPoseAt(recording, t);
      const b = ghostPoseAt(back, t);
      assert.ok(Math.hypot(a.x - b.x, a.y - b.y) < 0.0075, `pose at ${t}`);
    }
    assert.ok(ghostIsCompatible(createGhost(trackById('original')), back), 'the decoded lap passes ghost.js\'s own check');
  }
});

test('a typical lap is about 15k characters, and the longest saved lap fits the per-entry cap', () => {
  const sizes = LAPS.map(({ recording, time }) => JSON.stringify(encodeEntry(recording, EXPECT, time, 'reference')).length);
  for (const size of sizes) assert.ok(size > 5_000 && size < 30_000, `${size} characters`);
  // A synthetic five-minute lap at full speed, the worst case the cap allows.
  const n = MAX_SAMPLES;
  const ticks = Array.from({ length: n }, (_, i) => (i === n - 1 ? MAX_SAVED_TICKS : i * SAMPLE_EVERY));
  const long = { format: GHOST_FORMAT, track: EXPECT.track, rules: EXPECT.rules, tickRate: TICK_RATE, sampleEvery: SAMPLE_EVERY,
    durationTicks: MAX_SAVED_TICKS, ticks,
    x: ticks.map((t) => 300 * Math.cos(t / 2000) - 123.456), y: ticks.map((t) => 300 * Math.sin(t / 2000) + 98.765),
    heading: ticks.map((t) => t / 2000 + Math.PI / 2 + 0.3 * Math.sin(t / 37)) };
  const entry = encodeEntry(long, EXPECT, MAX_SAVED_TICKS / TICK_RATE, 'reference');
  const size = JSON.stringify(entry).length;
  assert.ok(size < MAX_ENTRY_CHARS, `${size} characters`);
  assert.equal(decodeEntry(entry, EXPECT).ok, true);
  // All six slots at that worst case, in UTF-16, under 1.5 MiB of a typical 5 MiB origin.
  const slots = TRACKS.length * HANDLING_IDS.length;
  assert.equal(slots, 6);
  assert.ok(slots * size * 2 < 1.5 * 1024 * 1024, `${(slots * size * 2 / 1024 / 1024).toFixed(2)} MiB`);
  assert.ok(slots * MAX_ENTRY_CHARS < MAX_STORE_CHARS);
});

test('the bounds: five minutes, the samples that implies, and the clock the game runs on', () => {
  assert.equal(TICK_RATE, 120);
  assert.equal(SAMPLE_EVERY, 4);
  assert.equal(MAX_SAVED_TICKS, 5 * 60 * 120);
  assert.equal(MAX_SAMPLES, Math.floor((MAX_SAVED_TICKS - 1) / SAMPLE_EVERY) + 2);
  assert.equal(GHOST_STORE_KEY, 'mini-drifters-ghosts-v1');
  assert.equal(GHOST_STORE_VERSION, 1);
  assert.equal(ENTRY_FORMAT, 1);
});

// --- Validation -------------------------------------------------------------------------
const good = () => JSON.parse(JSON.stringify(encodeEntry(FLYING.recording, EXPECT, FLYING.time, 'reference')));
// Damage applied after the checksum, so the checksum is what must catch it, or after
// recomputing it, so the structural checks must.
const resum = (entry) => { entry.checksum = entryChecksum(entry); return entry; };

test('structural damage is refused, never thrown, whether or not the checksum was recomputed', () => {
  const cases = {
    'not an object': () => 'text',
    null: () => null,
    array: () => [],
    'empty object': () => ({}),
    'missing column': (e) => { delete e.dx; return e; },
    'short column': (e) => { e.dy.pop(); return e; },
    'long column': (e) => { e.dh.push(0); return e; },
    'column not an array': (e) => { e.dx = 'abc'; return e; },
    'NaN value': (e) => { e.dx[5] = NaN; return e; },
    'null value': (e) => { e.dy[5] = null; return e; },
    'string value': (e) => { e.dh[5] = '3'; return e; },
    'fractional value': (e) => { e.dx[5] += 0.5; return e; },
    'unsafe integer': (e) => { e.dx[5] = 2 ** 60; return e; },
    'count lies': (e) => { e.n += 1; return e; },
    'duration lies': (e) => { e.durationTicks += SAMPLE_EVERY; return e; },
    'duration zero': (e) => { e.durationTicks = 0; return e; },
    'duration over five minutes': (e) => { e.durationTicks = MAX_SAVED_TICKS + 1; return e; },
    'lap time lies': (e) => { e.lapTime -= 0.5; return e; },
    'lap time not a number': (e) => { e.lapTime = '45'; return e; },
    teleport: (e) => { e.dx[40] += 100000; e.dx[41] -= 100000; return e; },
    'out of the world': (e) => { e.dx[0] += 1_000_000; return e; },
    'heading runaway': (e) => { e.dh[0] = 50_000_000; return e; },
    'unknown kind': (e) => { e.kind = 'world record'; return e; },
    'missing checksum': (e) => { delete e.checksum; return e; },
  };
  for (const [name, damage] of Object.entries(cases)) {
    for (const recompute of [false, true]) {
      const entry = damage(good());
      if (recompute && entry && typeof entry === 'object' && Array.isArray(entry.dx) && Array.isArray(entry.dy) && Array.isArray(entry.dh)) resum(entry);
      let out;
      assert.doesNotThrow(() => { out = decodeEntry(entry, EXPECT); }, name);
      if (name === 'missing checksum' && recompute) continue; // recomputing puts it back
      assert.equal(out.ok, false, `${name}${recompute ? ' (checksum recomputed)' : ''}`);
      assert.ok(['corrupt', 'incompatible', 'newer'].includes(out.status), name);
    }
  }
  assert.equal(decodeEntry(good(), EXPECT).ok, true, 'the undamaged entry is accepted');
});

test('the checksum catches every one of 1,500 seeded single-character substitutions that still parse', () => {
  const text = JSON.stringify(good());
  let seed = 0x5eed1234;
  const random = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 2 ** 32; };
  const alphabet = '0123456789-,.:"[]{}abcdefxyz';
  let parsed = 0;
  let accepted = 0;
  let acceptedWithoutChecksum = 0;
  for (let i = 0; i < 1500; i += 1) {
    const at = Math.floor(random() * text.length);
    const swap = alphabet[Math.floor(random() * alphabet.length)];
    if (swap === text[at]) continue;
    const mutated = text.slice(0, at) + swap + text.slice(at + 1);
    let entry;
    try { entry = JSON.parse(mutated); } catch { continue; }
    parsed += 1;
    if (decodeEntry(entry, EXPECT).ok) accepted += 1;
    // R0's finding, reproduced: without the checksum some damage still decodes to a plausible lap.
    if (entry && typeof entry === 'object' && Array.isArray(entry.dx) && Array.isArray(entry.dy) && Array.isArray(entry.dh)
      && decodeEntry(resum(entry), EXPECT).ok) acceptedWithoutChecksum += 1;
  }
  assert.ok(parsed > 200, `${parsed} mutations still parsed`);
  assert.equal(accepted, 0, 'none is accepted');
  assert.ok(acceptedWithoutChecksum > 0, 'the structural checks alone let some through, as R0 found');
});

test('identity: another circuit, mode, compatibility version, format or clock is refused', () => {
  const at = (change) => decodeEntry(resum({ ...good(), ...change }), EXPECT);
  for (const [change, status] of [
    [{ trackId: 'switchback' }, 'incompatible'],
    [{ handlingId: 'revised' }, 'incompatible'],
    [{ track: '00000000' }, 'incompatible'],
    [{ rules: '00000000' }, 'incompatible'],
    [{ tickRate: 60 }, 'incompatible'],
    [{ sampleEvery: 8 }, 'incompatible'],
    [{ compatibility: GHOST_COMPATIBILITY - 1 }, 'incompatible'],
    [{ compatibility: 0 }, 'incompatible'],
    [{ compatibility: GHOST_COMPATIBILITY + 1 }, 'newer'],
    [{ format: ENTRY_FORMAT + 1 }, 'newer'],
    [{ format: 0 }, 'incompatible'],
    [{ compatibility: '1' }, 'corrupt'],
    [{ format: 'E1' }, 'corrupt'],
    [{ trackId: 7 }, 'corrupt'],
  ]) {
    const out = at(change);
    assert.equal(out.ok, false, JSON.stringify(change));
    assert.equal(out.status, status, JSON.stringify(change));
  }
  // A lap from one slot is never accepted for another, even byte-for-byte intact.
  for (const trackId of ['switchback', 'dockyard']) {
    for (const handlingId of HANDLING_IDS) assert.equal(decodeEntry(good(), expectedIdentity(trackId, handlingId)).ok, false);
  }
  assert.equal(decodeEntry(good(), expectedIdentity('original', 'revised')).ok, false);
  assert.equal(expectedIdentity('nowhere', 'classic'), null);
  assert.equal(expectedIdentity('original', 'tuned'), null, 'a retired mode has no slot');
});

test('R0\'s gap: the fingerprints alone cannot tell v0.5.0 from v0.6.0, the explicit version can', () => {
  // The fingerprints are a pure function of geometry and tuning, which v0.6.0 left alone.
  const fingerprints = Object.fromEntries(TRACKS.flatMap(({ id }) => HANDLING_IDS.map((h) => {
    const { track, rules } = expectedIdentity(id, h);
    return [`${id}/${h}`, `${track}/${rules}`];
  })));
  assert.deepEqual(fingerprints, {
    'original/classic': '8c54f401/744865a6', 'original/revised': '8c54f401/8eeb8829',
    'switchback/classic': '88a3c237/744865a6', 'switchback/revised': '88a3c237/8eeb8829',
    'dockyard/classic': '97b9e1ef/744865a6', 'dockyard/revised': '97b9e1ef/8eeb8829',
  }, 'the same values R0 measured for v0.5.0');
  // A lap saved before the explicit version existed carries none, and is never shown.
  const legacy = good();
  delete legacy.compatibility;
  assert.equal(decodeEntry(resum(legacy), EXPECT).ok, false);
});

// --- Compatibility version tripwire -----------------------------------------------------
// The values GHOST_COMPATIBILITY was last reviewed against. If one changes, the change has to be
// judged here: if it can move the car or change how a lap is timed or judged, raise
// GHOST_COMPATIBILITY in src/ghost-store.js and add a new row; if it can't (a comment, say),
// update this row. Never edit a row's values without that review. See docs/GHOST.md.
const REVIEWED = {
  1: {
    baseline: 'v0.6.0',
    drive: '58f07dfe5e47bb5b7e0bb66fd3b5edba650697a4f0f9724300d0e5dd42354b99',
    geometry: 'ea5f7664d1bf50ae8fb8cfd0eb6bc5b631dc071c15fb29db7c652998796ad2ae',
    sources: 'aba295e09893c87a67bb8bd65c94a30a2fabf16361abaf3378387ec1c451c6f1',
  },
};
const REVIEW = 'Review GHOST_COMPATIBILITY in src/ghost-store.js (see docs/GHOST.md, "Compatibility")';

test('the compatibility version names the v0.6.0 physics and environments', () => {
  assert.equal(GHOST_COMPATIBILITY, 1);
  assert.equal(GHOST_COMPATIBILITY_BASELINE, 'v0.6.0');
  assert.ok(REVIEWED[GHOST_COMPATIBILITY], 'every compatibility version has a reviewed row');
  assert.equal(REVIEWED[GHOST_COMPATIBILITY].baseline, GHOST_COMPATIBILITY_BASELINE);
});

test('how the car drives and laps are judged on every circuit and mode is what the version was reviewed against', () => {
  assert.equal(driveHash(), REVIEWED[GHOST_COMPATIBILITY].drive, `The scripted drives changed. ${REVIEW}.`);
});

test('circuit geometry and solid scenery are what the version was reviewed against', () => {
  assert.equal(geometryHash(), REVIEWED[GHOST_COMPATIBILITY].geometry, `A circuit or its scenery changed. ${REVIEW}.`);
});

test('the simulation\'s source files are what the version was reviewed against', () => {
  assert.equal(sourcesHash(), REVIEWED[GHOST_COMPATIBILITY].sources, `One of ${SIMULATION_SOURCES.join(', ')} changed. ${REVIEW}.`);
});

// --- The key ----------------------------------------------------------------------------
test('readGhostStore: empty, ok, corrupt, a later version, and a key too large to parse', () => {
  assert.equal(readGhostStore(null).status, 'empty');
  assert.equal(readGhostStore(undefined).status, 'empty');
  assert.equal(readGhostStore('{"version":1,"ghosts":{}}').status, 'ok');
  for (const raw of ['', '{', 'null', '[]', '"x"', '42', '{"version":0}', '{"version":"1"}', '{"ghosts":{}}', '{"version":1.5}']) {
    assert.equal(readGhostStore(raw).status, 'corrupt', raw);
  }
  assert.equal(readGhostStore('{"version":2,"ghosts":{}}').status, 'unsupported');
  assert.equal(readGhostStore(`{"version":1,"pad":"${'x'.repeat(MAX_STORE_CHARS)}"}`).status, 'corrupt');
});

test('nothing is written by creating the store or reading any slot, and the records are never touched', () => {
  const records = JSON.stringify({ version: 3, tracks: { original: { classic: { fastestLap: 40, scoring: {} } } } });
  const storage = memoryStorage({ [RECORDS_KEY]: records });
  const store = createGhostStore(() => storage);
  for (const { id } of TRACKS) for (const h of HANDLING_IDS) assert.equal(store.slot(id, h).status, 'none');
  assert.equal(storage.writes.length, 0);
  assert.equal(offer(store).saved, true);
  assert.deepEqual(storage.writes, [GHOST_STORE_KEY], 'only its own key');
  assert.equal(storage.map.get(RECORDS_KEY), records, 'records byte-for-byte');
});

test('a saved lap reloads in a new store, as a fresh page would see it', () => {
  const storage = memoryStorage();
  const result = offer(createGhostStore(() => storage), FLYING, 'best');
  assert.equal(result.saved, true);
  const later = createGhostStore(() => storage).slot('original', 'classic');
  assert.equal(later.status, 'ok');
  assert.equal(later.kind, 'best');
  assert.equal(later.lapTime, FLYING.time);
  assert.deepEqual(later.recording.ticks, FLYING.recording.ticks);
  assert.deepEqual(result.slot.recording, later.recording, 'what the run is shown after saving is what reloads');
  for (const other of ['switchback', 'dockyard']) assert.equal(createGhostStore(() => storage).slot(other, 'classic').status, 'none');
  assert.equal(createGhostStore(() => storage).slot('original', 'revised').status, 'none');
});

test('replacement: only a strictly faster lap replaces a showable one; anything unshowable is replaced', () => {
  const ok = { status: 'ok', lapTime: 50 };
  assert.equal(replaces(ok, 49.99), true);
  assert.equal(replaces(ok, 50), false, 'a tie keeps what is there');
  assert.equal(replaces(ok, 50.01), false);
  for (const status of ['none', 'incompatible', 'corrupt']) assert.equal(replaces({ status }, 999), true, status);
  for (const status of ['newer', 'unsupported', 'unavailable']) assert.equal(replaces({ status }, 1), false, status);

  const storage = memoryStorage();
  const store = createGhostStore(() => storage);
  const [a, b] = LAPS.filter((e) => e.flying).sort((x, y) => y.time - x.time); // slower first
  assert.ok(a.time > b.time);
  assert.equal(offer(store, a).saved, true);
  assert.equal(offer(store, a).reason, 'not faster', 'the same time again is a tie');
  assert.equal(offer(store, b).saved, true, 'faster replaces');
  assert.equal(offer(store, a).reason, 'not faster', 'slower never replaces');
  assert.equal(store.slot('original', 'classic').lapTime, b.time);
  assert.equal(storage.writes.length, 2);
});

test('an outdated, damaged or legacy entry is replaced by the next lap; a later version\'s never is', () => {
  for (const [damage, status] of [
    [(e) => ({ ...e, compatibility: GHOST_COMPATIBILITY - 1 }), 'incompatible'],
    [(e) => ({ ...e, rules: 'ffffffff' }), 'incompatible'],
    [(e) => ({ ...e, dx: e.dx.slice(1) }), 'corrupt'],
    [() => 'garbage', 'corrupt'],
  ]) {
    const entry = damage(good());
    if (typeof entry === 'object') resum(entry);
    const storage = memoryStorage({ [GHOST_STORE_KEY]: JSON.stringify({ version: 1, ghosts: { original: { classic: entry } } }) });
    const store = createGhostStore(() => storage);
    assert.equal(store.slot('original', 'classic').status, status);
    const slow = { ...FLYING, time: FLYING.time };
    assert.equal(offer(store, slow).saved, true, status);
    assert.equal(store.slot('original', 'classic').status, 'ok');
  }
  const newer = resum({ ...good(), compatibility: GHOST_COMPATIBILITY + 1, lapTime: 9999 });
  const raw = JSON.stringify({ version: 1, ghosts: { original: { classic: newer } } });
  const storage = memoryStorage({ [GHOST_STORE_KEY]: raw });
  const store = createGhostStore(() => storage);
  assert.equal(store.slot('original', 'classic').status, 'newer');
  const result = offer(store);
  assert.equal(result.saved, false);
  assert.equal(result.reason, 'newer');
  assert.equal(storage.map.get(GHOST_STORE_KEY), raw, 'byte-for-byte');
});

test('a later store version is never written, and nothing in it is shown', () => {
  const raw = JSON.stringify({ version: 2, ghosts: { original: { classic: good() } }, future: true });
  const storage = memoryStorage({ [GHOST_STORE_KEY]: raw });
  const store = createGhostStore(() => storage);
  assert.equal(store.slot('original', 'classic').status, 'unsupported');
  const result = offer(store);
  assert.equal(result.saved, false);
  assert.equal(result.reason, 'unsupported');
  assert.equal(storage.writes.length, 0);
  assert.equal(storage.map.get(GHOST_STORE_KEY), raw);
});

test('unparseable JSON reads as no reference, and is replaced by the next qualifying lap', () => {
  const storage = memoryStorage({ [GHOST_STORE_KEY]: '{"version":1,"ghosts":{"original":{"classic":{"dx":[1,2' });
  const store = createGhostStore(() => storage);
  assert.equal(store.slot('original', 'classic').status, 'none');
  assert.equal(offer(store).saved, true);
  assert.equal(saved(storage).version, 1);
});

test('a write keeps every other slot, unknown track, retired mode and unknown field it finds', () => {
  const other = encodeEntry(drivenLaps('switchback').find((e) => e.flying).recording, expectedIdentity('switchback', 'classic'), 0, 'best');
  const before = { version: 1, note: 'kept', ghosts: {
    switchback: { classic: other },
    original: { tuned: { anything: true }, revised: { from: 'elsewhere' } },
    'future-track': { classic: { x: 1 } },
  } };
  const storage = memoryStorage({ [GHOST_STORE_KEY]: JSON.stringify(before) });
  assert.equal(offer(createGhostStore(() => storage)).saved, true);
  const after = saved(storage);
  assert.equal(after.note, 'kept');
  assert.deepEqual(after.ghosts.switchback, before.ghosts.switchback);
  assert.deepEqual(after.ghosts['future-track'], before.ghosts['future-track']);
  assert.deepEqual(after.ghosts.original.tuned, before.ghosts.original.tuned);
  assert.deepEqual(after.ghosts.original.revised, before.ghosts.original.revised);
  assert.equal(after.ghosts.original.classic.lapTime, FLYING.time);
});

test('another tab\'s save between this page\'s load and its write is re-read and kept', () => {
  const storage = memoryStorage();
  const thisTab = createGhostStore(() => storage);
  const otherTab = createGhostStore(() => storage);
  assert.equal(thisTab.slot('original', 'classic').status, 'none');
  const switchback = drivenLaps('switchback').find((e) => e.flying);
  assert.equal(offer(otherTab, switchback, 'reference', 'switchback').saved, true);
  assert.equal(offer(thisTab).saved, true);
  assert.equal(createGhostStore(() => storage).slot('switchback', 'classic').status, 'ok', 'the other tab\'s lap survives');
  // And another tab's faster lap on the same slot is not overwritten by a slower one here.
  const [fast, slow] = LAPS.filter((e) => e.flying).sort((x, y) => x.time - y.time);
  const s2 = memoryStorage();
  const here = createGhostStore(() => s2);
  const there = createGhostStore(() => s2);
  assert.equal(here.slot('original', 'classic').status, 'none');
  assert.equal(offer(there, fast).saved, true);
  assert.equal(offer(here, slow).reason, 'not faster');
  assert.equal(here.slot('original', 'classic').lapTime, fast.time);
});

test('a full quota fails the write, says so, and leaves what was saved exactly as it was', () => {
  const storage = memoryStorage();
  const store = createGhostStore(() => storage);
  const [slow, fast] = LAPS.filter((e) => e.flying).sort((x, y) => y.time - x.time);
  assert.equal(offer(store, slow).saved, true);
  const before = storage.map.get(GHOST_STORE_KEY);
  storage.failWrites = quota();
  const result = offer(store, fast);
  assert.equal(result.saved, false);
  assert.equal(result.reason, 'write failed');
  assert.equal(result.slot.lapTime, slow.time, 'the slot reported is still the old lap');
  assert.equal(storage.map.get(GHOST_STORE_KEY), before);
  storage.failWrites = null;
  assert.equal(offer(store, fast).saved, true, 'and the next lap can try again');
});

test('denied or broken storage never throws, saves nothing and reads as unavailable', () => {
  for (const provider of [
    () => { throw Object.assign(new Error('denied'), { name: 'SecurityError' }); },
    () => null,
    () => ({}),
    () => ({ getItem: 1, setItem: 1 }),
  ]) {
    let store;
    assert.doesNotThrow(() => { store = createGhostStore(provider); });
    assert.equal(store.available, false);
    assert.equal(store.slot('original', 'classic').status, 'unavailable');
    const result = offer(store);
    assert.equal(result.saved, false);
    assert.equal(result.reason, 'unavailable');
  }
  // Storage that fails only on reading, as some privacy modes do.
  const storage = memoryStorage();
  storage.failReads = new Error('denied');
  const store = createGhostStore(() => storage);
  assert.equal(store.slot('original', 'classic').status, 'unavailable');
  assert.equal(offer(store).reason, 'unavailable');
  assert.equal(storage.writes.length, 0);
});

test('a lap over five minutes is not saved, and nothing is written for it', () => {
  const storage = memoryStorage();
  const n = Math.floor((MAX_SAVED_TICKS) / SAMPLE_EVERY) + 2;
  const ticks = Array.from({ length: n }, (_, i) => (i === n - 1 ? MAX_SAVED_TICKS + 1 : i * SAMPLE_EVERY));
  const long = { format: GHOST_FORMAT, track: EXPECT.track, rules: EXPECT.rules, tickRate: TICK_RATE, sampleEvery: SAMPLE_EVERY,
    durationTicks: MAX_SAVED_TICKS + 1, ticks, x: ticks.map(() => 0), y: ticks.map(() => 0), heading: ticks.map(() => 0) };
  const result = createGhostStore(() => storage).offer({ trackId: 'original', handlingId: 'classic', recording: long, lapTime: long.durationTicks / TICK_RATE, kind: 'reference' });
  assert.equal(result.reason, 'too long');
  assert.equal(storage.writes.length, 0);
});

test('slotFrom reads only known circuits and modes, and a later store as unsupported', () => {
  const store = readGhostStore(JSON.stringify({ version: 1, ghosts: { original: { classic: good() } } }));
  assert.equal(slotFrom(store, 'original', 'classic').status, 'ok');
  assert.equal(slotFrom(store, 'original', 'tuned').status, 'none');
  assert.equal(slotFrom(store, 'nowhere', 'classic').status, 'none');
  assert.equal(slotFrom(readGhostStore('{"version":9}'), 'original', 'classic').status, 'unsupported');
  assert.equal(slotFrom(readGhostStore(JSON.stringify({ version: 1, ghosts: [] })), 'original', 'classic').status, 'none');
  assert.equal(slotFrom(readGhostStore(JSON.stringify({ version: 1, ghosts: { original: { classic: null } } })), 'original', 'classic').status, 'none');
});

test('the store and its encoding stay out of the simulation', () => {
  const source = readFileSync(new URL('../src/ghost-store.js', import.meta.url), 'utf8');
  assert.deepEqual([...source.matchAll(/from\s+'([^']+)'/g)].map((m) => m[1]).sort(), ['./ghost.js', './handling.js', './track.js', './tuning.js']);
  assert.doesNotMatch(source, /RECORDS_KEY|records-v|stepCar|updateLaps|updateScoring/);
  for (const file of ['physics.js', 'scoring.js', 'laps.js', 'track.js', 'tuning.js', 'records.js']) {
    assert.doesNotMatch(readFileSync(new URL(`../src/${file}`, import.meta.url), 'utf8'), /ghost-store|reference-ghost|ghostReference|ghostSource/, file);
  }
});

test('a drift lap round-trips too, through the seam of many turns', () => {
  const laps = drivenLaps('switchback', 'revised', driftDriver).filter((e) => e.flying);
  assert.ok(laps.length >= 1);
  const expect = expectedIdentity('switchback', 'revised');
  for (const { recording, time } of laps) {
    const out = decodeEntry(JSON.parse(JSON.stringify(encodeEntry(recording, expect, time, 'reference'))), expect);
    assert.equal(out.ok, true, out.reason);
    assert.ok(Math.max(...recording.heading.map(Math.abs)) > 0);
  }
});
