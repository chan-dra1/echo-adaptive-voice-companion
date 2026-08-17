package com.echo.agent;

import android.os.Bundle;
import androidx.core.view.WindowCompat;
import com.getcapacitor.BridgeActivity;

/**
 * Android 15+ (targetSdk 35+) forces edge-to-edge by default and, as of
 * targetSdk 36, removed the manifest opt-out entirely — so the WebView draws
 * under the status bar no matter what @capacitor/status-bar's
 * setOverlaysWebView(false) requests at the plugin level (verified on a real
 * Pixel 10 Pro XL: the ECHO wordmark and status pill visibly overlapped the
 * clock/battery icons even with that call in place). Calling
 * setDecorFitsSystemWindows(true) here, after Capacitor's own onCreate has
 * run, is the documented workaround: it tells the system to reserve
 * (not just report) the status/nav bar insets, so content is actually
 * pushed below them instead of only being told where they are.
 */
public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        WindowCompat.setDecorFitsSystemWindows(getWindow(), true);
    }
}
