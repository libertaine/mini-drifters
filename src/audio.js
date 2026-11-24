// The game's sound: one AudioContext, one engine voice and one tire voice, driven
// by the car's telemetry, plus the radio on its own bus. It only reads the game. A
// failure in here must never reach the game loop, so every entry point is guarded.
//
//   engine, tires -> compressor -> master -> gate -> effects volume -> output
//   radio tracks  -> music volume -> music gate ------------------------^
//
// Mute, pause and focus close the gates. The player's two volumes are the only other
// controls on those paths, and neither one touches the other's.
import { createCoyote, loadCoyote } from './coyote.js';
import { mapCoyote } from './coyote-model.js';
import { createMixCompressor, createProcedural, createTireVoice, loadBustedVoice, loadTire, mapProceduralEngine, smooth } from './audio-voices.js';
import { AUDIO_TUNING, createAudioState, engineParams, readTelemetry, resetAudioState, stepAudioState, tireParams } from './audio-telemetry.js';
import { cleanVolume, readAudioPreferences, volumeGain, writeAudioPreferences, writeMuted } from './audio-preferences.js';
import { MUSIC_FADE_MS, MUSIC_LEVEL, RadioPlayer, loadTrack } from './radio.js';
import { RADIO_OFF, STATIONS, stationById } from './radio-stations.js';
import { SMASH_SFX, FX_LIMITS, playSmash, playImpact, playCone, playCue, playBustedVoice, sirenTarget, createSirenVoice } from './getaway-sfx.js';

const RESUME_DEADLINE_MS = 8000;
const LOAD_DEADLINE_MS = 12000;
const RESUME_RETRY_MS = 1000;
const SILENCE_TIME = 0.012;    // pause, mute, focus loss: gone at once, without a click
const SILENCE_SUSPEND_MS = 80;
const FINISH_FADE_TIME = 0.45;
const FINISH_SUSPEND_MS = 2400;
const RESTART_GAP = 0.35;      // long enough for the old engine note to fall to idle unheard
const APPLY_INTERVAL = 1 / 30; // the voices glide between updates, so 30 Hz is plenty
const VOLUME_GLIDE = 0.03;     // quick enough to follow a slider, slow enough not to click

const liveState = (game) => (game.state === 'ready' || game.state === 'racing') && !game.paused;

function browserStorage() {
  try { return window.localStorage; } catch { return null; }
}

export class GameAudio {
  constructor({
    contextFactory = () => new AudioContext(),
    coyoteEnabled = false,
    coyoteLoader = loadCoyote,
    tireLoader = loadTire,
    bustedLoader = loadBustedVoice,
    trackLoader = loadTrack,
    stations = STATIONS,
    storage = browserStorage(),
    isHidden = () => false,
    onChange = () => {},
    tuning = AUDIO_TUNING,
  } = {}) {
    this.contextFactory = contextFactory;
    this.coyoteEnabled = coyoteEnabled;
    this.coyoteLoader = coyoteLoader;
    this.tireLoader = tireLoader;
    this.bustedLoader = bustedLoader;
    this.trackLoader = trackLoader;
    this.stations = stations;
    this.storage = storage;
    this.isHidden = isHidden;
    this.onChange = onChange;
    this.tuning = tuning;
    const preferences = readAudioPreferences(storage, stations);
    this.muted = preferences.muted;
    this.station = preferences.station;
    this.musicVolume = preferences.musicVolume;
    this.effectsVolume = preferences.effectsVolume;
    this.pageActive = true;
    this.mode = 'silent';
    this.session = null;
    this.failure = null;
    this.contextsCreated = 0;
    this.audioState = createAudioState(tuning);
    this.sinceApply = Infinity;
    this.applied = null;
    this.lastGame = null;
    this.smashes = { played: 0, dropped: 0, silent: 0 };
    this.fx = {
      impacts: 0, cones: 0, cues: 0, sirenActive: false, sirenDucked: false,
      bustedPlayed: 0, bustedSpoken: 0, bustedFallback: 0, bustedState: 'idle',
    };
  }

