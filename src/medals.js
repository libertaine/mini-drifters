// Gymkhana medals: Bronze, Silver and Gold, worked out from a result and never stored.
//
// A medal is a pure function of a challenge, a handling mode and a result (seconds or points).
// The result the medals read is the personal best gymkhana-records.js already keeps, so every
// best saved since v0.4.0 earns its medal the moment this version loads, nothing is written to
// award one, and a worse run can never take one away. Nothing here reads or writes storage.
//
// Targets are filed exactly as the records are: challenge id, then the record's rules partition
// (recordRules: the challenge's rules id, plus the scoring version for a score challenge), then
// the handling mode. A record filed under rules this table does not know has no targets and so
// no medal: a change of rules or scoring starts medals afresh, just as it starts new records.
//
// Comparison is made at the precision a record is saved at: a time to the millisecond (the
// challenges round their totals to it) and a score in whole points. A time that meets a target
// exactly earns it, as does a score that equals one.
//
// Thresholds originated in the v0.7.0 R0 research (scripted drivers) and were accepted as
// final for v0.7.0 R1 after owner human playtesting. Keep all values in this one table.
import { recordRules } from './gymkhana-records.js';

export const MEDALS = Object.freeze(['gold', 'silver', 'bronze']);   // best first
export const MEDAL_NAMES = Object.freeze({ gold: 'Gold', silver: 'Silver', bronze: 'Bronze' });

// Per challenge id -> record rules -> handling id: { gold, silver, bronze }. Seconds (at most) for
// a time challenge, points (at least) for a score challenge.
//   Gold    R0 scripted top 10% (R0 report, section B2); owner-approved for v0.7.0 R1.
//   Silver  R0 scripted top 25% or median (R0 report, section B2); owner-approved for v0.7.0 R1.
//   Bronze  Time challenges: the challenge's time limit. Score challenges: 1 point (any completed
//           run that scored, since a grip-only finish scores 0); owner-approved for v0.7.0 R1.
const P180 = Object.freeze({ gold: 7.6, silver: 8.3, bronze: 30 });
const SLALOM = Object.freeze({ gold: 14.8, silver: 18.5, bronze: 40 });
export const MEDAL_TARGETS = Object.freeze({
  'precision-180': Object.freeze({ 'precision-180-1': Object.freeze({ classic: P180, revised: P180 }) }),
  'linked-drift': Object.freeze({
    'linked-drift-1+scoring-2': Object.freeze({
      classic: Object.freeze({ gold: 850, silver: 450, bronze: 1 }),
      revised: Object.freeze({ gold: 950, silver: 450, bronze: 1 }),
    }),
  }),
  'one-drift': Object.freeze({
    'one-drift-1+scoring-2': Object.freeze({
      classic: Object.freeze({ gold: 800, silver: 400, bronze: 1 }),
      revised: Object.freeze({ gold: 850, silver: 400, bronze: 1 }),
    }),
  }),
  'slalom-sprint': Object.freeze({ 'slalom-sprint-1': Object.freeze({ classic: SLALOM, revised: SLALOM }) }),
});

// A time in whole milliseconds, the precision a saved time has.
const ms = (seconds) => Math.round(seconds * 1000);
const usable = (def, v) => (def.kind === 'time' ? Number.isFinite(v) && v > 0 : Number.isFinite(v) && v >= 0);

// Does `value` meet `target`? Lower is better for time, higher for score.
export function meets(def, value, target) {
  if (!usable(def, value) || !Number.isFinite(target)) return false;
  return def.kind === 'time' ? ms(value) <= ms(target) : Math.round(value) >= Math.round(target);
}

// The targets for a challenge in a handling mode, or null when there are none.
export function medalTargets(def, handlingId) {
  return MEDAL_TARGETS[def?.id]?.[recordRules(def)]?.[handlingId] ?? null;
}

// The highest medal a result earns: 'gold' | 'silver' | 'bronze', or null. `value` null is
// "no result" (no record, or a failed run) and earns nothing.
export function medalFor(def, handlingId, value) {
  const targets = medalTargets(def, handlingId);
  if (!targets || value === null || value === undefined) return null;
  return MEDALS.find((medal) => meets(def, value, targets[medal])) ?? null;
}

// 0 for none, 3 for Gold, so medals can be compared.
export const medalRank = (medal) => (medal ? MEDALS.length - MEDALS.indexOf(medal) : 0);

// The next medal up from a result, and what it takes: { medal, target }, or null when the result
// already holds Gold or the challenge has no targets.
export function nextMedal(def, handlingId, value) {
  const targets = medalTargets(def, handlingId);
  if (!targets) return null;
  const rank = medalRank(medalFor(def, handlingId, value));
  const medal = [...MEDALS].reverse().find((m) => medalRank(m) > rank);
  return medal ? { medal, target: targets[medal] } : null;
}

// Format a time to the millisecond using the same rounding as `meets`, so timed medal targets
// and near-boundary results always match the comparison rule.
export const formatMedalTime = (seconds) => `${(ms(seconds) / 1000).toFixed(3)} s`;

// True when a timed result sits within 10 ms of any medal target (e.g. 7.599-7.609 s around
// 7.600 s Gold), where showing only hundredths could make a miss appear equal to a target.
export function needsMillisecondDisplay(def, handlingId, value) {
  if (def?.kind !== 'time' || !usable(def, value)) return false;
  const targets = medalTargets(def, handlingId);
  if (!targets) return false;
  const v = ms(value);
  return MEDALS.some((m) => Math.abs(v - ms(targets[m])) < 10);
}

// Format a Gymkhana result for comparison with medal targets: three decimal places near any
// timed target (so 7.604 s never reads as 7.60 s beside a 7.600 s target), hundredths otherwise.
export function formatMedalValue(def, handlingId, value) {
  if (value === null || value === undefined) return '--';
  if (def.kind !== 'time') return Math.round(value).toLocaleString('en-US');
  return needsMillisecondDisplay(def, handlingId, value)
    ? formatMedalTime(value)
    : `${value.toFixed(2)} s`;
}

// Millisecond margin by which a timed result missed `target` when under 10 ms, or null otherwise.
// Uses the same millisecond rounding as `meets`.
export function missedTargetBy(def, value, target) {
  if (def?.kind !== 'time' || !usable(def, value) || !Number.isFinite(target)) return null;
  const gap = ms(value) - ms(target);
  return gap > 0 && gap < 10 ? gap / 1000 : null;
}
