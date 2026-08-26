from pathlib import Path

path = Path('app/src/main/java/com/chasmet/grokteleprompter/LiveOverlayService.java')
source = path.read_text(encoding='utf-8')


def replace(old: str, new: str, count: int = 1) -> None:
    global source
    if old not in source:
        raise SystemExit('Missing patch pattern:\n' + old[:300])
    source = source.replace(old, new, count)

# Imports for a dedicated secure SurfaceView. The overlay window itself stays non-secure.
replace(
'''import android.view.Surface;\nimport android.view.TextureView;\nimport android.view.WindowManager;\n''',
'''import android.view.Surface;\nimport android.view.SurfaceHolder;\nimport android.view.SurfaceView;\nimport android.view.TextureView;\nimport android.view.WindowManager;\n''')

# Secure teleprompter rendering state.
replace(
'''    private TextView teleText;\n    private TextView statusText;\n''',
'''    private TextView teleText;\n    private SurfaceView teleSecureSurface;\n    private android.text.StaticLayout teleSecureLayout;\n    private int teleSecureLayoutWidth = -1;\n    private int teleSecureLayoutFontSize = -1;\n    private TextView statusText;\n''')

# IMPORTANT: never mark the entire teleprompter window FLAG_SECURE on Huawei/Android 16.
# Some devices remove that window from the local display while MediaProjection is active.
replace(
'''        teleParams = baseParams(Math.max(dp(170), teleWidth), dp(165));\n        excludeFromRecording(teleParams);\n        teleParams.gravity = Gravity.TOP | Gravity.START;\n''',
'''        teleParams = baseParams(Math.max(dp(170), teleWidth), dp(165));\n        teleParams.gravity = Gravity.TOP | Gravity.START;\n''')

# Add a secure surface as the first child. Regular TextView stays as an invisible touch layer during REC.
replace(
'''        root.setClipChildren(true);\n        root.setBackground(roundedDrawable(0x44000000, 0xAA60A5FA, dp(18), dp(2)));\n\n        teleText = new TextView(this);\n''',
'''        root.setClipChildren(true);\n        root.setBackground(roundedDrawable(0x44000000, 0xAA60A5FA, dp(18), dp(2)));\n\n        teleSecureSurface = new SurfaceView(this);\n        teleSecureSurface.setSecure(true);\n        teleSecureSurface.setZOrderMediaOverlay(true);\n        teleSecureSurface.getHolder().setFormat(PixelFormat.TRANSLUCENT);\n        teleSecureSurface.setVisibility(android.view.View.GONE);\n        teleSecureSurface.getHolder().addCallback(new SurfaceHolder.Callback() {\n            @Override public void surfaceCreated(@NonNull SurfaceHolder holder) {\n                renderSecureTeleprompter();\n            }\n            @Override public void surfaceChanged(@NonNull SurfaceHolder holder, int format, int width, int height) {\n                teleSecureLayout = null;\n                renderSecureTeleprompter();\n            }\n            @Override public void surfaceDestroyed(@NonNull SurfaceHolder holder) {}\n        });\n        root.addView(teleSecureSurface, new FrameLayout.LayoutParams(\n                FrameLayout.LayoutParams.MATCH_PARENT,\n                FrameLayout.LayoutParams.MATCH_PARENT\n        ));\n\n        teleText = new TextView(this);\n''')

# Invalidate the secure text layout on teleprompter resize.
replace(
'''        windowManager.updateViewLayout(root, params);\n        if (root == teleRoot) applyTeleOffset();\n    }\n\n    private void scaleOverlay''',
'''        windowManager.updateViewLayout(root, params);\n        if (root == teleRoot) {\n            teleSecureLayout = null;\n            applyTeleOffset();\n        }\n    }\n\n    private void scaleOverlay''')

replace(
'''        windowManager.updateViewLayout(root, params);\n        if (root == teleRoot) applyTeleOffset();\n    }\n\n    private void attachCameraDirectGesture''',
'''        windowManager.updateViewLayout(root, params);\n        if (root == teleRoot) {\n            teleSecureLayout = null;\n            applyTeleOffset();\n        }\n    }\n\n    private void attachCameraDirectGesture''')

