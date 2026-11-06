// The game's sound: one AudioContext, one engine voice and one tire voice, driven
// by the car's telemetry. It only reads the game. A failure in here must never
// reach the game loop, so every entry point the game calls is guarded.
import { createCoyote, loadCoyote } from './coyote.js';
import { mapCoyote } from './coyote-model.js';
import { createMixCompressor, createProcedural, createTireVoice, loadTire, mapProceduralEngine, smooth } from './audio-voices.js';
import { AUDIO_TUNING, createAudioState, engineParams, readTelemetry, resetAudioState, stepAudioState, tireParams } from './audio-telemetry.js';

const STORAGE_KEY = 'mini-drifters-sound';
const RESUME_DEADLINE_MS = 8000;
const LOAD_DEADLINE_MS = 12000;
const RESUME_RETRY_MS = 1000;
const SILENCE_TIME = 0.012;    // pause, mute, focus loss: gone at once, without a click
const SILENCE_SUSPEND_MS = 80;
const FINISH_FADE_TIME = 0.45;
const FINISH_SUSPEND_MS = 2400;
const RESTART_GAP = 0.35;      // long enough for the old engine note to fall to idle unheard
const APPLY_INTERVAL = 1 / 30; // the voices glide between updates, so 30 Hz is plenty

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
    storage = browserStorage(),
    isHidden = () => false,
    onChange = () => {},
    tuning = AUDIO_TUNING,
  } = {}) {
    this.contextFactory = contextFactory;
    this.coyoteEnabled = coyoteEnabled;
    this.coyoteLoader = coyoteLoader;
    this.tireLoader = tireLoader;
    this.storage = storage;
    this.isHidden = isHidden;
    this.onChange = onChange;
    this.tuning = tuning;
    this.muted = this.readMuted();
    this.pageActive = true;
    this.mode = 'silent';
    this.session = null;
    this.failure = null;
    this.contextsCreated = 0;
    this.audioState = createAudioState(tuning);
    this.sinceApply = Infinity;
    this.applied = null;
  }

  readMuted() {
    try { return this.storage?.getItem(STORAGE_KEY) === 'off'; } catch { return false; }
  }

  // --- What the game calls --------------------------------------------------

  // From a user gesture: the only place an AudioContext may be created or woken.
  gesture(game) {
    this.guard(() => {
      this.pageActive = !this.isHidden();
      if (!this.muted && liveState(game)) this.ensureSession();
      if (this.session) this.session.nextResumeAt = 0;
      this.sync(game);
    });
  }

  // A new run, from Enter, the Start button or R. Also a user gesture.
  newRun(game) {
    this.guard(() => {
      resetAudioState(this.audioState, this.tuning);
      this.applied = null;
      this.sinceApply = Infinity;
      const continuing = this.session?.started;
      this.gesture(game);
      if (continuing && this.mode === 'live') this.dipGate();
    });
  }

  setMuted(muted, game) {
    this.guard(() => {
      this.muted = !!muted;
      try { this.storage?.setItem(STORAGE_KEY, this.muted ? 'off' : 'on'); } catch { /* stays for this visit */ }
      this.failure = null;
    });
    this.gesture(game);
    this.notify();
  }

  // Focus and visibility. Never resumes anything by itself: the game stays paused
  // when focus returns, and sound follows the game.
  setPageActive(active, game) {
    this.guard(() => {
      this.pageActive = active && !this.isHidden();
      this.sync(game);
    });
  }

  // Once per rendered frame, after the simulation has advanced.
  update(game, dt) {
    this.guard(() => {
      if (game.state === 'menu') return;
      const running = liveState(game);
      if (running || game.state === 'finished') {
        stepAudioState(this.audioState, readTelemetry(game.car), dt, running, this.tuning);
      }
      this.sync(game);
      this.sinceApply += dt;
      if (this.session && this.mode !== 'silent' && this.sinceApply >= APPLY_INTERVAL) {
        this.sinceApply = 0;
        this.applyParams(this.session);
      }
    });
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
      tireIntensity: this.audioState.tire,
    };
  }

  // --- Internals ------------------------------------------------------------

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
      timers: new Set(),
    };
    this.session = s;
    s.gate = gain(0);
    s.master = gain(this.tuning.masterLevel);
    s.engineBus = gain(this.tuning.engineLevel);
    s.tireBus = gain(this.tuning.tireLevel);
    const compressor = createMixCompressor(ctx); nodes.push(compressor);
    s.engineBus.connect(compressor); s.tireBus.connect(compressor);
    compressor.connect(s.master).connect(s.gate).connect(ctx.destination);
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
    if (next === 'live') {
      this.clearSuspend(s);
      // A context made inside a gesture may already be running, so the first
      // resume still has to happen: it is what starts the loading.
      if (!s.started || s.ctx.state !== 'running') this.resume(s);
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
    if (changed) this.notify();
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
      if (this.session === s && this.mode !== 'live' && s.ctx.state === 'running') {
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
  }

  // Exactly one engine voice is ever built. The synthesized one is the fallback
  // when the private recordings are absent, and is never described as a recording.
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
    this.session = null; // invalidates every asynchronous completion still pending
    s.abort.abort();
    this.clearSuspend(s);
    for (const timer of s.timers) clearTimeout(timer);
    s.ctx.onstatechange = null;
    s.engine?.stop();
    s.tire?.stop();
    for (const node of s.nodes) node.disconnect();
    if (s.ctx.state !== 'closed') s.ctx.close().catch(() => {});
  }
}
