package com.chasmet.grokteleprompter;

import android.Manifest;
import android.annotation.SuppressLint;
import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.ContentValues;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.content.pm.ServiceInfo;
import android.graphics.Bitmap;
import android.graphics.Canvas;
import android.graphics.Color;
import android.graphics.Paint;
import android.graphics.PixelFormat;
import android.graphics.PorterDuff;
import android.graphics.PorterDuffXfermode;
import android.graphics.Rect;
import android.graphics.drawable.GradientDrawable;
import android.hardware.camera2.CameraCaptureSession;
import android.hardware.camera2.CameraCharacteristics;
import android.hardware.camera2.CameraDevice;
import android.hardware.camera2.CameraManager;
import android.hardware.camera2.CaptureRequest;
import android.media.AudioDeviceInfo;
import android.media.AudioManager;
import android.media.MediaRecorder;
import android.media.projection.MediaProjection;
import android.media.projection.MediaProjectionManager;
import android.net.Uri;
import android.os.Build;
import android.os.Environment;
import android.os.Handler;
import android.os.HandlerThread;
import android.os.IBinder;
import android.os.ParcelFileDescriptor;
import android.provider.MediaStore;
import android.util.DisplayMetrics;
import android.util.Range;
import android.view.Gravity;
import android.view.MotionEvent;
import android.view.Surface;
import android.view.TextureView;
import android.view.WindowManager;
import android.widget.Button;
import android.widget.FrameLayout;
import android.widget.ImageView;
import android.widget.LinearLayout;
import android.widget.TextView;
import android.widget.Toast;

import androidx.annotation.NonNull;

import com.google.mlkit.vision.common.InputImage;
import com.google.mlkit.vision.segmentation.Segmentation;
import com.google.mlkit.vision.segmentation.SegmentationMask;
import com.google.mlkit.vision.segmentation.Segmenter;
import com.google.mlkit.vision.segmentation.selfie.SelfieSegmenterOptions;

import java.nio.ByteBuffer;
import java.nio.ByteOrder;
import java.nio.FloatBuffer;
import java.text.SimpleDateFormat;
import java.util.Arrays;
import java.util.Date;
import java.util.Locale;

public final class LiveOverlayService extends Service {
    public static final String ACTION_START = "com.chasmet.grokteleprompter.LIVE_START";
    public static final String ACTION_STOP = "com.chasmet.grokteleprompter.LIVE_STOP";
    public static final String ACTION_TOGGLE_PAUSE = "com.chasmet.grokteleprompter.LIVE_TOGGLE_PAUSE";
    public static final String ACTION_STOP_RECORDING = "com.chasmet.grokteleprompter.LIVE_STOP_RECORDING";
    public static final String EXTRA_RESULT_CODE = "resultCode";
    public static final String EXTRA_RESULT_DATA = "resultData";
    public static final String EXTRA_SCRIPT = "script";
    public static final String EXTRA_SPEED = "speed";
    public static final String EXTRA_FONT_SIZE = "fontSize";

    private static final String CHANNEL_ID = "grok_live_overlay";
    private static final int NOTIFICATION_ID = 4217;
    private static final int SEGMENTATION_WIDTH = 288;
    private static final int SEGMENTATION_HEIGHT = 384;
    private static final long SEGMENTATION_FRAME_INTERVAL_MS = 42L;
    private static final long CAPTURE_UI_SETTLE_DELAY_MS = 250L;
    private static final int CONTROLS_READY_HEIGHT_DP = 116;
    private static final int CONTROLS_ACTIVE_HEIGHT_DP = 78;

    private WindowManager windowManager;
    private WindowManager.LayoutParams cameraParams;
    private WindowManager.LayoutParams teleParams;
    private WindowManager.LayoutParams controlsParams;
    private FrameLayout cameraRoot;
    private FrameLayout teleRoot;
    private LinearLayout controlsRoot;
    private TextureView cameraTexture;
    private ImageView cameraCutout;
    private TextView teleText;
    private TextView statusText;
    private TextView cameraMoveHandle;
    private TextView cameraResizeHandle;
    private TextView teleMoveHandle;
    private TextView teleResizeHandle;
    private LinearLayout tuningRow;
    private Button recButton;
    private Button pauseButton;
    private Button stopButton;

    private final Handler mainHandler = new Handler(android.os.Looper.getMainLooper());
    private HandlerThread cameraThread;
    private Handler cameraHandler;
    private CameraDevice cameraDevice;
    private CameraCaptureSession cameraSession;
    private Surface cameraPreviewSurface;
    private CameraCharacteristics activeCameraCharacteristics;
    private int cameraFacing = CameraCharacteristics.LENS_FACING_FRONT;
    private boolean segmentationBusy;
    private boolean segmentationFrozen;
    private Segmenter segmenter;
    private boolean serviceDestroyed;
    private long segmentationFrameStartedAt;
    private int[] liveAlphaPixels;
    private float[] liveMaskValues;
    private float[] liveMaskHistory;
    private float[] liveMaskHorizontal;
    private float[] liveMaskBlurred;
    private Bitmap liveMaskBitmap;
    private Bitmap liveCutoutBitmap;
    private Canvas liveCutoutCanvas;
    private boolean liveMaskHasHistory;
    private final Rect liveTargetRect = new Rect();
    private final Paint liveSourcePaint = new Paint(Paint.ANTI_ALIAS_FLAG | Paint.FILTER_BITMAP_FLAG);
    private final Paint liveAlphaPaint = new Paint(Paint.ANTI_ALIAS_FLAG | Paint.FILTER_BITMAP_FLAG);

    private MediaProjection mediaProjection;
    private android.hardware.display.VirtualDisplay virtualDisplay;
    private MediaRecorder mediaRecorder;
    private ParcelFileDescriptor outputDescriptor;
    private Uri outputUri;
    private boolean recording;
    private boolean paused;
    private boolean recordingStarting;
    private boolean resumePending;
    private boolean teleGestureActive;
    private final LiveRecordingClock recordingClock = new LiveRecordingClock();

    private String script = "Bienvenue dans Grok Téléprompteur Live.";
    private int speed = 3;
    private int fontSizeSp = 36;
    private float teleOffset;
    private long teleLastFrame;

    private final Runnable teleScrollLoop = new Runnable() {
        @Override
        public void run() {
            if (!recording || paused) return;
            if (teleGestureActive) {
                teleLastFrame = android.os.SystemClock.uptimeMillis();
                mainHandler.postDelayed(this, 16L);
                return;
            }
            long now = android.os.SystemClock.uptimeMillis();
            if (teleLastFrame == 0L) teleLastFrame = now;
            float deltaSeconds = Math.min(.05f, (now - teleLastFrame) / 1000f);
            teleLastFrame = now;
            float pixelsPerSecond = dp(14 + speed * 8);
            teleOffset += pixelsPerSecond * deltaSeconds;
            applyTeleOffset();
            mainHandler.postDelayed(this, 16L);
        }
    };

    private final Runnable recordingTimerLoop = new Runnable() {
        @Override
        public void run() {
            if (!recording) return;
            updateControls();
            mainHandler.postDelayed(this, 250L);
        }
    };

