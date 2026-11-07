package com.aram.q50telemetry;

import android.app.Activity;
import android.content.Context;
import android.hardware.Sensor;
import android.hardware.SensorEvent;
import android.hardware.SensorEventListener;
import android.hardware.SensorManager;
import android.os.Bundle;
import android.os.SystemClock;
import android.view.WindowManager;
import java.util.List;

/**
 * Read-only interface to the legacy InTouch vendor sensors.
 * No vehicle commands, network operations or external storage access are used.
 */
public final class Q50Activity extends Activity implements SensorEventListener {
    private SensorManager manager;
    private SensorState state;
    private TelemetryView display;
    private long lastRedraw;

    @Override public void onCreate(Bundle bundle) {
        super.onCreate(bundle);
        getWindow().setFlags(WindowManager.LayoutParams.FLAG_FULLSCREEN,
                             WindowManager.LayoutParams.FLAG_FULLSCREEN);
        getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
        state = new SensorState();
        display = new TelemetryView(this, state);
        setContentView(display);
        manager = (SensorManager)getSystemService(Context.SENSOR_SERVICE);
    }

    @Override public void onResume() {
        super.onResume();
        subscribe();
    }

    /** Unsubscribe on pause: avoids accumulating duplicate listeners on app relaunch. */
    @Override public void onPause() {
        if (manager != null) {
            try { manager.unregisterListener(this); } catch (RuntimeException ignored) { }
        }
        super.onPause();
    }

    private void subscribe() {
        if (manager == null) { display.setMessage("NO ANDROID SENSOR SERVICE"); return; }
        try { manager.unregisterListener(this); } catch (RuntimeException ignored) { }
        int allCount = 0;
        int subscribed = 0;
        try {
            List<Sensor> all = manager.getSensorList(Sensor.TYPE_ALL);
            if (all != null) for (Sensor sensor : all) {
                allCount++;
                int type = sensor.getType();
                state.setName(type, sensor.getName());
                // Vendor sensor mapping is provisional and specific to legacy InTouch.
                if (type < 12 || type > 53) continue;
                int rate = (type == 13 || type == 17 || type == 23)
                        ? SensorManager.SENSOR_DELAY_GAME : 200000;
                try {
                    if (manager.registerListener(this, sensor, rate)) subscribed++;
                } catch (RuntimeException ignored) { }
            }
            state.setAvailableSensors(allCount, subscribed);
            display.setMessage(subscribed > 0 ? "SENSORS FOUND / VERIFY VALUES"
                                              : "NO IVI VEHICLE SENSORS FOUND");
        } catch (RuntimeException error) {
            display.setMessage("SENSOR QUERY FAILED");
        }
        display.invalidate();
    }

    @Override public void onSensorChanged(SensorEvent event) {
        if (event == null || event.sensor == null || event.values == null || event.values.length == 0) return;
        long now = SystemClock.elapsedRealtime();
        if (!state.accept(event.sensor.getType(), event.values[0], now)) return;
        // Throttle expensive Canvas redraws while still recording every sensor event.
        if (now - lastRedraw >= 50L) {
            lastRedraw = now;
            display.invalidate();
        }
    }

    @Override public void onAccuracyChanged(Sensor sensor, int accuracy) { }
}
