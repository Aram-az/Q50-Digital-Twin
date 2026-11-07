package com.aram.q50telemetry;

import android.content.Context;
import android.graphics.Canvas;
import android.graphics.Color;
import android.graphics.Paint;
import android.graphics.RectF;
import android.graphics.Typeface;
import android.os.SystemClock;
import android.view.MotionEvent;
import android.view.View;

/**
 * 800x480 native instrument cluster; Canvas only, no WebView or modern APIs.
 * Fits other resolutions with UNIFORM scale + letterboxing, avoiding gauge distortion.
 */
public final class TelemetryView extends View {
    private static final int WHITE = 0xFFE9EAEB;
    private static final int MUTED = 0xFF89919A;
    private static final int RED = 0xFFF3403D;
    private static final int AMBER = 0xFFFFC164;
    private static final int DARK = 0xFF06090D;
    private static final int RING = 0xFF353D45;
    private static final int BLACK = 0xFF10161B;
    private static final float DESIGN_W = 800f, DESIGN_H = 480f;
    private static final int[] AUDIT_TYPES = {13,17,14,15,23,22,20,21,36,37,38,39};
    private static final String[] AUDIT_NAMES = {"RPM", "SPEED", "COOLANT", "OIL TEMP", "THROTTLE", "GEAR", "G LAT", "G LONG", "TP FR", "TP FL", "TP RR", "TP RL"};

    private final SensorState state;
    private final Paint p = new Paint(Paint.ANTI_ALIAS_FLAG);
    private final RectF rect = new RectF();
    private boolean audit = false;
    private boolean demo = false;
    private String message = "STARTING SENSOR AUDIT";
    private float shownRpm = 0f, shownSpeed = 0f;
    private long startedMs = SystemClock.elapsedRealtime();

    // Exactly ONE scheduled refresh. Scheduling a new timer from every onDraw()
    // would build an unbounded queue when sensor callbacks arrive frequently.
    private final Runnable refresh = new Runnable() {
        @Override public void run() {
            invalidate();
            postDelayed(this, demo ? 50L : 250L);
        }
    };

    @Override protected void onAttachedToWindow() {
        super.onAttachedToWindow();
        removeCallbacks(refresh);
        post(refresh);
    }

    @Override protected void onDetachedFromWindow() {
        removeCallbacks(refresh);
        super.onDetachedFromWindow();
    }

    public TelemetryView(Context context, SensorState state) {
        super(context);
        this.state = state;
        setBackgroundColor(DARK);
        setClickable(true);
        p.setTypeface(Typeface.create(Typeface.MONOSPACE, Typeface.BOLD));
    }

    public void setMessage(String message) {
        this.message = message == null ? "" : message;
        invalidate();
    }

    /** Tap = instrument/audit switch; long press = deliberate offline demo toggle. */
    @Override public boolean onTouchEvent(MotionEvent event) {
        if (event.getAction() == MotionEvent.ACTION_UP) {
            if (event.getEventTime() - event.getDownTime() >= 800L) {
                demo = !demo;
                if (demo) startedMs = SystemClock.elapsedRealtime();
                shownRpm = 0f;
                shownSpeed = 0f;
            } else {
                audit = !audit;
            }
            invalidate();
        }
        return true;
    }

    @Override protected void onDraw(Canvas canvas) {
        super.onDraw(canvas);
        int width = getWidth(), height = getHeight();
        if (width <= 0 || height <= 0) return;
        canvas.drawColor(DARK);
        float scale = Math.min(width / DESIGN_W, height / DESIGN_H);
        canvas.save();
        canvas.translate((width - DESIGN_W * scale) / 2f,
                         (height - DESIGN_H * scale) / 2f);
        canvas.scale(scale, scale);
        long now = SystemClock.elapsedRealtime();
        drawFrame(canvas, now);
        if (audit) drawAudit(canvas, now);
        else drawCluster(canvas, now);
        canvas.restore();
    }

    private void drawFrame(Canvas canvas, long now) {
        fill(canvas, 0, 0, 800, 480, DARK);
        fill(canvas, 0, 0, 800, 4, RED);
        label(canvas, "Q50  /  RED SPORT", 24, 34, 21, WHITE, Paint.Align.LEFT);
        label(canvas, "INSTRUMENT LAB      [ V0.1 ]", 775, 32, 13, MUTED, Paint.Align.RIGHT);
        line(canvas, 24, 53, 776, 53, 1f, RING);
        if (demo) {
            fill(canvas, 228, 8, 185, 33, AMBER);
            label(canvas, "SIMULATED / NOT LIVE", 320, 30, 13, BLACK, Paint.Align.CENTER);
        }
        label(canvas, "READ-ONLY  /  ENGINEERING PROTOTYPE", 25, 468, 11, MUTED, Paint.Align.LEFT);
        label(canvas, "TAP: AUDIT  /  HOLD: DEMO", 775, 468, 11, MUTED, Paint.Align.RIGHT);
    }

