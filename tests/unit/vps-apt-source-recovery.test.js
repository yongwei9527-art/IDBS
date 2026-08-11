const fs = require('fs');
const path = require('path');
const test = require('node:test');
const assert = require('node:assert/strict');

const root = path.resolve(__dirname, '../..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');

test('VPS installation disables only retired Debian 11 backports before apt update', () => {
  const common = read('deploy/vps-common.sh');
  const installer = read('scripts/install.sh');
  const deployer = read('scripts/deploy-ubuntu.sh');
  const preparer = read('scripts/prepare-vps.sh');

  assert.match(common, /disable_retired_bullseye_backports\(\)/);
  assert.match(common, /ID:-.*debian/);
  assert.match(common, /VERSION_CODENAME:-.*bullseye/);
  assert.match(common, /bullseye-backports/);
  assert.match(common, /laboratory-management-system-backup/);
  assert.match(common, /safe_apt_update\(\)/);
  assert.match(installer, /safe_apt_update/);
  assert.match(deployer, /safe_apt_update -y/);
  assert.match(installer, /Downloading installation helper/);
  assert.match(installer, /--connect-timeout 15 --max-time 120 --retry 3/);
  assert.match(installer, /http\.lowSpeedLimit=1024/);
  assert.match(installer, /clone --progress/);
  assert.match(preparer, /disable_retired_bullseye_backports/);
  assert.match(preparer, /laboratory-management-system-backup/);
  assert.doesNotMatch(installer, /^\s*apt-get update\s*$/m);
  assert.doesNotMatch(deployer, /^\s*apt-get update\s+-y\s*$/m);
});
