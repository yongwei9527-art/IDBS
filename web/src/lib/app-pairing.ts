import { Capacitor, registerPlugin, type PluginListenerHandle } from '@capacitor/core';
import { getApiOrigin, saveApiOrigin } from './api';
import { authApi } from './auth-api';

export type AppConfig = {
  app_name: string;
  server_url: string;
  web_url: string;
  api_base_url: string;
  download_url: string;
  apk_download_url: string;
  pairing_scheme: string;
  pairing_app_link_path: string;
  pairing_available: boolean;
  pairing_unavailable_reason: string | null;
  organization_name: string;
  instance_name: string;
  instance_id: string;
  instance_fingerprint: string;
};

export type ServerIdentity = {
  server_origin: string;
  organization_name: string;
  instance_name: string;
  instance_id: string;
  fingerprint: string;
};

export type TrustedServerIdentity = ServerIdentity & {
  confirmed_at: string;
};

export type PairingTrustStatus = 'first-use' | 'recognized' | 'server-change' | 'identity-mismatch';

export type PairingCandidate = {
  config: AppConfig;
  identity: ServerIdentity;
  trust_status: PairingTrustStatus;
  can_confirm: boolean;
  requires_server_switch_confirmation: boolean;
};

type PairingPayload = { version?: string; serverUrl: string; pairingToken: string };
type NativePairingHandlers = {
  onPairingStart?: () => void;
  onPairingCandidate: (candidate: PairingCandidate) => void;
  onError: () => void;
};
type NativeStoredServerConfiguration = {
  configured: boolean;
  serverUrl?: string;
  organizationName?: string;
  instanceName?: string;
  instanceId?: string;
  fingerprint?: string;
  confirmedAt?: string;
};
type NativeRuntimePlugin = {
  getInstallationId: () => Promise<{ installationId: string }>;
  getServerConfiguration: () => Promise<NativeStoredServerConfiguration>;
  saveServerConfiguration: (options: {
    serverUrl: string;
    organizationName: string;
    instanceName: string;
    instanceId: string;
    fingerprint: string;
    confirmedAt: string;
    allowServerSwitch: boolean;
  }) => Promise<NativeStoredServerConfiguration>;
  clearServerConfiguration: () => Promise<void>;
  getPendingServerPairing: () => Promise<{ pending: boolean; pairing?: PairingPayload }>;
  acknowledgeServerPairing: () => Promise<void>;
  addListener: (
    eventName: 'serverPairingLink',
    listener: (pairing: PairingPayload) => void
  ) => Promise<PluginListenerHandle>;
};

const NativeRuntime = registerPlugin<NativeRuntimePlugin>('NativeRuntime');
const PAIRING_VERSION = '2';
const PAIRING_APP_LINK_PATH = '/api/v5/app-pairing/link';
const TRUSTED_SERVER_STORAGE_KEY = 'laboratory-management-system.trusted-server-identity.v1';
const INSTALLATION_ID_STORAGE_KEY = 'laboratory-management-system.installation-id.v1';
const GENERIC_PAIRING_ERROR = 'Unable to complete server pairing. Refresh the download page and try again.';
const activePairings = new Map<string, Promise<AppConfig>>();
let latestNativePairingGeneration = 0;
let memoryTrustedIdentity: TrustedServerIdentity | null = null;
let memoryInstallationId = '';

function isNativeAndroid() {
  return Capacitor.isNativePlatform() && Capacitor.getPlatform() === 'android';
}

function pairingError() {
  return new Error(GENERIC_PAIRING_ERROR);
}