# Replace the normal-only translation method with a dual renderer.
replace(
'''    private void applyTeleOffset() {\n        if (teleText == null || teleRoot == null) return;\n        float max = Math.max(0f, teleText.getHeight() - teleParams.height * .42f);\n        teleOffset = Math.min(teleOffset, max);\n        teleText.setTranslationY(dp(70) - teleOffset);\n    }\n\n    private void changeFont(int delta) {\n        fontSizeSp = clamp(fontSizeSp + delta, 20, 70);\n        teleText.setTextSize(fontSizeSp);\n        teleText.post(this::applyTeleOffset);\n    }\n''',
'''    private android.text.StaticLayout ensureSecureTeleLayout() {\n        int width = Math.max(1, teleParams.width - dp(28));\n        if (teleSecureLayout != null\n                && teleSecureLayoutWidth == width\n                && teleSecureLayoutFontSize == fontSizeSp) {\n            return teleSecureLayout;\n        }\n        android.text.TextPaint paint = new android.text.TextPaint(\n                Paint.ANTI_ALIAS_FLAG | Paint.SUBPIXEL_TEXT_FLAG);\n        paint.setColor(Color.WHITE);\n        paint.setTextSize(fontSizeSp * getResources().getDisplayMetrics().scaledDensity);\n        paint.setTypeface(android.graphics.Typeface.DEFAULT_BOLD);\n        paint.setShadowLayer(dp(4), 0, dp(2), Color.BLACK);\n        teleSecureLayout = android.text.StaticLayout.Builder\n                .obtain(script, 0, script.length(), paint, width)\n                .setAlignment(android.text.Layout.Alignment.ALIGN_CENTER)\n                .setIncludePad(true)\n                .setLineSpacing(dp(2), 1.0f)\n                .build();\n        teleSecureLayoutWidth = width;\n        teleSecureLayoutFontSize = fontSizeSp;\n        return teleSecureLayout;\n    }\n\n    private void renderSecureTeleprompter() {\n        if (!recording || teleSecureSurface == null || teleParams == null) return;\n        SurfaceHolder holder = teleSecureSurface.getHolder();\n        Surface surface = holder.getSurface();\n        if (surface == null || !surface.isValid()) return;\n        Canvas canvas = null;\n        try {\n            canvas = holder.lockCanvas();\n            if (canvas == null) return;\n            canvas.drawColor(Color.TRANSPARENT, PorterDuff.Mode.CLEAR);\n\n            Paint panel = new Paint(Paint.ANTI_ALIAS_FLAG);\n            panel.setColor(0x66000000);\n            float radius = dp(18);\n            canvas.drawRoundRect(0, 0, canvas.getWidth(), canvas.getHeight(), radius, radius, panel);\n\n            android.text.StaticLayout layout = ensureSecureTeleLayout();\n            float max = Math.max(0f, layout.getHeight() - teleParams.height * .42f);\n            teleOffset = Math.max(0f, Math.min(teleOffset, max));\n            float x = dp(14);\n            float y = dp(70) - teleOffset;\n            canvas.save();\n            canvas.clipRect(0, 0, canvas.getWidth(), canvas.getHeight());\n            canvas.translate(x, y);\n            layout.draw(canvas);\n            canvas.restore();\n        } catch (Exception ignored) {\n        } finally {\n            if (canvas != null) {\n                try { holder.unlockCanvasAndPost(canvas); } catch (Exception ignored) {}\n            }\n        }\n    }\n\n    private void applyTeleOffset() {\n        if (teleText == null || teleRoot == null) return;\n        float max;\n        if (recording) {\n            max = Math.max(0f, ensureSecureTeleLayout().getHeight() - teleParams.height * .42f);\n        } else {\n            max = Math.max(0f, teleText.getHeight() - teleParams.height * .42f);\n        }\n        teleOffset = Math.max(0f, Math.min(teleOffset, max));\n        teleText.setTranslationY(dp(70) - teleOffset);\n        if (recording) renderSecureTeleprompter();\n    }\n\n    private void changeFont(int delta) {\n        fontSizeSp = clamp(fontSizeSp + delta, 20, 70);\n        teleSecureLayout = null;\n        teleSecureLayoutWidth = -1;\n        teleSecureLayoutFontSize = -1;\n        teleText.setTextSize(fontSizeSp);\n        teleText.post(this::applyTeleOffset);\n    }\n''')

# During recording, normal teleprompter pixels become transparent but remain touchable.
# The secure SurfaceView is what the user actually sees locally.
replace(
'''        if (teleRoot != null) {\n            teleRoot.setBackground(recording\n                    ? null\n                    : roundedDrawable(0x44000000, 0xAA60A5FA, dp(18), dp(2)));\n        }\n        if (tuningRow != null) {\n''',
'''        if (teleRoot != null) {\n            teleRoot.setBackground(recording\n                    ? null\n                    : roundedDrawable(0x44000000, 0xAA60A5FA, dp(18), dp(2)));\n        }\n        if (teleText != null) {\n            // Alpha zero keeps the TextView alive as the tactile scroll/pinch layer.\n            teleText.setAlpha(recording ? 0f : 1f);\n        }\n        if (teleSecureSurface != null) {\n            teleSecureSurface.setVisibility(recording\n                    ? android.view.View.VISIBLE\n                    : android.view.View.GONE);\n            if (recording) mainHandler.post(this::renderSecureTeleprompter);\n        }\n        if (tuningRow != null) {\n''')

path.write_text(source, encoding='utf-8')
print('Secure SurfaceView teleprompter patch v2.16.4 applied')
