from pathlib import Path

java_path = Path('app/src/main/java/com/chasmet/grokteleprompter/LiveOverlayService.java')
source = java_path.read_text(encoding='utf-8')

def replace(old, new, count=1):
    global source
    if old not in source:
        raise SystemExit('Missing pattern: ' + old[:180])
    source = source.replace(old, new, count)

# Imports for SurfaceControl + reliable hidden API access.
if 'import android.view.SurfaceControl;\n' not in source:
    source = source.replace('import android.view.Surface;\n', 'import android.view.Surface;\nimport android.view.SurfaceControl;\n', 1)
if 'import org.lsposed.hiddenapibypass.HiddenApiBypass;\n' not in source:
    source = source.replace('import com.google.mlkit.vision.common.InputImage;\n', 'import com.google.mlkit.vision.common.InputImage;\nimport org.lsposed.hiddenapibypass.HiddenApiBypass;\n', 1)

# Never secure the whole control window: Huawei/Android 16 can black the projection.
replace('        excludeFromRecording(controlsParams);\n', '')

# Remove the secure SurfaceView teleprompter. Keep the normal TextView visible locally.
start = source.index('        teleSecureSurface = new SurfaceView(this);\n')
end_marker = '''        root.addView(teleSecureSurface, new FrameLayout.LayoutParams(\n                FrameLayout.LayoutParams.MATCH_PARENT,\n                FrameLayout.LayoutParams.MATCH_PARENT\n        ));\n\n'''
end = source.index(end_marker, start) + len(end_marker)
source = source[:start] + source[end:]

# Mark the two UI-only WindowManager surfaces to be skipped by screenshots / MediaProjection.
replace(
'''        teleRoot = buildTeleWindow();\n        windowManager.addView(teleRoot, teleParams);\n\n''',
'''        teleRoot = buildTeleWindow();\n        windowManager.addView(teleRoot, teleParams);\n        teleRoot.post(() -> markWindowSkipScreenshot(teleRoot));\n\n''')
replace(
'''        controlsRoot = buildControlsWindow();\n        windowManager.addView(controlsRoot, controlsParams);\n        attachControlsMove(statusText);\n''',
'''        controlsRoot = buildControlsWindow();\n        windowManager.addView(controlsRoot, controlsParams);\n        controlsRoot.post(() -> markWindowSkipScreenshot(controlsRoot));\n        attachControlsMove(statusText);\n''')

# Replace FLAG_SECURE helper with SKIP_SCREENSHOT on the actual root SurfaceControl.
old_helper = '''    private void excludeFromRecording(WindowManager.LayoutParams params) {\n        // Keep this overlay visible on the phone while excluding it from screenshots/MediaProjection.\n        params.flags |= WindowManager.LayoutParams.FLAG_SECURE;\n    }\n\n'''
new_helper = '''    private boolean markWindowSkipScreenshot(android.view.View view) {\n        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.Q || view == null || !view.isAttachedToWindow()) {\n            return false;\n        }\n        try {\n            Object viewRoot = HiddenApiBypass.invoke(android.view.View.class, view, "getViewRootImpl");\n            if (viewRoot == null) return false;\n            Object rawControl = HiddenApiBypass.invoke(viewRoot.getClass(), viewRoot, "getSurfaceControl");\n            if (!(rawControl instanceof SurfaceControl)) return false;\n            SurfaceControl control = (SurfaceControl) rawControl;\n            if (!control.isValid()) return false;\n            SurfaceControl.Transaction transaction = new SurfaceControl.Transaction();\n            HiddenApiBypass.invoke(\n                    SurfaceControl.Transaction.class,\n                    transaction,\n                    "setSkipScreenshot",\n                    control,\n                    true\n            );\n            transaction.apply();\n            return true;\n        } catch (Throwable ignored) {\n            // Important Huawei fallback: keep content visible instead of turning the recording black.\n            return false;\n        }\n    }\n\n'''
replace(old_helper, new_helper)

# The normal TextView remains visible during REC. No secure SurfaceView switching.
old_chrome = '''        if (teleText != null) {\n            // Alpha zero keeps the TextView alive as the tactile scroll/pinch layer.\n            teleText.setAlpha(recording ? 0f : 1f);\n        }\n        if (teleSecureSurface != null) {\n            teleSecureSurface.setVisibility(recording\n                    ? android.view.View.VISIBLE\n                    : android.view.View.GONE);\n            if (recording) mainHandler.post(this::renderSecureTeleprompter);\n        }\n'''
new_chrome = '''        if (teleText != null) {\n            teleText.setAlpha(1f);\n        }\n        if (teleRoot != null) teleRoot.post(() -> markWindowSkipScreenshot(teleRoot));\n        if (controlsRoot != null) controlsRoot.post(() -> markWindowSkipScreenshot(controlsRoot));\n'''
replace(old_chrome, new_chrome)

# Do not render into the old secure surface anymore.
source = source.replace('        if (recording) renderSecureTeleprompter();\n', '')

java_path.write_text(source, encoding='utf-8')

# Gradle: use a maintained pure-Java hidden API bridge so setSkipScreenshot works on targetSdk 36.
gradle_path = Path('app/build.gradle')
gradle = gradle_path.read_text(encoding='utf-8')
if 'hiddenapibypass:6.1' not in gradle:
    gradle = gradle.replace(
        "    implementation 'com.google.mlkit:segmentation-selfie:16.0.0-beta6'\n",
        "    implementation 'com.google.mlkit:segmentation-selfie:16.0.0-beta6'\n    implementation 'org.lsposed.hiddenapibypass:hiddenapibypass:6.1'\n",
        1,
    )
gradle = gradle.replace("versionCode 22\n        versionName '2.16.4'", "versionCode 23\n        versionName '2.16.5'")
gradle_path.write_text(gradle, encoding='utf-8')

print('Applied v2.16.5 SKIP_SCREENSHOT overlay fix')
