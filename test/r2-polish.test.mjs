// Unit tests for v0.8.0 R2 polish: procedural impact/cone/cue/siren audio synthesis,
// read-only siren telemetry, voice limits, and GameAudio lifecycle isolation.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createGame, startRun, restartRun, togglePause, returnToMenu } from '../src/game.js';
import { GameAudio } from '../src/audio.js';
import { loadBustedVoice } from '../src/audio-voices.js';
import { GYMKHANA_CHALLENGES } from '../src/gymkhana.js';
import { GETAWAY_DRIVER } from '../src/getaway-driver.js';
import { GETAWAY_MISSIONS } from '../src/getaway-missions.js';
import { CUE_SFX, FX_LIMITS, playImpact, playCone, playCurb, playCue, playBustedVoice, sirenTarget, createSirenVoice } from '../src/getaway-sfx.js';

function deepFreeze(obj, seen = new WeakSet()) {
  if (!obj || typeof obj !== 'object' || seen.has(obj)) return obj;
  seen.add(obj);
  for (const key of Object.keys(obj)) deepFreeze(obj[key], seen);
  return Object.freeze(obj);
}

// Lightweight Web Audio mock matching test/audio-lifecycle.test.mjs contracts.
function createMockAudioContext() {
  let time = 1;
  const sources = [];
  const oscillators = [];
  const makeParam = (initial = 0) => ({
    value: initial,
    events: [],
    setValueAtTime(v, t) { this.value = v; this.events.push(['set', v, t]); return this; },
    linearRampToValueAtTime(v, t) { this.value = v; this.events.push(['lin', v, t]); return this; },
    exponentialRampToValueAtTime(v, t) { this.value = v; this.events.push(['exp', v, t]); return this; },
    setTargetAtTime(v, t, k) { this.value = v; this.events.push(['tgt', v, t, k]); return this; },
    cancelScheduledValues(t) { this.events.push(['cancel', t]); return this; },
  });
  const node = (extra = {}) => ({
    connected: [],
    disconnected: false,
    connect(dest) { this.connected.push(dest); return dest; },
    disconnect() { this.disconnected = true; },
    ...extra,
  });
  const ctx = {
    state: 'running',
    sampleRate: 44100,
    get currentTime() { return time; },
    advance(dt) { time += dt; },
    destination: node({ kind: 'destination' }),
    sources,
    oscillators,
    resume() { this.state = 'running'; return Promise.resolve(); },
    suspend() { this.state = 'suspended'; return Promise.resolve(); },
    close() { this.state = 'closed'; return Promise.resolve(); },
    createGain() { return node({ kind: 'gain', gain: makeParam(1) }); },
    createBiquadFilter() { return node({ kind: 'filter', type: 'lowpass', frequency: makeParam(350), Q: makeParam(1) }); },
    createDynamicsCompressor() {
      return node({
        kind: 'comp',
        threshold: makeParam(-24), knee: makeParam(30), ratio: makeParam(12),
        attack: makeParam(0.003), release: makeParam(0.25),
      });
    },
    createWaveShaper() { return node({ kind: 'shaper', curve: null, oversample: 'none' }); },
    createBuffer(channels, length, sampleRate) {
      const data = Array.from({ length: channels }, () => new Float32Array(length));
      return { numberOfChannels: channels, length, sampleRate, getChannelData: (c) => data[c] };
    },
    createBufferSource() {
      const s = node({
        kind: 'buffer', buffer: null, loop: false, playbackRate: makeParam(1),
        started: false, stopped: false, startAt: null, stopAt: null,
        start(t = time) { this.started = true; this.startAt = t; },
        stop(t = time) { this.stopped = true; this.stopAt = t; },
      });
      sources.push(s);
      return s;
    },
    createOscillator() {
      const o = node({
        kind: 'osc', type: 'sine', frequency: makeParam(440), detune: makeParam(0),
        started: false, stopped: false, startAt: null, stopAt: null,
        start(t = time) { this.started = true; this.startAt = t; },
        stop(t = time) { this.stopped = true; this.stopAt = t; },
      });
      oscillators.push(o);
      return o;
    },
  };
  return ctx;
}

const flush = () => new Promise((r) => setTimeout(r, 0));

