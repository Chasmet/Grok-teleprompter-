from pathlib import Path

path = Path('app/src/main/java/com/chasmet/grokteleprompter/LiveOverlayService.java')
source = path.read_text(encoding='utf-8')


def replace(old: str, new: str, count: int = 1) -> None:
    global source
    if old not in source:
        raise SystemExit('Missing patch pattern:\n' + old[:240])
    source = source.replace(old, new, count)


replace(
'''    private TextView statusText;\n    private Button recButton;\n    private Button pauseButton;\n    private Button stopButton;\n''',
'''    private TextView statusText;\n    private TextView cameraMoveHandle;\n    private TextView cameraResizeHandle;\n    private TextView teleMoveHandle;\n    private TextView teleResizeHandle;\n    private LinearLayout tuningRow;\n    private Button recButton;\n    private Button pauseButton;\n    private Button stopButton;\n''')

replace(
'''    private boolean recording;\n    private boolean paused;\n    private boolean teleGestureActive;\n''',
'''    private boolean recording;\n    private boolean paused;\n    private boolean teleGestureActive;\n    private final LiveRecordingClock recordingClock = new LiveRecordingClock();\n''')

marker = '''    private final Runnable segmentationLoop = new Runnable() {\n'''
insert = '''    private final Runnable recordingTimerLoop = new Runnable() {\n        @Override\n        public void run() {\n            if (!recording) return;\n            updateControls();\n            mainHandler.postDelayed(this, 250L);\n        }\n    };\n\n'''
if insert not in source:
    if marker not in source:
        raise SystemExit('segmentationLoop marker missing')
    source = source.replace(marker, insert + marker, 1)

replace(
'''        TextView move = handle("✥ CAM");\n        FrameLayout.LayoutParams moveLp = new FrameLayout.LayoutParams(dp(66), dp(30), Gravity.TOP | Gravity.START);\n        moveLp.leftMargin = dp(3);\n        moveLp.topMargin = dp(3);\n        root.addView(move, moveLp);\n        attachMoveHandle(move, root, cameraParams, false);\n\n        TextView resize = handle("↘");\n        resize.setTextSize(16);\n        FrameLayout.LayoutParams resizeLp = new FrameLayout.LayoutParams(dp(52), dp(52), Gravity.BOTTOM | Gravity.END);\n        root.addView(resize, resizeLp);\n        attachResizeHandle(resize, root, cameraParams, dp(80), dp(108));\n''',
'''        cameraMoveHandle = handle("✥ CAM");\n        FrameLayout.LayoutParams moveLp = new FrameLayout.LayoutParams(dp(66), dp(30), Gravity.TOP | Gravity.START);\n        moveLp.leftMargin = dp(3);\n        moveLp.topMargin = dp(3);\n        root.addView(cameraMoveHandle, moveLp);\n        attachMoveHandle(cameraMoveHandle, root, cameraParams, false);\n\n        cameraResizeHandle = handle("↘");\n        cameraResizeHandle.setTextSize(16);\n        FrameLayout.LayoutParams resizeLp = new FrameLayout.LayoutParams(dp(52), dp(52), Gravity.BOTTOM | Gravity.END);\n        root.addView(cameraResizeHandle, resizeLp);\n        attachResizeHandle(cameraResizeHandle, root, cameraParams, dp(80), dp(108));\n''')

replace(
'''        TextView move = handle("✥ TÉLÉPROMPTEUR · GLISSE");\n        FrameLayout.LayoutParams moveLp = new FrameLayout.LayoutParams(\n                FrameLayout.LayoutParams.MATCH_PARENT, dp(34), Gravity.TOP);\n        moveLp.leftMargin = dp(4);\n        moveLp.rightMargin = dp(4);\n        moveLp.topMargin = dp(3);\n        root.addView(move, moveLp);\n        attachMoveHandle(move, root, teleParams, true);\n\n        TextView resize = handle("↘");\n        resize.setTextSize(16);\n        FrameLayout.LayoutParams resizeLp = new FrameLayout.LayoutParams(dp(52), dp(52), Gravity.BOTTOM | Gravity.END);\n        root.addView(resize, resizeLp);\n        attachResizeHandle(resize, root, teleParams, dp(150), dp(110));\n''',
'''        teleMoveHandle = handle("✥ TÉLÉPROMPTEUR · GLISSE");\n        FrameLayout.LayoutParams moveLp = new FrameLayout.LayoutParams(\n                FrameLayout.LayoutParams.MATCH_PARENT, dp(34), Gravity.TOP);\n        moveLp.leftMargin = dp(4);\n        moveLp.rightMargin = dp(4);\n        moveLp.topMargin = dp(3);\n        root.addView(teleMoveHandle, moveLp);\n        attachMoveHandle(teleMoveHandle, root, teleParams, true);\n\n        teleResizeHandle = handle("↘");\n        teleResizeHandle.setTextSize(16);\n        FrameLayout.LayoutParams resizeLp = new FrameLayout.LayoutParams(dp(52), dp(52), Gravity.BOTTOM | Gravity.END);\n        root.addView(teleResizeHandle, resizeLp);\n        attachResizeHandle(teleResizeHandle, root, teleParams, dp(150), dp(110));\n''')

