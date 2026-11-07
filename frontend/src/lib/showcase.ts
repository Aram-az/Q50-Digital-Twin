import type { DemoScenario, TelemetrySample } from './types.ts';

/**
 * Standalone, deterministic demo for GitHub Pages. It never reads device sensors,
 * fetches external URLs, or communicates with a backend or a car.
 * All data is synthetic and its 105/115 C thresholds are illustrative only.
 */
export function generateShowcaseSession(
  scenario: DemoScenario, durationSeconds: number, sessionId = 'browser-showcase',
): TelemetrySample[] {
  const duration = Math.max(5, Math.min(90, Math.round(durationSeconds)));
  const frames: TelemetrySample[] = [];
  for (let index = 0; index <= duration * 10; index++) {
    const elapsed = index / 10;
    const progress = elapsed / duration;
    // Skip a contiguous interval to make timestamp-based replay show a real data gap.
    if (scenario === 'sensor_dropout' && progress > 0.36 && progress < 0.56) continue;

    const oscillation = Math.sin(elapsed * 0.68) * 5 + Math.sin(elapsed * 0.19) * 3;
    let speed = 18 + progress * 68 + oscillation;
    let throttle = 24 + 22 * (0.5 + 0.5 * Math.sin(elapsed * 0.83));
    if (scenario === 'idle') { speed = 0; throttle = 4 + Math.sin(elapsed * 0.7); }
    if (scenario === 'cruise') { speed = 76 + 2.5 * Math.sin(elapsed * 0.31); throttle = 23 + 3 * Math.sin(elapsed * 0.5); }
    if (scenario === 'acceleration') { speed = 4 + 115 * progress; throttle = 34 + 60 * Math.min(1, progress * 3); }

    const roundedSpeed = Math.max(0, Math.min(200, speed));
    const roundedThrottle = Math.max(0, Math.min(100, throttle));
    const rpm = scenario === 'idle'
      ? 730 + 45 * Math.sin(elapsed * 0.9)
      : 820 + roundedSpeed * 25 + roundedThrottle * 15 + 120 * Math.sin(elapsed * 1.1);
    const coolant = scenario === 'overheat'
      ? 87 + progress * 36 + Math.sin(elapsed * 0.3) * 0.5
      : 86 + progress * 4 + Math.sin(elapsed * 0.2);

    frames.push({
      schema_version: '1.0', session_id: sessionId, source: 'simulation',
      elapsed_s: elapsed,
      timestamp_utc: new Date(Date.UTC(2026, 0, 1) + index * 100).toISOString(),
      engine_rpm: Math.round(Math.max(550, Math.min(7000, rpm)) * 10) / 10,
      vehicle_speed_kph: Math.round(roundedSpeed * 100) / 100,
      coolant_temp_c: Math.round(coolant * 10) / 10,
      intake_temp_c: Math.round((30 + 2.5 * Math.sin(elapsed * 0.4)) * 10) / 10,
      throttle_pct: Math.round(roundedThrottle * 10) / 10,
      quality: 'valid',
    });
  }
  return frames;
}
