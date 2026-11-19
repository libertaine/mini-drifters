// v0.6.0 R2 rendering qualification, in Chromium and Firefox, against a reference tree (the R1
// prototype by default, whose Original and Switchback are v0.5.0's pixel for pixel):
//   1. Original and Switchback: the road, curbs, markings and start line are pixel-identical to the
//      reference under a mask (their scenery changes deliberately); the minimap draws identically.
//   2. Dockyard, the practice pad and the title poster are pixel-identical, whole frame.
//   3. The real page starts every circuit in Classic and in Power, drives, and raises no errors.
//   4. Frame cost: the renderer alone, posed along each lap, against the reference; and the real
//      page's frames (simulation included).
// Throwaway browser contexts on a random localhost port: no saved records are touched.
//   node test/scenery-r2-browser.mjs <playwright/index.mjs> [reference tree]
import assert from 'node:assert/strict';
import http from 'node:http';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { extname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const { chromium, firefox } = await import(process.argv[2] ? pathToFileURL(process.argv[2]) : 'playwright');
const roots = { after: new URL('../', import.meta.url), before: pathToFileURL(`${process.argv[3] ?? 'D:/Projects/mini-drifters-environment-v0.6.0-r1'}/`) };
const out = new URL('artifacts/r2/', roots.after);
await mkdir(out, { recursive: true });
const types = { '.html': 'text/html', '.css': 'text/css', '.js': 'text/javascript', '.mp3': 'audio/mpeg', '.wav': 'audio/wav' };
const server = http.createServer(async (req, res) => {
  const [, tree, ...parts] = new URL(req.url, 'http://localhost').pathname.split('/');
  const file = parts.join('/') || 'index.html';
  if (!roots[tree] || file.includes('..') || !/^(index\.html|style\.css|src\/[\w-]+\.js|(?:audio-lab\/assets|radio)\/[\w/.-]+)$/.test(file)) {
    res.writeHead(404); res.end(); return;
  }
  try { const data = await readFile(new URL(file, roots[tree])); res.writeHead(200, { 'Content-Type': types[extname(file)] ?? 'text/plain' }); res.end(data); }
  catch { res.writeHead(404); res.end(); }
});
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const base = `http://127.0.0.1:${server.address().port}`;

// Poses: [track, name, x, y, heading]. Corners, straights, and the tightest turns.
const POSES = [
  ['original', 'straight', 30, -110, 0], ['original', 'sweeper', 180, -40, 1.6], ['original', 'hairpin', -88, 140, 3.6],
  ['original', 'back-straight', -60, 2, Math.PI], ['original', 'final-corner', -195, -60, -1.2],
  ['switchback', 'switchbacks', -40, -40, 1.0], ['switchback', 'switchbacks-2', 40, 30, 1.0], ['switchback', 'tight-right', 150, 255, 2.4],
  ['switchback', 'west-straight', -200, 20, -Math.PI / 2], ['switchback', 'bottom-straight', -100, 190, Math.PI],
];
const DOCK_POSES = [['quay', -20, -78, 0], ['hook', 110, -76, 0.3], ['chicane', 1, 14, Math.PI], ['basin', -85, 78, Math.PI]];

async function setup(page, tree) {
  await page.goto(`${base}/${tree}/style.css`);
  await page.evaluate(async (tree) => {
    document.body.innerHTML = '<canvas id="evidence" style="display:block;width:100vw;height:100vh"></canvas>';
    document.body.style = 'margin:0;overflow:hidden';
    const render = await import(`/${tree}/src/render.js`);
    const { trackById } = await import(`/${tree}/src/track.js`);
    const { createGame, startRun } = await import(`/${tree}/src/game.js`);
    const { handlingById } = await import(`/${tree}/src/handling.js`);
    const { padTrack } = await import(`/${tree}/src/practice-pad.js`);
    const s = { render, trackById, createGame, startRun, handlingById, padTrack };
    window.scene = s;
    window.paint = (o) => {
      const track = o.track === 'practice-pad' ? s.padTrack() : s.trackById(o.track);
      const canvas = document.querySelector('canvas');
      const r = s.render.createRenderer(canvas, track, s.trackById('original'));
      const mapCommands = [];
      let inMap = false;
      r.ctx = new Proxy(r.ctx, {
        get(target, key) {
          const value = Reflect.get(target, key, target);
          if (typeof value !== 'function') return value;
          return (...args) => {
            if (key === 'roundRect' && args[0] > innerWidth / 2 && args[1] > innerHeight / 2 && args[2] <= 182) inMap = true;
            if (inMap) mapCommands.push([key, ...args.map((a) => (typeof a === 'object' ? 'path' : a))]);
            return value.apply(target, args);
          };
        },
        set(target, key, value) { if (inMap) mapCommands.push([key, value]); Reflect.set(target, key, value, target); return true; },
      });
      r.titleStill = true;
      const g = s.createGame(track, { handling: s.handlingById(o.handling ?? 'classic') });
      s.startRun(g);
      g.paused = true;
      if (o.menu) g.state = 'menu';
      Object.assign(g.car, { x: o.x ?? track.start.x, y: o.y ?? track.start.y, heading: o.heading ?? track.start.heading });
      Object.assign(g.prev, { x: g.car.x, y: g.car.y, heading: g.car.heading });
      Object.assign(r.cam, { x: g.car.x, y: g.car.y, zoom: 8.2 * Math.max(0.75, innerHeight / 760) });
      s.render.drawFrame(r, g, 1, 0, !!o.debug);
      window.mapCommands = mapCommands;
      s.r = r; s.g = g;
      return true;
    };
    // FNV over pixels; with a mask, only where the road or its curbs are drawn, 0.5 m in from their
    // sides and 2 px in from every edge (edges, including the square ends where a curb stops at a
    // change of direction, blend with whatever ground lies beneath).
    window.pixels = (masked) => {
      const { r } = window.scene;
      const { width, height } = r.canvas;
      const data = r.ctx.getImageData(0, 0, width, height).data;
      let mask = null;
      if (masked) {
        const m = document.createElement('canvas');
        m.width = width; m.height = height;
        const c = m.getContext('2d');
        c.setTransform(r.dpr, 0, 0, r.dpr, 0, 0);
        c.translate(r.width / 2, r.height / 2);
        c.scale(r.cam.zoom, r.cam.zoom);
        c.translate(-r.cam.x, -r.cam.y);
        c.strokeStyle = '#fff';
        c.lineJoin = 'round';
        const t = r.track;
        c.lineWidth = t.halfWidth * 2 + 0.9 - 1; c.stroke(r.course.road);
        c.lineWidth = (t.halfWidth + t.curbWidth) * 2 - 1; c.stroke(r.course.curbs);
        const raw = c.getImageData(0, 0, width, height).data;
        mask = new Uint8Array(width * height);
        for (let y = 2; y < height - 2; y += 1) {
          for (let x = 2; x < width - 2; x += 1) {
            let full = true;
            for (let dy = -2; dy <= 2 && full; dy += 1) for (let dx = -2; dx <= 2; dx += 1) if (raw[((y + dy) * width + x + dx) * 4 + 3] < 255) { full = false; break; }
            mask[y * width + x] = full ? 1 : 0;
          }
        }
      }
      let a = 2166136261;
      let n = 0;
      for (let i = 0; i < data.length; i += 4) {
        if (mask && !mask[i / 4]) continue;
        n += 1;
        for (let k = 0; k < 4; k += 1) a = Math.imul(a ^ data[i + k], 16777619);
      }
      return { hash: a >>> 0, pixels: n };
    };
    // The renderer alone: frames posed every 6 m around the lap, camera following.
    window.timeLap = (id, handling = 'classic') => {
      const track = s.trackById(id);
      const canvas = document.querySelector('canvas');
      const r = s.render.createRenderer(canvas, track, s.trackById('original'));
      const g = s.createGame(track, { handling: s.handlingById(handling) });
      s.startRun(g);
      g.state = 'racing';
      const times = [];
      const pts = track.points;
      for (let i = 0; i < pts.length; i += 3) {
        const p = pts[i];
        const q = pts[(i + 3) % pts.length];
        Object.assign(g.prev, { x: g.car.x, y: g.car.y, heading: g.car.heading });
        Object.assign(g.car, { x: p.x, y: p.y, heading: Math.atan2(q.y - p.y, q.x - p.x), vx: (q.x - p.x) * 6, vy: (q.y - p.y) * 6, speed: 36 });
        const t0 = performance.now();
        s.render.drawFrame(r, g, 1, 1 / 60, false);
        r.ctx.getImageData(0, 0, 1, 1); // wait for the GPU to finish the frame
        times.push(performance.now() - t0);
      }
      times.sort((x, y) => x - y);
      const mean = times.reduce((x, y) => x + y, 0) / times.length;
      return { frames: times.length, mean, p95: times[Math.floor(times.length * 0.95)], max: times[times.length - 1] };
    };
  }, tree);
}

function harness() {
  window.requestAnimationFrame = (callback) => { window.__nextFrame = callback; return 1; };
  let now;
  window.__frames = (count = 2, dt = 1000 / 60) => {
    now ??= performance.now();
    for (let i = 0; i < count; i++) { now += dt; window.__nextFrame(now); }
  };
}

const report = { browsers: {} };
try {
  for (const [name, engine] of [['chromium', chromium], ['firefox', firefox]]) {
    const browser = await engine.launch({ headless: true });
    const result = { roadIdentity: [], wholeFrameIdentity: [], timing: {}, page: {} };
    report.browsers[name] = result;
    try {
      const context = await browser.newContext({ viewport: { width: 1366, height: 768 } });
      const page = await context.newPage();
      const errors = [];
      page.on('pageerror', (e) => errors.push(e.message));

      // 1 and 2: identity against the reference.
      for (const [w, h] of [[1366, 768], [1024, 600]]) {
        await page.setViewportSize({ width: w, height: h });
        const ref = {};
        for (const tree of ['before', 'after']) {
          await setup(page, tree);
          for (const [track, view, x, y, heading] of POSES) {
            for (const handling of ['classic', 'revised']) {
              await page.evaluate((o) => window.paint(o), { track, x, y, heading, handling });
              const px = await page.evaluate(() => window.pixels(true));
              const map = await page.evaluate(() => JSON.stringify(window.mapCommands));
              const key = `${track}/${view}/${handling}`;
              if (tree === 'before') ref[key] = { px, map };
              else {
                assert.ok(px.pixels > 20000, `${key}: the mask covers the road (${px.pixels} px)`);
                assert.equal(px.hash, ref[key].px.hash, `${name} ${w}x${h} ${key}: road, curbs and markings pixel-identical`);
                assert.equal(px.pixels, ref[key].px.pixels);
                assert.equal(map, ref[key].map, `${name} ${key}: minimap identical`);
                if (handling === 'classic') result.roadIdentity.push(`${w}x${h} ${track}/${view}: ${px.pixels} px`);
              }
            }
          }
          const whole = [
            ...DOCK_POSES.map(([view, x, y, heading]) => ({ key: `dockyard/${view}`, o: { track: 'dockyard', x, y, heading } })),
            { key: 'dockyard/hook-debug', o: { track: 'dockyard', x: 80, y: -38, heading: 0, debug: true } },
            { key: 'practice-pad', o: { track: 'practice-pad' } },
            { key: 'title', o: { track: 'original', menu: true } },
            { key: 'title-from-switchback', o: { track: 'switchback', menu: true } },
          ];
          for (const { key, o } of whole) {
            await page.evaluate((o) => window.paint(o), o);
            const px = await page.evaluate(() => window.pixels(false));
            if (tree === 'before') ref[key] = px.hash;
            else {
              assert.equal(px.hash, ref[key], `${name} ${w}x${h} ${key}: pixel-identical`);
              result.wholeFrameIdentity.push(`${w}x${h} ${key}`);
            }
          }
        }
        console.log(`${name} ${w}x${h}: ${POSES.length * 2} Original/Switchback road frames identical under the mask; Dockyard, practice pad and title identical`);
      }

      // Evidence screenshots, before and after, at the review size.
      await page.setViewportSize({ width: 1366, height: 768 });
      for (const tree of ['before', 'after']) {
        await setup(page, tree);
        for (const [track, view, x, y, heading] of POSES) {
          await page.evaluate((o) => window.paint(o), { track, x, y, heading });
          await page.screenshot({ path: fileURLToPath(new URL(`${name}-${tree}-${track}-${view}.png`, out)) });
          if (tree === 'after') {
            await page.evaluate((o) => window.paint(o), { track, x, y, heading, debug: true });
            await page.screenshot({ path: fileURLToPath(new URL(`${name}-${tree}-${track}-${view}-debug.png`, out)) });
          }
        }
      }

      // 4a: renderer cost around each lap, against the reference.
      for (const tree of ['before', 'after']) {
        await setup(page, tree);
        for (const id of ['original', 'switchback', 'dockyard']) {
          await page.evaluate((id) => window.timeLap(id), id); // warm up (first build, JIT)
          const t = await page.evaluate((id) => window.timeLap(id), id);
          result.timing[`${tree}/${id}`] = Object.fromEntries(Object.entries(t).map(([k, v]) => [k, Math.round(v * 100) / 100]));
        }
      }
      for (const id of ['original', 'switchback']) {
        const t = result.timing[`after/${id}`];
        assert.ok(t.mean < 8 && t.p95 < 12, `${name} ${id}: renderer ${t.mean.toFixed(2)} ms mean, ${t.p95.toFixed(2)} ms p95`);
      }
      console.log(`${name}: renderer ms/frame (mean / p95):`, Object.entries(result.timing).map(([k, t]) => `${k} ${t.mean}/${t.p95}`).join(', '));
      assert.deepEqual(errors, [], errors.join('\n'));

      // 3 and 4b: the real page.
      const real = await browser.newContext({ viewport: { width: 1366, height: 768 } });
      await real.addInitScript(harness);
      const rp = await real.newPage();
      const pageErrors = [];
      rp.on('pageerror', (e) => pageErrors.push(e.message));
      rp.on('console', (m) => { if (m.type() === 'error') pageErrors.push(m.text()); });
      const value = (fn, arg) => rp.evaluate(fn, arg);
      const frames = (n = 2) => value((k) => window.__frames(k), n);
      const key = async (code) => { await rp.keyboard.press(code); await frames(2); };
      for (const id of ['original', 'switchback', 'dockyard']) {
        for (const handling of ['classic', 'revised']) {
          await rp.goto(`${base}/after/`);
          await rp.waitForFunction(() => window.__miniDrifters, null, { polling: 50 });
          await frames(2);
          let guard = 0;
          while ((await value(() => window.__miniDrifters.selectedTrack())) !== id && guard++ < 6) await key('ArrowRight');
          guard = 0;
          while ((await value(() => window.__miniDrifters.selectedHandling())) !== handling && guard++ < 4) await key('KeyH');
          await key('Enter');
          await value(() => { window.__miniDrifters.input.up = true; });
          const t0 = Date.now();
          await frames(600);
          const ms = (Date.now() - t0) / 600;
          const s = await value(() => {
            const { game: g } = window.__miniDrifters;
            g.ghost = null;
            return { state: g.state, track: g.track.id, drawn: window.__miniDrifters.drawnTrack(), handling: g.handling.id, x: g.car.x, y: g.car.y, laps: g.laps.next, contact: g.lastContact };
          });
          await value(() => { window.__miniDrifters.input.up = false; });
          assert.equal(s.state, 'racing');
          assert.deepEqual([s.track, s.drawn, s.handling], [id, id, handling]);
          result.page[`${id}/${handling}`] = { msPerFrame: Math.round(ms * 100) / 100, contact: s.contact?.kind ?? null };
          if (handling === 'classic') await rp.screenshot({ path: fileURLToPath(new URL(`${name}-page-${id}.png`, out)) });
        }
      }
      assert.deepEqual(pageErrors, [], pageErrors.join('\n'));
      console.log(`${name}: real page, every circuit in both modes, 10 s of driving each, no errors; ms per frame (simulation and drawing):`,
        Object.entries(result.page).map(([k, v]) => `${k} ${v.msPerFrame}`).join(', '));
      await real.close();
    } finally { await browser.close(); }
  }
} finally { server.close(); }
await writeFile(new URL('scenery-r2-results.json', out), JSON.stringify(report, null, 2));
console.log('scenery R2 browser check passed');
