import type { CapacitorConfig } from '@capacitor/cli';

// Feature (Native Android/Capacitor scaffold): appId follows Java package
// naming (reverse-domain) -- this doesn't need to correspond to a real
// domain you own, it just needs to be unique-ish and stable, since it's
// baked into the Android package name and can't be changed later without
// Google Play treating it as a different app entirely.
const config: CapacitorConfig = {
  appId: 'com.melophile.app',
  appName: 'Melophile',
  webDir: 'dist',
  // Feature (Local Notifications): default icon/sound for notifications
  // raised via lib/notifications.ts's native path (see that file for the
  // web-vs-native branch). smallIcon references
  // android/app/src/main/res/drawable/ic_notification.png -- see that
  // folder's README for what needs to be dropped in there.
  plugins: {
    LocalNotifications: {
      smallIcon: 'ic_notification',
      iconColor: '#6366F1',
    },
  },
};

export default config;
