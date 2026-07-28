import { Capacitor } from '@capacitor/core';
import { LocalNotifications } from '@capacitor/local-notifications';

const MESSAGE_CHANNEL_ID = 'messages';
const MAX_NOTIFICATION_TEXT_LENGTH = 160;
let setupPromise: Promise<boolean> | null = null;
let nextNotificationId = Math.floor(Date.now() % 1_000_000_000);

function isNativeAndroid() {
  return Capacitor.isNativePlatform() && Capacitor.getPlatform() === 'android';
}

function normalizeText(value: unknown, fallback: string) {
  const text = typeof value === 'string' ? value.replace(/\s+/g, ' ').trim() : '';
  if (!text) return fallback;
  return text.slice(0, MAX_NOTIFICATION_TEXT_LENGTH);
}

function hasNotificationPermission(permission: { display?: string }) {
  return permission.display === 'granted';
}

/** Creates the Android notification channel and requests notification permission after login. */
export async function prepareNativeNotifications() {
  if (!isNativeAndroid()) return false;
  if (setupPromise) return setupPromise;

  setupPromise = (async () => {
    try {
      const current = await LocalNotifications.checkPermissions();
      const permission = hasNotificationPermission(current)
        ? current
        : await LocalNotifications.requestPermissions();
      if (!hasNotificationPermission(permission)) return false;

      await LocalNotifications.createChannel({
        id: MESSAGE_CHANNEL_ID,
        name: '新消息',
        description: '聊天消息和重要业务提醒',
        importance: 4,
        // Redact notification details on the lock screen.
        visibility: 0
      });
      return true;
    } catch {
      return false;
    }
  })();

  return setupPromise;
}

export async function presentNativeMessageNotification(input: { title?: unknown; body?: unknown }) {
  if (!(await prepareNativeNotifications())) return;

  try {
    nextNotificationId = nextNotificationId >= 2_000_000_000 ? 1 : nextNotificationId + 1;
    await LocalNotifications.schedule({
      notifications: [{
        id: nextNotificationId,
        title: normalizeText(input.title, '新消息'),
        body: normalizeText(input.body, '你有一条新的消息'),
        channelId: MESSAGE_CHANNEL_ID,
        extra: { route: '/chat' }
      }]
    });
  } catch {
    // The in-app notification center remains available if the OS blocks notifications.
  }
}