test('sirenTarget stays inactive outside live Getaway chases and reads game state without mutating it', () => {
  const game = createGame();
  assert.equal(sirenTarget(game).active, false, 'menu has no siren');

  startRun(game);
  game.state = 'racing';
  assert.equal(sirenTarget(game).active, false, 'circuit run has no siren');

  startRun(game, { mode: 'gymkhana', challenge: GYMKHANA_CHALLENGES[0] });
  game.state = 'racing';
  assert.equal(sirenTarget(game).active, false, 'open-pad gymkhana has no siren');

  // Getaway Driver: calm patrol (lights off) has no siren.
  const driver = GETAWAY_DRIVER.environments[0];
  startRun(game, { mode: 'gymkhana', challenge: driver });
  game.state = 'racing';
  assert.equal(sirenTarget(game).active, false, 'calm patrol cars with lights off stay silent');

  // Responding car: moderate urgency, distance-attenuated.
  const cop = game.challenge.police[0];
  cop.lights = true;
  cop.mode = 'respond';
  cop.watching = true;
  cop.x = game.car.x + 20;
  cop.y = game.car.y;
  const nearRespond = sirenTarget(game);
  assert.equal(nearRespond.active, true);
  assert.equal(nearRespond.urgency, 0, 'responding cruiser uses calm wail urgency 0');
  assert.equal(nearRespond.muffled, false);

  // Pursuing car: higher urgency, falls off smoothly with distance, and read-only on frozen state.
  cop.mode = 'pursue';
  const closeChase = sirenTarget(game);
  assert.equal(closeChase.active, true);
  assert.ok(closeChase.urgency > 0.7 && closeChase.urgency <= 1, `close chase urgency (${closeChase.urgency}) ramps toward Yelp`);
  assert.ok(closeChase.level > nearRespond.level, 'pursuing cruiser louder than responding cruiser');

  cop.x = game.car.x + 120;
  const farChase = sirenTarget(game);
  assert.ok(closeChase.level > farChase.level, `close (${closeChase.level}) louder than far (${farChase.level})`);

  // Out-of-sight cruiser muffles the siren.
  cop.watching = false;
  cop.sees = false;
  assert.equal(sirenTarget(game).muffled, true, 'out-of-sight cruiser marks siren muffled');

  // Frozen game check: sirenTarget never writes back into simulation state.
  const frozen = deepFreeze({
    mode: game.mode,
    state: game.state,
    paused: game.paused,
    car: { ...game.car },
    challengeDef: { layout: game.challengeDef.layout, pursuerTuning: { ...game.challengeDef.pursuerTuning } },
    challenge: {
      phase: game.challenge.phase,
      time: game.challenge.time,
      meter: game.challenge.meter,
      gap: game.challenge.gap,
      sees: game.challenge.sees,
      police: game.challenge.police.map((u) => ({ ...u })),
    },
  });
  const res = sirenTarget(frozen);
  assert.equal(res.active, true);
  assert.ok(Number.isFinite(res.level));

  // Paused or finished stops the siren target.
  togglePause(game);
  assert.equal(sirenTarget(game).active, false, 'paused chase stops siren');
  togglePause(game);
  game.state = 'finished';
  assert.equal(sirenTarget(game).active, false, 'finished chase stops siren');
});

test('sirenTarget activates in Get the Footage only after pursuer delay', () => {
  const game = createGame();
  const footage = GETAWAY_MISSIONS[0].environments[0];
  startRun(game, { mode: 'gymkhana', challenge: footage });
  game.state = 'racing';
  game.challenge.time = 0.2;
  assert.equal(sirenTarget(game).active, false, 'waiting pursuer at start stays silent');

  game.challenge.time = footage.pursuerTuning.delay + 1;
  const live = sirenTarget(game);
  assert.equal(live.active, true);
  assert.ok(live.level > 0);
});

