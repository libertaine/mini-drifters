import { createUrbanChallenge } from './getaway-urban.js';
import { GETAWAY_DRIVER } from './getaway-driver.js';

// The Getaway missions that keep Showmanship personal bests and medals (getaway-records.js).
export const GETAWAY_MISSIONS = Object.freeze([Object.freeze({
  id: 'get-the-footage',
  title: 'Get the Footage',
  description: 'Hit every camera. Put on a show. Lose the cops.',
  environments: Object.freeze(['downtown', 'industrial'].map((variant) => createUrbanChallenge({ variant }))),
})]);

// Every mission the Getaway sheet offers, in order. Getaway Driver has no score, medal or record, so
// it is here and not in GETAWAY_MISSIONS: its completion counts are kept by getaway-driver-records.js.
export const GETAWAY_SHEET = Object.freeze([...GETAWAY_MISSIONS, GETAWAY_DRIVER]);
