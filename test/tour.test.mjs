// Circuit Tour (v0.9.0): the championship layer, its storage, and that a Tour round is an
// ordinary circuit run. See docs/CIRCUIT-TOUR.md.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import * as TOUR from '../src/tour.js';
import {
  TOUR_RULES_ID, PAR, TOUR_LENGTHS, TOUR_FIELDS, RIVALS, SERIES_POINTS, JOKER_MULTIPLIER, PLAYER_ID,
  createTour, tourLineup, standing, roundResult, roundTable, recordRound, useRestart, leaveRound, retireTour, standings,
  titleOpen, tourOutcome, tourPoints, isTour, tourCode, seedFromCode, seededRandom, rivalScore, roundStakes,
  FINAL_MULTIPLIER, roundMultiplier, jokerAllowed, jokerState, pointsBreakdown, pointsStillAvailable,
} from '../src/tour.js';
import { createTourStore, readTourStore, foldBest, bestsKey, TOUR_STORE_KEY, RESEARCH_TOUR_KEY, TOUR_STORE_VERSION, HISTORY_LIMIT } from '../src/tour-store.js';
import { TRACKS, trackById } from '../src/track.js';
import { HANDLING_IDS, handlingById } from '../src/handling.js';
import { createGame, startRun, tick } from '../src/game.js';
import { createRecords, RECORDS_KEY } from '../src/records.js';
import { createGhostStore, GHOST_STORE_KEY } from '../src/ghost-store.js';
import { createReferenceGhosts } from '../src/reference-ghost.js';
import { driftDriver } from './support/drivers.mjs';

const TRACK_IDS = TRACKS.map((t) => t.id);
const memory = (initial = {}) => {
  const map = new Map(Object.entries(initial));
  return { map, getItem: (k) => (map.has(k) ? map.get(k) : null), setItem: (k, v) => { map.set(k, String(v)); }, removeItem: (k) => map.delete(k) };
};
// Drives a Tour to the end with a score per round from `scoreFor(tour, round)`.
function play(tour, scoreFor, { joker = null } = {}) {
  let t = tour;
  while (t.status === 'active') t = recordRound(t, { score: scoreFor(t, t.round), joker: joker === t.round });
  return t;
}
const parScore = (mult) => (t, i) => Math.round(PAR[t.lineup[i]][t.handling] * TOUR_FIELDS[t.field].scale * mult);

// --- 1. The tables ---------------------------------------------------------------------------
test('PAR covers every circuit in both public handling modes, frozen, with the research sweep values', () => {
  assert.deepEqual(Object.keys(PAR).sort(), [...TRACK_IDS].sort());
  for (const id of TRACK_IDS) {
    assert.ok(Object.isFrozen(PAR[id]));
    assert.deepEqual(Object.keys(PAR[id]).sort(), [...HANDLING_IDS].sort());
    for (const h of HANDLING_IDS) assert.ok(Number.isSafeInteger(PAR[id][h]) && PAR[id][h] > 1000, `${id} ${h}`);
  }
  // A change to these is a change of the Tour's rules: it needs a new TOUR_RULES_ID.
  assert.equal(TOUR_RULES_ID, 'tour-1');
  assert.deepEqual(PAR, {
    original: { classic: 7841, revised: 9850 }, switchback: { classic: 7431, revised: 8829 }, dockyard: { classic: 4102, revised: 5857 },
    'runway-27': { classic: 7154, revised: 7673 }, 'redline-mesa': { classic: 4165, revised: 7137 },
    'headland-run': { classic: 5769, revised: 7614 }, 'nightshift-viaduct': { classic: 6245, revised: 7325 },
  });
  assert.deepEqual(SERIES_POINTS, [10, 7, 5, 3, 2, 1]);
  assert.deepEqual(Object.values(TOUR_FIELDS).map((f) => f.scale), [0.95, 1.3, 1.7]);
  assert.deepEqual(Object.values(TOUR_LENGTHS).map((l) => [l.rounds, l.restarts]), [[4, 2], [7, 3]]);
  assert.equal(JOKER_MULTIPLIER, 2);
  assert.equal(FINAL_MULTIPLIER, 2);
  assert.equal(createTour({ seed: 1 }).finalDouble, true, 'the final round counts double by default');
  assert.equal(RIVALS.length + 1, SERIES_POINTS.length, 'one points place per driver');
  assert.equal(new Set(RIVALS.map((r) => r.id)).size, RIVALS.length);
  for (const rival of RIVALS) assert.ok(rival.likes.every((id) => TRACK_IDS.includes(id)), rival.id);
});

