// Real Web Audio, headless Chromium and Firefox. No subjective listening claims.
// Optional argument: absolute path to an existing Playwright index.mjs.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';

const { chromium, firefox } = await import(process.argv[2] ? pathToFileURL(process.argv[2]) : 'playwright');
const selectedBrowser = process.env.AUDIO_LAB_BROWSER;
if (selectedBrowser && !['chromium', 'firefox'].includes(selectedBrowser)) throw new Error('AUDIO_LAB_BROWSER must be chromium or firefox');
const root = new URL('../', import.meta.url);
const port = 4194;
const base = `http://127.0.0.1:${port}`;
const server = spawn(process.execPath, [fileURLToPath(new URL('server.mjs', root))], {
  env: { ...process.env, PORT: String(port) }, stdio: ['ignore', 'pipe', 'inherit'],
});
const report = [];
const artifact = (name) => fileURLToPath(new URL(`artifacts/${name}`, root));

try {
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.once('exit', (code) => reject(new Error(`Lab server exited: ${code}`)));
    server.stdout.once('data', resolve);
  });
  await mkdir(new URL('artifacts/', root), { recursive: true });
  for (const [name, engine] of [['chromium', chromium], ['firefox', firefox]]) {
    if (selectedBrowser && selectedBrowser !== name) continue;
    const browser = await engine.launch({ headless: true });
    let realtimeOutput = false;
    const errors = [];
    let page;
    try {
      page = await browser.newPage({ viewport: { width: 1366, height: 1000 } });
      page.on('pageerror', (error) => errors.push(error.message));
      const response = await page.goto(`${base}/audio-lab/`);
      assert.equal(response.status(), 200);
      await page.waitForFunction(() => window.__audioLab);
      const snapshot = () => page.evaluate(() => window.__audioLab.snapshot());
      assert.equal((await snapshot()).running, false);
      assert.equal(await page.locator('input[type=range]').count(), 8);
      assert.equal(await page.locator('#presets button').count(), 8);
      await page.getByRole('button', { name: 'Sustained power drift', exact: true }).click();
      assert.equal((await snapshot()).values.slip, 40);
      await page.getByRole('button', { name: 'Start Audio', exact: true }).click();
      await page.waitForFunction(() => window.__audioLab.snapshot().running ||
        window.__audioLab.snapshot().message.includes('Audio output did not start'));
      realtimeOutput = (await snapshot()).running;
      if (!realtimeOutput) {
        // Device-less Linux Firefox may never resolve native resume(). Verify
        // the explicit bounded failure, then run every native offline render.
        // Other environments must pass the complete real-time lifecycle below.
        assert.equal(name, 'firefox'); assert.equal(process.platform, 'linux');
        assert.match((await snapshot()).message, /Audio output did not start/);
        assert.equal((await snapshot()).sourceCount, 0);
        console.log('firefox: no real-time audio device; verified startup failure; offline rendering follows');
      } else {
        await page.waitForFunction(() => window.__audioLab.snapshot().sampleState === 'ready');
        assert.equal((await snapshot()).sourceCount, 11);
        for (let i = 0; i < 4; i++) await page.locator('#start').click();
        assert.equal((await snapshot()).sourceCount, 11);
        await page.locator('#mode').selectOption('samples');
        assert.equal((await snapshot()).mode, 'samples');
        await page.locator('#mute').click();
        // AudioParam.value is updated by the audio rendering thread. Wait for its
        // next render quantum before reading the scheduled immediate gate value.
        await page.waitForFunction(() => window.__audioLab.snapshot().outputGain === 0, null, { timeout: 1000 });
        assert.equal((await snapshot()).outputGain, 0);
        await page.locator('#masterVolume').press('End');
        assert.equal((await snapshot()).outputGain, 0);
        await page.locator('#mute').click();
        await page.locator('#surface').selectOption('grass');
        assert.equal((await snapshot()).values.surface, 'grass');
        await page.locator('#stop').click();
        assert.equal((await snapshot()).sourceCount, 0);
        for (let i = 0; i < 3; i++) {
          await page.locator('#start').click();
          await page.waitForFunction(() => window.__audioLab.snapshot().running);
          await page.locator('#stop').click();
        }
        // Stop while a real response is in flight, restart, and verify stale loads
        // cannot duplicate nodes or overwrite the new session's readiness.
        let heldRoute;
        await page.route('**/engine-high.wav', async (route) => { heldRoute = route; });
        await page.locator('#start').click();
        await page.waitForFunction(() => window.__audioLab.snapshot().running);
        await page.waitForTimeout(150);
        await page.locator('#stop').click();
        await page.unroute('**/engine-high.wav');
        if (heldRoute) await heldRoute.abort().catch(() => {});
        await page.locator('#start').click();
        await page.waitForFunction(() => window.__audioLab.snapshot().sampleState === 'ready');
        assert.equal((await snapshot()).sourceCount, 11);
        // Simulate the browser's visibility notification; controller stops and
        // requires a fresh user click. This is not physical tab/device testing.
        await page.evaluate(() => {
          Object.defineProperty(document, 'hidden', { configurable: true, value: true });
          document.dispatchEvent(new Event('visibilitychange'));
          delete document.hidden;
        });
        assert.equal((await snapshot()).running, false);
        assert.equal((await snapshot()).sourceCount, 0);
        await page.locator('#start').click();
        await page.waitForFunction(() => window.__audioLab.snapshot().sampleState === 'ready');
        await page.locator('#stop').click();

        // Exercise actual fetch/decode failures: both missing layers and complete
        // asset failure remain usable, with explicit feedback and no synthesis fallback.
        await page.route('**/engine-high.wav', (route) => route.fulfill({ status: 404, body: 'missing' }));
        await page.locator('#start').click();
        await page.waitForFunction(() => window.__audioLab.snapshot().sampleState === 'partial');
        assert.equal((await snapshot()).sourceCount, 10);
        assert.match(await page.locator('#sample-status').textContent(), /HTTP 404/);
        await page.locator('#stop').click(); await page.unroute('**/engine-high.wav');
        const assetPattern = /\/assets\/.*\.(wav|mp3)$/;
        await page.route(assetPattern, (route) => route.fulfill({ status: 200, body: 'corrupt recording' }));
        await page.locator('#start').click();
        await page.waitForFunction(() => window.__audioLab.snapshot().sampleState === 'unavailable');
        assert.equal((await snapshot()).sourceCount, 8);
        assert.match(await page.locator('#sample-status').textContent(), /Sample mode is silent/);
        await page.locator('#stop').click(); await page.unroute(assetPattern);
      }

      const renders = await page.evaluate(async () => {
        const { createProcedural, createSampleVoice, loadSamples } = await import('./voices.js');
        const { mapAudio, PRESETS } = await import('./model.js');
        const decoder = new OfflineAudioContext(1, 24000, 24000);
        const { buffers, failures } = await loadSamples(decoder, new AbortController().signal);
        if (failures.length) throw new Error(failures.join('; '));
        const measurements = [];
        for (const mode of ['procedural', 'samples']) {
          for (const preset of [...PRESETS, { name: 'All dials at maximum', values: { rpm: 7000, throttle: 1, speed: 120, slip: 90, grip: 0.15 } }]) {
            const ctx = new OfflineAudioContext(1, 24000, 24000);
            const engineBus = ctx.createGain(); const tireBus = ctx.createGain();
            engineBus.connect(ctx.destination); tireBus.connect(ctx.destination);
            const voice = mode === 'procedural' ? createProcedural(ctx, engineBus, tireBus)
              : createSampleVoice(ctx, engineBus, tireBus, buffers);
            voice.update(mapAudio(preset.values));
            const output = (await ctx.startRendering()).getChannelData(0);
            let peak = 0; let square = 0;
            for (const x of output) { peak = Math.max(peak, Math.abs(x)); square += x * x; }
            measurements.push({ mode, preset: preset.name, peak, rms: Math.sqrt(square / output.length) });
            voice.stop();
          }
          for (const speed of [0, 65]) {
            const ctx = new OfflineAudioContext(1, 24000, 24000);
            const engineBus = ctx.createGain(); engineBus.gain.value = 0;
            const tireBus = ctx.createGain(); engineBus.connect(ctx.destination); tireBus.connect(ctx.destination);
            const voice = mode === 'procedural' ? createProcedural(ctx, engineBus, tireBus)
              : createSampleVoice(ctx, engineBus, tireBus, buffers);
            voice.update(mapAudio({ speed, slip: 90, grip: 0.15 }));
            const output = (await ctx.startRendering()).getChannelData(0);
            let square = 0;
            for (const x of output) square += x * x;
            measurements.push({ mode, tireOnlySpeed: speed, rms: Math.sqrt(square / output.length) });
            voice.stop();
          }
        }
        return measurements;
      });
      for (const render of renders) {
        assert.ok(Number.isFinite(render.rms));
        if ('peak' in render) { assert.ok(render.peak < 1, JSON.stringify(render)); assert.ok(render.rms > 0.001); }
        if (render.tireOnlySpeed === 0) assert.equal(render.rms, 0);
        if (render.tireOnlySpeed === 65) assert.ok(render.rms > 0.001, JSON.stringify(render));
      }
      await page.locator('#mode').selectOption('procedural');
      await page.getByRole('button', { name: 'Sustained power drift', exact: true }).click();
      await page.screenshot({ path: artifact(`audio-lab-${name}-desktop.png`), fullPage: true });
      await page.setViewportSize({ width: 320, height: 740 });
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
      await page.screenshot({ path: artifact(`audio-lab-${name}-320.png`), fullPage: true });
      await page.goto(`${base}/`);
      await page.waitForFunction(() => window.__miniDrifters);
      assert.equal(await page.evaluate(() => !!window.__audioLab), false);
      assert.equal(await page.locator('a[href*="audio-lab"]').count(), 0);
      assert.deepEqual(errors, []);
      report.push({ browser: name, realtimeOutput,
        checks: realtimeOutput ? 'controls, presets, mode switching, start/stop, mute, pending-load cancellation, visibility, missing/corrupt samples, original game isolation, 320px layout'
          : 'controls, presets, bounded native startup failure and graph cleanup, native sample decoding/offline renders, original game isolation, 320px layout; real-time output lifecycle unavailable', renders });
      console.log(`${name}: ${realtimeOutput ? 'real-time lifecycle' : 'bounded no-device startup failure'}, sample decoding, offline renders and responsive checks passed`);
    } catch (error) {
      const state = await page?.evaluate(() => window.__audioLab?.snapshot()).catch(() => null);
      console.error(`${name} failure state: ${JSON.stringify({ state, errors, realtimeOutput })}`);
      await page?.screenshot({ path: artifact(`audio-lab-${name}-failure.png`), fullPage: true }).catch(() => {});
      throw error;
    } finally { await browser.close(); }
  }
  await writeFile(artifact('audio-lab-report.json'), JSON.stringify(report, null, 2) + '\n');
} finally { server.kill(); }