test('procedural impact, cone, cue and siren voices schedule bounded finite sources and stop cleanly', () => {
  const ctx = createMockAudioContext();
  const dest = ctx.createGain();

  for (const kind of ['wall', 'container', 'tree', 'metal']) {
    const v = playImpact(ctx, dest, 0.85, kind);
    assert.ok(v && v.end > ctx.currentTime, `impact(${kind}) returns active voice`);
    v.stop();
  }

  const cone = playCone(ctx, dest);
  assert.ok(cone && cone.end > ctx.currentTime);
  cone.stop();

  for (const kind of [...Object.keys(CUE_SFX), 'camera', 'spotTick', 'bank']) {
    const v = playCue(ctx, dest, kind, 2);
    assert.ok(v && v.end > ctx.currentTime, `cue(${kind}) returns active voice`);
    v.stop();
  }
  assert.equal(playCue(ctx, dest, 'nonexistent-cue'), null);

  // Every one-shot oscillator and buffer source scheduled both start and stop.
  for (const s of [...ctx.sources, ...ctx.oscillators]) {
    assert.equal(s.started, true);
    assert.equal(s.stopped, true);
  }

  // Siren voice updates across wail/yelp and muffled/open states, then stops every oscillator.
  const beforeOsc = ctx.oscillators.length;
  const siren = createSirenVoice(ctx, dest);
  assert.equal(ctx.oscillators.length - beforeOsc, 2, 'dual detuned siren oscillators');
  siren.update({ level: 0.7, urgency: 0.2, muffled: false, dt: 0.05 });
  ctx.advance(0.05);
  siren.update({ level: 0.9, urgency: 1.0, muffled: true, dt: 0.05 });
  siren.stop();
  for (const o of ctx.oscillators.slice(beforeOsc)) {
    assert.equal(o.stopped, true);
  }
});

test('GameAudio enforces voice caps, keeps circuits siren-free, and cancels siren/outcome cues on mute, pause and restart', async () => {
  const contexts = [];
  const audio = new GameAudio({
    coyoteEnabled: false,
    contextFactory: () => { const c = createMockAudioContext(); contexts.push(c); return c; },
    storage: { getItem: () => null, setItem() {} },
    tireLoader: () => Promise.resolve({ buffer: null, failure: 'mock' }),
  });
  const game = createGame();
  startRun(game);
  audio.newRun(game);
  await flush();
  game.state = 'racing';
  audio.update(game, 1 / 60);
  assert.equal(audio.fx.sirenActive, false, 'circuit never starts siren');

  // Impact voice cap holds under burst.
  for (let i = 0; i < FX_LIMITS.impactMaxVoices + 5; i += 1) audio.impact(0.8, 'wall');
  assert.equal(audio.fx.impacts, FX_LIMITS.impactMaxVoices);

  // Start Getaway Driver and trigger pursuit siren.
  startRun(game, { mode: 'gymkhana', challenge: GETAWAY_DRIVER.environments[0] });
  audio.newRun(game);
  game.state = 'racing';
  const cop = game.challenge.police[0];
  cop.lights = true;
  cop.mode = 'pursue';
  cop.x = game.car.x + 15;
  cop.y = game.car.y;
  audio.update(game, 1 / 60);
  assert.equal(audio.fx.sirenActive, true, 'live pursuit activates siren');

  // Pause silences and stops siren immediately.
  togglePause(game);
  audio.update(game, 1 / 60);
  assert.equal(audio.fx.sirenActive, false, 'pause stops siren');
  togglePause(game);
  audio.update(game, 1 / 60);
  assert.equal(audio.fx.sirenActive, true, 'resume restores siren');

  // Effects volume 0 stops siren and blocks new cues.
  audio.setEffectsVolume(0);
  audio.update(game, 1 / 60);
  assert.equal(audio.fx.sirenActive, false, 'effectsVolume 0 stops siren');
  const cuesBefore = audio.fx.cues;
  audio.cue('spotted');
  assert.equal(audio.fx.cues, cuesBefore, 'effectsVolume 0 blocks cues');
  audio.setEffectsVolume(100);
  audio.update(game, 1 / 60);
  assert.equal(audio.fx.sirenActive, true);

  // Outcome cue plays during finish fade and cancels cleanly on restart or mute.
  game.state = 'finished';
  audio.update(game, 1 / 60);
  assert.equal(audio.fx.sirenActive, false, 'finish stops siren');
  assert.equal(audio.snapshot().mode, 'fade');
  const cuesBeforeOutcome = audio.fx.cues;
  audio.cue('outcome-ghost');
  assert.equal(audio.fx.cues, cuesBeforeOutcome + 1, 'outcome stinger plays during finish fade');
  assert.equal(audio.session.outcomeVoices.length, 1);

  restartRun(game, { mode: 'gymkhana', ghost: false });
  audio.newRun(game);
  assert.equal(audio.session.outcomeVoices.length, 0, 'restart cancels active outcome stinger');

  // Mute blocks outcome cues and stops everything.
  audio.setMuted(true, game);
  game.state = 'finished';
  audio.update(game, 1 / 60);
  const cuesWhileMuted = audio.fx.cues;
  audio.cue('outcome-lost-them');
  assert.equal(audio.fx.cues, cuesWhileMuted, 'muted game plays no outcome stinger');

  returnToMenu(game);
  audio.dispose();
  assert.equal(audio.fx.sirenActive, false);
});