test('the Tour layer is pure and never reaches into the simulation, scoring or other storage', () => {
  const tourSource = readFileSync(new URL('../src/tour.js', import.meta.url), 'utf8');
  const storeSource = readFileSync(new URL('../src/tour-store.js', import.meta.url), 'utf8');
  const imports = (text) => [...text.matchAll(/from '(\.\/[\w-]+\.js)'/g)].map((m) => m[1]);
  assert.deepEqual(imports(tourSource), ['./track.js']);
  assert.deepEqual(imports(storeSource), ['./tour.js']);
  const code = tourSource.split(/\r?\n/).filter((line) => !line.trim().startsWith('//')).join('\n');
  assert.doesNotMatch(code, /Math\.random|Date\.|localStorage|document\.|window\./);
  for (const key of [RECORDS_KEY, GHOST_STORE_KEY, 'mini-drifters-gymkhana', 'mini-drifters-getaway']) {
    assert.ok(!storeSource.includes(key), `the Tour store never names ${key}`);
  }
  assert.equal(TOUR_STORE_KEY, 'mini-drifters-tour-v1');
  assert.equal(RESEARCH_TOUR_KEY, 'mini-drifters-r2-tour');
});

// The accepted R2 research build's Championship, run over 200 seeds x every length, field and
// handling mode with a Joker and DNFs: lineups, posted scores, stakes, standings and outcomes.
// The hash was taken from research/v0.9.0-r2-circuit-tour (e5a5a33). Production removed the
// Targets format and must not have moved anything else.
test('the Championship is exactly the human-accepted R2 research build', () => {
  const out = [];
  for (let seed = 1; seed <= 200; seed += 1) {
    for (const length of ['sprint', 'grand']) for (const field of ['club', 'national', 'pro']) for (const handling of ['classic', 'revised']) {
      let t = createTour({ seed: seed * 7919, length, field, handling });
      out.push([t.lineup, t.marks.map((m) => m.map((x) => [x.id, x.score]))]);
      const jokerAt = seed % t.lineup.length === t.lineup.length - 1 ? 0 : seed % t.lineup.length;
      while (t.status === 'active') {
        const st = roundStakes(t, { joker: t.round === jokerAt });
        const marks = t.marks[t.round];
        const k = (seed + t.round) % 6;
        const score = k === 5 ? 0 : marks[k].score + (seed % 2);
        t = recordRound(t, { score: seed % 11 === 0 && t.round === 1 ? null : score, joker: t.round === jokerAt && jokerAllowed(t) });
        out.push([st?.places, st?.champion, st?.lead, st?.podium]);
      }
      out.push(standings(t).map((r) => [r.id, r.points, r.position]), tourOutcome(t));
    }
  }
  assert.equal(out.length, 20400);
  assert.equal(createHash('sha256').update(JSON.stringify(out)).digest('hex'), '665e26b934fca78a0776e0a62c1fcefd77c9cda2f0c67272fabd9135c5732c5f');
});

test('production has no research formats: no Targets, no scoring comparison, no format setting', () => {
  for (const name of ['TOUR_FORMATS', 'FORMAT_IDS', 'TARGET_MARKS', 'TARGET_TOUR_MEDALS', 'targetsMaximum', 'scoringComparison']) {
    assert.equal(name in TOUR, false, name);
  }
  const t = createTour({ seed: 9, format: 'targets' });
  assert.equal('format' in t, false, 'a format setting is ignored, never stored');
  assert.equal(t.marks[0].length, RIVALS.length, 'every Tour is the Championship');
  for (const file of ['../src/tour.js', '../src/tour-ui.js', '../src/tour-store.js', '../src/main.js', '../index.html']) {
    const text = readFileSync(new URL(file, import.meta.url), 'utf8');
    assert.doesNotMatch(text, /research=tour|TOUR_RESEARCH|tour-markup|tour-formats|tour-compare/, file);
  }
});

