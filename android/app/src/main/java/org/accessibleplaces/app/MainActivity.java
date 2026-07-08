package org.accessibleplaces.app;

import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {

    // Must match the @capacitor/preferences plugin's default SharedPreferences
    // file name (Android: getSharedPreferences(group, MODE_PRIVATE), keys
    // stored unprefixed) so Preferences.get() on the web side sees it. Unlike
    // iOS UserDefaults, Android needs no "CapacitorStorage."-prefixed key.
    private static final String PREFS_GROUP        = "CapacitorStorage";
    private static final String PENDING_ACTION_KEY = "ap_pending_native_action";

    // BridgeActivity.onCreate() calls this.onNewIntent(getIntent()) internally
    // (see load()), so overriding only this one method covers BOTH entry
    // points: cold launch from a home-screen shortcut, and a warm launch
    // (singleTask) while the app is already running — the same two cases
    // iOS handles via didFinishLaunchingWithOptions + performActionFor
    // (ios/App/App/AppDelegate.swift). The stored value is picked up by
    // lib/native/actions.ts (consumePendingNativeAction), which already
    // existed for the iOS side of this same bridge.
    @Override
    public void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        storePendingActionFromIntent(intent);
    }

    private void storePendingActionFromIntent(Intent intent) {
        if (intent == null || intent.getAction() == null) return;
        String action;
        switch (intent.getAction()) {
            case "org.accessibleplaces.app.SHORTCUT_PARKING":
                action = "parking";
                break;
            case "org.accessibleplaces.app.SHORTCUT_TOILET":
                action = "toilet";
                break;
            default:
                return;
        }
        SharedPreferences prefs = getSharedPreferences(PREFS_GROUP, Context.MODE_PRIVATE);
        prefs.edit().putString(PENDING_ACTION_KEY, action).apply();
    }
}
