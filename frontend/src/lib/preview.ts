import type { TelemetrySample } from './types.ts';

/** Read-only built-in sample data. Never passes for actual vehicle measurements. */
export function previewSamples(): TelemetrySample[] {
  const records: TelemetrySample[] = [];
  for (let i = 0; i < 180; i++) {
    const t = i / 10;
    const speed = Math.max(0, Math.min(96, 16 + 4.3 * t + Math.sin(t * 0.95) * 7));
    const throttle = 25 + Math.sin(t * 0.8) * 18;
    records.push({
      schema_version: '1.0', session_id: 'offline-preview', source: 'simulation',
      elapsed_s: t, timestamp_utc: new Date(Date.UTC(2026, 0, 1) + i * 100).toISOString(),
      engine_rpm: Math.round(740 + 29 * speed + 12 * throttle),
      vehicle_speed_kph: Math.round(speed * 100) / 100,
      coolant_temp_c: 86 + t * 0.3,
      intake_temp_c: 30 + Math.sin(t * 0.4) * 1.7,
      throttle_pct: Math.round(throttle * 10) / 10,
      quality: 'valid',
    });
  }
  return records;
}
