// Native browser checks. Synthetic fixtures are explicitly labeled when private
// owner audio is absent (e.g. public CI); never a production audio fallback.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';
const { chromium, firefox } = await import(process.argv[2] ? pathToFileURL(process.argv[2]) : 'playwright');
const root = new URL('../', import.meta.url), base = 'http://127.0.0.1:4196';
const server = spawn(process.execPath, [fileURLToPath(new URL('server.mjs', root))], { env: { ...process.env, PORT: '4196' }, stdio: ['ignore', 'pipe', 'inherit'] });
const report = [];
try {
  await new Promise((resolve, reject) => { server.once('error', reject); server.once('exit', (code) => reject(new Error('Server exited: ' + code))); server.stdout.once('data', resolve); });
  await mkdir(new URL('artifacts/', root), { recursive: true });
  for (const [name, engine] of [['chromium', chromium], ['firefox', firefox]]) {
    const browser = await engine.launch({ headless: true });
    try {
      const page = await browser.newPage({ viewport: { width: 1366, height: 1000 } });
      const errors = []; page.on('pageerror', (e) => errors.push(e.message));
      if (process.env.COYOTE_PUBLIC_CHECK === '1') await page.route('**/coyote-local/*.wav', (route) => route.fulfill({ status: 404, body: 'Owner audio deliberately absent for public-checkout test' }));
      await page.goto(base + '/audio-lab/');
      assert.equal(await page.locator('#mode option').count(), 3);
      await page.locator('#mode').selectOption('coyote');
      await page.getByRole('button', { name: 'Sustained power drift', exact: true }).click();
      await page.locator('#isolate').click();
      await page.locator('#tire-mode').selectOption('procedural');
      await page.locator('#start').click();
      await page.waitForFunction(() => window.__audioLab.snapshot().running || window.__audioLab.snapshot().message.includes('Audio output did not start'));
      const realtime = await page.evaluate(() => window.__audioLab.snapshot().running);
      if (!realtime) { assert.equal(name, 'firefox'); assert.equal(process.platform, 'linux'); }
      let actualBank = false;
      if (realtime) {
        await page.waitForFunction(() => window.__audioLab.snapshot().coyoteState !== 'loading' && window.__audioLab.snapshot().sampleState === 'ready');
        actualBank = await page.evaluate(() => window.__audioLab.snapshot().coyoteState === 'ready');
        const before = await page.evaluate(() => window.__audioLab.snapshot().values);
        for (const mode of ['samples', 'procedural', 'coyote']) {
          await page.locator('#mode').selectOption(mode);
          const after = await page.evaluate(() => window.__audioLab.snapshot().values);
          assert.deepEqual({ ...after, mode: before.mode }, before);
        }
        await page.locator('#sweep').click();
        await page.waitForFunction(() => window.__audioLab.snapshot().values.rpm > 900);
        await page.locator('#sweep').click();
        const held = await page.evaluate(() => window.__audioLab.snapshot().values.rpm);
        await page.waitForTimeout(120);
        assert.equal(await page.evaluate(() => window.__audioLab.snapshot().values.rpm), held);
        await page.locator('#sweep').click(); await page.locator('#stop').click();
        assert.equal(await page.locator('#sweep').getAttribute('aria-pressed'), 'false');
        for (const kind of ['missing', 'corrupt']) {
          const pattern = '**/coyote-local/mid.wav';
          await page.route(pattern, (route) => route.fulfill({ status: kind === 'missing' ? 404 : 200, body: kind === 'missing' ? 'missing' : 'bad WAV data' }));
          await page.locator('#start').click();
          await page.waitForFunction(() => window.__audioLab.snapshot().coyoteState === 'unavailable' && window.__audioLab.snapshot().sampleState === 'ready');
          const snapshot = await page.evaluate(() => window.__audioLab.snapshot());
          assert.equal(snapshot.mode, 'coyote'); assert.equal(snapshot.sourceCount, 11);
          assert.ok(snapshot.coyoteFailures.some((f) => f.startsWith('mid.wav:')));
          assert.match(await page.locator('#coyote-status').textContent(), /engine stays silent/);
          await page.locator('#stop').click(); await page.unroute(pattern);
        }
        for (let i = 0; i < 3; i++) {
          await page.locator('#start').click();
          await page.waitForFunction(() => window.__audioLab.snapshot().coyoteState !== 'loading' && window.__audioLab.snapshot().sampleState === 'ready');
          assert.equal(await page.evaluate(() => window.__audioLab.snapshot().sourceCount), actualBank ? 15 : 11);
          await page.locator('#mute').click();
          await page.waitForFunction(() => window.__audioLab.snapshot().outputGain === 0);
          await page.locator('#stop').click();
          assert.equal(await page.evaluate(() => window.__audioLab.snapshot().contextState), 'closed');
          await page.locator('#mute').click();
        }
      }
      const offline = await page.evaluate(async () => {
        const { createCoyote, loadCoyote } = await import('./coyote.js');
        const { createProcedural, createSampleVoice, loadSamples } = await import('./voices.js');
        const { mapAudio, PRESETS, ENGINE_TRIMS } = await import('./model.js');
        const decoder = new OfflineAudioContext(1, 24000, 24000), start = performance.now();
        const coyote = await loadCoyote(decoder, new AbortController().signal), decodeMs = performance.now() - start;
        const sample = await loadSamples(decoder, new AbortController().signal);
        if (sample.failures.length) throw new Error(sample.failures.join('; '));
        const ownerSamples = Object.keys(coyote.buffers).length === 4;
        const buffers = ownerSamples ? coyote.buffers : Object.fromEntries(['idle', 'mid', 'load', 'high'].map((key, i) => {
          const b = decoder.createBuffer(1, 24000, 24000), data = b.getChannelData(0);
          for (let n = 0; n < data.length; n++) data[n] = 0.22 * Math.sin(2 * Math.PI * [73, 180, 293, 440][i] * n / 24000);
          return [key, b];
        }));
        const metrics = (data, skip = 0) => {
          let peak = 0, sum = 0, maxStep = 0;
          for (let i = skip; i < data.length; i++) { const x = data[i]; if (!Number.isFinite(x)) throw new Error('Nonfinite render'); peak = Math.max(peak, Math.abs(x)); sum += x * x; if (i > skip) maxStep = Math.max(maxStep, Math.abs(x - data[i - 1])); }
          return { peak, rms: Math.sqrt(sum / (data.length - skip)), maxStep };
        };
        const renders = [], loudness = [];
        for (const preset of [...PRESETS, { name: 'Maximum', values: { rpm: 7000, throttle: 1, speed: 120, slip: 90, grip: 0.15 } }]) {
          const ctx = new OfflineAudioContext(1, 48000, 24000), voice = createCoyote(ctx, ctx.destination, buffers);
          voice.update(mapAudio(preset.values)); renders.push({ test: preset.name, ...metrics((await ctx.startRendering()).getChannelData(0), 24000) }); voice.stop();
        }
        for (const rpm of [750, 1100, 1700, 2700, 3500, 4400, 5300, 6600, 7000]) {
          const ctx = new OfflineAudioContext(1, 30 * 24000, 24000), voice = createCoyote(ctx, ctx.destination, buffers);
          voice.update(mapAudio({ rpm, throttle: 0.7 })); renders.push({ test: '30s hold', rpm, ...metrics((await ctx.startRendering()).getChannelData(0), 24000) }); voice.stop();
        }
        // Native offline suspend points let real automation run between changes.
        const dynamicOffline = typeof decoder.suspend === 'function';
        for (const kind of dynamicOffline ? ['sweep', 'fixed RPM throttle'] : []) {
          const ctx = new OfflineAudioContext(1, 24 * 24000, 24000), voice = createCoyote(ctx, ctx.destination, buffers);
          const at = (t) => kind === 'sweep' ? { rpm: 750 + 6250 * (t < 12 ? t / 12 : (24 - t) / 12), throttle: 0.8 }
            : { rpm: 3500, throttle: Math.floor(t / 3) % 2 };
          voice.update(mapAudio(at(0)));
          const changes = [];
          for (let t = 0.5; t < 24; t += 0.5) changes.push(ctx.suspend(t).then(() => { voice.update(mapAudio(at(t))); return ctx.resume(); }));
          const output = await ctx.startRendering(); await Promise.all(changes);
          renders.push({ test: kind, ...metrics(output.getChannelData(0)) }); voice.stop();
        }
        for (const mode of ['procedural', 'samples', 'coyote']) for (const index of [0, 1, 2, 5]) {
          const ctx = new OfflineAudioContext(1, 48000, 24000), engineBus = ctx.createGain(), tireBus = ctx.createGain();
          engineBus.gain.value = ENGINE_TRIMS[mode];
          engineBus.connect(ctx.destination); // Engine only, with actual static mode trim.
          const voice = mode === 'procedural' ? createProcedural(ctx, engineBus, tireBus) : mode === 'samples' ? createSampleVoice(ctx, engineBus, tireBus, sample.buffers) : createCoyote(ctx, engineBus, buffers);
          voice.update(mapAudio(PRESETS[index].values));
          loudness.push({ mode, preset: PRESETS[index].name, ...metrics((await ctx.startRendering()).getChannelData(0), 24000) }); voice.stop();
        }
        // C's follow-mode tires must remain exactly silent when stationary,
        // including through the real controller, compressor and master gate.
        {
          const { AudioLab } = await import('./audio.js');
          const ctx = new OfflineAudioContext(1, 24000, 24000);
          ctx.resume = async () => {}; ctx.close = async () => {};
          const lab = new AudioLab({ contextFactory: () => ctx, sampleLoader: async () => sample,
            coyoteLoader: async () => ({ buffers, failures: [] }) });
          lab.set({ mode: 'coyote', engineVolume: 0, tireVolume: 1, speed: 0, slip: 90, grip: 0.15 });
          await lab.start(); await Promise.all([lab.session.loading, lab.session.coyoteLoading]);
          renders.push({ test: 'C stationary tires', ...metrics((await ctx.startRendering()).getChannelData(0)) }); lab.stop();
        }
        // Verify actual three-mode bus smoothing on native automation, using the
        // same controller through OfflineAudioContext (no device needed).
        if (dynamicOffline) {
        const { AudioLab } = await import('./audio.js');
        const ctx = new OfflineAudioContext(1, 6 * 24000, 24000);
        ctx.resume = async () => {}; // Only startup is bypassed; rendering/automation are native.
        ctx.close = async () => {};
        const lab = new AudioLab({ contextFactory: () => ctx, sampleLoader: async () => sample,
          coyoteLoader: async () => ({ buffers, failures: [] }) });
        lab.set({ rpm: 3500, throttle: 0.7, tireVolume: 0, masterVolume: 1, engineVolume: 1 });
        await lab.start(); await Promise.all([lab.session.loading, lab.session.coyoteLoading]);
        const suspend = OfflineAudioContext.prototype.resume.bind(ctx);
        const switches = [ctx.suspend(2).then(() => { lab.set({ mode: 'samples' }); return suspend(); }),
          ctx.suspend(4).then(() => { lab.set({ mode: 'coyote' }); return suspend(); })];
        const output = await ctx.startRendering(); await Promise.all(switches);
        const data = output.getChannelData(0), whole = metrics(data);
        const boundarySteps = [2, 4].map((t) => Math.abs(data[t * 24000] - data[t * 24000 - 1]));
        lab.stop();
        renders.push({ test: 'A/B/C mode transitions', ...whole, boundarySteps });
        }
        return { dynamicOffline, dynamicOfflineLimit: dynamicOffline ? null : 'Firefox lacks OfflineAudioContext.suspend; timed sweep/load/mode renders run in Chromium. Firefox retains static native renders and real-time control checks when a device is available.', ownerSamples, fixture: ownerSamples ? null : 'Synthetic sine buffers for graph tests ONLY; no owner-audio rendering claim', failures: coyote.failures, decodeMs,
          decodedMonoBytes: Object.values(buffers).reduce((n, b) => n + b.length * 4, 0), renders, loudness };
      });
      if (process.env.COYOTE_PUBLIC_CHECK === '1') assert.equal(offline.ownerSamples, false);
      if (process.env.COYOTE_REQUIRED === '1') assert.equal(offline.ownerSamples, true, 'Owner bank required for local qualification');
      if (offline.ownerSamples) for (const preset of new Set(offline.loudness.map((r) => r.preset))) {
        const levels = offline.loudness.filter((r) => r.preset === preset).map((r) => r.rms);
        assert.ok(20 * Math.log10(Math.max(...levels) / Math.min(...levels)) < 3.5, preset + ': static RMS trim difference');
      }
      for (const r of offline.renders) { if (r.test === 'C stationary tires') assert.equal(r.rms, 0); else assert.ok(r.rms > 0.001, JSON.stringify(r)); assert.ok(r.peak < 1, JSON.stringify(r)); assert.ok(r.maxStep < 0.65, JSON.stringify(r)); if (r.boundarySteps) assert.ok(r.boundarySteps.every((v) => v < 0.1)); }
      await page.setViewportSize({ width: 320, height: 740 });
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
      await page.screenshot({ path: fileURLToPath(new URL('artifacts/coyote-' + name + '-320.png', root)), fullPage: true });
      assert.deepEqual(errors, []);
      report.push({ browser: name, realtimeOutput: realtime, ...offline });
      console.log(name + ': Coyote controls/failures, ' + offline.renders.length + ' native renders, ' + (offline.ownerSamples ? 'OWNER AUDIO' : 'SYNTHETIC TEST FIXTURES ONLY'));
    } finally { await browser.close(); }
  }
  await writeFile(new URL('artifacts/coyote-report.json', root), JSON.stringify(report, null, 2) + '\n');
} finally { server.kill(); }
