// The one switch for Getaway Driver (EXPERIMENTAL, v0.8.0 R0 research): the mission is offered on the
// Getaway sheet only when the page is opened with ?driver. Without it the sheet lists exactly the
// shipped missions. This file is research-only and must not ship.
import { GETAWAY_DRIVER } from './getaway-driver.js';

const enabled = (() => {
  try { return new URLSearchParams(globalThis.location?.search ?? '').has('driver'); } catch { return false; }
})();

export const RESEARCH_MISSIONS = Object.freeze(enabled ? [GETAWAY_DRIVER] : []);
