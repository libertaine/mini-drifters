// Circuit Tour (v0.9.0): the championship layer over normal circuit runs.
//
// A Tour is a short championship. Each round is one ordinary three-lap circuit run, driven with
// the same physics, drift scoring and lap validation as any other run: this file never touches
// them. It only reads the run's final counted score, and decides what that score is worth in the
// competition. Everything here is pure: no browser, no storage, no clock, no Math.random.
//
// Five fictional rival drifters post their scores for a round before the player drives, so the
// player always runs last and always knows what is needed. The finishing position earns
// championship points, and a table is kept across the rounds. The format was chosen by the v0.9.0
// R2 research build (Championship, over a Targets alternative that was dropped) and accepted by
// the owner after human testing; these rules are that build's, unchanged.
//
// Rival scores are scaled from each circuit's PAR for the chosen handling mode, so a
// circuit's length or flow and the handling mode never decide the result: the result is how the
// player drove relative to the field on that circuit. See docs/CIRCUIT-TOUR.md.
import { TRACKS } from './track.js';

// The rules' identity. A saved Tour or Tour best made under other rules is never compared with
// these. Raise it with any change to PAR, the field, the points or what a round is worth.
// 'tour-1' is the R2 research build's rules ('tour-r2-1') unchanged, without the Targets format.
export const TOUR_RULES_ID = 'tour-1';

// The scripted median counted score of a full three-lap run, per circuit and handling mode
// (research sweep: 3,584 runs by 64 scripted drift drivers, 4 runs each, all 7 circuits, both
// modes; harness in the R2 research folder). Human players score differently from scripted ones;
// PAR only sets each circuit's relative scale, and the fields below are tuned from it.
export const PAR = Object.freeze({
  original: Object.freeze({ classic: 7841, revised: 9850 }),
  switchback: Object.freeze({ classic: 7431, revised: 8829 }),
  dockyard: Object.freeze({ classic: 4102, revised: 5857 }),
  'runway-27': Object.freeze({ classic: 7154, revised: 7673 }),
  'redline-mesa': Object.freeze({ classic: 4165, revised: 7137 }),
  'headland-run': Object.freeze({ classic: 5769, revised: 7614 }),
  'nightshift-viaduct': Object.freeze({ classic: 6245, revised: 7325 }),
});

// Restarts are shared by the whole Tour. Leaving a round while driving uses one.
export const TOUR_LENGTHS = Object.freeze({
  sprint: Object.freeze({ id: 'sprint', name: 'Sprint Tour', rounds: 4, restarts: 2 }),
  grand: Object.freeze({ id: 'grand', name: 'Grand Tour', rounds: 7, restarts: 3 }),
});
export const LENGTH_IDS = Object.freeze(Object.keys(TOUR_LENGTHS));

// How strong the field is, as a multiple of PAR. Tuned by the research Monte Carlo against the
// sweep's own run-to-run noise (docs/CIRCUIT-TOUR.md): a player who scores about 1.0x, 1.35x or
// 1.75x the scripted median wins about half their Sprint Tours in Club, National or Pro with a
// first-round Joker (an apt Joker and restarts help a little more). Provisional until a human
// calibration pass.
export const TOUR_FIELDS = Object.freeze({
  club: Object.freeze({ id: 'club', name: 'Club', scale: 0.95, summary: 'A friendly field. Clean runs win rounds.' }),
  national: Object.freeze({ id: 'national', name: 'National', scale: 1.3, summary: 'Linked drifts and banked combos needed.' }),
  pro: Object.freeze({ id: 'pro', name: 'Pro', scale: 1.7, summary: 'Big combos on every circuit, no wasted laps.' }),
});
export const FIELD_IDS = Object.freeze(Object.keys(TOUR_FIELDS));