  // Getaway Drift (experimental, R4C): one short synthesized smash for a broken fruit stand or
  // barricade (getaway-sfx.js). It goes into the master bus, so the gate (mute, pause, focus, the
  // finish fade, a restart's dip) and the effects volume apply to it as to the engine. Only while
  // live; at most SMASH_SFX.maxVoices sound at once, and another is dropped, never queued.
  smash(kind) {
    this.guard(() => {
      const s = this.session;
      if (!s || this.mode !== 'live' || s.ctx.state !== 'running' || this.effectsVolume === 0 || !SMASH_SFX[kind]) { this.smashes.silent += 1; return; }
      const now = s.ctx.currentTime;
      s.smashVoices = (s.smashVoices ?? []).filter((v) => v.end > now);
      if (s.smashVoices.length >= SMASH_SFX.maxVoices) { this.smashes.dropped += 1; return; }
      s.smashVoices.push(playSmash(s.ctx, s.master, kind));
      this.smashes.played += 1;
    });
  }

  // Velocity-scaled solid collision thump (all modes). Capped and cancelled like smashes.
  impact(intensity, kind = 'wall') {
    this.guard(() => {
      const s = this.session;
      if (!s || this.mode !== 'live' || s.ctx.state !== 'running' || this.effectsVolume === 0) return;
      const now = s.ctx.currentTime;
      s.impactVoices = (s.impactVoices ?? []).filter((v) => v.end > now);
      if (s.impactVoices.length >= FX_LIMITS.impactMaxVoices) return;
      const voice = playImpact(s.ctx, s.master, intensity, kind);
      if (voice) { s.impactVoices.push(voice); this.fx.impacts += 1; }
    });
  }

  // Gymkhana / Practice Pad rubber cone bump.
  cone() {
    this.guard(() => {
      const s = this.session;
      if (!s || this.mode !== 'live' || s.ctx.state !== 'running' || this.effectsVolume === 0) return;
      const now = s.ctx.currentTime;
      s.impactVoices = (s.impactVoices ?? []).filter((v) => v.end > now);
      if (s.impactVoices.length >= FX_LIMITS.impactMaxVoices) return;
      const voice = playCone(s.ctx, s.master);
      if (voice) { s.impactVoices.push(voice); this.fx.cones += 1; }
    });
  }

  // Pursuit, stealth, camera shutter, bank & mission outcome stingers.
  // Outcome stingers play over the finish fade directly through the effects volume bus,
  // still obeying mute, focus loss and immediate cancellation on restart or disposal.
  cue(kind, detail = 0) {
    this.guard(() => {
      const s = this.session;
      const outcome = kind.startsWith('outcome-');
      if (!s || s.ctx.state !== 'running' || this.effectsVolume === 0) return;
      if (outcome) {
        if (!this.audible() || (this.mode !== 'live' && this.mode !== 'fade')) return;
        this.stopOutcomeCues(s);
        let voice;
        if (kind === 'outcome-busted') {
          if (s.siren && !s.sirenDuckUntil) {
            s.siren.duck(0.22, 0.95);
            s.sirenDuckUntil = s.ctx.currentTime + 1.0;
            this.fx.sirenDucked = true;
            this.fx.sirenActive = false;
          }
          voice = playBustedVoice(s.ctx, s.effects, s.bustedBuffer);
          if (voice) {
            this.fx.bustedPlayed += 1;
            if (voice.spoken) this.fx.bustedSpoken += 1;
            else this.fx.bustedFallback += 1;
          }
        } else {
          voice = playCue(s.ctx, s.effects, kind, detail);
        }
        if (voice) { s.outcomeVoices = [voice]; this.fx.cues += 1; }
        return;
      }
      if (this.mode !== 'live') return;
      const now = s.ctx.currentTime;
      s.cueVoices = (s.cueVoices ?? []).filter((v) => v.end > now);
      if (s.cueVoices.length >= FX_LIMITS.cueMaxVoices) return;
      const voice = playCue(s.ctx, s.master, kind, detail);
      if (voice) { s.cueVoices.push(voice); this.fx.cues += 1; }
    });
  }