// --- 2. Making a Tour ---------------------------------------------------------------------------
test('a Tour is decided entirely by its seed: same seed, same circuits and posted scores', () => {
  const a = createTour({ seed: 12345, length: 'grand', field: 'national', handling: 'revised' });
  const b = createTour({ seed: 12345, length: 'grand', field: 'national', handling: 'revised' });
  assert.deepEqual(a, b);
  const c = createTour({ seed: 12346, length: 'grand', field: 'national', handling: 'revised' });
  assert.notDeepEqual(a.marks, c.marks);
  assert.equal(a.lineup.length, 7);
  assert.deepEqual([...a.lineup].sort(), [...TRACK_IDS].sort(), 'a Grand Tour drives every circuit once');
  for (const marks of a.marks) {
    assert.equal(marks.length, RIVALS.length);
    for (let i = 1; i < marks.length; i += 1) assert.ok(marks[i - 1].score >= marks[i].score, 'best first');
    assert.ok(marks.every((m) => Number.isSafeInteger(m.score) && m.score >= 0));
  }
  assert.equal(a.round, 0);
  assert.equal(a.restartsLeft, 3);
  assert.equal(a.jokerRound, null);
  assert.equal(a.status, 'active');
  assert.equal(seedFromCode(a.code), 12345);
  assert.equal(tourCode(0xffffffff), '1Z141Z3');
  assert.equal(seedFromCode('not a code!'), null);
});

test('Sprint lineups vary: every circuit appears, in many different orders', () => {
  const lineups = new Set();
  const counts = Object.fromEntries(TRACK_IDS.map((id) => [id, 0]));
  for (let seed = 1; seed <= 400; seed += 1) {
    const lineup = tourLineup(seed, 4);
    assert.equal(new Set(lineup).size, 4);
    lineups.add(lineup.join());
    for (const id of lineup) counts[id] += 1;
  }
  assert.ok(lineups.size > 300, `${lineups.size} distinct lineups`);
  for (const [id, n] of Object.entries(counts)) assert.ok(n > 150 && n < 310, `${id} drawn ${n} times in 400`);
});

test('settings are validated', () => {
  assert.throws(() => createTour({ seed: 1, length: 'marathon' }));
  assert.throws(() => createTour({ seed: 1, field: 'legend' }));
  assert.throws(() => createTour({ seed: 1, handling: 'tuned' }), /handling/);
});

test('rival scores follow the field: stronger fields post higher, specialists shine at home', () => {
  const mean = (fieldScale, rival, trackId) => {
    const r = seededRandom(77);
    let sum = 0;
    for (let i = 0; i < 4000; i += 1) sum += rivalScore(r, rival, trackId, 'classic', fieldScale);
    return sum / 4000;
  };
  const kit = RIVALS.find((r) => r.id === 'kit');
  const club = mean(TOUR_FIELDS.club.scale, kit, 'original');
  const pro = mean(TOUR_FIELDS.pro.scale, kit, 'original');
  assert.ok(Math.abs(pro / club - TOUR_FIELDS.pro.scale / TOUR_FIELDS.club.scale) < 0.06, `${pro / club}`);
  // Kit's typical run, allowing for blunders: close to PAR x scale x level.
  assert.ok(Math.abs(club / (PAR.original.classic * TOUR_FIELDS.club.scale * kit.level) - 1) < 0.06);
  const marisol = RIVALS.find((r) => r.id === 'marisol');
  assert.ok(mean(1, marisol, 'dockyard') / PAR.dockyard.classic > mean(1, marisol, 'runway-27') / PAR['runway-27'].classic * 1.1);
});

// --- 3. Rounds, points and standings ----------------------------------------------------------------
test('a round: where a score stands, strictly beating a mark to pass it, and the points it earns', () => {
  const t = createTour({ seed: 4 });
  const marks = t.marks[0];
  assert.equal(standing(t, 0, 0).position, 6);
  assert.equal(standing(t, 0, marks[0].score + 1).position, 1);
  assert.equal(standing(t, 0, marks[0].score + 1).next, null);
  const tie = standing(t, 0, marks[2].score);
  assert.equal(tie.position, 4, 'a tie stays behind the posted score');
  assert.equal(tie.gap, 1);
  assert.equal(standing(t, 0, marks[4].score - 100).gap, 101);
  for (let place = 1; place <= 6; place += 1) {
    const score = place === 6 ? 0 : marks[place - 1].score + 1 - (place === 1 ? 0 : 0);
    const r = roundResult(t, 0, { score: place === 1 ? marks[0].score + 1 : place === 6 ? 0 : marks[place - 1].score - 0 });
    void score;
    assert.equal(r.points, SERIES_POINTS[r.position - 1]);
  }
  const dnf = roundResult(t, 0, { score: null });
  assert.deepEqual([dnf.dnf, dnf.position, dnf.points, dnf.score], [true, 6, 0, 0]);
  const joker = roundResult(t, 0, { score: marks[0].score + 1, joker: true });
  assert.equal(joker.points, 10 * JOKER_MULTIPLIER);
});

