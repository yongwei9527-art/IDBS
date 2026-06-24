const baseUrl = (process.argv[2] || process.env.SMOKE_BASE_URL || 'http://127.0.0.1:3000').replace(/\/$/, '');

async function check(name, path, expectedStatuses = [200]) {
  const response = await fetch(`${baseUrl}${path}`);
  const body = await response.text();
  const ok = expectedStatuses.includes(response.status);
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name} -> ${response.status}`);
  if (!ok) {
    console.log(body);
    process.exitCode = 1;
  }
}

async function main() {
  console.log(`Smoke testing ${baseUrl}`);
  await check('health', '/health', [200]);
  await check('ready', '/ready', [200, 503]);
  await check('device list', '/api/devices', [200, 500]);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