    private float reading(int type, long now, float demoValue) {
        if (demo) return demoValue;
        return state.fresh(type, now) ? state.raw(type) : Float.NaN;
    }

    private void drawCluster(Canvas canvas, long now) {
        float time = (now - startedMs) / 1000f;
        float rpm = reading(SensorState.RPM, now,
                            2700f + 2100f * (float)Math.sin(time * .75));
        float speed = reading(SensorState.SPEED_KPH, now,
                              65f + 38f * (float)Math.sin(time * .31));
        float coolant = reading(SensorState.COOLANT_C, now, 91f);
        float oil = reading(SensorState.OIL_TEMP_C, now, 99f);
        float throttle = reading(SensorState.THROTTLE_PCT, now,
                                39f + 28f * (float)Math.sin(time * 0.84));
        float gear = reading(SensorState.GEAR, now, 4f);

        float targetRpm = Float.isNaN(rpm) ? 0 : clamp(rpm, 0, 8000);
        float targetSpeed = Float.isNaN(speed) ? 0 : clamp(speed, 0, 260);
        shownRpm += (targetRpm - shownRpm) * .32f;
        shownSpeed += (targetSpeed - shownSpeed) * .32f;

        drawDial(canvas, 217, 251, 159, shownRpm, rpm, 8000, "RPM", "x1000", 8, true);
        drawDial(canvas, 582, 251, 153, shownSpeed, speed, 260, "SPEED", "km/h", 13, false);

        // RPM peak is always raw sensor data, never silently simulated.
        label(canvas, "PEAK RPM", 48, 431, 12, MUTED, Paint.Align.LEFT);
        label(canvas, state.seen(SensorState.RPM) && !demo ? intText(state.peak(SensorState.RPM)) : "--",
              165, 432, 19, WHITE, Paint.Align.RIGHT);
        label(canvas, "COOLANT", 255, 431, 12, MUTED, Paint.Align.LEFT);
        label(canvas, safeInt(coolant), 355, 432, 19, WHITE, Paint.Align.RIGHT);
        label(canvas, "OIL", 399, 431, 12, MUTED, Paint.Align.LEFT);
        label(canvas, safeInt(oil), 469, 432, 19, WHITE, Paint.Align.RIGHT);
        label(canvas, "THR", 516, 431, 12, MUTED, Paint.Align.LEFT);
        label(canvas, safeInt(throttle), 585, 432, 19, WHITE, Paint.Align.RIGHT);
        label(canvas, "GEAR", 625, 431, 12, MUTED, Paint.Align.LEFT);
        label(canvas, safeGear(gear), 730, 432, 19, WHITE, Paint.Align.RIGHT);

        if (!demo && !state.fresh(SensorState.RPM, now) && !state.fresh(SensorState.SPEED_KPH, now)) {
            fill(canvas, 236, 355, 330, 25, 0xFF402526);
            label(canvas, "NO FRESH VEHICLE TELEMETRY", 400, 373, 15, WHITE, Paint.Align.CENTER);
        }
        label(canvas, demo ? "DEMO DATA / NO VEHICLE LINK" : message,
              400, 398, 12, demo ? AMBER : MUTED, Paint.Align.CENTER);
    }

    private void drawDial(Canvas c, float cx, float cy, float r, float displayed,
                          float observed, float max, String caption, String unit,
                          int intervals, boolean redZone) {
        ring(c, cx, cy, r + 9, 7f, 0xFF252A31);
        ring(c, cx, cy, r + 2, 2f, 0xFF78818A);
        disc(c, cx, cy, r - 4, 0xFF0C1117);
        ring(c, cx, cy, r - 26, 1f, 0xFF363E46);
        for (int i = 0; i <= intervals * 5; i++) {
            float fraction = i / (float)(intervals * 5);
            float angle = (float)Math.toRadians(135f + 270f * fraction);
            boolean major = i % 5 == 0;
            float inner = r - (major ? 25f : 17f);
            float outer = r - 7f;
            float x1 = cx + (float)Math.cos(angle) * inner;
            float y1 = cy + (float)Math.sin(angle) * inner;
            float x2 = cx + (float)Math.cos(angle) * outer;
            float y2 = cy + (float)Math.sin(angle) * outer;
            int color = redZone && fraction >= .85f ? RED : (major ? WHITE : RING);
            line(c, x1, y1, x2, y2, major ? 2.2f : 1f, color);
            if (major) {
                int val = Math.round(max * fraction);
                String n = redZone ? String.valueOf(val / 1000) : String.valueOf(val);
                float rr = r - 44f;
                label(c, n, cx + (float)Math.cos(angle) * rr,
                      cy + (float)Math.sin(angle) * rr + 5, 13, MUTED, Paint.Align.CENTER);
            }
        }
        // Mechanical red pointer. Never show unknown data as an asserted value.
        float f = clamp(displayed / max, 0f, 1f);
        float a = (float)Math.toRadians(135f + 270f * f);
        line(c, cx - 8f * (float)Math.cos(a), cy - 8f * (float)Math.sin(a),
             cx + (r - 39) * (float)Math.cos(a), cy + (r - 39) * (float)Math.sin(a), 4.5f, RED);
        disc(c, cx, cy, 10f, 0xFF8A2028);
        disc(c, cx, cy, 5f, WHITE);
        label(c, caption, cx, cy - 42f, 16, MUTED, Paint.Align.CENTER);
        label(c, Float.isNaN(observed) ? "--" : intText(observed),
              cx, cy + 55f, 49, WHITE, Paint.Align.CENTER);
        label(c, unit, cx, cy + 74f, 13, RED, Paint.Align.CENTER);
    }

