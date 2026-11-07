package com.aram.q50telemetry;

/**
 * Android-independent read-only telemetry state.
 * This class never talks to the vehicle: it accepts scalar readings delivered by
 * the Android sensor service and tracks freshness, peaks and event counts.
 */
public final class SensorState {
    public static final int RPM = 13;
    public static final int COOLANT_C = 14;
    public static final int OIL_TEMP_C = 15;
    public static final int SPEED_KPH = 17;
    public static final int GEAR = 22;
    public static final int THROTTLE_PCT = 23;
    public static final int MAX_TYPE = 63;
    public static final long STALE_AFTER_MS = 3000L;

    private final float[] readings = new float[MAX_TYPE + 1];
    private final long[] lastMs = new long[MAX_TYPE + 1];
    private final long[] counts = new long[MAX_TYPE + 1];
    private final float[] peaks = new float[MAX_TYPE + 1];
    private final boolean[] seen = new boolean[MAX_TYPE + 1];
    private final String[] names = new String[MAX_TYPE + 1];
    private int availableSensors;
    private int subscribedSensors;

    public synchronized void setAvailableSensors(int total, int subscribed) {
        availableSensors = Math.max(0, total);
        subscribedSensors = Math.max(0, subscribed);
    }

    public synchronized void setName(int type, String name) {
        if (validType(type)) names[type] = name == null ? "" : name;
    }

    public synchronized String name(int type) {
        return validType(type) && names[type] != null ? names[type] : "";
    }

    public synchronized boolean accept(int type, float value, long timeMs) {
        if (!validType(type) || Float.isNaN(value) || Float.isInfinite(value) || timeMs < 0) return false;
        // Keep raw readings without guessing model-specific scaling.
        readings[type] = value;
        lastMs[type] = timeMs;
        counts[type]++;
        if (!seen[type] || value > peaks[type]) peaks[type] = value;
        seen[type] = true;
        return true;
    }

    public synchronized boolean seen(int type) {
        return validType(type) && seen[type];
    }

    public synchronized boolean fresh(int type, long nowMs) {
        return seen(type) && nowMs >= lastMs[type] && nowMs - lastMs[type] <= STALE_AFTER_MS;
    }

    public synchronized float raw(int type) {
        return validType(type) ? readings[type] : 0f;
    }

    public synchronized float peak(int type) {
        return validType(type) && seen[type] ? peaks[type] : 0f;
    }

    public synchronized long count(int type) {
        return validType(type) ? counts[type] : 0L;
    }

    public synchronized long lastUpdated(int type) {
        return validType(type) ? lastMs[type] : 0L;
    }

    public synchronized int availableSensors() { return availableSensors; }
    public synchronized int subscribedSensors() { return subscribedSensors; }

    public synchronized long totalEvents() {
        long n = 0;
        for (long c : counts) n += c;
        return n;
    }

    private boolean validType(int type) { return type >= 0 && type <= MAX_TYPE; }
}
