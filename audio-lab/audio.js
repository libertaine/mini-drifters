import { DEFAULTS, mapAudio, normalize } from './model.js';
import { createProcedural, createSampleVoice, loadSamples, smooth } from './voices.js';

export class AudioLab {
  constructor({ contextFactory = () => new AudioContext(), sampleLoader = loadSamples, onChange = () => {} } = {}) {
    this.contextFactory = contextFactory;
    this.sampleLoader = sampleLoader;
    this.onChange = onChange;
    this.values = { ...DEFAULTS };
    this.muted = false;
    this.session = null;
    this.message = 'Stopped. Choose a preset, then start audio.';
  }

  snapshot() {
    const s = this.session;
    return {
      running: !!s?.running, contextState: s?.ctx.state ?? 'closed',
      muted: this.muted, mode: this.values.mode, message: this.message,
      sampleState: s?.sampleState ?? 'not loaded', failures: [...(s?.failures ?? [])],
      sourceCount: (s?.procedural?.sourceCount ?? 0) + (s?.samples?.sourceCount ?? 0),
      outputGain: s?.gate?.gain.value ?? 0,
      values: { ...this.values }, mapped: mapAudio(this.values),
    };
  }

  notify() { this.onChange(this.snapshot()); }

  set(values) {
    this.values = normalize({ ...this.values, ...values });
    this.update();
    this.notify();
  }

  mute(muted) {
    this.muted = !!muted;
    const s = this.session;
    if (s) {
      s.gate.gain.cancelScheduledValues(s.ctx.currentTime);
      if (this.muted) s.gate.gain.setValueAtTime(0, s.ctx.currentTime);
      else if (s.running && s.ctx.state === 'running') smooth(s.gate.gain, 1, s.ctx, 0.025);
    }
    this.notify();
  }

  start() {
    // Deduplicate both the resume promise and the complete source graph.
    if (this.session) {
      if (this.session.ctx.state === 'suspended' && this.session.running) {
        this.stop('Audio was interrupted. Press Start Audio again.');
      } else return this.session.ready;
    }
    const ctx = this.contextFactory();
    const nodes = [];
    const gain = (value = 0) => {
      const n = ctx.createGain(); n.gain.value = value; nodes.push(n); return n;
    };
    const s = { ctx, nodes, abort: new AbortController(), running: false, sampleState: 'loading', failures: [] };
    this.session = s;
    try {
      s.gate = gain();
      s.master = gain(this.values.masterVolume * 0.65);
      s.engine = gain(this.values.engineVolume);
      s.tire = gain(this.values.tireVolume);
      const compressor = ctx.createDynamicsCompressor(); nodes.push(compressor);
      compressor.threshold.value = -10; compressor.knee.value = 8;
      compressor.ratio.value = 12; compressor.attack.value = 0.003; compressor.release.value = 0.15;
      s.engine.connect(compressor); s.tire.connect(compressor);
      compressor.connect(s.master).connect(s.gate).connect(ctx.destination);
      s.procEngine = gain(); s.procTire = gain(); s.sampleEngine = gain(); s.sampleTire = gain();
      s.procEngine.connect(s.engine); s.sampleEngine.connect(s.engine);
      s.procTire.connect(s.tire); s.sampleTire.connect(s.tire);
      // resume() runs synchronously within the click handler, before any fetch.
      const resumed = ctx.resume();
      s.procedural = createProcedural(ctx, s.procEngine, s.procTire);
      this.update();
      this.message = 'Starting audio…';
      s.ready = Promise.resolve(resumed).then(() => {
        if (this.session !== s) return;
        s.running = true;
        ctx.onstatechange = () => {
          if (this.session === s && s.running && ctx.state !== 'running') {
            this.stop('Audio was interrupted. Press Start Audio to resume.');
          }
        };
        if (!this.muted) smooth(s.gate.gain, 1, ctx, 0.025);
        this.message = 'Audio running.';
        this.notify();
        // Samples load in either mode, without delaying the procedural engine.
        s.timeout = setTimeout(() => s.abort.abort(), 12000);
        s.loading = this.sampleLoader(ctx, s.abort.signal).then(({ buffers, failures }) => {
          if (this.session !== s) return;
          s.failures = failures;
          if (s.abort.signal.aborted) s.failures.push('Sample loading timed out. Stop and start to retry.');
          s.samples = createSampleVoice(ctx, s.sampleEngine, s.sampleTire, buffers);
          const count = Object.keys(buffers).length;
          s.sampleState = count === 3 ? 'ready' : count ? 'partial' : 'unavailable';
          this.update();
          this.notify();
        }).catch((error) => {
          if (this.session !== s) return;
          s.sampleState = 'unavailable'; s.failures = [error.message];
          this.notify();
        }).finally(() => clearTimeout(s.timeout));
      }).catch((error) => {
        if (this.session === s) this.stop(`Audio could not start: ${error.message}`);
      });
      this.notify();
      return s.ready;
    } catch (error) {
      this.stop(`Audio could not start: ${error.message}`);
      return Promise.reject(error);
    }
  }

  update() {
    const s = this.session;
    if (!s) return;
    const p = mapAudio(this.values);
    s.procedural?.update(p); s.samples?.update(p);
    const procedural = p.mode === 'procedural' ? 1 : 0;
    for (const bus of [s.procEngine, s.procTire]) smooth(bus.gain, procedural, s.ctx, 0.06);
    for (const bus of [s.sampleEngine, s.sampleTire]) smooth(bus.gain, 1 - procedural, s.ctx, 0.06);
    smooth(s.engine.gain, p.engineVolume, s.ctx);
    smooth(s.tire.gain, p.tireVolume, s.ctx);
    smooth(s.master.gain, p.masterVolume * 0.65, s.ctx);
  }

  stop(message = 'Stopped. Press Start Audio to restart.') {
    const s = this.session;
    this.session = null; // Invalidate all asynchronous resume/decode completions.
    if (s) {
      s.gate?.gain.cancelScheduledValues(s.ctx.currentTime);
      s.gate?.gain.setValueAtTime(0, s.ctx.currentTime);
      s.abort.abort(); clearTimeout(s.timeout);
      s.ctx.onstatechange = null;
      s.procedural?.stop(); s.samples?.stop();
      for (const node of s.nodes) node.disconnect();
      if (s.ctx.state !== 'closed') s.ctx.close().catch(() => {});
    }
    this.message = message;
    this.notify();
  }
}