replace('''        LinearLayout row2 = row();\n''', '''        tuningRow = row();\n''')
replace('''            row2.addView(b, weight());\n        }\n        root.addView(row2);\n''', '''            tuningRow.addView(b, weight());\n        }\n        root.addView(tuningRow);\n''')

insert_before = '''    private void updateInteractivity() {\n'''
chrome_method = '''    private void updateRecordingChrome() {\n        float chromeAlpha = recording ? 0f : 1f;\n        if (cameraMoveHandle != null) cameraMoveHandle.setAlpha(chromeAlpha);\n        if (cameraResizeHandle != null) cameraResizeHandle.setAlpha(chromeAlpha);\n        if (teleMoveHandle != null) teleMoveHandle.setAlpha(chromeAlpha);\n        if (teleResizeHandle != null) teleResizeHandle.setAlpha(chromeAlpha);\n\n        if (cameraRoot != null) {\n            cameraRoot.setBackground(recording\n                    ? null\n                    : roundedDrawable(0x18000000, 0xCCFFFFFF, dp(15), dp(2)));\n        }\n        if (teleRoot != null) {\n            teleRoot.setBackground(recording\n                    ? null\n                    : roundedDrawable(0x44000000, 0xAA60A5FA, dp(18), dp(2)));\n        }\n        if (tuningRow != null) {\n            tuningRow.setVisibility(recording ? android.view.View.GONE : android.view.View.VISIBLE);\n        }\n        if (controlsRoot != null) controlsRoot.requestLayout();\n    }\n\n'''
if chrome_method not in source:
    if insert_before not in source:
        raise SystemExit('updateInteractivity marker missing')
    source = source.replace(insert_before, chrome_method + insert_before, 1)

replace(
'''            mediaRecorder.start();\n            recording = true;\n            paused = false;\n            segmentationFrozen = false;\n''',
'''            mediaRecorder.start();\n            recording = true;\n            paused = false;\n            recordingClock.start(android.os.SystemClock.elapsedRealtime());\n            segmentationFrozen = false;\n''')

replace(
'''            mainHandler.removeCallbacks(teleScrollLoop);\n            mainHandler.post(teleScrollLoop);\n            updateInteractivity();\n''',
'''            mainHandler.removeCallbacks(teleScrollLoop);\n            mainHandler.post(teleScrollLoop);\n            mainHandler.removeCallbacks(recordingTimerLoop);\n            mainHandler.post(recordingTimerLoop);\n            updateInteractivity();\n''')

replace(
'''                mediaRecorder.pause();\n                paused = true;\n                segmentationFrozen = true;\n''',
'''                mediaRecorder.pause();\n                paused = true;\n                recordingClock.pause(android.os.SystemClock.elapsedRealtime());\n                segmentationFrozen = true;\n''')

replace(
'''                mediaRecorder.resume();\n                paused = false;\n                segmentationFrozen = false;\n''',
'''                mediaRecorder.resume();\n                paused = false;\n                recordingClock.resume(android.os.SystemClock.elapsedRealtime());\n                segmentationFrozen = false;\n''')

replace(
'''        mainHandler.removeCallbacks(teleScrollLoop);\n        recording = false;\n        paused = false;\n''',
'''        mainHandler.removeCallbacks(teleScrollLoop);\n        mainHandler.removeCallbacks(recordingTimerLoop);\n        recording = false;\n        paused = false;\n        recordingClock.reset();\n''')

replace(
'''    private void cleanupRecorderFailure() {\n        recording = false;\n        paused = false;\n''',
'''    private void cleanupRecorderFailure() {\n        mainHandler.removeCallbacks(recordingTimerLoop);\n        recording = false;\n        paused = false;\n        recordingClock.reset();\n''')

replace(
'''    private void updateControls() {\n        if (recButton == null) return;\n        recButton.setEnabled(!recording);\n        pauseButton.setEnabled(recording);\n        stopButton.setEnabled(recording);\n        pauseButton.setText(paused ? "▶ Reprendre" : "Ⅱ Pause");\n        if (!recording) statusText.setText("✥ LIVE prêt · déplace tout · V" + speed);\n        else if (paused) statusText.setText("✥ PAUSE · gestes actifs · V" + speed);\n        else statusText.setText("✥ ● REC · gestes actifs · V" + speed);\n    }\n''',
'''    private void updateControls() {\n        if (recButton == null) return;\n        recButton.setEnabled(!recording);\n        pauseButton.setEnabled(recording);\n        stopButton.setEnabled(recording);\n        pauseButton.setText(paused ? "▶ Reprendre" : "Ⅱ Pause");\n        updateRecordingChrome();\n        if (!recording) {\n            statusText.setText("✥ LIVE prêt · déplace tout · V" + speed);\n        } else {\n            String elapsed = recordingClock.format(android.os.SystemClock.elapsedRealtime());\n            if (paused) statusText.setText("Ⅱ PAUSE " + elapsed + " · gestes actifs");\n            else statusText.setText("● REC " + elapsed + " · gestes actifs");\n        }\n    }\n''')

path.write_text(source, encoding='utf-8')
print('Live recording UI v2.16.2 patch applied')
