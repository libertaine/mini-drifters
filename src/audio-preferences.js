// The player's sound settings. Master mute keeps the key it has always had, so existing
// choices survive. A corrupt or hostile value only costs that value, never the game.
import { DEFAULT_STATION, STATIONS, stationById } from './radio-stations.js';

const SOUND_KEY = 'mini-drifters-sound';
const AUDIO_KEY = 'mini-drifters-audio';

export const DEFAULT_MUSIC_VOLUME = 70;
export const DEFAULT_EFFECTS_VOLUME = 100;

export function cleanVolume(value, fallback) {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback;
  return Math.round(Math.min(100, Math.max(0, value)));
}

export function readAudioPreferences(storage, stations = STATIONS) {
  let muted = false;
  let saved = null;
  try { muted = storage?.getItem(SOUND_KEY) === 'off'; } catch { /* defaults */ }
  try { saved = JSON.parse(storage?.getItem(AUDIO_KEY) ?? 'null'); } catch { /* defaults */ }
  return {
    muted,
    station: stationById(saved?.station, stations) ? saved.station : DEFAULT_STATION,
    musicVolume: cleanVolume(saved?.musicVolume, DEFAULT_MUSIC_VOLUME),
    effectsVolume: cleanVolume(saved?.effectsVolume, DEFAULT_EFFECTS_VOLUME),
  };
}

export function writeMuted(storage, muted) {
  try { storage?.setItem(SOUND_KEY, muted ? 'off' : 'on'); } catch { /* stays for this visit */ }
}

export function writeAudioPreferences(storage, { station, musicVolume, effectsVolume }) {
  try { storage?.setItem(AUDIO_KEY, JSON.stringify({ station, musicVolume, effectsVolume })); } catch { /* stays for this visit */ }
}

// A square law sounds closer to even steps than a straight line. 0 is silence and 100
// is unity, so effects at 100% are exactly the mix that was approved before volumes existed.
export const volumeGain = (percent) => (cleanVolume(percent, 0) / 100) ** 2;