test('loadBustedVoice and playBustedVoice handle decoded buffers, fallback, abort and clean node disposal', async () => {
  const ctx = createMockAudioContext();
  const fakeBuf = { duration: 0.892, sampleRate: 24000, numberOfChannels: 1, length: 21408 };
  ctx.decodeAudioData = async () => fakeBuf;

  let fetchedUrl = '';
  const ok = await loadBustedVoice(ctx, new AbortController().signal, async (url) => {
    fetchedUrl = String(url);
    return { ok: true, arrayBuffer: async () => new ArrayBuffer(16) };
  });
  assert.match(fetchedUrl, /audio-lab\/assets\/busted-voice\.wav$/);
  assert.equal(ok.buffer, fakeBuf);
  assert.deepEqual(ok.failures, []);

  // Missing asset fails quietly with a failure note and null buffer.
  const missing = await loadBustedVoice(ctx, new AbortController().signal, async () => ({ ok: false, status: 404 }));
  assert.equal(missing.buffer, null);
  assert.match(missing.failures[0], /404/);

  // Aborted load drops cleanly without reporting a failure.
  const ac = new AbortController();
  ac.abort();
  const aborted = await loadBustedVoice(ctx, ac.signal, async () => ({ ok: true, arrayBuffer: async () => new ArrayBuffer(8) }));
  assert.equal(aborted.buffer, null);
  assert.deepEqual(aborted.failures, []);

  // Spoken voice playback schedules buffer + sub punch and stops/disconnects cleanly.
  const dest = ctx.createGain();
  const srcBefore = ctx.sources.length;
  const voice = playBustedVoice(ctx, dest, fakeBuf);
  assert.equal(voice.spoken, true);
  assert.ok(voice.end >= ctx.currentTime + 0.89);
  assert.equal(ctx.sources.length, srcBefore + 1);
  assert.equal(ctx.sources.at(-1).buffer, fakeBuf);
  voice.stop();
  assert.equal(ctx.sources.at(-1).stopped, true);
  assert.equal(ctx.sources.at(-1).disconnected, true);

  // Null buffer falls back to synthesized sting cleanly.
  const fb = playBustedVoice(ctx, dest, null);
  assert.equal(fb.spoken, false);
  assert.ok(fb.end > ctx.currentTime);
  fb.stop();
});