// The rivals: fictional, the same five in every field (a stronger field is the same people on
// better form). `level` is their typical run against the field's scale, `spread` how much one run
// varies (log scale), `blunder` the chance a run goes badly wrong, and `likes` the circuits they
// are at their best on (+12%; 4% under their level elsewhere).
export const RIVALS = Object.freeze([
  Object.freeze({ id: 'kit', name: 'Kit Calloway', short: 'Kit', tagline: 'Steady hands. Annoyingly consistent.', color: '#5fb3e8', level: 1.06, spread: 0.13, blunder: 0.04, likes: Object.freeze([]) }),
  Object.freeze({ id: 'marisol', name: 'Marisol Vega', short: 'Marisol', tagline: 'Lives for the tight stuff.', color: '#e85f9c', level: 1.0, spread: 0.2, blunder: 0.06, likes: Object.freeze(['dockyard', 'switchback', 'nightshift-viaduct']) }),
  Object.freeze({ id: 'dutch', name: 'Dutch Brennan', short: 'Dutch', tagline: 'Flat out or not at all.', color: '#f2a33a', level: 1.0, spread: 0.2, blunder: 0.06, likes: Object.freeze(['runway-27', 'headland-run', 'original']) }),
  Object.freeze({ id: 'juno', name: 'Juno Sato', short: 'Juno', tagline: 'Brilliant, or in the wall.', color: '#9b7bf0', level: 1.1, spread: 0.3, blunder: 0.15, likes: Object.freeze(['redline-mesa']) }),
  Object.freeze({ id: 'ozzie', name: 'Ozzie Pike', short: 'Ozzie', tagline: 'Still learning. Still sideways.', color: '#7fc96b', level: 0.8, spread: 0.22, blunder: 0.08, likes: Object.freeze([]) }),
]);
export const PLAYER_ID = 'you';

// Championship points by finishing position in a round of six. A round you leave with no restart
// left is a DNF: last, and no points.
export const SERIES_POINTS = Object.freeze([10, 7, 5, 3, 2, 1]);
// The Joker doubles the player's own points in the one round they play it in. It is chosen on the
// round's sheet before the car moves, once per Tour, and it is only spent when that round's result
// is recorded: a round that is left (a restart, a page closed, a DNF) leaves it unplayed.
export const JOKER_MULTIPLIER = 2;
// With `finalDouble` (the default), the last round counts double for every driver, and the Joker
// can be played in any round but that one, so no round is ever worth more than double. The
// research Monte Carlo found it makes the last round decide the title far more often
// (docs/CIRCUIT-TOUR.md).
export const FINAL_MULTIPLIER = 2;

// What every driver's points in a round are multiplied by (the Joker is the player's own, on top).
export const roundMultiplier = (tour, round) => (tour.finalDouble && round === tour.lineup.length - 1 ? FINAL_MULTIPLIER : 1);
// Can the Joker be played in this round?
export const jokerAllowed = (tour, round = tour.round) => tour.status === 'active' && tour.jokerRound === null && roundMultiplier(tour, round) === 1;

// The Joker as the round sheet shows it, for the round about to be driven:
//   'available'  unplayed, and it can be played in this round
//   'selected'   chosen for this round (`armed`); spent when the round's result is recorded
//   'used'       played in an earlier round (`round` says which)
//   'locked'     unplayed, but this is the double-points final, where it cannot be played
// `lastChance` is true when no later round will allow it.
export function jokerState(tour, { armed = false } = {}) {
  if (tour.jokerRound !== null) return { state: 'used', round: tour.jokerRound, lastChance: false };
  if (!jokerAllowed(tour)) return { state: 'locked', round: null, lastChance: false };
  const later = tour.lineup.some((_, k) => k > tour.round && roundMultiplier(tour, k) === 1);
  return { state: armed ? 'selected' : 'available', round: null, lastChance: !later };
}

// How a recorded round's points were made: the place's points, then each multiplier.
export function pointsBreakdown(tour, round) {
  const r = tour.results[round];
  return { base: r.basePoints, joker: r.joker ? JOKER_MULTIPLIER : 1, final: roundMultiplier(tour, round), total: r.points };
}

const TRACK_IDS = TRACKS.map((t) => t.id);

