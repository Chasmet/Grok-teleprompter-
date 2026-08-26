from pathlib import Path

JAVA = Path('app/src/main/java/com/chasmet/grokteleprompter/LiveOverlayService.java')
GRADLE = Path('app/build.gradle')
source = JAVA.read_text(encoding='utf-8')


def replace_method(text: str, signature: str, replacement: str) -> str:
    start = text.find(signature)
    if start < 0:
        raise SystemExit(f'Method not found: {signature}')
    brace = text.find('{', start)
    if brace < 0:
        raise SystemExit(f'Opening brace not found: {signature}')
    depth = 0
    end = None
    for i in range(brace, len(text)):
        ch = text[i]
        if ch == '{':
            depth += 1
        elif ch == '}':
            depth -= 1
            if depth == 0:
                end = i + 1
                break
    if end is None:
        raise SystemExit(f'Closing brace not found: {signature}')
    return text[:start] + replacement.rstrip() + text[end:]


# Dedicated display-only layer for the compact REC controls.
if 'private WindowManager.LayoutParams controlsDisplayParams;' not in source:
    source = source.replace(
        '    private WindowManager.LayoutParams controlsParams;\n',
        '    private WindowManager.LayoutParams controlsParams;\n'
        '    private WindowManager.LayoutParams controlsDisplayParams;\n',
        1,
    )
if 'private FrameLayout controlsDisplayRoot;' not in source:
    source = source.replace(
        '    private LinearLayout controlsRoot;\n',
        '    private LinearLayout controlsRoot;\n'
        '    private FrameLayout controlsDisplayRoot;\n'
        '    private SurfaceView controlsPrivateSurface;\n',
        1,
    )

# Remove the display layer when Live closes.
if 'removeOverlay(controlsDisplayRoot);' not in source:
    source = source.replace(
        '        removeOverlay(controlsRoot);\n',
        '        removeOverlay(controlsRoot);\n'
        '        removeOverlay(controlsDisplayRoot);\n',
        1,
    )

create_overlays = '''    private void createOverlays() {
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

        int controlsWidth = Math.min(metrics.widthPixels - dp(16), dp(218));
        controlsParams = baseParams(Math.max(dp(196), controlsWidth), dp(116));
        controlsParams.gravity = Gravity.TOP | Gravity.START;
        controlsParams.x = Math.max(dp(8), (metrics.widthPixels - controlsParams.width) / 2);
        controlsParams.y = dp(22);
        controlsRoot = buildControlsWindow();
        windowManager.addView(controlsRoot, controlsParams);
        attachControlsMove(statusText);

        controlsDisplayParams = baseParams(controlsParams.width, dp(76));
        controlsDisplayParams.flags |= WindowManager.LayoutParams.FLAG_NOT_TOUCHABLE;
        controlsDisplayParams.gravity = Gravity.TOP | Gravity.START;
        controlsDisplayParams.x = controlsParams.x;
        controlsDisplayParams.y = controlsParams.y;
        controlsDisplayRoot = buildControlsDisplayWindow();
        controlsDisplayRoot.setVisibility(android.view.View.GONE);
        windowManager.addView(controlsDisplayRoot, controlsDisplayParams);

        updateInteractivity();
        updateControls();
    }'''
source = replace_method(source, '    private void createOverlays()', create_overlays)

mark_surface = '''    private boolean markSurfaceSkipScreenshot(SurfaceView view) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.Q || view == null) return false;
        try {
            SurfaceControl control = view.getSurfaceControl();
            if (control == null || !control.isValid()) return false;
            SurfaceControl.Transaction transaction = new SurfaceControl.Transaction();
            HiddenApiBypass.invoke(
                    SurfaceControl.Transaction.class,
                    transaction,
                    "setSkipScreenshot",
                    control,
                    true
            );
            transaction.apply();
            return true;
        } catch (Throwable ignored) {
            // Huawei-safe fallback: never secure the whole WindowManager root.
            return false;
        }
    }'''
source = replace_method(source, '    private boolean markWindowSkipScreenshot(android.view.View view)', mark_surface)

# Re-create the teleprompter as a normal SurfaceView child. Only this child layer is excluded.
tele_anchor = '''        root.setBackground(roundedDrawable(0x44000000, 0xAA60A5FA, dp(18), dp(2)));

        teleText = new TextView(this);'''
if tele_anchor not in source:
    raise SystemExit('Teleprompter insertion anchor not found')
