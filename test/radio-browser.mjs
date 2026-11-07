// The radio in real browsers: real keys, real clicks and real Web Audio, served the same
// way as on GitHub Pages. It measures the output level, which proves signal or silence
// reached the destination. It can't tell whether anything sounds good, and nobody
// listened here.
//   node test/radio-browser.mjs [/path/to/playwright/index.mjs]
// By default it serves what gets deployed, under /mini-drifters/. To check a deployed site:
//   TEST_URL=https://libertaine.github.io/mini-drifters/ npm run test:radio:browser
import assert from 'node:assert/strict';
import http from 'node:http';
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { extname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { RADIO_FILES, STATIONS } from '../src/radio-stations.js';

const { chromium, firefox } = await import(process.argv[2] ? pathToFileURL(process.argv[2]) : 'playwright');
const root = new URL('../', import.meta.url);
const PUBLIC_URL = process.env.TEST_URL;
const artifact = (name) => fileURLToPath(new URL(`artifacts/${PUBLIC_URL ? 'public-' : ''}radio-${name}`, root));
await mkdir(new URL('artifacts/', root), { recursive: true });

const SILENCE = 0.0005;
const siteFiles = ['index.html', 'style.css', 'audio-lab/assets/tire-foley.mp3', 'audio-lab/assets/ATTRIBUTION.md',
  ...['idle', 'mid', 'load', 'high'].map((key) => `audio-lab/assets/coyote-local/${key}.wav`), ...RADIO_FILES,
  ...(await readdir(new URL('src/', root))).map((name) => `src/${name}`)];
const types = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mp3': 'audio/mpeg', '.wav': 'audio/wav', '.md': 'text/plain; charset=utf-8' };
const server = PUBLIC_URL ? null : http.createServer(async (req, res) => {
  const path = new URL(req.url, 'http://localhost').pathname;
  const file = path === '/mini-drifters/' ? 'index.html' : path.replace('/mini-drifters/', '');
  if (!siteFiles.includes(file)) { res.writeHead(404); res.end('Not found'); return; }
  res.writeHead(200, { 'Content-Type': types[extname(file)] });
  res.end(await readFile(new URL(file, root)));
});
if (server) await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const BASE = PUBLIC_URL ?? `http://127.0.0.1:${server.address().port}/mini-drifters/`;

// Taps whatever reaches the destination and counts contexts. It observes only.
const instrument = () => {
  const native = window.AudioContext;
  const created = [];
  const connect = AudioNode.prototype.connect;
  AudioNode.prototype.connect = function patched(target, ...rest) {
    if (target instanceof AudioDestinationNode) {
      if (!this.context.__analyser) {
        this.context.__analyser = this.context.createAnalyser();
        this.context.__analyser.fftSize = 2048;
      }
      connect.call(this, this.context.__analyser);
    }
    return connect.call(this, target, ...rest);
  };
  window.AudioContext = class extends native {
    constructor(...args) { super(...args); created.push(this); }
  };
  window.__tap = {
    get contexts() { return created.length; },
    states: () => created.map((c) => c.state),
    peak: 0,
    level() {
      const ctx = created.at(-1);
      if (!ctx?.__analyser || ctx.state !== 'running') return 0;
      const data = new Float32Array(ctx.__analyser.fftSize);
      ctx.__analyser.getFloatTimeDomainData(data);
      let sum = 0;
      for (const x of data) {
        sum += x * x;
        window.__tap.peak = Math.max(window.__tap.peak, Math.abs(x));
      }
      return Math.sqrt(sum / data.length);
    },
  };
};

const settings = (station, musicVolume = 70, effectsVolume = 100) => ({ station, musicVolume, effectsVolume });

async function open(browser, { saved, muted, before } = {}) {
  const context = await browser.newContext({ viewport: { width: 1366, height: 768 } });
  const page = await context.newPage();
  const errors = [];
  const requests = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('request', (r) => requests.push(new URL(r.url()).pathname));
  await page.addInitScript(instrument);
  if (saved || muted) {
    await page.addInitScript(([s, m]) => {
      if (sessionStorage.getItem('__seeded')) return;
      sessionStorage.setItem('__seeded', '1');
      if (s) localStorage.setItem('mini-drifters-audio', s);
      if (m) localStorage.setItem('mini-drifters-sound', 'off');
    }, [saved ? JSON.stringify(saved) : null, muted]);
  }
  await before?.(page);
  await page.goto(BASE);
  await page.waitForFunction(() => window.__miniDrifters);
  const helpers = {
    page, context, errors, requests,
    sound: () => page.evaluate(() => window.__miniDrifters.audio()),
    game: () => page.evaluate(() => {
      const { game: g, input } = window.__miniDrifters;
      return { state: g.state, paused: g.paused, ticks: g.ticks, speed: g.car.speed, input: { ...input } };
    }),
    tap: () => page.evaluate(() => ({ contexts: window.__tap.contexts, states: window.__tap.states() })),
    // The peak of several readings, because one window can fall in a quiet moment.
    level: (ms = 350) => page.evaluate(async (wait) => {
      let peak = 0;
      const end = performance.now() + wait;
      while (performance.now() < end) {
        peak = Math.max(peak, window.__tap.level());
        await new Promise((r) => setTimeout(r, 20));
      }
      return peak;
    }, ms),
    status: () => page.locator('#radio-status').textContent(),
    playing: (id) => page.waitForFunction((want) => {
      const { radio } = window.__miniDrifters.audio();
      return radio.status === 'playing' && radio.station === want && radio.active === 1;
    }, id, { timeout: 15000 }),
    contextIs: (state) => page.waitForFunction((want) => window.__tap.states()[0] === want, state, { timeout: 5000 }),
    station: (name) => page.locator('.station', { hasText: name }).click(),
    openOptions: () => page.locator('.options-open:visible').click(),
    closeOptions: () => page.keyboard.press('Escape'),
    setVolume: (id, value) => page.locator(`#${id}`).fill(String(value)),
    done: () => { assert.deepEqual(errors, [], 'no page errors'); return context.close(); },
  };
  return helpers;
}

// Linux Firefox with no output device: resume never settles, so the game reports the
// bounded failure rather than playing. Everywhere else this returns true.
async function realtimeOutput(t, browserName) {
  await t.page.waitForFunction(() => {
    const a = window.__miniDrifters.audio();
    return a.contextState === 'running' || a.failure;
  }, null, { timeout: 15000 });
  const s = await t.sound();
  if (!s.failure) return true;
  assert.equal(browserName, 'firefox');
  assert.equal(process.platform, 'linux');
  assert.match(s.failure, /did not start/);
  return false;
}

async function run(browser, browserName) {
  const steps = [];
  const step = (label) => { steps.push(label); console.log(`  ok: ${label}`); };
  const version = browser.version();
  const result = { browser: browserName, version, steps, realtime: true };

  // --- Autoplay, the defaults, and every station ----------------------------------
  {
    const t = await open(browser);
    const { page } = t;
    await page.waitForTimeout(200);
    assert.equal((await t.tap()).contexts, 0);
    assert.equal((await t.sound()).station, 'off');
    step('a first visit starts with the radio off and creates no audio context');

    await page.keyboard.press('KeyO');
    assert.ok(await page.locator('#options').isVisible());
    assert.equal(await page.locator('#menu').isVisible(), false);
    assert.deepEqual(await page.locator('.station').allTextContents(), STATIONS.map((s) => s.name));
    assert.equal(await page.locator('input[name=station]:checked').inputValue(), 'off');
    assert.equal(await page.inputValue('#music-volume'), '70');
    assert.equal(await page.inputValue('#effects-volume'), '100');
    assert.equal((await t.tap()).contexts, 0, 'opening Options with the radio off makes nothing');
    await page.screenshot({ path: artifact(`${browserName}-options.png`) });
    step('Options lists the stations from the data, with the default settings');

    await t.station('Garage Rock');
    assert.equal((await t.tap()).contexts, 1);
    result.realtime = await realtimeOutput(t, browserName);
    if (!result.realtime) {
      // Everything that doesn't need output still has to work.
      assert.equal(await page.locator('#sound').textContent(), 'Sound Unavailable');
      await t.closeOptions();
      assert.equal(await page.evaluate(() => JSON.parse(localStorage.getItem('mini-drifters-audio')).station), 'garage-rock');
      await page.keyboard.press('Enter');
      await page.keyboard.down('ArrowUp');
      await page.waitForTimeout(500);
      await page.keyboard.up('ArrowUp');
      assert.ok((await t.game()).speed > 2);
      step('no output device: reported as unavailable, the choice is kept and the game drives');
      await t.done();
      return { ...result, passed: true };
    }
    for (const { id, name, tracks } of STATIONS.filter((s) => s.tracks.length)) {
      t.requests.length = 0;
      await t.station(name);
      await t.playing(id);
      await page.waitForTimeout(700);
      const level = await t.level();
      assert.ok(level > SILENCE, `${name} level ${level}`);
      const asked = t.requests.filter((path) => path.includes('/radio/'));
      if (asked.length) assert.deepEqual(asked, [`/mini-drifters/${tracks[0].file}`]);
      assert.equal((await t.sound()).radio.track, tracks[0].id);
      assert.match(await page.locator('#radio-note').textContent(), /Provisional built-in music/);
      step(`${name} plays its own track on the title screen (level ${level.toFixed(4)})`);
    }

    // Repeated switching, by click and by the N key.
    await t.closeOptions();
    for (let i = 0; i < 20; i++) {
      await page.keyboard.press('KeyN');
      if (i % 4 === 0) await page.waitForTimeout(90);
    }
    await page.waitForFunction(() => window.__miniDrifters.audio().radio.status !== 'loading');
    await page.waitForTimeout(800);
    let s = await t.sound();
    assert.ok(s.radio.active <= 1, `${s.radio.active} tracks after rapid switching`);
    assert.equal((await t.tap()).contexts, 1);
    await page.keyboard.press('KeyO');
    await t.station('Synth FM');
    await t.playing('synth-fm');
    step('twenty quick changes leave one context and at most one track');

    // Radio Off on a quiet screen: the music goes and the context rests.
    await t.station('Radio Off');
    await t.contextIs('suspended');
    assert.ok(await t.level(100) < SILENCE);
    s = await t.sound();
    assert.equal(s.radio.status, 'off');
    assert.equal(s.radio.active, 0);
    assert.match(await page.locator('#radio-note').textContent(), /Engine and tire sounds stay on/);
    step('Radio Off stops the music and lets the context suspend');
    await t.done();
  }

  // --- A saved station waits for the first interaction ------------------------------
  {
    const t = await open(browser, { saved: settings('redline-radio', 40, 60) });
    const { page } = t;
    await page.waitForTimeout(300);
    assert.equal((await t.tap()).contexts, 0, 'nothing before the player acts');
    assert.equal(t.requests.some((path) => path.includes('/radio/')), false);
    await page.keyboard.press('KeyG'); // does nothing on the title screen except count as acting
    await t.playing('redline-radio');
    await t.contextIs('running');
    assert.equal((await t.tap()).contexts, 1);
    await page.waitForTimeout(700);
    assert.ok(await t.level() > SILENCE);
    step('a saved station waits for the first key, then plays');
    await t.done();
  }
  {
    const t = await open(browser, { saved: settings('synth-fm') });
    const { page } = t;
    assert.equal((await t.tap()).contexts, 0);
    await page.mouse.click(30, 30);
    await t.playing('synth-fm');
    step('a first click also starts a saved station');
    await t.done();
  }

  // --- Independent controls -----------------------------------------------------------
  {
    const t = await open(browser, { saved: settings('garage-rock', 100, 100) });
    const { page } = t;
    await page.keyboard.press('KeyO');
    await t.playing('garage-rock');
    assert.equal(await page.locator('input[name=station]:checked').inputValue(), 'garage-rock');
    await t.setVolume('music-volume', 0);
    await page.waitForTimeout(350);
    const silent = await t.level();
    assert.ok(silent < SILENCE, `music at 0 measured ${silent}`);
    let s = await t.sound();
    assert.equal(s.station, 'garage-rock');
    assert.equal(s.radio.status, 'playing');
    step('Music Volume 0 is silent and keeps the station');

    await t.setVolume('music-volume', 25);
    await page.waitForTimeout(250);
    const quiet = await t.level(500);
    await t.setVolume('music-volume', 100);
    await page.waitForTimeout(250);
    const loud = await t.level(500);
    assert.ok(loud > quiet * 2, `${quiet} then ${loud}`);
    step(`music volume changes the level (25%: ${quiet.toFixed(4)}, 100%: ${loud.toFixed(4)})`);

    // Into a run. With music at 0, only the effects can be making a sound.
    await t.setVolume('music-volume', 0);
    await t.closeOptions();
    await page.keyboard.press('Enter');
    await page.waitForFunction(() => {
      const a = window.__miniDrifters.audio();
      return a.engine !== 'none' && !['waiting', 'loading'].includes(a.tire);
    }, null, { timeout: 15000 });
    await page.waitForTimeout(300);
    const effectsOnly = await t.level();
    assert.ok(effectsOnly > SILENCE, `effects ${effectsOnly}`);
    step(`with Music Volume 0 the engine still sounds (level ${effectsOnly.toFixed(4)})`);

    await page.keyboard.press('KeyP');
    await page.keyboard.press('KeyO');
    await t.setVolume('effects-volume', 0);
    await page.waitForTimeout(100);
    await t.closeOptions();
    await page.keyboard.press('KeyP');
    await page.waitForTimeout(350);
    const nothing = await t.level();
    assert.ok(nothing < SILENCE, `both at 0 measured ${nothing}`);
    assert.equal((await t.sound()).mode, 'live');
    step('with both volumes at 0 the output is silent while driving');

    await page.keyboard.press('KeyP');
    await page.keyboard.press('KeyO');
    await t.setVolume('music-volume', 70);
    await t.closeOptions();
    await page.keyboard.press('KeyP');
    await page.waitForTimeout(350);
    const musicOnly = await t.level(500);
    assert.ok(musicOnly > SILENCE, `music ${musicOnly}`);
    step(`with Effects Volume 0 the music still plays (level ${musicOnly.toFixed(4)})`);

    await page.keyboard.press('KeyP');
    await page.keyboard.press('KeyO');
    await t.setVolume('effects-volume', 100);
    await t.station('Radio Off');
    await t.closeOptions();
    await page.keyboard.press('KeyP');
    await page.waitForTimeout(600);
    const radioOff = await t.level();
    assert.ok(radioOff > SILENCE, `Radio Off effects ${radioOff}`);
    s = await t.sound();
    assert.equal(s.mode, 'live');
    assert.equal(s.radio.active, 0);
    assert.equal(s.effectsVolume, 100);
    step(`Radio Off leaves the engine sounding (level ${radioOff.toFixed(4)})`);
    await t.done();
  }

  // --- Master mute, levels at full, driving controls ----------------------------------
  {
    const t = await open(browser, { saved: settings('redline-radio', 100, 100) });
    const { page } = t;
    await page.keyboard.press('Enter');
    await t.playing('redline-radio');
    await page.waitForFunction(() => window.__miniDrifters.audio().engine !== 'none', null, { timeout: 15000 });
    const started = (await t.sound()).radio.starts;

    // Holding the controls through a change of station.
    await page.keyboard.down('ArrowUp');
    await page.waitForFunction(() => window.__miniDrifters.game.car.speed > 22, null, { timeout: 12000 });
    await page.keyboard.down('ArrowRight');
    await page.waitForTimeout(120);
    await page.keyboard.down('Space');
    await page.waitForTimeout(300);
    await page.keyboard.up('Space');
    const peakLevel = await t.level(500);
    result.peakAtFullVolumes = await page.evaluate(() => window.__tap.peak);
    assert.ok(result.peakAtFullVolumes < 1, `peak ${result.peakAtFullVolumes}`);
    step(`music and effects at 100% while drifting stay below full scale (level ${peakLevel.toFixed(3)}, peak ${result.peakAtFullVolumes.toFixed(3)})`);

    const before = await t.game();
    assert.deepEqual([before.input.up, before.input.right], [true, true]);
    await page.keyboard.press('KeyN');
    let g = await t.game();
    assert.deepEqual(g.input, before.input, 'the change of station leaves the controls alone');
    assert.equal(g.paused, false);
    assert.equal(g.state, 'racing');
    assert.equal((await t.sound()).station, 'off', 'Redline, then Radio Off');
    assert.match(await t.status(), /Radio Off/);
    await page.keyboard.press('KeyN');
    assert.equal(await t.status(), 'Garage Rock');
    await page.waitForTimeout(150);
    assert.ok((await t.game()).ticks > g.ticks, 'the race carries on');
    await page.screenshot({ path: artifact(`${browserName}-driving.png`) });
    await page.keyboard.up('ArrowRight');
    await page.keyboard.up('ArrowUp');
    step('N changes station while throttle and steering are held, without touching the race');

    await t.playing('garage-rock');
    await page.waitForTimeout(700);
    const beforeMute = await t.sound();
    await page.locator('#sound').click();
    assert.equal(await page.locator('#sound').textContent(), 'Sound Off');
    await t.contextIs('suspended');
    assert.ok(await t.level(120) < SILENCE);
    assert.equal(await page.locator('#radio-status').getAttribute('data-state'), 'muted');
    await page.locator('#sound').click();
    await t.contextIs('running');
    await page.waitForTimeout(300);
    assert.ok(await t.level() > SILENCE);
    const afterMute = await t.sound();
    assert.equal(afterMute.station, beforeMute.station);
    assert.equal(afterMute.musicVolume, beforeMute.musicVolume);
    assert.equal(afterMute.effectsVolume, beforeMute.effectsVolume);
    assert.equal(afterMute.radio.starts, beforeMute.radio.starts, 'the same track carries on');
    assert.equal((await t.tap()).contexts, 1);
    assert.ok(started >= 1);
    step('master mute silences both, and unmuting restores the station, volumes and track');
    await t.done();
  }

  // --- Screens don't restart the track ------------------------------------------------
  {
    const t = await open(browser, { saved: settings('synth-fm', 70, 100) });
    const { page } = t;
    await page.keyboard.press('KeyO');
    await t.playing('synth-fm');
    const { starts, track } = (await t.sound()).radio;
    const same = async (where) => {
      const s = await t.sound();
      assert.equal(s.radio.starts, starts, `${where} restarted the track`);
      assert.equal(s.radio.track, track, where);
      assert.equal(s.radio.active, 1, where);
      assert.equal((await t.tap()).contexts, 1, where);
    };
    await t.closeOptions();
    await same('leaving Options');
    await page.keyboard.press('Enter');
    await same('starting a run');
    await page.waitForTimeout(150);
    await page.keyboard.press('KeyR');
    await same('restarting');
    await page.keyboard.press('KeyP');
    await page.waitForTimeout(250);
    assert.equal((await t.tap()).states[0], 'running', 'a paused race keeps the radio');
    assert.equal((await t.sound()).mode, 'silent', 'and silences the engine');
    assert.ok(await t.level() > SILENCE);
    await same('pausing');
    await page.keyboard.press('KeyO');
    assert.ok(await page.locator('input[name=station]:checked').isChecked());
    assert.equal(await page.locator('input[name=station]:checked').inputValue(), 'synth-fm');
    await t.closeOptions();
    await same('Options from pause');
    await page.keyboard.press('KeyP');
    await same('unpausing');

    await page.route('**/test/support/drivers.mjs', async (route) => route.fulfill({
      contentType: 'text/javascript', body: await readFile(new URL('test/support/drivers.mjs', root)),
    }));
    await page.evaluate(async () => {
      const { driftDriver } = await import(new URL('test/support/drivers.mjs', document.baseURI).href);
      const { tick } = await import(new URL('src/game.js', document.baseURI).href);
      const { game: g } = window.__miniDrifters;
      const driver = driftDriver();
      while (g.state !== 'finished') tick(g, driver(g));
    });
    await page.waitForSelector('#results:not([hidden])');
    await same('finishing');
    await page.waitForTimeout(2800);
    assert.equal((await t.tap()).states[0], 'running', 'the radio outlasts the finish fade');
    assert.ok(await t.level() > SILENCE);
    assert.equal((await t.sound()).mode, 'fade');
    await page.locator('#results .options-open').click();
    assert.equal(await page.locator('#results').isVisible(), false);
    await t.closeOptions();
    await same('Options from results');
    await page.locator('#again').click();
    await same('driving again');
    step('Options, starts, restarts, pause, finish and Drive Again all keep the same track');
    await t.done();
  }

  // --- Page state and persistence -----------------------------------------------------
  {
    const t = await open(browser, { saved: settings('garage-rock', 50, 80) });
    const { page } = t;
    await page.keyboard.press('Enter');
    await t.playing('garage-rock');
    await page.waitForTimeout(700);
    const { starts } = (await t.sound()).radio;

    await page.evaluate(() => window.dispatchEvent(new Event('blur')));
    await t.contextIs('suspended');
    assert.equal((await t.game()).paused, true);
    await page.evaluate(() => window.dispatchEvent(new Event('focus')));
    await t.contextIs('running');
    await page.waitForTimeout(200);
    assert.ok(await t.level() > SILENCE);
    let s = await t.sound();
    assert.equal(s.mode, 'silent', 'the game stays paused, and so does the engine');
    assert.equal(s.radio.starts, starts);
    step('focus loss silences and suspends, and the radio carries on when focus returns');

    await page.evaluate(() => {
      Object.defineProperty(document, 'hidden', { configurable: true, get: () => true });
      document.dispatchEvent(new Event('visibilitychange'));
    });
    await t.contextIs('suspended');
    assert.equal((await t.sound()).radio.active, 1);
    await page.evaluate(() => {
      delete document.hidden;
      document.dispatchEvent(new Event('visibilitychange'));
    });
    await t.contextIs('running');
    s = await t.sound();
    assert.equal(s.radio.starts, starts);
    assert.equal(s.radio.active, 1);
    assert.equal((await t.tap()).contexts, 1);
    step('a hidden tab suspends with one track held, and showing it adds nothing');

    await page.keyboard.press('KeyO');
    await t.station('Redline Radio');
    await t.setVolume('music-volume', 35);
    await t.setVolume('effects-volume', 45);
    await page.locator('#sound').click();
    await page.reload();
    await page.waitForFunction(() => window.__miniDrifters);
    s = await t.sound();
    assert.deepEqual([s.station, s.musicVolume, s.effectsVolume, s.muted], ['redline-radio', 35, 45, true]);
    await page.keyboard.press('KeyO');
    assert.equal(await page.locator('input[name=station]:checked').inputValue(), 'redline-radio');
    assert.equal(await page.inputValue('#music-volume'), '35');
    assert.equal(await page.inputValue('#effects-volume'), '45');
    assert.equal(await page.locator('#music-volume-value').textContent(), '35%');
    assert.ok(await page.locator('#options-muted').isVisible());
    assert.equal((await t.tap()).contexts, 0, 'muted: nothing is created');
    await page.locator('#sound').click();
    await t.playing('redline-radio');
    assert.equal((await t.sound()).musicVolume, 35);
    step('station, volumes and mute survive a reload, and unmuting starts the saved station');
    await t.done();
  }

  // --- Keyboard inside Options --------------------------------------------------------
  {
    const t = await open(browser);
    const { page } = t;
    await page.locator('#start').focus();
    await page.keyboard.press('Tab'); // How to Play
    await page.keyboard.press('Tab');
    await page.keyboard.press('Enter');
    assert.equal((await t.game()).state, 'menu', 'Enter on the Options button does not start a run');
    assert.ok(await page.locator('#options').isVisible());
    assert.equal(await page.evaluate(() => document.activeElement.value), 'off', 'focus goes to the current station');
    await page.keyboard.press('ArrowRight');
    assert.equal((await t.sound()).station, 'garage-rock', 'arrow keys change station');
    await page.locator('#music-volume').focus();
    await page.keyboard.press('ArrowLeft');
    await page.keyboard.press('ArrowLeft');
    assert.equal(await page.inputValue('#music-volume'), '60');
    assert.equal((await t.sound()).musicVolume, 60);
    await page.keyboard.press('ArrowRight');
    assert.equal(await page.inputValue('#music-volume'), '65');
    assert.deepEqual((await t.game()).input, { up: false, down: false, left: false, right: false, handbrake: false });
    await page.keyboard.press('KeyR');
    await page.keyboard.press('KeyP');
    await page.keyboard.press('KeyN');
    await page.keyboard.press('Enter');
    assert.equal((await t.game()).state, 'menu', 'game keys do nothing while Options is open');
    assert.equal((await t.sound()).station, 'garage-rock');
    await page.keyboard.press('Escape');
    assert.equal(await page.locator('#options').isVisible(), false);
    assert.equal(await page.evaluate(() => document.activeElement.classList.contains('options-open')), true, 'focus returns to the button');
    await page.keyboard.press('Space');
    assert.ok(await page.locator('#options').isVisible(), 'Space presses the focused button');
    await page.locator('#options-close').click();
    assert.equal(await page.locator('#options').isVisible(), false);
    assert.ok(await page.locator('#menu').isVisible());
    assert.equal(await page.evaluate(() => document.activeElement === document.body), true, 'a mouse click leaves nothing focused');
    step('Options works by keyboard, and game keys stay out of it');

    // After closing with the mouse, Enter means what it always did.
    await page.keyboard.press('Enter');
    assert.equal((await t.game()).state, 'ready', 'Enter starts the run');
    assert.equal(await page.locator('#options').isVisible(), false);

    // Pausing with a pedal held, then Options: it can't stick or change the station.
    await page.keyboard.down('ArrowUp');
    await page.waitForTimeout(200);
    assert.equal((await t.game()).input.up, true);
    await page.keyboard.press('KeyP');
    await page.keyboard.press('KeyO');
    assert.ok(await page.locator('#options').isVisible());
    assert.equal((await t.game()).input.up, false);
    for (let i = 0; i < 4; i++) await page.keyboard.down('ArrowUp'); // the key repeating
    assert.equal((await t.sound()).station, 'garage-rock', 'a repeating pedal does not walk through the stations');
    await page.keyboard.up('ArrowUp');
    assert.equal((await t.sound()).station, 'garage-rock');
    await t.closeOptions();
    await page.keyboard.press('KeyP');
    await page.waitForTimeout(100);
    const g = await t.game();
    assert.equal(g.input.up, false);
    assert.equal(g.paused, false);
    assert.equal(g.state === 'ready' || g.state === 'racing', true);
    step('a pedal held into Options neither sticks nor changes the station');

    // Layout on a small laptop.
    await page.setViewportSize({ width: 1024, height: 600 });
    await page.waitForTimeout(100);
    const rect = (id) => page.evaluate((el) => {
      const r = document.getElementById(el).getBoundingClientRect();
      return { left: r.left, right: r.right, top: r.top, bottom: r.bottom };
    }, id);
    const overlaps = (a, b) => a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom;
    const hud = await rect('radio-status');
    for (const other of ['ghost-status', 'sound', 'lap-time']) assert.equal(overlaps(hud, await rect(other)), false, other);
    await page.keyboard.press('KeyP');
    await page.keyboard.press('KeyO');
    const done = await rect('options-close');
    assert.ok(done.bottom <= 600 && done.top >= 0, `Done at ${done.top} to ${done.bottom}`);
    assert.equal(overlaps(await rect('options-close'), await rect('sound')), false);
    await page.screenshot({ path: artifact(`${browserName}-options-small.png`) });
    step('at 1024x600 Options fits and the indicator overlaps nothing');
    await t.done();
  }

  // --- Failures -----------------------------------------------------------------------
  const driveOn = async (t) => {
    await t.page.keyboard.down('ArrowUp');
    await t.page.waitForTimeout(500);
    await t.page.keyboard.up('ArrowUp');
    assert.ok((await t.game()).speed > 2, 'still drivable');
  };
  for (const [label, fulfill] of [
    ['missing', (route) => route.fulfill({ status: 404, body: 'gone' })],
    ['corrupt', (route) => route.fulfill({ status: 200, contentType: 'audio/wav', body: 'not audio' })],
    ['refused', (route) => route.abort()],
  ]) {
    const t = await open(browser, { saved: settings('garage-rock'), before: (page) => page.route('**/radio/**', fulfill) });
    const { page } = t;
    await page.keyboard.press('Enter');
    await page.waitForFunction(() => window.__miniDrifters.audio().radio.status === 'unavailable', null, { timeout: 15000 });
    await page.waitForFunction(() => window.__miniDrifters.audio().engine !== 'none', null, { timeout: 15000 });
    const s = await t.sound();
    assert.equal(s.label, 'Sound On');
    assert.equal(s.failure, null);
    assert.equal(s.mode, 'live');
    assert.equal(s.engine, 'coyote');
    assert.match(s.radio.failures[0], /garage-rock-test\.wav/);
    assert.match(await t.status(), /Unavailable/);
    await driveOn(t);
    assert.ok(await t.level() > SILENCE, 'the effects carry on');

    await page.unroute('**/radio/**');
    await page.keyboard.press('KeyP');
    await page.keyboard.press('KeyO');
    assert.match(await page.locator('#radio-note').textContent(), /could not load/);
    await t.station('Garage Rock');
    await t.playing('garage-rock');
    step(`a ${label} track: labelled, the game drives with its effects, and selecting it again recovers`);
    await t.done();
  }
  {
    const t = await open(browser, { saved: settings('garage-rock'), before: (page) => page.addInitScript(() => { delete window.AudioContext; }) });
    await t.page.keyboard.press('Enter');
    assert.equal(await t.page.locator('#sound').textContent(), 'Sound Unavailable');
    await driveOn(t);
    step('no Web Audio with a saved station: labelled unavailable, and the game drives');
    await t.done();
  }
  {
    const t = await open(browser, { before: (page) => page.addInitScript(() => {
      Object.defineProperty(window, 'localStorage', { get() { throw new DOMException('denied', 'SecurityError'); } });
    }) });
    await t.page.keyboard.press('KeyN');
    assert.equal((await t.sound()).station, 'garage-rock');
    await t.page.keyboard.press('Enter');
    await driveOn(t);
    step('no local storage: settings last for this visit, and the game drives');
    await t.done();
  }

  return { ...result, passed: true };
}

// The browser's autoplay policy at its strictest: audio is blocked until the page has
// real user activation. A context made too early would hang, then report a failure.
const STRICT_AUTOPLAY = {
  chromium: { args: ['--autoplay-policy=document-user-activation-required'] },
  firefox: { firefoxUserPrefs: { 'media.autoplay.default': 5, 'media.autoplay.blocking_policy': 1 } },
};

async function runStrictAutoplay(engine, browserName) {
  const browser = await engine.launch({ headless: true, ...STRICT_AUTOPLAY[browserName] });
  try {
    const t = await open(browser, { saved: settings('garage-rock') });
    const { page } = t;
    await page.waitForTimeout(500);
    assert.equal((await t.tap()).contexts, 0, 'nothing before the player acts');
    // Escape and Shift don't count as activation, so nothing must start from them.
    await page.keyboard.press('Escape');
    await page.keyboard.press('Shift');
    await page.waitForTimeout(150);
    if (await page.evaluate(() => navigator.userActivation?.hasBeenActive === false)) {
      assert.equal((await t.tap()).contexts, 0, 'a key that is not a gesture starts nothing');
    }
    await page.keyboard.press('KeyG');
    const realtime = await realtimeOutput(t, browserName);
    if (realtime) {
      await t.playing('garage-rock');
      await t.contextIs('running');
      await page.waitForTimeout(700);
      assert.ok(await t.level() > SILENCE);
      assert.equal((await t.sound()).failure, null);
    }
    await t.done();
    console.log(`  ok: strict autoplay policy: silent until a real gesture${realtime ? ', then plays' : ' (no output device)'}`);
    return { browser: browserName, version: browser.version(), pass: 'strict-autoplay', passed: true, realtime };
  } finally {
    await browser.close();
  }
}

const report = { note: 'Measured output levels and lifecycle only. No human listening.', runs: [] };
try {
  for (const [name, engine] of [['chromium', chromium], ['firefox', firefox]]) {
    console.log(`Checking ${name}...`);
    const browser = await engine.launch({ headless: true });
    try {
      report.runs.push(await run(browser, name));
    } catch (error) {
      console.error(`  FAILED: ${error.message}`);
      report.runs.push({ browser: name, version: browser.version(), passed: false, error: error.message });
    } finally {
      await browser.close();
    }
    try {
      report.runs.push(await runStrictAutoplay(engine, name));
    } catch (error) {
      console.error(`  FAILED: strict autoplay: ${error.message}`);
      report.runs.push({ browser: name, pass: 'strict-autoplay', passed: false, error: error.message });
    }
  }
} finally {
  server?.close();
}
await writeFile(artifact('report.json'), `${JSON.stringify(report, null, 2)}\n`);
for (const r of report.runs) {
  const note = r.realtime === false ? ' (no real-time output device: bounded failure path only)' : '';
  console.log(`${r.browser} ${r.version}: ${r.passed ? 'PASSED' : `FAILED: ${r.error}`}${note}`);
}
process.exit(report.runs.every((r) => r.passed) ? 0 : 1);
