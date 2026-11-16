// R3 rendering qualification and posed before/after evidence, against the exact R2 worktree.
// Uses throwaway browser contexts and localhost ports; never opens the owner's browser profile.
// node test/scenery-browser.mjs <playwright/index.mjs> [R2 directory]
import assert from 'node:assert/strict';
import http from 'node:http';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { extname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
const { chromium, firefox } = await import(process.argv[2] ? pathToFileURL(process.argv[2]) : 'playwright');
const roots = { r3: new URL('../', import.meta.url), r2: pathToFileURL(`${process.argv[3] ?? 'D:/Projects/mini-drifters-v0.5.0-r2'}/`) };
const out = new URL('artifacts/r3/', roots.r3);
await mkdir(out, { recursive: true });
const types = { '.html': 'text/html', '.css': 'text/css', '.js': 'text/javascript', '.mjs': 'text/javascript', '.wav': 'audio/wav', '.mp3': 'audio/mpeg' };
const server = http.createServer(async (req, res) => {
  const [, tree, ...parts] = new URL(req.url, 'http://localhost').pathname.split('/');
  const file = parts.join('/') || 'index.html';
  if (!roots[tree] || file.includes('..') || !/^(index\.html|style\.css|src\/[\w-]+\.js|test\/support\/drivers\.mjs|(?:audio-lab\/assets|radio)\/[\w/.-]+)$/.test(file)) {
    res.writeHead(404); res.end(); return;
  }
  try { res.writeHead(200, { 'Content-Type': types[extname(file)] }); res.end(await readFile(new URL(file, roots[tree]))); }
  catch { res.writeHead(404); res.end(); }
});
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const base = `http://127.0.0.1:${server.address().port}`;
const results = [];

async function setup(page, tree) {
  // No app UI or animation loop for these renderer-only comparisons.
  await page.goto(`${base}/${tree}/style.css`);
  await page.evaluate(async (tree) => {
    document.body.innerHTML = '<canvas id="evidence" style="display:block;width:100vw;height:100vh"></canvas>';
    document.body.style = 'margin:0;overflow:hidden';
    const render = await import(`/${tree}/src/render.js`);
    const { trackById } = await import(`/${tree}/src/track.js`);
    const { createGame, startRun } = await import(`/${tree}/src/game.js`);
    const { handlingById } = await import(`/${tree}/src/handling.js`);
    const { padTrack } = await import(`/${tree}/src/practice-pad.js`);
    window.scene = { render, trackById, createGame, startRun, handlingById, padTrack };
    window.paint = (o = {}) => {
      const s = window.scene;
      const track = o.track === 'practice-pad' ? s.padTrack() : s.trackById(o.track ?? 'dockyard');
      const canvas = document.querySelector('canvas');
      const r = s.render.createRenderer(canvas, track, s.trackById('original'));
      // The minimap is translucent, so compare its actual drawing operations rather than
      // landscape pixels visible through it. Calls still go to the native canvas unchanged.
      const mapCommands = [];
      let inMap = false;
      r.ctx = new Proxy(r.ctx, {
        get(target, key) {
          const value = Reflect.get(target, key, target);
          if (typeof value !== 'function') return value;
          return (...args) => {
            if (key === 'roundRect' && args[0] > innerWidth / 2 && args[1] > innerHeight / 2 && args[2] <= 182) inMap = true;
            if (inMap) mapCommands.push([key, ...args.map((a) => typeof a === 'object' ? 'path' : a)]);
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
      const poses = {
        quay: [-20, -78, 0], hook: [110, -76, 0.3], tightening: [163, -17, 1.6],
        chicane: [1, 14, Math.PI], basin: [-85, 78, Math.PI], overview: [-20, -78, 0],
      };
      const [x, y, heading] = poses[o.view ?? 'quay'];
      Object.assign(g.car, { x, y, heading });
      Object.assign(g.prev, { x, y, heading });
      Object.assign(r.cam, { x, y, zoom: 8.2 * Math.max(0.75, innerHeight / 760) });
      if (o.view === 'overview') Object.assign(r.cam, { x: 0, y: 0, zoom: Math.min(innerWidth / 490, innerHeight / 355) });
      if (o.effects) {
        for (let i = 0; i < 22; i++) {
          const bx = x - Math.cos(heading) * (2 + i * 0.65);
          const by = y - Math.sin(heading) * (2 + i * 0.65);
          r.smoke.push({ x: bx, y: by, size: 1.3, age: i / 30, strength: 1, kind: 'smoke' });
          for (const side of [-1, 1]) r.skids.push({ ax: bx - Math.sin(heading) * side, ay: by + Math.cos(heading) * side,
            bx: bx - Math.cos(heading) * 0.7 - Math.sin(heading) * side, by: by - Math.sin(heading) * 0.7 + Math.cos(heading) * side, alpha: 1 });
        }
      }
      s.render.drawFrame(r, g, 1, 0, false);
      window.mapCommands = mapCommands;
      s.r = r; s.g = g;
      return { w: canvas.width, h: canvas.height, boards: r.course.dockyard?.boards.length ?? 0 };
    };
    window.pixels = (rect) => {
      const r = window.scene.r;
      const data = r.ctx.getImageData(...(rect ?? [0, 0, r.canvas.width, r.canvas.height])).data;
      // A compact deterministic fingerprint, calculated over the complete pixel buffer.
      let a = 2166136261, b = 5381;
      for (const v of data) { a = Math.imul(a ^ v, 16777619); b = Math.imul(b, 33) ^ v; }
      return `${a >>> 0}:${b >>> 0}`;
    };
  }, tree);
}

try {
  for (const [name, engine] of [['chromium', chromium], ['firefox', firefox]]) {
    const browser = await engine.launch({ headless: true });
    try {
      const context = await browser.newContext({ viewport: { width: 1366, height: 768 } });
      const page = await context.newPage();
      const errors = [];
      page.on('pageerror', (e) => errors.push(e.message));
      for (const [w, h] of [[1024, 600], [1280, 720], [1366, 768], [1920, 1080]]) {
        await page.setViewportSize({ width: w, height: h });
        const before = {};
        for (const tree of ['r2', 'r3']) {
          await setup(page, tree);
          for (const track of ['original', 'switchback', 'practice-pad']) {
            for (const menu of [false, true]) {
              await page.evaluate((o) => window.paint(o), { track, menu });
              const fingerprint = await page.evaluate(() => window.pixels());
              const key = `${track}/${menu}`;
              if (tree === 'r2') before[key] = fingerprint;
              else assert.equal(fingerprint, before[key], `${name}/${w}x${h}/${key} remains pixel-identical to R2`);
            }
          }
          await page.evaluate(() => window.paint({ view: 'hook' }));
          const map = await page.evaluate(() => JSON.stringify(window.mapCommands));
          assert.ok(map.length > 100, 'minimap operations were captured');
          if (tree === 'r2') before.map = map;
          else assert.equal(map, before.map, 'Dockyard minimap remains unchanged');
        }
        console.log(`${name}: ${w}x${h}: Original, Switchback, practice and title pixel-identical; Dockyard minimap drawing identical to R2`);
        // Every corner in both handling modes at fast-camera scale. Static effects are posed evidence.
        for (const handling of ['classic', 'revised']) {
          for (const view of ['hook', 'tightening', 'chicane', 'basin']) {
            const info = await page.evaluate((o) => window.paint(o), { view, handling, effects: true });
            assert.equal(info.boards, 4);
            const board = await page.evaluate((id) => {
              const { r } = window.scene;
              const b = r.course.dockyard.boards.find((b) => b.id === id);
              const x = innerWidth / 2 + (b.x - r.cam.x) * r.cam.zoom;
              const y = innerHeight / 2 + (b.y - r.cam.y) * r.cam.zoom;
              return { x, y, width: b.w * r.cam.zoom, height: b.h * r.cam.zoom };
            }, view === 'tightening' ? 'hook-tightens' : view);
            assert.ok(board.x - board.width / 2 >= 0 && board.x + board.width / 2 < w);
            assert.ok(board.y - board.height / 2 >= 0 && board.y + board.height / 2 < h);
            assert.ok(board.width >= 90 && board.height >= 49, 'fast-camera board keeps a useful pixel footprint');
            if (w === 1024 || w === 1366) await page.screenshot({ path: fileURLToPath(new URL(`${name}-r3-${view}-${handling}-${w}x${h}.png`, out)) });
          }
        }
      }
      await page.setViewportSize({ width: 1366, height: 768 });
      for (const tree of ['r2', 'r3']) {
        await setup(page, tree);
        for (const view of ['overview', 'quay', 'hook', 'tightening', 'chicane', 'basin']) {
          await page.evaluate((view) => window.paint({ view, effects: view !== 'overview' }), view);
          await page.screenshot({ path: fileURLToPath(new URL(`${name}-${tree}-${view}.png`, out)) });
        }
      }
      // Same camera restored after a pan must reproduce every pixel, without layout regeneration.
      await page.evaluate(() => window.paint({ view: 'chicane', effects: true }));
      const stable = await page.evaluate(() => window.pixels());
      await page.evaluate(() => {
        const { r, g, render } = window.scene;
        r.cam.x += 13; r.cam.y -= 9; render.drawFrame(r, g, 1, 0, false);
        r.cam.x -= 13; r.cam.y += 9; render.drawFrame(r, g, 1, 0, false);
      });
      assert.equal(await page.evaluate(() => window.pixels()), stable, 'camera pan and return are stable');
      const switches = await page.evaluate(() => {
        const s = window.scene, first = s.r.course;
        for (let i = 0; i < 20; i++) {
          s.render.useTrack(s.r, s.trackById('original'));
          if (s.r.course.dockyard !== null) return false;
          s.render.useTrack(s.r, s.trackById('dockyard'));
          s.render.resetEffects(s.r, s.g.car);
          if (s.r.course !== first || s.r.course.dockyard.boards.length !== 4 || s.r.smoke.length || s.r.skids.length) return false;
        }
        return s.r.courses.size === 2;
      });
      assert.ok(switches, 'restart and switching reuse bounded layouts and clear tyre effects');
      assert.deepEqual(errors, []);
      console.log(`${name}: boards fit both modes at four supported sizes; camera stability, cached layout and effect resets PASS`);
      // DPR 2 uses the same world-space layout and unchanged legacy pixels.
      const retina = await browser.newContext({ viewport: { width: 1024, height: 600 }, deviceScaleFactor: 2 });
      const rp = await retina.newPage();
      let old;
      for (const tree of ['r2', 'r3']) {
        await setup(rp, tree); await rp.evaluate(() => window.paint({ track: 'switchback' }));
        const hash = await rp.evaluate(() => window.pixels());
        if (tree === 'r2') old = hash; else assert.equal(hash, old, 'DPR 2 Switchback pixels');
      }
      await rp.evaluate(() => window.paint({ view: 'hook', effects: true }));
      await rp.screenshot({ path: fileURLToPath(new URL(`${name}-r3-hook-dpr2.png`, out)) });
      await retina.close();
      results.push({ browser: name, result: 'PASS', viewports: 4, legacyFramesCompared: 24, modes: 2, boards: 4, dpr2: true });
    } finally { await browser.close(); }
  }
} finally { server.close(); }
await writeFile(new URL('scenery-results.json', out), JSON.stringify(results, null, 2));
