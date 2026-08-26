package com.chasmet.grokteleprompter;

final class LiveOverlayGeometry {
    private LiveOverlayGeometry() {}

    static int clamp(int value, int min, int max) {
        return Math.max(min, Math.min(max, value));
    }

    static int resized(int startSize, int delta, int minSize, int maxSize) {
        return clamp(startSize + delta, minSize, Math.max(minSize, maxSize));
    }

    static int scaled(int startSize, float scale, int minSize, int maxSize) {
        return clamp(Math.round(startSize * scale), minSize, Math.max(minSize, maxSize));
    }

    static int moved(int startPosition, int delta, int minPosition, int maxPosition) {
        return clamp(startPosition + delta, minPosition, Math.max(minPosition, maxPosition));
    }

    static float distance(float x1, float y1, float x2, float y2) {
        float dx = x2 - x1;
        float dy = y2 - y1;
        return (float) Math.hypot(dx, dy);
    }
}