    private final Runnable segmentationLoop = new Runnable() {
        @Override
        public void run() {
            if (serviceDestroyed) return;
            if (cameraTexture == null || !cameraTexture.isAvailable() || segmentationFrozen) {
                scheduleNextSegmentation(80L);
                return;
            }
            if (segmentationBusy) {
                scheduleNextSegmentation(8L);
                return;
            }
            Bitmap frame;
            try {
                frame = cameraTexture.getBitmap(SEGMENTATION_WIDTH, SEGMENTATION_HEIGHT);
            } catch (Exception error) {
                frame = null;
            }
            if (frame == null) {
                scheduleNextSegmentation(48L);
                return;
            }
            segmentationBusy = true;
            segmentationFrameStartedAt = android.os.SystemClock.uptimeMillis();
            Bitmap source = frame;
            segmenter.process(InputImage.fromBitmap(source, 0))
                    .addOnSuccessListener(mask -> renderMask(source, mask))
                    .addOnFailureListener(error -> source.recycle())
                    .addOnCompleteListener(task -> {
                        segmentationBusy = false;
                        long processingMs = android.os.SystemClock.uptimeMillis() - segmentationFrameStartedAt;
                        scheduleNextSegmentation(Math.max(0L,
                                SEGMENTATION_FRAME_INTERVAL_MS - processingMs));
                    });
        }
    };

    @Override
    public void onCreate() {
        super.onCreate();
        windowManager = (WindowManager) getSystemService(WINDOW_SERVICE);
        liveAlphaPaint.setXfermode(new PorterDuffXfermode(PorterDuff.Mode.DST_IN));
        SelfieSegmenterOptions options = new SelfieSegmenterOptions.Builder()
                .setDetectorMode(SelfieSegmenterOptions.STREAM_MODE)
                .enableRawSizeMask()
                .build();
        segmenter = Segmentation.getClient(options);
        cameraThread = new HandlerThread("GrokLiveCamera");
        cameraThread.start();
        cameraHandler = new Handler(cameraThread.getLooper());
        createNotificationChannel();
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        if (intent == null) return START_NOT_STICKY;
        if (ACTION_STOP.equals(intent.getAction())) {
            stopSelf();
            return START_NOT_STICKY;
        }
        if (ACTION_TOGGLE_PAUSE.equals(intent.getAction())) {
            togglePause();
            return START_STICKY;
        }
        if (ACTION_STOP_RECORDING.equals(intent.getAction())) {
            stopRecordingInternal(true);
            return START_STICKY;
        }
        if (!ACTION_START.equals(intent.getAction())) return START_NOT_STICKY;

        startLiveForeground();
        script = safeText(intent.getStringExtra(EXTRA_SCRIPT));
        speed = clamp(intent.getIntExtra(EXTRA_SPEED, 3), 1, 10);
        fontSizeSp = clamp(intent.getIntExtra(EXTRA_FONT_SIZE, 36), 20, 70);

        int resultCode = intent.getIntExtra(EXTRA_RESULT_CODE, 0);
        Intent resultData;
        if (Build.VERSION.SDK_INT >= 33) {
            resultData = intent.getParcelableExtra(EXTRA_RESULT_DATA, Intent.class);
        } else {
            resultData = intent.getParcelableExtra(EXTRA_RESULT_DATA);
        }
        if (resultData == null) {
            toast("Autorisation d’écran manquante");
            stopSelf();
            return START_NOT_STICKY;
        }

        MediaProjectionManager manager = (MediaProjectionManager) getSystemService(MEDIA_PROJECTION_SERVICE);
        mediaProjection = manager.getMediaProjection(resultCode, resultData);
        if (mediaProjection == null) {
            toast("Impossible de démarrer le mode Live");
            stopSelf();
            return START_NOT_STICKY;
        }
        mediaProjection.registerCallback(new MediaProjection.Callback() {
            @Override
            public void onStop() {
                mainHandler.post(() -> stopSelf());
            }
        }, mainHandler);

        createOverlays();
        startCamera();
        scheduleNextSegmentation(0L);
        return START_STICKY;
    }

    @Override
    public void onDestroy() {
        serviceDestroyed = true;
        mainHandler.removeCallbacksAndMessages(null);
        stopRecordingInternal(false);
        closeCamera();
        if (segmenter != null) segmenter.close();
        if (virtualDisplay != null) {
            try { virtualDisplay.release(); } catch (Exception ignored) {}
            virtualDisplay = null;
        }
        if (mediaProjection != null) {
            try { mediaProjection.stop(); } catch (Exception ignored) {}
            mediaProjection = null;
        }
        removeOverlay(cameraRoot);
        removeOverlay(teleRoot);
        removeOverlay(controlsRoot);
        releaseSegmentationBuffers();
        if (cameraThread != null) {
            cameraThread.quitSafely();
            cameraThread = null;
        }
        super.onDestroy();
    }

    @Override
    public IBinder onBind(Intent intent) {
        return null;
    }