test('recording rounds moves the Tour on without changing the old state, and the Joker is played once', () => {
  const t0 = createTour({ seed: 21 });
  const before = structuredClone(t0);
  const t1 = recordRound(t0, { score: 5000, joker: true });
  assert.deepEqual(t0, before, 'immutable');
  assert.equal(t1.round, 1);
  assert.equal(t1.jokerRound, 0);
  assert.throws(() => recordRound(t1, { score: 5000, joker: true }), /Joker/);
  const done = play(t1, () => 5000);
  assert.equal(done.status, 'complete');
  assert.equal(done.results.length, 4);
  assert.throws(() => recordRound(done, { score: 1 }), /over/);
  assert.equal(tourPoints(done), done.results.reduce((s, r) => s + r.points, 0));
});

test('restarts and leaving: free on the grid, a restart once driving, a DNF with none left', () => {
  let t = createTour({ seed: 5 });
  assert.equal(t.restartsLeft, 2);
  t = useRestart(t);
  assert.equal(t.restartsLeft, 1);
  let left = leaveRound(t);
  assert.equal(left.cost, 'restart');
  assert.equal(left.tour.restartsLeft, 0);
  assert.equal(left.tour.round, 0, 'the same round is driven again');
  left = leaveRound(left.tour);
  assert.equal(left.cost, 'dnf');
  assert.equal(left.tour.round, 1);
  assert.deepEqual([left.tour.results[0].dnf, left.tour.results[0].points], [true, 0]);
  assert.equal(useRestart(left.tour).restartsLeft, 0, 'never below zero');
  assert.equal(retireTour(left.tour).status, 'retired');
});

test('standings add points, break ties on wins then places then total, and know when the title is gone', () => {
  const t = createTour({ seed: 33 });
  const table0 = standings(t);
  assert.equal(table0.length, 6);
  assert.ok(table0.every((r) => r.points === 0));
  assert.equal(table0[0].id, PLAYER_ID, 'level on nothing: the player is listed first');
  const t1 = recordRound(t, { score: t.marks[0][0].score + 1 });
  const s1 = standings(t1);
  assert.equal(s1[0].id, PLAYER_ID);
  assert.equal(s1[0].points, 10);
  assert.equal(s1[0].places[0], 1);
  // Last in every round of a Grand Tour: the title goes, and is known to be gone before the end
  // (in a Sprint the unplayed Joker can keep it mathematically open to the last round).
  let low = createTour({ seed: 33, length: 'grand' });
  let closedAt = null;
  while (low.status === 'active') {
    if (closedAt === null && titleOpen(low) === false) closedAt = low.round;
    low = recordRound(low, { score: 0 });
  }
  assert.ok(closedAt !== null && closedAt < 7, `closed before the last round (${closedAt})`);
  assert.equal(tourOutcome(low).place, 6);
  assert.equal(tourOutcome(low).trophy, null);
  // First in every round: champion, a clean sweep, and a gold trophy.
  const high = play(t, (tour, i) => tour.marks[i][0].score + 1);
  assert.deepEqual(tourOutcome(high), { place: 1, trophy: 'gold', points: 50, champion: true, sweep: true }, 'three wins and a double final');
  // The round table places the player among the posted scores.
  const table = roundTable(high, 0);
  assert.equal(table[0].id, PLAYER_ID);
  assert.deepEqual(table.map((r) => r.points), SERIES_POINTS);
});

