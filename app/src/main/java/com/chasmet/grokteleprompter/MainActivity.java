package com.chasmet.grokteleprompter;

import android.Manifest;
import android.annotation.SuppressLint;
import android.app.Activity;
import android.content.ContentResolver;
import android.content.ContentValues;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.graphics.Color;
import android.media.AudioFormat;
import android.media.AudioRecord;
import android.media.MediaRecorder;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.Environment;
import android.provider.MediaStore;
import android.provider.Settings;
import android.util.Base64;
import android.view.View;
import android.view.KeyEvent;
import android.view.Window;
import android.view.WindowManager;
import android.window.OnBackInvokedCallback;
import android.window.OnBackInvokedDispatcher;
import android.webkit.JavascriptInterface;
import android.webkit.PermissionRequest;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.Toast;

import androidx.annotation.NonNull;
import androidx.webkit.WebViewAssetLoader;

import java.io.OutputStream;
import java.util.ArrayList;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.ConcurrentHashMap;

public final class MainActivity extends Activity {
    private static final int RUNTIME_PERMISSION_REQUEST = 2001;
    private static final int FILE_CHOOSER_REQUEST = 2002;
    private static final String APP_HOST = "appassets.androidplatform.net";
    private static final String START_URL = "https://" + APP_HOST + "/assets/index.html";

    private WebView webView;
    private PermissionRequest pendingWebPermission;
    private ValueCallback<Uri[]> pendingFileChooser;
    private AndroidBridge androidBridge;
    private OnBackInvokedCallback backCallback;

    @SuppressLint({"SetJavaScriptEnabled", "JavascriptInterface"})
    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        Window window = getWindow();
        window.setStatusBarColor(Color.rgb(7, 17, 31));
        window.setNavigationBarColor(Color.rgb(5, 11, 31));
        window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
        window.getDecorView().setSystemUiVisibility(0);

        webView = new WebView(this);
        webView.setBackgroundColor(Color.rgb(5, 11, 31));
        setContentView(webView);

