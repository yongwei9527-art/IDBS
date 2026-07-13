#!/usr/bin/env node
/*
 * Runs browser regression tests against a disposable, explicitly named E2E database.
 * It never falls back to DATABASE_URL so a developer or production database cannot be
 * prepared, seeded, or tested accidentally.
 */
require('dotenv').config({ quiet: true });

const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const NODE = process.execPath;
const E2E_DATABASE_URL = String(process.env.E2E_DATABASE_URL || '').trim();
const E2E_PORT = Number(process.env.E2E_PORT || 3100);
const E2E_BASE_URL = String(process.env.E2E_BASE_URL || `http://127.0.0.1:${E2E_PORT}`).replace(/\/+$/, '');
const PREPARE = String(process.env.E2E_PREPARE ?? 'true').toLowerCase() !== 'false';
const BUILD = String(process.env.E2E_BUILD ?? 'true').toLowerCase() !== 'false';
const READY_TIMEOUT_MS = Number(process.env.E2E_READY_TIMEOUT_MS || 45_000);
const TEST_UPLOAD_DIR = path.join(ROOT, '.idbs-runtime', 'e2e-uploads');

function fail(message) {
  console.error(`E2E isolation error: ${message}`);
  process.exitCode = 1;
}

function assertIsolatedDatabase(connectionString) {
  if (!connectionString) throw new Error('E2E_DATABASE_URL is required; DATABASE_URL is intentionally ignored.');
  let url;
  try {
    url = new URL(connectionString);
  } catch (_) {
    throw new Error('E2E_DATABASE_URL must be a valid PostgreSQL connection URL.');
  }
  if (!/^postgres(?:ql)?:$/i.test(url.protocol)) throw new Error('E2E_DATABASE_URL must use the postgresql protocol.');
  const databaseName = decodeURIComponent(url.pathname || '').replace(/^\//, '').toLowerCase();
  if (!/(^|[_-])e2e([_-]|$)/.test(databaseName)) {
    throw new Error(`Database "${databaseName || '(missing)'}" is not explicitly marked as an E2E database. Use a name such as idbs_e2e.`);
  }
}

function run(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: ROOT,
      env: options.env || process.env,
      stdio: options.stdio || 'inherit',
      windowsHide: true
    });
    child.once('error', reject);
    child.once('exit', (code, signal) => {
      if (code === 0) resolve();
      else reject(new Error(`${path.basename(command)} ${args.join(' ')} exited with ${signal || code}`));
    });
  });
}

function startServer(env) {
  const child = spawn(NODE, ['server.js'], {
    cwd: ROOT,
    env,
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true
  });
  child.stdout.on('data', (chunk) => process.stdout.write(`[e2e-server] ${chunk}`));
  child.stderr.on('data', (chunk) => process.stderr.write(`[e2e-server] ${chunk}`));
  return child;
}

async function waitForReady(server) {
  const deadline = Date.now() + READY_TIMEOUT_MS;
  let lastError = null;
  while (Date.now() < deadline) {
    if (server.exitCode !== null) throw new Error(`E2E server exited before readiness (code ${server.exitCode}).`);
    try {
      const response = await fetch(`${E2E_BASE_URL}/ready`);
      if (response.ok) return;
      lastError = new Error(`ready returned ${response.status}`);
    } catch (error) {
      lastError = error;
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error(`Timed out waiting for ${E2E_BASE_URL}/ready${lastError ? `: ${lastError.message}` : ''}`);
}

async function stopServer(server) {
  if (!server || server.exitCode !== null) return;
  server.kill('SIGTERM');
  await new Promise((resolve) => {
    const timeout = setTimeout(() => {
      if (server.exitCode === null) server.kill('SIGKILL');
      resolve();
    }, 10_000);
    server.once('exit', () => {
      clearTimeout(timeout);
      resolve();
    });
  });
}

async function main() {
  assertIsolatedDatabase(E2E_DATABASE_URL);
  if (!Number.isInteger(E2E_PORT) || E2E_PORT < 1 || E2E_PORT > 65535) throw new Error('E2E_PORT must be a valid TCP port.');
  const baseUrl = new URL(E2E_BASE_URL);
  if (!['127.0.0.1', 'localhost'].includes(baseUrl.hostname) || Number(baseUrl.port || 80) !== E2E_PORT) {
    throw new Error('E2E_BASE_URL must point to the local E2E server and use E2E_PORT.');
  }

  fs.mkdirSync(TEST_UPLOAD_DIR, { recursive: true });
  const sharedEnv = {
    ...process.env,
    NODE_ENV: 'test',
    DATABASE_URL: E2E_DATABASE_URL,
    PORT: String(E2E_PORT),
    CORS_ORIGIN: E2E_BASE_URL,
    UPLOAD_DIR: TEST_UPLOAD_DIR,
    AUTH_RATE_LIMIT_MAX: String(process.env.E2E_AUTH_RATE_LIMIT_MAX || 1000),
    AUTH_RATE_LIMIT_WINDOW_MS: String(process.env.E2E_AUTH_RATE_LIMIT_WINDOW_MS || 60_000),
    API_RATE_LIMIT_MAX: String(process.env.E2E_API_RATE_LIMIT_MAX || 5000),
    API_RATE_LIMIT_WINDOW_MS: String(process.env.E2E_API_RATE_LIMIT_WINDOW_MS || 60_000),
    E2E_BASE_URL
  };

  if (BUILD) await run(NODE, [path.join('web', 'node_modules', 'vite', 'bin', 'vite.js'), 'build'], { env: sharedEnv });
  if (PREPARE) {
    await run(NODE, [path.join('scripts', 'prepare-demo-db.js')], { env: sharedEnv });
    await run(NODE, [path.join('scripts', 'seed-demo-data.js')], { env: sharedEnv });
  }

  let server;
  try {
    server = startServer(sharedEnv);
    await waitForReady(server);
    await run(NODE, [path.join('node_modules', '@playwright', 'test', 'cli.js'), 'test'], { env: sharedEnv });
  } finally {
    await stopServer(server);
  }
}

main().catch((error) => {
  fail(error?.message || String(error));
});
