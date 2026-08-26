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
import android.graphics.RectF;
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
import android.text.Layout;
import android.text.StaticLayout;
import android.text.TextPaint;
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
import java.util.ArrayList;
import java.util.Arrays;
import java.util.Date;
import java.util.List;
import java.util.Locale;

public final class LiveOverlayService extends Service {
    public static final String ACTION_START = "com.chasmet.grokteleprompter.LIVE_START";
    public static final String ACTION_STOP = "com.chasmet.grokteleprompter.LIVE_STOP";
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

    private WindowManager windowManager;
    private WindowManager.LayoutParams cameraParams;
    private WindowManager.LayoutParams teleParams;
    private WindowManager.LayoutParams controlsParams;
    private FrameLayout cameraRoot;
    private FrameLayout teleRoot;
    private FrameLayout controlsRoot;
    private PrivateOverlaySurface telePrivateSurface;
    private PrivateOverlaySurface controlsPrivateSurface;
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
    private final List<Button> controlButtons = new ArrayList<>();

    private final Paint privatePaint = new Paint(Paint.ANTI_ALIAS_FLAG | Paint.SUBPIXEL_TEXT_FLAG);
    private final TextPaint telePaint = new TextPaint(Paint.ANTI_ALIAS_FLAG | Paint.SUBPIXEL_TEXT_FLAG);
    private StaticLayout teleLayout;
    private int teleLayoutWidth = -1;
    private int teleLayoutFontSize = -1;

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
        if (telePrivateSurface != null) telePrivateSurface.releaseRenderer();
        if (controlsPrivateSurface != null) controlsPrivateSurface.releaseRenderer();
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
        Intent openIntent = new Intent(this, MainActivity.class);
        PendingIntent pendingIntent = PendingIntent.getActivity(
                this,
                0,
                openIntent,
                PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE
        );
        Notification notification = new Notification.Builder(this, CHANNEL_ID)
                .setSmallIcon(R.drawable.ic_launcher)
                .setContentTitle("Grok Téléprompteur · Live")
                .setContentText("Caméra et téléprompteur flottants actifs")
                .setOngoing(true)
                .setContentIntent(pendingIntent)
                .build();
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

        int controlsWidth = Math.min(metrics.widthPixels - dp(16), dp(248));
        controlsParams = baseParams(Math.max(dp(210), controlsWidth), WindowManager.LayoutParams.WRAP_CONTENT);
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
        root.setBackground(null);

        telePrivateSurface = new PrivateOverlaySurface(this, this::drawPrivateTeleprompter);
        root.addView(telePrivateSurface, new FrameLayout.LayoutParams(
                FrameLayout.LayoutParams.MATCH_PARENT,
                FrameLayout.LayoutParams.MATCH_PARENT
        ));

        teleText = new TextView(this);
        teleText.setText(script);
        teleText.setTextColor(Color.WHITE);
        teleText.setTextSize(fontSizeSp);
        teleText.setGravity(Gravity.CENTER_HORIZONTAL);
        teleText.setTextAlignment(TextView.TEXT_ALIGNMENT_CENTER);
        teleText.setPadding(dp(14), dp(56), dp(14), dp(80));
        teleText.setShadowLayer(dp(4), 0, dp(2), Color.BLACK);
        teleText.setTypeface(android.graphics.Typeface.DEFAULT_BOLD);
        teleText.setAlpha(0f);
        FrameLayout.LayoutParams textLp = new FrameLayout.LayoutParams(
                FrameLayout.LayoutParams.MATCH_PARENT,
                FrameLayout.LayoutParams.WRAP_CONTENT,
                Gravity.TOP
        );
        root.addView(teleText, textLp);
        attachManualTeleScroll(teleText);

        teleMoveHandle = handle("✥ TÉLÉPROMPTEUR · GLISSE");
        teleMoveHandle.setAlpha(0f);
        FrameLayout.LayoutParams moveLp = new FrameLayout.LayoutParams(
                FrameLayout.LayoutParams.MATCH_PARENT, dp(34), Gravity.TOP);
        moveLp.leftMargin = dp(4);
        moveLp.rightMargin = dp(4);
        moveLp.topMargin = dp(3);
        root.addView(teleMoveHandle, moveLp);
        attachMoveHandle(teleMoveHandle, root, teleParams, true);