tele_surface = '''        root.setBackground(roundedDrawable(0x44000000, 0xAA60A5FA, dp(18), dp(2)));

        teleSecureSurface = new SurfaceView(this);
        teleSecureSurface.setZOrderOnTop(true);
        teleSecureSurface.setClickable(false);
        teleSecureSurface.setFocusable(false);
        teleSecureSurface.getHolder().setFormat(PixelFormat.TRANSLUCENT);
        teleSecureSurface.setVisibility(android.view.View.GONE);
        teleSecureSurface.getHolder().addCallback(new SurfaceHolder.Callback() {
            @Override
            public void surfaceCreated(@NonNull SurfaceHolder holder) {
                markSurfaceSkipScreenshot(teleSecureSurface);
                renderSecureTeleprompter();
            }

            @Override
            public void surfaceChanged(@NonNull SurfaceHolder holder, int format, int width, int height) {
                teleSecureLayout = null;
                teleSecureLayoutWidth = -1;
                markSurfaceSkipScreenshot(teleSecureSurface);
                renderSecureTeleprompter();
            }

            @Override
            public void surfaceDestroyed(@NonNull SurfaceHolder holder) {}
        });
        root.addView(teleSecureSurface, new FrameLayout.LayoutParams(
                FrameLayout.LayoutParams.MATCH_PARENT,
                FrameLayout.LayoutParams.MATCH_PARENT
        ));

        teleText = new TextView(this);'''
source = source.replace(tele_anchor, tele_surface, 1)

# Display-only compact REC panel. It is non-touchable; touches pass to the transparent real controls underneath.
controls_display_method = '''    private FrameLayout buildControlsDisplayWindow() {
        FrameLayout root = new FrameLayout(this);
        root.setBackgroundColor(Color.TRANSPARENT);

        controlsPrivateSurface = new SurfaceView(this);
        controlsPrivateSurface.setZOrderOnTop(true);
        controlsPrivateSurface.setClickable(false);
        controlsPrivateSurface.setFocusable(false);
        controlsPrivateSurface.getHolder().setFormat(PixelFormat.TRANSLUCENT);
        controlsPrivateSurface.setVisibility(android.view.View.GONE);
        controlsPrivateSurface.getHolder().addCallback(new SurfaceHolder.Callback() {
            @Override
            public void surfaceCreated(@NonNull SurfaceHolder holder) {
                markSurfaceSkipScreenshot(controlsPrivateSurface);
                renderPrivateControls();
            }

            @Override
            public void surfaceChanged(@NonNull SurfaceHolder holder, int format, int width, int height) {
                markSurfaceSkipScreenshot(controlsPrivateSurface);
                renderPrivateControls();
            }

            @Override
            public void surfaceDestroyed(@NonNull SurfaceHolder holder) {}
        });
        root.addView(controlsPrivateSurface, new FrameLayout.LayoutParams(
                FrameLayout.LayoutParams.MATCH_PARENT,
                FrameLayout.LayoutParams.MATCH_PARENT
        ));
        return root;
    }

    private void syncControlsDisplayPosition() {
        if (controlsDisplayRoot == null || controlsDisplayParams == null || controlsParams == null) return;
        controlsDisplayParams.x = controlsParams.x;
        controlsDisplayParams.y = controlsParams.y;
        controlsDisplayParams.width = controlsParams.width;
        controlsDisplayParams.height = dp(76);
        if (controlsDisplayRoot.isAttachedToWindow()) {
            try { windowManager.updateViewLayout(controlsDisplayRoot, controlsDisplayParams); } catch (Exception ignored) {}
        }
    }

    private void renderPrivateControls() {
        if (!recording || controlsPrivateSurface == null) return;
        SurfaceHolder holder = controlsPrivateSurface.getHolder();
        Surface surface = holder.getSurface();
        if (surface == null || !surface.isValid()) return;
        Canvas canvas = null;
        try {
            canvas = holder.lockCanvas();
            if (canvas == null) return;
            canvas.drawColor(Color.TRANSPARENT, PorterDuff.Mode.CLEAR);
            float width = canvas.getWidth();
            float height = canvas.getHeight();
            Paint paint = new Paint(Paint.ANTI_ALIAS_FLAG);

            paint.setStyle(Paint.Style.FILL);
            paint.setColor(0xEE07111F);
            canvas.drawRoundRect(0f, 0f, width, height, dp(14), dp(14), paint);
            paint.setStyle(Paint.Style.STROKE);
            paint.setStrokeWidth(dp(1));
            paint.setColor(0xAA34D399);
            canvas.drawRoundRect(dp(1), dp(1), width - dp(1), height - dp(1), dp(14), dp(14), paint);

            paint.setStyle(Paint.Style.FILL);
            paint.setTypeface(android.graphics.Typeface.DEFAULT_BOLD);
            paint.setTextAlign(Paint.Align.CENTER);
            paint.setColor(Color.WHITE);
            paint.setTextSize(dp(10));
            String status = statusText == null ? (paused ? "Ⅱ PAUSE" : "● REC") : statusText.getText().toString();
            canvas.drawText(status, width / 2f, dp(18), paint);

            String[] labels = new String[] {"REC", paused ? "Reprendre" : "Pause", "Stop", "Fermer"};
            float left = dp(5);
            float gap = dp(4);
            float top = dp(27);
            float bottom = height - dp(5);
            float buttonWidth = (width - left * 2f - gap * 3f) / 4f;
            paint.setTextSize(dp(7));
            for (int i = 0; i < labels.length; i++) {
                float x1 = left + i * (buttonWidth + gap);
                float x2 = x1 + buttonWidth;
                paint.setColor(i == 0 ? 0x55334155 : 0x66334D99);
                canvas.drawRoundRect(x1, top, x2, bottom, dp(9), dp(9), paint);
                paint.setColor(Color.WHITE);
                Paint.FontMetrics fm = paint.getFontMetrics();
                float baseline = (top + bottom) / 2f - (fm.ascent + fm.descent) / 2f;
                canvas.drawText(labels[i], (x1 + x2) / 2f, baseline, paint);
            }
        } catch (Throwable ignored) {
        } finally {
            if (canvas != null) {
                try { holder.unlockCanvasAndPost(canvas); } catch (Throwable ignored) {}
            }
        }
    }

'''
controls_signature = '    private LinearLayout buildControlsWindow()'
idx = source.find(controls_signature)
if idx < 0:
    raise SystemExit('Controls method not found')
