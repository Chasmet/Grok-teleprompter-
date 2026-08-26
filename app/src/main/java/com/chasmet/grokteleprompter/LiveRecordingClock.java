package com.chasmet.grokteleprompter;

import java.util.Locale;

final class LiveRecordingClock {
    private long startedAtMs = -1L;
    private long pauseStartedAtMs = -1L;
    private long pausedTotalMs;

    void start(long nowMs) {
        startedAtMs = nowMs;
        pauseStartedAtMs = -1L;
        pausedTotalMs = 0L;
    }

    void pause(long nowMs) {
        if (startedAtMs >= 0L && pauseStartedAtMs < 0L) pauseStartedAtMs = nowMs;
    }

    void resume(long nowMs) {
        if (pauseStartedAtMs >= 0L) {
            pausedTotalMs += Math.max(0L, nowMs - pauseStartedAtMs);
            pauseStartedAtMs = -1L;
        }
    }

    long elapsedMs(long nowMs) {
        if (startedAtMs < 0L) return 0L;
        long endMs = pauseStartedAtMs >= 0L ? pauseStartedAtMs : nowMs;
        return Math.max(0L, endMs - startedAtMs - pausedTotalMs);
    }

    String format(long nowMs) {
        long totalSeconds = elapsedMs(nowMs) / 1000L;
        long hours = totalSeconds / 3600L;
        long minutes = (totalSeconds % 3600L) / 60L;
        long seconds = totalSeconds % 60L;
        if (hours > 0L) {
            return String.format(Locale.FRANCE, "%02d:%02d:%02d", hours, minutes, seconds);
        }
        return String.format(Locale.FRANCE, "%02d:%02d", minutes, seconds);
    }

    void reset() {
        startedAtMs = -1L;
        pauseStartedAtMs = -1L;
        pausedTotalMs = 0L;
    }
}
