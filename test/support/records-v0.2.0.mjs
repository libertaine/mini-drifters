// Browser-local personal bests. Schema 1 uses stable track IDs and seconds for laps.
// Only successful writes become records: failed updates leave the saved snapshot intact.
export const RECORDS_KEY = 'mini-drifters-records';
const TRACK_IDS = ['original', 'switchback'];
const emptyTrack = () => ({ score: null, fastestLap: null, bestCombo: null });
const emptyData = () => ({ version: 1, tracks: Object.fromEntries(TRACK_IDS.map((id) => [id, emptyTrack()])) });
const flags = () => ({ score: false, fastestLap: false, bestCombo: false });
const object = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const points = (v) => Number.isSafeInteger(v) && v >= 0;
const lapTime = (v) => Number.isFinite(v) && v > 0 && v <= Number.MAX_SAFE_INTEGER;

function decode(raw) {
  const data = emptyData();
  const saved = JSON.parse(raw ?? 'null');
  if (!object(saved) || saved.version !== 1 || !object(saved.tracks)) return data;
  for (const id of TRACK_IDS) {
    const track = saved.tracks[id];
    if (!object(track)) continue;
    data.tracks[id] = {
      score: points(track.score) ? track.score : null,
      fastestLap: lapTime(track.fastestLap) ? track.fastestLap : null,
      bestCombo: points(track.bestCombo) ? track.bestCombo : null,
    };
  }
  return data;
}

export function createRecords(storageProvider = () => globalThis.localStorage) {
  let data = emptyData();
  let storage = null;
  let available = true;
  let session = null;
  let newBests = flags();
  try {
    storage = storageProvider();
    if (!storage || typeof storage.getItem !== 'function' || typeof storage.setItem !== 'function') throw new Error('No storage');
    const raw = storage.getItem(RECORDS_KEY);
    try { data = decode(raw); } catch { /* corrupt JSON starts empty, without a write */ }
  } catch { storage = null; available = false; }

  function improve(values) {
    if (!storage) return;
    // Another tab may have saved the other track since this page opened. Re-read
    // only at record boundaries so this write preserves its latest saved bests.
    let raw;
    try { raw = storage.getItem(RECORDS_KEY); }
    catch { available = false; return; }
    try { data = decode(raw); } catch { data = emptyData(); }
    const old = data.tracks[session.trackId];
    const next = { ...old };
    const improved = flags();
    for (const [key, value] of Object.entries(values)) {
      const valid = key === 'fastestLap' ? lapTime(value) : points(value);
      if (valid && (old[key] === null || (key === 'fastestLap' ? value < old[key] : value > old[key]))) {
        next[key] = value;
        improved[key] = true;
      }
    }
    if (!Object.values(improved).some(Boolean)) return;
    const candidate = { version: 1, tracks: { ...data.tracks, [session.trackId]: next } };
    try {
      storage.setItem(RECORDS_KEY, JSON.stringify(candidate));
      data = candidate;
      available = true;
      for (const key of Object.keys(improved)) newBests[key] ||= improved[key];
    } catch { available = false; }
  }

  return {
    get available() { return available; },
    get newBests() { return { ...newBests }; },
    forTrack(id) { return TRACK_IDS.includes(id) ? { ...data.tracks[id] } : emptyTrack(); },
    // Events carry copies of session results, never mutable physics/scoring state.
    handle(event) {
      if (event.type === 'start') {
        session = TRACK_IDS.includes(event.trackId) && event.mode === 'normal'
          ? { trackId: event.trackId, runId: event.runId } : null;
        newBests = flags();
        return;
      }
      if (event.type === 'abandon') { session = null; newBests = flags(); return; }
      if (!session || event.runId !== session.runId || event.trackId !== session.trackId) return;
      if (event.type === 'lap' && event.valid === true) improve({ fastestLap: event.time });
      if (event.type === 'finish') {
        if (event.completed === 3) improve({ score: event.score, bestCombo: event.bestCombo });
        session = null; // finish is settled only once
      }
    },
  };
}