  stopSiren(s = this.session) {
    if (s?.siren) {
      s.siren.stop();
      s.siren = null;
    }
    if (s) s.sirenDuckUntil = 0;
    this.fx.sirenActive = false;
    this.fx.sirenDucked = false;
  }

  stopOutcomeCues(s = this.session) {
    for (const voice of s?.outcomeVoices ?? []) voice.stop();
    if (s) s.outcomeVoices = [];
  }

  stopSmashes(s = this.session, { keepSiren = false } = {}) {
    for (const voice of s?.smashVoices ?? []) voice.stop();
    for (const voice of s?.impactVoices ?? []) voice.stop();
    for (const voice of s?.cueVoices ?? []) voice.stop();
    if (s) {
      s.smashVoices = [];
      s.impactVoices = [];
      s.cueVoices = [];
    }
    if (!keepSiren) this.stopSiren(s);
  }

  // --- What the game calls --------------------------------------------------

  // From a user gesture: the only place an AudioContext may be created or woken.
  gesture(game) {
    this.guard(() => {
      this.pageActive = !this.isHidden();
      if (!this.muted && (liveState(game) || this.station !== RADIO_OFF)) this.ensureSession();
      if (this.session) this.session.nextResumeAt = 0;
      this.sync(game);
    });
  }

  // Any key or click once the browser counts the page as interacted with. It only matters
  // to a saved station, which waits for this. After a failure, only a deliberate action
  // tries again, so that driving keys can't keep rebuilding the audio.
  interaction(game) {
    this.guard(() => {
      if (this.station === RADIO_OFF || this.muted || this.failure) return;
      const s = this.session;
      if (!s || s.ctx.state !== 'running') this.gesture(game);
    });
  }

  // A new run, from Enter, the Start button or R. Also a user gesture.
  newRun(game) {
    this.guard(() => {
      this.lastGame = game;
      this.stopSmashes();
      this.stopOutcomeCues();
      resetAudioState(this.audioState, this.tuning);
      this.applied = null;
      this.sinceApply = Infinity;
      const continuing = this.session?.started;
      this.gesture(game);
      if (this.session?.started) this.ensureBustedVoice(this.session, game);
      if (continuing && this.mode === 'live') this.dipGate();
    });
  }

  setMuted(muted, game) {
    this.guard(() => {
      this.muted = !!muted;
      writeMuted(this.storage, this.muted);
      this.failure = null;
    });
    this.gesture(game);
    this.notify();
  }

  setStation(id, game) {
    if (!stationById(id, this.stations)) return;
    this.guard(() => {
      this.station = id;
      this.savePreferences();
      // Selecting a station that failed is the player asking to try it again.
      this.session?.radio.tune(id, { immediate: !this.audible(), retry: true });
    });
    this.gesture(game);
    this.notify();
  }

  nextStation(game) {
    const at = this.stations.findIndex((station) => station.id === this.station);
    this.setStation(this.stations[(at + 1) % this.stations.length].id, game);
  }

  setMusicVolume(percent) {
    this.guard(() => {
      this.musicVolume = cleanVolume(percent, this.musicVolume);
      this.savePreferences();
      const s = this.session;
      if (s) smooth(s.musicBus.gain, this.musicGain(), s.ctx, VOLUME_GLIDE);
    });
    this.notify();
  }

  setEffectsVolume(percent) {
    this.guard(() => {
      this.effectsVolume = cleanVolume(percent, this.effectsVolume);
      this.savePreferences();
      const s = this.session;
      if (s) {
        smooth(s.effects.gain, volumeGain(this.effectsVolume), s.ctx, VOLUME_GLIDE);
        if (this.effectsVolume === 0) { this.stopSiren(s); this.stopOutcomeCues(s); }
      }
    });
    this.notify();
  }