test('GameAudio loads BUSTED voice lazily in Getaway, ducks the siren on bust, cancels on restart/mute/focus/volume and falls back cleanly', async () => {
  const fakeBuf = { duration: 0.892, sampleRate: 24000, numberOfChannels: 1, length: 21408 };
  const contexts = [];
  let bustedCalls = 0;
  const audio = new GameAudio({
    coyoteEnabled: false,
    contextFactory: () => { const c = createMockAudioContext(); contexts.push(c); return c; },
    storage: { getItem: () => null, setItem() {} },
    tireLoader: () => Promise.resolve({ buffer: null, failures: [] }),
    bustedLoader: async () => { bustedCalls += 1; return { buffer: fakeBuf, failures: [] }; },
  });

  // Circuit runs never request the Getaway busted voice asset.
  const game = createGame();
  startRun(game);
  audio.newRun(game);
  await flush();
  game.state = 'racing';
  audio.update(game, 1 / 60);
  assert.equal(bustedCalls, 0, 'circuit makes zero busted-voice requests');
  assert.equal(audio.fx.bustedState, 'idle');

  // Starting Getaway Driver loads the asset once and decodes it to ready.
  startRun(game, { mode: 'gymkhana', challenge: GETAWAY_DRIVER.environments[0] });
  audio.newRun(game);
  await flush();
  assert.equal(bustedCalls, 1, 'Getaway loads busted voice once');
  assert.equal(audio.fx.bustedState, 'ready');

  // Engage pursuit siren, then bust: siren ducks smoothly while spoken voice plays.
  game.state = 'racing';
  const cop = game.challenge.police[0];
  cop.lights = true; cop.mode = 'pursue'; cop.watching = true;
  cop.x = game.car.x + 15; cop.y = game.car.y;
  audio.update(game, 1 / 60);
  assert.equal(audio.fx.sirenActive, true);

  game.challenge.phase = 'failed';
  game.challenge.reason = 'busted';
  game.state = 'finished';
  audio.update(game, 1 / 60);
  audio.cue('outcome-busted');
  assert.equal(audio.fx.sirenActive, false);
  assert.equal(audio.fx.sirenDucked, true, 'siren ducks underneath the BUSTED voice');
  assert.equal(audio.fx.bustedPlayed, 1);
  assert.equal(audio.fx.bustedSpoken, 1);
  assert.equal(audio.fx.bustedFallback, 0);
  assert.equal(audio.session.outcomeVoices.length, 1);

  // Restart cancels both the BUSTED voice and the ducked siren immediately.
  restartRun(game, { mode: 'gymkhana', ghost: false });
  audio.newRun(game);
  assert.equal(audio.session.outcomeVoices.length, 0, 'restart stops BUSTED voice immediately');
  assert.equal(audio.fx.sirenDucked, false, 'restart cancels ducked siren immediately');
  assert.equal(audio.session.siren, null);
  assert.equal(bustedCalls, 1, 'restarts reuse the cached decoded buffer');

  // Focus loss, mute, and zero effects volume each cancel active BUSTED playback immediately.
  for (const action of ['mute', 'blur', 'zeroVol']) {
    game.state = 'racing';
    game.challenge.phase = 'running';
    game.challenge.reason = '';
    const u = game.challenge.police[0];
    u.lights = true; u.mode = 'pursue'; u.x = game.car.x + 15; u.y = game.car.y;
    audio.update(game, 1 / 60);
    game.challenge.phase = 'failed';
    game.challenge.reason = 'busted';
    game.state = 'finished';
    audio.update(game, 1 / 60);
    audio.cue('outcome-busted');
    assert.equal(audio.session.outcomeVoices.length, 1, action);

    if (action === 'mute') { audio.setMuted(true, game); }
    if (action === 'blur') { audio.setPageActive(false, game); }
    if (action === 'zeroVol') { audio.setEffectsVolume(0); }
    assert.equal(audio.session.outcomeVoices.length, 0, `${action} stops BUSTED voice`);
    assert.equal(audio.fx.sirenDucked, false, `${action} stops ducked siren`);

    if (action === 'mute') audio.setMuted(false, game);
    if (action === 'blur') audio.setPageActive(true, game);
    if (action === 'zeroVol') audio.setEffectsVolume(100);
  }

  // After the duck window elapses naturally, the ducked siren stops itself cleanly.
  game.state = 'racing';
  game.challenge.phase = 'running';
  game.challenge.reason = '';
  audio.update(game, 1 / 60);
  game.challenge.phase = 'failed';
  game.challenge.reason = 'busted';
  game.state = 'finished';
  audio.update(game, 1 / 60);
  audio.cue('outcome-busted');
  assert.equal(audio.fx.sirenDucked, true);
  contexts[0].advance(1.2);
  audio.update(game, 1 / 60);
  assert.equal(audio.fx.sirenDucked, false, 'ducked siren terminates once its short tail finishes');
  assert.equal(audio.session.siren, null);

  // Non-bust failure ('outcome-failed') never triggers the BUSTED voice counter.
  const playedBefore = audio.fx.bustedPlayed;
  audio.cue('outcome-failed');
  assert.equal(audio.fx.bustedPlayed, playedBefore);
  audio.dispose();

  // Unavailable voice asset degrades gracefully to synthesized fallback without failing audio.
  const fallbackAudio = new GameAudio({
    coyoteEnabled: false,
    contextFactory: () => createMockAudioContext(),
    storage: { getItem: () => null, setItem() {} },
    tireLoader: () => Promise.resolve({ buffer: null, failures: [] }),
    bustedLoader: async () => ({ buffer: null, failures: ['busted-voice.wav: HTTP 404'] }),
  });
  startRun(game, { mode: 'gymkhana', challenge: GETAWAY_DRIVER.environments[0] });
  fallbackAudio.newRun(game);
  await flush();
  assert.equal(fallbackAudio.failure, null);
  assert.equal(fallbackAudio.fx.bustedState, 'unavailable');
  game.challenge.phase = 'failed'; game.challenge.reason = 'busted'; game.state = 'finished';
  fallbackAudio.update(game, 1 / 60);
  fallbackAudio.cue('outcome-busted');
  assert.equal(fallbackAudio.fx.bustedPlayed, 1);
  assert.equal(fallbackAudio.fx.bustedSpoken, 0);
  assert.equal(fallbackAudio.fx.bustedFallback, 1);
  fallbackAudio.dispose();
});

