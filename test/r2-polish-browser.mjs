// Browser qualification checks for v0.8.0 R2 polish in Chromium and Firefox:
// - Getaway Driver hides the irrelevant score/combo HUD, tucks Sound/Radio top-right, shows the
//   45 mph speed-zone cue without overlapping #bust at 1024x600, 1366x768 and 1920x1080;
// - live outcome tracking colors #gym-medal, switching Attention <-> Pursuit disables width glide
//   for the transition frame, multi-state edge atmosphere updates and clears cleanly, and critical
//   falling bust risk keeps urgent red styling;
// - Ghost run, Low profile, Lost them and Busted results have distinct motorsport racing stripes;
// - Pause gives Resume primary visual hierarchy while keeping .options-open first in Tab order;
// - live Web Audio fires impacts, pursuit sirens, chase/stealth cues and outcome stingers while
//   obeying pause, mute, effects volume and circuit isolation;
// - reduced motion freezes title animation and disables HUD animations; zero errors or stray writes.
//   node test/r2-polish-browser.mjs [/path/to/playwright/index.mjs]
import assert from 'node:assert/strict';
import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname } from 'node:path';
import { pathToFileURL } from 'node:url';

const { chromium, firefox } = await import(process.argv[2] ? pathToFileURL(process.argv[2]) : 'playwright');
const root = new URL('../', import.meta.url);
const TYPES = { '.html': 'text/html', '.css': 'text/css', '.js': 'text/javascript', '.mjs': 'text/javascript', '.mp3': 'audio/mpeg', '.wav': 'audio/wav' };
const server = http.createServer(async (req, res) => {
  const path = new URL(req.url, 'http://localhost').pathname;
  const file = path === '/' ? 'index.html' : path.slice(1);
  if (!/^(index\.html|style\.css|src\/[\w-]+\.js|(?:audio-lab\/assets|radio)\/[\w/.-]+)$/.test(file) || file.includes('..')) {
    res.writeHead(404); res.end(); return;
  }
  try { const data = await readFile(new URL(file, root)); res.writeHead(200, { 'Content-Type': TYPES[extname(file)] ?? 'text/plain' }); res.end(data); }
  catch { res.writeHead(404); res.end(); }
});
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const base = `http://127.0.0.1:${server.address().port}/`;

const SIZES = [[1024, 600], [1366, 768], [1920, 1080]];

function mockedClockHarness(soundMode = 'off') {
  if (soundMode === 'off') localStorage.setItem('mini-drifters-sound', 'off');
  else localStorage.removeItem('mini-drifters-sound');
  window.__writes = [];
  const set = Storage.prototype.setItem;
  Storage.prototype.setItem = function (k, v) { window.__writes.push(k); return set.call(this, k, v); };
  window.requestAnimationFrame = (cb) => { window.__nextFrame = cb; return 1; };
  let now;
  window.__frames = (count = 2, dt = 1000 / 60) => {
    now ??= performance.now();
    for (let i = 0; i < count; i += 1) { now += dt; window.__nextFrame(now); }
  };
}