function strictHttpsOrigin(value: unknown): string {
  const source = String(value || '');
  const raw = source.trim();
  if (!raw || source !== raw || raw.length > 2048 || !/^https:\/\/[^/?#]+\/?$/i.test(raw)) {
    throw pairingError();
  }
  try {
    const parsed = new URL(raw);
    if (parsed.protocol !== 'https:' || parsed.username || parsed.password || parsed.search || parsed.hash) {
      throw pairingError();
    }
    if (parsed.pathname !== '' && parsed.pathname !== '/') throw pairingError();
    if (!parsed.hostname || parsed.origin === 'null' || parsed.port) throw pairingError();
    return parsed.origin;
  } catch {
    throw pairingError();
  }
}

function hasUnsafeIdentityCharacter(value: string): boolean {
  for (const character of value) {
    const codePoint = character.codePointAt(0) || 0;
    if (codePoint <= 0x1f || (codePoint >= 0x7f && codePoint <= 0x9f)
      || (codePoint >= 0x202a && codePoint <= 0x202e)
      || (codePoint >= 0x2066 && codePoint <= 0x2069)) {
      return true;
    }
  }
  return false;
}

function safeIdentityLabel(value: unknown): string {
  const candidate = String(value || '');
  if (!candidate || candidate !== candidate.trim() || candidate.length > 160
    || hasUnsafeIdentityCharacter(candidate)) {
    throw pairingError();
  }
  return candidate;
}

function safeInstanceId(value: unknown): string {
  const candidate = String(value || '');
  if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{7,127}$/.test(candidate)) throw pairingError();
  return candidate;
}

function safeFingerprint(value: unknown): string {
  const candidate = String(value || '').toLowerCase();
  if (!/^[a-f0-9]{64}$/.test(candidate)) throw pairingError();
  return candidate;
}

function safeConfirmedAt(value: unknown): string {
  const candidate = String(value || '');
  const timestamp = new Date(candidate).getTime();
  if (!candidate || candidate.length > 64 || !Number.isFinite(timestamp)) throw pairingError();
  return new Date(timestamp).toISOString();
}

function strictPublicHttpUrl(value: unknown): string {
  try {
    const parsed = new URL(String(value || ''));
    if (!['http:', 'https:'].includes(parsed.protocol) || parsed.username || parsed.password || parsed.hash) {
      throw pairingError();
    }
    return parsed.href;
  } catch {
    throw pairingError();
  }
}

function identityFromConfig(config: AppConfig): ServerIdentity {
  return {
    server_origin: strictHttpsOrigin(config.server_url),
    organization_name: safeIdentityLabel(config.organization_name),
    instance_name: safeIdentityLabel(config.instance_name),
    instance_id: safeInstanceId(config.instance_id),
    fingerprint: safeFingerprint(config.instance_fingerprint)
  };
}

function normalizeAppConfig(raw: AppConfig): AppConfig {
  const serverOrigin = strictHttpsOrigin(raw?.server_url);
  const appName = safeIdentityLabel(raw?.app_name);
  const webUrl = strictPublicHttpUrl(raw?.web_url);
  const apiBaseUrl = strictPublicHttpUrl(raw?.api_base_url);
  const downloadUrl = strictPublicHttpUrl(raw?.download_url);
  const apkDownloadUrl = strictPublicHttpUrl(raw?.apk_download_url);
  if (webUrl !== `${serverOrigin}/v5/` || apiBaseUrl !== `${serverOrigin}/api/v5`
    || downloadUrl !== `${serverOrigin}/download` || raw?.pairing_scheme !== 'labapp://pair'
    || raw?.pairing_app_link_path !== PAIRING_APP_LINK_PATH) {
    throw pairingError();
  }
  const config: AppConfig = {
    ...raw,
    app_name: appName,
    server_url: serverOrigin,
    web_url: webUrl,
    api_base_url: apiBaseUrl,
    download_url: downloadUrl,
    apk_download_url: apkDownloadUrl,
    pairing_scheme: 'labapp://pair',
    pairing_app_link_path: PAIRING_APP_LINK_PATH,
    pairing_available: raw?.pairing_available === true,
    pairing_unavailable_reason: typeof raw?.pairing_unavailable_reason === 'string'
      ? raw.pairing_unavailable_reason.slice(0, 500)
      : null,
    organization_name: safeIdentityLabel(raw?.organization_name),
    instance_name: safeIdentityLabel(raw?.instance_name),
    instance_id: safeInstanceId(raw?.instance_id),
    instance_fingerprint: safeFingerprint(raw?.instance_fingerprint)
  };
  identityFromConfig(config);
  return config;
}

