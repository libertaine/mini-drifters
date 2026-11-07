// The radio's playback: at most one track audible on one output, chosen from the station
// list. It owns no AudioContext and no volume: GameAudio hands it a context and the music
// bus. A failure in here only ever costs the music, so nothing throws out of it.
//
// Tracks are decoded whole, like every other sound in the game. While the context is
// suspended their position simply stops, so hidden tabs can't leave anything playing.
import { RADIO_OFF, STATIONS, stationById } from './radio-stations.js';

export const FADE_OUT = 0.35;
export const FADE_IN = 0.6;
export const MUSIC_FADE_MS = FADE_OUT * 1000;
// The music bus's level at 100%, set so the radio can't bury the engine, which tells the
// driver what the car is doing. Measured on the built-in loops: about level with the engine
// at 100%, and 4 to 5 dB under it at the default 70%. That is a measurement, not a listening
// result, and replacement music may need this revisited.
export const MUSIC_LEVEL = 0.2;
const END_FADE = 0.03;
const LOAD_DEADLINE_MS = 30000;
const BUFFERS_KEPT = 2;
const RADIO_ROOT = '../';

export async function loadTrack(ctx, track, signal, fetcher = fetch) {
  const response = await fetcher(new URL(RADIO_ROOT + track.file, import.meta.url), { signal });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return ctx.decodeAudioData(await response.arrayBuffer());
}

export class RadioPlayer {
  constructor(ctx, output, { stations = STATIONS, loader = loadTrack, onChange = () => {} } = {}) {
    this.ctx = ctx;
    this.output = output;
    this.stations = stations;
    this.loader = loader;
    this.onChange = onChange;
    this.stationId = RADIO_OFF;
    this.status = 'off';      // off, loading, playing or unavailable
    this.voice = null;        // the one track that is playing or about to
    this.fading = new Set();  // tracks on their way out
    this.clearAt = 0;         // context time when the last fade finishes
    this.token = 0;           // invalidates a load that the player has moved on from
    this.loading = null;
    this.buffers = new Map();
    this.cursor = new Map();  // each station's next track
    this.failures = [];
    this.starts = 0;
    this.disposed = false;
  }

  // Tuning to the current station does nothing, which is what keeps menu and game
  // transitions from restarting the track. `retry` is for a player selecting a station
  // that failed. `immediate` skips the fade: the output is already silent.
  tune(id, { immediate = false, retry = false } = {}) {
    if (this.disposed || (id === this.stationId && !(retry && this.status === 'unavailable'))) return;
    this.stationId = id;
    this.token += 1;
    this.failures = [];
    this.cancelLoad();
    try {
      this.release(immediate);
    } catch (error) {
      this.failures.push(error.message);
    }
    const station = stationById(id, this.stations);
    if (station?.tracks.length) {
      this.play(station, station.tracks.length);
    } else {
      this.status = id === RADIO_OFF ? 'off' : 'unavailable';
      this.onChange();
    }
  }

  dispose() {
    this.disposed = true;
    this.token += 1;
    this.cancelLoad();
    this.release(true);
    this.buffers.clear();
  }

  snapshot() {
    const track = this.voice?.track ?? null;
    return {
      station: this.stationId,
      status: this.status,
      track: track?.id ?? null,
      title: track?.title ?? null,
      starts: this.starts,
      active: (this.voice ? 1 : 0) + this.fading.size,
      failures: [...this.failures],
    };
  }

  // --- Internals ----------------------------------------------------------

  play(station, attempts) {
    const token = this.token;
    const index = this.cursor.get(station.id) ?? 0;
    const track = station.tracks[index % station.tracks.length];
    this.cursor.set(station.id, (index + 1) % station.tracks.length);
    this.status = 'loading';
    this.onChange();
    this.fetchTrack(track).then((buffer) => {
      if (token !== this.token) return;
      this.startVoice(station, track, buffer);
    }).catch((error) => {
      if (token !== this.token) return;
      this.failures.push(`${track.file}: ${error.message}`);
      if (attempts > 1) {
        this.play(station, attempts - 1);
      } else {
        this.status = 'unavailable';
        this.onChange();
      }
    });
  }

  async fetchTrack(track) {
    const cached = this.buffers.get(track.file);
    if (cached) {
      this.buffers.delete(track.file);
      this.buffers.set(track.file, cached); // the most recently used stays longest
      return cached;
    }
    const controller = new AbortController();
    this.loading = controller;
    const deadline = setTimeout(() => controller.abort(), LOAD_DEADLINE_MS);
    try {
      const buffer = await this.loader(this.ctx, track, controller.signal);
      this.buffers.set(track.file, buffer);
      while (this.buffers.size > BUFFERS_KEPT) this.buffers.delete(this.buffers.keys().next().value);
      return buffer;
    } finally {
      clearTimeout(deadline);
      if (this.loading === controller) this.loading = null;
    }
  }

  cancelLoad() {
    this.loading?.abort();
    this.loading = null;
  }

  // Starts only once the previous track has finished fading, so two never overlap.
  startVoice(station, track, buffer) {
    const { ctx } = this;
    const startAt = Math.max(ctx.currentTime, this.clearAt);
    const source = ctx.createBufferSource();
    const gain = ctx.createGain();
    const voice = { source, gain, track, startAt, dropped: false };
    try {
      source.buffer = buffer;
      source.loop = station.tracks.length === 1;
      source.connect(gain).connect(this.output);
      gain.gain.setValueAtTime(0, startAt);
      gain.gain.linearRampToValueAtTime(1, startAt + FADE_IN);
      if (!source.loop && buffer.duration > FADE_IN + END_FADE) {
        const endAt = startAt + buffer.duration;
        gain.gain.setValueAtTime(1, endAt - END_FADE);
        gain.gain.linearRampToValueAtTime(0, endAt);
      }
      source.onended = () => this.ended(voice, station);
      source.start(startAt);
    } catch (error) {
      this.drop(voice);
      throw error;
    }
    this.voice = voice;
    this.starts += 1;
    this.status = 'playing';
    this.onChange();
  }

  ended(voice, station) {
    this.fading.delete(voice);
    this.drop(voice);
    if (voice !== this.voice) return;
    // A track finished by itself, so the station moves on.
    this.voice = null;
    this.token += 1;
    this.play(station, station.tracks.length);
  }

  // The level is worked out rather than read back: Firefox doesn't report a parameter's
  // value partway through a ramp, and a wrong starting point here would be an audible click.
  release(immediate) {
    const voice = this.voice;
    this.voice = null;
    if (immediate) {
      if (voice) this.drop(voice);
      for (const fading of this.fading) this.drop(fading);
      this.fading.clear();
      this.clearAt = 0;
      return;
    }
    if (!voice) return;
    const now = this.ctx.currentTime;
    if (now <= voice.startAt) {
      this.drop(voice); // waiting for an earlier fade, and never heard
      return;
    }
    const level = Math.min(1, (now - voice.startAt) / FADE_IN);
    const param = voice.gain.gain;
    param.cancelScheduledValues(now);
    param.setValueAtTime(level, now);
    param.linearRampToValueAtTime(0, now + FADE_OUT);
    voice.source.stop(now + FADE_OUT);
    this.fading.add(voice);
    this.clearAt = now + FADE_OUT;
  }

  drop(voice) {
    if (voice.dropped) return;
    voice.dropped = true;
    voice.source.onended = null;
    try { voice.source.stop(); } catch { /* never started, or already stopped */ }
    voice.source.disconnect();
    voice.gain.disconnect();
  }
}
