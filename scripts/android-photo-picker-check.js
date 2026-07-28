const fs = require('node:fs');
const path = require('node:path');
const WebSocket = require('ws');

const outputPath = path.resolve(process.argv[2] || path.join(process.cwd(), 'work', 'photo-picker-check.json'));
const FIXED_ORIGIN = 'http://127.0.0.1:5173';
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function connect() {
  const targets = await fetch('http://127.0.0.1:9222/json').then((response) => response.json());
  const target = targets.find((item) => item.type === 'page');
  if (!target) throw new Error('No debuggable WebView page found.');
  const socket = new WebSocket(target.webSocketDebuggerUrl);
  const pending = new Map();
  let nextId = 0;
  socket.on('message', (raw) => {
    const message = JSON.parse(raw.toString());
    if (!message.id || !pending.has(message.id)) return;
    const promise = pending.get(message.id);
    pending.delete(message.id);
    if (message.error) promise.reject(new Error(message.error.message));
    else promise.resolve(message.result);
  });
  await new Promise((resolve, reject) => {
    socket.once('open', resolve);
    socket.once('error', reject);
  });
  const send = (method, params = {}) => new Promise((resolve, reject) => {
    const id = ++nextId;
    pending.set(id, { resolve, reject });
    socket.send(JSON.stringify({ id, method, params }));
  });
  await Promise.all([send('Runtime.enable'), send('Page.enable')]);
  return { socket, send };
}

async function evaluate(send, expression) {
  const result = await send('Runtime.evaluate', {
    expression,
    returnByValue: true,
    awaitPromise: true,
    userGesture: true
  });
  if (result.exceptionDetails) throw new Error('WebView evaluation failed.');
  return result.result.value;
}

(async () => {
  const { socket, send } = await connect();
  await evaluate(send, `location.href = '${FIXED_ORIGIN}/v5/faults'; true`);
  await wait(2200);
  const preflight = await evaluate(send, `(() => {
    const inputs = Array.from(document.querySelectorAll('input[type="file"]'));
    const imageInputs = inputs.filter((input) => String(input.accept || '').toLowerCase().includes('image'));
    return {
      fixedOrigin: location.origin === '${FIXED_ORIGIN}',
      route: location.pathname,
      appLayoutVisible: Boolean(document.querySelector('.ops-app-shell,.ops-main,.ops-page-area')),
      loginVisible: Boolean(document.querySelector('input[type="password"]')),
      imageInputCount: imageInputs.length,
      allImageAcceptOnly: imageInputs.length > 0 && imageInputs.every((input) => String(input.accept || '').toLowerCase() === 'image/*'),
      captureAttributeCount: imageInputs.filter((input) => input.hasAttribute('capture')).length,
      fileCountBeforeOpen: null
    };
  })()`);
  if (!preflight.fixedOrigin || preflight.route !== '/v5/faults' || !preflight.appLayoutVisible || preflight.loginVisible) {
    throw new Error('Fixed-origin authenticated app preflight failed.');
  }
  if (!preflight.imageInputCount || preflight.captureAttributeCount) {
    throw new Error('Image input is missing or requests direct capture.');
  }
  const opened = await evaluate(send, `(() => {
    const input = Array.from(document.querySelectorAll('input[type="file"]'))
      .find((element) => String(element.accept || '').toLowerCase().includes('image'));
    if (!input) return false;
    input.click();
    return true;
  })()`);
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, JSON.stringify({ ...preflight, chooserInvocationRequested: Boolean(opened) }, null, 2) + '\n', 'utf8');
  socket.close();
  process.stdout.write(JSON.stringify({ outputPath, ...preflight, chooserInvocationRequested: Boolean(opened) }) + '\n');
})().catch((error) => {
  process.stderr.write(error.message + '\n');
  process.exitCode = 1;
});