// The driving lesson and Return to Title in real browsers: real keys, real clicks and the
// real simulation, served the same way as on GitHub Pages. Needs Playwright:
//   node test/tutorial-browser.mjs [/path/to/playwright/index.mjs]
// The lesson is played with a scripted driver that decides from the car's live state and
// presses keys through the browser. No test here writes to the scoring or the lesson.
// Screenshots of each stage go to artifacts/.
import assert from 'node:assert/strict';
import http from 'node:http';
import { mkdir, readFile, readdir } from 'node:fs/promises';
import { extname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { RADIO_FILES } from '../src/radio-stations.js';
import { TUTORIAL_STEPS } from '../src/tutorial.js';

const { chromium, firefox } = await import(process.argv[2] ? pathToFileURL(process.argv[2]) : 'playwright');

const root = new URL('../', import.meta.url);
const artifact = (name) => fileURLToPath(new URL(`artifacts/tutorial-${name}`, root));
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
const KEY_NAMES = { up: 'ArrowUp', down: 'ArrowDown', left: 'ArrowLeft', right: 'ArrowRight', handbrake: 'Space' };
const LESSON_SECONDS = 150;

const visible = (page, id) => page.locator(`#${id}`).isVisible();
const focused = (page) => page.evaluate(() => {
  const el = document.activeElement;
  return el?.id || el?.className || el?.tagName;
});
const game = (page) => page.evaluate(() => {
  const m = window.__miniDrifters;
  const g = m.game;
  return {
    state: g.state,
    paused: g.paused,
    ticks: g.ticks,
    runId: g.runId,
    runTime: g.runTime,
    speed: g.car.speed,
    score: g.scoring.score,
    ghost: !!g.ghost,
    ghostVisible: g.ghostVisible,
    input: { ...m.input },
    tutorial: m.tutorial(),
  };
});
const prompt = (page) => page.locator('#prompt').innerText();
// Tab has to start at the top of a sheet, whatever had focus before. A pause or results sheet
// has only a few buttons, so anything taking longer than this has wandered off into the page.
const tabTo = async (page, pattern) => {
  for (let i = 0; i < 3; i += 1) {
    await page.keyboard.press('Tab');
    if (pattern.test(await focused(page))) return;
  }
  assert.fail(`Tab did not reach ${pattern}, and got to ${await focused(page)}`);
};
const stepOf = (t) => TUTORIAL_STEPS[t.step].id;

// Everything the lesson's prompt must stay clear of while driving, at the current size.
const promptLayout = (page) => page.evaluate(() => {
  const el = document.getElementById('prompt');
  const box = (node) => {
    const r = node.getBoundingClientRect();
    return { left: r.left, right: r.right, top: r.top, bottom: r.bottom };
  };
  const others = {};
  for (const selector of ['.panel.laps', '.panel.score', '.panel.gauges', '#sound', '#radio-status', '.combo', '#banner']) {
    const node = document.querySelector(selector);
    if (node && node.getClientRects().length) others[selector] = box(node);
  }
  return {
    prompt: box(el),
    others,
    width: innerWidth,
    height: innerHeight,
    clipped: [...el.children].some((part) => part.scrollWidth > part.clientWidth + 1),
    scrolls: document.documentElement.scrollHeight > innerHeight || document.documentElement.scrollWidth > innerWidth,
  };
});
const overlaps = (a, b) => a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom;
const assertPromptFits = async (page, where) => {
  const layout = await promptLayout(page);
  const { prompt: p, width, height } = layout;
  assert.ok(p.left >= 0 && p.right <= width && p.top >= 0 && p.bottom <= height, `${where}: prompt leaves the window ${JSON.stringify(p)}`);
  assert.equal(layout.clipped, false, `${where}: prompt text is clipped`);
  assert.equal(layout.scrolls, false, `${where}: the page scrolls`);
  for (const [name, other] of Object.entries(layout.others)) {
    assert.equal(overlaps(p, other), false, `${where}: prompt covers ${name}`);
  }
};

// Every button on a sheet has to be on screen and pressable at the current size.
const assertSheetFits = async (page, id, where) => {
  const problems = await page.evaluate((sheetId) => {
    const out = [];
    const sheet = document.getElementById(sheetId);
    for (const button of sheet.querySelectorAll('button')) {
      if (!button.getClientRects().length) continue;
      const r = button.getBoundingClientRect();
      const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
      if (r.left < 0 || r.top < 0 || r.right > innerWidth || r.bottom > innerHeight) out.push(`${button.textContent.trim()} leaves the window`);
      else if (!(hit === button || button.contains(hit))) out.push(`${button.textContent.trim()} is covered`);
    }
    if (sheet.scrollHeight > sheet.clientHeight + 1) out.push('the sheet scrolls');
    return out;
  }, id);
  assert.deepEqual(problems, [], where);
};

// The title, as if nothing had happened. `heldKeys` are still physically down.
async function assertCleanTitle(page, where) {
  await page.waitForTimeout(60);
  const g = await game(page);
  assert.equal(g.state, 'menu', where);
  assert.equal(g.paused, false, where);
  assert.equal(g.score, 0, where);
  assert.equal(g.runTime, 0, where);
  assert.equal(g.tutorial, null, `${where}: the lesson has ended`);
  assert.deepEqual(g.input, NO_KEYS, `${where}: no keys are held`);
  assert.ok(await visible(page, 'menu'), `${where}: the title shows`);
  for (const id of ['hud', 'prompt', 'banner', 'paused', 'results', 'options', 'help', 'tutorial-done']) {
    assert.equal(await visible(page, id), false, `${where}: #${id} is gone`);
  }
  assert.equal(await page.evaluate(() => document.body.dataset.screen), 'title', where);
  assert.equal(await focused(page), 'start', `${where}: the keyboard is on Start Driving`);
  const audio = await page.evaluate(() => window.__miniDrifters.audio());
  assert.equal(audio.mode, 'silent', `${where}: the engine has stopped`);
  await page.waitForTimeout(120);
  assert.equal((await game(page)).ticks, g.ticks, `${where}: no physics is running`);
}

// What a normal run looks like, straight after whatever came before.
async function assertNormalRunWorks(page, where) {
  const g = await game(page);
  assert.equal(g.state, 'ready', where);
  assert.equal(g.tutorial, null, where);
  assert.equal(g.ghost, true, `${where}: a normal run records its ghost`);
  assert.equal(g.score, 0, where);
  assert.equal(g.runTime, 0, where);
  assert.ok(await visible(page, 'hud'), where);
  assert.ok(await visible(page, 'ghost-status'), `${where}: the ghost note is back`);
  // The prompt is drawn with the next frame, like the rest of the HUD.
  await page.waitForSelector('#prompt:not([hidden])');
  assert.equal(await page.locator('#prompt').textContent(), 'Press ↑ to go. The clock starts when you move.', where);
  await page.keyboard.down('ArrowUp');
  await page.waitForFunction(() => window.__miniDrifters.game.state === 'racing' && window.__miniDrifters.game.car.speed > 3);
  await page.keyboard.up('ArrowUp');
}

async function check(name, engine) {
  console.log(`Checking ${name}...`);
  const steps = [];
  const step = (label) => { steps.push(label); console.log(`  ok: ${label}`); };
  const browser = await engine.launch({ headless: true });
  const guardTested = [];
  const errors = [];
  const external = [];
  const open = async (viewport = { width: 1366, height: 768 }) => {
    const context = await browser.newContext({ viewport });
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
    await page.waitForTimeout(100);
    return page;
  };
  const openTutorial = async (page) => {
    await page.keyboard.press('ArrowDown');
    assert.equal(await focused(page), 'how-to-play');
    await page.keyboard.press('Enter');
    assert.ok(await visible(page, 'help'));
    assert.equal(await focused(page), 'help-back');
    await page.keyboard.press('Tab');
    assert.equal(await focused(page), 'help-try');
    await page.keyboard.press('Enter');
    await page.waitForSelector('#prompt:not([hidden])');
  };

  // Plays with real key presses until `until` says so, deciding from the car's live state.
  // Reaction time comes from the round trip to the page, and mistakes just mean another go.
  const playLesson = async (page, { until, onStep }) => {
    await page.evaluate(async () => {
      const { lessonDriver } = await import(new URL('test/support/drivers.mjs', document.baseURI).href);
      const { TUTORIAL_STEPS: ids } = await import(new URL('src/tutorial.js', document.baseURI).href);
      const driver = lessonDriver();
      window.__decide = () => {
        const m = window.__miniDrifters;
        const t = m.tutorial();
        if (!t) return null;
        return { keys: driver(m.game, ids[t.step].id), step: t.step, phase: t.phase };
      };
    });
    const held = new Set();
    const release = async () => {
      for (const key of held) await page.keyboard.up(KEY_NAMES[key]);
      held.clear();
    };
    const deadline = Date.now() + LESSON_SECONDS * 1000;
    let shown = -1;
    for (;;) {
      assert.ok(Date.now() < deadline, `the lesson finished within ${LESSON_SECONDS} s`);
      const now = await page.evaluate(() => window.__decide());
      if (!now) break;
      if (now.step !== shown && now.phase === 'driving') {
        shown = now.step;
        if (onStep) await onStep(now.step);
      }
      if (until?.(now)) break;
      for (const key of Object.keys(KEY_NAMES)) {
        if (now.keys[key] && !held.has(key)) {
          held.add(key);
          await page.keyboard.down(KEY_NAMES[key]);
        } else if (!now.keys[key] && held.has(key)) {
          held.delete(key);
          await page.keyboard.up(KEY_NAMES[key]);
        }
      }
      await page.waitForTimeout(12);
    }
    return release;
  };

  let page;
  try {
    // --- It's optional ----------------------------------------------------------------
    page = await open();
    assert.equal((await game(page)).tutorial, null, 'no lesson on first load');
    assert.equal(await visible(page, 'prompt'), false);
    await page.keyboard.press('Enter');
    await assertNormalRunWorks(page, 'Enter on the title');
    assert.equal((await game(page)).tutorial, null);
    await page.context().close();
    step('nothing starts by itself, and Start Driving is still the normal game');

    // --- Getting in -------------------------------------------------------------------
    page = await open();
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('Enter');
    assert.equal(await focused(page), 'help-back', 'Back keeps the focus it had');
    await page.keyboard.press('Escape');
    assert.equal(await visible(page, 'help'), false);
    assert.equal(await focused(page), 'how-to-play');
    await page.keyboard.press('Enter');
    await page.keyboard.press('Tab');
    assert.equal(await focused(page), 'help-try');
    const before = (await game(page)).runId;
    // Held Enter: the first press launches, and the repeats press nothing.
    await page.keyboard.down('Enter');
    await page.keyboard.down('Enter');
    await page.keyboard.down('Enter');
    await page.keyboard.up('Enter');
    let g = await game(page);
    assert.equal(g.runId, before + 1, 'one launch from a held Enter');
    assert.equal(g.state, 'ready');
    assert.equal(stepOf(g.tutorial), 'accelerate');
    assert.equal(g.ghost, false, 'a lesson records no ghost');
    assert.equal(await focused(page), 'BODY', 'the keyboard goes to the car');
    assert.deepEqual(g.input, NO_KEYS);
    assert.ok(await visible(page, 'hud'), 'the real HUD');
    assert.equal(await visible(page, 'help'), false);
    assert.equal(await visible(page, 'ghost-status'), false, 'no ghost note in a lesson');
    await page.waitForSelector('#prompt:not([hidden])');
    assert.match(await prompt(page), /Step 1 of 5/i);
    assert.match(await prompt(page), /FIRST, MAKE IT MOVE\./);
    assert.match(await prompt(page), /Hold ↑ to accelerate\./);
    assert.match(await prompt(page), /Esc exit/);
    const visibleGhost = g.ghostVisible;
    await page.keyboard.press('KeyG');
    assert.equal((await game(page)).ghostVisible, visibleGhost, 'G leaves the ghost setting alone');
    await page.context().close();

    page = await open();
    await page.locator('#how-to-play').click();
    await page.locator('#help-try').click();
    g = await game(page);
    assert.equal(stepOf(g.tutorial), 'accelerate');
    assert.equal(await focused(page), 'BODY');
    await page.context().close();
    step('Try It launches the lesson from How to Play by keyboard and mouse, and Back still works');

    // --- Keys that aren't driving ----------------------------------------------------
    page = await open();
    await openTutorial(page);
    await page.waitForTimeout(600);
    g = await game(page);
    assert.equal(stepOf(g.tutorial), 'accelerate', 'waiting does not advance a step');
    await page.keyboard.press('ArrowUp');
    await page.keyboard.press('ArrowLeft');
    await page.keyboard.press('Space');
    await page.waitForTimeout(200);
    assert.equal(stepOf((await game(page)).tutorial), 'accelerate', 'tapping the keys does not either');
    await page.context().close();
    step('time and bare key presses do not pass a step');

    // --- Three whole lessons, one at each size ---------------------------------------
    for (const [index, [width, height]] of SIZES.entries()) {
      page = await open({ width, height });
      assert.equal(await page.evaluate(() => document.body.dataset.screen), 'title');
      // How to Play now has a second button, and has to hold it at every size.
      await page.keyboard.press('ArrowDown');
      await page.keyboard.press('Enter');
      await assertSheetFits(page, 'help', `How to Play at ${width}x${height}`);
      await page.screenshot({ path: artifact(`${name}-how-to-play-${width}x${height}.png`) });
      await page.keyboard.press('Escape');
      await page.keyboard.press('ArrowUp');
      await openTutorial(page);
      const seen = [];
      const release = await playLesson(page, {
        until: (now) => now.phase === 'banked',
        onStep: async (number) => {
          seen.push(number);
          const { title, text } = TUTORIAL_STEPS[number];
          const shown = await prompt(page);
          assert.ok(shown.includes(title), `step ${number + 1} shows its title: ${shown}`);
          assert.ok(shown.includes(text), `step ${number + 1} shows its text: ${shown}`);
          assert.match(shown, new RegExp(`Step ${number + 1} of 5`, 'i'));
          await assertPromptFits(page, `step ${number + 1} at ${width}x${height}`);
          await page.screenshot({ path: artifact(`${name}-step-${number + 1}-${TUTORIAL_STEPS[number].id}-${width}x${height}.png`) });
        },
      });

      // The banked moment, with the car still rolling under the player.
      g = await game(page);
      assert.equal(g.tutorial.phase, 'banked');
      assert.ok(g.tutorial.bankedPoints > 0);
      assert.ok(g.score >= g.tutorial.bankedPoints, 'the points are in the real score');
      const amount = g.tutorial.bankedPoints.toLocaleString('en-US');
      await page.waitForFunction(() => !document.getElementById('prompt').hidden && /BANKED/.test(document.getElementById('prompt').textContent));
      assert.match(await prompt(page), new RegExp(`\\+${amount} BANKED`));
      await assertPromptFits(page, `banked at ${width}x${height}`);
      await page.screenshot({ path: artifact(`${name}-banked-${width}x${height}.png`) });
      await release();

      // Times the first key to arrive after the ending appears, to know the guard was on trial.
      await page.evaluate(() => {
        window.__doneAt = null;
        window.__keyAfter = null;
        const sheet = document.getElementById('tutorial-done');
        new MutationObserver(() => {
          if (!sheet.hidden && window.__doneAt === null) window.__doneAt = performance.now();
        }).observe(sheet, { attributes: true });
        window.addEventListener('keydown', (e) => {
          if (!e.repeat && window.__doneAt !== null && window.__keyAfter === null) window.__keyAfter = performance.now() - window.__doneAt;
        }, { capture: true });
      });
      // In one lesson, the driver's thumb is still on the handbrake when the ending appears.
      if (index === 1) await page.keyboard.down('Space');

      await page.waitForSelector('#tutorial-done:not([hidden])', { timeout: 20000 });
      // Keys meant for the car, the moment the ending appears: none may press anything.
      if (index > 0) {
        await page.keyboard.press(index === 1 ? 'Enter' : 'Space');
        const late = await page.evaluate(() => window.__keyAfter);
        assert.ok(late !== null, 'the page saw the key');
        await page.waitForTimeout(40);
        if (late < 450) assert.ok(await visible(page, 'tutorial-done'), `a key ${Math.round(late)} ms in is ignored`);
        else console.log(`  note: the key took ${Math.round(late)} ms to arrive, past the guard, so the guard went untested this time`);
        guardTested.push(late < 450);
        if (index === 1) {
          await page.keyboard.up('Space');
          await page.waitForTimeout(40);
          assert.ok(await visible(page, 'tutorial-done') || late >= 450, 'releasing a held handbrake presses nothing');
        }
      }
      assert.deepEqual(seen, [0, 1, 2, 3, 4], 'every step, in order');
      const banked = await page.locator('#done-banked').textContent();
      assert.match(banked, /You banked [\d,]+ points\./);
      assert.equal(await page.locator('#done-title').textContent(), 'YOU ARE NOW QUALIFIED TO BE DANGEROUS.');
      assert.equal(await page.locator('#done-text').textContent(), 'The tyres have requested a transfer.');
      await assertSheetFits(page, 'tutorial-done', `the ending at ${width}x${height}`);
      assert.equal(await focused(page), 'done-start');
      for (const id of ['hud', 'prompt', 'menu', 'banner']) assert.equal(await visible(page, id), false, `#${id} at the ending`);
      g = await game(page);
      assert.equal(g.state, 'menu', 'nothing is running behind the ending');
      assert.equal(g.tutorial, null);
      assert.deepEqual(g.input, NO_KEYS);
      await page.screenshot({ path: artifact(`${name}-ending-${width}x${height}.png`) });

      if (index === 0) {
        // Start Driving: a clean normal run, with every trace of the lesson gone.
        await page.waitForTimeout(600);
        await page.keyboard.press('Enter');
        await assertNormalRunWorks(page, 'Start Driving from the ending');
        assert.equal(await visible(page, 'tutorial-done'), false);
        assert.equal(await focused(page), 'BODY');
      } else if (index === 1) {
        // A deliberate press, held: one run starts, and the repeats press nothing more.
        await page.waitForTimeout(600);
        const run = (await game(page)).runId;
        await page.keyboard.down('Enter');
        await page.keyboard.down('Enter');
        await page.keyboard.down('Enter');
        await page.keyboard.up('Enter');
        assert.equal((await game(page)).runId, run + 1, 'one run from a held Enter');
        await assertNormalRunWorks(page, 'Start Driving after a held Enter');
      } else {
        await page.waitForTimeout(600);
        await page.keyboard.press('Escape');
        await assertCleanTitle(page, 'Esc from the ending');
      }
      await page.context().close();
    }
    step('a whole lesson can be finished with real keys at 1920x1080, 1366x768 and 1024x600');
    step('each step shows its words and clears the HUD, and the ending shows real banked points');
    assert.ok(guardTested.includes(true) || process.env.CI, 'the Enter guard was exercised');
    step('a held handbrake or a stray Enter cannot press a button on the ending');

    // --- The longest thing the prompt ever says ---------------------------------------
    page = await open();
    await openTutorial(page);
    // Only the words on screen change, to measure the worst case. The lesson is not touched.
    await page.evaluate(() => {
      const parts = document.getElementById('prompt').children;
      parts[1].textContent = 'POINTS ARE ONLY YOURS WHEN BANKED.';
      parts[2].textContent = 'Steer into a corner. Tap SPACE to loosen the rear tyres.';
      const hint = document.createElement('span');
      hint.className = 'lesson-hint';
      hint.textContent = 'Lost 12,345: stopped making progress. Slide again, then keep it clean.';
      parts[2].after(hint);
      document.getElementById('prompt').lastElementChild.textContent = 'Stuck? Press P, and you can skip this step from there.';
    });
    for (const [width, height] of SIZES) {
      await page.setViewportSize({ width, height });
      await page.waitForTimeout(120);
      await assertPromptFits(page, `the longest prompt at ${width}x${height}`);
      await page.screenshot({ path: artifact(`${name}-longest-prompt-${width}x${height}.png`) });
    }
    await page.context().close();
    step('the longest prompt fits at every size without covering the HUD');

    // --- Pause inside a lesson --------------------------------------------------------
    page = await open();
    await openTutorial(page);
    await page.keyboard.down('ArrowUp');
    await page.waitForFunction(() => window.__miniDrifters.tutorial()?.step === 1);
    await page.keyboard.press('KeyP');
    g = await game(page);
    assert.equal(g.paused, true);
    assert.deepEqual(g.input, NO_KEYS, 'pausing clears the held pedal, as it always has');
    assert.ok(await visible(page, 'paused'));
    await page.waitForTimeout(60);
    assert.equal(await visible(page, 'prompt'), false, 'the sheet stands alone');
    assert.match(await page.locator('#paused-note').innerText(), /keep your place/);
    assert.ok(await visible(page, 'tutorial-skip'));
    for (const [width, height] of SIZES) {
      await page.setViewportSize({ width, height });
      await page.waitForTimeout(60);
      await assertSheetFits(page, 'paused', `lesson pause at ${width}x${height}`);
      await page.screenshot({ path: artifact(`${name}-pause-${width}x${height}.png`) });
    }
    await page.setViewportSize({ width: 1366, height: 768 });
    await page.keyboard.up('ArrowUp');
    await page.keyboard.press('Escape');
    assert.ok(await visible(page, 'paused'), 'Esc is not a way off the pause screen by accident');
    await page.keyboard.press('KeyO');
    assert.ok(await visible(page, 'options'), 'Options opens from a lesson pause');
    await page.keyboard.press('Escape');
    assert.ok(await visible(page, 'paused'));
    const stationBefore = (await page.evaluate(() => window.__miniDrifters.audio())).station;
    await page.keyboard.press('KeyN');
    assert.notEqual((await page.evaluate(() => window.__miniDrifters.audio())).station, stationBefore, 'N changes station in a lesson');
    const pausedTicks = (await game(page)).ticks;
    await page.waitForTimeout(150);
    g = await game(page);
    assert.equal(g.ticks, pausedTicks, 'nothing moves');
    assert.equal(stepOf(g.tutorial), 'steer');
    await page.keyboard.press('KeyP');
    await page.waitForFunction(() => !window.__miniDrifters.game.paused && !document.getElementById('prompt').hidden);
    assert.match(await prompt(page), /NOW TRY THE WHEEL\./);
    assert.equal(await visible(page, 'paused'), false);
    step('pause holds the car and the lesson, Options and N work, and P carries on from the same step');

    // R goes back to the grid and keeps the place.
    const runBefore = (await game(page)).runId;
    await page.keyboard.press('KeyR');
    g = await game(page);
    assert.equal(g.runId, runBefore + 1);
    assert.equal(g.state, 'ready');
    assert.equal(g.ghost, false, 'still no ghost after a restart');
    assert.equal(stepOf(g.tutorial), 'steer');
    await page.waitForFunction(() => /Hold ↑ to get rolling/.test(document.getElementById('prompt').textContent));
    step('R returns to the grid and keeps the step');

    // Losing focus pauses it, as in a normal run.
    await page.evaluate(() => window.dispatchEvent(new Event('blur')));
    assert.equal((await game(page)).paused, true);
    assert.ok(await visible(page, 'paused'));
    assert.equal(stepOf((await game(page)).tutorial), 'steer');
    step('losing focus pauses the lesson safely');

    // Skipping, from the pause sheet, by keyboard.
    await tabTo(page, /tutorial-skip/);
    await page.keyboard.press('Enter');
    g = await game(page);
    assert.equal(stepOf(g.tutorial), 'slide');
    assert.equal(g.paused, false, 'the skip goes back to driving');
    assert.equal(await focused(page), 'BODY');
    for (let i = 0; i < 3; i += 1) {
      await page.keyboard.press('KeyP');
      await page.locator('#tutorial-skip').click();
    }
    await page.waitForSelector('#tutorial-done:not([hidden])');
    assert.equal(await page.locator('#done-title').textContent(), 'THAT WILL DO FOR NOW.');
    assert.doesNotMatch(await page.locator('#tutorial-done').innerText(), /QUALIFIED/i);
    assert.match(await page.locator('#done-text').textContent(), /You skipped 4 steps/);
    assert.equal(await page.locator('#done-banked').textContent(), '');
    await page.screenshot({ path: artifact(`${name}-ending-skipped-1366x768.png`) });
    step('steps can be skipped, and the ending says so rather than qualifying anyone');

    // Practice Again starts over, by Tab and Space.
    await page.waitForTimeout(600);
    await page.keyboard.press('Tab');
    assert.equal(await focused(page), 'done-again');
    await page.keyboard.press('Space');
    g = await game(page);
    assert.equal(stepOf(g.tutorial), 'accelerate');
    assert.deepEqual(g.tutorial.skipped, []);
    assert.equal(g.state, 'ready');
    assert.equal(await visible(page, 'tutorial-done'), false);
    assert.equal(await focused(page), 'BODY');
    step('Practice Again starts the lesson over from a clean slate');

    // --- Three laps can't end a lesson -------------------------------------------------
    // Real ticks on the road, at a pace too gentle to slide, past the end of a whole run.
    await page.evaluate(async () => {
      const { gripDriver } = await import(new URL('test/support/drivers.mjs', document.baseURI).href);
      const { tick } = await import(new URL('src/game.js', document.baseURI).href);
      const { game: run } = window.__miniDrifters;
      const driver = gripDriver();
      while (run.state !== 'finished') {
        const keys = driver(run);
        tick(run, { ...keys, up: keys.up && run.car.speed < 12 });
      }
    });
    await page.waitForFunction(() => window.__miniDrifters.game.state === 'ready');
    await page.waitForFunction(() => /Three laps done/.test(document.getElementById('prompt').textContent));
    g = await game(page);
    assert.ok(g.tutorial, 'the lesson carries on');
    assert.equal(g.tutorial.phase, 'driving');
    assert.equal(g.score, 0, 'on a fresh run');
    assert.equal(g.ghost, false, 'still with no ghost');
    assert.equal(await visible(page, 'results'), false, 'no results for a lesson');
    await page.screenshot({ path: artifact(`${name}-three-laps-1366x768.png`) });
    step('three laps in a lesson go back to the grid and carry on, with no results screen');

    // --- Return to Title, from everywhere --------------------------------------------
    // Esc mid-lesson, with the pedal still physically down.
    await page.keyboard.down('ArrowUp');
    await page.waitForFunction(() => window.__miniDrifters.game.car.speed > 5);
    await page.keyboard.press('Escape');
    await assertCleanTitle(page, 'Esc from a moving lesson');
    await page.keyboard.down('ArrowUp'); // the repeat of the key that's still down
    assert.equal(await focused(page), 'start', 'a repeating arrow does not walk the menu');
    await page.keyboard.up('ArrowUp');
    assert.equal((await game(page)).state, 'menu');
    await page.keyboard.press('KeyR');
    await page.keyboard.press('KeyP');
    assert.equal((await game(page)).state, 'menu', 'R and P do nothing on the title');
    await page.keyboard.press('Enter');
    await assertNormalRunWorks(page, 'a run after leaving a lesson');
    step('Esc leaves a lesson at any moment, with held keys cleared, and a normal run follows');

    // From a normal pause, by keyboard, with a held Enter.
    await page.keyboard.press('KeyP');
    assert.ok(await visible(page, 'paused'));
    assert.equal(await visible(page, 'tutorial-skip'), false, 'no skip outside a lesson');
    assert.match(await page.locator('#paused-note').innerText(), /start over/);
    await tabTo(page, /return-title/);
    await page.keyboard.down('Enter');
    await page.keyboard.down('Enter');
    await page.keyboard.up('Enter');
    await assertCleanTitle(page, 'a normal pause, with Enter held');
    step('Return to Title works from a normal pause, and a held Enter does not start a run');

    // From a lesson pause, by mouse, with the handbrake down throughout.
    await openTutorial(page);
    await page.keyboard.press('KeyP');
    await page.keyboard.down('Space');
    await page.locator('#paused .return-title').click();
    await page.waitForTimeout(40);
    await page.keyboard.up('Space');
    await assertCleanTitle(page, 'a lesson pause by mouse, with Space held');
    step('Return to Title works from a lesson pause, and a held handbrake does not press Start');

    // A station chosen in a lesson survives, and the sound comes back for the next run.
    const station = (await page.evaluate(() => window.__miniDrifters.audio())).station;
    assert.notEqual(station, stationBefore, 'the station chosen during the lesson is kept');
    await page.keyboard.press('Enter');
    await assertNormalRunWorks(page, 'sound after returning to the title');
    const live = await page.evaluate(() => window.__miniDrifters.audio());
    assert.equal(live.station, station);
    if (!live.failure) assert.equal(live.mode, 'live', 'the engine is back for the next run');
    step('radio and engine sound carry on correctly after returning to the title');

    // From the results of a real, whole run. The driver here is the one the other suites use.
    await page.keyboard.press('KeyR');
    await page.evaluate(async () => {
      const { driftDriver } = await import(new URL('test/support/drivers.mjs', document.baseURI).href);
      const { tick } = await import(new URL('src/game.js', document.baseURI).href);
      const { game: run } = window.__miniDrifters;
      const driver = driftDriver();
      while (run.state !== 'finished') tick(run, driver(run));
    });
    await page.waitForSelector('#results:not([hidden])');
    for (const [width, height] of SIZES) {
      await page.setViewportSize({ width, height });
      await page.waitForTimeout(60);
      await assertSheetFits(page, 'results', `results at ${width}x${height}`);
      await page.screenshot({ path: artifact(`${name}-results-${width}x${height}.png`) });
    }
    await page.setViewportSize({ width: 1366, height: 768 });
    await tabTo(page, /return-title/);
    await page.keyboard.press('Space');
    await assertCleanTitle(page, 'the results');
    await page.keyboard.press('Enter');
    await assertNormalRunWorks(page, 'a run after the results');
    const ghostIsFresh = await page.evaluate(() => window.__miniDrifters.game.ghost.replay === null);
    assert.ok(ghostIsFresh, 'no ghost carried over from the finished run');
    step('Return to Title works from the results, and the next run starts clean');
    await page.context().close();

    // Pause from a run that's still on the grid, by mouse.
    page = await open();
    await page.keyboard.press('Enter');
    await page.keyboard.press('KeyP');
    await page.locator('#paused .return-title').click();
    await assertCleanTitle(page, 'a pause on the grid, by mouse');
    await page.context().close();

    assert.deepEqual(errors, [], 'no page or console errors');
    assert.deepEqual(external, [], 'no external requests');
    step('no page errors, console errors or external requests');
    return { name, version: browser.version(), passed: true, steps };
  } catch (error) {
    if (page && !page.isClosed()) await page.screenshot({ path: artifact(`${name}-failure.png`) }).catch(() => {});
    return { name, version: browser.version(), passed: false, steps, error: error.stack };
  } finally {
    await browser.close();
  }
}

const results = [await check('chromium', chromium), await check('firefox', firefox)];
server.close();
for (const r of results) {
  console.log(`${r.name} ${r.version}: ${r.passed ? 'PASSED' : `FAILED after "${r.steps.at(-1) ?? 'start'}"\n${r.error}`}`);
}
process.exit(results.every((r) => r.passed) ? 0 : 1);
