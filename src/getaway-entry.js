// EXPERIMENTAL research switch (v0.7.0 R4 and R4B) for Getaway Drift. MUST NOT SHIP.
//
// This is a development switch of exactly the kind test/gymkhana.test.mjs forbids in the shipped
// gymkhana files ("no development switch ships"). It lives in this file of its own so that the
// research build's page is unchanged without it, and so that a production integration has one
// obvious file to delete. R4B is never merged, so nothing here reaches a player.
//
// With ?getaway in the address, the Gymkhana sheet offers two experimental entries after the
// four challenges: Getaway · Downtown and Getaway · Industrial (R4B). Options:
//   &pursuit=network|intercept|trail   how the police car finds its way (getaway-urban.js). The
//                                      default is street routing; the R4B matrix found interception
//                                      added nothing measurable, so the simpler one is played
//   &tier=standard|r4                  the police car's numbers: R4B's, or R4's own
//   &miss=recover|strict               what crossing a later camera first does
//   &time=<seconds>                    the time limit (60 to 300)
// R4's own two layouts (Route and Open) stay in the R4 worktree, unchanged, for comparison.
// Without ?getaway it returns nothing, and the sheet is exactly the four challenges.
import { createUrbanChallenge, PURSUIT_MODES, URBAN_TIERS } from './getaway-urban.js';

export const URBAN_DEFAULT_TIME = 120;

export function getawayExtras(search = globalThis.location?.search ?? '') {
  const params = new URLSearchParams(search);
  if (!params.has('getaway')) return [];
  const choose = (name, allowed, fallback) => (allowed.includes(params.get(name)) ? params.get(name) : fallback);
  const time = Number(params.get('time'));
  const options = {
    pursuit: choose('pursuit', PURSUIT_MODES, 'network'),
    tier: choose('tier', Object.keys(URBAN_TIERS), 'standard'),
    missPolicy: choose('miss', ['recover', 'strict'], 'recover'),
    timeLimit: Number.isFinite(time) && time >= 60 && time <= 300 ? Math.round(time) : URBAN_DEFAULT_TIME,
  };
  return [createUrbanChallenge({ ...options, variant: 'downtown' }), createUrbanChallenge({ ...options, variant: 'industrial' })];
}