// A small seeded generator (mulberry32). The same seed always gives the same Tour.
export function seededRandom(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const gauss = (r) => Math.sqrt(-2 * Math.log(r() + 1e-12)) * Math.cos(2 * Math.PI * r());

// A seed shown to the player as a short code, and read back from one.
export const tourCode = (seed) => (seed >>> 0).toString(36).toUpperCase().padStart(7, '0');
export const seedFromCode = (code) => {
  const text = String(code).trim().toLowerCase();
  if (!/^[0-9a-z]{1,7}$/.test(text)) return null;
  const n = parseInt(text, 36);
  return Number.isSafeInteger(n) && n <= 0xffffffff ? n >>> 0 : null;
};

// The circuits of a Tour, in order: a seeded draw from all seven without repeats.
export function tourLineup(seed, rounds) {
  const r = seededRandom(seed ^ 0x9e3779b9);
  const ids = [...TRACK_IDS];
  for (let i = ids.length - 1; i > 0; i -= 1) {
    const j = Math.floor(r() * (i + 1));
    [ids[i], ids[j]] = [ids[j], ids[i]];
  }
  return ids.slice(0, Math.min(rounds, ids.length));
}

// One rival's posted score on a circuit. Whole points, like every drift score.
export function rivalScore(r, rival, trackId, handlingId, fieldScale) {
  const par = PAR[trackId][handlingId];
  const affinity = rival.likes.length === 0 ? 1 : rival.likes.includes(trackId) ? 1.12 : 0.96;
  let score = par * fieldScale * rival.level * affinity * Math.exp(rival.spread * gauss(r) - rival.spread ** 2 / 2);
  if (r() < rival.blunder) score *= 0.35 + 0.3 * r();
  return Math.max(0, Math.round(score));
}

// The marks of one round: the rivals' posted scores, best first.
function roundMarks(r, trackId, handlingId, fieldScale) {
  return RIVALS.map((rival) => ({ id: rival.id, name: rival.name, score: rivalScore(r, rival, trackId, handlingId, fieldScale) }))
    .sort((a, b) => b.score - a.score);
}

const known = (table, id) => Object.hasOwn(table, id);

// A new Tour. Everything about it is decided here, from the seed, and kept in the state, so a
// saved Tour never changes if this file later does.
export function createTour({ seed, length = 'sprint', field = 'club', handling = 'classic', finalDouble = true }) {
  if (!known(TOUR_LENGTHS, length) || !known(TOUR_FIELDS, field)) throw new Error('Unknown Tour settings');
  if (!['classic', 'revised'].includes(handling)) throw new Error(`Unknown handling: ${handling}`);
  const s = seed >>> 0;
  const lineup = tourLineup(s, TOUR_LENGTHS[length].rounds);
  const r = seededRandom(s);
  const marks = lineup.map((trackId) => roundMarks(r, trackId, handling, TOUR_FIELDS[field].scale));
  return {
    rules: TOUR_RULES_ID,
    seed: s,
    code: tourCode(s),
    length, field, handling,
    lineup,
    marks,               // marks[round] = [{ id, name, score }], best first
    round: 0,            // the next round to drive
    results: [],         // one per round driven: see roundResult
    restartsLeft: TOUR_LENGTHS[length].restarts,
    jokerRound: null,    // the round the Joker was played in, once played
    finalDouble: finalDouble === true, // the last round counts double for everyone
    status: 'active',    // 'active' | 'complete' | 'retired'
  };
}

// Where a score stands among a round's marks, live during the run or at the line.
//   position  1-based place among the player and the five posted scores
//   next      the next mark up, or null when there is none above
//   gap       points needed to pass `next` (beating it means strictly more)
export function standing(tour, round, score) {
  const marks = tour.marks[round];
  const above = marks.filter((m) => m.score >= score);
  const next = above.length ? above[above.length - 1] : null;
  const gap = next ? next.score - score + 1 : 0;
  return { position: above.length + 1, next, gap };
}

// What a round is worth once the run is over. `score` is the run's final counted score, or null
// for a DNF (a round left with no restart remaining). `joker` doubles the player's points.
export function roundResult(tour, round, { score, joker = false, run = null }) {
  const dnf = score === null;
  const value = dnf ? 0 : Math.max(0, Math.round(score));
  const mult = (joker ? JOKER_MULTIPLIER : 1) * roundMultiplier(tour, round);
  const position = dnf ? RIVALS.length + 1 : standing(tour, round, value).position;
  const base = dnf ? 0 : SERIES_POINTS[position - 1];
  return { trackId: tour.lineup[round], score: value, dnf, joker, position, basePoints: base, points: base * mult, run };
}

// The rivals' places and points in a round, with the player placed among them.
export function roundTable(tour, round) {
  const result = tour.results[round] ?? null;
  const rows = tour.marks[round].map((m) => ({ id: m.id, name: m.name, score: m.score, player: false }));
  if (result) {
    const player = { id: PLAYER_ID, name: 'You', score: result.score, player: true, dnf: result.dnf };
    if (result.dnf) rows.push(player);
    else rows.splice(result.position - 1, 0, player);
  }
  return rows.map((row, i) => ({
    ...row,
    position: i + 1,
    points: row.player ? (result?.points ?? 0) : (SERIES_POINTS[i] ?? 0) * roundMultiplier(tour, round),
  }));
}

// Record a driven round and move on. Returns a new Tour; the old one is untouched.
export function recordRound(tour, { score, joker = false, run = null }) {
  if (tour.status !== 'active') throw new Error('The Tour is over');
  if (joker && tour.jokerRound !== null) throw new Error('The Joker has been played');
  if (joker && !jokerAllowed(tour)) throw new Error('The Joker cannot be played in this round');
  const result = roundResult(tour, tour.round, { score, joker, run });
  const results = [...tour.results, result];
  const round = tour.round + 1;
  return {
    ...tour,
    results,
    round,
    jokerRound: joker ? tour.round : tour.jokerRound,
    status: round >= tour.lineup.length ? 'complete' : 'active',
  };
}

export function useRestart(tour) {
  if (tour.restartsLeft <= 0) return tour;
  return { ...tour, restartsLeft: tour.restartsLeft - 1 };
}

// Leaving a round once the car has moved: it costs a restart, and with none left the round is
// over as a DNF. Leaving from the grid, or between rounds, costs nothing. Closing the page while
// driving counts as leaving (the store notices on the next visit).
export function leaveRound(tour) {
  if (tour.status !== 'active') return { tour, cost: 'none' };
  if (tour.restartsLeft > 0) return { tour: useRestart(tour), cost: 'restart' };
  return { tour: recordRound(tour, { score: null }), cost: 'dnf' };
}

export const retireTour = (tour) => ({ ...tour, status: 'retired' });

// The championship table after the rounds driven so far, best first. Ties go to more
// round wins, then more second places, and so on, then the higher total drift score.
export function standings(tour, rounds = tour.results.length) {
  const rows = new Map();
  const row = (id, name, player) => {
    if (!rows.has(id)) rows.set(id, { id, name, player, points: 0, total: 0, places: Array(RIVALS.length + 1).fill(0), rounds: [] });
    return rows.get(id);
  };
  row(PLAYER_ID, 'You', true);
  for (const rival of RIVALS) row(rival.id, rival.name, false);
  for (let i = 0; i < rounds; i += 1) {
    for (const entry of roundTable(tour, i)) {
      const r = row(entry.id, entry.name, entry.player);
      r.points += entry.points;
      r.total += entry.score;
      if (!entry.dnf) r.places[entry.position - 1] += 1;
      r.rounds.push({ position: entry.position, points: entry.points, score: entry.score });
    }
  }
  const order = [...rows.values()].sort((a, b) => b.points - a.points || comparePlaces(a, b) || b.total - a.total || (a.player ? -1 : b.player ? 1 : 0));
  return order.map((r, i) => ({ ...r, position: i + 1 }));
}

function comparePlaces(a, b) {
  for (let i = 0; i < a.places.length; i += 1) if (a.places[i] !== b.places[i]) return b.places[i] - a.places[i];
  return 0;
}

// What this round can do to the championship. Every rival's score for the round is
// posted before the player drives, so the table after it depends only on where the player
// finishes: places[p - 1] is the player's championship place if they finish the round in P(p)
// (null when no score can give that round place, as when two posted scores tie). From it:
//   champion  the worst round place that still makes the player champion (final round only)
//   lead      the worst round place that puts the player top of the table (any other round)
//   podium    the worst round place that keeps a championship podium in reach at the end
export function roundStakes(tour, { joker = false } = {}) {
  if (tour.status !== 'active') return null;
  joker = joker && jokerAllowed(tour);
  const i = tour.round;
  const marks = tour.marks[i];
  const places = [];
  for (let p = 1; p <= RIVALS.length + 1; p += 1) {
    const score = p === 1 ? marks[0].score + 1 : p === RIVALS.length + 1 ? 0 : marks[p - 1].score + 1;
    const r = roundResult(tour, i, { score, joker });
    if (r.position !== p) { places.push(null); continue; }
    const next = recordRound(tour, { score, joker });
    places.push(standings(next).find((row) => row.player).position);
  }
  const worst = (want) => {
    let found = null;
    places.forEach((place, k) => { if (place !== null && want(place)) found = k + 1; });
    return found;
  };
  const final = i === tour.lineup.length - 1;
  return { final, places, champion: final ? worst((x) => x === 1) : null, lead: worst((x) => x === 1), podium: worst((x) => x <= 3) };
}

// The most points anyone could still add in the rounds left (a Joker not yet played counts for
// the player). Used to say whether the title is still open.
export function pointsStillAvailable(tour, forPlayer) {
  const left = tour.lineup.length - tour.results.length;
  const top = SERIES_POINTS[0];
  let most = 0;
  let jokerLeft = forPlayer && tour.jokerRound === null;
  for (let i = tour.results.length; i < tour.lineup.length; i += 1) {
    const joker = jokerLeft && roundMultiplier(tour, i) === 1;
    if (joker) jokerLeft = false;
    most += top * roundMultiplier(tour, i) * (joker ? JOKER_MULTIPLIER : 1);
  }
  return most;
}

// Can the player still finish first?
export function titleOpen(tour) {
  const table = standings(tour);
  const leader = table[0];
  const you = table.find((r) => r.player);
  return you.points + pointsStillAvailable(tour, true) >= leader.points;
}

export function tourPoints(tour) {
  return tour.results.reduce((sum, r) => sum + r.points, 0);
}

// How a finished Tour ended: { place, trophy, points, champion, sweep }. The trophy is the
// championship podium: gold, silver or bronze for P1 to P3.
export function tourOutcome(tour) {
  const points = tourPoints(tour);
  const table = standings(tour);
  const place = table.find((r) => r.player).position;
  return { place, trophy: ['gold', 'silver', 'bronze'][place - 1] ?? null, points, champion: place === 1,
    sweep: tour.results.length === tour.lineup.length && tour.results.every((r) => r.position === 1) };
}

// Is this a Tour this version can carry on with? A saved Tour from other rules, or one that has
// been damaged, is never resumed (the store keeps it out of play rather than guess).
export function isTour(t) {
  const object = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
  if (!object(t) || t.rules !== TOUR_RULES_ID) return false;
  if (!known(TOUR_LENGTHS, t.length) || !known(TOUR_FIELDS, t.field)) return false;
  if (!['classic', 'revised'].includes(t.handling) || !Number.isSafeInteger(t.seed)) return false;
  if (!Array.isArray(t.lineup) || t.lineup.length !== TOUR_LENGTHS[t.length].rounds) return false;
  if (!t.lineup.every((id) => TRACK_IDS.includes(id)) || new Set(t.lineup).size !== t.lineup.length) return false;
  if (!Array.isArray(t.marks) || t.marks.length !== t.lineup.length) return false;
  const marksOk = t.marks.every((round) => Array.isArray(round) && round.length > 0
    && round.every((m) => object(m) && typeof m.id === 'string' && typeof m.name === 'string' && Number.isSafeInteger(m.score) && m.score >= 0));
  if (!marksOk) return false;
  if (!Number.isSafeInteger(t.round) || t.round < 0 || t.round > t.lineup.length) return false;
  if (!Array.isArray(t.results) || t.results.length !== t.round) return false;
  if (!t.results.every((r, i) => object(r) && r.trackId === t.lineup[i] && Number.isSafeInteger(r.score) && r.score >= 0 && Number.isFinite(r.points))) return false;
  if (!Number.isSafeInteger(t.restartsLeft) || t.restartsLeft < 0 || t.restartsLeft > TOUR_LENGTHS[t.length].restarts) return false;
  if (t.jokerRound !== null && !(Number.isSafeInteger(t.jokerRound) && t.jokerRound < t.round)) return false;
  if (typeof t.finalDouble !== 'boolean') return false;
  return ['active', 'complete', 'retired'].includes(t.status);
}
