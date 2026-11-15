package com.egodact.remote;

import android.annotation.SuppressLint;
import android.content.SharedPreferences;
import android.graphics.Bitmap;
import android.net.Uri;
import android.os.Bundle;
import android.view.View;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.Button;
import android.widget.EditText;
import android.widget.LinearLayout;
import android.widget.TextView;

import androidx.appcompat.app.AppCompatActivity;

public class MainActivity extends AppCompatActivity {

    private static final String PREFS = "egodact_remote";
    private static final String KEY_URL = "remote_url";

    private LinearLayout setupPanel;
    private EditText urlInput;
    private TextView hint;
    private WebView webView;
    private SharedPreferences prefs;

    @SuppressLint("SetJavaScriptEnabled")
    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        setContentView(R.layout.activity_main);

        prefs = getSharedPreferences(PREFS, MODE_PRIVATE);
        setupPanel = findViewById(R.id.setupPanel);
        urlInput = findViewById(R.id.urlInput);
        hint = findViewById(R.id.hint);
        webView = findViewById(R.id.webView);
        Button openButton = findViewById(R.id.openButton);
        Button changeButton = findViewById(R.id.changeButton);

        WebSettings settings = webView.getSettings();
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true);
        settings.setDatabaseEnabled(true);
        settings.setCacheMode(WebSettings.LOAD_DEFAULT);
        settings.setMixedContentMode(WebSettings.MIXED_CONTENT_COMPATIBILITY_MODE);
        settings.setSupportZoom(true);
        settings.setBuiltInZoomControls(true);
        settings.setDisplayZoomControls(false);
        settings.setLoadWithOverviewMode(true);
        settings.setUseWideViewPort(true);

        webView.setWebViewClient(new WebViewClient() {
            @Override
            public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                Uri uri = request.getUrl();
                return uri != null && uri.getScheme() != null
                        && !uri.getScheme().equals("http")
                        && !uri.getScheme().equals("https");
            }

            @Override
            public void onPageStarted(WebView view, String url, Bitmap favicon) {
                hint.setText("Laden...");
            }

            @Override
            public void onPageFinished(WebView view, String url) {
                hint.setText("Verbonden met: " + url);
                prefs.edit().putString(KEY_URL, url).apply();
            }

            @Override
            public void onReceivedError(WebView view, int errorCode, String description, String failingUrl) {
                hint.setText("Kan niet laden: " + description);
            }
        });
        webView.setWebChromeClient(new WebChromeClient());

        openButton.setOnClickListener(v -> {
            String url = normalize(urlInput.getText().toString());
            if (url.isEmpty()) {
                hint.setText("Plak de link uit de Egodact Remote-agent op je PC.");
                return;
            }
            prefs.edit().putString(KEY_URL, url).apply();
            openUrl(url);
        });

        changeButton.setOnClickListener(v -> showSetup(prefs.getString(KEY_URL, "")));

        String saved = prefs.getString(KEY_URL, "");
        String fromIntent = getIntentUrl();
        if (!fromIntent.isEmpty()) {
            urlInput.setText(fromIntent);
            openUrl(fromIntent);
        } else if (!saved.isEmpty()) {
            urlInput.setText(saved);
            openUrl(saved);
        } else {
            showSetup("");
        }
    }

    private String getIntentUrl() {
        if (getIntent() == null || getIntent().getData() == null) return "";
        return getIntent().getData().toString();
    }

    private String normalize(String raw) {
        String url = raw == null ? "" : raw.trim();
        if (url.isEmpty()) return "";
        if (!url.startsWith("http://") && !url.startsWith("https://")) {
            url = "http://" + url;
        }
        return url;
    }

    private void showSetup(String current) {
        webView.stopLoading();
        webView.loadUrl("about:blank");
        webView.setVisibility(View.GONE);
        setupPanel.setVisibility(View.VISIBLE);
        if (current != null && !current.isEmpty()) urlInput.setText(current);
        hint.setText("Plak de link met token uit start-remote-anywhere.cmd op je PC.");
    }

    private void openUrl(String url) {
        setupPanel.setVisibility(View.GONE);
        webView.setVisibility(View.VISIBLE);
        hint.setText("Verbinden...");
        webView.loadUrl(url);
    }

    @Override
    public void onBackPressed() {
        if (webView.getVisibility() == View.VISIBLE && webView.canGoBack()) {
            webView.goBack();
            return;
        }
        if (webView.getVisibility() == View.VISIBLE) {
            showSetup(prefs.getString(KEY_URL, ""));
            return;
        }
        super.onBackPressed();
    }
}
