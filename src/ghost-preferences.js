// Which ghost the player chose to race: the previous lap, the saved reference, or none. A small
// value under a key of its own, like the handling preference, separate from the records and the
// saved ghosts. Anything but a known choice reads as the previous lap, which is the ghost the game
// has always shown. A storage failure costs only the memory of the choice.
import { DEFAULT_GHOST_SOURCE, GHOST_SOURCES } from './reference-ghost.js';

export const GHOST_PREFERENCE_KEY = 'mini-drifters-ghost-mode';

export function readGhostPreference(storage) {
  let saved = null;
  try { saved = storage?.getItem(GHOST_PREFERENCE_KEY) ?? null; } catch { /* the default */ }
  return GHOST_SOURCES.includes(saved) ? saved : DEFAULT_GHOST_SOURCE;
}

export function writeGhostPreference(storage, source) {
  if (!GHOST_SOURCES.includes(source)) return;
  try { storage?.setItem(GHOST_PREFERENCE_KEY, source); } catch { /* stays for this visit */ }
}
