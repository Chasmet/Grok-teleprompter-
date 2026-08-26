package com.chasmet.grokteleprompter;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertTrue;

import org.junit.Test;

public class LiveOverlayGeometryTest {
    @Test
    public void resizeCanShrinkAndGrowWithinBounds() {
        assertEquals(120, LiveOverlayGeometry.resized(160, -80, 120, 500));
        assertEquals(245, LiveOverlayGeometry.resized(200, 45, 120, 500));
        assertEquals(500, LiveOverlayGeometry.resized(480, 80, 120, 500));
    }

    @Test
    public void pinchScaleCanShrinkAndGrowWithinBounds() {
        assertEquals(120, LiveOverlayGeometry.scaled(180, 0.5f, 120, 500));
        assertEquals(270, LiveOverlayGeometry.scaled(180, 1.5f, 120, 500));
        assertEquals(500, LiveOverlayGeometry.scaled(400, 2f, 120, 500));
    }

    @Test
    public void movementStaysOnScreen() {
        assertEquals(0, LiveOverlayGeometry.moved(30, -100, 0, 300));
        assertEquals(155, LiveOverlayGeometry.moved(100, 55, 0, 300));
        assertEquals(300, LiveOverlayGeometry.moved(290, 90, 0, 300));
    }

    @Test
    public void pinchDistanceIsStable() {
        assertTrue(Math.abs(LiveOverlayGeometry.distance(0f, 0f, 3f, 4f) - 5f) < 0.001f);
    }
}