  // Focus and visibility. Never resumes the engine by itself: the game stays paused
  // when focus returns, and its sound follows the game. The radio isn't part of the
  // race, so it comes back with the page.
  setPageActive(active, game) {
    this.guard(() => {
      this.pageActive = active && !this.isHidden();
      this.sync(game);
    });
  }

  // Once per rendered frame, after the simulation has advanced.
  update(game, dt) {
    this.guard(() => {
      this.lastGame = game;
      if (game.state === 'menu') {
        if (this.session) this.sync(game);
        return;
      }
      const running = liveState(game);
      if (running || game.state === 'finished') {
        stepAudioState(this.audioState, readTelemetry(game.car), dt, running, this.tuning);
      }
      this.sync(game);
      if (this.session?.started) this.ensureBustedVoice(this.session, game);
      this.updateSiren(game, dt);
      this.sinceApply += dt;
      if (this.session && this.mode !== 'silent' && this.sinceApply >= APPLY_INTERVAL) {
        this.sinceApply = 0;
        this.applyParams(this.session);
      }
    });
  }

  updateSiren(game, dt) {
    const s = this.session;
    if (!s || s.ctx.state !== 'running' || this.effectsVolume === 0 || this.mode === 'silent') {
      this.stopSiren(s);
      return;
    }
    if (this.mode === 'fade') {
      const busted = game.challenge?.phase === 'failed' && game.challenge?.reason === 'busted';
      if (busted && s.siren) {
        if (!s.sirenDuckUntil) {
          s.siren.duck(0.22, 0.95);
          s.sirenDuckUntil = s.ctx.currentTime + 1.0;
        }
        if (s.ctx.currentTime < s.sirenDuckUntil) {
          this.fx.sirenActive = false;
          this.fx.sirenDucked = true;
          return;
        }
      }
      this.stopSiren(s);
      return;
    }
    if (this.mode !== 'live') {
      this.stopSiren(s);
      return;
    }
    const target = sirenTarget(game);
    if (!target.active) {
      this.stopSiren(s);
      return;
    }
    if (!s.siren) s.siren = createSirenVoice(s.ctx, s.master);
    s.sirenDuckUntil = 0;
    s.siren.update({ ...target, dt });
    this.fx.sirenActive = true;
    this.fx.sirenDucked = false;
  }

  dispose() {
    this.guard(() => {
      if (this.session) this.teardown(this.session);
      this.mode = 'silent';
    });
  }

  label() {
    if (this.muted) return 'Sound Off';
    return this.failure ? 'Sound Unavailable' : 'Sound On';
  }

  snapshot() {
    const s = this.session;
    return {
      muted: this.muted,
      mode: this.mode,
      label: this.label(),
      failure: this.failure,
      engine: s?.engineKind ?? 'none',
      engineFailures: [...(s?.engineFailures ?? [])],
      tire: s?.tireState ?? 'none',
      tireFailures: [...(s?.tireFailures ?? [])],
      contextState: s?.ctx.state ?? 'closed',
      contextsCreated: this.contextsCreated,
      sourceCount: (s?.engine?.sourceCount ?? 0) + (s?.tire?.sourceCount ?? 0),
      rpm: this.audioState.rpm,
      load: this.audioState.load,
      gear: this.audioState.gear,
      shifts: this.audioState.shifts,
      wheelspin: this.audioState.spin,
      tireIntensity: this.audioState.tire,
      station: this.station,
      stationName: stationById(this.station, this.stations)?.name ?? '',
      musicVolume: this.musicVolume,
      effectsVolume: this.effectsVolume,
      radio: s?.radio.snapshot() ?? { station: this.station, status: this.station === RADIO_OFF ? 'off' : 'waiting', track: null, title: null, starts: 0, active: 0, failures: [] },
    };
  }

  // --- Internals ------------------------------------------------------------

  audible() {
    return !this.muted && this.pageActive && !this.isHidden();
  }

