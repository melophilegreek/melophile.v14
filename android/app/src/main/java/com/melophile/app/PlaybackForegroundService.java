package com.melophile.app;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Context;
import android.content.Intent;
import android.content.pm.ServiceInfo;
import android.graphics.Bitmap;
import android.graphics.BitmapFactory;
import android.os.Build;
import android.os.IBinder;

import androidx.annotation.Nullable;
import androidx.core.app.NotificationCompat;
import androidx.core.content.ContextCompat;

import java.io.IOException;
import java.io.InputStream;
import java.net.URL;

// Feature (Persistent playback notification): a foreground Service is the
// standard, and on modern Android essentially required, way to keep audio
// playing reliably once the screen locks or the app is backgrounded --
// without one, Android treats the process as a normal background app and
// can suspend/kill it under memory pressure or Doze restrictions. This
// class owns exactly one thing: showing/updating/tearing down the
// notification and promoting/demoting foreground status. Actual playback
// control (what happens when Play/Pause/Next is tapped) lives in the web
// layer (player.ts) -- this only turns notification button taps into
// broadcasts that PlaybackNotificationPlugin listens for and forwards to
// JS, exactly mirroring how the web MediaSession action handlers already
// work for the lock-screen case.
//
// NOTE: this file was written without an Android SDK/Gradle/emulator
// available to compile or run it against -- see the android-apk.yml
// workflow's header comment. The APIs used here (NotificationCompat.
// MediaStyle, startForeground with a type, a locally-registered
// BroadcastReceiver) are all standard and stable, but this specific file
// has not been build-verified.
public class PlaybackForegroundService extends Service {

  public static final String CHANNEL_ID = "melophile_playback";
  private static final int NOTIFICATION_ID = 2001;

  public static final String ACTION_START = "com.melophile.app.action.PLAYBACK_START";
  public static final String ACTION_UPDATE = "com.melophile.app.action.PLAYBACK_UPDATE";
  public static final String ACTION_STOP = "com.melophile.app.action.PLAYBACK_STOP";

  // Fired by the notification's own action buttons -- PlaybackNotificationPlugin
  // registers a receiver for these and forwards them to JS.
  public static final String ACTION_CONTROL = "com.melophile.app.action.PLAYBACK_CONTROL";
  public static final String EXTRA_CONTROL = "control"; // "play" | "pause" | "next" | "previous"

  public static final String EXTRA_TITLE = "title";
  public static final String EXTRA_ARTIST = "artist";
  public static final String EXTRA_ALBUM = "album";
  public static final String EXTRA_ARTWORK_URL = "artworkUrl";
  public static final String EXTRA_IS_PLAYING = "isPlaying";

  private Bitmap currentArt = null;
  private String currentArtUrl = null;

  @Override
  public void onCreate() {
    super.onCreate();
    createChannel();
  }

  @Override
  public int onStartCommand(Intent intent, int flags, int startId) {
    if (intent == null || intent.getAction() == null) return START_NOT_STICKY;

    switch (intent.getAction()) {
      case ACTION_START:
      case ACTION_UPDATE:
        handleShowOrUpdate(intent, intent.getAction().equals(ACTION_START));
        break;
      case ACTION_STOP:
        stopForeground(true);
        stopSelf();
        break;
    }
    return START_NOT_STICKY;
  }

