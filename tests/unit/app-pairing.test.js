const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const http = require('node:http');
const { createV5AppConfigRouter } = require('../../src/routes/v5/app-config');
const { sendError } = require('../../src/lib/http');

const config = {
  appName: '实验室管理系统',
  appPublicUrl: 'https://lab.example.com',
  appPairingSecret: 'pairing-test-secret-that-is-longer-than-thirty-two-characters',
  appPairingTtlMinutes: 10,
  apkDownloadUrl: 'https://lab.example.com/download/app.apk'
};

async function withServer(routerConfig, work) {
  const app = express();
  app.use(express.json());
  app.use('/api/v5', createV5AppConfigRouter(routerConfig));
  app.use((error, req, res, _next) => sendError(res, error));
  const server = await new Promise((resolve) => {
    const instance = app.listen(0, '127.0.0.1', () => resolve(instance));
  });
  try {
    const address = server.address();
    await work(`http://127.0.0.1:${address.port}`);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

async function jsonRequest(base, pathname, options = {}) {
  const response = await fetch(`${base}${pathname}`, options);
  const body = await response.json();
  return { response, body, data: body.data };
}

test('signed pairing exchanges only public server configuration', async () => {
  await withServer(config, async (base) => {
    const appConfig = await jsonRequest(base, '/api/v5/app-config');
    assert.equal(appConfig.response.status, 200);
    assert.equal(appConfig.data.server_url, 'https://lab.example.com');
    assert.equal(appConfig.data.pairing_available, true);
    assert.doesNotMatch(JSON.stringify(appConfig.body), /pairing-test-secret|password|token_secret/i);

    const pairing = await jsonRequest(base, '/api/v5/app-pairing');
    assert.equal(pairing.response.status, 200);
    const uri = new URL(pairing.data.pairing_uri);
    assert.equal(uri.protocol, 'https:');
    assert.equal(uri.hostname, 'lab.example.com');
    assert.equal(uri.pathname, '/api/v5/app-pairing/link');
    assert.equal(uri.searchParams.get('v'), '2');
    assert.equal(uri.searchParams.get('server'), 'https://lab.example.com');
    assert.ok(uri.searchParams.get('token'));
    assert.doesNotMatch(pairing.data.pairing_uri, /pairing-test-secret|admin|password/i);
    const fallbackUri = new URL(pairing.data.fallback_pairing_uri);
    assert.equal(fallbackUri.protocol, 'labapp:');
    assert.equal(fallbackUri.hostname, 'pair');
    assert.equal(fallbackUri.search, uri.search);

    const appLink = await fetch(`${base}${uri.pathname}${uri.search}`, { redirect: 'manual' });
    assert.equal(appLink.status, 302);
    assert.equal(appLink.headers.get('location'), pairing.data.fallback_pairing_uri);

    const exchangePayload = {
      v: uri.searchParams.get('v'),
      server: uri.searchParams.get('server'),
      token: uri.searchParams.get('token'),
      installation_id: 'test-installation-0001'
    };
    const exchange = await jsonRequest(base, '/api/v5/app-pairing/exchange', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(exchangePayload)
    });
    assert.equal(exchange.response.status, 200);
    assert.equal(exchange.data.api_base_url, 'https://lab.example.com/api/v5');
    assert.match(exchange.data.instance_id, /^[A-Za-z0-9][A-Za-z0-9._:-]{7,127}$/);
    assert.match(exchange.data.instance_fingerprint, /^[a-f0-9]{64}$/);
    assert.doesNotMatch(JSON.stringify(exchange.body), /pairing-test-secret|admin_password|database_url/i);

    const replay = await jsonRequest(base, '/api/v5/app-pairing/exchange', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(exchangePayload)
    });
    assert.equal(replay.response.status, 400);

    const qr = await fetch(`${base}/api/v5/app-pairing/qr.svg`);
    assert.equal(qr.status, 200);
    assert.match(qr.headers.get('content-type') || '', /image\/svg\+xml/);
    assert.match(qr.headers.get('cache-control') || '', /no-store/);
    assert.match(await qr.text(), /<svg/);
  });
});

test('tampered, expired and cross-server pairing data is rejected', async () => {
  await withServer(config, async (base) => {
    const pairing = await jsonRequest(base, '/api/v5/app-pairing');
    const uri = new URL(pairing.data.pairing_uri);
    const token = uri.searchParams.get('token');
    const common = {
      v: '2',
      server: 'https://lab.example.com',
      token,
      installation_id: 'test-installation-0002'
    };
    const tamperIndex = Math.floor(token.length / 2);
    const tamperedToken = `${token.slice(0, tamperIndex)}${token[tamperIndex] === 'A' ? 'B' : 'A'}${token.slice(tamperIndex + 1)}`;

    for (const payload of [
      { ...common, server: 'https://other.example.com' },
      { ...common, token: tamperedToken },
      {
        ...common,
        token: Buffer.from(JSON.stringify({
          e: '2020-01-01T00:00:00.000Z',
          n: 'n'.repeat(32),
          p: 'invalid'
        })).toString('base64url')
      }
    ]) {
      const result = await jsonRequest(base, '/api/v5/app-pairing/exchange', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      assert.equal(result.response.status, 400);
    }
  });
});

test('pairing is unavailable for insecure origins or malformed configured URLs', async () => {
  for (const appPublicUrl of ['http://192.0.2.10', 'https://lab.example.com/path']) {
    await withServer({ ...config, appPublicUrl }, async (base) => {
      const result = await jsonRequest(base, '/api/v5/app-pairing');
      assert.equal(result.response.status, 503);
    });
  }
});

test('pairing is unavailable for padded or repeated-character secrets', async () => {
  for (const appPairingSecret of [` ${'a'.repeat(32)}`, `${'a'.repeat(32)} `, 'a'.repeat(32)]) {
    await withServer({ ...config, appPairingSecret }, async (base) => {
      const result = await jsonRequest(base, '/api/v5/app-pairing');
      assert.equal(result.response.status, 503);
    });
  }
});

test('public app config never reflects download URL credentials', async () => {
  await withServer({ ...config, apkDownloadUrl: 'https://user:secret@downloads.example.com/app.apk' }, async (base) => {
    const result = await jsonRequest(base, '/api/v5/app-config');
    assert.equal(result.response.status, 200);
    assert.equal(result.data.apk_download_url, 'https://lab.example.com/download/app.apk');
    assert.doesNotMatch(JSON.stringify(result.body), /user:secret/);
  });
});