test('R2b Tracks & Gymkhana audio: curb rumble, laps, combo tier-ups, gates, slalom and medal fanfares disconnect cleanly and obey lifecycle', async () => {
  const ctx = createMockAudioContext();
  const dest = { connect() {} };

  // 1. playCurb produces bounded nodes that disconnect cleanly on stop.
  const curb = playCurb(ctx, dest, 0.8);
  assert.ok(curb && curb.end > ctx.currentTime && curb.end < ctx.currentTime + 0.15);
  curb.stop();
  assert.ok(ctx.sources.every((s) => s.stopped), 'curb stops all sources immediately');

  // 2. Every new Tracks & Gymkhana static and parameterized cue plays and disconnects cleanly.
  const cues = [
    ['lap'], ['lap-best'], ['lap-void'], ['combo-lost'], ['turn-zone'], ['wrong-way'],
    ['combo-up', 2], ['combo-up', 3],
    ['gate-pass', 0], ['gate-pass', 1],
    ['slalom-pass', 1], ['slalom-pass', 4], ['slalom-pass', 7],
    ['outcome-circuit'], ['outcome-record'], ['outcome-gold'], ['outcome-silver'], ['outcome-bronze'],
  ];
  for (const [kind, detail] of cues) {
    const c = createMockAudioContext();
    const v = playCue(c, dest, kind, detail);
    assert.ok(v && v.end > c.currentTime && v.end < c.currentTime + 1.2, `${kind} has valid duration`);
    v.stop();
    assert.ok(c.sources.every((s) => s.stopped), `${kind} stops all sources on cancel`);
  }

  // 3. GameAudio.curb respects voice cap, pause, mute, effects volume 0, and restart without adding persistent sources.
  const contexts = [];
  const audio = new GameAudio({
    coyoteEnabled: false,
    contextFactory: () => { const c = createMockAudioContext(); contexts.push(c); return c; },
    storage: { getItem: () => null, setItem() {} },
    tireLoader: () => Promise.resolve({ buffer: null, failures: [] }),
  });
  const game = createGame();
  startRun(game);
  audio.newRun(game);
  await new Promise((r) => setTimeout(r, 15));
  const baselineSources = audio.snapshot().sourceCount;
  for (let i = 0; i < 6; i += 1) audio.curb(0.75);
  assert.equal(audio.fx.curbs, FX_LIMITS.curbMaxVoices, 'curb pulses respect voice cap');
  assert.equal(audio.snapshot().sourceCount, baselineSources, 'curb adds zero persistent engine/tire sources');

  // Pause & mute cancel active curb voices and ignore new ones.
  togglePause(game);
  audio.gesture(game);
  assert.equal(audio.session.curbVoices.length, 0, 'pause cancels active curb voices');
  audio.curb(0.75);
  assert.equal(audio.fx.curbs, FX_LIMITS.curbMaxVoices, 'paused curb is ignored');
  togglePause(game);
  audio.gesture(game);
  audio.setEffectsVolume(0);
  audio.curb(0.75);
  assert.equal(audio.fx.curbs, FX_LIMITS.curbMaxVoices, 'zero effects volume suppresses curb');
  audio.setEffectsVolume(100);

  // Outcome medal fanfares cancel immediately on restart.
  game.state = 'finished';
  audio.update(game, 1 / 60);
  audio.cue('outcome-gold');
  assert.equal(audio.fx.lastCue, 'outcome-gold');
  assert.equal(audio.session.outcomeVoices.length, 1);
  restartRun(game);
  audio.newRun(game);
  assert.equal(audio.session.outcomeVoices.length, 0, 'restart cancels medal fanfare');
  audio.dispose();
});