function normalizePairingPayload(payload: PairingPayload): PairingPayload {
  const version = String(payload?.version || '');
  const serverUrl = strictHttpsOrigin(payload?.serverUrl);
  const pairingToken = String(payload?.pairingToken || '');
  if (version !== PAIRING_VERSION || pairingToken !== pairingToken.trim()
    || pairingToken.length < 16 || pairingToken.length > 2048
    || !/^[A-Za-z0-9_-]+$/.test(pairingToken)) {
    throw pairingError();
  }
  return { version, serverUrl, pairingToken };
}

function readPairingUri(raw: string): PairingPayload {
  try {
    const source = String(raw || '');
    if (!source || source !== source.trim() || source.length > 4096) throw pairingError();
    const parsed = new URL(source);
    const allowedParameters = new Set(['v', 'server', 'token']);
    const isCustomScheme = parsed.protocol === 'labapp:'
      && parsed.hostname === 'pair'
      && !parsed.port
      && (parsed.pathname === '' || parsed.pathname === '/');
    const isHttpsAppLink = parsed.protocol === 'https:'
      && !parsed.port
      && parsed.pathname === PAIRING_APP_LINK_PATH;
    const serverUrl = strictHttpsOrigin(parsed.searchParams.get('server') || '');
    if ((!isCustomScheme && !isHttpsAppLink) || parsed.username || parsed.password || parsed.hash
      || [...parsed.searchParams.keys()].some((key) => !allowedParameters.has(key))
      || parsed.searchParams.getAll('v').length !== 1
      || parsed.searchParams.getAll('server').length !== 1
      || parsed.searchParams.getAll('token').length !== 1
      || (isHttpsAppLink && parsed.origin !== serverUrl)) {
      throw pairingError();
    }
    return normalizePairingPayload({
      version: parsed.searchParams.get('v') || '',
      serverUrl,
      pairingToken: parsed.searchParams.get('token') || ''
    });
  } catch {
    throw pairingError();
  }
}

async function pairingFingerprint(payload: PairingPayload): Promise<string> {
  try {
    const bytes = new TextEncoder().encode(`${payload.version}\u0000${payload.serverUrl}\u0000${payload.pairingToken}`);
    const digest = await globalThis.crypto.subtle.digest('SHA-256', bytes);
    return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
  } catch {
    throw pairingError();
  }
}

function validInstallationId(value: unknown): string {
  const candidate = String(value || '');
  if (candidate.length < 16 || candidate.length > 128 || !/^[A-Za-z0-9._:-]+$/.test(candidate)) {
    throw pairingError();
  }
  return candidate;
}

function generateInstallationId(): string {
  try {
    if (typeof globalThis.crypto?.randomUUID === 'function') {
      return validInstallationId(globalThis.crypto.randomUUID());
    }
    const bytes = new Uint8Array(24);
    globalThis.crypto.getRandomValues(bytes);
    return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
  } catch {
    throw pairingError();
  }
}

async function getInstallationId(): Promise<string> {
  if (isNativeAndroid()) {
    const result = await NativeRuntime.getInstallationId().catch(() => null);
    return validInstallationId(result?.installationId);
  }
  if (typeof localStorage !== 'undefined') {
    try {
      const stored = localStorage.getItem(INSTALLATION_ID_STORAGE_KEY);
      if (stored) return validInstallationId(stored);
      const generated = generateInstallationId();
      localStorage.setItem(INSTALLATION_ID_STORAGE_KEY, generated);
      return generated;
    } catch {
      // A non-persistent test/SSR fallback still binds a token within this process.
    }
  }
  if (!memoryInstallationId) memoryInstallationId = generateInstallationId();
  return memoryInstallationId;
}