test('round stakes come straight from the posted scores: what each round place would do to the table', () => {
  for (let seed = 1; seed <= 60; seed += 1) {
    let t = createTour({ seed, length: 'sprint', field: 'national' });
    while (t.status === 'active') {
      const st = roundStakes(t);
      const known = st.places.filter((x) => x !== null);
      for (let k = 1; k < known.length; k += 1) assert.ok(known[k] >= known[k - 1], 'a worse round place never gives a better table place');
      // Each claim checks out by actually recording that round place.
      st.places.forEach((place, k) => {
        if (place === null) return;
        const score = k === 0 ? t.marks[t.round][0].score + 1 : k === 5 ? 0 : t.marks[t.round][k].score + 1;
        assert.equal(standings(recordRound(t, { score })).find((r) => r.player).position, place);
      });
      assert.equal(st.final, t.round === 3);
      if (st.final) assert.equal(st.champion, st.lead);
      else assert.equal(st.champion, null);
      t = recordRound(t, { score: Math.round(t.marks[t.round][2].score * (seed % 3 === 0 ? 1.5 : 0.8)) });
    }
    assert.equal(roundStakes(t), null, 'nothing left to decide');
  }
  // Three wins settle a Sprint when every round is alike; a double final keeps the rivals in it.
  // Pointless (three DNFs): never champion.
  const winThree = (tour) => [0, 1, 2].reduce((x) => recordRound(x, { score: x.marks[x.round][0].score + 1 }), tour);
  assert.equal(roundStakes(winThree(createTour({ seed: 3, finalDouble: false }))).champion, 6);
  const doubled3 = roundStakes(winThree(createTour({ seed: 3 })));
  assert.ok(doubled3.champion >= 3 && doubled3.champion < 6, `champion if P${doubled3.champion} or better`);
  const t = createTour({ seed: 3 });
  const hopeless = [0, 1, 2].reduce((tour) => recordRound(tour, { score: null }), t);
  assert.equal(roundStakes(hopeless).champion, null);
  // The Joker can only help.
  const mid = [0, 1, 2].reduce((tour, i) => recordRound(tour, { score: tour.marks[tour.round][i % 2 ? 1 : 3].score + 1 }), t);
  const plain = roundStakes(mid);
  const doubled = roundStakes(mid, { joker: true });
  plain.places.forEach((place, k) => { if (place !== null) assert.ok(doubled.places[k] <= place); });
});

test('the final round counts double for everyone, and the Joker is for the other rounds', () => {
  const t = createTour({ seed: 14 });
  assert.deepEqual([0, 1, 2, 3].map((i) => roundMultiplier(t, i)), [1, 1, 1, 2]);
  const toFinal = [0, 1, 2].reduce((tour) => recordRound(tour, { score: 0 }), t);
  assert.equal(jokerAllowed(toFinal), false);
  assert.throws(() => recordRound(toFinal, { score: 1, joker: true }), /cannot be played/);
  const done = recordRound(toFinal, { score: toFinal.marks[3][0].score + 1 });
  assert.equal(done.results[3].points, 20);
  assert.deepEqual(roundTable(done, 3).map((r) => r.points), SERIES_POINTS.map((p) => p * 2));
  // What is still available counts the double final, and the Joker on a round that allows it.
  assert.equal(pointsStillAvailable(t, true), 10 + 10 + 10 + 20 + 10);
  assert.equal(pointsStillAvailable(t, false), 50);
  assert.equal(pointsStillAvailable(toFinal, true), 20);
  // Without the rule: every round alike, and the Joker allowed in the last.
  const plain = createTour({ seed: 14, finalDouble: false });
  assert.deepEqual([0, 1, 2, 3].map((i) => roundMultiplier(plain, i)), [1, 1, 1, 1]);
  assert.equal(jokerAllowed([0, 1, 2].reduce((tour) => recordRound(tour, { score: 0 }), plain)), true);
  assert.ok(isTour(plain));
});

test('the Joker as the round sheet shows it: available, selected, used, or locked in the final', () => {
  const t = createTour({ seed: 14 });
  assert.deepEqual(jokerState(t), { state: 'available', round: null, lastChance: false });
  assert.deepEqual(jokerState(t, { armed: true }), { state: 'selected', round: null, lastChance: false });
  // Round 3 of a Sprint is the last round before the double final: the last chance.
  const third = [0, 1].reduce((tour) => recordRound(tour, { score: 0 }), t);
  assert.deepEqual(jokerState(third), { state: 'available', round: null, lastChance: true });
  const final = recordRound(third, { score: 0 });
  assert.deepEqual(jokerState(final), { state: 'locked', round: null, lastChance: false }, 'never in the final');
  assert.deepEqual(jokerState(final, { armed: true }).state, 'locked', 'a stray armed flag cannot select it there');
  const played = recordRound(t, { score: t.marks[0][1].score + 1, joker: true });
  assert.deepEqual(jokerState(played), { state: 'used', round: 0, lastChance: false });
  assert.deepEqual(jokerState(recordRound(recordRound(recordRound(played, { score: 0 }), { score: 0 }), { score: 0 })).state, 'used');
  // A Grand Tour: rounds 1 to 6 allow it, the seventh is the final.
  const grand = createTour({ seed: 14, length: 'grand' });
  const sixth = [0, 1, 2, 3, 4].reduce((tour) => recordRound(tour, { score: 0 }), grand);
  assert.equal(jokerState(sixth).lastChance, true);
  assert.equal(jokerState(recordRound(sixth, { score: 0 })).state, 'locked');
});

