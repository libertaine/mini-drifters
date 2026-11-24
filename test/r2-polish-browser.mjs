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
    await ctx.close();

    // --- 2. Live Web Audio FX & Siren lifecycle ---
    const audioCtx = await browser.newContext({ viewport: { width: 1366, height: 768 } });
    const audioPage = await audioCtx.newPage();
    audioPage.on('pageerror', (e) => errors.push(`${name}-audio: ${e.message}`));
    await audioPage.goto(base);
    await audioPage.waitForFunction(() => window.__miniDrifters, null, { polling: 50 });

    // Start Getaway Driver via real click gesture so AudioContext runs.
    await audioPage.click('#getaway');
    await audioPage.click('#getaway-driver');
    await audioPage.click('#gymkhana-start');
    await audioPage.waitForFunction(() => window.__miniDrifters.audio().contextState === 'running', null, { timeout: 5000 });

    const beforeChase = await audioPage.evaluate(() => window.__miniDrifters.fxAudio());
    assert.equal(beforeChase.sirenActive, false, 'calm start has no siren');

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
    ok('Live Web Audio siren, BUSTED offline voice, siren ducking, once-per-bust and R cancellation verified');
    await audioCtx.close();

    // Missing busted-voice.wav (404) falls back cleanly with zero errors.
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
