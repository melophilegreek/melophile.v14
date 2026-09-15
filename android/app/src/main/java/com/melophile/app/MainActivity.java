package com.melophile.app;

import android.os.Bundle;
import com.getcapacitor.BridgeActivity;

// Feature (Persistent playback notification): registerPlugin is required
// for any *custom* (non-npm, bundled-in-app) Capacitor plugin -- unlike
// npm-installed plugins (which Capacitor auto-discovers via its own
// generated plugin list, see android/app/capacitor.build.gradle),
// PlaybackNotificationPlugin lives directly in this app module and has no
// such auto-registration, so without this call `PlaybackNotification` on
// the JS side would simply be undefined.
public class MainActivity extends BridgeActivity {
  @Override
  public void onCreate(Bundle savedInstanceState) {
    registerPlugin(PlaybackNotificationPlugin.class);
    super.onCreate(savedInstanceState);
  }
}