  musicWanted() {
    return this.station !== RADIO_OFF && this.audible();
  }

  musicGain() {
    return MUSIC_LEVEL * volumeGain(this.musicVolume);
  }

  savePreferences() {
    writeAudioPreferences(this.storage, { station: this.station, musicVolume: this.musicVolume, effectsVolume: this.effectsVolume });
  }

  guard(action) {
    try {
      action();
    } catch (error) {
      this.fail(this.session, error.message);
    }
  }

  notify() {
    try { this.onChange(this.snapshot()); } catch { /* the display is not worth a crash */ }
  }

  fail(session, message) {
    try {
      if (session && this.session === session) this.teardown(session);
    } catch { /* already falling back to silence */ }
    this.failure = message || 'Audio stopped';
    this.mode = 'silent';
    this.notify();
  }

  modeFor(game) {
    if (this.muted || !this.pageActive || this.isHidden()) return 'silent';
    if (liveState(game)) return 'live';
    return game.state === 'finished' ? 'fade' : 'silent';
  }

  ensureSession() {
    if (this.session) return;
    this.failure = null;
    const ctx = this.contextFactory();
    this.contextsCreated += 1;
    const nodes = [];
    const gain = (value) => {
      const n = ctx.createGain(); n.gain.value = value; nodes.push(n); return n;
    };
    const s = {
      ctx, nodes, abort: new AbortController(), started: false, resuming: false, nextResumeAt: 0,
      engine: null, engineKind: 'none', engineFailures: [], tire: null, tireState: 'waiting', tireFailures: [],
      bustedBuffer: null, bustedState: 'idle', bustedFailures: [], sirenDuckUntil: 0,
      timers: new Set(),
    };
    this.session = s;
    s.gate = gain(0);
    s.master = gain(this.tuning.masterLevel);
    s.engineBus = gain(this.tuning.engineLevel);
    s.tireBus = gain(this.tuning.tireLevel);
    s.effects = gain(volumeGain(this.effectsVolume));
    const compressor = createMixCompressor(ctx); nodes.push(compressor);
    s.engineBus.connect(compressor); s.tireBus.connect(compressor);
    compressor.connect(s.master).connect(s.gate).connect(s.effects).connect(ctx.destination);
    s.musicBus = gain(this.musicGain());
    s.musicGate = gain(0);
    s.gateOpen = false;
    s.musicOn = false;
    s.musicBus.connect(s.musicGate).connect(ctx.destination);
    s.radio = new RadioPlayer(ctx, s.musicBus, { stations: this.stations, loader: this.trackLoader, onChange: () => this.notify() });
    ctx.onstatechange = () => this.guard(() => {
      if (this.session === s && ctx.state === 'closed') this.fail(s, 'Audio stopped');
    });
    this.mode = 'silent'; // sync() now applies the real mode to the new gate
  }

  sync(game) {
    const next = this.modeFor(game);
    const changed = next !== this.mode;
    this.mode = next;
    const s = this.session;
    if (!s) return;
    if (changed && next !== 'live') {
      const bustedFade = next === 'fade' && game?.challenge?.phase === 'failed' && game?.challenge?.reason === 'busted';
      this.stopSmashes(s, { keepSiren: bustedFade });
      if (next === 'silent') this.stopOutcomeCues(s);
    }
    if (next === 'live' || this.musicWanted()) {
      this.clearSuspend(s);
      // A context made inside a gesture may already be running, so the first
      // resume still has to happen: it is what starts the loading.
      if (!s.started || s.ctx.state !== 'running') this.resume(s);
    }
    if (next === 'live') {
      if (changed) smooth(s.gate.gain, 1, s.ctx, 0.03);
    } else if (changed) {
      if (next === 'silent') {
        smooth(s.gate.gain, 0, s.ctx, SILENCE_TIME);
        this.scheduleSuspend(s, SILENCE_SUSPEND_MS);
      } else if (s.ctx.state === 'running') {
        smooth(s.gate.gain, 0, s.ctx, FINISH_FADE_TIME);
        this.scheduleSuspend(s, FINISH_SUSPEND_MS);
      }
    }
    this.syncMusic(s, next);
    if (changed) this.notify();
  }

