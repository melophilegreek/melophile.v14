package com.melophile.app;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.IntentFilter;
import android.os.Build;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

// Feature (Persistent playback notification): the JS-facing half of the
// foreground-service notification -- see PlaybackForegroundService for the
// half that actually owns the notification/foreground-service lifecycle.
// This plugin's job is narrow: turn `start`/`update`/`stop` calls from
// nativePlayback.ts into intents the Service understands, and turn button
// taps on the notification (broadcast by the Service) into `notifyListeners`
// events the JS side (player.ts) can react to by calling play()/pause()/
// next()/previous() -- the same actions the web MediaSession handlers
// already implement for the lock-screen case, just triggered from a
// different source.
//
// NOTE: not build-verified -- see PlaybackForegroundService's header
// comment for why.
@CapacitorPlugin(name = "PlaybackNotification")
public class PlaybackNotificationPlugin extends Plugin {

  private BroadcastReceiver controlReceiver;

  @Override
  public void load() {
    super.load();
    controlReceiver = new BroadcastReceiver() {
      @Override
      public void onReceive(Context context, Intent intent) {
        String control = intent.getStringExtra(PlaybackForegroundService.EXTRA_CONTROL);
        if (control == null) return;
        JSObject data = new JSObject();
        data.put("control", control);
        notifyListeners("action", data);
      }
    };
    IntentFilter filter = new IntentFilter(PlaybackForegroundService.ACTION_CONTROL);
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
      getContext().registerReceiver(controlReceiver, filter, Context.RECEIVER_NOT_EXPORTED);
    } else {
      getContext().registerReceiver(controlReceiver, filter);
    }
  }

  @PluginMethod
  public void start(PluginCall call) {
    sendToService(PlaybackForegroundService.ACTION_START, call);
  }

  @PluginMethod
  public void update(PluginCall call) {
    sendToService(PlaybackForegroundService.ACTION_UPDATE, call);
  }

  @PluginMethod
  public void stop(PluginCall call) {
    Intent intent = new Intent(getContext(), PlaybackForegroundService.class);
    intent.setAction(PlaybackForegroundService.ACTION_STOP);
    getContext().startService(intent);
    call.resolve();
  }

  private void sendToService(String action, PluginCall call) {
    Intent intent = new Intent(getContext(), PlaybackForegroundService.class);
    intent.setAction(action);
    intent.putExtra(PlaybackForegroundService.EXTRA_TITLE, call.getString("title", "Melophile"));
    intent.putExtra(PlaybackForegroundService.EXTRA_ARTIST, call.getString("artist", ""));
    intent.putExtra(PlaybackForegroundService.EXTRA_ALBUM, call.getString("album", ""));
    intent.putExtra(PlaybackForegroundService.EXTRA_ARTWORK_URL, call.getString("artworkUrl", null));
    intent.putExtra(PlaybackForegroundService.EXTRA_IS_PLAYING, Boolean.TRUE.equals(call.getBoolean("isPlaying", false)));

    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
      getContext().startForegroundService(intent);
    } else {
      getContext().startService(intent);
    }
    call.resolve();
  }

  @Override
  protected void handleOnDestroy() {
    if (controlReceiver != null) {
      try { getContext().unregisterReceiver(controlReceiver); } catch (IllegalArgumentException ignored) { /* already unregistered */ }
    }
    super.handleOnDestroy();
  }
}