if 'private FrameLayout buildControlsDisplayWindow()' not in source:
    source = source[:idx] + controls_display_method + source[idx:]

update_chrome = '''    private void updateRecordingChrome() {
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
        if (teleText != null) teleText.setAlpha(recording ? 0f : 1f);
        if (teleSecureSurface != null) {
            teleSecureSurface.setVisibility(recording ? android.view.View.VISIBLE : android.view.View.GONE);
            if (recording) {
                teleSecureSurface.post(() -> {
                    markSurfaceSkipScreenshot(teleSecureSurface);
                    renderSecureTeleprompter();
                });
            }
        }

        if (tuningRow != null) tuningRow.setVisibility(recording
                ? android.view.View.GONE
                : android.view.View.VISIBLE);

        if (controlsRoot != null && controlsParams != null) {
            controlsRoot.setAlpha(recording ? 0f : 1f);
            int desiredHeight = recording ? dp(76) : dp(116);
            if (controlsParams.height != desiredHeight) {
                controlsParams.height = desiredHeight;
                try { windowManager.updateViewLayout(controlsRoot, controlsParams); } catch (Exception ignored) {}
            }
        }

        if (controlsDisplayRoot != null) {
            controlsDisplayRoot.setVisibility(recording ? android.view.View.VISIBLE : android.view.View.GONE);
        }
        if (controlsPrivateSurface != null) {
            controlsPrivateSurface.setVisibility(recording ? android.view.View.VISIBLE : android.view.View.GONE);
            if (recording) {
                controlsPrivateSurface.post(() -> {
                    markSurfaceSkipScreenshot(controlsPrivateSurface);
                    renderPrivateControls();
                });
            }
        }
        syncControlsDisplayPosition();
    }'''
source = replace_method(source, '    private void updateRecordingChrome()', update_chrome)

attach_controls = '''    private void attachControlsMove(TextView handle) {
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
                    syncControlsDisplayPosition();
                    return true;
                }
                return true;
            }
        });
    }'''
source = replace_method(source, '    private void attachControlsMove(TextView handle)', attach_controls)

# Keep the teleprompter child surface synchronized with automatic/manual scrolling.
translation_line = '        teleText.setTranslationY(dp(70) - teleOffset);\n'
if translation_line not in source:
    raise SystemExit('Teleprompter translation line not found')
if 'teleText.setTranslationY(dp(70) - teleOffset);\n        if (recording) renderSecureTeleprompter();' not in source:
    source = source.replace(
        translation_line,
        translation_line + '        if (recording) renderSecureTeleprompter();\n',
        1,
    )

change_font = '''    private void changeFont(int delta) {
        fontSizeSp = clamp(fontSizeSp + delta, 20, 70);
        if (teleText != null) teleText.setTextSize(fontSizeSp);
        teleSecureLayout = null;
        teleSecureLayoutWidth = -1;
        teleSecureLayoutFontSize = -1;
        applyTeleOffset();
        updateControls();
    }'''
source = replace_method(source, '    private void changeFont(int delta)', change_font)

# There must be no whole-window screenshot exclusion left.
if 'markWindowSkipScreenshot' in source:
    raise SystemExit('Root screenshot exclusion is still present')
if '.setSecure(true)' in source:
    raise SystemExit('Secure SurfaceView is still present')

JAVA.write_text(source, encoding='utf-8')

gradle = GRADLE.read_text(encoding='utf-8')
gradle = gradle.replace("versionCode 23\n        versionName '2.16.5'", "versionCode 24\n        versionName '2.16.6'")
GRADLE.write_text(gradle, encoding='utf-8')

print('Applied v2.16.6 child-layer recording fix + compact controls')