test('a round\'s points spelt out: place points, then the Joker and the double final, never both', () => {
  const t = createTour({ seed: 14 });
  const p2 = recordRound(t, { score: t.marks[0][1].score + 1, joker: true });
  assert.deepEqual(pointsBreakdown(p2, 0), { base: 7, joker: 2, final: 1, total: 14 });
  const plain = recordRound(p2, { score: p2.marks[1][0].score + 1 });
  assert.deepEqual(pointsBreakdown(plain, 1), { base: 10, joker: 1, final: 1, total: 10 });
  const toFinal = recordRound(plain, { score: 0 });
  const done = recordRound(toFinal, { score: toFinal.marks[3][2].score + 1 });
  assert.deepEqual(pointsBreakdown(done, 3), { base: 5, joker: 1, final: 2, total: 10 });
  assert.equal(tourPoints(done), 14 + 10 + 1 + 10);
  for (const [i, r] of done.results.entries()) {
    const b = pointsBreakdown(done, i);
    assert.equal(b.base * b.joker * b.final, r.points);
    assert.ok(b.joker * b.final <= 2, 'no round is ever worth more than double');
  }
  // Rivals never get the Joker: only the player's row is doubled.
  assert.deepEqual(roundTable(p2, 0).filter((r) => !r.player).map((r) => r.points), [10, 5, 3, 2, 1]);
});

test('the Joker is only spent by a recorded round: leaving, restarting or a DNF keeps it', () => {
  const t = createTour({ seed: 22 });
  assert.equal(useRestart(t).jokerRound, null);
  assert.equal(leaveRound(t).tour.jokerRound, null, 'a round left with a restart');
  const noRestarts = useRestart(useRestart(t));
  const dnf = leaveRound(noRestarts);
  assert.equal(dnf.cost, 'dnf');
  assert.equal(dnf.tour.results[0].joker, false);
  assert.equal(dnf.tour.jokerRound, null, 'a DNF never plays the Joker');
  assert.equal(jokerState(dnf.tour).state, 'available');
  // Saved and read back, the Joker's round survives, and a played Joker stays played.
  const storage = memory();
  const store = createTourStore(() => storage);
  store.begin(t);
  const played = recordRound(t, { score: 5000, joker: true });
  assert.deepEqual(store.update(t, played), { ok: true });
  const reloaded = createTourStore(() => storage).load().active;
  assert.equal(reloaded.jokerRound, 0);
  assert.equal(jokerState(reloaded).state, 'used');
  assert.throws(() => recordRound(reloaded, { score: 1, joker: true }), /Joker/);
});

test('skill decides a Tour: twice the field wins almost always, half the field almost never podiums', () => {
  let champs = 0;
  let podiums = 0;
  for (let seed = 1; seed <= 300; seed += 1) {
    const t = createTour({ seed, field: 'national' });
    if (tourOutcome(play(t, parScore(2))).champion) champs += 1;
    if (tourOutcome(play(t, parScore(0.5))).trophy) podiums += 1;
  }
  assert.ok(champs / 300 > 0.95, `${champs}/300 titles at 2x the field`);
  assert.ok(podiums / 300 < 0.05, `${podiums}/300 podiums at 0.5x the field`);
});

test('consistency beats one spike: the same normalised total wins far more often when spread evenly', () => {
  let steady = 0;
  let spike = 0;
  for (let seed = 1; seed <= 300; seed += 1) {
    const t = createTour({ seed, field: 'national' });
    const even = play(t, parScore(1.2));
    const peaky = play(t, (tour, i) => parScore(i === 2 ? 3.0 : 0.6)(tour, i));
    const normalised = (x) => Math.round(x.results.reduce((s, r) => s + 1000 * r.score / PAR[r.trackId][x.handling], 0));
    assert.ok(Math.abs(normalised(even) - normalised(peaky)) < 20);
    if (tourOutcome(even).champion) steady += 1;
    if (tourOutcome(peaky).champion) spike += 1;
  }
  assert.ok(steady > 200 && spike < 30, `steady ${steady}, spike ${spike}`);
});

