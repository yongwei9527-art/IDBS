#!/usr/bin/env node
/**
 * Start API server and Vite web dev server together for local development.
 */
const { spawn } = require('child_process');
const path = require('path');

const nodeBin = process.execPath;
const root = path.resolve(__dirname, '..');

function run(label, command, args, cwd) {
  const child = spawn(command, args, {
    cwd,
    stdio: 'inherit',
    env: process.env,
    shell: process.platform === 'win32'
  });
  child.on('exit', (code, signal) => {
    console.log(`[${label}] exited`, { code, signal });
    process.exitCode = code || 0;
  });
  return child;
}

console.log('Starting API (server.js) and web (vite)...');
const api = run('api', nodeBin, ['server.js'], root);
const web = run('web', process.platform === 'win32' ? 'npm.cmd' : 'npm', ['run', 'dev'], path.join(root, 'web'));

function shutdown() {
  api.kill('SIGTERM');
  web.kill('SIGTERM');
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
