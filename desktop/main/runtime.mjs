import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { setTimeout as delay } from 'node:timers/promises';
import { access } from 'node:fs/promises';
import path from 'node:path';
import { app } from 'electron';

const READY_TIMEOUT_MS = 120_000;
const STOP_TIMEOUT_MS = 5_000;

let child;
let stopping;
let ready = false;
let stopRequested = false;
let failureHandler = () => {};
let spawnError;

function log(message) {
  console.log(`[desktop] ${message}`);
}

async function getFreePort() {
  const server = createServer();
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const { port } = server.address();
  await new Promise((resolve, reject) =>
    server.close((error) => (error ? reject(error) : resolve())),
  );
  return port;
}

async function findNodeExecutable() {
  const candidates = [process.env.npm_node_execpath, process.execPath];
  if (process.versions.electron) {
    for (const directory of (process.env.PATH ?? '').split(path.delimiter)) {
      candidates.push(path.join(directory, process.platform === 'win32' ? 'node.exe' : 'node'));
    }
  }

  for (const candidate of candidates.filter(Boolean)) {
    try {
      await access(candidate);
      if (
        candidate === process.execPath &&
        process.versions.electron &&
        !process.env.ELECTRON_RUN_AS_NODE
      ) {
        continue;
      }
      return candidate;
    } catch {
      // Try the next executable candidate.
    }
  }

  throw new Error(
    'Could not find a Node.js executable. Run Electron through pnpm with Node.js >= 22.19 installed.',
  );
}

function terminateProcessTree(processHandle) {
  if (process.platform === 'win32') {
    const taskkill = path.join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'taskkill.exe');
    const killer = spawn(taskkill, ['/PID', String(processHandle.pid), '/T', '/F'], {
      stdio: 'ignore',
    });
    return new Promise((resolve) => {
      killer.once('error', () => {
        processHandle.kill();
        resolve();
      });
      killer.once('exit', resolve);
    });
  }

  processHandle.kill('SIGTERM');
  return Promise.resolve();
}

async function waitForExit(processHandle, timeoutMs) {
  if (processHandle.exitCode !== null || processHandle.signalCode !== null) return true;
  return Promise.race([
    new Promise((resolve) => processHandle.once('exit', () => resolve(true))),
    delay(timeoutMs).then(() => false),
  ]);
}

export function onRuntimeFailure(handler) {
  failureHandler = handler;
}

export async function startRuntime() {
  const root = app.getAppPath();
  const port = await getFreePort();
  const node = await findNodeExecutable();
  if (stopRequested) throw new Error('Desktop app is quitting; runtime startup was cancelled.');
  const nextCli = path.join(root, 'node_modules', 'next', 'dist', 'bin', 'next');

  log('starting OpenMAIC runtime');
  log(`runtime port: ${port}`);

  child = spawn(node, [nextCli, 'dev', '--hostname', '127.0.0.1', '--port', String(port)], {
    cwd: root,
    env: {
      ...process.env,
      HOSTNAME: '127.0.0.1',
      PORT: String(port),
      NODE_ENV: 'development',
      NEXT_TELEMETRY_DISABLED: '1',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
  });

  child.stdout.setEncoding('utf8').on('data', (chunk) => process.stdout.write(chunk));
  child.stderr.setEncoding('utf8').on('data', (chunk) => process.stderr.write(chunk));
  child.once('error', (error) => {
    if (!ready) {
      spawnError = error;
      return;
    }
    log(`OpenMAIC runtime failed: ${error.message}`);
    failureHandler(error);
  });
  child.once('exit', (code, signal) => {
    if (stopping || !ready) return;
    const error = new Error(
      `OpenMAIC runtime exited unexpectedly (code ${code ?? 'unknown'}, signal ${signal ?? 'none'}).`,
    );
    log(`OpenMAIC runtime failed: ${error.message}`);
    failureHandler(error);
  });

  const url = `http://127.0.0.1:${port}`;
  const deadline = Date.now() + READY_TIMEOUT_MS;
  log('waiting for OpenMAIC');

  while (Date.now() < deadline) {
    if (spawnError) throw new Error(`Could not start OpenMAIC runtime: ${spawnError.message}`);
    if (child.exitCode !== null || child.signalCode !== null) {
      throw new Error(
        `OpenMAIC runtime exited before becoming ready (code ${child.exitCode ?? 'unknown'}, signal ${child.signalCode ?? 'none'}).`,
      );
    }
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(1_000) });
      if (response.ok || response.status < 500) {
        ready = true;
        log('OpenMAIC ready');
        return { port, url };
      }
    } catch {
      // The Next.js dev server is still starting.
    }
    await delay(300);
  }

  throw new Error(`Timed out after ${READY_TIMEOUT_MS / 1_000}s waiting for OpenMAIC at ${url}.`);
}

export function stopRuntime() {
  if (stopping) return stopping;
  stopRequested = true;
  if (!child || child.exitCode !== null || child.signalCode !== null) {
    log('runtime stopped');
    return Promise.resolve();
  }

  stopping = (async () => {
    log('stopping runtime');
    await terminateProcessTree(child);
    if (!(await waitForExit(child, STOP_TIMEOUT_MS))) {
      if (process.platform === 'win32') {
        child.kill();
      } else {
        child.kill('SIGKILL');
      }
      await waitForExit(child, STOP_TIMEOUT_MS);
    }
    log('runtime stopped');
  })();
  return stopping;
}