test('isTour accepts what createTour makes and rejects damaged or foreign Tours', () => {
  const t = recordRound(createTour({ seed: 11 }), { score: 1234, joker: true });
  assert.ok(isTour(t));
  assert.ok(isTour(JSON.parse(JSON.stringify(t))));
  const bad = [
    { ...t, rules: 'tour-r9' }, { ...t, rules: 'tour-r2-1' }, { ...t, length: 'marathon' }, { ...t, lineup: ['original', 'original', 'dockyard', 'switchback'] },
    { ...t, lineup: [...t.lineup.slice(0, 3), 'exp-runway-27'] }, { ...t, round: 2 }, { ...t, results: [] },
    { ...t, restartsLeft: -1 }, { ...t, restartsLeft: 9 }, { ...t, jokerRound: 3 }, { ...t, status: 'paused' },
    { ...t, marks: t.marks.slice(1) }, { ...t, marks: [[{ id: 'kit', name: 'Kit', score: -5 }], ...t.marks.slice(1)] },
    { ...t, handling: 'tuned' }, { ...t, finalDouble: 'yes' }, null, [], 'tour',
  ];
  for (const b of bad) assert.equal(isTour(b), false, JSON.stringify(b)?.slice(0, 80));
});

// --- 4. Storage ---------------------------------------------------------------------------------------
test('the Tour store: one key of its own, a round written only to the same Tour at the same round', () => {
  const storage = memory({ [RECORDS_KEY]: '{"version":3,"tracks":{}}', other: 'x' });
  const store = createTourStore(() => storage);
  assert.equal(store.load().active, null);
  assert.equal(storage.map.has(TOUR_STORE_KEY), false, 'nothing is written on load');
  const t = createTour({ seed: 3 });
  assert.ok(store.begin(t));
  assert.equal(store.load().active.code, t.code);
  const t1 = recordRound(t, { score: 4000 });
  assert.deepEqual(store.update(t, t1), { ok: true });
  // A second tab still holding round 0 cannot overwrite round 1.
  assert.deepEqual(store.update(t, recordRound(t, { score: 99999 })), { ok: false, reason: 'moved' });
  assert.equal(store.load().active.results[0].score, 4000);
  assert.ok(store.setDriving(t1, 1));
  assert.equal(store.load().active.driving, 1);
  assert.equal(store.setDriving(t, 0), false);
  const done = play(t1, () => 4000);
  assert.deepEqual(store.update(t1, done), { ok: true });
  const after = store.load();
  assert.equal(after.active, null);
  assert.equal(after.history[0].code, t.code);
  assert.equal(after.history[0].rounds.length, 4);
  assert.equal(after.bests[bestsKey(t)].finished, 1);
  assert.deepEqual([...storage.map.keys()].sort(), [RECORDS_KEY, 'other', TOUR_STORE_KEY].sort());
  assert.equal(storage.getItem(RECORDS_KEY), '{"version":3,"tracks":{}}', 'other keys untouched');
  assert.equal(storage.getItem('other'), 'x');
});

test('the Tour store: new Tours retire the old one, history is capped, bests only from finished Tours', () => {
  const storage = memory();
  const store = createTourStore(() => storage);
  for (let i = 0; i < HISTORY_LIMIT + 3; i += 1) store.begin(createTour({ seed: 100 + i }));
  const loaded = store.load();
  assert.equal(loaded.history.length, HISTORY_LIMIT);
  assert.ok(loaded.history.every((h) => h.status === 'retired' && h.outcome === null));
  assert.deepEqual(loaded.bests, {});
  const t = createTour({ seed: 5, field: 'pro' });
  const won = play(t, (tour, i) => tour.marks[i][0].score + 1);
  const lost = play(t, () => 0);
  let bests = foldBest({}, won);
  bests = foldBest(bests, lost);
  bests = foldBest(bests, retireTour(t));
  assert.deepEqual(bests[bestsKey(t)], { finished: 2, champion: 1, podium: 1, sweeps: 1, bestPlace: 1, bestTrophy: 'gold', bestPoints: 50 });
});