async function exchangePairing(payload: PairingPayload): Promise<AppConfig> {
  try {
    const installationId = await getInstallationId();
    const response = await fetch(`${payload.serverUrl}/api/v5/app-pairing/exchange`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      credentials: 'omit',
      cache: 'no-store',
      body: JSON.stringify({
        v: payload.version || PAIRING_VERSION,
        server: payload.serverUrl,
        token: payload.pairingToken,
        installation_id: installationId
      })
    });
    const body = await response.json().catch(() => null) as { code?: number; data?: AppConfig } | null;
    if (!response.ok || body?.code !== 0 || !body?.data) throw pairingError();
    const config = normalizeAppConfig(body.data);
    if (config.server_url !== payload.serverUrl) throw pairingError();
    return config;
  } catch {
    throw pairingError();
  }
}

async function exchangePairingOnce(rawPayload: PairingPayload): Promise<AppConfig> {
  const payload = normalizePairingPayload(rawPayload);
  const fingerprint = await pairingFingerprint(payload);
  const existing = activePairings.get(fingerprint);
  if (existing) return existing;

  const request = exchangePairing(payload);
  activePairings.set(fingerprint, request);
  try {
    return await request;
  } finally {
    if (activePairings.get(fingerprint) === request) activePairings.delete(fingerprint);
  }
}

function normalizeTrustedIdentity(value: unknown): TrustedServerIdentity {
  const candidate = value as Partial<TrustedServerIdentity> | null;
  return {
    server_origin: strictHttpsOrigin(candidate?.server_origin),
    organization_name: safeIdentityLabel(candidate?.organization_name),
    instance_name: safeIdentityLabel(candidate?.instance_name),
    instance_id: safeInstanceId(candidate?.instance_id),
    fingerprint: safeFingerprint(candidate?.fingerprint),
    confirmed_at: safeConfirmedAt(candidate?.confirmed_at)
  };
}

export function getTrustedServerIdentity(): TrustedServerIdentity | null {
  if (typeof localStorage !== 'undefined') {
    try {
      const raw = localStorage.getItem(TRUSTED_SERVER_STORAGE_KEY);
      if (!raw) return memoryTrustedIdentity;
      const identity = normalizeTrustedIdentity(JSON.parse(raw));
      memoryTrustedIdentity = identity;
      return identity;
    } catch {
      return null;
    }
  }
  return memoryTrustedIdentity;
}

function writeTrustedServerIdentity(identity: TrustedServerIdentity) {
  const normalized = normalizeTrustedIdentity(identity);
  memoryTrustedIdentity = normalized;
  if (typeof localStorage !== 'undefined') {
    try {
      localStorage.setItem(TRUSTED_SERVER_STORAGE_KEY, JSON.stringify(normalized));
    } catch {
      if (!isNativeAndroid()) throw pairingError();
    }
  }
}

function sameIdentity(left: Pick<TrustedServerIdentity, keyof ServerIdentity>, right: ServerIdentity) {
  return left.server_origin === right.server_origin
    && left.instance_id === right.instance_id
    && left.fingerprint === right.fingerprint;
}

function assessTrust(identity: ServerIdentity): PairingTrustStatus {
  const trusted = getTrustedServerIdentity();
  if (trusted) {
    if (trusted.server_origin !== identity.server_origin) return 'server-change';
    return sameIdentity(trusted, identity) ? 'recognized' : 'identity-mismatch';
  }
  const configuredOrigin = getApiOrigin();
  if (configuredOrigin && configuredOrigin !== identity.server_origin) return 'server-change';
  return 'first-use';
}

