// Mini Drifters v0.9.0 R1 — Browser qualification suite (Chromium & Firefox):
//   - Redesigned 7-circuit Tracks selection UI at 1024x600, 1280x720, 1366x768, 1920x1080
//     with game fonts + Arial + Verdana fallback fonts, including legacy + quota notes
//   - Keyboard, mouse and mocked controller navigation across all 7 circuits & Practice Pad
//   - Gameplay, minimap, debug display, pause, restart, radio, options & presentation on all 4 new circuits
//   - Records, saved reference ghosts, Drive Again, reload persistence & v0.8.0 save compatibility
//   - Localhost / ?analytics=off zero-network gating & real browser frame timing budgets
import assert from 'node:assert/strict';
import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname } from 'node:path';
import { pathToFileURL } from 'node:url';
import { RADIO_FILES } from '../src/radio-stations.js';
import { GHOST_STORE_KEY } from '../src/ghost-store.js';
import { RECORDS_KEY } from '../src/records.js';

const { chromium, firefox } = await import(process.argv[2] ? pathToFileURL(process.argv[2]) : 'playwright');
const root = new URL('../', import.meta.url);
const mime = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8', '.wav': 'audio/wav', '.mp3': 'audio/mpeg', '.md': 'text/plain; charset=utf-8' };

const server = http.createServer(async (req, res) => {
  const pathname = new URL(req.url, 'http://localhost').pathname;
  const file = pathname === '/' ? 'index.html' : pathname.slice(1);
  if (!/^(?:index\.html|style\.css|src\/[\w-]+\.js|test\/support\/drivers\.mjs|radio\/.+|audio-lab\/assets\/.+)$/.test(file)) {
    res.writeHead(404).end();
    return;
  }
  try {
    const bytes = await readFile(new URL(file, root));
    res.writeHead(200, { 'Content-Type': mime[extname(file)] ?? 'application/octet-stream' }).end(bytes);
  } catch {
    res.writeHead(404).end();
  }
});
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const base = `http://127.0.0.1:${server.address().port}/`;

const ALL_IDS = ['original', 'switchback', 'dockyard', 'runway-27', 'redline-mesa', 'headland-run', 'nightshift-viaduct'];
const NEW_IDS = ['runway-27', 'redline-mesa', 'headland-run', 'nightshift-viaduct'];
const SIZES = [[1024, 600], [1280, 720], [1366, 768], [1920, 1080]];
const FALLBACKS = [null, 'Arial, sans-serif', 'Verdana, sans-serif'];

const V080_RECORDS = {
  version: 3,
  tracks: {
    original: {
      classic: {
        fastestLap: 45.2,
        scoring: { 'scoring-1': { score: 15420, bestCombo: 800 }, 'scoring-2': { score: 42000, bestCombo: 5200 } },
      },
      revised: {
        fastestLap: 46.8,
        scoring: { 'scoring-1': { score: null, bestCombo: null }, 'scoring-2': { score: 51000, bestCombo: 7400 } },
      },
    },
    switchback: {
      classic: { fastestLap: 50.1, scoring: { 'scoring-1': { score: null, bestCombo: null }, 'scoring-2': { score: 19000, bestCombo: 2300 } } },
    },
    dockyard: {
      classic: { fastestLap: 31.4, scoring: { 'scoring-1': { score: null, bestCombo: null }, 'scoring-2': { score: 12500, bestCombo: 1900 } } },
    },
  },
};

