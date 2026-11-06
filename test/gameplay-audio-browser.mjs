// Gameplay audio in real browsers, using real key presses and real Web Audio. It
// measures the graph's output level. That proves signal or silence reached the
// destination; it does not prove anything sounded good, and no human listened here.
//
// Passes, each reported separately:
//   public   - exactly what Pages publishes, with the real Coyote recordings
//   fallback - the same files with the recordings failing to load
//   local    - the local development server
// Optional argument: absolute path to an existing Playwright index.mjs.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import http from 'node:http';
import { existsSync } from 'node:fs';
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { extname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const { chromium, firefox } = await import(process.argv[2] ? pathToFileURL(process.argv[2]) : 'playwright');
const root = new URL('../', import.meta.url);
const artifact = (name) => fileURLToPath(new URL(`artifacts/${name}`, root));
await mkdir(new URL('artifacts/', root), { recursive: true });

const SILENCE = 0.0005;
const provenance = JSON.parse(await readFile(new URL('docs/COYOTE-PROVENANCE.json', root), 'utf8'));
const COYOTE_FILES = ['idle', 'mid', 'load', 'high'];
const COYOTE_PATH = (key) => new URL(`audio-lab/assets/coyote-local/${key}.wav`, root);
const TYPES = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mp3': 'audio/mpeg', '.wav': 'audio/wav', '.md': 'text/plain; charset=utf-8' };

// The same files the deploy job publishes.
const PUBLISHED_AUDIO = ['audio-lab/assets/tire-foley.mp3', 'audio-lab/assets/ATTRIBUTION.md', ...COYOTE_FILES.map((key) => `audio-lab/assets/coyote-local/${key}.wav`)];
const siteFiles = ['index.html', 'style.css', ...PUBLISHED_AUDIO, ...(await readdir(new URL('src/', root))).map((name) => `src/${name}`)];

async function serveLikePages() {
  const server = http.createServer(async (req, res) => {
    const path = new URL(req.url, 'http://localhost').pathname;
    const file = path === '/mini-drifters/' ? 'index.html' : path.replace('/mini-drifters/', '');
    if (!siteFiles.includes(file)) { res.writeHead(404); res.end('Not found'); return; }
    res.writeHead(200, { 'Content-Type': TYPES[extname(file)] });
    res.end(await readFile(new URL(file, root)));
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  return { url: `http://127.0.0.1:${server.address().port}/mini-drifters/`, stop: () => server.close() };
}

async function serveLocal(port) {
  const server = spawn(process.execPath, [fileURLToPath(new URL('server.mjs', root))], {
    env: { ...process.env, PORT: String(port) }, stdio: ['ignore', 'pipe', 'inherit'],
  });
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.once('exit', (code) => reject(new Error(`Server exited: ${code}`)));
    server.stdout.once('data', resolve);
  });
  return { url: `http://127.0.0.1:${port}/`, stop: () => server.kill() };
}

// A labelled synthetic mono PCM16 WAV: a plain sine, never heard as a recording.
function fixtureWav(hz, seconds = 0.5, rate = 24000) {
  const samples = Math.floor(seconds * rate);
  const out = Buffer.alloc(44 + samples * 2);
  out.write('RIFF', 0); out.writeUInt32LE(36 + samples * 2, 4); out.write('WAVEfmt ', 8);
  out.writeUInt32LE(16, 16); out.writeUInt16LE(1, 20); out.writeUInt16LE(1, 22);
  out.writeUInt32LE(rate, 24); out.writeUInt32LE(rate * 2, 28); out.writeUInt16LE(2, 32); out.writeUInt16LE(16, 34);
  out.write('data', 36); out.writeUInt32LE(samples * 2, 40);
  for (let i = 0; i < samples; i++) out.writeInt16LE(Math.round(7000 * Math.sin(2 * Math.PI * hz * i / rate)), 44 + i * 2);
  return out;
}

// Taps whatever reaches the destination, counts contexts and live sources, and can
// run before the page's own code. It observes only: the graph itself is unchanged.
const instrument = () => {
  const native = window.AudioContext;
  const created = [];
  const tapped = new WeakMap();
  const connect = AudioNode.prototype.connect;
  AudioNode.prototype.connect = function patched(target, ...rest) {
    if (target instanceof AudioDestinationNode && !tapped.has(target)) {
      const analyser = this.context.createAnalyser();
      analyser.fftSize = 2048;
      tapped.set(target, analyser);
      this.context.__analyser = analyser;
    }
    if (target instanceof AudioDestinationNode) connect.call(this, this.context.__analyser);
    return connect.call(this, target, ...rest);
  };
  window.AudioContext = class extends native {
    constructor(...args) { super(...args); created.push(this); }
    createBufferSource() { return track(super.createBufferSource()); }
    createOscillator() { return track(super.createOscillator()); }
  };
  const live = new Set();
  const track = (node) => {
    const { start, stop } = node;
    node.start = (...a) => { live.add(node); return start.apply(node, a); };
    node.stop = (...a) => { live.delete(node); return stop.apply(node, a); };
    return node;
  };
  window.__tap = {
    get contexts() { return created.length; },
    get liveSources() { return live.size; },
    states: () => created.map((c) => c.state),
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
    peak: 0,
  };
};

const report = { note: 'Measured output levels and lifecycle only. No human listening.', runs: [] };

async function runPass(browser, browserName, passName, base, setup = async () => {}) {
  console.log(`  ${passName}:`);
  const page = await browser.newPage({ viewport: { width: 1366, height: 768 } });
  const errors = [];
  const requests = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('request', (r) => requests.push(new URL(r.url()).pathname));
  await page.addInitScript(instrument);
  await setup(page);
  const steps = [];
  const step = (label) => { steps.push(label); console.log(`    ok: ${label}`); };
  const sound = () => page.evaluate(() => window.__miniDrifters.audio());
  const game = () => page.evaluate(() => {
    const { game: g } = window.__miniDrifters;
    return { state: g.state, paused: g.paused, ticks: g.ticks, speed: g.car.speed, rearSlip: g.car.rearSlip };
  });
  const tap = () => page.evaluate(() => ({ contexts: window.__tap.contexts, liveSources: window.__tap.liveSources, states: window.__tap.states() }));
  // Peak of several readings, because one analyser window can fall in a quiet moment.
  const level = async (ms = 400) => page.evaluate(async (wait) => {
    let peak = 0;
    const end = performance.now() + wait;
    while (performance.now() < end) {
      peak = Math.max(peak, window.__tap.level());
      await new Promise((r) => setTimeout(r, 25));
    }
    return peak;
  }, ms);
  const result = { browser: browserName, pass: passName, version: browser.version(), steps };

  try {
    await page.goto(base);
    await page.waitForFunction(() => window.__miniDrifters);
    assert.equal((await tap()).contexts, 0);
    assert.equal(await page.locator('#sound').textContent(), 'Sound On');
    await page.waitForTimeout(200);
    assert.equal((await tap()).contexts, 0);
    step('the menu makes no sound and creates no audio context');

    await page.keyboard.press('Enter');
    assert.equal((await game()).state, 'ready');
    assert.equal((await tap()).contexts, 1);
    await page.waitForFunction(() => {
      const a = window.__miniDrifters.audio();
      return (a.engine !== 'none' && a.tire !== 'waiting' && a.tire !== 'loading') || a.failure;
    }, null, { timeout: 15000 });
    let s = await sound();
    const realtime = !s.failure;
    result.realtimeOutput = realtime;
    result.engine = s.engine;

    if (!realtime) {
      // Device-less Linux Firefox: native resume never settles. This is the
      // bounded failure path, not successful real-time playback.
      assert.equal(browserName, 'firefox');
      assert.equal(process.platform, 'linux');
      assert.match(s.failure, /did not start/);
      assert.equal(s.label, 'Sound Unavailable');
      assert.equal(await page.locator('#sound').textContent(), 'Sound Unavailable');
      assert.equal(s.sourceCount, 0);
      assert.equal(s.contextState, 'closed', 'the controller has let go of the context');
      result.nativeContextStates = (await tap()).states; // close() may not settle without a device
      await page.keyboard.down('ArrowUp');
      await page.waitForTimeout(600);
      await page.keyboard.up('ArrowUp');
      assert.ok((await game()).speed > 2);
      step('no output device: reported as unavailable, context closed, and the game drives on');
      assert.deepEqual(errors, []);
      result.passed = true;
      return result;
    }

    assert.equal(s.tire, 'ready', s.tireFailures.join());
    assert.equal(s.mode, 'live');
    const idle = await level();
    assert.ok(idle > SILENCE, `idle level ${idle}`);
    assert.equal(s.rpm, 750);
    assert.equal(s.tireIntensity, 0);
    result.idleLevel = idle;
    step(`Enter starts one context with idle output on the grid (${s.engine} engine, level ${idle.toFixed(4)})`);

    // --- Driving: the model and the graph respond to real key presses.
    const sources = (await tap()).liveSources;
    await page.keyboard.down('ArrowUp');
    await page.waitForFunction(() => window.__miniDrifters.game.car.speed > 25, null, { timeout: 12000 });
    s = await sound();
    assert.ok(s.rpm > 3500, `rpm ${s.rpm}`);
    assert.ok(s.load > 0.9);
    const driving = await level(300);
    assert.ok(driving > SILENCE);
    result.drivingLevel = driving;
    step(`accelerating raises RPM to ${Math.round(s.rpm)} with output level ${driving.toFixed(4)}`);
    // The speed above passes the first two shift points. The gears exist only in audio.
    assert.ok(s.gear >= 3, `gear ${s.gear} at speed`);
    assert.ok(s.shifts >= 2, `${s.shifts} shifts`);
    result.gearAtSpeed = s.gear;
    step(`real key presses reach gear ${s.gear} after ${s.shifts} shifts, with no extra sources`);

    await page.keyboard.down('ArrowRight');
    await page.waitForTimeout(150);
    await page.keyboard.down('Space');
    await page.waitForTimeout(320);
    await page.keyboard.up('Space');
    await page.waitForFunction(() => window.__miniDrifters.audio().tireIntensity > 0.3, null, { timeout: 4000 });
    s = await sound();
    result.driftTire = s.tireIntensity;
    result.driftLevel = await level(500);
    result.peak = await page.evaluate(() => window.__tap.peak);
    assert.ok(result.peak < 1, `peak ${result.peak}`);
    step(`a real-key drift brings up the tires (intensity ${s.tireIntensity.toFixed(2)}, RPM ${Math.round(s.rpm)}, level ${result.driftLevel.toFixed(4)}, peak ${result.peak.toFixed(3)})`);
    await page.keyboard.up('ArrowRight');
    await page.keyboard.up('ArrowUp');
    assert.equal((await tap()).liveSources, sources, 'driving started no extra sources');

    // --- Pause: output stops and the context suspends.
    await page.keyboard.press('KeyP');
    assert.equal((await sound()).mode, 'silent');
    await page.waitForFunction(() => window.__tap.states()[0] === 'suspended', null, { timeout: 3000 });
    assert.ok(await level(150) < SILENCE);
    await page.keyboard.press('KeyP');
    await page.waitForFunction(() => window.__tap.states()[0] === 'running', null, { timeout: 3000 });
    assert.ok(await level() > SILENCE);
    step('P silences and suspends, and P brings the sound back');

    // --- Mute, by mouse and by keyboard, and remembered.
    await page.locator('#sound').click();
    assert.equal(await page.locator('#sound').textContent(), 'Sound Off');
    assert.equal(await page.evaluate(() => document.activeElement === document.getElementById('sound')), false, 'a click hands the keyboard back');
    await page.waitForFunction(() => window.__tap.states()[0] === 'suspended', null, { timeout: 3000 });
    assert.ok(await level(150) < SILENCE);
    await page.keyboard.press('KeyR');
    await page.waitForTimeout(150);
    assert.equal((await sound()).mode, 'silent', 'a restart does not unmute');
    assert.equal(await page.evaluate(() => localStorage.getItem('mini-drifters-sound')), 'off');
    await page.locator('#sound').focus();
    await page.keyboard.press('Enter');
    assert.equal(await page.locator('#sound').textContent(), 'Sound On');
    assert.equal(await page.evaluate(() => document.activeElement === document.getElementById('sound')), true, 'keyboard focus stays for another press');
    assert.equal((await game()).state, 'ready', 'Enter on the toggle does nothing else');
    await page.waitForFunction(() => window.__tap.states()[0] === 'running', null, { timeout: 3000 });
    assert.ok(await level() > SILENCE);
    step('the Sound control works by mouse and keyboard, survives restart and is remembered');

    // --- With the toggle focused while driving, Space is still the handbrake.
    await page.keyboard.down('Space');
    assert.equal((await page.evaluate(() => window.__miniDrifters.input.handbrake)), true);
    await page.keyboard.up('Space');
    assert.equal(await page.locator('#sound').textContent(), 'Sound On');
    await page.evaluate(() => document.activeElement.blur());
    step('while driving, Space on the focused toggle is still the handbrake and does not mute');

    // --- Focus loss: the game pauses, sound stops and returning does not resume it.
    await page.evaluate(() => window.dispatchEvent(new Event('blur')));
    assert.equal((await game()).paused, true);
    assert.equal((await sound()).mode, 'silent');
    await page.waitForFunction(() => window.__tap.states()[0] === 'suspended', null, { timeout: 3000 });
    await page.evaluate(() => window.dispatchEvent(new Event('focus')));
    await page.waitForTimeout(250);
    assert.equal((await game()).paused, true);
    assert.equal((await sound()).mode, 'silent');
    assert.equal((await tap()).states[0], 'suspended');
    step('focus loss pauses and silences, and focus returning leaves both as they are');

    // --- A hidden tab, when animation frames have stopped.
    await page.keyboard.press('KeyP');
    await page.waitForFunction(() => window.__tap.states()[0] === 'running', null, { timeout: 3000 });
    await page.evaluate(() => {
      Object.defineProperty(document, 'hidden', { configurable: true, get: () => true });
      document.dispatchEvent(new Event('visibilitychange'));
    });
    assert.equal((await game()).paused, true);
    assert.equal((await sound()).mode, 'silent');
    await page.evaluate(() => {
      delete document.hidden;
      document.dispatchEvent(new Event('visibilitychange'));
    });
    await page.waitForTimeout(150);
    assert.equal((await sound()).mode, 'silent');
    step('hiding the tab silences at once, and showing it again stays paused');

    // --- Repeated restarts from every state.
    const before = await tap();
    for (let i = 0; i < 8; i++) {
      await page.keyboard.press('KeyR');
      if (i % 3 === 0) await page.keyboard.down('ArrowUp');
      await page.waitForTimeout(60);
      if (i % 3 === 0) await page.keyboard.up('ArrowUp');
    }
    await page.keyboard.press('KeyR');
    await page.waitForTimeout(600);
    const after = await tap();
    assert.equal(after.contexts, 1);
    assert.equal(after.liveSources, before.liveSources);
    s = await sound();
    assert.equal(s.rpm, 750);
    assert.equal(s.gear, 1);
    assert.equal(s.shifts, 0);
    assert.equal(s.mode, 'live');
    assert.ok(await level() > SILENCE);
    step(`nine restarts: one context, ${after.liveSources} sources, back at idle output in first gear`);

    // --- Finish: a scripted run, then fading to silence, with no tire left over.
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
    assert.equal((await sound()).mode, 'fade');
    await page.waitForFunction(() => window.__tap.states()[0] === 'suspended', null, { timeout: 6000 });
    s = await sound();
    assert.ok(s.tireIntensity < 0.05, `tire ${s.tireIntensity}`);
    assert.ok(await level(150) < SILENCE);
    step('finishing fades out and suspends, with no tire noise left');

    // --- Drive again, by button, from the results screen.
    await page.locator('#again').click();
    await page.waitForFunction(() => window.__tap.states()[0] === 'running', null, { timeout: 3000 });
    await page.waitForTimeout(500);
    s = await sound();
    assert.equal(s.mode, 'live');
    assert.equal(s.rpm, 750);
    assert.ok(await level() > SILENCE);
    assert.equal((await tap()).contexts, 1);
    assert.equal((await tap()).liveSources, after.liveSources);
    step('Drive Again returns cleanly to idle with the same graph');

    // --- A new visit remembers a muted choice, and Start by button.
    await page.locator('#sound').click();
    await page.reload();
    await page.waitForFunction(() => window.__miniDrifters);
    assert.equal(await page.locator('#sound').textContent(), 'Sound Off');
    await page.locator('#start').click();
    assert.equal((await game()).state, 'ready');
    await page.waitForTimeout(150);
    assert.equal((await tap()).contexts, 0, 'muted runs open no context');
    await page.keyboard.down('ArrowUp');
    await page.waitForTimeout(400);
    await page.keyboard.up('ArrowUp');
    assert.ok((await game()).speed > 2, 'the game drives while muted');
    await page.locator('#sound').click();
    await page.waitForFunction(() => window.__miniDrifters.audio().engine !== 'none', null, { timeout: 8000 });
    await page.keyboard.press('KeyR');
    await page.waitForTimeout(500);
    assert.ok(await level() > SILENCE);
    step('Start button works, muted choice survives a reload, and unmuting starts sound');

    // --- Every request stayed on the expected paths.
    const coyoteRequests = requests.filter((p) => p.includes('coyote-local'));
    assert.ok(coyoteRequests.length > 0, 'the page asked for the recordings');
    for (const path of coyoteRequests) assert.match(path, /\/coyote-local\/(idle|mid|load|high)\.wav$/);
    for (const path of requests) assert.doesNotMatch(path, /Mustang|incar-reference|\.local/);
    result.coyoteRequests = coyoteRequests.length;

    await page.screenshot({ path: artifact(`gameplay-audio-${browserName}-${passName}.png`) });
    assert.deepEqual(errors, [], 'no page errors');
    result.passed = true;
    return result;
  } catch (error) {
    await page.screenshot({ path: artifact(`gameplay-audio-${browserName}-${passName}-failure.png`) }).catch(() => {});
    result.passed = false;
    result.error = error.message;
    result.errors = errors;
    console.error(`    FAILED: ${error.message}`);
    return result;
  } finally {
    await page.close();
  }
}

// Failure paths. These need routes rather than a server configuration.
async function runFailures(browser, browserName, base) {
  console.log('  failures:');
  const results = [];
  const open = async (setup) => {
    const page = await browser.newPage({ viewport: { width: 1366, height: 768 } });
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await page.addInitScript(instrument);
    await setup(page);
    await page.goto(base);
    await page.waitForFunction(() => window.__miniDrifters);
    return { page, errors };
  };
  const drivable = async (page, errors) => {
    await page.keyboard.down('ArrowUp');
    await page.waitForTimeout(500);
    await page.keyboard.up('ArrowUp');
    assert.ok(await page.evaluate(() => window.__miniDrifters.game.car.speed) > 2, 'still drivable');
    assert.deepEqual(errors, []);
  };
  const settled = (page) => page.waitForFunction(() => {
    const a = window.__miniDrifters.audio();
    return (a.engine !== 'none' && !['waiting', 'loading'].includes(a.tire)) || a.failure;
  }, null, { timeout: 15000 });

  // Missing tire recording.
  {
    const { page, errors } = await open((p) => p.route('**/tire-foley.mp3', (r) => r.fulfill({ status: 404, body: 'gone' })));
    await page.keyboard.press('Enter');
    await settled(page);
    const s = await page.evaluate(() => window.__miniDrifters.audio());
    if (!s.failure) {
      assert.equal(s.tire, 'unavailable');
      assert.match(s.tireFailures[0], /HTTP 404/);
      assert.notEqual(s.engine, 'none');
    }
    await drivable(page, errors);
    await page.close();
    results.push('missing tire file: engine continues and the game drives');
  }
  // Corrupt tire recording.
  {
    const { page, errors } = await open((p) => p.route('**/tire-foley.mp3', (r) => r.fulfill({ status: 200, contentType: 'audio/mpeg', body: 'not audio' })));
    await page.keyboard.press('Enter');
    await settled(page);
    const s = await page.evaluate(() => window.__miniDrifters.audio());
    if (!s.failure) assert.equal(s.tire, 'unavailable');
    await drivable(page, errors);
    await page.close();
    results.push('corrupt tire file: engine continues and the game drives');
  }
  // Browser refuses to create an AudioContext at all.
  {
    const { page, errors } = await open((p) => p.addInitScript(() => {
      window.AudioContext = class { constructor() { throw new DOMException('blocked', 'NotAllowedError'); } };
    }));
    await page.keyboard.press('Enter');
    assert.equal(await page.locator('#sound').textContent(), 'Sound Unavailable');
    assert.match(await page.locator('#sound').getAttribute('title'), /blocked/);
    await drivable(page, errors);
    await page.close();
    results.push('AudioContext refused: labelled unavailable and the game drives');
  }
  // The output cannot start. Rejected by the browser.
  {
    const { page, errors } = await open((p) => p.addInitScript(() => {
      AudioContext.prototype.resume = () => Promise.reject(new DOMException('no permission', 'NotAllowedError'));
    }));
    await page.keyboard.press('Enter');
    await page.waitForFunction(() => window.__miniDrifters.audio().failure);
    assert.equal(await page.locator('#sound').textContent(), 'Sound Unavailable');
    await drivable(page, errors);
    const state = await page.evaluate(() => window.__miniDrifters.audio());
    assert.equal(state.sourceCount, 0);
    assert.equal(state.contextState, 'closed');
    await page.close();
    results.push('output permission refused: context closed, labelled unavailable and the game drives');
  }
  // No Web Audio at all.
  {
    const { page, errors } = await open((p) => p.addInitScript(() => { delete window.AudioContext; }));
    await page.keyboard.press('Enter');
    assert.equal(await page.locator('#sound').textContent(), 'Sound Unavailable');
    await drivable(page, errors);
    await page.close();
    results.push('no Web Audio API: labelled unavailable and the game drives');
  }
  // No browser storage.
  {
    const { page, errors } = await open((p) => p.addInitScript(() => {
      Object.defineProperty(window, 'localStorage', { get() { throw new DOMException('denied', 'SecurityError'); } });
    }));
    await page.locator('#sound').click();
    assert.equal(await page.locator('#sound').textContent(), 'Sound Off');
    await page.locator('#sound').click();
    assert.equal(await page.locator('#sound').textContent(), 'Sound On');
    await page.keyboard.press('Enter');
    await drivable(page, errors);
    await page.close();
    results.push('no local storage: the toggle still works for this visit');
  }
  for (const line of results) console.log(`    ok: ${line}`);
  return { browser: browserName, pass: 'failures', version: browser.version(), passed: true, steps: results };
}

// The Coyote path with synthetic fixtures, including partial and corrupt banks.
async function runCoyoteFailures(browser, browserName, base) {
  console.log('  coyote bank failures (fixtures):');
  const results = [];
  for (const [label, fulfill] of [
    ['missing mid layer', (r) => (r.request().url().includes('mid.wav') ? r.fulfill({ status: 404, body: 'gone' }) : r.fulfill({ status: 200, contentType: 'audio/wav', body: fixtureWav(180) }))],
    ['corrupt mid layer', (r) => r.fulfill({ status: 200, contentType: 'audio/wav', body: r.request().url().includes('mid.wav') ? 'bad wav data' : fixtureWav(180) })],
    ['all layers missing', (r) => r.fulfill({ status: 404, body: 'gone' })],
  ]) {
    const page = await browser.newPage({ viewport: { width: 1366, height: 768 } });
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await page.addInitScript(instrument);
    await page.route('**/coyote-local/*.wav', fulfill);
    await page.goto(base);
    await page.waitForFunction(() => window.__miniDrifters);
    await page.keyboard.press('Enter');
    await page.waitForFunction(() => {
      const a = window.__miniDrifters.audio();
      return a.engine !== 'none' || a.failure;
    }, null, { timeout: 15000 });
    const s = await page.evaluate(() => window.__miniDrifters.audio());
    if (!s.failure) {
      assert.equal(s.engine, 'fallback', label);
      assert.ok(s.engineFailures.length > 0, label);
      assert.match(await page.locator('#sound').getAttribute('data-engine'), /fallback/);
      assert.match(await page.locator('#sound').getAttribute('title'), /synthesized/);
      assert.doesNotMatch(await page.locator('#sound').getAttribute('title'), /Coyote/);
    }
    assert.deepEqual(errors, []);
    await page.close();
    results.push(`${label}: falls back to the labelled synthetic engine`);
  }
  for (const line of results) console.log(`    ok: ${line}`);
  return { browser: browserName, pass: 'coyote-failures', version: browser.version(), passed: true, steps: results };
}

// --- Run --------------------------------------------------------------------

const hashes = Object.fromEntries(provenance.loops.map((loop) => [loop.file, loop.sha256]));
for (const key of COYOTE_FILES) {
  assert.ok(existsSync(COYOTE_PATH(key)), `${key}.wav is missing`);
  const digest = createHash('sha256').update(await readFile(COYOTE_PATH(key))).digest('hex');
  assert.equal(digest, hashes[`${key}.wav`], `${key}.wav does not match docs/COYOTE-PROVENANCE.json`);
}

const pages = await serveLikePages();
const local = await serveLocal(4199);
try {
  for (const [name, engine] of [['chromium', chromium], ['firefox', firefox]]) {
    console.log(`Checking ${name}...`);
    const browser = await engine.launch({ headless: true });
    try {
      report.runs.push(await runPass(browser, name, 'public', pages.url));
      report.runs.push(await runPass(browser, name, 'fallback', pages.url, async (page) => {
        await page.route('**/coyote-local/*.wav', (route) => route.fulfill({ status: 404, body: 'gone' }));
      }));
      report.runs.push(await runFailures(browser, name, pages.url));
      report.runs.push(await runCoyoteFailures(browser, name, pages.url));
      report.runs.push(await runPass(browser, name, 'local', local.url));
    } finally {
      await browser.close();
    }
  }
} finally {
  pages.stop();
  local.stop();
}

for (const run of report.runs) {
  if (['public', 'local'].includes(run.pass) && run.realtimeOutput) assert.equal(run.engine, 'coyote', `${run.pass} pass must decode the real bank`);
  if (run.pass === 'fallback' && run.realtimeOutput) assert.equal(run.engine, 'fallback', 'fallback pass uses the labelled fallback');
}
await writeFile(artifact('gameplay-audio-report.json'), `${JSON.stringify(report, null, 2)}\n`);
for (const run of report.runs) {
  const note = run.realtimeOutput === false ? ' (no real-time output device: bounded failure path only)' : '';
  console.log(`${run.browser} ${run.version} ${run.pass}: ${run.passed ? 'PASSED' : `FAILED: ${run.error}`}${note}`);
}
process.exit(report.runs.every((run) => run.passed) ? 0 : 1);