function candidateFromConfig(config: AppConfig): PairingCandidate {
  const identity = identityFromConfig(config);
  const trustStatus = assessTrust(identity);
  return {
    config,
    identity,
    trust_status: trustStatus,
    can_confirm: trustStatus !== 'identity-mismatch',
    requires_server_switch_confirmation: trustStatus === 'server-change'
  };
}

export function formatServerFingerprint(value: string): string {
  const fingerprint = safeFingerprint(value).toUpperCase();
  return fingerprint.match(/.{1,4}/g)?.join(' ') || fingerprint;
}

export async function previewPairingFromLink(raw: string): Promise<PairingCandidate> {
  const config = await exchangePairingOnce(readPairingUri(raw));
  return candidateFromConfig(config);
}

/** Compatibility alias: pairing now returns a preview and never persists without confirmation. */
export const pairFromLink = previewPairingFromLink;

export async function confirmPairing(
  candidate: PairingCandidate,
  options: { allowServerSwitch?: boolean } = {}
): Promise<TrustedServerIdentity> {
  try {
    const config = normalizeAppConfig(candidate.config);
    const identity = identityFromConfig(config);
    if (!sameIdentity(identity, candidate.identity)) throw pairingError();
    const currentTrust = assessTrust(identity);
    if (currentTrust === 'identity-mismatch') throw pairingError();
    if (currentTrust === 'server-change' && options.allowServerSwitch !== true) throw pairingError();

    // Revoke and clear the old session while requests still target the old origin. The
    // origin switch below also clears tokens defensively, but it cannot notify the old server.
    if (currentTrust === 'server-change') authApi.logout();

    const trusted: TrustedServerIdentity = {
      ...identity,
      confirmed_at: new Date().toISOString()
    };
    if (isNativeAndroid()) {
      await NativeRuntime.saveServerConfiguration({
        serverUrl: trusted.server_origin,
        organizationName: trusted.organization_name,
        instanceName: trusted.instance_name,
        instanceId: trusted.instance_id,
        fingerprint: trusted.fingerprint,
        confirmedAt: trusted.confirmed_at,
        allowServerSwitch: options.allowServerSwitch === true
      });
    }
    writeTrustedServerIdentity(trusted);
    saveApiOrigin(trusted.server_origin);
    return trusted;
  } catch {
    throw pairingError();
  }
}

async function exchangeNativePairing(payload: PairingPayload): Promise<PairingCandidate> {
  const generation = ++latestNativePairingGeneration;
  try {
    const config = await exchangePairingOnce(payload);
    if (generation !== latestNativePairingGeneration) throw pairingError();
    return candidateFromConfig(config);
  } finally {
    if (generation === latestNativePairingGeneration) {
      await NativeRuntime.acknowledgeServerPairing().catch(() => undefined);
    }
  }
}

export async function consumeNativePendingPairing(): Promise<PairingCandidate | null> {
  if (!isNativeAndroid()) return null;
  const pending = await NativeRuntime.getPendingServerPairing().catch(() => null);
  if (!pending?.pending || !pending.pairing) return null;
  try {
    return await exchangeNativePairing(pending.pairing);
  } catch {
    throw pairingError();
  }
}

/**
 * Subscribes before reading the retained startup payload. A short SHA-256 fingerprint
 * de-duplicates the retained event and pending lookup without retaining the pairing token.
 * The callback receives an unpersisted TOFU preview; only confirmPairing may save it.
 */
