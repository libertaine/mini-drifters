// A small static server for local play. The game itself is plain files, so any
// static host (GitHub Pages, for example) can serve it without this script.
import http from 'node:http';
import { access, readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const TYPES = { html: 'text/html; charset=utf-8', css: 'text/css; charset=utf-8', js: 'text/javascript; charset=utf-8', wav: 'audio/wav', mp3: 'audio/mpeg', md: 'text/plain; charset=utf-8' };
const ALLOWED = new Set(['/index.html', '/style.css']);
// Development only. Pages copies index.html, style.css and src/, never this lab.
const LAB = new Set(['index.html', 'lab.css', 'lab.js', 'model.js', 'audio.js', 'voices.js', 'coyote.js', 'coyote-model.js',
  'assets/coyote-local/idle.wav', 'assets/coyote-local/mid.wav', 'assets/coyote-local/load.wav',
  'assets/coyote-local/high.wav', 'assets/coyote-local/incar-reference.wav',
  'assets/engine-low.wav', 'assets/engine-high.wav', 'assets/tire-foley.mp3', 'assets/ATTRIBUTION.md']
  .map((file) => `/audio-lab/${file}`));
const SOURCE = /^\/src\/[a-z]+(-[a-z]+)*\.js$/;
const port = Number(process.env.PORT || 4190);

// The game tries the private Coyote recordings only when this tag says all four
// exist. Static hosts never get the tag, so they are never asked for those files.
// COYOTE_LOCAL=off plays a public checkout's sound on a machine that has them.
const COYOTE_BANK = ['idle', 'mid', 'load', 'high'].map((key) => new URL(`audio-lab/assets/coyote-local/${key}.wav`, import.meta.url));
const COYOTE_TAG = '<meta name="mini-drifters-engine" content="coyote-local">\n';

async function coyoteAvailable() {
  if (process.env.COYOTE_LOCAL === 'off') return false;
  try {
    await Promise.all(COYOTE_BANK.map((file) => access(file)));
    return true;
  } catch {
    return false;
  }
}

const server = http.createServer(async (req, res) => {
  let path = new URL(req.url, 'http://localhost').pathname;
  if (path === '/audio-lab' && ['GET', 'HEAD'].includes(req.method)) {
    res.writeHead(308, { Location: '/audio-lab/' }); res.end(); return;
  }
  if (path === '/audio-lab/') path = '/audio-lab/index.html';
  if (path === '/') path = '/index.html';
  if (!['GET', 'HEAD'].includes(req.method) || !(ALLOWED.has(path) || SOURCE.test(path) || LAB.has(path))) {
    res.writeHead(404);
    res.end('Not found');
    return;
  }
  try {
    let bytes = await readFile(fileURLToPath(new URL(`.${path}`, import.meta.url)));
    if (path === '/index.html' && await coyoteAvailable()) {
      bytes = Buffer.from(bytes.toString('utf8').replace('</head>', `${COYOTE_TAG}</head>`));
    }
    res.writeHead(200, { 'Content-Type': TYPES[path.split('.').pop()], 'Cache-Control': 'no-store' });
    res.end(req.method === 'HEAD' ? undefined : bytes);
  } catch {
    res.writeHead(404);
    res.end('Not found');
  }
});

server.on('error', (error) => {
  if (error.code === 'EADDRINUSE') {
    console.log(`Port ${port} is already in use, so the game may already be running.`);
    console.log(`Try http://127.0.0.1:${port}`);
  } else {
    console.error(error);
  }
  process.exitCode = 1;
});

server.listen(port, '127.0.0.1', () => {
  console.log(`Mini Drifters: http://127.0.0.1:${port}`);
  console.log('Leave this window open while you play. Close it to stop the game.');
});
