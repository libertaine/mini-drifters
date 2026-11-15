// The challenge list v0.4.0 (e4481a4) shipped: Precision 180, Linked Drift and One Drift, with
// no Slalom Sprint. Those three challenge objects are unchanged since (gymkhana.test.mjs pins
// their layouts and rules ids), so gymkhana-records-e4481a4.mjs, v0.4.0's own record keeper,
// sees exactly the list it saw in v0.4.0.
import { PRECISION_180, LINKED_DRIFT, ONE_DRIFT } from '../../src/gymkhana.js';

export const GYMKHANA_CHALLENGES = Object.freeze([PRECISION_180, LINKED_DRIFT, ONE_DRIFT]);
export const GYMKHANA_CHALLENGE_IDS = Object.freeze(GYMKHANA_CHALLENGES.map((c) => c.id));

export function challengeById(id) {
  return GYMKHANA_CHALLENGES.find((c) => c.id === id) ?? null;
}
