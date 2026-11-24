// Bounded startup and cleanup helper for tests that spawn server.mjs.
// Prefers OS-allocated dynamic ports (PORT=0), verifies the exact listening banner and HTTP
// identity of the server this call started, rejects explicitly on bind or startup failure,
// and only ever terminates the child process it created.
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const DEFAULT_SCRIPT = fileURLToPath(new URL('../../server.mjs', import.meta.url));
const LISTEN_BANNER = /^Mini Drifters: (http:\/\/127\.0\.0\.1:(\d+))$/;

function stopChild(child) {
  if (!child || child.exitCode !== null || child.signalCode !== null) return Promise.resolve();
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, 2000);
    timer.unref?.();
    child.once('exit', () => { clearTimeout(timer); resolve(); });
    try { child.kill(); } catch { clearTimeout(timer); resolve(); }
  });
}

async function verifyServer(url, child) {
  let response;
  try {
    response = await fetch(url);
  } catch (error) {
    throw new Error(`Health check failed for ${url}: ${error.message}`);
  }
  if (child.exitCode !== null || child.signalCode !== null) {
    throw new Error(`Spawned server exited (code=${child.exitCode}, signal=${child.signalCode}) during health check for ${url}`);
  }
  const type = response.headers.get('content-type') ?? '';
  const body = await response.text();
  if (response.status !== 200 || !type.includes('text/html') || !body.includes('<title>Mini Drifters') || !body.includes('src/main.js')) {
    throw new Error(`Unexpected response from ${url} (status=${response.status}, content-type=${type})`);
  }
}

export async function startLocalServer({
  script = DEFAULT_SCRIPT,
  port = 0,
  env = {},
  timeoutMs = 8000,
} = {}) {
  const requestedPort = Number(port);
  if (!Number.isInteger(requestedPort) || requestedPort < 0 || requestedPort > 65535) {
    throw new RangeError(`Invalid port: ${port}`);
  }
  const child = spawn(process.execPath, [script], {
    env: { ...process.env, ...env, PORT: String(requestedPort) },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let stdout = '';
  let stderr = '';
  let pendingLine = '';

  const banner = await new Promise((resolve, reject) => {
    let settled = false;
    const finish = (fn, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      fn(value);
    };
    const timer = setTimeout(() => {
      finish(reject, new Error(`Timed out waiting for local server on port ${requestedPort} (${timeoutMs} ms). stdout=${JSON.stringify(stdout)} stderr=${JSON.stringify(stderr)}`));
    }, timeoutMs);
    timer.unref?.();

    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stderr.on('data', (chunk) => { stderr += chunk; });
    child.stdout.on('data', (chunk) => {
      stdout += chunk;
      pendingLine += chunk;
      const lines = pendingLine.split(/\r?\n/);
      pendingLine = lines.pop() ?? '';
      for (const line of lines) {
        const match = LISTEN_BANNER.exec(line.trim());
        if (match) {
          const boundPort = Number(match[2]);
          if (requestedPort !== 0 && boundPort !== requestedPort) {
            finish(reject, new Error(`Local server bound port ${boundPort}, expected ${requestedPort}`));
            return;
          }
          finish(resolve, { base: match[1], url: `${match[1]}/`, port: boundPort });
          return;
        }
      }
    });
    child.once('error', (error) => finish(reject, error));
    child.once('exit', (code, signal) => {
      finish(reject, new Error(`Local server failed to start on port ${requestedPort} (code=${code}, signal=${signal}). stdout=${JSON.stringify(stdout.trim())} stderr=${JSON.stringify(stderr.trim())}`));
    });
  }).catch(async (error) => {
    await stopChild(child);
    throw error;
  });

  try {
    if (child.exitCode !== null || child.signalCode !== null) {
      throw new Error(`Local server exited immediately after startup banner (code=${child.exitCode}, signal=${child.signalCode})`);
    }
    await verifyServer(banner.url, child);
  } catch (error) {
    await stopChild(child);
    throw error;
  }

  let stopped = false;
  return {
    base: banner.base,
    url: banner.url,
    port: banner.port,
    child,
    stop: async () => {
      if (stopped) return;
      stopped = true;
      await stopChild(child);
    },
  };
}