  private void handleShowOrUpdate(Intent intent, boolean isStart) {
    String title = intent.getStringExtra(EXTRA_TITLE);
    String artist = intent.getStringExtra(EXTRA_ARTIST);
    String album = intent.getStringExtra(EXTRA_ALBUM);
    String artworkUrl = intent.getStringExtra(EXTRA_ARTWORK_URL);
    boolean isPlaying = intent.getBooleanExtra(EXTRA_IS_PLAYING, false);

    // Feature (Persistent playback notification): artwork comes in as a
    // blob: URL from the web layer (see nativePlayback.ts), which is only
    // resolvable inside the WebView's process, not by this native Service
    // fetching it directly -- so nativePlayback.ts instead converts it to a
    // data: URL (base64) before sending it over. Decoding that here avoids
    // needing a second IPC round-trip just for image bytes.
    if (artworkUrl != null && !artworkUrl.equals(currentArtUrl)) {
      currentArtUrl = artworkUrl;
      currentArt = decodeArtwork(artworkUrl);
    } else if (artworkUrl == null) {
      currentArtUrl = null;
      currentArt = null;
    }

    Notification notification = buildNotification(title, artist, album, isPlaying);

    if (isStart || isPlaying) {
      // Ongoing/non-dismissible while actively playing -- this is what
      // actually keeps the process alive; a plain notification (without
      // foreground promotion) offers no such protection.
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
        startForeground(NOTIFICATION_ID, notification, ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PLAYBACK);
      } else {
        startForeground(NOTIFICATION_ID, notification);
      }
    } else {
      // Paused: demote out of foreground so the notification becomes a
      // normal, swipeable one (matches Spotify/YT Music's behavior) while
      // still showing what's loaded and offering a Play button to resume --
      // `false` means "don't remove the notification", just stop the
      // foreground/ongoing guarantee.
      stopForeground(false);
      NotificationManager nm = (NotificationManager) getSystemService(Context.NOTIFICATION_SERVICE);
      if (nm != null) nm.notify(NOTIFICATION_ID, notification);
    }
  }

  private Notification buildNotification(String title, String artist, String album, boolean isPlaying) {
    PendingIntent openApp = PendingIntent.getActivity(
      this, 0, new Intent(this, MainActivity.class),
      PendingIntent.FLAG_UPDATE_CURRENT | (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M ? PendingIntent.FLAG_IMMUTABLE : 0)
    );

    NotificationCompat.Builder builder = new NotificationCompat.Builder(this, CHANNEL_ID)
      .setSmallIcon(R.drawable.ic_notification)
      .setContentTitle(title == null ? "Melophile" : title)
      .setContentText(artist == null ? "" : (album != null && !album.isEmpty() ? artist + " — " + album : artist))
      .setContentIntent(openApp)
      .setOnlyAlertOnce(true)
      .setPriority(NotificationCompat.PRIORITY_LOW)
      .setVisibility(NotificationCompat.VISIBILITY_PUBLIC)
      .setOngoing(isPlaying);

    if (currentArt != null) builder.setLargeIcon(currentArt);

    builder.addAction(android.R.drawable.ic_media_previous, "Previous", controlIntent("previous"));
    if (isPlaying) {
      builder.addAction(android.R.drawable.ic_media_pause, "Pause", controlIntent("pause"));
    } else {
      builder.addAction(android.R.drawable.ic_media_play, "Play", controlIntent("play"));
    }
    builder.addAction(android.R.drawable.ic_media_next, "Next", controlIntent("next"));

    builder.setStyle(new androidx.media.app.NotificationCompat.MediaStyle()
      .setShowActionsInCompactView(0, 1, 2));

    return builder.build();
  }

  private PendingIntent controlIntent(String control) {
    Intent intent = new Intent(ACTION_CONTROL).setPackage(getPackageName());
    intent.putExtra(EXTRA_CONTROL, control);
    int flags = PendingIntent.FLAG_UPDATE_CURRENT | (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M ? PendingIntent.FLAG_IMMUTABLE : 0);
    // A unique request code per control type so Android doesn't collapse
    // the three PendingIntents into one (they'd otherwise share extras).
    return PendingIntent.getBroadcast(this, control.hashCode(), intent, flags);
  }

  private Bitmap decodeArtwork(String dataUrl) {
    try {
      if (dataUrl.startsWith("data:")) {
        int comma = dataUrl.indexOf(',');
        if (comma < 0) return null;
        byte[] bytes = android.util.Base64.decode(dataUrl.substring(comma + 1), android.util.Base64.DEFAULT);
        return BitmapFactory.decodeByteArray(bytes, 0, bytes.length);
      }
      // Fallback for a plain http(s) URL, if ever passed directly --
      // network on the service's own thread is acceptable here since this
      // runs off the main/UI thread already (Service callbacks aren't on
      // the UI thread by default for onStartCommand's synchronous body in
      // this simple case, but to be safe this path is best-effort only).
      InputStream in = new URL(dataUrl).openStream();
      Bitmap bmp = BitmapFactory.decodeStream(in);
      in.close();
      return bmp;
    } catch (IOException | IllegalArgumentException e) {
      return null;
    }
  }

  private void createChannel() {
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return;
    NotificationManager nm = (NotificationManager) getSystemService(Context.NOTIFICATION_SERVICE);
    if (nm == null) return;
    NotificationChannel channel = nm.getNotificationChannel(CHANNEL_ID);
    if (channel == null) {
      channel = new NotificationChannel(CHANNEL_ID, "Playback", NotificationManager.IMPORTANCE_LOW);
      channel.setDescription("Shows what's currently playing, with play/pause/skip controls.");
      channel.setShowBadge(false);
      nm.createNotificationChannel(channel);
    }
  }

  @Nullable
  @Override
  public IBinder onBind(Intent intent) {
    return null;
  }
}