function installHarness({ recordsKey, recordsJson }) {
  if (!sessionStorage.getItem('r1-seeded')) {
    localStorage.setItem('mini-drifters-sound', 'off');
    localStorage.setItem(recordsKey, recordsJson);
    // Simulate leftover R0 research keys to verify zero contamination.
    localStorage.setItem('mini-drifters-r0-records', JSON.stringify({ tracks: { 'exp-runway-27': { classic: { score: 888888 } } } }));
    localStorage.setItem('mini-drifters-r0-ghosts', JSON.stringify({ ghosts: { 'exp-runway-27': { classic: { lapTime: 1.5 } } } }));
    sessionStorage.setItem('r1-seeded', 'yes');
  }
  const buttons = Array.from({ length: 17 }, () => ({ value: 0, pressed: false }));
  window.__pad = { index: 0, id: 'R1 Test Pad', mapping: 'standard', connected: true, axes: [0, 0, 0, 0], buttons };
  window.__padOn = false;
  Object.defineProperty(navigator, 'getGamepads', { value: () => (window.__padOn ? [window.__pad] : []) });
  window.requestAnimationFrame = (cb) => { window.__raf = cb; return 1; };
  let now = 1000;
  window.__frames = (n = 2) => {
    for (let i = 0; i < n; i += 1) { now += 1000 / 60; window.__raf?.(now); }
  };
  window.__pressPad = (idx) => {
    buttons[idx] = { value: 1, pressed: true };
    window.__frames(2);
    buttons[idx] = { value: 0, pressed: false };
    window.__frames(2);
  };
}

