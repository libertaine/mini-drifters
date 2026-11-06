// A small static server for local play. The game itself is plain files, so any
// static host (GitHub Pages, for example) can serve it without this script.
import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const TYPES = { html: 'text/html; charset=utf-8', css: 'text/css; charset=utf-8', js: 'text/javascript; charset=utf-8' };
const ALLOWED = new Set(['/index.html', '/style.css']);
const SOURCE = /^\/src\/[a-z]+\.js$/;
const port = Number(process.env.PORT || 4190);

const server = http.createServer(async (req, res) => {
  let path = new URL(req.url, 'http://localhost').pathname;
  if (path === '/') path = '/index.html';
  if (!['GET', 'HEAD'].includes(req.method) || !(ALLOWED.has(path) || SOURCE.test(path))) {
    res.writeHead(404);
    res.end('Not found');
    return;
  }
  try {
    const bytes = await readFile(fileURLToPath(new URL(`.${path}`, import.meta.url)));
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
