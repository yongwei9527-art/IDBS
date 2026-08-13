const test = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const installerPath = path.resolve(__dirname, '../../scripts/install.sh');
const installer = fs.readFileSync(installerPath, 'utf8');
const deployer = fs.readFileSync(path.resolve(__dirname, '../../scripts/deploy-ubuntu.sh'), 'utf8');

function extractShellFunction(name) {
  const marker = `${name}() {`;
  const start = installer.indexOf(marker);
  assert.notEqual(start, -1, `missing shell function: ${name}`);

  // Installer functions close with an unindented brace. This deliberately
  // avoids evaluating or sourcing the root-only installer during unit tests.
  const end = installer.indexOf('\n}\n', start);
  assert.notEqual(end, -1, `unterminated shell function: ${name}`);
  return installer.slice(start, end + 3);
}

function runReadinessFaultScenario({ activeAfter, readyAfter }) {
  const readinessFunction = extractShellFunction('wait_for_final_readiness');
  const harness = `#!/usr/bin/env bash
set -u
SERVICE_NAME='laboratory-management-system-test'
ACTIVE_AFTER=${activeAfter}
READY_AFTER=${readyAfter}
active_attempts=0
ready_attempts=0
sleep_calls=0
status_calls=0
journal_calls=0

systemctl() {
  if [ "\${1:-}" = 'is-active' ]; then
    active_attempts=$((active_attempts + 1))
    [ "$active_attempts" -ge "$ACTIVE_AFTER" ]
    return
  fi
  if [ "\${1:-}" = 'status' ]; then
    status_calls=$((status_calls + 1))
    printf 'injected systemctl status diagnostic\\n' >&2
    return 0
  fi
  return 64
}

curl() {
  ready_attempts=$((ready_attempts + 1))
  [ "$ready_attempts" -ge "$READY_AFTER" ]
}

sleep() {
  sleep_calls=$((sleep_calls + 1))
}

journalctl() {
  journal_calls=$((journal_calls + 1))
  printf 'injected journal diagnostic\\n' >&2
}

${readinessFunction}

set +e
wait_for_final_readiness 4321
result=$?
set -e
printf 'RESULT=%s ACTIVE=%s READY=%s SLEEPS=%s STATUS=%s JOURNAL=%s\\n' \\
  "$result" "$active_attempts" "$ready_attempts" "$sleep_calls" "$status_calls" "$journal_calls"
exit "$result"
`;

  // Feed the harness over stdin so this test works from Windows, WSL and Linux
  // without translating a host temporary-file path into a Bash path.
  return spawnSync('bash', ['-s'], { input: harness, encoding: 'utf8' });
}

test('a healthy deployer handoff is not followed by an unconditional outer restart', () => {
  const deployCall = installer.indexOf('bash "$SRC_DIR/scripts/deploy-ubuntu.sh"');
  const adminProbe = installer.indexOf('local admin_probe_status=0', deployCall);
  assert.ok(deployCall >= 0 && adminProbe > deployCall, 'deployment handoff boundaries must exist');

  const postDeployHandoff = installer.slice(deployCall, adminProbe);
  assert.doesNotMatch(
    postDeployHandoff,
    /^\s*systemctl restart "\$SERVICE_NAME"\s*$/m,
    'deploy-ubuntu.sh already starts and health-checks the service; the outer installer must not restart it unconditionally',
  );
});

test('slow service startup is retried until both systemd and /ready are healthy', () => {
  const result = runReadinessFaultScenario({ activeAfter: 3, readyAfter: 2 });

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /RESULT=0 ACTIVE=4 READY=2 SLEEPS=3 STATUS=0 JOURNAL=0/);
  assert.doesNotMatch(result.stderr, /diagnostic/);
});

test('persistent service failure returns non-zero and emits systemd and journal diagnostics', () => {
  const result = runReadinessFaultScenario({ activeAfter: 999, readyAfter: 999 });

  assert.equal(result.status, 1);
  assert.match(result.stdout, /RESULT=1 ACTIVE=60 READY=0 SLEEPS=60 STATUS=1 JOURNAL=1/);
  assert.match(result.stderr, /60/);
  assert.match(result.stderr, /systemctl status diagnostic/);
  assert.match(result.stderr, /journal diagnostic/);
});

test('deployment and final readiness ports are validated before use', () => {
  const integerPortValidation = /\[ "\$(?:deploy_port|ready_port)" -ge 1 \] && \[ "\$(?:deploy_port|ready_port)" -le 65535 \]/g;
  const validations = installer.match(integerPortValidation) || [];

  assert.equal(validations.length, 2, 'both deployment and final readiness ports must enforce the 1..65535 range');
  assert.match(installer, /\[\[ "\$deploy_port" =~ \^\[0-9\]\+\$ \]\]/);
  assert.match(installer, /\[\[ "\$ready_port" =~ \^\[0-9\]\+\$ \]\]/);
  assert.match(installer, /wait_for_final_readiness "\$ready_port"/);
});

test('root-only installation information is recorded only after final health succeeds', () => {
  const readinessCall = installer.indexOf('wait_for_final_readiness "$ready_port"');
  const proxyReadinessCall = installer.indexOf('wait_for_public_proxy_readiness "$origin" "$host"', readinessCall);
  const recordStep = installer.indexOf("CURRENT_STEP='记录仅 root 可读的安装信息'", readinessCall);
  const recordCall = installer.indexOf('\n  record_install_info\n', readinessCall);

  assert.ok(readinessCall >= 0, 'final readiness transition must exist');
  assert.ok(proxyReadinessCall > readinessCall, 'the Nginx public route must be checked after internal readiness');
  assert.ok(recordStep > proxyReadinessCall, 'recording state must be entered only after all readiness checks succeed');
  assert.ok(recordCall > recordStep, 'installation information must be recorded after entering the recording state');
  assert.equal(
    installer.match(/^\s*record_install_info\s*$/gm)?.length,
    1,
    'there must be no alternate path that records installation information before health succeeds',
  );
});

