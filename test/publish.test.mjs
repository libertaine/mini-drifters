// Checks that the game still works when served from a subfolder of a case-sensitive
// static host (GitHub Pages), and that the local server still works.
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const sourceFiles = readdirSync(join(root, 'src')).map((name) => join(root, 'src', name));

function existsWithExactCase(path) {
  let current = root;
  return relative(root, path).split(sep).every((part) => {
    const found = readdirSync(current).includes(part);
    current = join(current, part);
    return found;
  });
}

test('the page loads its stylesheet and script by relative path', () => {
  const html = readFileSync(join(root, 'index.html'), 'utf8');
  const references = [...html.matchAll(/\b(?:href|src)="([^"]+)"/g)].map((m) => m[1]);
  assert.deepEqual(references.sort(), ['src/main.js', 'style.css']);
  for (const reference of references) assert.ok(existsWithExactCase(join(root, reference)), reference);
});

test('every module import is relative and matches the file name exactly', () => {
  let imports = 0;
  for (const file of sourceFiles) {
    const code = readFileSync(file, 'utf8');
    for (const [, target] of code.matchAll(/from\s+'([^']+)'/g)) {
      imports += 1;
      assert.ok(target.startsWith('./'), `${file} imports ${target}`);
      assert.ok(existsWithExactCase(resolve(dirname(file), target)), `${file} imports ${target}`);
    }
  }
  assert.ok(imports > 5);
});

test('gameplay needs no external services', () => {
  const files = [...sourceFiles, join(root, 'index.html'), join(root, 'style.css')];
  for (const file of files) {
    const text = readFileSync(file, 'utf8');
    assert.doesNotMatch(text, /https?:\/\/|\bfetch\(|XMLHttpRequest|WebSocket|url\(/, file);
  }
});

test('the local server serves the game and nothing else', async () => {
  const port = 4193;
  const server = spawn(process.execPath, [join(root, 'server.mjs')], {
    env: { ...process.env, PORT: String(port) },
    stdio: ['ignore', 'pipe', 'inherit'],
  });
  try {
    await new Promise((ready, failed) => {
      server.stdout.once('data', ready);
      server.once('error', failed);
    });
    const status = async (path) => (await fetch(`http://127.0.0.1:${port}${path}`)).status;
    assert.equal(await status('/'), 200);
    assert.equal(await status('/style.css'), 200);
    assert.equal(await status('/src/main.js'), 200);
    assert.equal(await status('/server.mjs'), 404);
    assert.equal(await status('/package.json'), 404);
  } finally {
    server.kill();
  }
});
