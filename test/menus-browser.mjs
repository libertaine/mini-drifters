// The title screen, How to Play and the shared menus in real browsers: real keys, real
// clicks and real pixels, served the same way as on GitHub Pages. Needs Playwright:
//   node test/menus-browser.mjs [/path/to/playwright/index.mjs]
// Screenshots of every screen at every supported size go to artifacts/.
import assert from 'node:assert/strict';
import http from 'node:http';
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { extname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { RADIO_FILES } from '../src/radio-stations.js';

const { chromium, firefox } = await import(process.argv[2] ? pathToFileURL(process.argv[2]) : 'playwright');

const root = new URL('../', import.meta.url);
const artifact = (name) => fileURLToPath(new URL(`artifacts/menus-${name}`, root));
await mkdir(new URL('artifacts/', root), { recursive: true });

const siteFiles = ['index.html', 'style.css', 'audio-lab/assets/tire-foley.mp3', 'audio-lab/assets/ATTRIBUTION.md',
  ...['idle', 'mid', 'load', 'high'].map((key) => `audio-lab/assets/coyote-local/${key}.wav`), ...RADIO_FILES,
  ...(await readdir(new URL('src/', root))).map((name) => `src/${name}`)];
const types = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mp3': 'audio/mpeg', '.wav': 'audio/wav', '.md': 'text/plain; charset=utf-8' };
const server = http.createServer(async (req, res) => {
  const path = new URL(req.url, 'http://localhost').pathname;
  const file = path === '/mini-drifters/' ? 'index.html' : path.replace('/mini-drifters/', '');
  if (!siteFiles.includes(file)) {
    res.writeHead(404);
    res.end('Not found');
    return;
  }
  res.writeHead(200, { 'Content-Type': types[extname(file)] });
  res.end(await readFile(new URL(file, root)));
});
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const BASE = `http://127.0.0.1:${server.address().port}/mini-drifters/`;
const ORIGIN = new URL(BASE).origin;

const SIZES = [[1920, 1080], [1366, 768], [1024, 600]];
const NO_KEYS = { up: false, down: false, left: false, right: false, handbrake: false };
const TITLE_CONTROLS = ['#start', '#how-to-play', '#menu .options-open'];

const visible = (page, id) => page.locator(`#${id}`).isVisible();
const game = (page) => page.evaluate(() => {
  const { game: g, input } = window.__miniDrifters;
  return { state: g.state, paused: g.paused, ticks: g.ticks, speed: g.car.speed, runTime: g.runTime, input: { ...input } };
});
const focused = (page) => page.evaluate(() => document.activeElement.id || document.activeElement.className || document.activeElement.tagName);
// What the player actually sees of the focus: the browser's own rule and a real outline.
const focusRing = (page) => page.evaluate(() => {
  const el = document.activeElement;
  const { outlineStyle, outlineWidth } = getComputedStyle(el);
  return el.matches(':focus-visible') && outlineStyle !== 'none' && parseFloat(outlineWidth) >= 2;
});
const station = (page) => page.evaluate(() => window.__miniDrifters.audio().station);
// The game loop shows a screen only when a frame sees the state change. Driving a restarted run
// to the finish in one go needs a frame to have seen it on the grid first, or the loop sees
// finished both times and the results stay hidden. A player's run always spans many frames.
const frameShowsGrid = async (page) => {
  await page.waitForFunction(() => window.__miniDrifters.game.state === 'ready');
  await page.waitForSelector('#prompt:not([hidden])');
  // The prompt can already be up from before a restart, so also let the loop run for certain.
  await page.evaluate(() => new Promise((resolve) => {
    requestAnimationFrame(() => requestAnimationFrame(resolve));
  }));
};

// Counts canvas pixels near a colour, in a part of the window.
const countPixels = (page, [r, g, b], from = 0, to = 1) => page.evaluate(({ r, g, b, from, to }) => {
  const canvas = document.getElementById('view');
  const x = Math.round(canvas.width * from);
  const { data } = canvas.getContext('2d').getImageData(x, 0, Math.round(canvas.width * to) - x, canvas.height);
  let hits = 0;
  for (let i = 0; i < data.length; i += 4) {
    if (Math.abs(data[i] - r) < 16 && Math.abs(data[i + 1] - g) < 16 && Math.abs(data[i + 2] - b) < 16) hits += 1;
  }
  return hits;
}, { r, g, b, from, to });
const CAR_BODY = [239, 77, 35];
// The box around the car's paint, in window pixels.
const carBox = (page) => page.evaluate(([r, g, b]) => {
  const canvas = document.getElementById('view');
  const scale = canvas.width / window.innerWidth;
  const { data } = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height);
  const box = { left: Infinity, right: -Infinity, top: Infinity, bottom: -Infinity };
  for (let i = 0; i < data.length; i += 4) {
    if (Math.abs(data[i] - r) >= 16 || Math.abs(data[i + 1] - g) >= 16 || Math.abs(data[i + 2] - b) >= 16) continue;
    const x = ((i / 4) % canvas.width) / scale;
    const y = Math.floor(i / 4 / canvas.width) / scale;
    box.left = Math.min(box.left, x);
    box.right = Math.max(box.right, x);
    box.top = Math.min(box.top, y);
    box.bottom = Math.max(box.bottom, y);
  }
  return box;
}, CAR_BODY);
const GRASS = [63, 154, 71];