  // The radio follows the page and the mute button, not the race.
  syncMusic(s, next) {
    const audible = this.audible();
    if (audible !== s.gateOpen) {
      s.gateOpen = audible;
      smooth(s.musicGate.gain, audible ? 1 : 0, s.ctx, audible ? VOLUME_GLIDE : SILENCE_TIME);
    }
    s.radio.tune(this.station, { immediate: !audible });
    const wanted = this.musicWanted();
    if (s.musicOn && !wanted && next !== 'live') {
      // Nothing is left to keep the context awake. Radio Off still has its fade to finish.
      this.scheduleSuspend(s, next === 'fade' ? FINISH_SUSPEND_MS : audible ? MUSIC_FADE_MS + SILENCE_SUSPEND_MS : SILENCE_SUSPEND_MS);
    }
    s.musicOn = wanted;
  }

  // Silence the old run quickly, let the voices fall to idle, then come back.
  dipGate() {
    const s = this.session;
    const { gain } = s.gate;
    smooth(gain, 0, s.ctx, SILENCE_TIME);
    gain.setTargetAtTime(1, s.ctx.currentTime + RESTART_GAP, 0.05);
  }

  resume(s) {
    const now = performance.now();
    if (s.resuming || now < s.nextResumeAt) return;
    s.resuming = true;
    let timer;
    const deadline = new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error('Audio output did not start')), RESUME_DEADLINE_MS);
      s.timers.add(timer);
    });
    // resume() runs synchronously inside the gesture that brought us here.
    Promise.race([s.ctx.resume(), deadline]).then(() => {
      clearTimeout(timer); s.timers.delete(timer);
      if (this.session !== s) return;
      s.resuming = false;
      // Only a resume that changed nothing is worth spacing out.
      if (s.ctx.state !== 'running') s.nextResumeAt = performance.now() + RESUME_RETRY_MS;
      if (!s.started) {
        s.started = true;
        this.load(s);
      }
      // The player may have paused while the context was still waking up.
      if (this.mode !== 'live') this.scheduleSuspend(s, SILENCE_SUSPEND_MS);
      this.notify();
    }).catch((error) => {
      clearTimeout(timer); s.timers.delete(timer);
      if (this.session === s) this.fail(s, error.message);
    });
  }

  scheduleSuspend(s, delay) {
    this.clearSuspend(s);
    s.suspendTimer = setTimeout(() => {
      s.suspendTimer = null;
      if (this.session === s && this.mode !== 'live' && !this.musicWanted() && s.ctx.state === 'running') {
        s.ctx.suspend().catch(() => {});
      }
    }, delay);
  }

  clearSuspend(s) {
    if (s.suspendTimer) clearTimeout(s.suspendTimer);
    s.suspendTimer = null;
  }

  load(s) {
    const timeout = setTimeout(() => s.abort.abort(), LOAD_DEADLINE_MS);
    s.timers.add(timeout);
    Promise.allSettled([this.loadEngine(s), this.loadTireVoice(s)]).then(() => {
      clearTimeout(timeout); s.timers.delete(timeout);
    });
    if (this.lastGame) this.ensureBustedVoice(s, this.lastGame);
  }

  // Loads the offline "BUSTED!" voice clip lazily on the first Getaway session so circuits make
  // zero extra requests. Missing or corrupt files leave bustedBuffer null and fall back cleanly.
  async ensureBustedVoice(s, game) {
    if (!s || s.bustedState !== 'idle' || game?.mode !== 'gymkhana' || game?.challengeDef?.layout !== 'urban') return;
    s.bustedState = 'loading';
    this.fx.bustedState = 'loading';
    try {
      const { buffer, failures } = await this.bustedLoader(s.ctx, s.abort.signal);
      if (this.session !== s) return;
      s.bustedFailures.push(...(failures ?? []));
      if (buffer) {
        s.bustedBuffer = buffer;
        s.bustedState = 'ready';
      } else {
        s.bustedState = 'unavailable';
      }
    } catch (error) {
      if (this.session !== s) return;
      s.bustedFailures.push(error.message);
      s.bustedState = 'unavailable';
    }
    this.fx.bustedState = s.bustedState;
  }

  // Exactly one engine voice is ever built. The synthesized one is the fallback
  // when the recordings can't load, and is never described as a recording.
  async loadEngine(s) {
    let coyote = null;
    if (this.coyoteEnabled) {
      try {
        const { buffers, failures } = await this.coyoteLoader(s.ctx, s.abort.signal);
        if (this.session !== s) return;
        s.engineFailures.push(...failures);
        if (s.abort.signal.aborted) s.engineFailures.push('Coyote loading timed out');
        const voice = createCoyote(s.ctx, s.engineBus, buffers);
        if (voice.sourceCount === 4) coyote = voice;
        else voice.stop();
      } catch (error) {
        if (this.session !== s) return;
        s.engineFailures.push(error.message);
      }
    }
    try {
      s.engine = coyote ?? createProcedural(s.ctx, s.engineBus);
      s.engineKind = coyote ? 'coyote' : 'fallback';
      this.applied = null;
      this.applyParams(s);
    } catch (error) {
      s.engineFailures.push(error.message);
    }
    this.notify();
  }

  async loadTireVoice(s) {
    s.tireState = 'loading';
    try {
      const { buffer, failures } = await this.tireLoader(s.ctx, s.abort.signal);
      if (this.session !== s) return;
      s.tireFailures.push(...failures);
      if (s.abort.signal.aborted) s.tireFailures.push('Tire loading timed out');
      if (buffer) {
        s.tire = createTireVoice(s.ctx, s.tireBus, buffer);
        s.tireState = 'ready';
        this.applied = null;
        this.applyParams(s);
      } else {
        s.tireState = 'unavailable';
      }
    } catch (error) {
      if (this.session !== s) return;
      s.tireFailures.push(error.message);
      s.tireState = 'unavailable';
    }
    this.notify();
  }

  // Only real changes reach the audio graph, so a steady idle schedules nothing.
  applyParams(s) {
    const { rpm, throttle: load, glide } = engineParams(this.audioState, this.tuning);
    const tire = tireParams(this.audioState);
    const last = this.applied;
    const engineChanged = !last || Math.abs(rpm - last.rpm) >= 1 || Math.abs(load - last.load) >= 0.002;
    const tireChanged = !last || Math.abs(tire.tireIntensity - last.tire.tireIntensity) >= 0.001
      || Math.abs(tire.tireCutoff - last.tire.tireCutoff) >= 5
      || Math.abs(tire.tireRate - last.tire.tireRate) >= 0.002;
    if (engineChanged && s.engine) {
      const values = { rpm, throttle: load };
      const params = s.engineKind === 'coyote' ? mapCoyote(values) : mapProceduralEngine(values);
      s.engine.update(glide === undefined ? params : { ...params, pitchGlide: glide });
    }
    if (tireChanged && s.tire) s.tire.update(tire);
    this.applied = {
      rpm: engineChanged ? rpm : last.rpm,
      load: engineChanged ? load : last.load,
      tire: tireChanged ? tire : last.tire,
    };
  }

  teardown(s) {
    this.stopSmashes(s);
    this.stopOutcomeCues(s);
    this.session = null; // invalidates every asynchronous completion still pending
    s.abort.abort();
    this.clearSuspend(s);
    for (const timer of s.timers) clearTimeout(timer);
    s.ctx.onstatechange = null;
    s.radio.dispose();
    s.engine?.stop();
    s.tire?.stop();
    for (const node of s.nodes) node.disconnect();
    if (s.ctx.state !== 'closed') s.ctx.close().catch(() => {});
  }
}