test('the Tour store reads damaged, foreign and later data safely', () => {
  assert.equal(readTourStore(null).status, 'empty');
  assert.equal(readTourStore('{nope').status, 'corrupt');
  assert.equal(readTourStore('[]').status, 'corrupt');
  assert.equal(readTourStore('{"version":0}').status, 'corrupt');
  assert.equal(readTourStore(JSON.stringify({ version: TOUR_STORE_VERSION + 1 })).status, 'unsupported');
  // The R2 research build's key is never read, written or migrated.
  const research = JSON.stringify({ version: 1, active: { ...createTour({ seed: 1 }), rules: 'tour-r2-1', format: 'series' }, history: [], bests: {} });
  const both = memory({ [RESEARCH_TOUR_KEY]: research });
  const production = createTourStore(() => both);
  assert.equal(production.load().active, null, 'a research save does not appear as a Tour to continue');
  assert.equal(production.load().setAside, false);
  assert.ok(production.begin(createTour({ seed: 2 })));
  assert.equal(both.getItem(RESEARCH_TOUR_KEY), research, 'the research save is left exactly as it was');
  assert.deepEqual([...both.map.keys()].sort(), [RESEARCH_TOUR_KEY, TOUR_STORE_KEY].sort());
  // A damaged active Tour is set aside, never resumed.
  const damaged = memory({ [TOUR_STORE_KEY]: JSON.stringify({ version: 1, active: { ...createTour({ seed: 1 }), rules: 'old' }, history: [], bests: {} }) });
  const store = createTourStore(() => damaged);
  const loaded = store.load();
  assert.equal(loaded.active, null);
  assert.equal(loaded.setAside, true);
  // A later version is never written.
  const later = JSON.stringify({ version: 2, active: null, future: true });
  const newer = memory({ [TOUR_STORE_KEY]: later });
  const readOnly = createTourStore(() => newer);
  readOnly.load();
  assert.equal(readOnly.begin(createTour({ seed: 1 })), false);
  assert.equal(readOnly.readOnly, true);
  assert.equal(newer.getItem(TOUR_STORE_KEY), later);
  // No storage at all, or storage that throws: nothing breaks, nothing is claimed.
  const none = createTourStore(() => { throw new Error('denied'); });
  assert.equal(none.available, false);
  assert.equal(none.begin(createTour({ seed: 1 })), false);
  const full = { getItem: () => null, setItem: () => { throw new Error('QuotaExceededError'); } };
  const quota = createTourStore(() => full);
  assert.equal(quota.begin(createTour({ seed: 1 })), false);
  assert.equal(quota.available, false);
});

// --- 5. A Tour round is an ordinary circuit run --------------------------------------------------------
test('a Tour round is a normal three-lap run: same score, and the circuit records and ghosts see it as any run', () => {
  const storage = memory();
  const records = createRecords(() => storage);
  const referenceGhosts = createReferenceGhosts({ store: createGhostStore(() => storage), bestLapFor: (t, h) => records.forTrack(t, h).fastestLap });
  const tourStore = createTourStore(() => storage);
  let tour = createTour({ seed: 7, field: 'club', handling: 'revised' });
  tourStore.begin(tour);
  const trackId = tour.lineup[0];
  const game = createGame(trackById(trackId), { handling: handlingById('revised'), onRunEvent: (e) => { records.handle(e); referenceGhosts.handle(e); } });
  startRun(game, { track: trackById(trackId), handling: handlingById('revised') });
  const driver = driftDriver();
  while (game.state !== 'finished' && game.ticks < 120 * 600) tick(game, driver(game));
  assert.equal(game.state, 'finished');
  const next = recordRound(tour, { score: game.results.score });
  assert.deepEqual(tourStore.update(tour, next), { ok: true });
  tour = next;
  assert.equal(tour.results[0].score, game.results.score, 'the Tour keeps exactly the run\'s counted score');
  assert.equal(records.forTrack(trackId, 'revised').score, game.results.score, 'the run set the ordinary circuit record');
  assert.equal(records.forTrack(trackId, 'revised').fastestLap, game.laps.bestLap);
  assert.ok(storage.map.has(GHOST_STORE_KEY), 'its flying laps are offered to the saved reference ghost');
  assert.deepEqual([...storage.map.keys()].sort(), [GHOST_STORE_KEY, RECORDS_KEY, TOUR_STORE_KEY].sort());
  assert.ok(isTour(tourStore.load().active));
});

test('lengths and fields exist as the sheet offers them', () => {
  assert.deepEqual(Object.keys(TOUR_LENGTHS), ['sprint', 'grand']);
  assert.deepEqual(Object.keys(TOUR_FIELDS), ['club', 'national', 'pro']);
});
