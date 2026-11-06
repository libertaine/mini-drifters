// Checks that the game still works when served from a subfolder of a case-sensitive
// static host (GitHub Pages), and that the local server still works.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync, spawn } from 'node:child_process';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
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

test('the only network requests in the game are for its own sound files', () => {
  const requesters = sourceFiles.filter((file) => /\bfetcher\(/.test(readFileSync(file, 'utf8')));
  assert.deepEqual(requesters.map((file) => relative(join(root, 'src'), file)).sort(), ['audio-voices.js', 'coyote.js']);
  for (const file of requesters) {
    for (const [, target] of readFileSync(file, 'utf8').matchAll(/fetcher\(new URL\(([^,]+), import\.meta\.url\)/g)) {
      assert.match(target, /^(TIRE_FILE|COYOTE_FOLDER \+ file)$/, file);
    }
  }
  assert.match(readFileSync(join(root, 'src/audio-voices.js'), 'utf8'), /TIRE_FILE = '\.\.\/audio-lab\/assets\/tire-foley\.mp3'/);
  assert.match(readFileSync(join(root, 'src/coyote.js'), 'utf8'), /COYOTE_FOLDER = '\.\.\/audio-lab\/assets\/coyote-local\/'/);
});

const COYOTE_LOOPS = ['idle', 'mid', 'load', 'high'].map((key) => `audio-lab/assets/coyote-local/${key}.wav`);
const provenance = JSON.parse(readFileSync(join(root, 'docs/COYOTE-PROVENANCE.json'), 'utf8'));

test('Pages publishes the tire file, the four authorized loops and their attribution, and nothing else', () => {
  const workflow = readFileSync(join(root, '.github/workflows/ci.yml'), 'utf8');
  const copies = workflow.split('\n').map((line) => line.trim()).filter((line) => /^(cp|mkdir|rsync|mv|tar)\b/.test(line));
  assert.deepEqual(copies, [
    'mkdir -p _site/audio-lab/assets/coyote-local',
    'cp -r index.html style.css src _site/',
    'cp audio-lab/assets/tire-foley.mp3 audio-lab/assets/ATTRIBUTION.md _site/audio-lab/assets/',
    `cp ${COYOTE_LOOPS.join(' ')} _site/audio-lab/assets/coyote-local/`,
  ]);
  assert.doesNotMatch(workflow, /Mustang|incar-reference|engine-(low|high)\.wav|\*\.wav/i);
  assert.equal(workflow.match(/pull_request:\s+branches: \[([^\]]+)\]/)[1], 'main, experiment/audio-lab, experiment/coyote-hybrid, experiment/gameplay-audio');
});

test('the published tire file is the attributed CC0 original', () => {
  const attribution = readFileSync(join(root, 'audio-lab/assets/ATTRIBUTION.md'), 'utf8');
  const digest = createHash('sha256').update(readFileSync(join(root, 'audio-lab/assets/tire-foley.mp3'))).digest('hex');
  assert.match(attribution, new RegExp(`tire-foley\\.mp3 \\| \`${digest}\``));
  assert.match(attribution, /Joseph SARDIN/);
  assert.match(attribution, /CC0/);
});

test('the published loops are exactly the ones in the provenance record', () => {
  let bytes = 0, seconds = 0;
  for (const file of COYOTE_LOOPS) {
    const name = file.split('/').pop();
    const entry = provenance.loops.find((loop) => loop.file === name);
    const data = readFileSync(join(root, file));
    assert.equal(createHash('sha256').update(data).digest('hex'), entry.sha256, file);
    assert.equal(data.length, entry.bytes, file);
    bytes += data.length;
    seconds += entry.seconds;
  }
  assert.equal(bytes, provenance.runtimeBytes);
  assert.ok(bytes < 250 * 1024, `${bytes} bytes`);
  // Short processed loops, nowhere near the 77-second master.
  assert.ok(seconds < 5, `${seconds} seconds of audio`);
});

test('the Mustang recordings keep their own terms: not MIT, not CC0 and no broader license', () => {
  const audio = readFileSync(join(root, 'LICENSE-AUDIO.md'), 'utf8');
  for (const file of COYOTE_LOOPS) assert.ok(audio.includes(file), file);
  assert.match(audio, /not MIT and not CC0/i);
  assert.match(audio, /No other license is granted/);
  assert.match(provenance.rights, /Not MIT and not CC0/);
  const section = readFileSync(join(root, 'audio-lab/assets/ATTRIBUTION.md'), 'utf8').split('## Mustang engine recordings')[1];
  assert.ok(section, 'the attribution has a Mustang section');
  assert.match(section, /owns all rights/);
  assert.match(section, /do not apply/);
  assert.doesNotMatch(section, /Creative Commons|creativecommons|public domain/i);
  assert.match(readFileSync(join(root, 'README.md'), 'utf8'), /LICENSE-AUDIO\.md/);
  assert.match(readFileSync(join(root, 'LICENSE'), 'utf8'), /MIT License/);
});

test('private recordings are ignored, untracked and not embedded in anything tracked', (t) => {
  const ignore = readFileSync(join(root, '.gitignore'), 'utf8');
  for (const pattern of ['.local/', 'audio-lab/assets/coyote-local/incar-reference.wav', 'audio-lab/assets/Mustang-Dyno*.wav']) {
    assert.ok(ignore.split(/\r?\n/).includes(pattern), pattern);
  }
  for (const file of sourceFiles) assert.doesNotMatch(readFileSync(file, 'utf8'), /data:audio|base64|UklGR/, file);
  let tracked;
  try {
    tracked = execFileSync('git', ['ls-files'], { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).split('\n');
  } catch {
    t.skip('git is unavailable here, so tracked files were not listed');
    return;
  }
  const audio = tracked.filter((file) => /\.(wav|mp3|ogg|flac|m4a|aac)$/i.test(file)).sort();
  assert.deepEqual(audio, [...COYOTE_LOOPS, 'audio-lab/assets/engine-high.wav', 'audio-lab/assets/engine-low.wav', 'audio-lab/assets/tire-foley.mp3'].sort());
  assert.equal(tracked.some((file) => /Mustang|incar-reference|^\.local\//.test(file)), false);
});

test('the public fallback is never described as a recording', () => {
  const main = readFileSync(join(root, 'src/main.js'), 'utf8');
  assert.match(main, /synthesized fallback \(not a recording\)/);
  assert.match(main, /sound\.engine === 'coyote' \? 'Engine: Coyote Hybrid/);
  const audio = readFileSync(join(root, 'src/audio.js'), 'utf8');
  assert.match(audio, /s\.engineKind = coyote \? 'coyote' : 'fallback'/);
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
    assert.equal(await status('/src/audio-telemetry.js'), 200);
    for (const path of ['/src/../server.mjs', '/src/-audio.js', '/src/audio-.js', '/src/Audio.js', '/src/audio.mjs', '/src/x/audio.js', '/src/audio-telemetry.js.map']) {
      assert.equal(await status(path), 404, path);
    }
  } finally {
    server.kill();
  }
});

async function servedPage(port, env) {
  const server = spawn(process.execPath, [join(root, 'server.mjs')], {
    env: { ...process.env, PORT: String(port), ...env },
    stdio: ['ignore', 'pipe', 'inherit'],
  });
  try {
    await new Promise((ready, failed) => {
      server.stdout.once('data', ready);
      server.once('error', failed);
    });
    return await (await fetch(`http://127.0.0.1:${port}/`)).text();
  } finally {
    server.kill();
  }
}

test('the published page plays Coyote, and COYOTE_LOCAL=off plays the fallback', async () => {
  const tag = /<meta name="mini-drifters-engine" content="coyote-local">/;
  assert.match(readFileSync(join(root, 'index.html'), 'utf8'), tag);
  assert.match(await servedPage(4192, { COYOTE_LOCAL: '' }), tag);
  assert.doesNotMatch(await servedPage(4191, { COYOTE_LOCAL: 'off' }), /mini-drifters-engine/);
  for (const file of COYOTE_LOOPS) assert.ok(existsSync(join(root, file)), file);
});
