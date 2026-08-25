package com.chasmet.grokteleprompter;

import android.graphics.Bitmap;
import android.graphics.BitmapFactory;
import android.util.Base64;
import android.webkit.WebView;

import com.google.mlkit.vision.common.InputImage;
import com.google.mlkit.vision.segmentation.Segmentation;
import com.google.mlkit.vision.segmentation.selfie.SelfieSegmenterOptions;

import java.io.ByteArrayOutputStream;
import java.nio.ByteBuffer;
import java.nio.ByteOrder;
import java.nio.FloatBuffer;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.atomic.AtomicBoolean;

/**
 * Petit pont natif pour le masque de la caméra uniquement. Les images/vidéos importées
 * ne passent jamais par ce moteur. Un seul travail est autorisé à la fois afin que la
 * caméra et le téléprompteur gardent toujours la priorité.
 */
final class NativeCameraSegmenter implements AutoCloseable {
    private static final int MAX_JPEG_BYTES = 900_000;
    private final WebView webView;
    private final com.google.mlkit.vision.segmentation.Segmenter segmenter;
    private final ExecutorService worker = Executors.newSingleThreadExecutor();
    private final AtomicBoolean busy = new AtomicBoolean(false);
    private volatile boolean closed;
    private float[] previousMask;

    NativeCameraSegmenter(WebView webView) {
        this.webView = webView;
        SelfieSegmenterOptions options = new SelfieSegmenterOptions.Builder()
                .setDetectorMode(SelfieSegmenterOptions.STREAM_MODE)
                .enableRawSizeMask()
                .build();
        segmenter = Segmentation.getClient(options);
    }

    boolean submit(String jpegBase64, int requestId) {
        if (closed || jpegBase64 == null || jpegBase64.length() > MAX_JPEG_BYTES * 2
                || !busy.compareAndSet(false, true)) {
            return false;
        }
        worker.execute(() -> decodeAndProcess(jpegBase64, requestId));
        return true;
    }

    private void decodeAndProcess(String encoded, int requestId) {
        Bitmap source = null;
        try {
            byte[] jpeg = Base64.decode(encoded, Base64.DEFAULT);
            if (jpeg.length == 0 || jpeg.length > MAX_JPEG_BYTES) {
                throw new IllegalArgumentException("Image caméra invalide");
            }
            source = BitmapFactory.decodeByteArray(jpeg, 0, jpeg.length);
            if (source == null) throw new IllegalArgumentException("Image caméra illisible");
            Bitmap ownedSource = source;
            segmenter.process(InputImage.fromBitmap(source, 0))
                    .addOnSuccessListener(worker, result -> {
                        try {
                            int width = result.getWidth();
                            int height = result.getHeight();
                            ByteBuffer bytes = result.getBuffer();
                            bytes.rewind();
                            FloatBuffer floats = bytes.order(ByteOrder.nativeOrder()).asFloatBuffer();
                            float[] probabilities = new float[width * height];
                            floats.get(probabilities);
                            smoothTemporally(probabilities);
                            String mask = encodeMask(probabilities, width, height);
                            dispatchMask(requestId, mask);
                        } catch (Exception error) {
                            dispatchError(requestId);
                        } finally {
                            if (!ownedSource.isRecycled()) ownedSource.recycle();
                            busy.set(false);
                        }
                    })
                    .addOnFailureListener(worker, error -> {
                        if (!ownedSource.isRecycled()) ownedSource.recycle();
                        busy.set(false);
                        dispatchError(requestId);
                    });
        } catch (Exception error) {
            if (source != null && !source.isRecycled()) source.recycle();
            busy.set(false);
            dispatchError(requestId);
        }
    }

    private void smoothTemporally(float[] current) {
        float[] previous = previousMask;
        if (previous != null && previous.length == current.length) {
            for (int index = 0; index < current.length; index++) {
                float value = current[index];
                float history = previous[index];
                float difference = Math.abs(value - history);
                float historyWeight;
                if (difference < .035f) historyWeight = .24f;
                else if (difference < .08f) historyWeight = .18f;
                else if (difference < .16f) historyWeight = .09f;
                else if (difference < .28f) historyWeight = .025f;
                else historyWeight = .004f;
                if (value < history && difference > .08f) historyWeight *= .55f;
                float stable = value * (1f - historyWeight) + history * historyWeight;
                if (difference > .12f) {
                    float motion = Math.min(1f, (difference - .12f) / .40f);
                    stable = .5f + (stable - .5f) * (1f + .14f * motion);
                }
                current[index] = clamp(stable);
            }
        }
        previousMask = current;
    }

    private static String encodeMask(float[] mask, int width, int height) {
        float[] blurred = blur(mask, width, height);
        int[] pixels = new int[mask.length];
        final float edge0 = .39f;
        final float edge1 = .59f;
        for (int index = 0; index < mask.length; index++) {
            float original = mask[index];
            float sharp = original > .04f && original < .96f
                    ? clamp(original + .72f * (original - blurred[index])) : original;
            float t = clamp((sharp - edge0) / (edge1 - edge0));
            float alpha = t * t * (3f - 2f * t);
            alpha = cleanMatteAlpha(alpha);
            int alphaByte = Math.round(255f * alpha);
            pixels[index] = (alphaByte << 24) | 0x00ffffff;
        }
        Bitmap bitmap = Bitmap.createBitmap(pixels, width, height, Bitmap.Config.ARGB_8888);
        ByteArrayOutputStream output = new ByteArrayOutputStream(Math.max(4096, width * height / 3));
        bitmap.compress(Bitmap.CompressFormat.PNG, 100, output);
        bitmap.recycle();
        return Base64.encodeToString(output.toByteArray(), Base64.NO_WRAP);
    }

    private static float[] blur(float[] source, int width, int height) {
        float[] horizontal = new float[source.length];
        float[] output = new float[source.length];
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
                        + 2f * horizontal[row + x] + horizontal[next + x]) * .25f;
            }
        }
        return output;
    }

    private static float clamp(float value) {
        return Math.max(0f, Math.min(1f, value));
    }

    private static float cleanMatteAlpha(float alpha) {
        if (alpha <= .035f) return 0f;
        if (alpha >= .965f) return 1f;
        float t = clamp((alpha - .07f) / .86f);
        return t * t * (3f - 2f * t);
    }

    private void dispatchMask(int requestId, String encodedPng) {
        if (closed) return;
        webView.post(() -> {
            if (!closed) webView.evaluateJavascript(
                    "window.GrokSegmentation&&window.GrokSegmentation.onMask("
                            + requestId + ",'data:image/png;base64," + encodedPng + "')", null);
        });
    }

    private void dispatchError(int requestId) {
        if (closed) return;
        webView.post(() -> {
            if (!closed) webView.evaluateJavascript(
                    "window.GrokSegmentation&&window.GrokSegmentation.onError("
                            + requestId + ")", null);
        });
    }

    @Override
    public void close() {
        closed = true;
        previousMask = null;
        segmenter.close();
        worker.shutdownNow();
    }
}