test('the final state validates Nginx routing for both HTTP IP and HTTPS domain installs', () => {
  assert.match(installer, /wait_for_public_proxy_readiness\(\)/);
  assert.match(installer, /--resolve "\$\{public_host\}:443:127\.0\.0\.1"/);
  assert.match(installer, /-H "Host: \$\{public_host\}"/);
  assert.match(installer, /systemctl status nginx --no-pager/);
  assert.match(installer, /journalctl -u nginx -n 80 --no-pager/);
  assert.match(installer, /\[ "\$status_code" = '200' \]/);
});

test('deployment rejects unsupported init systems, concurrent deploys, and unmanaged port conflicts before migration', () => {
  assert.match(installer, /acquire_installer_lock\(\)/);
  assert.match(installer, /laboratory-management-system-install\.lock\.d/);
  assert.match(deployer, /require_systemd_host\(\)/);
  assert.match(deployer, /ps -p 1 -o comm=/);
  assert.match(deployer, /flock -n 8 \|\| die 'Another installation or deployment is already running\.'/);
  assert.match(deployer, /ss -H -ltn "sport = :\$PORT"/);
  assert.match(deployer, /preflight_runtime_port/);
  assert.match(deployer, /preflight_web_ports/);
  assert.match(deployer, /Public web port \$port is occupied while Nginx is inactive/);
  assert.ok(
    deployer.indexOf('preflight_web_ports\n') < deployer.indexOf('apt-get install -y nginx\n'),
    'public port conflicts must be diagnosed before apt tries to start Nginx',
  );
  assert.ok(
    deployer.indexOf('preflight_runtime_port\n') < deployer.indexOf('prepare_candidate_release\n'),
    'host and port preflight must run before release construction or migration',
  );
  assert.ok(
    deployer.indexOf('preflight_runtime_port\n') < deployer.indexOf('stop_application_for_migration\n'),
    'port conflicts must be rejected before service downtime',
  );
});

test('VPS runtime uses a verified system Node and never trusts a root-only NVM path', () => {
  assert.match(installer, /\[ ! -x \/usr\/bin\/node \]/);
  assert.match(deployer, /A system-managed Node\.js 22\+ executable is required at \/usr\/bin\/node/);
  assert.match(deployer, /ExecStart=\/usr\/bin\/node \$APP_CURRENT\/server\.js/);
});

test('Nginx identifies IP installs explicitly without stealing another default server', () => {
  assert.match(installer, /export DOMAIN_NAME="\$host"/);
  assert.match(deployer, /if \[ "\$DOMAIN_NAME" != '_' \] && ! is_ipv4 "\$DOMAIN_NAME"/);
  assert.doesNotMatch(deployer, /listen 80 default_server/);
  assert.match(deployer, /server_name \$DOMAIN_NAME/);
});

test('fresh installations reject untested OS releases before changing packages or data', () => {
  assert.match(installer, /require_supported_host_release\(\)/);
  assert.match(installer, /ubuntu:22\.04\|ubuntu:24\.04\|debian:12\|debian:13/);
  assert.ok(
    installer.indexOf('require_supported_host_release\n') < installer.indexOf('safe_apt_update\n'),
    'the support matrix must be checked before apt changes',
  );
  assert.match(installer, /仅允许继续恢复已有安装/);
});

test('local PostgreSQL administration targets the same 5432 cluster as the application', () => {
  assert.match(deployer, /run_local_postgres_psql\(\)/);
  assert.match(deployer, /--host \/var\/run\/postgresql --port 5432/);
  assert.match(deployer, /pg_lsclusters --no-header/);
  assert.match(deployer, /SHOW server_version_num/);
  assert.match(deployer, /Expected exactly one online PostgreSQL cluster on port 5432/);
  assert.doesNotMatch(deployer, /run_as_postgres psql -d laboratory_management_system/);
  assert.ok(
    deployer.indexOf('verify_local_postgres_target\n') < deployer.indexOf('ensure_local_database\n'),
    'the actual local cluster must be verified before creating roles or databases',
  );
});

test('fresh supported VPS installations pin PostgreSQL 16 instead of distro-dependent defaults', () => {
  assert.match(deployer, /apt-get install -y postgresql-16 postgresql-client-16/);
  assert.match(deployer, /apt-get install -y postgresql-contrib-16/);
  assert.match(deployer, /apt\.postgresql\.org\/pub\/repos\/apt/);
  assert.match(deployer, /B97B0AFCAA1A47F044F244A07FCC7D46ACCC4CF8/);
  assert.match(deployer, /A fresh installation must use PostgreSQL 16/);
  assert.doesNotMatch(deployer, /apt-get install -y postgresql postgresql-client/);
  assert.match(deployer, /upgrade_managed_local_postgres_if_required/);
});

test('post-deploy environment changes are coalesced into at most one controlled restart', () => {
  assert.match(installer, /RUNTIME_CONFIG_CHANGED=0/);
  assert.match(installer, /set_runtime_env_value\(\)/);
  assert.match(installer, /restart_after_runtime_config_change "\$ready_port"/);
  assert.match(installer, /systemctl restart "\$SERVICE_NAME"\n  wait_for_final_readiness "\$port"/);

  const mainStart = installer.indexOf('main() {');
  const mainBody = installer.slice(mainStart);
  assert.equal(
    mainBody.match(/^\s*systemctl restart "\$SERVICE_NAME"\s*$/gm)?.length || 0,
    0,
    'main must never restart directly; all post-deploy changes go through the controlled transition',
  );
});
