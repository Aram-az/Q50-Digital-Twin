import type { DiagnosticEvent, TelemetrySample } from './types.ts';

/**
 * Demo-only signal analysis. NOT an OBD diagnostic trouble code reader, and
 * these uncalibrated thresholds must not be used to assess vehicle safety.
 * Return one event per transition into an alert condition, not per sample.
 */
export function analyzeTelemetry(samples: TelemetrySample[]): DiagnosticEvent[] {
  const events: DiagnosticEvent[] = [];
  let overheating = false;
  let critical = false;
  let intakeHot = false;
  let lastTime: number | null = null;

  for (const s of samples) {
    const time = s.elapsed_s;
    // >0.5 seconds is a notable gap at the standard 10 Hz demo rate.
    if (lastTime !== null && time - lastTime > 0.5) {
      events.push({ id: `gap-${time}`, elapsed_s: time, label: 'Telemetry gap detected',
        description: `${(time - lastTime).toFixed(1)} s without a sample. Possible simulated sensor dropout.`, severity: 'warning' });
    }
    lastTime = time;

    if (s.coolant_temp_c >= 105 && !overheating) {
      events.push({ id: `coolant-${time}`, elapsed_s: time, label: 'Coolant threshold exceeded',
        description: `Synthetic coolant reading ${s.coolant_temp_c.toFixed(1)} °C exceeds 105 °C demo threshold.`, severity: 'warning' });
    }
    if (s.coolant_temp_c >= 115 && !critical) {
      events.push({ id: `critical-${time}`, elapsed_s: time, label: 'High coolant alert',
        description: `Synthetic coolant reading ${s.coolant_temp_c.toFixed(1)} °C exceeds 115 °C demo threshold.`, severity: 'critical' });
    }
    if (s.intake_temp_c > 50 && !intakeHot) {
      events.push({ id: `intake-${time}`, elapsed_s: time, label: 'Intake threshold exceeded',
        description: 'Synthetic intake temperature exceeded the demonstration threshold.', severity: 'warning' });
    }
    overheating = s.coolant_temp_c >= 105;
    critical = s.coolant_temp_c >= 115;
    intakeHot = s.intake_temp_c > 50;
  }
  return events.reverse(); // Most recent event first.
}
