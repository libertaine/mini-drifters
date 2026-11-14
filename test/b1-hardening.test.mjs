// A stronger B1 (voided-lap scoring) regression check, from the v0.3.0 scoring research, where
// it was "R3". It runs under the current scoring rules, the low-speed fade included.
//
// test/handling.test.mjs's per-mode B1 check drives gripDriver, which earns nothing in Classic,
// so there it can only ever compare 0 with 0. This one drives driftDriver through the same voiding
// cuts, and first proves that real, non-zero points were earned on the voided laps (both banked
// and still running at the line) before checking that every one of them was left out of the result
// and the records. It adds to the existing check; it does not replace it.
import test from 'node:test';
import assert from 'node:assert/strict';
import { TUNING as T } from '../src/tuning.js';
import { trackById } from '../src/track.js';
import { createGame, startRun, tick } from '../src/game.js';
import { currentMultiplier } from '../src/scoring.js';
import { HANDLING_MODES, HANDLING_IDS } from '../src/handling.js';
import { createRecords } from '../src/records.js';
import { driftDriver } from './support/drivers.mjs';
import { cutterDriver } from './support/exploit-drivers.mjs';

const steps = (seconds) => Math.round(seconds / T.simStep);
const NONE = { score: null, fastestLap: null, bestCombo: null };
const VOIDING_CUTS = { original: { from: 562, to: 800 }, switchback: { from: 734, to: 972 } };

function memoryStorage() {
  const data = new Map();
  return { getItem: (k) => (data.has(k) ? data.get(k) : null), setItem: (k, v) => data.set(k, String(v)), removeItem: (k) => data.delete(k) };
}

for (const mode of HANDLING_MODES) {
  for (const trackId of ['original', 'switchback']) {
    test(`B1 (hardened) with ${mode.name} on ${trackId}: real drift points earned on voided laps never reach the result or the records`, () => {
      const storage = memoryStorage();
      const records = createRecords(() => storage);
      const game = createGame(trackById(trackId), { onRunEvent: (e) => records.handle(e) });
      startRun(game, { handling: mode });
      const driver = cutterDriver(driftDriver(), { ...VOIDING_CUTS[trackId], times: 3 });
      let bankedOnVoided = 0;
      let runningAtVoidedLine = 0;
      let lapStart = 0;
      let serial = 0;
      let unbanked = 0;
      while (game.state !== 'finished' && game.ticks < steps(900)) {
        const { combo } = game.scoring;
        unbanked = combo ? Math.round(combo.points * currentMultiplier(combo)) : 0;
        tick(game, driver(game));
        if (game.lapEventSerial !== serial) {
          serial = game.lapEventSerial;
          if (game.state !== 'finished' && game.lapEvent === 'void') {
            bankedOnVoided += game.scoring.score - lapStart;
            runningAtVoidedLine += unbanked;
          }
          lapStart = game.scoring.score;
        }
      }
      assert.equal(game.state, 'finished', 'the run finished');
      assert.equal(game.laps.voided, 3, 'the exploit voided every attempted lap');
      // The point of the hardening: something real was at stake.
      assert.ok(bankedOnVoided > 0, `points were banked on the voided laps (${bankedOnVoided})`);
      assert.ok(bankedOnVoided + runningAtVoidedLine >= 500, `a meaningful amount was at stake (${bankedOnVoided} + ${runningAtVoidedLine})`);
      assert.ok(game.scoring.score > game.results.score, 'the raw total really was larger than the result');
      // ...and none of it counted.
      assert.equal(game.results.forfeited, bankedOnVoided);
      assert.equal(game.results.score, game.scoring.score - bankedOnVoided);
      assert.ok(game.results.score > 0, 'the three counted laps still scored');
      assert.equal(records.forTrack(trackId, mode.id).score, game.results.score);
      assert.ok(records.forTrack(trackId, mode.id).bestCombo <= game.results.score);
      assert.deepEqual(records.legacyForTrack(trackId, mode.id), { score: null, bestCombo: null }, 'nothing is filed as legacy scoring');
      for (const other of HANDLING_IDS.filter((h) => h !== mode.id)) assert.deepEqual(records.forTrack(trackId, other), NONE);
    });
  }
}
