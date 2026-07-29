import { Capacitor, registerPlugin } from '@capacitor/core';
import { LocalNotifications } from '@capacitor/local-notifications';
import { PushNotifications } from '@capacitor/push-notifications';
import { registerPushDevice, unregisterPushDevice } from './notification-api';
import { tokenStore } from '@/lib/api';

const MESSAGE_CHANNEL_ID = 'messages';
const MAX_NOTIFICATION_TEXT_LENGTH = 160;
const REMOTE_REGISTRATION_TIMEOUT_MS = 12_000;
let nextNotificationId = Math.floor(Date.now() % 1_000_000_000);
let channelPromise: Promise<void> | null = null;
let listenersReady = false;
let currentPushToken = '';
let registrationError = '';
let pendingRemoteRegistration: { resolve: (status: RemotePushStatus) => void; timer: ReturnType<typeof setTimeout> } | null = null;

export type NativeNotificationStatus = 'unsupported' | 'granted' | 'prompt' | 'denied';
export type RemotePushStatus = 'unsupported' | 'ready' | 'registering' | 'error';

type NativeRuntimePlugin = {
  getConfiguration: () => Promise<{ firebasePushConfigured?: boolean }>;
};

const NativeRuntime = registerPlugin<NativeRuntimePlugin>('NativeRuntime');
let remotePushConfigurationPromise: Promise<boolean> | null = null;

function isNativeAndroid() { return Capacitor.isNativePlatform() && Capacitor.getPlatform() === 'android'; }
async function hasRemotePushConfiguration() {
  if (!isNativeAndroid()) return false;
  remotePushConfigurationPromise ??= NativeRuntime.getConfiguration()
    .then(({ firebasePushConfigured }) => firebasePushConfigured === true)
    .catch(() => false);
  return remotePushConfigurationPromise;
}
function normalizeText(value: unknown, fallback: string) {
  const text = String(value ?? '').trim().replace(/\s+/g, ' ');
  return (text || fallback).slice(0, MAX_NOTIFICATION_TEXT_LENGTH);
}
function toStatus(permission: { display?: string }): NativeNotificationStatus {
  if (permission.display === 'granted') return 'granted';
  if (permission.display === 'prompt') return 'prompt';
  return 'denied';
}
function routeToChat() {
  if (typeof window === 'undefined') return;
  window.location.assign(window.location.pathname.startsWith('/v5') ? '/v5/chat' : '/chat');
}
function finishRemoteRegistration(status: RemotePushStatus) {
  if (!pendingRemoteRegistration) return;
  clearTimeout(pendingRemoteRegistration.timer);
  const pending = pendingRemoteRegistration;
  pendingRemoteRegistration = null;
  pending.resolve(status);
}
async function ensureMessageChannel() {
  if (!isNativeAndroid()) return;
  channelPromise ??= LocalNotifications.createChannel({
    id: MESSAGE_CHANNEL_ID,
    name: '消息提醒',
    description: '实验室管理系统的私密消息提醒',
    importance: 4,
    visibility: 0,
    sound: 'default',
    vibration: true
  }).then(() => undefined).catch(() => undefined);
  await channelPromise;
}
async function savePushToken(token: string) {
  currentPushToken = token;
  await registerPushDevice(token);
}
function bindPushListeners() {
  if (listenersReady || !isNativeAndroid()) return;
  listenersReady = true;
  void PushNotifications.addListener('registration', (token) => {
    registrationError = '';
    void savePushToken(token.value)
      .then(() => finishRemoteRegistration('ready'))
      .catch(() => {
        registrationError = '设备登记失败，请稍后重试。';
        finishRemoteRegistration('error');
      });
  });
  void PushNotifications.addListener('registrationError', () => {
    registrationError = '远程提醒登记失败，请检查网络和 Google Play 服务。';
    finishRemoteRegistration('error');
  });
  void PushNotifications.addListener('pushNotificationActionPerformed', () => routeToChat());
  void PushNotifications.addListener('pushNotificationReceived', () => {
    // WebSocket remains the in-app foreground channel; avoid a second system banner here.
    window.dispatchEvent(new Event('laboratory-management-system:push-received'));
  });
}

export async function getNativeNotificationStatus(): Promise<NativeNotificationStatus> {
  if (!isNativeAndroid()) return 'unsupported';
  try { return toStatus(await LocalNotifications.checkPermissions()); } catch { return 'denied'; }
}
export async function requestNativeNotificationPermission(): Promise<NativeNotificationStatus> {
  if (!isNativeAndroid()) return 'unsupported';
  try {
    const current = await LocalNotifications.checkPermissions();
    const permission = current.display === 'granted' ? current : await LocalNotifications.requestPermissions();
    const status = toStatus(permission);
    if (status === 'granted') await ensureMessageChannel();
    return status;
  } catch { return 'denied'; }
}
export async function prepareNativeNotifications() {
  if ((await getNativeNotificationStatus()) !== 'granted') return false;
  await ensureMessageChannel();
  return true;
}
export async function enableRemotePushNotifications(): Promise<RemotePushStatus> {
  if (!isNativeAndroid()) return 'unsupported';
  if (!await hasRemotePushConfiguration()) {
    registrationError = '当前安装包尚未配置 FCM，远程提醒暂不可用。';
    return 'error';
  }
  if (!tokenStore.get() || !await prepareNativeNotifications()) return 'error';
  bindPushListeners();
  registrationError = '';
  if (currentPushToken) {
    try {
      await savePushToken(currentPushToken);
      return 'ready';
    } catch {
      registrationError = '设备登记失败，请稍后重试。';
      return 'error';
    }
  }
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      registrationError = '远程提醒登记超时，请检查网络和 Google Play 服务后重试。';
      finishRemoteRegistration('error');
    }, REMOTE_REGISTRATION_TIMEOUT_MS);
    pendingRemoteRegistration = { resolve, timer };
    void PushNotifications.register().catch(() => {
      registrationError = '远程提醒登记失败，请检查网络和 Google Play 服务。';
      finishRemoteRegistration('error');
    });
  });
}
export function getRemotePushError() { return registrationError; }
export async function unregisterRemotePushNotifications(accessToken?: string | null) {
  if (!currentPushToken) return;
  const token = currentPushToken;
  currentPushToken = '';
  await unregisterPushDevice(token, accessToken).catch(() => {});
}
export async function presentNativeMessageNotification(input: { title?: unknown; body?: unknown }) {
  if (!await prepareNativeNotifications()) return;
  try {
    nextNotificationId = nextNotificationId >= 2_000_000_000 ? 1 : nextNotificationId + 1;
    await LocalNotifications.schedule({ notifications: [{
      id: nextNotificationId,
      title: normalizeText(input.title, '新消息提醒'),
      body: normalizeText(input.body, '您收到一条新消息'),
      channelId: MESSAGE_CHANNEL_ID,
      extra: { route: '/chat' }
    }] });
  } catch { /* The in-app notification center remains available if the OS blocks notifications. */ }
}