export async function subscribeNativeServerPairing(handlers: NativePairingHandlers): Promise<() => Promise<void>> {
  if (!isNativeAndroid()) return async () => undefined;

  let disposed = false;
  let deliveryGeneration = 0;
  let pairingQueue = Promise.resolve();
  const observedPairings = new Map<string, Promise<AppConfig>>();
  const deliveredFingerprints = new Set<string>();

  const enqueue = (rawPayload: PairingPayload) => {
    const delivery = ++deliveryGeneration;
    const nativeGeneration = ++latestNativePairingGeneration;
    const process = async () => {
      if (disposed || delivery !== deliveryGeneration) return;
      let payload: PairingPayload;
      let fingerprint: string;
      try {
        payload = normalizePairingPayload(rawPayload);
        fingerprint = await pairingFingerprint(payload);
      } catch {
        if (!disposed && delivery === deliveryGeneration) {
          handlers.onPairingStart?.();
          handlers.onError();
        }
        if (nativeGeneration === latestNativePairingGeneration) {
          await NativeRuntime.acknowledgeServerPairing().catch(() => undefined);
        }
        return;
      }
      if (disposed || delivery !== deliveryGeneration) return;
      if (deliveredFingerprints.has(fingerprint)) {
        if (nativeGeneration === latestNativePairingGeneration) {
          await NativeRuntime.acknowledgeServerPairing().catch(() => undefined);
        }
        return;
      }

      handlers.onPairingStart?.();
      let request = observedPairings.get(fingerprint);
      if (!request) {
        if (observedPairings.size >= 16) {
          const oldest = observedPairings.keys().next().value as string | undefined;
          if (oldest) {
            observedPairings.delete(oldest);
            deliveredFingerprints.delete(oldest);
          }
        }
        request = exchangePairingOnce(payload);
        observedPairings.set(fingerprint, request);
      }

      try {
        const config = await request;
        if (disposed || delivery !== deliveryGeneration || nativeGeneration !== latestNativePairingGeneration) return;
        deliveredFingerprints.add(fingerprint);
        handlers.onPairingCandidate(candidateFromConfig(config));
      } catch {
        if (!disposed && delivery === deliveryGeneration && nativeGeneration === latestNativePairingGeneration) {
          handlers.onError();
        }
      } finally {
        if (nativeGeneration === latestNativePairingGeneration) {
          await NativeRuntime.acknowledgeServerPairing().catch(() => undefined);
        }
      }
    };
    pairingQueue = pairingQueue.then(process, process);
  };

  let listener: PluginListenerHandle | null = null;
  try {
    listener = await NativeRuntime.addListener('serverPairingLink', (payload) => {
      enqueue(payload);
    });
  } catch {
    // Pending recovery below remains available even if live listener registration fails.
  }

  const pending = await NativeRuntime.getPendingServerPairing().catch(() => null);
  if (pending?.pending && pending.pairing) {
    enqueue(pending.pairing);
    await pairingQueue;
  }

  return async () => {
    disposed = true;
    deliveryGeneration += 1;
    observedPairings.clear();
    deliveredFingerprints.clear();
    await listener?.remove().catch(() => undefined);
  };
}

function identityFromNativeConfiguration(configuration: NativeStoredServerConfiguration): TrustedServerIdentity {
  return normalizeTrustedIdentity({
    server_origin: configuration.serverUrl,
    organization_name: configuration.organizationName,
    instance_name: configuration.instanceName,
    instance_id: configuration.instanceId,
    fingerprint: configuration.fingerprint,
    confirmed_at: configuration.confirmedAt
  });
}

export async function restoreNativeServerConfiguration(): Promise<string> {
  if (!isNativeAndroid()) return '';
  const configuration = await NativeRuntime.getServerConfiguration()
    .catch((): NativeStoredServerConfiguration => ({ configured: false }));
  const existing = getApiOrigin();
  if (!configuration.configured || existing) return existing;
  try {
    const nativeIdentity = identityFromNativeConfiguration(configuration);
    const trusted = getTrustedServerIdentity();
    if (trusted && !sameIdentity(trusted, nativeIdentity)) return '';
    if (!trusted) writeTrustedServerIdentity(nativeIdentity);
    if (existing && existing !== nativeIdentity.server_origin) return existing;
    saveApiOrigin(nativeIdentity.server_origin);
    return nativeIdentity.server_origin;
  } catch {
    return '';
  }
}
