import { createUrbanChallenge } from './getaway-urban.js';

export const GETAWAY_MISSIONS = Object.freeze([Object.freeze({
  id: 'get-the-footage',
  title: 'Get the Footage',
  description: 'Hit every camera. Put on a show. Lose the cops.',
  environments: Object.freeze(['downtown', 'industrial'].map((variant) => createUrbanChallenge({ variant }))),
})]);