    private void createNotificationChannel() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return;
        NotificationManager manager = getSystemService(NotificationManager.class);
        NotificationChannel channel = new NotificationChannel(
                CHANNEL_ID,
                "Grok Téléprompteur Live",
                NotificationManager.IMPORTANCE_LOW
        );
        channel.setDescription("Téléprompteur et caméra flottants pendant le mode Live");
        manager.createNotificationChannel(channel);
    }

    private void startLiveForeground() {
        Notification notification = buildLiveNotification();
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            int types = ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PROJECTION;
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
                types |= ServiceInfo.FOREGROUND_SERVICE_TYPE_CAMERA;
                types |= ServiceInfo.FOREGROUND_SERVICE_TYPE_MICROPHONE;
            }
            startForeground(NOTIFICATION_ID, notification, types);
        } else {
            startForeground(NOTIFICATION_ID, notification);
        }
    }

    private Notification buildLiveNotification() {
        Intent openIntent = new Intent(this, MainActivity.class);
        PendingIntent openPendingIntent = PendingIntent.getActivity(
                this,
                0,
                openIntent,
                PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE
        );
        Notification.Builder builder = new Notification.Builder(this, CHANNEL_ID)
                .setSmallIcon(R.drawable.ic_launcher)
                .setContentTitle("Grok Téléprompteur · Live")
                .setOngoing(true)
                .setOnlyAlertOnce(true)
                .setContentIntent(openPendingIntent);

        if (recording) {
            long nowElapsed = android.os.SystemClock.elapsedRealtime();
            long elapsedMs = recordingClock.elapsedMs(nowElapsed);
            builder.setContentText(paused
                    ? "Pause " + recordingClock.format(nowElapsed) + " · interface visible"
                    : "REC propre · Pause et Stop disponibles")
                    .setWhen(System.currentTimeMillis() - elapsedMs)
                    .setUsesChronometer(!paused);

            Intent pauseIntent = new Intent(this, LiveOverlayService.class)
                    .setAction(ACTION_TOGGLE_PAUSE);
            PendingIntent pausePendingIntent = PendingIntent.getService(
                    this,
                    1,
                    pauseIntent,
                    PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE
            );
            builder.addAction(paused ? android.R.drawable.ic_media_play : android.R.drawable.ic_media_pause,
                    paused ? "Reprendre" : "Pause", pausePendingIntent);

            Intent stopRecordingIntent = new Intent(this, LiveOverlayService.class)
                    .setAction(ACTION_STOP_RECORDING);
            PendingIntent stopRecordingPendingIntent = PendingIntent.getService(
                    this,
                    2,
                    stopRecordingIntent,
                    PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE
            );
            builder.addAction(android.R.drawable.ic_menu_close_clear_cancel,
                    "Stop", stopRecordingPendingIntent);
        } else {
            builder.setContentText("Caméra et téléprompteur flottants prêts");

            Intent closeIntent = new Intent(this, LiveOverlayService.class).setAction(ACTION_STOP);
            PendingIntent closePendingIntent = PendingIntent.getService(
                    this,
                    3,
                    closeIntent,
                    PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE
            );
            builder.addAction(android.R.drawable.ic_menu_close_clear_cancel,
                    "Fermer", closePendingIntent);
        }
        return builder.build();
    }

    private void refreshLiveNotification() {
        NotificationManager manager = getSystemService(NotificationManager.class);
        if (manager != null) manager.notify(NOTIFICATION_ID, buildLiveNotification());
    }

    private void createOverlays() {
        if (cameraRoot != null) return;
        DisplayMetrics metrics = new DisplayMetrics();
        windowManager.getDefaultDisplay().getRealMetrics(metrics);

        cameraParams = baseParams(dp(126), dp(168));
        cameraParams.gravity = Gravity.TOP | Gravity.START;
        cameraParams.x = dp(10);
        cameraParams.y = dp(108);
        cameraRoot = buildCameraWindow();
        windowManager.addView(cameraRoot, cameraParams);

        int teleWidth = Math.min(metrics.widthPixels - dp(28), dp(238));
        teleParams = baseParams(Math.max(dp(170), teleWidth), dp(165));
        teleParams.gravity = Gravity.TOP | Gravity.START;
        teleParams.x = Math.max(dp(8), (metrics.widthPixels - teleParams.width) / 2);
        teleParams.y = Math.max(dp(250), metrics.heightPixels - dp(275));
        teleRoot = buildTeleWindow();
        windowManager.addView(teleRoot, teleParams);

        int controlsWidth = Math.min(metrics.widthPixels - dp(16), dp(220));
        controlsParams = baseParams(Math.max(dp(196), controlsWidth), dp(CONTROLS_READY_HEIGHT_DP));
        controlsParams.gravity = Gravity.TOP | Gravity.START;
        controlsParams.x = Math.max(dp(8), (metrics.widthPixels - controlsParams.width) / 2);
        controlsParams.y = dp(22);
        controlsRoot = buildControlsWindow();
        windowManager.addView(controlsRoot, controlsParams);
        attachControlsMove(statusText);

        updateInteractivity();
        updateControls();
    }

    private WindowManager.LayoutParams baseParams(int width, int height) {
        return new WindowManager.LayoutParams(
                width,
                height,
                Build.VERSION.SDK_INT >= Build.VERSION_CODES.O
                        ? WindowManager.LayoutParams.TYPE_APPLICATION_OVERLAY
                        : WindowManager.LayoutParams.TYPE_PHONE,
                WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE
                        | WindowManager.LayoutParams.FLAG_LAYOUT_IN_SCREEN
                        | WindowManager.LayoutParams.FLAG_LAYOUT_NO_LIMITS,
                PixelFormat.TRANSLUCENT
        );
    }

    private FrameLayout buildCameraWindow() {
        FrameLayout root = new FrameLayout(this);
        root.setClipChildren(false);
        root.setClipToPadding(false);

        cameraTexture = new TextureView(this);
        cameraTexture.setAlpha(0f);
        root.addView(cameraTexture, new FrameLayout.LayoutParams(
                FrameLayout.LayoutParams.MATCH_PARENT,
                FrameLayout.LayoutParams.MATCH_PARENT
        ));

        cameraCutout = new ImageView(this);
        cameraCutout.setScaleType(ImageView.ScaleType.CENTER_CROP);
        root.addView(cameraCutout, new FrameLayout.LayoutParams(
                FrameLayout.LayoutParams.MATCH_PARENT,
                FrameLayout.LayoutParams.MATCH_PARENT
        ));

        cameraMoveHandle = handle("✥ CAM");
        FrameLayout.LayoutParams moveLp = new FrameLayout.LayoutParams(dp(66), dp(30), Gravity.TOP | Gravity.START);
        moveLp.leftMargin = dp(3);
        moveLp.topMargin = dp(3);
        root.addView(cameraMoveHandle, moveLp);
        attachMoveHandle(cameraMoveHandle, root, cameraParams, false);

        cameraResizeHandle = handle("↘");
        cameraResizeHandle.setTextSize(16);
        FrameLayout.LayoutParams resizeLp = new FrameLayout.LayoutParams(dp(52), dp(52), Gravity.BOTTOM | Gravity.END);
        root.addView(cameraResizeHandle, resizeLp);
        attachResizeHandle(cameraResizeHandle, root, cameraParams, dp(80), dp(108));

        GradientDrawable outline = roundedDrawable(0x18000000, 0xCCFFFFFF, dp(15), dp(2));
        root.setBackground(outline);
        attachCameraDirectGesture(root);
        return root;
    }

    private FrameLayout buildTeleWindow() {
        FrameLayout root = new FrameLayout(this);
        root.setClipChildren(true);
        root.setBackground(roundedDrawable(0x44000000, 0xAA60A5FA, dp(18), dp(2)));

        teleText = new TextView(this);
        teleText.setText(script);
        teleText.setTextColor(Color.WHITE);
        teleText.setTextSize(fontSizeSp);
        teleText.setGravity(Gravity.CENTER_HORIZONTAL);
        teleText.setTextAlignment(TextView.TEXT_ALIGNMENT_CENTER);
        teleText.setPadding(dp(14), dp(56), dp(14), dp(80));
        teleText.setShadowLayer(dp(4), 0, dp(2), Color.BLACK);
        teleText.setTypeface(android.graphics.Typeface.DEFAULT_BOLD);
        FrameLayout.LayoutParams textLp = new FrameLayout.LayoutParams(
                FrameLayout.LayoutParams.MATCH_PARENT,
                FrameLayout.LayoutParams.WRAP_CONTENT,
                Gravity.TOP
        );
        root.addView(teleText, textLp);
        attachManualTeleScroll(teleText);

        teleMoveHandle = handle("✥ TÉLÉPROMPTEUR · GLISSE");
        FrameLayout.LayoutParams moveLp = new FrameLayout.LayoutParams(
                FrameLayout.LayoutParams.MATCH_PARENT, dp(34), Gravity.TOP);
        moveLp.leftMargin = dp(4);
        moveLp.rightMargin = dp(4);
        moveLp.topMargin = dp(3);
        root.addView(teleMoveHandle, moveLp);
        attachMoveHandle(teleMoveHandle, root, teleParams, true);

        teleResizeHandle = handle("↘");
        teleResizeHandle.setTextSize(16);
        FrameLayout.LayoutParams resizeLp = new FrameLayout.LayoutParams(dp(52), dp(52), Gravity.BOTTOM | Gravity.END);
        root.addView(teleResizeHandle, resizeLp);
        attachResizeHandle(teleResizeHandle, root, teleParams, dp(150), dp(110));
        return root;
    }

    private LinearLayout buildControlsWindow() {
        LinearLayout root = new LinearLayout(this);
        root.setOrientation(LinearLayout.VERTICAL);
        root.setPadding(dp(7), dp(7), dp(7), dp(7));
        root.setBackground(roundedDrawable(0xEE07111F, 0xAA34D399, dp(18), dp(1)));

        statusText = new TextView(this);
        statusText.setTextColor(Color.WHITE);
        statusText.setTextSize(10);
        statusText.setGravity(Gravity.CENTER);
        statusText.setTypeface(android.graphics.Typeface.DEFAULT_BOLD);
        root.addView(statusText, new LinearLayout.LayoutParams(
                LinearLayout.LayoutParams.MATCH_PARENT,
                dp(24)
        ));

        LinearLayout row1 = row();
        recButton = button("● REC");
        pauseButton = button("Ⅱ Pause");
        stopButton = button("■ Stop");
        Button closeButton = button("× Fermer");
        row1.addView(recButton, weight());
        row1.addView(pauseButton, weight());
        row1.addView(stopButton, weight());
        row1.addView(closeButton, weight());
        root.addView(row1);

        tuningRow = row();
        Button flip = button("⇄ Cam");
        Button camMinus = button("Cam −");
        Button camPlus = button("Cam +");
        Button textMinus = button("Texte −");
        Button textPlus = button("Texte +");
        Button speedMinus = button("Vit −");
        Button speedPlus = button("Vit +");
        for (Button b : Arrays.asList(flip, camMinus, camPlus, textMinus, textPlus, speedMinus, speedPlus)) {
            tuningRow.addView(b, weight());
        }
        root.addView(tuningRow);

        recButton.setOnClickListener(v -> startRecording());
        pauseButton.setOnClickListener(v -> togglePause());
        stopButton.setOnClickListener(v -> stopRecordingInternal(true));
        closeButton.setOnClickListener(v -> stopSelf());
        flip.setOnClickListener(v -> flipCamera());
        camMinus.setOnClickListener(v -> resizeCamera(.90f));
        camPlus.setOnClickListener(v -> resizeCamera(1.10f));
        textMinus.setOnClickListener(v -> changeFont(-2));
        textPlus.setOnClickListener(v -> changeFont(2));
        speedMinus.setOnClickListener(v -> changeSpeed(-1));
        speedPlus.setOnClickListener(v -> changeSpeed(1));
        return root;
    }

    private LinearLayout row() {
        LinearLayout row = new LinearLayout(this);
        row.setOrientation(LinearLayout.HORIZONTAL);
        row.setGravity(Gravity.CENTER);
        row.setPadding(0, dp(2), 0, dp(2));
        return row;
    }

    private LinearLayout.LayoutParams weight() {
        LinearLayout.LayoutParams lp = new LinearLayout.LayoutParams(0, dp(34), 1f);
        lp.setMargins(dp(2), 0, dp(2), 0);
        return lp;
    }

    private Button button(String text) {
        Button button = new Button(this);
        button.setText(text);
        button.setTextSize(8);
        button.setTextColor(Color.WHITE);
        button.setAllCaps(false);
        button.setPadding(dp(3), 0, dp(3), 0);
        button.setBackground(roundedDrawable(0xFF172554, 0x775D7CFA, dp(10), dp(1)));
        return button;
    }

    private TextView handle(String text) {
        TextView view = new TextView(this);
        view.setText(text);
        view.setTextColor(Color.WHITE);
        view.setTextSize(9);
        view.setGravity(Gravity.CENTER);
        view.setTypeface(android.graphics.Typeface.DEFAULT_BOLD);
        view.setBackground(roundedDrawable(0xEE1D4ED8, 0xAAFFFFFF, dp(12), dp(1)));
        return view;
    }

    private GradientDrawable roundedDrawable(int fill, int stroke, int radius, int strokeWidth) {
        GradientDrawable drawable = new GradientDrawable();
        drawable.setColor(fill);
        drawable.setCornerRadius(radius);
        if (strokeWidth > 0) drawable.setStroke(strokeWidth, stroke);
        return drawable;
    }

    private int screenWidth() {
        DisplayMetrics metrics = new DisplayMetrics();
        windowManager.getDefaultDisplay().getRealMetrics(metrics);
        return metrics.widthPixels;
    }

    private int screenHeight() {
        DisplayMetrics metrics = new DisplayMetrics();
        windowManager.getDefaultDisplay().getRealMetrics(metrics);
        return metrics.heightPixels;
    }

    private void moveOverlay(android.view.View root, WindowManager.LayoutParams params,
                             int startX, int startY, int deltaX, int deltaY) {
        int maxX = Math.max(0, screenWidth() - Math.max(1, params.width));
        int maxY = Math.max(0, screenHeight() - Math.max(dp(40), params.height));
        params.x = LiveOverlayGeometry.moved(startX, deltaX, 0, maxX);
        params.y = LiveOverlayGeometry.moved(startY, deltaY, 0, maxY);
        windowManager.updateViewLayout(root, params);
    }

    private void resizeOverlay(android.view.View root, WindowManager.LayoutParams params,
                               int startW, int startH, int deltaW, int deltaH,
                               int minW, int minH) {
        int maxW = Math.max(minW, screenWidth() - dp(8));
        int maxH = Math.max(minH, screenHeight() - dp(70));
        params.width = LiveOverlayGeometry.resized(startW, deltaW, minW, maxW);
        params.height = LiveOverlayGeometry.resized(startH, deltaH, minH, maxH);
        params.x = LiveOverlayGeometry.clamp(params.x, 0, Math.max(0, screenWidth() - params.width));
        params.y = LiveOverlayGeometry.clamp(params.y, 0, Math.max(0, screenHeight() - params.height));
        windowManager.updateViewLayout(root, params);
        if (root == teleRoot) applyTeleOffset();
    }

    private void scaleOverlay(android.view.View root, WindowManager.LayoutParams params,
                              int startW, int startH, float scale, int minW, int minH) {
        int maxW = Math.max(minW, screenWidth() - dp(8));
        int maxH = Math.max(minH, screenHeight() - dp(70));
        params.width = LiveOverlayGeometry.scaled(startW, scale, minW, maxW);
        params.height = LiveOverlayGeometry.scaled(startH, scale, minH, maxH);
        params.x = LiveOverlayGeometry.clamp(params.x, 0, Math.max(0, screenWidth() - params.width));
        params.y = LiveOverlayGeometry.clamp(params.y, 0, Math.max(0, screenHeight() - params.height));
        windowManager.updateViewLayout(root, params);
        if (root == teleRoot) applyTeleOffset();
    }

    private void attachCameraDirectGesture(FrameLayout root) {
        root.setOnTouchListener(new android.view.View.OnTouchListener() {
            float startRawX;
            float startRawY;
            float startDistance;
            int startX;
            int startY;
            int startW;
            int startH;
            boolean scaling;

            @Override
            public boolean onTouch(android.view.View v, MotionEvent event) {
                int action = event.getActionMasked();
                if (action == MotionEvent.ACTION_DOWN) {
                    startRawX = event.getRawX();
                    startRawY = event.getRawY();
                    startX = cameraParams.x;
                    startY = cameraParams.y;
                    startW = cameraParams.width;
                    startH = cameraParams.height;
                    scaling = false;
                    return true;
                }
                if (action == MotionEvent.ACTION_POINTER_DOWN && event.getPointerCount() >= 2) {
                    startDistance = LiveOverlayGeometry.distance(
                            event.getX(0), event.getY(0), event.getX(1), event.getY(1));
                    startW = cameraParams.width;
                    startH = cameraParams.height;
                    scaling = startDistance > 1f;
                    return true;
                }
                if (action == MotionEvent.ACTION_MOVE) {
                    if (event.getPointerCount() >= 2 && scaling && startDistance > 1f) {
                        float current = LiveOverlayGeometry.distance(
                                event.getX(0), event.getY(0), event.getX(1), event.getY(1));
                        scaleOverlay(root, cameraParams, startW, startH,
                                current / startDistance, dp(80), dp(108));
                    } else if (!scaling) {
                        moveOverlay(root, cameraParams, startX, startY,
                                Math.round(event.getRawX() - startRawX),
                                Math.round(event.getRawY() - startRawY));
                    }
                    return true;
                }
                if (action == MotionEvent.ACTION_UP || action == MotionEvent.ACTION_CANCEL) {
                    scaling = false;
                    return true;
                }
                return true;
            }
        });
    }

    private void attachControlsMove(TextView handle) {
        handle.setOnTouchListener(new android.view.View.OnTouchListener() {
            float startRawX;
            float startRawY;
            int startX;
            int startY;

            @Override
            public boolean onTouch(android.view.View v, MotionEvent event) {
                if (event.getActionMasked() == MotionEvent.ACTION_DOWN) {
                    startRawX = event.getRawX();
                    startRawY = event.getRawY();
                    startX = controlsParams.x;
                    startY = controlsParams.y;
                    return true;
                }
                if (event.getActionMasked() == MotionEvent.ACTION_MOVE) {
                    moveOverlay(controlsRoot, controlsParams, startX, startY,
                            Math.round(event.getRawX() - startRawX),
                            Math.round(event.getRawY() - startRawY));
                    return true;
                }
                return true;
            }
        });
    }

    private void attachMoveHandle(TextView handle, FrameLayout root, WindowManager.LayoutParams params, boolean tele) {
        handle.setOnTouchListener(new android.view.View.OnTouchListener() {
            float startRawX;
            float startRawY;
            int startX;
            int startY;

            @Override
            public boolean onTouch(android.view.View v, MotionEvent event) {
                if (event.getActionMasked() == MotionEvent.ACTION_DOWN) {
                    startRawX = event.getRawX();
                    startRawY = event.getRawY();
                    startX = params.x;
                    startY = params.y;
                    return true;
                }
                if (event.getActionMasked() == MotionEvent.ACTION_MOVE) {
                    moveOverlay(root, params, startX, startY,
                            Math.round(event.getRawX() - startRawX),
                            Math.round(event.getRawY() - startRawY));
                    return true;
                }
                return true;
            }
        });
    }

    private void attachResizeHandle(TextView handle, FrameLayout root, WindowManager.LayoutParams params, int minW, int minH) {
        handle.setOnTouchListener(new android.view.View.OnTouchListener() {
            float startRawX;
            float startRawY;
            int startW;
            int startH;

            @Override
            public boolean onTouch(android.view.View v, MotionEvent event) {
                if (event.getActionMasked() == MotionEvent.ACTION_DOWN) {
                    startRawX = event.getRawX();
                    startRawY = event.getRawY();
                    startW = params.width;
                    startH = params.height;
                    return true;
                }
                if (event.getActionMasked() == MotionEvent.ACTION_MOVE) {
                    resizeOverlay(root, params, startW, startH,
                            Math.round(event.getRawX() - startRawX),
                            Math.round(event.getRawY() - startRawY), minW, minH);
                    return true;
                }
                return true;
            }
        });
    }

    private void attachManualTeleScroll(TextView textView) {
        textView.setOnTouchListener(new android.view.View.OnTouchListener() {
            float startY;
            float startOffset;
            float startDistance;
            int startW;
            int startH;
            boolean scaling;

            @Override
            public boolean onTouch(android.view.View v, MotionEvent event) {
                int action = event.getActionMasked();
                if (action == MotionEvent.ACTION_DOWN) {
                    teleGestureActive = true;
                    startY = event.getRawY();
                    startOffset = teleOffset;
                    scaling = false;
                    return true;
                }
                if (action == MotionEvent.ACTION_POINTER_DOWN && event.getPointerCount() >= 2) {
                    startDistance = LiveOverlayGeometry.distance(
                            event.getX(0), event.getY(0), event.getX(1), event.getY(1));
                    startW = teleParams.width;
                    startH = teleParams.height;
                    scaling = startDistance > 1f;
                    return true;
                }
                if (action == MotionEvent.ACTION_MOVE) {
                    if (event.getPointerCount() >= 2 && scaling && startDistance > 1f) {
                        float current = LiveOverlayGeometry.distance(
                                event.getX(0), event.getY(0), event.getX(1), event.getY(1));
                        scaleOverlay(teleRoot, teleParams, startW, startH,
                                current / startDistance, dp(150), dp(110));
                    } else if (!scaling) {
                        teleOffset = Math.max(0f, startOffset - (event.getRawY() - startY));
                        applyTeleOffset();
                    }
                    return true;
                }
                if (action == MotionEvent.ACTION_UP || action == MotionEvent.ACTION_CANCEL) {
                    teleGestureActive = false;
                    scaling = false;
                    return true;
                }
                return true;
            }
        });
    }

    private void applyTeleOffset() {
        if (teleText == null || teleRoot == null) return;
        float max = Math.max(0f, teleText.getHeight() - teleParams.height * .42f);
        teleOffset = Math.min(teleOffset, max);
        teleText.setTranslationY(dp(70) - teleOffset);
    }

    private void changeFont(int delta) {
        fontSizeSp = clamp(fontSizeSp + delta, 20, 70);
        teleText.setTextSize(fontSizeSp);
        teleText.post(this::applyTeleOffset);
    }

    private void changeSpeed(int delta) {
        speed = clamp(speed + delta, 1, 10);
        updateControls();
    }

    private void resizeCamera(float factor) {
        scaleOverlay(cameraRoot, cameraParams, cameraParams.width, cameraParams.height,
                factor, dp(80), dp(108));
    }

    private void updateRecordingChrome() {
        boolean operatorUiVisible = operatorUiVisible();
        float chromeAlpha = operatorUiVisible ? 1f : 0f;
        if (cameraMoveHandle != null) cameraMoveHandle.setAlpha(chromeAlpha);
        if (cameraResizeHandle != null) cameraResizeHandle.setAlpha(chromeAlpha);
        if (teleMoveHandle != null) teleMoveHandle.setAlpha(chromeAlpha);
        if (teleResizeHandle != null) teleResizeHandle.setAlpha(chromeAlpha);

        if (cameraRoot != null) {
            cameraRoot.setBackground(operatorUiVisible
                    ? roundedDrawable(0x18000000, 0xCCFFFFFF, dp(15), dp(2))
                    : null);
        }
        if (teleRoot != null) {
            teleRoot.setVisibility(operatorUiVisible
                    ? android.view.View.VISIBLE
                    : android.view.View.INVISIBLE);
            teleRoot.setBackground(operatorUiVisible
                    ? roundedDrawable(0x44000000, 0xAA60A5FA, dp(18), dp(2))
                    : null);
        }
        if (tuningRow != null) {
            tuningRow.setVisibility(!recording && !recordingStarting
                    ? android.view.View.VISIBLE
                    : android.view.View.GONE);
        }
        if (controlsRoot != null) {
            // Alpha nul conserve deux zones tactiles compactes aux mêmes emplacements
            // (Pause et Stop) sans écrire le moindre pixel dans MediaProjection.
            controlsRoot.setAlpha(operatorUiVisible ? 1f : 0f);
        }
        if (controlsParams != null && controlsRoot != null) {
            int targetHeight = dp(!recording && !recordingStarting
                    ? CONTROLS_READY_HEIGHT_DP
                    : CONTROLS_ACTIVE_HEIGHT_DP);
            if (controlsParams.height != targetHeight) {
                controlsParams.height = targetHeight;
                try { windowManager.updateViewLayout(controlsRoot, controlsParams); }
                catch (Exception ignored) {}
            }
        }
    }

    private boolean operatorUiVisible() {
        return !recordingStarting && !resumePending && (!recording || paused);
    }

    private void updateInteractivity() {
        setTouchable(cameraRoot, cameraParams, true);
        setTouchable(teleRoot, teleParams, operatorUiVisible());
        setTouchable(controlsRoot, controlsParams, true);
    }

    private void setTouchable(android.view.View view, WindowManager.LayoutParams params, boolean touchable) {
        if (view == null || params == null) return;
        if (touchable) params.flags &= ~WindowManager.LayoutParams.FLAG_NOT_TOUCHABLE;
        else params.flags |= WindowManager.LayoutParams.FLAG_NOT_TOUCHABLE;
        try { windowManager.updateViewLayout(view, params); } catch (Exception ignored) {}
    }

    @SuppressLint("MissingPermission")
    private void startCamera() {
        if (checkSelfPermission(Manifest.permission.CAMERA) != PackageManager.PERMISSION_GRANTED) return;
        if (cameraTexture == null) return;
        if (!cameraTexture.isAvailable()) {
            cameraTexture.setSurfaceTextureListener(new TextureView.SurfaceTextureListener() {
                @Override public void onSurfaceTextureAvailable(@NonNull android.graphics.SurfaceTexture surface, int width, int height) { openCamera(); }
                @Override public void onSurfaceTextureSizeChanged(@NonNull android.graphics.SurfaceTexture surface, int width, int height) {}
                @Override public boolean onSurfaceTextureDestroyed(@NonNull android.graphics.SurfaceTexture surface) { return true; }
                @Override public void onSurfaceTextureUpdated(@NonNull android.graphics.SurfaceTexture surface) {}
            });
        } else {
            openCamera();
        }
    }

    @SuppressLint("MissingPermission")
    private void openCamera() {
        closeCameraDeviceOnly();
        try {
            CameraManager manager = (CameraManager) getSystemService(CAMERA_SERVICE);
            String selected = null;
            CameraCharacteristics selectedCharacteristics = null;
            for (String id : manager.getCameraIdList()) {
                CameraCharacteristics characteristics = manager.getCameraCharacteristics(id);
                Integer facing = characteristics.get(CameraCharacteristics.LENS_FACING);
                if (facing != null && facing == cameraFacing) {
                    selected = id;
                    selectedCharacteristics = characteristics;
                    break;
                }
            }
            if (selected == null && manager.getCameraIdList().length > 0) {
                selected = manager.getCameraIdList()[0];
                selectedCharacteristics = manager.getCameraCharacteristics(selected);
            }
            if (selected == null) return;
            activeCameraCharacteristics = selectedCharacteristics;
            manager.openCamera(selected, new CameraDevice.StateCallback() {
                @Override
                public void onOpened(@NonNull CameraDevice camera) {
                    if (serviceDestroyed) {
                        camera.close();
                        return;
                    }
                    cameraDevice = camera;
                    createCameraSession();
                }

                @Override
                public void onDisconnected(@NonNull CameraDevice camera) {
                    camera.close();
                    if (cameraDevice == camera) cameraDevice = null;
                }

                @Override
                public void onError(@NonNull CameraDevice camera, int error) {
                    camera.close();
                    if (cameraDevice == camera) cameraDevice = null;
                }
            }, cameraHandler);
        } catch (Exception error) {
            toast("Caméra Live indisponible");
        }
    }

    private void createCameraSession() {
        if (cameraDevice == null || cameraTexture == null || !cameraTexture.isAvailable()) return;
        try {
            android.graphics.SurfaceTexture texture = cameraTexture.getSurfaceTexture();
            if (texture == null) return;
            texture.setDefaultBufferSize(640, 480);
            if (cameraPreviewSurface != null) {
                try { cameraPreviewSurface.release(); } catch (Exception ignored) {}
            }
            Surface surface = new Surface(texture);
            cameraPreviewSurface = surface;
            CaptureRequest.Builder builder = cameraDevice.createCaptureRequest(CameraDevice.TEMPLATE_PREVIEW);
            builder.addTarget(surface);
            builder.set(CaptureRequest.CONTROL_AF_MODE, CaptureRequest.CONTROL_AF_MODE_CONTINUOUS_VIDEO);
            builder.set(CaptureRequest.CONTROL_AE_MODE, CaptureRequest.CONTROL_AE_MODE_ON);
            builder.set(CaptureRequest.CONTROL_AWB_MODE, CaptureRequest.CONTROL_AWB_MODE_AUTO);
            Range<Integer> stableFps = selectStableCameraFps(activeCameraCharacteristics);
            if (stableFps != null) {
                builder.set(CaptureRequest.CONTROL_AE_TARGET_FPS_RANGE, stableFps);
            }
            if (supportsMode(activeCameraCharacteristics,
                    CameraCharacteristics.CONTROL_AVAILABLE_VIDEO_STABILIZATION_MODES,
                    CaptureRequest.CONTROL_VIDEO_STABILIZATION_MODE_ON)) {
                builder.set(CaptureRequest.CONTROL_VIDEO_STABILIZATION_MODE,
                        CaptureRequest.CONTROL_VIDEO_STABILIZATION_MODE_ON);
            }
            cameraDevice.createCaptureSession(Arrays.asList(surface), new CameraCaptureSession.StateCallback() {
                @Override
                public void onConfigured(@NonNull CameraCaptureSession session) {
                    if (serviceDestroyed || cameraDevice == null) {
                        session.close();
                        return;
                    }
                    cameraSession = session;
                    try { session.setRepeatingRequest(builder.build(), null, cameraHandler); }
                    catch (Exception ignored) {}
                }

                @Override
                public void onConfigureFailed(@NonNull CameraCaptureSession session) {}
            }, cameraHandler);
        } catch (Exception ignored) {}
    }

    private void flipCamera() {
        cameraFacing = cameraFacing == CameraCharacteristics.LENS_FACING_FRONT
                ? CameraCharacteristics.LENS_FACING_BACK
                : CameraCharacteristics.LENS_FACING_FRONT;
        if (cameraCutout != null) cameraCutout.setScaleX(cameraFacing == CameraCharacteristics.LENS_FACING_FRONT ? -1f : 1f);
        liveMaskHasHistory = false;
        openCamera();
    }

    private Range<Integer> selectStableCameraFps(CameraCharacteristics characteristics) {
        if (characteristics == null) return null;
        Range<Integer>[] ranges = characteristics.get(
                CameraCharacteristics.CONTROL_AE_AVAILABLE_TARGET_FPS_RANGES);
        if (ranges == null || ranges.length == 0) return null;
        Range<Integer> best = ranges[0];
        int bestScore = Integer.MIN_VALUE;
        for (Range<Integer> range : ranges) {
            int upper = range.getUpper();
            int lower = range.getLower();
            int score = (upper >= 30 ? 10_000 : 0)
                    - Math.abs(upper - 30) * 100
                    - Math.abs(lower - 24) * 4;
            if (lower == 30 && upper == 30) score += 300;
            if (score > bestScore) {
                bestScore = score;
                best = range;
            }
        }
        return best;
    }

    private boolean supportsMode(CameraCharacteristics characteristics,
                                 CameraCharacteristics.Key<int[]> key, int requested) {
        if (characteristics == null) return false;
        int[] modes = characteristics.get(key);
        if (modes == null) return false;
        for (int mode : modes) if (mode == requested) return true;
        return false;
    }

    private void closeCameraDeviceOnly() {
        if (cameraSession != null) {
            try { cameraSession.close(); } catch (Exception ignored) {}
            cameraSession = null;
        }
        if (cameraDevice != null) {
            try { cameraDevice.close(); } catch (Exception ignored) {}
            cameraDevice = null;
        }
        if (cameraPreviewSurface != null) {
            try { cameraPreviewSurface.release(); } catch (Exception ignored) {}
            cameraPreviewSurface = null;
        }
    }

    private void closeCamera() {
        closeCameraDeviceOnly();
    }

    private void renderMask(Bitmap source, SegmentationMask mask) {
        if (serviceDestroyed) {
            if (!source.isRecycled()) source.recycle();
            return;
        }
        try {
            int mw = mask.getWidth();
            int mh = mask.getHeight();
            ensureSegmentationBuffers(mw, mh, source.getWidth(), source.getHeight());
            ByteBuffer bytes = mask.getBuffer();
            bytes.rewind();
            FloatBuffer buffer = bytes.order(ByteOrder.nativeOrder()).asFloatBuffer();
            int count = mw * mh;
            for (int i = 0; i < count && buffer.hasRemaining(); i++) {
                float value = clamp01(buffer.get());
                if (liveMaskHasHistory) {
                    float history = liveMaskHistory[i];
                    float difference = Math.abs(value - history);
                    float historyWeight;
                    if (difference < .04f) historyWeight = .24f;
                    else if (difference < .10f) historyWeight = .14f;
                    else if (difference < .20f) historyWeight = .05f;
                    else historyWeight = .008f;
                    // Une disparition doit rester rapide pour ne pas laisser de silhouette fantôme.
                    if (value < history && difference > .08f) historyWeight *= .42f;
                    value = value * (1f - historyWeight) + history * historyWeight;
                }
                liveMaskValues[i] = value;
                liveMaskHistory[i] = value;
            }
            liveMaskHasHistory = true;
            blurMask(liveMaskValues, liveMaskHorizontal, liveMaskBlurred, mw, mh);

            for (int i = 0; i < count; i++) {
                float value = liveMaskValues[i];
                float sharp = clamp01(value + .58f * (value - liveMaskBlurred[i]));
                float edge = clamp01((sharp - .34f) / .29f);
                float alpha = edge * edge * (3f - 2f * edge);
                if (alpha <= .025f) alpha = 0f;
                else if (alpha >= .975f) alpha = 1f;
                int alphaByte = Math.round(alpha * 255f);
                liveAlphaPixels[i] = (alphaByte << 24) | 0x00FFFFFF;
            }

            liveMaskBitmap.setPixels(liveAlphaPixels, 0, mw, 0, 0, mw, mh);
            liveCutoutCanvas.drawColor(Color.TRANSPARENT, PorterDuff.Mode.CLEAR);
            liveTargetRect.set(0, 0, liveCutoutBitmap.getWidth(), liveCutoutBitmap.getHeight());
            liveCutoutCanvas.drawBitmap(source, null, liveTargetRect, liveSourcePaint);
            liveCutoutCanvas.drawBitmap(liveMaskBitmap, null, liveTargetRect, liveAlphaPaint);
            if (cameraCutout.getTag() != liveCutoutBitmap) {
                cameraCutout.setImageBitmap(liveCutoutBitmap);
                cameraCutout.setTag(liveCutoutBitmap);
            } else {
                cameraCutout.invalidate();
            }
        } catch (Exception error) {
            // Conserver la dernière silhouette valable si une seule trame échoue.
        } finally {
            if (!source.isRecycled()) source.recycle();
        }
    }

    private void ensureSegmentationBuffers(int maskWidth, int maskHeight,
                                           int outputWidth, int outputHeight) {
        int count = maskWidth * maskHeight;
        if (liveAlphaPixels == null || liveAlphaPixels.length != count) {
            liveAlphaPixels = new int[count];
            liveMaskValues = new float[count];
            liveMaskHistory = new float[count];
            liveMaskHorizontal = new float[count];
            liveMaskBlurred = new float[count];
            liveMaskHasHistory = false;
            if (liveMaskBitmap != null && !liveMaskBitmap.isRecycled()) liveMaskBitmap.recycle();
            liveMaskBitmap = Bitmap.createBitmap(maskWidth, maskHeight, Bitmap.Config.ARGB_8888);
        }
        if (liveCutoutBitmap == null || liveCutoutBitmap.isRecycled()
                || liveCutoutBitmap.getWidth() != outputWidth
                || liveCutoutBitmap.getHeight() != outputHeight) {
            if (liveCutoutBitmap != null && !liveCutoutBitmap.isRecycled()) liveCutoutBitmap.recycle();
            liveCutoutBitmap = Bitmap.createBitmap(outputWidth, outputHeight, Bitmap.Config.ARGB_8888);
            liveCutoutCanvas = new Canvas(liveCutoutBitmap);
            if (cameraCutout != null) cameraCutout.setTag(null);
        }
    }

    private void blurMask(float[] source, float[] horizontal, float[] output,
                          int width, int height) {
        for (int y = 0; y < height; y++) {
            int row = y * width;
            for (int x = 0; x < width; x++) {
                horizontal[row + x] = (source[row + Math.max(0, x - 1)]
                        + 2f * source[row + x]
                        + source[row + Math.min(width - 1, x + 1)]) * .25f;
            }
        }
        for (int y = 0; y < height; y++) {
            int previous = Math.max(0, y - 1) * width;
            int row = y * width;
            int next = Math.min(height - 1, y + 1) * width;
            for (int x = 0; x < width; x++) {
                output[row + x] = (horizontal[previous + x]
                        + 2f * horizontal[row + x]
                        + horizontal[next + x]) * .25f;
            }
        }
    }

    private void scheduleNextSegmentation(long delayMs) {
        mainHandler.removeCallbacks(segmentationLoop);
        if (!serviceDestroyed && segmenter != null) {
            mainHandler.postDelayed(segmentationLoop, Math.max(0L, delayMs));
        }
    }

    private void releaseSegmentationBuffers() {
        if (cameraCutout != null) {
            cameraCutout.setImageDrawable(null);
            cameraCutout.setTag(null);
        }
        if (liveMaskBitmap != null && !liveMaskBitmap.isRecycled()) liveMaskBitmap.recycle();
        if (liveCutoutBitmap != null && !liveCutoutBitmap.isRecycled()) liveCutoutBitmap.recycle();
        liveMaskBitmap = null;
        liveCutoutBitmap = null;
        liveCutoutCanvas = null;
        liveAlphaPixels = null;
        liveMaskValues = null;
        liveMaskHistory = null;
        liveMaskHorizontal = null;
        liveMaskBlurred = null;
        liveMaskHasHistory = false;
    }

    private float clamp01(float value) {
        return Math.max(0f, Math.min(1f, value));
    }

    private void startRecording() {
        if (recording || recordingStarting || mediaProjection == null) return;
        if (checkSelfPermission(Manifest.permission.RECORD_AUDIO) != PackageManager.PERMISSION_GRANTED) {
            toast("Autorise le microphone dans l’application");
            return;
        }
        recordingStarting = true;
        updateInteractivity();
        updateControls();
        // Laisser SurfaceFlinger composer au moins plusieurs trames sans interface
        // avant de connecter l'encodeur. Cela évite tout flash de commandes au début.
        mainHandler.postDelayed(this::startRecordingAfterUiSettled, CAPTURE_UI_SETTLE_DELAY_MS);
    }

    private void startRecordingAfterUiSettled() {
        if (!recordingStarting || serviceDestroyed || mediaProjection == null) return;
        try {
            prepareOutput();
            DisplayMetrics metrics = new DisplayMetrics();
            windowManager.getDefaultDisplay().getRealMetrics(metrics);
            int width = even(metrics.widthPixels);
            int height = even(metrics.heightPixels);
            int density = metrics.densityDpi;

            mediaRecorder = Build.VERSION.SDK_INT >= Build.VERSION_CODES.S
                    ? new MediaRecorder(this)
                    : new MediaRecorder();
            mediaRecorder.setAudioSource(MediaRecorder.AudioSource.CAMCORDER);
            mediaRecorder.setVideoSource(MediaRecorder.VideoSource.SURFACE);
            mediaRecorder.setOutputFormat(MediaRecorder.OutputFormat.MPEG_4);
            mediaRecorder.setOutputFile(outputDescriptor.getFileDescriptor());
            mediaRecorder.setVideoEncoder(MediaRecorder.VideoEncoder.H264);
            mediaRecorder.setVideoSize(width, height);
            mediaRecorder.setVideoFrameRate(30);
            int videoBitRate = Math.min(20_000_000,
                    Math.max(12_000_000, width * height * 5));
            mediaRecorder.setVideoEncodingBitRate(videoBitRate);
            mediaRecorder.setAudioEncoder(MediaRecorder.AudioEncoder.AAC);
            mediaRecorder.setAudioSamplingRate(48_000);
            mediaRecorder.setAudioEncodingBitRate(192_000);
            mediaRecorder.setAudioChannels(1);
            preferBuiltInMicrophone(mediaRecorder);
            mediaRecorder.prepare();

            Surface recorderSurface = mediaRecorder.getSurface();
            if (virtualDisplay == null) {
                virtualDisplay = mediaProjection.createVirtualDisplay(
                        "GrokLiveScreen",
                        width,
                        height,
                        density,
                        android.hardware.display.DisplayManager.VIRTUAL_DISPLAY_FLAG_AUTO_MIRROR,
                        recorderSurface,
                        null,
                        mainHandler
                );
            } else {
                virtualDisplay.setSurface(recorderSurface);
            }
            mediaRecorder.start();
            recordingStarting = false;
            recording = true;
            paused = false;
            recordingClock.start(android.os.SystemClock.elapsedRealtime());
            segmentationFrozen = false;
            scheduleNextSegmentation(0L);
            teleOffset = 0f;
            teleLastFrame = 0L;
            applyTeleOffset();
            mainHandler.removeCallbacks(teleScrollLoop);
            mainHandler.post(teleScrollLoop);
            mainHandler.removeCallbacks(recordingTimerLoop);
            mainHandler.post(recordingTimerLoop);
            updateInteractivity();
            updateControls();
            refreshLiveNotification();
        } catch (Exception error) {
            recordingStarting = false;
            cleanupRecorderFailure();
            toast("Impossible de lancer l’enregistrement Live");
        }
    }

    private void togglePause() {
        if (!recording || mediaRecorder == null || resumePending) return;
        try {
            if (!paused) {
                mediaRecorder.pause();
                paused = true;
                recordingClock.pause(android.os.SystemClock.elapsedRealtime());
                segmentationFrozen = true;
                mainHandler.removeCallbacks(teleScrollLoop);
                scheduleNextSegmentation(120L);
                updateInteractivity();
                updateControls();
                refreshLiveNotification();
            } else {
                resumePending = true;
                updateInteractivity();
                updateControls();
                // Masquer d'abord téléprompteur et commandes, puis reprendre l'encodeur.
                mainHandler.postDelayed(this::resumeRecordingAfterUiSettled,
                        CAPTURE_UI_SETTLE_DELAY_MS);
            }
        } catch (Exception error) {
            resumePending = false;
            updateInteractivity();
            updateControls();
            toast("Pause Live indisponible sur ce téléphone");
        }
    }

    private void resumeRecordingAfterUiSettled() {
        if (!resumePending || !recording || !paused || mediaRecorder == null || serviceDestroyed) return;
        try {
            mediaRecorder.resume();
            resumePending = false;
            paused = false;
            recordingClock.resume(android.os.SystemClock.elapsedRealtime());
            segmentationFrozen = false;
            teleLastFrame = 0L;
            mainHandler.post(teleScrollLoop);
            scheduleNextSegmentation(0L);
            updateInteractivity();
            updateControls();
            refreshLiveNotification();
        } catch (Exception error) {
            resumePending = false;
            updateInteractivity();
            updateControls();
            toast("Reprise Live indisponible sur ce téléphone");
        }
    }

    private void stopRecordingInternal(boolean notify) {
        if (!recording && !recordingStarting && mediaRecorder == null) return;
        mainHandler.removeCallbacks(teleScrollLoop);
        mainHandler.removeCallbacks(recordingTimerLoop);
        recordingStarting = false;
        resumePending = false;
        recording = false;
        paused = false;
        recordingClock.reset();
        segmentationFrozen = false;
        boolean success = false;
        if (mediaRecorder != null) {
            try {
                mediaRecorder.stop();
                success = true;
            } catch (Exception ignored) {}
            try { mediaRecorder.reset(); } catch (Exception ignored) {}
            try { mediaRecorder.release(); } catch (Exception ignored) {}
            mediaRecorder = null;
        }
        if (virtualDisplay != null) {
            try { virtualDisplay.setSurface(null); } catch (Exception ignored) {}
        }
        finishOutput(success);
        updateInteractivity();
        updateControls();
        refreshLiveNotification();
        if (notify && success) toast("Vidéo Live enregistrée dans Films/Grok Téléprompteur Live");
    }

    private void prepareOutput() throws Exception {
        String stamp = new SimpleDateFormat("yyyyMMdd_HHmmss", Locale.FRANCE).format(new Date());
        ContentValues values = new ContentValues();
        values.put(MediaStore.Video.Media.DISPLAY_NAME, "Grok_Live_" + stamp + ".mp4");
        values.put(MediaStore.Video.Media.MIME_TYPE, "video/mp4");
        values.put(MediaStore.Video.Media.RELATIVE_PATH, Environment.DIRECTORY_MOVIES + "/Grok Téléprompteur Live");
        values.put(MediaStore.Video.Media.IS_PENDING, 1);
        outputUri = getContentResolver().insert(MediaStore.Video.Media.EXTERNAL_CONTENT_URI, values);
        if (outputUri == null) throw new IllegalStateException("MediaStore indisponible");
        outputDescriptor = getContentResolver().openFileDescriptor(outputUri, "w");
        if (outputDescriptor == null) throw new IllegalStateException("Fichier indisponible");
    }

    private void finishOutput(boolean success) {
        if (outputDescriptor != null) {
            try { outputDescriptor.close(); } catch (Exception ignored) {}
            outputDescriptor = null;
        }
        if (outputUri != null) {
            try {
                if (success) {
                    ContentValues done = new ContentValues();
                    done.put(MediaStore.Video.Media.IS_PENDING, 0);
                    getContentResolver().update(outputUri, done, null, null);
                } else {
                    getContentResolver().delete(outputUri, null, null);
                }
            } catch (Exception ignored) {}
            outputUri = null;
        }
    }

    private void cleanupRecorderFailure() {
        mainHandler.removeCallbacks(recordingTimerLoop);
        recordingStarting = false;
        resumePending = false;
        recording = false;
        paused = false;
        recordingClock.reset();
        if (mediaRecorder != null) {
            try { mediaRecorder.reset(); } catch (Exception ignored) {}
            try { mediaRecorder.release(); } catch (Exception ignored) {}
            mediaRecorder = null;
        }
        finishOutput(false);
        updateInteractivity();
        updateControls();
        refreshLiveNotification();
    }

    private void preferBuiltInMicrophone(MediaRecorder recorder) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.P) return;
        try {
            AudioManager manager = (AudioManager) getSystemService(AUDIO_SERVICE);
            for (AudioDeviceInfo device : manager.getDevices(AudioManager.GET_DEVICES_INPUTS)) {
                if (device.getType() == AudioDeviceInfo.TYPE_BUILTIN_MIC) {
                    recorder.setPreferredDevice(device);
                    return;
                }
            }
        } catch (Exception ignored) {}
    }

    private void updateControls() {
        if (recButton == null) return;
        recButton.setEnabled(!recording && !recordingStarting);
        pauseButton.setEnabled(recording && !resumePending);
        stopButton.setEnabled(recording);
        pauseButton.setText(resumePending ? "… Reprise" : (paused ? "▶ Repr." : "Ⅱ Pause"));
        if (recordingStarting) {
            statusText.setText("Préparation de la capture propre…");
        } else if (!recording) {
            statusText.setText("✥ PRÊT · REC propre · V" + speed);
        } else {
            String elapsed = recordingClock.format(android.os.SystemClock.elapsedRealtime());
            if (resumePending) statusText.setText("Reprise propre…");
            else if (paused) statusText.setText("Ⅱ PAUSE " + elapsed + " · interface visible");
            else statusText.setText("● REC " + elapsed + " · interface masquée");
        }
        updateRecordingChrome();
    }

    private void removeOverlay(android.view.View view) {
        if (view == null || windowManager == null) return;
        try { windowManager.removeView(view); } catch (Exception ignored) {}
    }

    private int dp(int value) {
        return Math.round(value * getResources().getDisplayMetrics().density);
    }

    private int even(int value) {
        return value % 2 == 0 ? value : value - 1;
    }

    private int clamp(int value, int min, int max) {
        return Math.max(min, Math.min(max, value));
    }

    private String safeText(String value) {
        String trimmed = value == null ? "" : value.trim();
        return trimmed.isEmpty() ? "Bienvenue dans Grok Téléprompteur Live." : trimmed;
    }

    private void toast(String message) {
        mainHandler.post(() -> Toast.makeText(this, message, Toast.LENGTH_LONG).show());
    }
}
