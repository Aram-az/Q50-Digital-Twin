import assert from 'node:assert/strict';
import test from 'node:test';
import { generateShowcaseSession } from '../src/lib/showcase.ts';
import { analyzeTelemetry } from '../src/lib/diagnostics.ts';

test('public showcase always produces synthetic records with a stable schema', () => {
  const data = generateShowcaseSession('mixed', 15, 'test-session');
  assert.equal(data.length, 151);
  assert.equal(data[0].session_id, 'test-session');
  assert.equal(data[0].source, 'simulation');
  assert.equal(data.at(-1).elapsed_s, 15);
  assert.ok(data.every(s => Number.isFinite(s.engine_rpm) && s.vehicle_speed_kph >= 0 && s.throttle_pct <= 100));
});

test('same scenario creates repeatable output', () => {
  assert.deepEqual(generateShowcaseSession('cruise', 15), generateShowcaseSession('cruise', 15));
});

test('idle scenario never displays moving speed', () => {
  assert.ok(generateShowcaseSession('idle', 15).every(s => s.vehicle_speed_kph === 0));
});

test('overheat demo raises warning and critical threshold events', () => {
  const events = analyzeTelemetry(generateShowcaseSession('overheat', 15));
  assert.ok(events.some(e => e.label === 'Coolant threshold exceeded'));
  assert.ok(events.some(e => e.label === 'High coolant alert'));
});

test('dropout scenario preserves a timestamp gap and raises an event', () => {
  const data = generateShowcaseSession('sensor_dropout', 15);
  assert.ok(data.some((s, i) => i > 0 && s.elapsed_s - data[i-1].elapsed_s > 0.5));
  assert.ok(analyzeTelemetry(data).some(e => e.label === 'Telemetry gap detected'));
});

test('duration bounds protect against huge browser allocations', () => {
  assert.equal(generateShowcaseSession('mixed', 999).length, 901);
  assert.equal(generateShowcaseSession('mixed', -12).length, 51);
});
