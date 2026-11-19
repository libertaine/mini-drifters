// v0.6.0 R1 environment on the real page, in Chromium and Firefox: Dockyard chosen by keyboard in
// Classic and in Power; its apron drives as concrete and is off the course; a container stops the
// car; the debug view (D) shows the collision boxes, the course flag and the last contact, and
// none of it is drawn or shown in normal driving. Only the frame clock is mocked. The origin is a
// throwaway one on a random port, so no saved records anywhere are touched.
//   node test/environment-browser.mjs /path/to/playwright/index.mjs
import assert from 'node:assert/strict';
import http from 'node:http';
import { readFile, mkdir } from 'node:fs/promises';
import { extname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const { chromium, firefox } = await import(process.argv[2] ? pathToFileURL(process.argv[2]) : 'playwright');
const root = new URL('../', import.meta.url);
await mkdir(new URL('artifacts/', root), { recursive: true });
const shot = (name) => fileURLToPath(new URL(`artifacts/environment-${name}.png`, root));
const TYPES = { '.html': 'text/html', '.css': 'text/css', '.js': 'text/javascript', '.mp3': 'audio/mpeg', '.wav': 'audio/wav' };
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

function harness() {
  window.requestAnimationFrame = (callback) => { window.__nextFrame = callback; return 1; };
  let now;
  window.__frames = (count = 2, dt = 1000 / 60) => {
    now ??= performance.now();
    for (let i = 0; i < count; i++) { now += dt; window.__nextFrame(now); }
  };
}

// The debug outline colour (render.js drawDebugContact). Counted in the canvas around a container.
const ORANGE = [255, 140, 60];

async function check(name, engine) {
  const browser = await engine.launch({ headless: true });
  const ok = (message) => console.log(`${name}: ${message}`);
  const errors = [];
  try {
    const context = await browser.newContext({ viewport: { width: 1366, height: 768 } });
    await context.addInitScript(harness);
    const page = await context.newPage();
    page.on('pageerror', (e) => errors.push(e.message));
    page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
    const value = (fn, arg) => page.evaluate(fn, arg);
    const frames = (n = 2) => value((k) => window.__frames(k), n);
    const key = async (code) => { await page.keyboard.press(code); await frames(2); };
    const hold = async (keys, n) => { await value((k) => Object.assign(window.__miniDrifters.input, k), keys); await frames(n); await value(() => { const i = window.__miniDrifters.input; for (const k of Object.keys(i)) i[k] = false; }); };
    const status = () => value(() => {
      const { game: g } = window.__miniDrifters;
      return { state: g.state, track: g.track.id, handling: g.handling.id, surface: g.car.surface, onCourse: g.onCourse, traction: g.car.traction,
        speed: g.car.speed, x: g.car.x, y: g.car.y, boxes: g.obstacles.length, contact: g.lastContact && { kind: g.lastContact.kind, impact: g.lastContact.impact },
        debugHidden: document.getElementById('debug').hidden, debugText: document.getElementById('debug').textContent };
    });
    // Puts the car somewhere on the circuit by hand, as the Node tests do, with no ghost to record it.
    const place = (pose) => value((p) => {
      const { game: g, projectOnTrack } = window.__miniDrifters;
      g.ghost = null;
      Object.assign(g.car, { x: p.x, y: p.y, heading: p.heading, vx: Math.cos(p.heading) * p.speed, vy: Math.sin(p.heading) * p.speed, yawRate: 0 });
      Object.assign(g.prev, { x: p.x, y: p.y, heading: p.heading });
      g.trackInfo = projectOnTrack(g.track, p.x, p.y);
      g.trackS = g.trackInfo.s;
    }, pose);
    // Orange pixels in the canvas: the debug view's collision outlines.
    const orange = () => value((c) => {
      const canvas = document.getElementById('view');
      const ctx = canvas.getContext('2d');
      const { data } = ctx.getImageData(0, 0, canvas.width, canvas.height);
      let n = 0;
      for (let i = 0; i < data.length; i += 4) if (Math.abs(data[i] - c[0]) < 12 && Math.abs(data[i + 1] - c[1]) < 12 && Math.abs(data[i + 2] - c[2]) < 12) n += 1;
      return n;
    }, ORANGE);

    for (const handling of ['classic', 'revised']) {
      // A fresh visit opens on the title. Dockyard is to the right; H changes the handling; Enter starts.
      await page.goto(base);
      await page.waitForFunction(() => window.__miniDrifters, null, { polling: 50 });
      await frames(2);
      while ((await value(() => window.__miniDrifters.selectedTrack())) !== 'dockyard') await key('ArrowRight');
      while ((await value(() => window.__miniDrifters.selectedHandling())) !== handling) await key('KeyH');
      await key('Enter');
      let s = await status();
      assert.deepEqual([s.state, s.track, s.handling], ['ready', 'dockyard', handling]);
      assert.equal(s.boxes, 31, 'Dockyard\'s session has its solid scenery');
      assert.equal(s.debugHidden, true, 'no debug panel in normal driving');

      // Off the quay straight's outside at 30 degrees: concrete, full grip, off the course.
      await hold({ up: true }, 60);
      await hold({ up: true, left: true }, 40);
      await hold({ up: true }, 90);
      s = await status();
      assert.equal(s.surface, 'concrete', `on the apron at ${s.x.toFixed(0)},${s.y.toFixed(0)}`);
      assert.equal(s.onCourse, false);
      assert.equal(s.traction, 1);
      ok(`${handling}: the apron drives as concrete (traction 1) and is off the course`);

      // Into the container stack inside the Hook, in normal view, then again with debug on.
      await place({ x: 80, y: -38, heading: 0, speed: 25 });
      await value(() => {
        // Start a fresh live combo so the preceding apron drive cannot expire it before impact.
        window.__miniDrifters.game.scoring.offTrackTime = 0;
        window.__miniDrifters.game.scoring.combo = { points: 500, tier: 0, grace: 2,
          tierGround: 0, linkGround: 0, stallTimer: 0, stallGround: 0, side: 1 };
      });
      await frames(50);
      s = await status();
      assert.equal(s.contact?.kind, 'container');
      assert.match(await page.locator('#banner').innerText(), /HIT AN OBSTACLE/);
      assert.equal(await value(() => window.__miniDrifters.game.scoring.event.reason), 'hit an obstacle');
      assert.ok(s.contact.impact > 20 && s.x <= 99 - 2.2 + 1e-6, `stopped at x=${s.x.toFixed(2)} after a ${s.contact.impact.toFixed(1)} m/s hit`);
      await frames(2);
      const plain = await orange();
      assert.equal(plain, 0, 'no collision outlines drawn in normal driving');
      await page.screenshot({ path: shot(`${name}-${handling}-container`) });
      await key('KeyD');
      await frames(2);
      s = await status();
      assert.equal(s.debugHidden, false);
      assert.match(s.debugText, /surface\s+concrete/);
      assert.match(s.debugText, /course\s+OFF/);
      assert.match(s.debugText, /contact\s+container \d+\.\d m\/s HARD/);
      assert.ok((await orange()) > 200, 'debug draws the collision outlines');
      await page.screenshot({ path: shot(`${name}-${handling}-container-debug`) });
      await key('KeyD');
      await frames(2);
      assert.equal(await orange(), 0, 'and hides them again');
      ok(`${handling}: a container stops the car; debug shows boxes, course and contact only when asked`);

      // The perimeter wall still names the actual wall, through the same visible HUD path.
      const edge = await value(() => window.__miniDrifters.game.track.bounds.maxX);
      await place({ x: edge - 2.7, y: 0, heading: 0, speed: 30 });
      await value(() => {
        // Start a fresh live combo so the preceding apron drive cannot expire it before impact.
        window.__miniDrifters.game.scoring.offTrackTime = 0;
        window.__miniDrifters.game.scoring.combo = { points: 500, tier: 0, grace: 2,
          tierGround: 0, linkGround: 0, stallTimer: 0, stallGround: 0, side: 1 };
      });
      await frames(5);
      assert.equal(await value(() => window.__miniDrifters.game.scoring.event.reason), 'hit the wall');
      assert.match(await page.locator('#banner').innerText(), /HIT THE WALL/);
      ok(handling + ': the perimeter hit retains the visible wall message');

    }
    // Both other environments load their real solid scenery, preserving each handling choice.
    for (const track of ['original', 'switchback']) for (const handling of ['classic', 'revised']) {
      await page.goto(base);
      await page.waitForFunction(() => window.__miniDrifters, null, { polling: 50 });
      await frames(2);
      while ((await value(() => window.__miniDrifters.selectedTrack())) !== track) await key('ArrowRight');
      while ((await value(() => window.__miniDrifters.selectedHandling())) !== handling) await key('KeyH');
      await key('Enter');
      await hold({ up: true }, 120);
      const s = await status();
      assert.deepEqual([s.state, s.track, s.handling], ['racing', track, handling]);
      assert.ok(s.boxes > 0, track + ' has solid scenery');
      ok(track + '/' + handling + ': functional scenery starts and drives');
    }
    assert.deepEqual(errors, [], errors.join('\n'));
    ok('no page errors');
  } finally {
    await browser.close();
  }
}

try {
  for (const [name, engine] of [['chromium', chromium], ['firefox', firefox]]) await check(name, engine);
  console.log('environment browser check passed');
} finally {
  server.close();
}