    private void drawAudit(Canvas c, long now) {
        label(c, "LIVE SENSOR AUDIT", 30, 86, 24, WHITE, Paint.Align.LEFT);
        label(c, "Mapped IDs are hypotheses until validated on this head unit", 30, 106, 12, AMBER, Paint.Align.LEFT);
        for (int i=0; i<AUDIT_TYPES.length; i++) {
            int col = i / 6, row = i % 6;
            int x = col == 0 ? 30 : 410;
            int y = 148 + row * 42;
            int type = AUDIT_TYPES[i];
            boolean fresh = state.fresh(type, now);
            String value = fresh ? String.valueOf(Math.round(state.raw(type) * 100f) / 100f) : "--";
            label(c, "[" + type + "] " + AUDIT_NAMES[i], x, y, 14, MUTED, Paint.Align.LEFT);
            label(c, value, x + 355, y, 19, fresh ? WHITE : AMBER, Paint.Align.RIGHT);
            line(c, x, y+12, x+355, y+12, 1f, RING);
        }
        label(c, "SENSORS LISTED: " + state.availableSensors(), 30, 432, 13, MUTED, Paint.Align.LEFT);
        label(c, "SUBSCRIBED: " + state.subscribedSensors(), 260, 432, 13, MUTED, Paint.Align.LEFT);
        label(c, "EVENTS: " + state.totalEvents(), 505, 432, 13, MUTED, Paint.Align.LEFT);
        // Audit screen deliberately continues showing raw live readings during demo mode.
        if (demo) label(c, "AUDIT VALUES ARE RAW / DEMO DOES NOT REPLACE THEM", 400, 452, 12, AMBER, Paint.Align.CENTER);
    }

    private void fill(Canvas c,float left,float top,float right,float bottom,int color) {
        p.setColor(color); p.setStyle(Paint.Style.FILL); c.drawRect(left, top, right, bottom, p);
    }
    private void disc(Canvas c,float x,float y,float r,int color) {
        p.setColor(color); p.setStyle(Paint.Style.FILL); c.drawCircle(x,y,r,p);
    }
    private void ring(Canvas c,float x,float y,float r,float width,int color) {
        p.setColor(color); p.setStyle(Paint.Style.STROKE); p.setStrokeWidth(width);
        c.drawCircle(x,y,r,p); p.setStyle(Paint.Style.FILL);
    }
    private void line(Canvas c,float x,float y,float x2,float y2,float width,int color) {
        p.setColor(color); p.setStyle(Paint.Style.STROKE); p.setStrokeWidth(width);
        c.drawLine(x,y,x2,y2,p); p.setStyle(Paint.Style.FILL);
    }
    private void label(Canvas c,String txt,float x,float y,float size,int color,Paint.Align align) {
        p.setStyle(Paint.Style.FILL); p.setTypeface(Typeface.create(Typeface.MONOSPACE, Typeface.BOLD));
        p.setTextAlign(align); p.setTextSize(size); p.setColor(color);
        c.drawText(txt,x,y,p);
    }
    private static float clamp(float f,float lo,float hi) { return Math.max(lo, Math.min(hi,f)); }
    private static String intText(float value) { return String.valueOf(Math.round(value)); }
    private static String safeInt(float value) { return Float.isNaN(value) ? "--" : intText(value); }
    private static String safeGear(float value) {
        if (Float.isNaN(value)) return "--";
        switch (Math.round(value)) {
            case 1: return "P";
            case 2: return "R";
            case 3: return "N";
            case 4: return "D";
            default: return String.valueOf(Math.round(value));
        }
    }
}
