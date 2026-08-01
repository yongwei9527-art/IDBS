import { Capacitor, registerPlugin } from '@capacitor/core';
import { normalizeApiOrigin, saveApiOrigin } from './api';

export type AppConfig = {
  app_name: string;
  server_url: string;
  web_url: string;
  api_base_url: string;
  download_url: string;
  apk_download_url: string;
  pairing_scheme: string;
};

type PairingPayload = { version?: string; serverUrl: string; pairingToken: string };
type NativeRuntimePlugin = {
  getServerConfiguration: () => Promise<{ configured: boolean; serverUrl?: string }>;
  saveServerConfiguration: (options: { serverUrl: string }) => Promise<{ configured: boolean; serverUrl?: string }>;
  ingestServerPairingLink: (options: { uri: string }) => Promise<PairingPayload>;
  getPendingServerPairing: () => Promise<{ pending: boolean; pairing?: PairingPayload }>;
  acknowledgeServerPairing: () => Promise<void>;
};

const NativeRuntime = registerPlugin<NativeRuntimePlugin>('NativeRuntime');

function isNativeAndroid() {
  return Capacitor.isNativePlatform() && Capacitor.getPlatform() === 'android';
}

function readPairingUri(raw: string): PairingPayload {
  const parsed = new URL(String(raw || '').trim());
  if (parsed.protocol !== 'labapp:' || parsed.hostname !== 'pair') throw new Error('Invalid server pairing link.');
  const serverUrl = normalizeApiOrigin(parsed.searchParams.get('server'));
  const pairingToken = String(parsed.searchParams.get('token') || '').trim();
  if (!serverUrl || !serverUrl.startsWith('https://') || pairingToken.length < 16 || pairingToken.length > 2048) {
    throw new Error('Invalid server pairing link.');
  }
  return { version: parsed.searchParams.get('v') || '1', serverUrl, pairingToken };
}

async function exchangePairing(payload: PairingPayload): Promise<AppConfig> {
  const response = await fetch(`${payload.serverUrl}/api/v5/app-pairing/exchange`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    credentials: 'omit',
    cache: 'no-store',
    body: JSON.stringify({ v: payload.version || '1', server: payload.serverUrl, token: payload.pairingToken })
  });
  const body = await response.json().catch(() => null) as { code?: number; data?: AppConfig; message?: string } | null;
  if (!response.ok || body?.code !== 0 || !body?.data) {
    throw new Error(body?.message || 'The server pairing QR code is invalid or expired.');
  }
  const canonical = normalizeApiOrigin(body.data.server_url);
  if (!canonical || canonical !== payload.serverUrl) throw new Error('The server returned an unexpected address.');
  return { ...body.data, server_url: canonical };
}

async function persistVerifiedServer(config: AppConfig) {
  const canonical = saveApiOrigin(config.server_url);
  if (isNativeAndroid()) await NativeRuntime.saveServerConfiguration({ serverUrl: canonical });
  return canonical;
}

export async function pairFromLink(raw: string): Promise<AppConfig> {
  let payload = readPairingUri(raw);
  let acknowledged = false;
  if (isNativeAndroid()) payload = await NativeRuntime.ingestServerPairingLink({ uri: raw });
  try {
    const config = await exchangePairing(payload);
    await persistVerifiedServer(config);
    return config;
  } finally {
    if (isNativeAndroid() && !acknowledged) {
      acknowledged = true;
      await NativeRuntime.acknowledgeServerPairing().catch(() => undefined);
    }
  }
}

export async function consumeNativePendingPairing(): Promise<AppConfig | null> {
  if (!isNativeAndroid()) return null;
  const pending = await NativeRuntime.getPendingServerPairing();
  if (!pending.pending || !pending.pairing) return null;
  try {
    const config = await exchangePairing(pending.pairing);
    await persistVerifiedServer(config);
    return config;
  } finally {
    await NativeRuntime.acknowledgeServerPairing().catch(() => undefined);
  }
}

export async function restoreNativeServerConfiguration(): Promise<string> {
  if (!isNativeAndroid()) return '';
  const configuration: { configured: boolean; serverUrl?: string } = await NativeRuntime
    .getServerConfiguration()
    .catch((): { configured: boolean; serverUrl?: string } => ({ configured: false }));
  if (!configuration.configured || !configuration.serverUrl) return '';
  return saveApiOrigin(configuration.serverUrl);
}