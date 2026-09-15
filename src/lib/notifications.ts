// Feature (OS notifications): thin wrapper around the browser Notification
// API, used for things worth surfacing even when the tab isn't focused --
// right now, a background auto-rescan finding new songs. Two things this
// deliberately does NOT do:
//   - never prompts for permission on its own; that only happens from an
//     explicit toggle in Settings (see requestNotificationPermission),
//     since an unsolicited permission prompt on page load is exactly the
//     kind of thing that makes a web app feel spammy.
//   - never fires while the tab is actually focused/visible, since the
//     in-app toast already covers that case -- showing both would just be
//     noise for something the person is already looking at.
//
// Feature (Native Android/Capacitor scaffold): the web Notification API
// technically works inside a Capacitor WebView, but it's a known-flaky
// path -- WebView notification support varies by Android/WebView version
// and OEM, and there's no dedicated notification channel, so users can't
// individually mute "Melophile" notifications in Android's system
// settings the way every other app on their phone works. @capacitor/
// local-notifications is the officially-recommended, reliable path for a
// native shell, so every function below branches on
// Capacitor.isNativePlatform() and uses it instead when running as the
// installed APK. Every function's return behavior/signature is unchanged
// for the web build -- Capacitor.isNativePlatform() is simply always
// false there, so this file behaves exactly as before on GitHub Pages.

import { Capacitor } from '@capacitor/core';
import { LocalNotifications } from '@capacitor/local-notifications';

const isNative = () => Capacitor.isNativePlatform();

// Local Notifications IDs are integers, not strings -- reusing a fixed one
// per "kind" of notification means a second background event of the same
// kind replaces rather than stacks with the first, matching the web path's
// `tag: 'melophile-status'` de-duplication behavior.
const NATIVE_NOTIFICATION_ID = 1;

export function notificationsSupported(): boolean {
  if (isNative()) return true;
  return typeof window !== 'undefined' && 'Notification' in window;
}

export function notificationPermission(): NotificationPermission {
  if (isNative()) {
    // Feature (Native Android/Capacitor scaffold): checkPermissions() is
    // async but this function's callers (Settings UI) need a synchronous
    // read for render -- App.tsx instead calls
    // notificationPermissionNative() below on mount/toggle and stores the
    // result in state. This sync fallback only matters for the very first
    // render before that state resolves, so "prompt" (Capacitor's
    // "ask again" equivalent to the web API's default state) is the
    // correct conservative default rather than assuming granted or denied.
    return 'default';
  }
  if (!notificationsSupported()) return 'denied';
  return Notification.permission;
}

/** Feature (Native Android/Capacitor scaffold): the real, async permission
 *  check for native -- see the comment on notificationPermission() above
 *  for why the sync version can't do this directly. No-ops to the sync
 *  value on web so callers can use one function regardless of platform. */
export async function notificationPermissionAsync(): Promise<NotificationPermission> {
  if (!isNative()) return notificationPermission();
  try {
    const { display } = await LocalNotifications.checkPermissions();
    if (display === 'granted') return 'granted';
    if (display === 'denied') return 'denied';
    return 'default';
  } catch {
    return 'default';
  }
}

export async function requestNotificationPermission(): Promise<NotificationPermission> {
  if (isNative()) {
    try {
      const { display } = await LocalNotifications.requestPermissions();
      return display === 'granted' ? 'granted' : 'denied';
    } catch {
      return 'denied';
    }
  }
  if (!notificationsSupported()) return 'denied';
  try { return await Notification.requestPermission(); } catch { return 'denied'; }
}

export async function showBackgroundNotification(title: string, body: string, opts?: { force?: boolean }): Promise<void> {
  if (isNative()) {
    // Feature (Native Android/Capacitor scaffold): unlike the web path,
    // there's no reliable equivalent of `document.visibilityState` for
    // "is the app currently the one on screen" that's worth gating on
    // here -- Capacitor apps are far more often genuinely backgrounded
    // when this fires (auto-rescan runs on app resume, which by
    // definition means the app *was* backgrounded), and `force` for the
    // Settings test button needs to work identically either way, so
    // native always shows the notification when called.
    try {
      const perm = await notificationPermissionAsync();
      if (perm !== 'granted') return;
      await LocalNotifications.schedule({
        notifications: [{
          id: NATIVE_NOTIFICATION_ID,
          title,
          body,
          smallIcon: 'ic_notification',
          iconColor: '#2C5FCC',
        }],
      });
    } catch (e) {
      console.warn('Native notification failed', e);
    }
    return;
  }

  if (!notificationsSupported()) return;
  if (Notification.permission !== 'granted') return;
  // Feature (Notification gaps): `force` exists solely for the Settings
  // "Send test notification" button -- someone testing it is, by
  // definition, looking at the app right then, so the normal
  // hidden-tab-only rule would make the test button silently do nothing.
  if (!opts?.force && document.visibilityState !== 'hidden') return;

  const options: NotificationOptions = { body, icon: '/icons/icon-192.png', tag: 'melophile-status', silent: true };

  if ('serviceWorker' in navigator) {
    try {
      const registration = await navigator.serviceWorker.ready;
      await registration.showNotification(title, options);
      return;
    } catch {
      // Service worker registration never became ready (registration
      // failed, blocked by a privacy extension, etc.) -- fall through to
      // the plain constructor below, which still works on desktop.
    }
  }

  try {
    // eslint-disable-next-line no-new
    new Notification(title, options);
  } catch {
    // Android without a ready service worker, or iOS Safari -- neither
    // supports the plain constructor. Nothing more to do; the in-app toast
    // still covers the foreground case everywhere.
  }
}
