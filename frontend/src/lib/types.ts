// TypeScript contract mirrors backend/app/schemas.py (Phase 3).
export interface TelemetrySample {
  id?: number;
  schema_version: '1.0';
  session_id: string;
  source: 'simulation';
  elapsed_s: number;
  timestamp_utc: string;
  engine_rpm: number;
  vehicle_speed_kph: number;
  coolant_temp_c: number;
  intake_temp_c: number;
  throttle_pct: number;
  quality: 'valid';
}

export interface DrivingSession {
  session_id: string;
  label: string;
  source: string;
  created_at: string;
  sample_count: number;
}

export interface SessionStats {
  session_id: string;
  count: number;
  first_elapsed_s: number | null;
  last_elapsed_s: number | null;
  max_engine_rpm: number | null;
  max_vehicle_speed_kph: number | null;
}

export type DemoScenario = 'mixed' | 'idle' | 'cruise' | 'acceleration' | 'overheat' | 'sensor_dropout';
export type Severity = 'critical' | 'warning' | 'info';
export interface DiagnosticEvent {
  id: string;
  elapsed_s: number;
  label: string;
  description: string;
  severity: Severity;
}