async function run(engine, name) {
  const browser = await engine.launch({ headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 1366, height: 768 }, reducedMotion: 'reduce' });
    const errors = [];
    const externalRequests = [];
    page.on('pageerror', (e) => errors.push(e.message));
    page.on('request', (req) => {
      const url = req.url();
      if (!url.startsWith(base) && !url.startsWith('data:')) externalRequests.push(url);
    });
    await page.addInitScript(installHarness, { recordsKey: RECORDS_KEY, recordsJson: JSON.stringify(V080_RECORDS) });

    const frames = (n = 2) => page.evaluate((count) => window.__frames(count), n);
    const key = async (code) => { await page.keyboard.press(code); await frames(2); };

    await page.goto(`${base}?analytics=off`);
    await page.waitForFunction(() => window.__miniDrifters, null, { polling: 50 });
    await frames(3);

    // --- 1. Tracks UI structure, silhouettes, blurbs, desktop layout & fallback fonts -----
    await page.locator('#tracks-open').click();
    await frames(3);

    const cardsInfo = await page.evaluate(() => {
      const labels = [...document.querySelectorAll('#tracks label')];
      const rects = labels.map((el) => el.getBoundingClientRect());
      const rows = new Set(rects.map((r) => Math.round(r.top / 8)));
      const thumbs = labels.map((el) => el.querySelector('.track-thumb path')?.getAttribute('d') ?? '');
      const names = labels.map((el) => el.querySelector('.track-name')?.textContent.trim() ?? '');
      const ids = labels.map((el) => el.querySelector('input')?.value ?? '');
      return { count: labels.length, rows: rows.size, thumbs, names, ids };
    });
    assert.deepEqual(cardsInfo.ids, ALL_IDS);
    assert.equal(cardsInfo.count, 7);
    assert.equal(cardsInfo.rows, 2, '7 circuits form a compact 2-row grid');
    assert.equal(new Set(cardsInfo.thumbs).size, 7, 'every circuit card renders a distinct mini SVG silhouette');
    assert.ok(cardsInfo.thumbs.every((d) => d.startsWith('M')));

    // Verify all desktop viewports x native/Arial/Verdana fonts, including legacy + storage note.
    await page.evaluate(() => {
      document.getElementById('records-note').textContent = 'Record storage unavailable. New improvements cannot be saved.';
    });
    for (const fallback of FALLBACKS) {
      await page.evaluate((font) => {
        for (const prop of ['--poster', '--body']) {
          if (font) document.documentElement.style.setProperty(prop, font);
          else document.documentElement.style.removeProperty(prop);
        }
      }, fallback);
      for (const [w, h] of SIZES) {
        await page.setViewportSize({ width: w, height: h });
        await page.evaluate(() => window.dispatchEvent(new Event('resize')));
        await frames(2);
        const issues = await page.evaluate(([vw, vh]) => {
          const out = [];
          const menu = document.getElementById('tracks-menu');
          const sound = document.getElementById('sound').getBoundingClientRect();
          const hit = (a, b) => a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom;
          if (menu.scrollHeight > menu.clientHeight + 1) out.push(`scrolls ${menu.scrollHeight}/${menu.clientHeight}`);
          const textEls = [...menu.querySelectorAll('h2, p, dt, dd, button, label > span, .track-meta, .track-name, .track-tag')];
          for (const el of textEls) {
            if (!el.getClientRects().length || getComputedStyle(el).display === 'none') continue;
            const r = el.getBoundingClientRect();
            if (r.left < -1 || r.top < -1 || r.right > vw + 1 || r.bottom > vh + 1) out.push(`offscreen: ${el.id || el.className}`);
            if (el.clientWidth > 0 && el.scrollWidth > el.clientWidth + 2) out.push(`overflow: ${el.id || el.className} (${el.scrollWidth}/${el.clientWidth})`);
          }
          const controls = [...menu.querySelectorAll('button, label')].filter((el) => el.getClientRects().length);
          for (let i = 0; i < controls.length; i += 1) {
            const el = controls[i];
            const r = el.getBoundingClientRect();
            const pt = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
            if (!el.contains(pt)) out.push(`blocked: ${el.id || el.dataset.track}`);
            if (hit(r, sound)) out.push(`overlaps #sound: ${el.id || el.dataset.track}`);
            for (let j = i + 1; j < controls.length; j += 1) {
              if (hit(r, controls[j].getBoundingClientRect())) out.push(`control overlap: ${i}&${j}`);
            }
          }
          return out;
        }, [w, h]);
        assert.deepEqual(issues, [], `Tracks UI layout at ${w}x${h} (${fallback ?? 'game fonts'})`);
      }
    }
    await page.evaluate(() => {
      document.documentElement.style.removeProperty('--poster');
      document.documentElement.style.removeProperty('--body');
      document.getElementById('records-note').textContent = '';
    });
    await page.setViewportSize({ width: 1366, height: 768 });
    await frames(2);

    // --- 2. Keyboard, mouse, handling toggle, and controller navigation -------------------
    assert.match(await page.locator('#pb-score').textContent(), /42,000/, 'v0.8.0 Original score displayed');
    assert.match(await page.locator('#pb-legacy').textContent(), /15,420/, 'legacy score displayed');
    await key('KeyH');
    assert.match(await page.locator('#records-heading').textContent(), /Power/);
    assert.match(await page.locator('#pb-score').textContent(), /51,000/, 'v0.8.0 Power score displayed');
    await key('KeyH');
    assert.match(await page.locator('#records-heading').textContent(), /Classic/);

    // Mouse click every new circuit: distinct preview path, meta, blurb, clean blank PB (no R0 contamination).
    const previewPaths = new Set();
    for (const id of NEW_IDS) {
      await page.locator(`#tracks label[data-track="${id}"]`).click();
      await frames(2);
      const info = await page.evaluate(() => ({
        selected: window.__miniDrifters.selectedTrack(),
        d: document.getElementById('track-preview-path').getAttribute('d'),
        meta: document.getElementById('track-meta').textContent,
        blurb: document.getElementById('track-blurb').textContent,
        score: document.getElementById('pb-score').textContent,
      }));
      assert.equal(info.selected, id);
      assert.ok(info.d.startsWith('M'));
      previewPaths.add(info.d);
      assert.match(info.meta, /km$/);
      assert.ok(info.blurb.length > 20);
      assert.equal(info.score, '--', `no R0 contamination on ${id}`);
    }
    assert.equal(previewPaths.size, 4);

    // Mocked controller D-pad steps through circuits, navigates to Practice Pad, and back.
    await page.evaluate(() => { window.__padOn = true; window.__frames(3); });
    await page.evaluate(() => window.__pressPad(15)); // Right wraps nightshift-viaduct -> original
    assert.equal(await page.evaluate(() => window.__miniDrifters.selectedTrack()), 'original');
    await page.evaluate(() => window.__pressPad(14)); // Left wraps original -> nightshift-viaduct
    assert.equal(await page.evaluate(() => window.__miniDrifters.selectedTrack()), 'nightshift-viaduct');
    await page.evaluate(() => { window.__padOn = false; window.__frames(2); });

    // Practice Pad remains accessible directly from Tracks sheet.
    await page.locator('#practice').click();
    await frames(3);
    assert.equal(await page.evaluate(() => window.__miniDrifters.sessionKind()), 'practice');
    await key('Escape');

    // --- 3. Gameplay, features, presentation & frame timing on all 4 new circuits ---------
    const minimapStamps = new Set();
    const frameTimes = {};
    for (let idx = 0; idx < NEW_IDS.length; idx += 1) {
      const id = NEW_IDS[idx];
      await page.locator('#tracks-open').click();
      await frames(2);
      await page.locator(`#tracks label[data-track="${id}"]`).click();
      await frames(2);
      // Alternate Classic & Power across the four circuits.
      const wantHandling = idx % 2 === 0 ? 'classic' : 'revised';
      if ((await page.evaluate(() => window.__miniDrifters.selectedHandling())) !== wantHandling) await key('KeyH');
      await page.locator('#start').click();
      await frames(4);

      const startCheck = await page.evaluate(() => {
        const m = window.__miniDrifters;
        const c = document.getElementById('view');
        const ctx = c.getContext('2d');
        // Sample minimap bottom-right corner hash to prove each circuit draws a distinct minimap.
        const mm = ctx.getImageData(c.width - 190, c.height - 150, 160, 120).data;
        let h = 2166136261;
        for (let i = 0; i < mm.length; i += 29) { h ^= mm[i]; h = Math.imul(h, 16777619); }
        return {
          state: m.game.state,
          track: m.game.track.id,
          drawn: m.drawnTrack(),
          handling: m.game.handling.id,
          minimapHash: (h >>> 0).toString(16),
        };
      });
      assert.deepEqual([startCheck.state, startCheck.track, startCheck.drawn, startCheck.handling], ['ready', id, id, wantHandling]);
      minimapStamps.add(startCheck.minimapHash);

      // Drive briefly with keyboard, toggle debug (D), radio (N), pause (P), restart (R), and measure frame times.
      await page.keyboard.down('ArrowUp');
      const perf = await page.evaluate(() => {
        const samples = [];
        for (let i = 0; i < 45; i += 1) {
          const t0 = performance.now();
          window.__frames(1);
          samples.push(performance.now() - t0);
        }
        samples.sort((a, b) => a - b);
        const m = window.__miniDrifters;
        return {
          medianMs: +samples[Math.floor(samples.length / 2)].toFixed(2),
          p95Ms: +samples[Math.floor(samples.length * 0.95)].toFixed(2),
          speed: m.game.car.speed,
          state: m.game.state,
        };
      });
      await page.keyboard.up('ArrowUp');
      await frames(2);
      assert.equal(perf.state, 'racing');
      assert.ok(perf.speed > 5, `${id} car moved: ${perf.speed.toFixed(1)} m/s`);
      assert.ok(perf.medianMs < 25, `${id} median frame ${perf.medianMs} ms`);
      frameTimes[id] = { medianMs: perf.medianMs, p95Ms: perf.p95Ms };

      // Debug display, radio toggle, pause, options, restart.
      await key('KeyD');
      assert.equal(await page.locator('#debug').isVisible(), true);
      assert.match(await page.locator('#debug').textContent(), new RegExp(`handling\\s+${wantHandling}`));
      await key('KeyD');
      await key('KeyN');
      await key('KeyP');
      assert.equal(await page.locator('#paused').isVisible(), true);
      await key('KeyO');
      assert.equal(await page.locator('#options').isVisible(), true);
      await key('Escape');
      await key('KeyR');
      assert.equal(await page.evaluate(() => window.__miniDrifters.game.state), 'ready');
      await key('KeyP');
      await page.locator('#paused .return-title').click();
      await frames(2);
    }
    assert.equal(minimapStamps.size, 4, 'all 4 new circuits render distinct minimaps');

    // --- 4. Real 3-lap completion, Drive Again, Reference Ghost & reload persistence ------
    await page.locator('#tracks-open').click();
    await frames(2);
    await page.locator('#tracks label[data-track="redline-mesa"]').click();
    await frames(2);
    if ((await page.evaluate(() => window.__miniDrifters.selectedHandling())) !== 'classic') await key('KeyH');
    // Enable Saved Reference ghost in Options before driving.
    await key('KeyO');
    await page.locator('#ghost-sources input[value="reference"]').click({ force: true });
    await frames(2);
    await key('Escape');
    await page.locator('#start').click();
    await frames(2);

    const runResult = await page.evaluate(async () => {
      const { gripDriver } = await import('/test/support/drivers.mjs');
      const { game, input } = window.__miniDrifters;
      const driver = gripDriver();
      for (let i = 0; i < 120 * 240 && game.state !== 'finished'; i += 1) {
        Object.assign(input, driver(game));
        window.__frames(1);
      }
      for (const k of Object.keys(input)) input[k] = false;
      window.__frames(2);
      return {
        state: game.state,
        completed: game.laps.completed,
        voided: game.laps.voided,
        score: game.results?.score ?? null,
        bestLap: game.results?.bestLap ?? null,
        ref: window.__miniDrifters.referenceGhost(),
      };
    });
    assert.equal(runResult.state, 'finished');
    assert.deepEqual([runResult.completed, runResult.voided], [3, 0]);
    assert.ok(runResult.bestLap > 25 && runResult.bestLap < 60, `Redline Mesa lap ${runResult.bestLap}`);
    assert.equal(runResult.ref.lastResult?.saved, true, 'Redline Mesa saved reference ghost');
    assert.equal(await page.locator('#results').isVisible(), true);
    assert.equal(await page.locator('#new-lap').isVisible(), true);

    // Drive Again starts a fresh Redline Mesa run with saved reference loaded.
    await key('KeyR');
    const again = await page.evaluate(() => ({
      state: window.__miniDrifters.game.state,
      track: window.__miniDrifters.game.track.id,
      ref: window.__miniDrifters.referenceGhost(),
    }));
    assert.deepEqual([again.state, again.track, again.ref.shown], ['ready', 'redline-mesa', true]);

    // Reload browser and verify persistence + untouched v0.8.0 records.
    await page.reload();
    await page.waitForFunction(() => window.__miniDrifters, null, { polling: 50 });
    await frames(3);
    await page.locator('#tracks-open').click();
    await frames(2);
    assert.match(await page.locator('#pb-score').textContent(), /42,000/, 'Original v0.8.0 record preserved after reload');
    await page.locator('#tracks label[data-track="redline-mesa"]').click();
    await frames(2);
    assert.notEqual(await page.locator('#pb-lap').textContent(), '--', 'Redline Mesa fastest lap persists after reload');
    const persistedGhost = await page.evaluate((gKey) => {
      const store = JSON.parse(localStorage.getItem(gKey) ?? '{}');
      return {
        hasMesa: Boolean(store.ghosts?.['redline-mesa']?.classic),
        compat: store.ghosts?.['redline-mesa']?.classic?.compatibility,
      };
    }, GHOST_STORE_KEY);
    assert.deepEqual(persistedGhost, { hasMesa: true, compat: 1 });

    // Zero external requests (analytics gated off) and zero page errors.
    assert.deepEqual(externalRequests, [], `unexpected external requests: ${externalRequests.join(', ')}`);
    assert.deepEqual(errors, [], `page errors: ${errors.join('; ')}`);
    console.log(`${name} ${browser.version()}: 7-circuit Tracks UI, navigation, 4 new circuits gameplay, records/ghosts & analytics gating passed (${JSON.stringify(frameTimes)})`);
  } finally {
    await browser.close();
  }
}

try {
  await run(chromium, 'chromium');
  await run(firefox, 'firefox');
} finally {
  server.close();
}