        WebSettings settings = webView.getSettings();
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true);
        settings.setDatabaseEnabled(true);
        settings.setAllowFileAccess(true);
        settings.setAllowContentAccess(true);
        settings.setMediaPlaybackRequiresUserGesture(true);
        settings.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);
        settings.setCacheMode(WebSettings.LOAD_DEFAULT);
        settings.setBuiltInZoomControls(false);
        settings.setDisplayZoomControls(false);
        settings.setSupportZoom(false);

        WebView.setWebContentsDebuggingEnabled(BuildConfig.DEBUG);

        WebViewAssetLoader assetLoader = new WebViewAssetLoader.Builder()
                .addPathHandler("/assets/", new WebViewAssetLoader.AssetsPathHandler(this))
                .build();

        webView.setWebViewClient(new WebViewClient() {
            @Override
            public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest request) {
                return assetLoader.shouldInterceptRequest(request.getUrl());
            }

            @Override
            public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                Uri uri = request.getUrl();
                if (isTrustedOrigin(uri)) return false;
                try {
                    startActivity(new Intent(Intent.ACTION_VIEW, uri));
                } catch (Exception ignored) {
                    toast("Impossible d’ouvrir ce lien");
                }
                return true;
            }
        });

        webView.setWebChromeClient(new WebChromeClient() {
            @Override
            public void onPermissionRequest(PermissionRequest request) {
                runOnUiThread(() -> handleWebPermission(request));
            }

            @Override
            public void onPermissionRequestCanceled(PermissionRequest request) {
                if (pendingWebPermission == request) pendingWebPermission = null;
            }

            @Override
            public boolean onShowFileChooser(WebView view, ValueCallback<Uri[]> callback, FileChooserParams params) {
                if (pendingFileChooser != null) pendingFileChooser.onReceiveValue(null);
                pendingFileChooser = callback;
                Intent intent;
                try {
                    intent = params.createIntent();
                    intent.addCategory(Intent.CATEGORY_OPENABLE);
                    startActivityForResult(intent, FILE_CHOOSER_REQUEST);
                } catch (Exception error) {
                    pendingFileChooser = null;
                    toast("Sélecteur de fichiers indisponible");
                    return false;
                }
                return true;
            }
        });

        androidBridge = new AndroidBridge(getContentResolver());
        webView.addJavascriptInterface(androidBridge, "AndroidBridge");
        webView.loadUrl(START_URL);

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            backCallback = this::handleBackNavigation;
            getOnBackInvokedDispatcher().registerOnBackInvokedCallback(
                    OnBackInvokedDispatcher.PRIORITY_DEFAULT,
                    backCallback
            );
        }
    }

    private boolean isTrustedOrigin(Uri uri) {
        return uri != null && "https".equals(uri.getScheme()) && APP_HOST.equals(uri.getHost());
    }

    private void handleWebPermission(PermissionRequest request) {
        if (!isTrustedOrigin(request.getOrigin())) {
            request.deny();
            return;
        }

        boolean needsCamera = false;
        boolean needsMicrophone = false;
        for (String resource : request.getResources()) {
            if (PermissionRequest.RESOURCE_VIDEO_CAPTURE.equals(resource)) needsCamera = true;
            if (PermissionRequest.RESOURCE_AUDIO_CAPTURE.equals(resource)) needsMicrophone = true;
        }

        ArrayList<String> missing = new ArrayList<>();
        if (needsCamera && checkSelfPermission(Manifest.permission.CAMERA) != PackageManager.PERMISSION_GRANTED) {
            missing.add(Manifest.permission.CAMERA);
        }
        if (needsMicrophone && checkSelfPermission(Manifest.permission.RECORD_AUDIO) != PackageManager.PERMISSION_GRANTED) {
            missing.add(Manifest.permission.RECORD_AUDIO);
        }

        if (missing.isEmpty()) {
            grantAllowedWebResources(request);
        } else {
            if (pendingWebPermission != null && pendingWebPermission != request) pendingWebPermission.deny();
            pendingWebPermission = request;
            requestPermissions(missing.toArray(new String[0]), RUNTIME_PERMISSION_REQUEST);
        }
    }

    private void grantAllowedWebResources(PermissionRequest request) {
        ArrayList<String> allowed = new ArrayList<>();
        for (String resource : request.getResources()) {
            if (PermissionRequest.RESOURCE_VIDEO_CAPTURE.equals(resource)
                    && checkSelfPermission(Manifest.permission.CAMERA) == PackageManager.PERMISSION_GRANTED) {
                allowed.add(resource);
            }
            if (PermissionRequest.RESOURCE_AUDIO_CAPTURE.equals(resource)
                    && checkSelfPermission(Manifest.permission.RECORD_AUDIO) == PackageManager.PERMISSION_GRANTED) {
                allowed.add(resource);
            }
        }
        if (allowed.isEmpty()) request.deny();
        else request.grant(allowed.toArray(new String[0]));
    }

    @Override
    public void onRequestPermissionsResult(int requestCode, @NonNull String[] permissions, @NonNull int[] results) {
        super.onRequestPermissionsResult(requestCode, permissions, results);
        if (requestCode == RUNTIME_PERMISSION_REQUEST && pendingWebPermission != null) {
            PermissionRequest request = pendingWebPermission;
            pendingWebPermission = null;
            grantAllowedWebResources(request);
        }
    }

    @Override
    protected void onActivityResult(int requestCode, int resultCode, Intent data) {
        super.onActivityResult(requestCode, resultCode, data);
        if (requestCode == FILE_CHOOSER_REQUEST && pendingFileChooser != null) {
            Uri[] result = WebChromeClient.FileChooserParams.parseResult(resultCode, data);
            pendingFileChooser.onReceiveValue(result);
            pendingFileChooser = null;
        }
    }

    private void handleBackNavigation() {
        if (webView != null && webView.canGoBack()) webView.goBack();
        else finish();
    }

    @Override
    protected void onResume() {
        super.onResume();
        if (webView != null) webView.onResume();
    }

    @Override
    protected void onPause() {
        if (androidBridge != null) androidBridge.stopNativeMicrophone();
        if (webView != null) webView.onPause();
        super.onPause();
    }

    @Override
    public boolean onKeyDown(int keyCode, KeyEvent event) {
        if (keyCode == KeyEvent.KEYCODE_BACK && Build.VERSION.SDK_INT < Build.VERSION_CODES.TIRAMISU) {
            handleBackNavigation();
            return true;
        }
        return super.onKeyDown(keyCode, event);
    }

    @Override
    protected void onDestroy() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU && backCallback != null) {
            getOnBackInvokedDispatcher().unregisterOnBackInvokedCallback(backCallback);
        }
        if (pendingWebPermission != null) pendingWebPermission.deny();
        if (pendingFileChooser != null) pendingFileChooser.onReceiveValue(null);
        if (androidBridge != null) androidBridge.cancelAll();
        if (webView != null) {
            webView.loadUrl("about:blank");
            webView.removeJavascriptInterface("AndroidBridge");
            webView.destroy();
        }
        super.onDestroy();
    }

    private void toast(String message) {
        runOnUiThread(() -> Toast.makeText(this, message, Toast.LENGTH_LONG).show());
    }

    public final class AndroidBridge {
        private static final int NATIVE_MIC_SAMPLE_RATE = 48000;
        // 40 ms exactement à 48 kHz mono 16 bits : quatre trames audio de
        // 10 ms, sans fraction résiduelle aux frontières WebRTC/MediaRecorder.
        private static final int NATIVE_MIC_CHUNK_BYTES = 3840;
        private final ContentResolver resolver;
        private final Map<String, SaveSession> sessions = new ConcurrentHashMap<>();
        private final Object nativeMicrophoneLock = new Object();
        private volatile boolean nativeMicrophoneRunning;
        private AudioRecord nativeAudioRecord;
        private Thread nativeAudioThread;

        AndroidBridge(ContentResolver resolver) {
            this.resolver = resolver;
        }

        @JavascriptInterface
        public void openAppSettings() {
            runOnUiThread(() -> {
                try {
                    Intent intent = new Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS);
                    intent.setData(Uri.fromParts("package", getPackageName(), null));
                    startActivity(intent);
                } catch (Exception error) {
                    toast("Impossible d’ouvrir les réglages Android");
                }
            });
        }

        /**
         * Secours natif pour les WebView/OEM qui refusent getUserMedia(audio)
         * alors que RECORD_AUDIO est bien accordée. Le PCM mono 16 bits est
         * envoyé au graphe WebAudio de l'application par blocs courts.
         */
        @SuppressLint("MissingPermission")
        @JavascriptInterface
        public int startNativeMicrophone(String profileName) {
            if (checkSelfPermission(Manifest.permission.RECORD_AUDIO) != PackageManager.PERMISSION_GRANTED) {
                return 0;
            }

            synchronized (nativeMicrophoneLock) {
                if (nativeMicrophoneRunning && nativeAudioRecord != null) return NATIVE_MIC_SAMPLE_RATE;

                int minimum = AudioRecord.getMinBufferSize(
                        NATIVE_MIC_SAMPLE_RATE,
                        AudioFormat.CHANNEL_IN_MONO,
                        AudioFormat.ENCODING_PCM_16BIT
                );
                if (minimum <= 0) return 0;
                int bufferSize = Math.max(minimum * 4, NATIVE_MIC_CHUNK_BYTES * 4);

                boolean musicProfile = "music".equals(profileName);
                int[] sources = musicProfile
                        ? new int[] {
                                MediaRecorder.AudioSource.UNPROCESSED,
                                MediaRecorder.AudioSource.MIC,
                                MediaRecorder.AudioSource.CAMCORDER
                        }
                        : new int[] {
                                MediaRecorder.AudioSource.UNPROCESSED,
                                MediaRecorder.AudioSource.VOICE_RECOGNITION,
                                MediaRecorder.AudioSource.MIC,
                                MediaRecorder.AudioSource.CAMCORDER
                        };
                AudioRecord recorder = null;
                for (int source : sources) {
                    recorder = createAudioRecord(source, bufferSize);
                    if (recorder != null) break;
                }
                if (recorder == null) return 0;

                try {
                    recorder.startRecording();
                    if (recorder.getRecordingState() != AudioRecord.RECORDSTATE_RECORDING) {
                        recorder.release();
                        return 0;
                    }
                } catch (Exception error) {
                    try { recorder.release(); } catch (Exception ignored) {}
                    return 0;
                }

                nativeAudioRecord = recorder;
                nativeMicrophoneRunning = true;
                AudioRecord activeRecorder = recorder;
                nativeAudioThread = new Thread(
                        () -> pumpNativeMicrophone(activeRecorder),
                        "GrokNativeMicrophone"
                );
                nativeAudioThread.start();
                return NATIVE_MIC_SAMPLE_RATE;
            }
        }

        @SuppressLint("MissingPermission")
        private AudioRecord createAudioRecord(int source, int bufferSize) {
            try {
                AudioRecord recorder = new AudioRecord.Builder()
                        .setAudioSource(source)
                        .setAudioFormat(new AudioFormat.Builder()
                                .setEncoding(AudioFormat.ENCODING_PCM_16BIT)
                                .setSampleRate(NATIVE_MIC_SAMPLE_RATE)
                                .setChannelMask(AudioFormat.CHANNEL_IN_MONO)
                                .build())
                        .setBufferSizeInBytes(bufferSize)
                        .build();
                if (recorder.getState() == AudioRecord.STATE_INITIALIZED) return recorder;
                recorder.release();
            } catch (Exception ignored) {}
            return null;
        }

        private void pumpNativeMicrophone(AudioRecord recorder) {
            try {
                android.os.Process.setThreadPriority(android.os.Process.THREAD_PRIORITY_URGENT_AUDIO);
            } catch (Exception ignored) {}

            byte[] pcm = new byte[NATIVE_MIC_CHUNK_BYTES];
            try {
                captureLoop:
                while (nativeMicrophoneRunning && nativeAudioRecord == recorder) {
                    int filled = 0;
                    while (filled < pcm.length && nativeMicrophoneRunning && nativeAudioRecord == recorder) {
                        int count = recorder.read(
                                pcm,
                                filled,
                                pcm.length - filled,
                                AudioRecord.READ_BLOCKING
                        );
                        if (count > 0) {
                            filled += count;
                        } else if (count < 0) {
                            if (nativeMicrophoneRunning && nativeAudioRecord == recorder) {
                                dispatchNativeAudioError("Lecture du micro natif interrompue");
                            }
                            break captureLoop;
                        } else {
                            Thread.yield();
                        }
                    }
                    if (filled == pcm.length) {
                        String encoded = Base64.encodeToString(pcm, Base64.NO_WRAP);
                        dispatchNativeAudio(encoded, calculatePcmRms(pcm, filled));
                    }
                }
            } catch (Exception error) {
                if (nativeMicrophoneRunning && nativeAudioRecord == recorder) {
                    dispatchNativeAudioError("Le micro natif s’est arrêté");
                }
            } finally {
                boolean ownsRecorder = false;
                synchronized (nativeMicrophoneLock) {
                    if (nativeAudioRecord == recorder) {
                        nativeMicrophoneRunning = false;
                        nativeAudioRecord = null;
                        nativeAudioThread = null;
                        ownsRecorder = true;
                    }
                }
                if (ownsRecorder) {
                    try { recorder.stop(); } catch (Exception ignored) {}
                    try { recorder.release(); } catch (Exception ignored) {}
                }
            }
        }

        private double calculatePcmRms(byte[] pcm, int count) {
            int sampleCount = count / 2;
            if (sampleCount <= 0) return 0;
            long sumSquares = 0;
            for (int index = 0; index + 1 < count; index += 2) {
                short sample = (short) ((pcm[index] & 0xff) | (pcm[index + 1] << 8));
                sumSquares += (long) sample * sample;
            }
            return Math.min(1, Math.sqrt((double) sumSquares / sampleCount) / 32768.0);
        }

        private void dispatchNativeAudio(String encoded, double rms) {
            WebView target = webView;
            if (target == null) return;
            target.post(() -> {
                if (webView != null) {
                    webView.evaluateJavascript(
                            "window.GrokNativeAudio&&window.GrokNativeAudio.push('" + encoded + "',48000," + Double.toString(rms) + ")",
                            null
                    );
                }
            });
        }

        private void dispatchNativeAudioError(String message) {
            WebView target = webView;
            if (target == null) return;
            String safeMessage = message.replace("'", "");
            target.post(() -> {
                if (webView != null) {
                    webView.evaluateJavascript(
                            "window.GrokNativeAudio&&window.GrokNativeAudio.error('" + safeMessage + "')",
                            null
                    );
                }
            });
        }

        @JavascriptInterface
        public void stopNativeMicrophone() {
            AudioRecord recorder;
            Thread thread;
            synchronized (nativeMicrophoneLock) {
                nativeMicrophoneRunning = false;
                recorder = nativeAudioRecord;
                thread = nativeAudioThread;
                nativeAudioRecord = null;
                nativeAudioThread = null;
            }
            if (recorder != null) {
                try { recorder.stop(); } catch (Exception ignored) {}
            }
            if (thread != null && thread != Thread.currentThread()) {
                try { thread.join(500); } catch (InterruptedException error) {
                    Thread.currentThread().interrupt();
                }
            }
            if (recorder != null) {
                try { recorder.release(); } catch (Exception ignored) {}
            }
        }

        @JavascriptInterface
        public String beginSave(String requestedName, String requestedMime) {
            String name = sanitizeName(requestedName);
            String mime = requestedMime != null && requestedMime.startsWith("video/") ? requestedMime : "video/webm";
            ContentValues values = new ContentValues();
            values.put(MediaStore.Video.Media.DISPLAY_NAME, name);
            values.put(MediaStore.Video.Media.MIME_TYPE, mime);
            values.put(MediaStore.Video.Media.RELATIVE_PATH, Environment.DIRECTORY_MOVIES + "/Grok Teleprompteur");
            values.put(MediaStore.Video.Media.IS_PENDING, 1);

            Uri uri = null;
            try {
                uri = resolver.insert(MediaStore.Video.Media.EXTERNAL_CONTENT_URI, values);
                if (uri == null) return "";
                OutputStream output = resolver.openOutputStream(uri, "w");
                if (output == null) {
                    resolver.delete(uri, null, null);
                    return "";
                }
                String id = UUID.randomUUID().toString();
                sessions.put(id, new SaveSession(uri, output));
                return id;
            } catch (Exception error) {
                if (uri != null) resolver.delete(uri, null, null);
                return "";
            }
        }

        @JavascriptInterface
        public boolean writeChunk(String sessionId, String base64Data) {
            SaveSession session = sessions.get(sessionId);
            if (session == null || base64Data == null) return false;
            try {
                byte[] bytes = Base64.decode(base64Data, Base64.NO_WRAP);
                session.output.write(bytes);
                return true;
            } catch (Exception error) {
                cancelSave(sessionId);
                return false;
            }
        }

        @JavascriptInterface
        public boolean finishSave(String sessionId) {
            SaveSession session = sessions.remove(sessionId);
            if (session == null) return false;
            try {
                session.output.flush();
                session.output.close();
                ContentValues values = new ContentValues();
                values.put(MediaStore.Video.Media.IS_PENDING, 0);
                resolver.update(session.uri, values, null, null);
                toast("Vidéo enregistrée dans Films/Grok Téléprompteur");
                return true;
            } catch (Exception error) {
                resolver.delete(session.uri, null, null);
                return false;
            }
        }

        @JavascriptInterface
        public void cancelSave(String sessionId) {
            SaveSession session = sessions.remove(sessionId);
            if (session == null) return;
            try { session.output.close(); } catch (Exception ignored) {}
            resolver.delete(session.uri, null, null);
        }

        void cancelAll() {
            stopNativeMicrophone();
            for (String sessionId : new ArrayList<>(sessions.keySet())) cancelSave(sessionId);
        }

        private String sanitizeName(String requestedName) {
            String fallback = "Grok_Teleprompteur_" + System.currentTimeMillis() + ".webm";
            if (requestedName == null || requestedName.trim().isEmpty()) return fallback;
            String cleaned = requestedName.replaceAll("[^a-zA-Z0-9._-]", "_");
            if (!cleaned.endsWith(".mp4") && !cleaned.endsWith(".webm")) cleaned += ".webm";
            return cleaned.length() > 100 ? fallback : cleaned;
        }
    }

    private static final class SaveSession {
        final Uri uri;
        final OutputStream output;

        SaveSession(Uri uri, OutputStream output) {
            this.uri = uri;
            this.output = output;
        }
    }
}
