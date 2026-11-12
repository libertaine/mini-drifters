// The player's last chosen handling mode, so a returning player starts where they left off.
// Like the sound settings it is a small value under a key of its own, separate from the
// records. Only a public mode's stable id is ever saved or restored: anything else, such as
// a retired mode, a typo or a hostile value, reads as Classic. A storage failure costs only the
// memory of the choice, never the game.
import { DEFAULT_HANDLING_ID, handlingById } from './handling.js';

export const HANDLING_PREFERENCE_KEY = 'mini-drifters-handling';

export function readHandlingPreference(storage) {
  let saved = null;
  try { saved = storage?.getItem(HANDLING_PREFERENCE_KEY) ?? null; } catch { /* the default */ }
  return typeof saved === 'string' && handlingById(saved) ? saved : DEFAULT_HANDLING_ID;
}

export function writeHandlingPreference(storage, id) {
  if (!handlingById(id)) return;
  try { storage?.setItem(HANDLING_PREFERENCE_KEY, id); } catch { /* stays for this visit */ }
}
