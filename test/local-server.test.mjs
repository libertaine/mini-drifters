// Regression tests for hardened local server startup in test/support/local-server.mjs and server.mjs.
// Covers dynamic ephemeral port allocation, explicit bind-failure detection on occupied ports,
// rejection of arbitrary stdout, and strict child-only process cleanup.
import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { startLocalServer } from './support/local-server.mjs';

test('startLocalServer allocates a dynamic port, verifies Mini Drifters HTML, and stops cleanly', async () => {
  const srv = await startLocalServer({ port: 0 });
  try {
    assert.ok(Number.isInteger(srv.port) && srv.port > 0, `ephemeral port ${srv.port}`);
    assert.equal(srv.base, `http://127.0.0.1:${srv.port}`);
    assert.equal(srv.url, `http://127.0.0.1:${srv.port}/`);
    assert.equal(srv.child.exitCode, null, 'child server stays running while active');
    const html = await (await fetch(srv.url)).text();
    assert.match(html, /<title>Mini Drifters/);
    assert.match(html, /src\/main\.js/);
  } finally {
    await srv.stop();
  }
  assert.ok(srv.child.exitCode !== null || srv.child.signalCode !== null, 'stop() exits the spawned child');
});

test('startLocalServer rejects explicitly on an occupied port without touching the unrelated server', async () => {
  // Simulate an unrelated host Node server already occupying the requested port (R0 failure mode).
  const unrelated = http.createServer((_req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('unrelated host process');
  });
  await new Promise((resolve) => unrelated.listen(0, '127.0.0.1', resolve));
  const occupiedPort = unrelated.address().port;

  try {
    await assert.rejects(
      () => startLocalServer({ port: occupiedPort, timeoutMs: 4000 }),
      (error) => {
        assert.match(error.message, /failed to start/i);
        assert.match(error.message, /already in use/i);
        assert.match(error.message, /code=1/);
        return true;
      },
      'EADDRINUSE must fail explicitly and never be treated as successful startup',
    );
    // The unrelated host server must still be running and serving its own content untouched.
    const probe = await fetch(`http://127.0.0.1:${occupiedPort}/`);
    assert.equal(probe.status, 200);
    assert.equal(await probe.text(), 'unrelated host process');
  } finally {
    await new Promise((resolve) => unrelated.close(resolve));
  }
});

test('startLocalServer does not treat arbitrary stdout lines as server readiness', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'md-fake-server-'));
  const fakeScript = join(dir, 'fake-server.mjs');
  await writeFile(fakeScript, 'console.log("Not a Mini Drifters readiness banner");\nsetTimeout(() => {}, 5000);\n');
  try {
    await assert.rejects(
      () => startLocalServer({ script: fakeScript, port: 0, timeoutMs: 600 }),
      /Timed out waiting for local server/,
      'arbitrary stdout must never resolve readiness',
    );
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
