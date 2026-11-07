import test from 'node:test';
import assert from 'node:assert/strict';
import { analyzeTelemetry } from '../src/lib/diagnostics.ts';

const s = (time, coolant, intake=29) => ({elapsed_s:time,coolant_temp_c:coolant,intake_temp_c:intake});

test('normal telemetry has no alerts', () => {
  assert.deepEqual(analyzeTelemetry([s(0,90),s(.1,92),s(.2,94)]), []);
});
test('single alert on crossing threshold, not every sample', () => {
  const events = analyzeTelemetry([s(0,100),s(.1,106),s(.2,109),s(.3,110)]);
  assert.equal(events.length,1);
  assert.equal(events[0].severity,'warning');
});
test('warning followed by critical', () => {
  const events = analyzeTelemetry([s(0,104),s(.1,105),s(.2,117)]);
  assert.equal(events.length,2);
  assert.equal(events[0].severity,'critical');
});
test('detects missing sample gap', () => {
  const events = analyzeTelemetry([s(0,90),s(.1,90),s(2.1,90)]);
  assert.equal(events.length,1);
  assert.match(events[0].label,/gap/i);
});
