package com.hquip.compositor;

import com.getcapacitor.BridgeActivity;
import com.getcapacitor.BridgeWebViewClient;
import android.os.Bundle;
import android.graphics.Color;
import androidx.core.view.WindowCompat;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebView;
import java.util.HashMap;
import java.util.Map;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(CompositorClipboardPlugin.class);
        super.onCreate(savedInstanceState);
        if (bridge == null) return;
        getWindow().getDecorView().setBackgroundColor(Color.rgb(36, 36, 38));
        WindowCompat.getInsetsController(getWindow(), bridge.getWebView()).setAppearanceLightStatusBars(false);
        WindowCompat.getInsetsController(getWindow(), bridge.getWebView()).setAppearanceLightNavigationBars(false);
        bridge.setWebViewClient(new BridgeWebViewClient(bridge) {
            @Override
            public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest request) {
                WebResourceResponse response = super.shouldInterceptRequest(view, request);
                if (response != null && "localhost".equals(request.getUrl().getHost())) {
                    Map<String, String> headers = new HashMap<>();
                    if (response.getResponseHeaders() != null) headers.putAll(response.getResponseHeaders());
                    headers.put("Cross-Origin-Opener-Policy", "same-origin");
                    headers.put("Cross-Origin-Embedder-Policy", "require-corp");
                    response.setResponseHeaders(headers);
                }
                return response;
            }
        });
        bridge.getWebView().reload();
    }
}
