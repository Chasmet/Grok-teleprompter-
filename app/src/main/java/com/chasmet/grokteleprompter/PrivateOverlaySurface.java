package com.chasmet.grokteleprompter;

import android.content.Context;
import android.graphics.Canvas;
import android.graphics.Color;
import android.graphics.PixelFormat;
import android.graphics.PorterDuff;
import android.os.Build;
import android.view.SurfaceHolder;
import android.view.SurfaceView;
import android.view.View;

/**
 * Surface matériel réservé à l'interface opérateur du mode Live.
 *
 * <p>Contrairement à FLAG_SECURE appliqué à une fenêtre d'overlay complète, le drapeau
 * sécurisé est ici porté par la surface qui contient réellement les pixels privés. La
 * fenêtre parente reste transparente : le téléprompteur et les commandes restent visibles
 * sur le téléphone, tandis que MediaProjection ne reçoit que l'application située dessous.
 * La caméra détourée conserve sa propre fenêtre non sécurisée et reste donc enregistrée.</p>
 */
final class PrivateOverlaySurface extends SurfaceView implements SurfaceHolder.Callback {
    interface Renderer {
        void draw(Canvas canvas, int width, int height);
    }

    private final Renderer renderer;
    private boolean surfaceReady;
    private boolean renderScheduled;

    private final Runnable renderFrame = new Runnable() {
        @Override
        public void run() {
            renderScheduled = false;
            drawFrame();
        }
    };

    PrivateOverlaySurface(Context context, Renderer renderer) {
        super(context);
        this.renderer = renderer;

        // Ces trois réglages doivent être appliqués avant l'attachement de la fenêtre.
        setZOrderOnTop(true);
        setSecure(true);
        getHolder().setFormat(PixelFormat.TRANSLUCENT);
        getHolder().addCallback(this);

        setClickable(false);
        setFocusable(false);
        setImportantForAccessibility(View.IMPORTANT_FOR_ACCESSIBILITY_NO);
        setWillNotDraw(true);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.UPSIDE_DOWN_CAKE) {
            setSurfaceLifecycle(SURFACE_LIFECYCLE_FOLLOWS_ATTACHMENT);
        }
    }

    void requestRender() {
        if (!surfaceReady || renderScheduled) return;
        renderScheduled = true;
        postOnAnimation(renderFrame);
    }

    void releaseRenderer() {
        removeCallbacks(renderFrame);
        renderScheduled = false;
        surfaceReady = false;
        getHolder().removeCallback(this);
    }

    private void drawFrame() {
        if (!surfaceReady || !getHolder().getSurface().isValid()) return;
        Canvas canvas = null;
        try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                canvas = getHolder().lockHardwareCanvas();
            } else {
                canvas = getHolder().lockCanvas();
            }
        } catch (RuntimeException hardwareFailure) {
            try {
                canvas = getHolder().lockCanvas();
            } catch (RuntimeException ignored) {
                return;
            }
        }
        if (canvas == null) return;
        try {
            canvas.drawColor(Color.TRANSPARENT, PorterDuff.Mode.CLEAR);
            renderer.draw(canvas, canvas.getWidth(), canvas.getHeight());
        } catch (RuntimeException ignored) {
            // Une mise en page en cours peut rendre une trame invalide sans arrêter le Live.
        } finally {
            try {
                getHolder().unlockCanvasAndPost(canvas);
            } catch (RuntimeException ignored) {
                // La fenêtre peut avoir été retirée pendant le rendu.
            }
        }
    }

    @Override
    public void surfaceCreated(SurfaceHolder holder) {
        surfaceReady = true;
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
            try {
                holder.getSurface().setFrameRate(
                        60f,
                        android.view.Surface.FRAME_RATE_COMPATIBILITY_DEFAULT
                );
            } catch (RuntimeException ignored) {
                // Le constructeur peut ignorer la préférence de fréquence.
            }
        }
        requestRender();
    }

    @Override
    public void surfaceChanged(SurfaceHolder holder, int format, int width, int height) {
        surfaceReady = true;
        requestRender();
    }

    @Override
    public void surfaceDestroyed(SurfaceHolder holder) {
        surfaceReady = false;
        removeCallbacks(renderFrame);
        renderScheduled = false;
    }
}
