// The remembered handling mode: Classic on a first visit, the last public mode chosen after
// that, and Classic again for anything it cannot trust. It must never cost the player a game,
// and never touch the records or the sound settings. In-memory storage only.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DEFAULT_HANDLING_ID, HANDLING_IDS, RETIRED_HANDLING_IDS } from '../src/handling.js';
import { HANDLING_PREFERENCE_KEY, readHandlingPreference, writeHandlingPreference } from '../src/handling-preferences.js';
import { readAudioPreferences } from '../src/audio-preferences.js';
import { createRecords, RECORDS_KEY, LEGACY_RECORDS_KEY } from '../src/records.js';

function storage(initial = {}) {
  const map = new Map(Object.entries(initial));
  const s = {
    map, writes: [], failGet: false, failSet: false,
    getItem(k) { if (s.failGet) throw new Error('denied'); return map.has(k) ? map.get(k) : null; },
    setItem(k, v) { if (s.failSet) throw new Error('QuotaExceededError'); s.writes.push(k); map.set(k, String(v)); },
  };
  return s;
}

test('the preference has a key of its own, apart from records and sound', () => {
  assert.equal(HANDLING_PREFERENCE_KEY, 'mini-drifters-handling');
  for (const other of [RECORDS_KEY, LEGACY_RECORDS_KEY, 'mini-drifters-sound', 'mini-drifters-audio']) assert.notEqual(HANDLING_PREFERENCE_KEY, other);
});

test('a first visit starts on Classic', () => {
  assert.equal(DEFAULT_HANDLING_ID, 'classic');
  assert.equal(readHandlingPreference(storage()), 'classic');
});

test('choosing Power is remembered, and choosing Classic again replaces it', () => {
  const s = storage();
  writeHandlingPreference(s, 'revised');
  assert.equal(s.map.get(HANDLING_PREFERENCE_KEY), 'revised', 'the stable id is saved, not the display name');
  assert.equal(readHandlingPreference(s), 'revised', 'restored on the next visit');
  writeHandlingPreference(s, 'classic');
  assert.equal(readHandlingPreference(s), 'classic');
  writeHandlingPreference(s, 'revised');
  writeHandlingPreference(s, 'revised');
  assert.equal(readHandlingPreference(s), 'revised', 'the most recent choice wins');
  assert.deepEqual(new Set(s.writes), new Set([HANDLING_PREFERENCE_KEY]), 'nothing else is written');
  for (const id of HANDLING_IDS) { writeHandlingPreference(s, id); assert.equal(readHandlingPreference(s), id); }
});

test('reading never writes', () => {
  for (const value of [undefined, 'revised', 'tuned', '{bad']) {
    const s = storage(value === undefined ? {} : { [HANDLING_PREFERENCE_KEY]: value });
    readHandlingPreference(s);
    assert.deepEqual(s.writes, [], String(value));
  }
});

test('an invalid, unsupported or retired saved value falls back to Classic', () => {
  const bad = [
    ...RETIRED_HANDLING_IDS, 'tuned', 'revised-low', 'power', 'Power', 'Revised', 'CLASSIC', ' revised', 'revised ', '',
    '"revised"', '{"id":"revised"}', 'null', 'undefined', '__proto__', 'constructor', 'toString', 'hasOwnProperty',
    '0', 'true', 'x'.repeat(10000),
  ];
  for (const value of bad) assert.equal(readHandlingPreference(storage({ [HANDLING_PREFERENCE_KEY]: value })), 'classic', JSON.stringify(value.slice(0, 40)));
});

test('a retired or unknown id is never saved', () => {
  const s = storage({ [HANDLING_PREFERENCE_KEY]: 'revised' });
  for (const id of ['tuned', 'power', 'Power', '', null, undefined, '__proto__', 42, { id: 'revised' }]) writeHandlingPreference(s, id);
  assert.deepEqual(s.writes, []);
  assert.equal(readHandlingPreference(s), 'revised', 'the last good choice stays');
});

test('missing or failing storage never stops play: reads give Classic, writes are dropped quietly', () => {
  for (const missing of [null, undefined, {}]) {
    assert.equal(readHandlingPreference(missing), 'classic');
    assert.doesNotThrow(() => writeHandlingPreference(missing, 'revised'));
  }
  const s = storage({ [HANDLING_PREFERENCE_KEY]: 'revised' });
  s.failGet = true;
  assert.equal(readHandlingPreference(s), 'classic');
  s.failGet = false;
  s.failSet = true;
  assert.doesNotThrow(() => writeHandlingPreference(s, 'classic'));
  s.failSet = false;
  assert.equal(readHandlingPreference(s), 'revised', 'a failed write changes nothing saved');
  const throwing = { getItem() { throw new DOMException('denied', 'SecurityError'); }, setItem() { throw new DOMException('denied', 'SecurityError'); } };
  assert.equal(readHandlingPreference(throwing), 'classic');
  assert.doesNotThrow(() => writeHandlingPreference(throwing, 'revised'));
});

test('a bad preference cannot damage records or sound settings, and the preference cannot change them', () => {
  const records = JSON.stringify({ version: 2, tracks: { original: { classic: { score: 9000, fastestLap: 48, bestCombo: 0 }, revised: { score: 0, fastestLap: 50, bestCombo: null }, tuned: { score: 5 } } } });
  const legacy = JSON.stringify({ version: 1, tracks: { original: { score: 100, fastestLap: 60, bestCombo: 1 } } });
  const audio = JSON.stringify({ station: 'garage-rock', musicVolume: 40, effectsVolume: 90 });
  for (const value of ['tuned', '{bad', '__proto__', 'revised']) {
    const s = storage({ [RECORDS_KEY]: records, [LEGACY_RECORDS_KEY]: legacy, 'mini-drifters-sound': 'off', 'mini-drifters-audio': audio, [HANDLING_PREFERENCE_KEY]: value });
    const before = new Map(s.map);
    const keeper = createRecords(() => s);
    assert.deepEqual(keeper.forTrack('original', 'classic'), { score: 9000, fastestLap: 48, bestCombo: 1 });
    assert.deepEqual(keeper.forTrack('original', 'revised'), { score: 0, fastestLap: 50, bestCombo: null });
    assert.deepEqual(readAudioPreferences(s), { muted: true, station: 'garage-rock', musicVolume: 40, effectsVolume: 90 });
    readHandlingPreference(s);
    writeHandlingPreference(s, 'classic');
    for (const [k, v] of before) if (k !== HANDLING_PREFERENCE_KEY) assert.equal(s.map.get(k), v, `${k} untouched`);
    assert.deepEqual(s.writes, [HANDLING_PREFERENCE_KEY]);
  }
});

test('the title restores the preference on load without writing it, and saves only what the player chooses', () => {
  const main = readFileSync(new URL('../src/main.js', import.meta.url), 'utf8');
  assert.match(main, /let selectedHandlingId = readHandlingPreference\(preferenceStorage\);/);
  assert.match(main, /if \(remember\) writeHandlingPreference\(preferenceStorage, id\);/);
  assert.match(main, /selectHandling\(selectedHandlingId, \{ remember: false \}\);/);
  // The lesson names its own mode and never goes through the title's choice.
  assert.match(main, /const LESSON_HANDLING = handlingById\('classic'\);/);
  assert.match(main, /mode: 'tutorial', handling: LESSON_HANDLING/);
  assert.equal(main.match(/writeHandlingPreference\(/g).length, 1, 'one place saves the preference');
});
