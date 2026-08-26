package com.chasmet.grokteleprompter;

import static org.junit.Assert.assertEquals;

import org.junit.Test;

public class LiveRecordingClockTest {
    @Test
    public void timerFormatsMinutesAndSeconds() {
        LiveRecordingClock clock = new LiveRecordingClock();
        clock.start(1_000L);
        assertEquals("00:00", clock.format(1_999L));
        assertEquals("01:05", clock.format(66_000L));
    }

    @Test
    public void pauseDoesNotCountTowardRecordingTime() {
        LiveRecordingClock clock = new LiveRecordingClock();
        clock.start(0L);
        clock.pause(10_000L);
        assertEquals("00:10", clock.format(35_000L));
        clock.resume(35_000L);
        assertEquals("00:15", clock.format(40_000L));
    }

    @Test
    public void timerSupportsLongRecordings() {
        LiveRecordingClock clock = new LiveRecordingClock();
        clock.start(0L);
        assertEquals("01:02:03", clock.format(3_723_000L));
    }
}