// Everything on the title that has to be readable or pressable, at the current size.
const titleLayout = (page) => page.evaluate((selectors) => {
  const box = (el) => {
    const r = el.getBoundingClientRect();
    return { left: r.left, right: r.right, top: r.top, bottom: r.bottom };
  };
  return {
    title: box(document.querySelector('.title')),
    tagline: box(document.querySelector('.tagline')),
    sound: box(document.getElementById('sound')),
    buttons: selectors.map((selector) => {
      const el = document.querySelector(selector);
      const b = box(el);
      const hit = document.elementFromPoint((b.left + b.right) / 2, (b.top + b.bottom) / 2);
      return { selector, ...b, reachable: hit === el || el.contains(hit) };
    }),
    scrolls: document.getElementById('menu').scrollHeight > document.getElementById('menu').clientHeight
      || document.documentElement.scrollHeight > innerHeight,
  };
}, TITLE_CONTROLS);

const overlaps = (a, b) => a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom;

async function check(name, engine) {
  console.log(`Checking ${name}...`);
  const steps = [];
  const step = (label) => { steps.push(label); console.log(`  ok: ${label}`); };
  const browser = await engine.launch({ headless: true });
  const errors = [];
  const external = [];
  const open = async (options = {}) => {
    const context = await browser.newContext({ viewport: { width: 1366, height: 768 }, ...options });
    const page = await context.newPage();
    page.on('pageerror', (e) => errors.push(e.message));
    page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
    page.on('request', (r) => { if (new URL(r.url()).origin !== ORIGIN) external.push(r.url()); });
    page.on('response', (r) => { if (r.status() >= 400) errors.push(`${r.status()}: ${r.url()}`); });
    await page.route('**/test/support/drivers.mjs', async (route) => route.fulfill({
      contentType: 'text/javascript',
      body: await readFile(new URL('test/support/drivers.mjs', root)),
    }));
    await page.goto(BASE);
    await page.waitForFunction(() => window.__miniDrifters);
    await page.waitForTimeout(120);
    return page;
  };
  const shoot = async (page, screen) => {
    for (const [width, height] of SIZES) {
      await page.setViewportSize({ width, height });
      await page.waitForTimeout(120);
      await page.screenshot({ path: artifact(`${name}-${screen}-${width}x${height}.png`) });
    }
    await page.setViewportSize({ width: 1366, height: 768 });
    await page.waitForTimeout(60);
  };

  let page;
  try {
    // --- What the title says ---------------------------------------------------------
    page = await open();
    assert.ok(await visible(page, 'menu'));
    assert.equal(await visible(page, 'hud'), false);
    assert.equal(await visible(page, 'help'), false);
    assert.equal((await page.locator('.title').textContent()).replace(/\s+/g, ' '), 'MINI DRIFTERS');
    assert.equal(await page.locator('.tagline').textContent(), 'ONE OVERPOWERED CAR. ZERO GOOD IDEAS.');
    const words = await page.locator('.title-menu button').evaluateAll((buttons) => buttons.map((b) => b.childNodes[0].textContent.trim().toUpperCase()));
    assert.deepEqual(words, ['START DRIVING', 'HOW TO PLAY', 'OPTIONS']);
    const shown = await page.locator('#menu').innerText();
    assert.doesNotMatch(shown, /\blaps?\b/i, 'the title does not promise a number of laps');
    assert.doesNotMatch(shown, /handbrake|accelerate|combo/i, 'the instructions have moved to How to Play');
    step('the title shows the approved name, tagline and three actions, and no instructions');

    // --- The layout, at each supported size -----------------------------------------
    for (const [width, height] of SIZES) {
      await page.setViewportSize({ width, height });
      await page.waitForTimeout(120);
      const layout = await titleLayout(page);
      assert.equal(layout.scrolls, false, `${width}x${height} scrolls`);
      for (const part of [layout.title, layout.tagline, ...layout.buttons]) {
        assert.ok(part.left >= 0 && part.top >= 0 && part.right <= width && part.bottom <= height, `${part.selector ?? 'text'} leaves ${width}x${height}`);
      }
      for (const button of layout.buttons) {
        assert.ok(button.reachable, `${button.selector} is covered at ${width}x${height}`);
        assert.equal(overlaps(button, layout.sound), false, `${button.selector} meets Sound`);
      }
      assert.ok(layout.buttons[0].top >= layout.tagline.bottom, 'the menu sits under the title');
      assert.ok(layout.buttons.every((b) => b.right <= width * 0.5), 'the menu stays on the left');
      // The car is the focal point: whole, clear of the panel and large in the frame. Its
      // paint alone is measured, since glass and stripes don't count.
      const car = await countPixels(page, CAR_BODY, 0.5, 1);
      assert.ok(car > width * height * 0.007, `${car} car pixels at ${width}x${height}`);
      const box = await carBox(page);
      assert.ok(box.left > width * 0.52 && box.right < width - 8 && box.top > 8 && box.bottom < height - 8, `the car is cut off at ${width}x${height}: ${JSON.stringify(box)}`);
      assert.ok(box.right - box.left > height * 0.25, `the car spans only ${box.right - box.left} px at ${width}x${height}`);
      assert.equal(await countPixels(page, GRASS), 0, 'the poster has no daytime grass');
    }
    await page.setViewportSize({ width: 1366, height: 768 });
    step('at 1920x1080, 1366x768 and 1024x600 nothing clips, overlaps or scrolls, and the whole car is the focal point');

    // --- Focus and keys on the title ------------------------------------------------
    assert.equal(await focused(page), 'start', 'Start is selected from the first frame');
    assert.ok(await focusRing(page), 'and shows it');
    await page.keyboard.press('ArrowDown');
    assert.equal(await focused(page), 'how-to-play');
    assert.ok(await focusRing(page), 'the selection shows while walking the menu');
    await page.keyboard.press('ArrowDown');
    assert.match(await focused(page), /options-open/);
    await page.keyboard.press('ArrowDown');
    assert.equal(await focused(page), 'start', 'Down wraps');
    await page.keyboard.press('ArrowUp');
    assert.match(await focused(page), /options-open/, 'Up wraps');
    await page.keyboard.press('ArrowUp');
    await page.keyboard.press('ArrowUp');
    assert.equal(await focused(page), 'start');
    assert.deepEqual((await game(page)).input, NO_KEYS, 'menu arrows are not pedals');

    await page.keyboard.press('Tab');
    assert.equal(await focused(page), 'how-to-play');
    await page.keyboard.press('Tab');
    assert.match(await focused(page), /options-open/);
    assert.ok(await focusRing(page), 'Tab shows the focus too');
    await page.keyboard.press('Tab');
    assert.equal(await focused(page), 'sound');
    await page.keyboard.press('Shift+Tab');
    await page.keyboard.press('Shift+Tab');
    await page.keyboard.press('Shift+Tab');
    assert.equal(await focused(page), 'start');
    for (const key of ['KeyR', 'KeyP', 'KeyG', 'KeyD', 'ArrowLeft', 'ArrowRight']) await page.keyboard.press(key);
    const idle = await game(page);
    assert.equal(idle.state, 'menu');
    assert.equal(idle.paused, false);
    assert.equal(idle.ticks, 0);
    assert.deepEqual(idle.input, NO_KEYS);
    step('Up, Down and Tab walk the menu with a visible focus, and game keys do nothing here');

    // --- How to Play --------------------------------------------------------------------
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('Enter');
    assert.ok(await visible(page, 'help'));
    assert.equal(await visible(page, 'menu'), false);
    assert.equal(await focused(page), 'help-back', 'focus moves to Back');
    assert.equal((await game(page)).state, 'menu', 'Enter on How to Play does not start a run');
    const help = await page.locator('#help').innerText();
    for (const heading of ['DRIVING', 'DRIFTING', 'SCORING', 'OTHER KEYS']) assert.ok(help.toUpperCase().includes(heading), heading);
    for (const fact of [/Accelerate/, /Brake, then reverse/, /Steer/, /handbrake/, /countersteer/i, /lift off the throttle/, /25°/, /within two seconds/, /×3/, /bank/]) assert.match(help, fact);
    for (const key of ['R', 'P', 'G', 'N', 'O', 'D']) assert.equal(await page.locator('#help-keys kbd', { hasText: new RegExp(`^${key}$`) }).count(), 1, key);
    assert.doesNotMatch(help, /three laps/i);
    await shoot(page, 'how-to-play');
    for (const [width, height] of SIZES) {
      await page.setViewportSize({ width, height });
      const fit = await page.evaluate(() => {
        const overlay = document.getElementById('help');
        const back = document.getElementById('help-back').getBoundingClientRect();
        return { scrolls: overlay.scrollHeight > overlay.clientHeight, bottom: back.bottom, right: back.right, sheetRight: overlay.querySelector('.sheet').getBoundingClientRect().right, soundLeft: document.getElementById('sound').getBoundingClientRect().left };
      });
      assert.equal(fit.scrolls, false, `How to Play scrolls at ${width}x${height}`);
      assert.ok(fit.bottom <= height);
      assert.ok(fit.sheetRight <= fit.soundLeft, `How to Play meets Sound at ${width}x${height}`);
    }
    await page.setViewportSize({ width: 1366, height: 768 });
    step('How to Play has the four sections, is accurate to the game and fits every size');

    const before = await station(page);
    for (const key of ['KeyR', 'KeyP', 'KeyG', 'KeyN', 'KeyO', 'KeyD', 'ArrowUp', 'ArrowDown']) await page.keyboard.press(key);
    assert.ok(await visible(page, 'help'));
    assert.equal(await visible(page, 'options'), false);
    assert.equal(await station(page), before, 'N is inert here');
    assert.equal((await game(page)).state, 'menu');
    assert.deepEqual((await game(page)).input, NO_KEYS);
    await page.mouse.click(1300, 700);
    assert.equal(await focused(page), 'BODY', 'a click off the sheet takes focus away from Back');
    await page.keyboard.press('Enter');
    assert.equal((await game(page)).state, 'menu', 'Enter with nothing focused stays on How to Play');
    assert.ok(await visible(page, 'help'));
    step('game keys, N and a stray Enter do nothing on How to Play');

    await page.keyboard.press('Escape');
    assert.equal(await visible(page, 'help'), false);
    assert.ok(await visible(page, 'menu'));
    assert.equal(await focused(page), 'how-to-play', 'Escape returns focus to the opener');
    await page.keyboard.press('Space');
    assert.ok(await visible(page, 'help'), 'Space presses the focused button');
    assert.equal((await game(page)).input.handbrake, false);
    await page.keyboard.press('Space');
    assert.equal(await visible(page, 'help'), false, 'Space presses Back');
    assert.equal(await focused(page), 'how-to-play');
    await page.keyboard.press('Enter');
    assert.ok(await visible(page, 'help'));
    await page.keyboard.press('Enter');
    assert.equal(await visible(page, 'help'), false, 'Enter presses Back');
    assert.equal(await focused(page), 'how-to-play');
    assert.equal((await game(page)).state, 'menu');

    // A held key repeats, and must not bounce between the screens, in either direction.
    assert.equal(await focused(page), 'how-to-play');
    for (let i = 0; i < 4; i++) await page.keyboard.down('Enter');
    await page.keyboard.up('Enter');
    assert.ok(await visible(page, 'help'), 'holding Enter on How to Play stays on How to Play');
    assert.equal(await focused(page), 'help-back');
    for (let i = 0; i < 4; i++) await page.keyboard.down('Enter');
    await page.keyboard.up('Enter');
    assert.equal(await visible(page, 'help'), false, 'holding Enter on Back stays on the title');
    assert.equal(await focused(page), 'how-to-play');
    await page.keyboard.press('Enter');
    await page.keyboard.press('Escape');

    await page.locator('#how-to-play').click();
    assert.ok(await visible(page, 'help'));
    await page.locator('#help-back').click();
    assert.ok(await visible(page, 'menu'));
    assert.equal(await focused(page), 'BODY', 'a mouse click leaves nothing focused');
    step('How to Play returns cleanly to the title by Escape, Enter, Space and mouse');

    // --- Options from the title ------------------------------------------------------
    await page.keyboard.press('ArrowUp');
    assert.match(await focused(page), /options-open/, 'the arrows pick up again with nothing focused');
    await page.keyboard.press('ArrowUp');
    assert.equal(await focused(page), 'how-to-play');
    await page.keyboard.press('KeyO');
    assert.ok(await visible(page, 'options'));
    assert.equal(await visible(page, 'menu'), false);
    await shoot(page, 'options');
    await page.keyboard.press('Escape');
    assert.ok(await visible(page, 'menu'));
    assert.equal(await focused(page), 'how-to-play', 'O and Escape go back to the same button');
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('Enter');
    assert.ok(await visible(page, 'options'), 'Enter presses Options');
    await page.keyboard.press('Escape');
    assert.match(await focused(page), /options-open/);
    await page.keyboard.press('ArrowDown');
    assert.equal(await focused(page), 'start');
    step('Options opens from the title and closes back to the button it came from');

    await page.keyboard.press('KeyN');
    assert.notEqual(await station(page), before, 'N still changes station on the title');
    await page.keyboard.press('KeyO');
    assert.equal(await page.locator('input[name=station]:checked').inputValue(), await station(page));
    await page.keyboard.press('Escape');
    step('N still changes station on the title, and Options shows the change');

    await shoot(page, 'title');
    await page.context().close();

    // --- Every way to start a run ------------------------------------------------------
    for (const [how, press] of Object.entries({
      'Enter': (p) => p.keyboard.press('Enter'),
      'Space on the focused button': (p) => p.keyboard.press('Space'),
      'the mouse': (p) => p.locator('#start').click(),
    })) {
      page = await open();
      await press(page);
      await page.waitForTimeout(250);
      const s = await game(page);
      assert.equal(s.state, 'ready', how);
      assert.equal(s.runTime, 0, how);
      assert.equal(s.speed, 0, how);
      assert.deepEqual(s.input, NO_KEYS, how);
      assert.equal(await visible(page, 'menu'), false);
      assert.ok(await visible(page, 'hud'));
      assert.equal(await focused(page), 'BODY', 'the keyboard goes straight to the car');
      await page.keyboard.down('Space');
      assert.equal((await game(page)).input.handbrake, true, 'Space is the handbrake again');
      await page.keyboard.up('Space');
      assert.equal(await visible(page, 'help'), false);
      assert.ok(await countPixels(page, GRASS) > 1000, 'the driving view is back to daylight');
      await page.context().close();
    }
    step('Enter, Space and the mouse all start a normal run, with the keyboard back on the car');

    // --- Pause and results ---------------------------------------------------------------
    page = await open();
    await page.keyboard.press('Enter');
    await page.keyboard.press('KeyP');
    assert.ok(await visible(page, 'paused'));
    assert.match(await page.locator('#paused').innerText(), /carry on/);
    await shoot(page, 'pause');
    const ticks = (await game(page)).ticks;
    await page.keyboard.press('Escape');
    assert.ok(await visible(page, 'paused'), 'Escape is not a second resume key');
    await page.keyboard.press('Tab');
    assert.match(await focused(page), /options-open/);
    await page.keyboard.press('Space');
    assert.ok(await visible(page, 'options'), 'Space presses Options on the pause screen');
    await shoot(page, 'options-from-pause');
    await page.keyboard.press('Escape');
    assert.ok(await visible(page, 'paused'));
    assert.match(await focused(page), /options-open/);
    assert.equal((await game(page)).paused, true);
    assert.equal((await game(page)).ticks, ticks);
    await page.keyboard.press('KeyP');
    await page.waitForTimeout(150);
    assert.equal(await visible(page, 'paused'), false);
    assert.ok((await game(page)).ticks > ticks);
    step('the pause screen keeps P, R and Options, and Options returns to it still paused');

    await page.keyboard.press('KeyR');
    await frameShowsGrid(page);
    await page.evaluate(async () => {
      const { driftDriver } = await import(new URL('test/support/drivers.mjs', document.baseURI).href);
      const { tick } = await import(new URL('src/game.js', document.baseURI).href);
      const { game: g } = window.__miniDrifters;
      const driver = driftDriver();
      while (g.state !== 'finished') tick(g, driver(g));
    });
    await page.waitForSelector('#results:not([hidden])');
    const results = await page.locator('#results').innerText();
    assert.match(results, /Run complete/i);
    assert.match(results, /Somehow, you made it/i);
    for (const id of ['remark', 'r-score', 'r-best', 'r-time', 'r-combo', 'r-spins']) {
      assert.ok((await page.locator(`#${id}`).textContent()).trim(), id);
    }
    await shoot(page, 'results');
    await page.keyboard.press('Tab');
    assert.equal(await focused(page), 'again');
    await page.keyboard.press('Tab');
    assert.match(await focused(page), /options-open/);
    await page.keyboard.press('Enter');
    assert.ok(await visible(page, 'options'), 'Enter presses Options on the results screen');
    await page.keyboard.press('Escape');
    assert.ok(await visible(page, 'results'));
    assert.match(await focused(page), /options-open/);
    await page.keyboard.press('Shift+Tab');
    assert.equal(await focused(page), 'again');
    await page.keyboard.press('Space');
    assert.equal((await game(page)).state, 'ready', 'Space presses Drive Again');
    assert.equal(await visible(page, 'results'), false);
    assert.equal(await focused(page), 'BODY');
    assert.deepEqual((await game(page)).input, NO_KEYS);
    step('results keep every statistic, and their buttons work with Tab, Enter and Space');

    // A driver mashing the handbrake across the line can't dismiss the results by accident.
    await frameShowsGrid(page);
    await page.evaluate(async () => {
      const { driftDriver } = await import(new URL('test/support/drivers.mjs', document.baseURI).href);
      const { tick } = await import(new URL('src/game.js', document.baseURI).href);
      const { game: g } = window.__miniDrifters;
      const driver = driftDriver();
      while (g.state !== 'finished') tick(g, driver(g));
    });
    await page.waitForSelector('#results:not([hidden])');
    await page.keyboard.press('Space');
    assert.equal((await game(page)).state, 'finished', 'Space with nothing focused does not start a run');
    assert.ok(await visible(page, 'results'));
    await page.keyboard.press('Enter');
    assert.equal((await game(page)).state, 'ready', 'Enter still does');
    step('Space with nothing focused leaves the results up, and Enter still drives again');
    await page.context().close();

    // --- The moving picture ------------------------------------------------------------
    const frameStamp = (p) => p.evaluate(() => {
      const c = document.getElementById('view');
      return Array.from(c.getContext('2d').getImageData(Math.round(c.width * 0.5), 0, Math.round(c.width * 0.5), c.height).data.filter((_, i) => i % 97 === 0)).join();
    });
    page = await open();
    const first = await frameStamp(page);
    await page.waitForTimeout(300);
    assert.notEqual(await frameStamp(page), first, 'the smoke moves');
    await page.context().close();
    page = await open({ reducedMotion: 'reduce' });
    const still = await frameStamp(page);
    await page.waitForTimeout(300);
    assert.equal(await frameStamp(page), still, 'nothing moves');
    assert.ok(await countPixels(page, CAR_BODY, 0.5, 1) > 1000, 'the still picture still has its car');
    await page.context().close();
    step('the title animates quietly, and holds still under reduced motion');

    assert.deepEqual(errors, [], 'no page or console errors');
    assert.deepEqual(external, [], 'no external requests');
    step('no page errors, console errors or external requests');
    return { name, version: browser.version(), passed: true, steps };
  } catch (error) {
    await page?.screenshot({ path: artifact(`${name}-failure.png`) }).catch(() => {});
    return { name, version: browser.version(), passed: false, error: error.message, errors, steps };
  } finally {
    await browser.close();
  }
}

const report = [];
try {
  for (const [name, engine] of Object.entries({ chromium, firefox })) report.push(await check(name, engine));
} finally {
  server.close();
}
await writeFile(artifact('report.json'), JSON.stringify(report, null, 2));
for (const r of report) console.log(`${r.name} ${r.version}: ${r.passed ? 'PASSED' : `FAILED: ${r.error}`}`);
process.exit(report.every((r) => r.passed) ? 0 : 1);
