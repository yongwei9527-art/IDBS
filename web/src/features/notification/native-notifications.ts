import { Capacitor } from '@capacitor/core';
import { LocalNotifications } from '@capacitor/local-notifications';

const MESSAGE_CHANNEL_ID = 'messages';
const MAX_NOTIFICATION_TEXT_LENGTH = 160;
let channelPromise: Promise<boolean> | null = null;
let nextNotificationId = Math.floor(Date.now() % 1_000_000_000);

export type NativeNotificationStatus = 'unsupported' | 'granted' | 'prompt' | 'denied';

function isNativeAndroid() {
  return Capacitor.isNativePlatform() && Capacitor.getPlatform() === 'android';
}

function normalizeText(value: unknown, fallback: string) {
  const text = typeof value === 'string' ? value.replace(/\s+/g, ' ').trim() : '';
  if (!text) return fallback;
  return text.slice(0, MAX_NOTIFICATION_TEXT_LENGTH);
}

function toStatus(permission: { display?: string }): NativeNotificationStatus {
  if (permission.display === 'granted') return 'granted';
  if (permission.display === 'prompt') return 'prompt';
  return 'denied';
}

async function ensureMessageChannel() {
  if (!channelPromise) {
    channelPromise = LocalNotifications.createChannel({
      id: MESSAGE_CHANNEL_ID,
      name: '新消息',
      description: '聊天消息和重要业务提醒',
      importance: 4,
      // Redact notification details on the lock screen.
      visibility: 0
    }).then(() => true).catch(() => false);
  }
  return channelPromise;
}

/** Returns the Android system-notification authorization state without prompting. */
export async function getNativeNotificationStatus(): Promise<NativeNotificationStatus> {
  if (!isNativeAndroid()) return 'unsupported';
  try {
    return toStatus(await LocalNotifications.checkPermissions());
  } catch {
    return 'denied';
  }
}

/** Requests Android notification permission only after the user chooses to enable it. */
export async function requestNativeNotificationPermission(): Promise<NativeNotificationStatus> {
  if (!isNativeAndroid()) return 'unsupported';
  try {
    const current = await LocalNotifications.checkPermissions();
    const permission = current.display === 'granted'
      ? current
      : await LocalNotifications.requestPermissions();
    const status = toStatus(permission);
    if (status === 'granted') await ensureMessageChannel();
    return status;
  } catch {
    return 'denied';
  }
}

/** Initializes the Android message channel only when permission was already granted. */
export async function prepareNativeNotifications() {
  if ((await getNativeNotificationStatus()) !== 'granted') return false;
  return ensureMessageChannel();
}

export async function presentNativeMessageNotification(input: { title?: unknown; body?: unknown }) {
  if (!(await prepareNativeNotifications())) return;

  try {
    nextNotificationId = nextNotificationId >= 2_000_000_000 ? 1 : nextNotificationId + 1;
    await LocalNotifications.schedule({
      notifications: [{
        id: nextNotificationId,
        title: normalizeText(input.title, '新消息'),
        body: normalizeText(input.body, '您收到一条新消息'),
        channelId: MESSAGE_CHANNEL_ID,
        extra: { route: '/chat' }
      }]
    });
  } catch {
    // The in-app notification center remains available if the OS blocks notifications.
  }
}
