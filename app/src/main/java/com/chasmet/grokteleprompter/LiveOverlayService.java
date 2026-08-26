package com.chasmet.grokteleprompter;

import android.Manifest;
import android.annotation.SuppressLint;
import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.ContentValues;
import android.content.Context;
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
import android.view.Gravity;
import android.view.MotionEvent;
import android.view.Surface;
import android.view.SurfaceHolder;
import android.view.SurfaceView;
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
    public static final String EXTRA_RESULT_CODE = "resultCode";
    public static final String EXTRA_RESULT_DATA = "resultData";
    public static final String EXTRA_SCRIPT = "script";
    public static final String EXTRA_SPEED = "speed";
    public static final String EXTRA_FONT_SIZE = "fontSize";

    private static final String CHANNEL_ID = "grok_live_overlay";
    private static final int NOTIFICATION_ID = 4217;

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
    private SurfaceView teleSecureSurface;
    private android.text.StaticLayout teleSecureLayout;
    private int teleSecureLayoutWidth = -1;
    private int teleSecureLayoutFontSize = -1;
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
    private int cameraFacing = CameraCharacteristics.LENS_FACING_FRONT;
    private boolean segmentationBusy;
    private boolean segmentationFrozen;
    private Segmenter segmenter;

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
            if (cameraTexture == null || !cameraTexture.isAvailable() || segmentationFrozen) {
                mainHandler.postDelayed(this, 80L);
                return;
            }
            if (segmentationBusy) {
                mainHandler.postDelayed(this, 45L);
                return;
            }
            Bitmap frame;
            try {
                frame = cameraTexture.getBitmap(240, 320);
            } catch (Exception error) {
                frame = null;
            }
            if (frame == null) {
                mainHandler.postDelayed(this, 80L);
                return;
            }
            segmentationBusy = true;
            Bitmap source = frame;
            segmenter.process(InputImage.fromBitmap(source, 0))
                    .addOnSuccessListener(mask -> renderMask(source, mask))
                    .addOnFailureListener(error -> source.recycle())
                    .addOnCompleteListener(task -> {
                        segmentationBusy = false;
                        mainHandler.postDelayed(segmentationLoop, 66L);
                    });
        }
    };

    @Override
    public void onCreate() {
        super.onCreate();
        windowManager = (WindowManager) getSystemService(WINDOW_SERVICE);
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
        mainHandler.post(segmentationLoop);
        return START_STICKY;
    }

    @Override
    public void onDestroy() {
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
        excludeFromRecording(controlsParams);
        controlsParams.gravity = Gravity.TOP | Gravity.START;
        controlsParams.x = Math.max(dp(8), (metrics.widthPixels - controlsParams.width) / 2);
        controlsParams.y = dp(22);
        controlsRoot = buildControlsWindow();
        windowManager.addView(controlsRoot, controlsParams);
        attachControlsMove(statusText);

        updateInteractivity();
        updateControls();
    }

    private void excludeFromRecording(WindowManager.LayoutParams params) {
        // Keep this overlay visible on the phone while excluding it from screenshots/MediaProjection.
        params.flags |= WindowManager.LayoutParams.FLAG_SECURE;
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

        teleSecureSurface = new SurfaceView(this);
        teleSecureSurface.setSecure(true);
        teleSecureSurface.setZOrderMediaOverlay(true);
        teleSecureSurface.getHolder().setFormat(PixelFormat.TRANSLUCENT);
        teleSecureSurface.setVisibility(android.view.View.GONE);
        teleSecureSurface.getHolder().addCallback(new SurfaceHolder.Callback() {
            @Override public void surfaceCreated(@NonNull SurfaceHolder holder) {
                renderSecureTeleprompter();
            }
            @Override public void surfaceChanged(@NonNull SurfaceHolder holder, int format, int width, int height) {
                teleSecureLayout = null;
                renderSecureTeleprompter();
            }
            @Override public void surfaceDestroyed(@NonNull SurfaceHolder holder) {}
        });
        root.addView(teleSecureSurface, new FrameLayout.LayoutParams(
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
        statusText.setTextSize(12);
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
        if (root == teleRoot) {
            teleSecureLayout = null;
            applyTeleOffset();
        }
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
        if (root == teleRoot) {
            teleSecureLayout = null;
            applyTeleOffset();
        }
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

    private android.text.StaticLayout ensureSecureTeleLayout() {
        int width = Math.max(1, teleParams.width - dp(28));
        if (teleSecureLayout != null
                && teleSecureLayoutWidth == width
                && teleSecureLayoutFontSize == fontSizeSp) {
            return teleSecureLayout;
        }
        android.text.TextPaint paint = new android.text.TextPaint(
                Paint.ANTI_ALIAS_FLAG | Paint.SUBPIXEL_TEXT_FLAG);
        paint.setColor(Color.WHITE);
        paint.setTextSize(fontSizeSp * getResources().getDisplayMetrics().scaledDensity);
        paint.setTypeface(android.graphics.Typeface.DEFAULT_BOLD);
        paint.setShadowLayer(dp(4), 0, dp(2), Color.BLACK);
        teleSecureLayout = android.text.StaticLayout.Builder
                .obtain(script, 0, script.length(), paint, width)
                .setAlignment(android.text.Layout.Alignment.ALIGN_CENTER)
                .setIncludePad(true)
                .setLineSpacing(dp(2), 1.0f)
                .build();
        teleSecureLayoutWidth = width;
        teleSecureLayoutFontSize = fontSizeSp;
        return teleSecureLayout;
    }

    private void renderSecureTeleprompter() {
        if (!recording || teleSecureSurface == null || teleParams == null) return;
        SurfaceHolder holder = teleSecureSurface.getHolder();
        Surface surface = holder.getSurface();
        if (surface == null || !surface.isValid()) return;
        Canvas canvas = null;
        try {
            canvas = holder.lockCanvas();
            if (canvas == null) return;
            canvas.drawColor(Color.TRANSPARENT, PorterDuff.Mode.CLEAR);

            Paint panel = new Paint(Paint.ANTI_ALIAS_FLAG);
            panel.setColor(0x66000000);
            float radius = dp(18);
            canvas.drawRoundRect(0, 0, canvas.getWidth(), canvas.getHeight(), radius, radius, panel);

            android.text.StaticLayout layout = ensureSecureTeleLayout();
            float max = Math.max(0f, layout.getHeight() - teleParams.height * .42f);
            teleOffset = Math.max(0f, Math.min(teleOffset, max));
            float x = dp(14);
            float y = dp(70) - teleOffset;
            canvas.save();
            canvas.clipRect(0, 0, canvas.getWidth(), canvas.getHeight());
            canvas.translate(x, y);
            layout.draw(canvas);
            canvas.restore();
        } catch (Exception ignored) {
        } finally {
            if (canvas != null) {
                try { holder.unlockCanvasAndPost(canvas); } catch (Exception ignored) {}
            }
        }
    }

    private void applyTeleOffset() {
        if (teleText == null || teleRoot == null) return;
        float max;
        if (recording) {
            max = Math.max(0f, ensureSecureTeleLayout().getHeight() - teleParams.height * .42f);
        } else {
            max = Math.max(0f, teleText.getHeight() - teleParams.height * .42f);
        }
        teleOffset = Math.max(0f, Math.min(teleOffset, max));
        teleText.setTranslationY(dp(70) - teleOffset);
        if (recording) renderSecureTeleprompter();
    }

    private void changeFont(int delta) {
        fontSizeSp = clamp(fontSizeSp + delta, 20, 70);
        teleSecureLayout = null;
        teleSecureLayoutWidth = -1;
        teleSecureLayoutFontSize = -1;
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
        float chromeAlpha = recording ? 0f : 1f;
        if (cameraMoveHandle != null) cameraMoveHandle.setAlpha(chromeAlpha);
        if (cameraResizeHandle != null) cameraResizeHandle.setAlpha(chromeAlpha);
        if (teleMoveHandle != null) teleMoveHandle.setAlpha(chromeAlpha);
        if (teleResizeHandle != null) teleResizeHandle.setAlpha(chromeAlpha);

        if (cameraRoot != null) {
            cameraRoot.setBackground(recording
                    ? null
                    : roundedDrawable(0x18000000, 0xCCFFFFFF, dp(15), dp(2)));
        }
        if (teleRoot != null) {
            teleRoot.setBackground(recording
                    ? null
                    : roundedDrawable(0x44000000, 0xAA60A5FA, dp(18), dp(2)));
        }
        if (teleText != null) {
            // Alpha zero keeps the TextView alive as the tactile scroll/pinch layer.
            teleText.setAlpha(recording ? 0f : 1f);
        }
        if (teleSecureSurface != null) {
            teleSecureSurface.setVisibility(recording
                    ? android.view.View.VISIBLE
                    : android.view.View.GONE);
            if (recording) mainHandler.post(this::renderSecureTeleprompter);
        }
        if (tuningRow != null) {
            tuningRow.setVisibility(recording ? android.view.View.GONE : android.view.View.VISIBLE);
        }
        if (controlsRoot != null) controlsRoot.requestLayout();
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
            for (String id : manager.getCameraIdList()) {
                Integer facing = manager.getCameraCharacteristics(id).get(CameraCharacteristics.LENS_FACING);
                if (facing != null && facing == cameraFacing) {
                    selected = id;
                    break;
                }
            }
            if (selected == null && manager.getCameraIdList().length > 0) selected = manager.getCameraIdList()[0];
            if (selected == null) return;
            manager.openCamera(selected, new CameraDevice.StateCallback() {
                @Override
                public void onOpened(@NonNull CameraDevice camera) {
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
            Surface surface = new Surface(texture);
            CaptureRequest.Builder builder = cameraDevice.createCaptureRequest(CameraDevice.TEMPLATE_PREVIEW);
            builder.addTarget(surface);
            builder.set(CaptureRequest.CONTROL_AF_MODE, CaptureRequest.CONTROL_AF_MODE_CONTINUOUS_VIDEO);
            builder.set(CaptureRequest.CONTROL_AE_MODE, CaptureRequest.CONTROL_AE_MODE_ON);
            cameraDevice.createCaptureSession(Arrays.asList(surface), new CameraCaptureSession.StateCallback() {
                @Override
                public void onConfigured(@NonNull CameraCaptureSession session) {
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
        openCamera();
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
    }

    private void closeCamera() {
        closeCameraDeviceOnly();
    }

    private void renderMask(Bitmap source, SegmentationMask mask) {
        try {
            int mw = mask.getWidth();
            int mh = mask.getHeight();
            ByteBuffer bytes = mask.getBuffer();
            bytes.rewind();
            FloatBuffer buffer = bytes.order(ByteOrder.nativeOrder()).asFloatBuffer();
            int[] alphaPixels = new int[mw * mh];
            for (int i = 0; i < alphaPixels.length && buffer.hasRemaining(); i++) {
                float confidence = buffer.get();
                float normalized = Math.max(0f, Math.min(1f, (confidence - .22f) / .60f));
                int alpha = Math.round(normalized * 255f);
                alphaPixels[i] = (alpha << 24) | 0x00FFFFFF;
            }
            Bitmap alpha = Bitmap.createBitmap(alphaPixels, mw, mh, Bitmap.Config.ARGB_8888);
            Bitmap output = Bitmap.createBitmap(source.getWidth(), source.getHeight(), Bitmap.Config.ARGB_8888);
            Canvas canvas = new Canvas(output);
            Rect target = new Rect(0, 0, output.getWidth(), output.getHeight());
            Paint paint = new Paint(Paint.ANTI_ALIAS_FLAG | Paint.FILTER_BITMAP_FLAG);
            canvas.drawBitmap(source, null, target, paint);
            paint.setXfermode(new PorterDuffXfermode(PorterDuff.Mode.DST_IN));
            canvas.drawBitmap(alpha, null, target, paint);
            paint.setXfermode(null);
            cameraCutout.setImageBitmap(output);
            source.recycle();
            alpha.recycle();
        } catch (Exception error) {
            source.recycle();
        }
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
            mediaRecorder.setVideoEncodingBitRate(12_000_000);
            mediaRecorder.setAudioEncoder(MediaRecorder.AudioEncoder.AAC);
            mediaRecorder.setAudioSamplingRate(48_000);
            mediaRecorder.setAudioEncodingBitRate(160_000);
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
            } else {
                mediaRecorder.resume();
                paused = false;
                recordingClock.resume(android.os.SystemClock.elapsedRealtime());
                segmentationFrozen = false;
                teleLastFrame = 0L;
                mainHandler.post(teleScrollLoop);
                mainHandler.post(segmentationLoop);
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