async function check(name, engine) {
  const browser = await engine.launch({ headless: true });
  const errors = [];
  const ok = (msg) => console.log(`${name}: ok - ${msg}`);
  try {
    // --- 1. Getaway Driver HUD polish, layout at 3 sizes, meter & edge states, results stripes ---
    const ctx = await browser.newContext({ viewport: { width: 1366, height: 768 } });
    await ctx.addInitScript(mockedClockHarness, 'off');
    const page = await ctx.newPage();
    page.on('pageerror', (e) => errors.push(`${name}: ${e.message}`));
    const frames = (n = 2) => page.evaluate((k) => window.__frames(k), n);

    await page.goto(base);
    await page.waitForFunction(() => window.__miniDrifters, null, { polling: 50 });
    await frames(4);

    // Enter Getaway Driver.
    await page.click('#getaway'); await frames(2);
    await page.click('#getaway-driver'); await frames(2);
    await page.click('#gymkhana-start'); await frames(4);

    // Score & combo hidden; Sound tucked top-right; speed-zone starts ok; track starts ghost.
    const hudInit = await page.evaluate(() => ({
      mission: document.body.dataset.mission,
      scoreVis: getComputedStyle(document.querySelector('#hud .score')).visibility,
      comboVis: getComputedStyle(document.querySelector('#combo')).visibility,
      soundTop: Math.round(document.querySelector('#sound').getBoundingClientRect().top),
      speedZone: document.querySelector('.gauges').dataset.speedZone,
      track: document.querySelector('#gym-medal').dataset.driverTrack,
    }));
    assert.equal(hudInit.mission, 'driver');
    assert.equal(hudInit.scoreVis, 'hidden');
    assert.equal(hudInit.comboVis, 'hidden');
    assert.equal(hudInit.soundTop, 16);
    assert.equal(hudInit.speedZone, 'ok');
    assert.equal(hudInit.track, 'ghost');

    // Speeding + watched states and non-overlap of .gauges vs #bust across all 3 viewport sizes.
    await page.evaluate(() => {
      const m = window.__miniDrifters;
      const g = m.game;
      const cop = g.challenge.police[1];
      const dx = Math.cos(cop.heading);
      const dy = Math.sin(cop.heading);
      g.car.x = cop.x + dx * 22; g.car.y = cop.y + dy * 22;
      g.car.heading = cop.heading; g.car.vx = dx * 24; g.car.vy = dy * 24;
      g.prev.x = g.car.x; g.prev.y = g.car.y; g.prev.heading = g.car.heading;
      g.challenge.attention = 0.55;
      g.state = 'racing';
      window.__frames(4);
    });
    const watchedState = await page.evaluate(() => ({
      speedZone: document.querySelector('.gauges').dataset.speedZone,
      alert: document.body.dataset.alert,
      track: document.querySelector('#gym-medal').dataset.driverTrack,
    }));
    assert.equal(watchedState.speedZone, 'watched-over');
    assert.equal(watchedState.alert, 'watched');
    assert.equal(watchedState.track, 'low-profile');

    for (const [w, h] of SIZES) {
      await page.setViewportSize({ width: w, height: h });
      await page.waitForFunction(([ww, hh]) => innerWidth === ww && innerHeight === hh, [w, h]);
      await frames(2);
      const layout = await page.evaluate(() => {
        const g = document.querySelector('.gauges').getBoundingClientRect();
        const b = document.querySelector('#bust').getBoundingClientRect();
        const n = document.querySelector('#nav').getBoundingClientRect();
        return {
          gaugesGap: b.left - g.right,
          navGap: n.left - b.right,
          inScreen: g.left >= 0 && b.bottom <= innerHeight + 1 && n.right <= innerWidth + 1,
        };
      });
      assert.ok(layout.gaugesGap >= 0, `gauges/bust clear at ${w}x${h} (gap ${layout.gaugesGap.toFixed(1)}px)`);
      assert.ok(layout.navGap >= 0, `bust/nav clear at ${w}x${h} (gap ${layout.navGap.toFixed(1)}px)`);
      assert.equal(layout.inScreen, true, `HUD inside ${w}x${h}`);
    }
    await page.setViewportSize({ width: 1366, height: 768 });
    await frames(2);
    ok('Getaway Driver decluttered HUD, 45 mph cue, and zero overlap at 1024x600 / 1366x768 / 1920x1080');

    // Mode switch Attention -> Pursuit toggles .no-glide on transition frame and clears next frame;
    // critical falling bust risk stays urgent red (not safe green).
    const pursuitChecks = await page.evaluate(() => {
      const m = window.__miniDrifters;
      const g = m.game;
      const run = g.challenge;
      run.attention = 0.9;
      const cop = run.police[1];
      const dx = Math.cos(cop.heading);
      const dy = Math.sin(cop.heading);
      g.car.x = cop.x + dx * 16; g.car.y = cop.y + dy * 16;
      g.car.vx = dx * 18; g.car.vy = dy * 18;
      g.prev.x = g.car.x; g.prev.y = g.car.y;
      let sawNoGlide = false;
      for (let i = 0; i < 60 && !run.pursuing; i += 1) {
        window.__frames(1);
        if (document.getElementById('bust').classList.contains('no-glide')) sawNoGlide = true;
      }
      window.__frames(2);
      const clearedNoGlide = !document.getElementById('bust').classList.contains('no-glide');
      const pursuitAlert = document.body.dataset.alert;
      const trackPursuit = document.getElementById('gym-medal').dataset.driverTrack;
      // Critical falling meter keeps urgent red/hatched background (not green): pull away so meter genuinely drains.
      run.meter = 0.78;
      run.level = 'critical';
      for (const u of run.police) { if (u.mode === 'pursue') { u.x = g.car.x - 70; u.y = g.car.y; } }
      window.__frames(1);
      window.__frames(2);
      const critStyle = getComputedStyle(document.querySelector('.bust-fill'));
      const critBg = critStyle.backgroundImage !== 'none' ? critStyle.backgroundImage : critStyle.backgroundColor;
      // Trigger escape pulse: out of sight and past loseGap, advance through real escape transition.
      run.lose = 0.995;
      run.meter = 0;
      for (const u of run.police) { u.x = g.car.x - 120; u.y = g.car.y - 120; }
      window.__frames(4);
      const escapedAlert = document.body.dataset.alert;
      return { sawNoGlide, clearedNoGlide, pursuitAlert, trackPursuit, critBg, escapedAlert };
    });
    assert.equal(pursuitChecks.sawNoGlide, true, 'mode switch disables bar glide for transition frame');
    assert.equal(pursuitChecks.clearedNoGlide, true, 'bar glide re-enables on subsequent frame');
    assert.equal(pursuitChecks.pursuitAlert, 'pursuit');
    assert.equal(pursuitChecks.trackPursuit, 'pursuit');
    assert.match(pursuitChecks.critBg, /gradient|255,\s*90,\s*79/, 'critical falling bar stays urgent red');
    assert.equal(pursuitChecks.escapedAlert, 'escaped', 'losing police triggers emerald escape pulse');
    ok('Attention->Pursuit anti-ghosting, critical falling bar, pursuit/escaped edge states verified');

    // Pause screen: Resume has burnt-orange accent, DOM order still starts with .options-open.
    await page.keyboard.press('KeyP'); await frames(2);
    const pauseInfo = await page.evaluate(() => {
      const btns = [...document.querySelectorAll('#paused .actions button')];
      return {
        firstClass: btns[0]?.className ?? '',
        resumeBg: getComputedStyle(document.getElementById('resume')).backgroundColor,
      };
    });
    assert.match(pauseInfo.firstClass, /options-open/);
    assert.equal(pauseInfo.resumeBg, 'rgb(207, 74, 27)', 'Resume button carries primary burnt-orange fill');
    await page.keyboard.press('KeyP'); await frames(2);
    ok('Pause menu elevates Resume visually while preserving Tab order');

    // Distinct motorsport top stripes on results for Ghost run, Low profile, Lost them & Failed.
    const stripes = await page.evaluate(() => {
      const sheet = document.querySelector('#gymkhana-results .sheet');
      const res = document.getElementById('gymkhana-results');
      res.hidden = false;
      const sample = (outcome, driver) => {
        res.dataset.outcome = outcome;
        res.dataset.driver = driver;
        return getComputedStyle(sheet, '::before').backgroundImage;
      };
      const out = {
        ghost: sample('complete', 'ghost'),
        low: sample('complete', 'low-profile'),
        lost: sample('complete', 'lost-them'),
        failed: sample('failed', ''),
      };
      res.hidden = true;
      return out;
    });
    assert.equal(new Set(Object.values(stripes)).size, 4, 'every mission outcome gets a distinct livery stripe');
    ok('Distinct results racing stripes verified for Ghost run, Low profile, Lost them and Failed');

    // Circuit drift sweet-spot highlight & clean mission teardown.
    await page.keyboard.press('KeyP'); await frames(2);
    await page.click('#paused .return-title'); await frames(2);
    await page.click('#tracks-open'); await frames(2);
    await page.click('#start'); await frames(4);
    const circuitCheck = await page.evaluate(() => {
      const m = window.__miniDrifters;
      const cleanMission = document.body.dataset.mission ?? '';
      const cleanAlert = document.body.dataset.alert ?? '';
      const cleanSpeedZone = document.querySelector('.gauges').dataset.speedZone ?? '';
      m.game.state = 'racing';
      const h = m.game.car.heading;
      m.game.car.vx = Math.cos(h + 0.62) * 24;
      m.game.car.vy = Math.sin(h + 0.62) * 24;
      window.__frames(2);
      const sweet = document.querySelector('.angle').dataset.driftZone;
      const fx = m.effects();
      return { cleanMission, cleanAlert, cleanSpeedZone, sweet, fx };
    });
    assert.equal(circuitCheck.cleanMission, '');
    assert.equal(circuitCheck.cleanAlert, '');
    assert.equal(circuitCheck.cleanSpeedZone, '');
    assert.equal(circuitCheck.sweet, 'sweet');
    assert.ok(circuitCheck.fx.smoke <= circuitCheck.fx.smokeCapacity);
    assert.ok(circuitCheck.fx.skids <= circuitCheck.fx.skidCapacity);
    ok('Circuit run clears driver HUD state and highlights 25-50° drift sweet spot');

    // No unexpected storage writes occurred during inspection.
    const writes = await page.evaluate(() => window.__writes.filter((k) => k !== 'mini-drifters-sound'));
    assert.deepEqual(writes, [], `no stray storage writes (${writes.join(', ')})`);
    // --- 1f. R2b Tracks & Gymkhana UI polish: live SVG track preview, balanced 2x2 Gymkhana grid,
    //         combo multiplier heat/low-grace states, and tiered medal/new-best racing stripes ---
    await page.keyboard.press('KeyP'); await frames(2);
    await page.locator('#paused .return-title').click(); await frames(3);
    await page.click('#tracks-open'); await frames(3);
    const previewChecks = [];
    for (const id of ['original', 'switchback', 'dockyard', 'runway-27', 'redline-mesa', 'headland-run', 'nightshift-viaduct']) {
      await page.locator(`#tracks input[value="${id}"]`).click({ force: true });
      await frames(2);
      previewChecks.push(await page.evaluate(() => ({
        path: document.getElementById('track-preview-path')?.getAttribute('d') ?? '',
        blurb: document.getElementById('track-blurb')?.textContent ?? '',
        labelLines: document.getElementById('track-label')?.getClientRects().length ?? 0,
      })));
    }
    assert.ok(previewChecks.every((c) => c.path.startsWith('M') && c.blurb.length > 10), 'every circuit renders an SVG silhouette and blurb');
    assert.equal(new Set(previewChecks.map((c) => c.path)).size, 7, 'all seven circuit silhouettes are distinct');
    await page.click('#tracks-back'); await frames(2);

    // Gymkhana menu uses a balanced 2-column grid for its 4 challenges.
    await page.click('#gymkhana'); await frames(3);
    const gymGrid = await page.evaluate(() => {
      const cards = [...document.querySelectorAll('#challenges .station')].map((el) => el.getBoundingClientRect());
      const rows = new Set(cards.map((r) => Math.round(r.top)));
      return { count: cards.length, rows: rows.size };
    });
    assert.deepEqual(gymGrid, { count: 4, rows: 2 }, '4 Gymkhana challenges form a balanced 2x2 grid');
    await page.click('#gymkhana-back'); await frames(2);

    // Combo multiplier heat (data-mult="2" / "3") & low-grace state + New Best circuit stripe.
    await page.click('#tracks-open'); await frames(2);
    await page.click('#start'); await frames(3);
    const comboHeat = await page.evaluate(() => {
      const g = window.__miniDrifters.game;
      g.state = 'racing';
      g.scoring.combo = { points: 420, tier: 3, grace: 0.3, tierGround: 0, linkGround: 0, stallTimer: 0, stallGround: 0, side: 1 };
      window.__frames(2);
      const el = document.getElementById('combo');
      return { state: el.dataset.state, mult: el.dataset.mult, lowGrace: el.dataset.lowGrace };
    });
    assert.deepEqual(comboHeat, { state: 'active', mult: '3', lowGrace: 'true' }, 'x3 combo heat and low-grace warning activate cleanly');

    // Gymkhana Gold medal racing stripe vs Silver stripe on non-urban results.
    await page.keyboard.press('KeyP'); await frames(2);
    await page.locator('#paused .return-title').click(); await frames(3);
    await page.click('#gymkhana'); await frames(2);
    await page.click('#gymkhana-start'); await frames(3);
    const gymMedalStripe = await page.evaluate(() => {
      const g = window.__miniDrifters.game;
      g.state = 'finished';
      g.challenge.phase = 'complete';
      g.challenge.result = { value: 7.2, time: 7.2, penalty: 0, total: 7.2, cones: 0, entrySpeed: 22, depth: 20, peakSlip: 0.6, minSpeed: 8, technique: 'slide' };
      window.__frames(2);
      const res = document.getElementById('gymkhana-results');
      const gold = res.dataset.medal;
      g.challenge.phase = 'running'; g.state = 'racing'; window.__frames(1);
      g.challenge.result = { value: 8.0, time: 8.0, penalty: 0, total: 8.0, cones: 0, entrySpeed: 22, depth: 20, peakSlip: 0.6, minSpeed: 8, technique: 'slide' };
      g.challenge.phase = 'complete'; g.state = 'finished'; window.__frames(2);
      const silver = res.dataset.medal;
      return { gold, silver };
    });
    assert.deepEqual(gymMedalStripe, { gold: 'gold', silver: 'silver' }, 'Gymkhana results expose tiered medal stripes');
    ok('R2b Tracks SVG preview, 2x2 Gymkhana grid, combo heat/low-grace and medal stripes verified');

    await ctx.close();

    // --- 2. Live Web Audio FX & Siren lifecycle ---
    const audioCtx = await browser.newContext({ viewport: { width: 1366, height: 768 } });
    const audioPage = await audioCtx.newPage();
    audioPage.on('pageerror', (e) => errors.push(`${name}-audio: ${e.message}`));
    await audioPage.goto(base);
    await audioPage.waitForFunction(() => window.__miniDrifters, null, { polling: 50 });

    // Start Getaway Driver via real click gesture so AudioContext runs.
    // Linux Firefox in headless CI has no audio output device, so AudioContext.resume()
    // times out cleanly and GameAudio reports 'Sound Unavailable' (matching
    // getaway-showmanship-browser, gameplay-audio-browser and wheelspin-browser).
    await audioPage.click('#getaway');
    await audioPage.click('#getaway-driver');
    await audioPage.click('#gymkhana-start');
    await audioPage.waitForFunction(() => {
      const a = window.__miniDrifters.audio();
      return a.contextState === 'running' || !!a.failure;
    }, null, { timeout: 15000, polling: 50 });
    const audioFailure = await audioPage.evaluate(() => window.__miniDrifters.audio().failure);
    const realtimeAudio = !audioFailure;
    if (!realtimeAudio) {
      assert.equal(name, 'firefox', 'only device-less Linux Firefox may report audio startup failure');
      assert.equal(process.platform, 'linux', 'only device-less Linux Firefox may report audio startup failure');
      assert.match(audioFailure, /did not start/);
      assert.equal(await audioPage.locator('#sound').textContent(), 'Sound Unavailable');
    }

    // OfflineAudioContext verification runs in every browser (including device-less Linux Firefox):
    // proves busted-voice.wav decodes in the browser and every R2/R2b voice renders bounded signal.
    const offlineAudio = await audioPage.evaluate(async () => {
      const { playBustedVoice, playCurb, playCue } = await import('/src/getaway-sfx.js');
      const raw = await (await fetch('/audio-lab/assets/busted-voice.wav')).arrayBuffer();
      const dec = new OfflineAudioContext(1, 24000, 24000);
      const voiceBuf = await dec.decodeAudioData(raw.slice(0));
      async function render(fn, seconds = 1.1) {
        const ctx = new OfflineAudioContext(1, Math.round(48000 * seconds), 48000);
        const bus = ctx.createGain();
        bus.gain.value = 1;
        bus.connect(ctx.destination);
        const voice = fn(ctx, bus);
        const ch = (await ctx.startRendering()).getChannelData(0);
        let sum = 0, peak = 0;
        for (let i = 0; i < ch.length; i += 1) {
          sum += ch[i] * ch[i];
          const a = Math.abs(ch[i]);
          if (a > peak) peak = a;
        }
        return { rms: Math.sqrt(sum / ch.length), peak, spoken: !!voice?.spoken };
      }
      return {
        duration: voiceBuf.duration,
        bustedSpoken: await render((c, d) => playBustedVoice(c, d, voiceBuf), 1.2),
        bustedFallback: await render((c, d) => playBustedVoice(c, d, null), 0.9),
        curb: await render((c, d) => playCurb(c, d, 0.75), 0.25),
        turnZone: await render((c, d) => playCue(c, d, 'turn-zone'), 0.4),
        gold: await render((c, d) => playCue(c, d, 'outcome-gold'), 0.9),
      };
    });
    assert.ok(offlineAudio.duration >= 0.6 && offlineAudio.duration <= 1.2, `busted-voice.wav duration ${offlineAudio.duration}`);
    assert.equal(offlineAudio.bustedSpoken.spoken, true);
    assert.equal(offlineAudio.bustedFallback.spoken, false);
    for (const [k, sig] of Object.entries(offlineAudio)) {
      if (k === 'duration') continue;
      assert.ok(sig.rms > 0.001 && sig.peak <= 1.0, `offline ${k} rendered clean signal (rms=${sig.rms}, peak=${sig.peak})`);
    }

    const beforeChase = await audioPage.evaluate(() => window.__miniDrifters.fxAudio());
    assert.equal(beforeChase.sirenActive, false, 'calm start has no siren');

    if (realtimeAudio) {
      // 1) Steer into a roadside building block to verify real velocity-scaled impact SFX.
      await audioPage.evaluate(() => {
        const g = window.__miniDrifters.game;
        const wall = g.challengeDef.geometry.city.colliders[0];
        g.car.x = (wall.minX + wall.maxX) / 2;
        g.car.y = wall.maxY + 4;
        g.car.heading = -Math.PI / 2;
        g.car.vx = 0;
        g.car.vy = -24;
        g.prev.x = g.car.x; g.prev.y = g.car.y;
        g.state = 'racing';
      });
      await audioPage.waitForFunction(() => window.__miniDrifters.fxAudio().impacts >= 1, null, { timeout: 3000 });

      // 2) Trigger pursuit, keep cop at medium range (no bust during test), verify siren & cues obey pause/mute.
      await audioPage.evaluate(() => {
        const g = window.__miniDrifters.game;
        const cop = g.challenge.police[1];
        const dx = Math.cos(cop.heading);
        const dy = Math.sin(cop.heading);
        g.car.x = cop.x + dx * 28; g.car.y = cop.y + dy * 28;
        g.car.vx = dx * 18; g.car.vy = dy * 18;
        g.prev.x = g.car.x; g.prev.y = g.car.y;
        g.challenge.attention = 0.95;
        g.challenge.meter = 0;
      });
      await audioPage.waitForFunction(() => window.__miniDrifters.fxAudio().sirenActive === true, null, { timeout: 4000 });
      const liveFx = await audioPage.evaluate(() => window.__miniDrifters.fxAudio());
      assert.equal(liveFx.sirenActive, true);
      assert.ok(liveFx.cues >= 1, `chase cue played (${liveFx.cues})`);
      assert.ok(liveFx.impacts >= 1, `impact thump played (${liveFx.impacts})`);

      await audioPage.keyboard.press('KeyP');
      await audioPage.waitForFunction(() => window.__miniDrifters.fxAudio().sirenActive === false, null, { timeout: 2000 });
      await audioPage.keyboard.press('KeyP');
      await audioPage.waitForFunction(() => window.__miniDrifters.fxAudio().sirenActive === true, null, { timeout: 2000 });
      await audioPage.click('#sound'); // mute
      await audioPage.waitForFunction(() => window.__miniDrifters.fxAudio().sirenActive === false, null, { timeout: 2000 });
      await audioPage.click('#sound'); // unmute
      await audioPage.waitForFunction(() => window.__miniDrifters.fxAudio().sirenActive === true, null, { timeout: 2000 });

      // 3) Offline BUSTED voice asset decodes in Getaway, triggers once on actual bust with siren ducking,
      //    and cancels immediately on retry (R).
      await audioPage.waitForFunction(() => window.__miniDrifters.fxAudio().bustedState === 'ready', null, { timeout: 4000 });
      await audioPage.evaluate(() => {
        const g = window.__miniDrifters.game;
        const cop = g.challenge.police.find((u) => u.mode === 'pursue') ?? g.challenge.police[1];
        cop.mode = 'pursue';
        cop.lights = true;
        cop.x = g.car.x;
        cop.y = g.car.y;
        cop.speed = 0;
        g.car.vx = 0; g.car.vy = 0;
        g.challenge.pursuing = true;
        g.challenge.meter = 0.995;
      });
      await audioPage.waitForFunction(() => window.__miniDrifters.game.state === 'finished', null, { timeout: 3000 });
      const bustedFx = await audioPage.evaluate(() => window.__miniDrifters.fxAudio());
      assert.equal(bustedFx.bustedPlayed, 1, 'BUSTED triggers once on police bust');
      assert.equal(bustedFx.bustedSpoken, 1, 'offline spoken busted-voice.wav played');
      assert.equal(bustedFx.sirenDucked, true, 'siren ducks underneath the BUSTED voice');
      // Stays strictly once over subsequent frames.
      await audioPage.waitForTimeout(150);
      assert.equal((await audioPage.evaluate(() => window.__miniDrifters.fxAudio().bustedPlayed)), 1);
      // Retry (R) cancels remaining playback and ducked siren immediately.
      await audioPage.keyboard.press('KeyR');
      await audioPage.waitForFunction(() => window.__miniDrifters.game.state === 'ready', null, { timeout: 2000 });
      const afterRetry = await audioPage.evaluate(() => window.__miniDrifters.fxAudio());
      assert.equal(afterRetry.sirenDucked, false, 'R retry cancels ducked siren immediately');

      // Non-bust failure (out of time) never triggers the BUSTED voice.
      await audioPage.evaluate(() => {
        const g = window.__miniDrifters.game;
        g.state = 'racing';
        g.challenge.time = g.challengeDef.timeLimit - 0.02;
      });
      await audioPage.waitForFunction(() => window.__miniDrifters.game.state === 'finished', null, { timeout: 2000 });
      assert.equal((await audioPage.evaluate(() => window.__miniDrifters.fxAudio().bustedPlayed)), 1, 'out of time does not shout BUSTED');
      // 4) Live Web Audio Tracks & Gymkhana cues: apex curb rumble, Turn Zone lock, Slalom weave & Gold fanfare.
      await audioPage.locator('#gymkhana-results .return-title').click();
      await audioPage.waitForFunction(() => window.__miniDrifters.game.state === 'menu', null, { timeout: 2000 });
      await audioPage.click('#tracks-open');
      await audioPage.click('#start');
      await audioPage.waitForFunction(() => window.__miniDrifters.game.state === 'ready' && window.__miniDrifters.audio().contextState === 'running' && window.__miniDrifters.audio().mode === 'live', null, { timeout: 4000 });
      const baseSources = await audioPage.evaluate(() => window.__miniDrifters.audio().sourceCount);
      await audioPage.evaluate(() => {
        const g = window.__miniDrifters.game;
        const p = g.track.points.find((pt) => Math.abs(pt.curvature) > g.track.curbCurvature);
        g.state = 'racing';
        g.car.x = p.x - p.ty * (g.track.halfWidth + 1);
        g.car.y = p.y + p.tx * (g.track.halfWidth + 1);
        g.car.heading = Math.atan2(p.ty, p.tx);
        g.car.vx = p.tx * 24;
        g.car.vy = p.ty * 24;
        g.car.speed = 24;
        g.car.surface = 'curb';
        g.prev.x = g.car.x; g.prev.y = g.car.y;
        g.trackInfo = window.__miniDrifters.projectOnTrack(g.track, g.car.x, g.car.y);
        g.trackS = g.trackInfo.s;
      });
      await audioPage.waitForFunction(() => window.__miniDrifters.fxAudio().curbs >= 1, null, { timeout: 3000 });
      assert.equal(await audioPage.evaluate(() => window.__miniDrifters.audio().sourceCount), baseSources, 'curb rumble adds zero persistent sources');

      // Precision 180 Turn Zone chime & Gold finish fanfare.
      await audioPage.keyboard.press('KeyP');
      await audioPage.locator('#paused .return-title').click();
      await audioPage.click('#gymkhana');
      await audioPage.click('#gymkhana-start');
      await audioPage.waitForFunction(() => window.__miniDrifters.game.state === 'ready' && window.__miniDrifters.audio().contextState === 'running' && window.__miniDrifters.audio().mode === 'live', null, { timeout: 4000 });
      await audioPage.evaluate(() => {
        const g = window.__miniDrifters.game;
        g.state = 'racing';
        g.challenge.reached = true;
      });
      await audioPage.waitForFunction(() => window.__miniDrifters.fxAudio().lastCue === 'turn-zone', null, { timeout: 2000 });
      await audioPage.evaluate(() => {
        const g = window.__miniDrifters.game;
        g.challenge.phase = 'complete';
        g.challenge.result = { value: 7.1, time: 7.1, penalty: 0, total: 7.1, cones: 0, entrySpeed: 22, depth: 20, peakSlip: 0.6, minSpeed: 8, technique: 'slide' };
        g.state = 'finished';
      });
      await audioPage.waitForFunction(() => window.__miniDrifters.fxAudio().lastCue === 'outcome-gold', null, { timeout: 2000 });
      ok('Live Web Audio siren, BUSTED offline voice, siren ducking, curb rumble, Turn Zone & Gold fanfare verified');
    } else {
      // Device-less Linux Firefox: verify bust, retry and silent fallback stay completely error-free.
      await audioPage.evaluate(() => {
        const g = window.__miniDrifters.game;
        const cop = g.challenge.police[1];
        cop.mode = 'pursue'; cop.lights = true; cop.x = g.car.x; cop.y = g.car.y; cop.speed = 0;
        g.car.vx = 0; g.car.vy = 0;
        g.challenge.pursuing = true;
        g.challenge.meter = 0.995;
        g.state = 'racing';
      });
      await audioPage.waitForFunction(() => window.__miniDrifters.game.state === 'finished', null, { timeout: 3000 });
      await audioPage.keyboard.press('KeyR');
      await audioPage.waitForFunction(() => window.__miniDrifters.game.state === 'ready', null, { timeout: 2000 });
      const silentFx = await audioPage.evaluate(() => window.__miniDrifters.fxAudio());
      assert.equal(silentFx.sirenActive, false);
      assert.equal(silentFx.bustedPlayed, 0);
      ok('Device-less Linux Firefox reported Sound Unavailable cleanly, passed OfflineAudioContext voice/cue renders, and completed bust/retry without errors');
    }
    await audioCtx.close();

    // Missing busted-voice.wav (404) falls back cleanly with zero errors (real-time audio contexts).
    if (realtimeAudio) {
      const fbCtx = await browser.newContext({ viewport: { width: 1366, height: 768 } });
      const fbPage = await fbCtx.newPage();
      fbPage.on('pageerror', (e) => errors.push(`${name}-fb: ${e.message}`));
      await fbPage.route('**/busted-voice.wav', (route) => route.fulfill({ status: 404, body: 'missing' }));
      await fbPage.goto(base);
      await fbPage.waitForFunction(() => window.__miniDrifters, null, { polling: 50 });
      await fbPage.click('#getaway');
      await fbPage.click('#getaway-driver');
      await fbPage.click('#gymkhana-start');
      await fbPage.waitForFunction(() => window.__miniDrifters.fxAudio().bustedState === 'unavailable', null, { timeout: 4000 });
      await fbPage.evaluate(() => {
        const g = window.__miniDrifters.game;
        const cop = g.challenge.police[1];
        cop.mode = 'pursue'; cop.lights = true; cop.x = g.car.x; cop.y = g.car.y; cop.speed = 0;
        g.car.vx = 0; g.car.vy = 0;
        g.challenge.pursuing = true;
        g.challenge.meter = 0.995;
        g.state = 'racing';
      });
      await fbPage.waitForFunction(() => window.__miniDrifters.game.state === 'finished', null, { timeout: 3000 });
      const fbFx = await fbPage.evaluate(() => window.__miniDrifters.fxAudio());
      assert.equal(fbFx.bustedPlayed, 1);
      assert.equal(fbFx.bustedSpoken, 0);
      assert.equal(fbFx.bustedFallback, 1, 'missing voice falls back cleanly to synthesized sting');
      ok('Unavailable busted-voice.wav falls back cleanly without breaking gameplay or audio');
      await fbCtx.close();
    }

    // --- 3. Reduced motion compliance ---
    const rmCtx = await browser.newContext({ viewport: { width: 1366, height: 768 }, reducedMotion: 'reduce' });
    await rmCtx.addInitScript(mockedClockHarness, 'off');
    const rmPage = await rmCtx.newPage();
    rmPage.on('pageerror', (e) => errors.push(`${name}-rm: ${e.message}`));
    await rmPage.goto(base);
    await rmPage.waitForFunction(() => window.__miniDrifters, null, { polling: 50 });
    await rmPage.evaluate(() => window.__frames(10));
    const a = await rmPage.evaluate(() => document.getElementById('view').toDataURL());
    await rmPage.evaluate(() => window.__frames(30));
    const b = await rmPage.evaluate(() => document.getElementById('view').toDataURL());
    assert.equal(a, b, 'title canvas remains pixel-identical under reducedMotion');

    await rmPage.click('#getaway'); await rmPage.evaluate(() => window.__frames(2));
    await rmPage.click('#getaway-driver'); await rmPage.evaluate(() => window.__frames(2));
    await rmPage.click('#gymkhana-start'); await rmPage.evaluate(() => window.__frames(4));
    const rmAnim = await rmPage.evaluate(() => {
      document.body.dataset.alert = 'pursuit';
      document.body.dataset.bust = 'critical';
      const banner = document.getElementById('banner');
      banner.hidden = false;
      banner.dataset.pop = 'a';
      return {
        vignette: getComputedStyle(document.getElementById('bust-vignette')).animationName,
        banner: getComputedStyle(banner).animationName,
      };
    });
    assert.equal(rmAnim.vignette, 'none');
    assert.equal(rmAnim.banner, 'none');
    ok('Reduced motion keeps title still and disables pursuit/banner CSS animations');
    await rmCtx.close();

    assert.deepEqual(errors, [], `zero page errors (${errors.join('; ')})`);
  } finally {
    await browser.close();
  }
}

try {
  await check('chromium', chromium);
  await check('firefox', firefox);
  console.log('r2-polish-browser: all checks passed');
} finally {
  server.close();
}