        teleResizeHandle = handle("↘");
        teleResizeHandle.setTextSize(16);
        teleResizeHandle.setAlpha(0f);
        FrameLayout.LayoutParams resizeLp = new FrameLayout.LayoutParams(dp(52), dp(52), Gravity.BOTTOM | Gravity.END);
        root.addView(teleResizeHandle, resizeLp);
        attachResizeHandle(teleResizeHandle, root, teleParams, dp(150), dp(110));
        root.addOnLayoutChangeListener((view, left, top, right, bottom,
                                        oldLeft, oldTop, oldRight, oldBottom) -> {
            if (right - left != oldRight - oldLeft) invalidateTeleLayout();
            requestPrivateTeleRender();
        });
        return root;
    }

    private FrameLayout buildControlsWindow() {
        FrameLayout root = new FrameLayout(this);
        root.setBackground(null);

        controlsPrivateSurface = new PrivateOverlaySurface(this, this::drawPrivateControls);
        root.addView(controlsPrivateSurface, new FrameLayout.LayoutParams(
                FrameLayout.LayoutParams.MATCH_PARENT,
                FrameLayout.LayoutParams.MATCH_PARENT
        ));

        LinearLayout content = new LinearLayout(this);
        content.setOrientation(LinearLayout.VERTICAL);
        content.setPadding(dp(7), dp(7), dp(7), dp(7));
        content.setAlpha(0f);
        root.addView(content, new FrameLayout.LayoutParams(
                FrameLayout.LayoutParams.MATCH_PARENT,
                FrameLayout.LayoutParams.WRAP_CONTENT,
                Gravity.TOP
        ));

        statusText = new TextView(this);
        statusText.setTextColor(Color.WHITE);
        statusText.setTextSize(12);
        statusText.setGravity(Gravity.CENTER);
        statusText.setTypeface(android.graphics.Typeface.DEFAULT_BOLD);
        content.addView(statusText, new LinearLayout.LayoutParams(
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
        content.addView(row1);

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
        content.addView(tuningRow);

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
        root.addOnLayoutChangeListener((view, left, top, right, bottom,
                                        oldLeft, oldTop, oldRight, oldBottom) -> requestPrivateControlsRender());
        return root;
    }

    private void drawPrivateTeleprompter(Canvas canvas, int width, int height) {
        RectF panel = new RectF(0f, 0f, width, height);
        if (recording) {
            drawRoundedPanel(canvas, panel, dp(18), 0x33000000, Color.TRANSPARENT, 0f);
        } else {
            drawRoundedPanel(canvas, panel, dp(18), 0x44000000, 0xAA60A5FA, dp(2));
        }

        int contentWidth = Math.max(1, width - dp(28));
        StaticLayout layout = ensureTeleLayout(contentWidth);
        if (layout != null) {
            canvas.save();
            canvas.clipRect(0, 0, width, height);
            canvas.translate(dp(14), dp(126) - teleOffset);
            layout.draw(canvas);
            canvas.restore();
        }

        if (!recording) {
            RectF move = new RectF(dp(4), dp(3), width - dp(4), dp(37));
            drawRoundedPanel(canvas, move, dp(12), 0xEE1D4ED8, 0xAAFFFFFF, dp(1));
            drawCenteredText(canvas, "✥ TÉLÉPROMPTEUR · GLISSE", move,
                    sp(9), Color.WHITE, true);

            RectF resize = new RectF(width - dp(52), height - dp(52), width, height);
            drawRoundedPanel(canvas, resize, dp(12), 0xEE1D4ED8, 0xAAFFFFFF, dp(1));
            drawCenteredText(canvas, "↘", resize, sp(16), Color.WHITE, true);
        }
    }

    private void drawPrivateControls(Canvas canvas, int width, int height) {
        drawRoundedPanel(canvas, new RectF(0f, 0f, width, height), dp(18),
                0xEE07111F, 0xAA34D399, dp(1));

        Rect statusBounds = descendantBounds(statusText);
        if (statusBounds != null) {
            drawCenteredText(canvas, String.valueOf(statusText.getText()),
                    new RectF(statusBounds), sp(12), Color.WHITE, true);
        }

        for (Button button : controlButtons) {
            if (!button.isShown()) continue;
            Rect bounds = descendantBounds(button);
            if (bounds == null || bounds.width() <= 0 || bounds.height() <= 0) continue;
            RectF rect = new RectF(bounds);
            int fill = button.isEnabled() ? 0xFF172554 : 0x99172554;
            int stroke = button.isEnabled() ? 0x775D7CFA : 0x335D7CFA;
            int textColor = button.isEnabled() ? Color.WHITE : 0x99FFFFFF;
            drawRoundedPanel(canvas, rect, dp(10), fill, stroke, dp(1));
            drawCenteredText(canvas, String.valueOf(button.getText()), rect,
                    sp(8), textColor, false);
        }
    }

    private Rect descendantBounds(android.view.View descendant) {
        if (controlsRoot == null || descendant == null || !descendant.isShown()) return null;
        Rect rect = new Rect(0, 0, descendant.getWidth(), descendant.getHeight());
        try {
            controlsRoot.offsetDescendantRectToMyCoords(descendant, rect);
            return rect;
        } catch (IllegalArgumentException ignored) {
            return null;
        }
    }

    private void drawRoundedPanel(Canvas canvas, RectF rect, float radius,
                                  int fillColor, int strokeColor, float strokeWidth) {
        privatePaint.setStyle(Paint.Style.FILL);
        privatePaint.setColor(fillColor);
        privatePaint.clearShadowLayer();
        canvas.drawRoundRect(rect, radius, radius, privatePaint);
        if (strokeWidth > 0f && Color.alpha(strokeColor) > 0) {
            privatePaint.setStyle(Paint.Style.STROKE);
            privatePaint.setStrokeWidth(strokeWidth);
            privatePaint.setColor(strokeColor);
            float inset = strokeWidth * .5f;
            RectF inner = new RectF(rect.left + inset, rect.top + inset,
                    rect.right - inset, rect.bottom - inset);
            canvas.drawRoundRect(inner, Math.max(0f, radius - inset),
                    Math.max(0f, radius - inset), privatePaint);
        }
    }

    private void drawCenteredText(Canvas canvas, String value, RectF bounds,
                                  float textSizePx, int color, boolean bold) {
        privatePaint.setStyle(Paint.Style.FILL);
        privatePaint.setColor(color);
        privatePaint.setTextSize(textSizePx);
        privatePaint.setTextAlign(Paint.Align.CENTER);
        privatePaint.setTypeface(bold
                ? android.graphics.Typeface.DEFAULT_BOLD
                : android.graphics.Typeface.DEFAULT);
        privatePaint.setShadowLayer(dp(2), 0f, dp(1), 0xCC000000);
        Paint.FontMetrics metrics = privatePaint.getFontMetrics();
        float baseline = bounds.centerY() - (metrics.ascent + metrics.descent) * .5f;
        canvas.drawText(value, bounds.centerX(), baseline, privatePaint);
        privatePaint.clearShadowLayer();
    }

    private StaticLayout ensureTeleLayout(int width) {
        width = Math.max(1, width);
        if (teleLayout != null && teleLayoutWidth == width
                && teleLayoutFontSize == fontSizeSp) return teleLayout;
        telePaint.setColor(Color.WHITE);
        telePaint.setTextSize(sp(fontSizeSp));
        telePaint.setTypeface(android.graphics.Typeface.DEFAULT_BOLD);
        telePaint.setShadowLayer(dp(4), 0f, dp(2), Color.BLACK);
        teleLayout = StaticLayout.Builder.obtain(script, 0, script.length(), telePaint, width)
                .setAlignment(Layout.Alignment.ALIGN_CENTER)
                .setIncludePad(true)
                .setLineSpacing(dp(2), 1.02f)
                .setBreakStrategy(Layout.BREAK_STRATEGY_BALANCED)
                .setHyphenationFrequency(Layout.HYPHENATION_FREQUENCY_NONE)
                .build();
        teleLayoutWidth = width;
        teleLayoutFontSize = fontSizeSp;
        return teleLayout;
    }

    private void invalidateTeleLayout() {
        teleLayout = null;
        teleLayoutWidth = -1;
        teleLayoutFontSize = -1;
    }

    private void requestPrivateTeleRender() {
        if (telePrivateSurface != null) telePrivateSurface.requestRender();
    }

    private void requestPrivateControlsRender() {
        if (controlsPrivateSurface != null) controlsPrivateSurface.requestRender();
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
        controlButtons.add(button);
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
        StaticLayout layout = ensureTeleLayout(Math.max(1, teleParams.width - dp(28)));
        float contentHeight = (layout == null ? teleText.getHeight() : layout.getHeight()) + dp(136);
        float max = Math.max(0f, contentHeight - teleParams.height * .42f);
        teleOffset = Math.min(teleOffset, max);
        teleText.setTranslationY(dp(70) - teleOffset);
        requestPrivateTeleRender();
    }

    private void changeFont(int delta) {
        fontSizeSp = clamp(fontSizeSp + delta, 20, 70);
        teleText.setTextSize(fontSizeSp);
        invalidateTeleLayout();
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
        float chromeAlpha = recording ? 0f : 1f;
        if (cameraMoveHandle != null) cameraMoveHandle.setAlpha(chromeAlpha);
        if (cameraResizeHandle != null) cameraResizeHandle.setAlpha(chromeAlpha);
        // Les poignées du téléprompteur sont dessinées uniquement sur la surface privée.
        if (teleMoveHandle != null) teleMoveHandle.setAlpha(0f);
        if (teleResizeHandle != null) teleResizeHandle.setAlpha(0f);

        if (cameraRoot != null) {
            cameraRoot.setBackground(recording
                    ? null
                    : roundedDrawable(0x18000000, 0xCCFFFFFF, dp(15), dp(2)));
        }
        if (teleRoot != null) {
            teleRoot.setBackground(null);
        }
        if (tuningRow != null) {
            tuningRow.setVisibility(recording ? android.view.View.GONE : android.view.View.VISIBLE);
        }
        if (controlsRoot != null) controlsRoot.requestLayout();
        requestPrivateTeleRender();
        if (controlsRoot != null) controlsRoot.post(this::requestPrivateControlsRender);
    }

    private void updateInteractivity() {
        setTouchable(cameraRoot, cameraParams, true);
        setTouchable(teleRoot, teleParams, true);
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
        if (recording || mediaProjection == null) return;
        if (checkSelfPermission(Manifest.permission.RECORD_AUDIO) != PackageManager.PERMISSION_GRANTED) {
            toast("Autorise le microphone dans l’application");
            return;
        }
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
            toast("Enregistrement Live lancé");
        } catch (Exception error) {
            cleanupRecorderFailure();
            toast("Impossible de lancer l’enregistrement Live");
        }
    }

    private void togglePause() {
        if (!recording || mediaRecorder == null) return;
        try {
            if (!paused) {
                mediaRecorder.pause();
                paused = true;
                recordingClock.pause(android.os.SystemClock.elapsedRealtime());
                segmentationFrozen = true;
                mainHandler.removeCallbacks(teleScrollLoop);
                scheduleNextSegmentation(120L);
            } else {
                mediaRecorder.resume();
                paused = false;
                recordingClock.resume(android.os.SystemClock.elapsedRealtime());
                segmentationFrozen = false;
                teleLastFrame = 0L;
                mainHandler.post(teleScrollLoop);
                scheduleNextSegmentation(0L);
            }
            updateInteractivity();
            updateControls();
        } catch (Exception error) {
            toast("Pause Live indisponible sur ce téléphone");
        }
    }

    private void stopRecordingInternal(boolean notify) {
        if (!recording && mediaRecorder == null) return;
        mainHandler.removeCallbacks(teleScrollLoop);
        mainHandler.removeCallbacks(recordingTimerLoop);
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
        recButton.setEnabled(!recording);
        pauseButton.setEnabled(recording);
        stopButton.setEnabled(recording);
        pauseButton.setText(paused ? "▶ Reprendre" : "Ⅱ Pause");
        updateRecordingChrome();
        if (!recording) {
            statusText.setText("✥ LIVE prêt · déplace tout · V" + speed);
        } else {
            String elapsed = recordingClock.format(android.os.SystemClock.elapsedRealtime());
            if (paused) statusText.setText("Ⅱ PAUSE " + elapsed + " · gestes actifs");
            else statusText.setText("● REC " + elapsed + " · gestes actifs");
        }
        if (controlsRoot != null) controlsRoot.post(this::requestPrivateControlsRender);
    }

    private void removeOverlay(android.view.View view) {
        if (view == null || windowManager == null) return;
        try { windowManager.removeView(view); } catch (Exception ignored) {}
    }

    private int dp(int value) {
        return Math.round(value * getResources().getDisplayMetrics().density);
    }

    private float sp(float value) {
        return value * getResources().getDisplayMetrics().scaledDensity;
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
