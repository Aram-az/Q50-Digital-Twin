import test from 'node:test';
import assert from 'node:assert/strict';
import { clamp, gaugeAngle, polar, arcProgress, previewPingPongIndex } from '../src/lib/instrumentMath.ts';

test('needle begins at lower-left and sweeps 270 degrees', () => {
  assert.equal(gaugeAngle(0,0,7000),135);
  assert.equal(gaugeAngle(3500,0,7000),270);
  assert.equal(gaugeAngle(7000,0,7000),405);
});
test('out-of-range data cannot rotate needle beyond the instrument', () => {
  assert.equal(gaugeAngle(-100,0,7000),135);
  assert.equal(gaugeAngle(9000,0,7000),405);
});
test('gauge rejects invalid scale dimensions', () => assert.throws(() => gaugeAngle(1,10,10)));
test('polar math returns known cardinal positions', () => {
  const p = polar(0,0,100,180);
  assert.ok(Math.abs(p.x+100)<1e-8);
  assert.ok(Math.abs(p.y)<1e-8);
});
test('clamp bounds LED and arc progress', () => {
  assert.equal(clamp(140,0,100),100);
  assert.equal(clamp(-5,0,100),0);
});

test('fixed semicircle arc stays in range at extreme values', () => {
  const full = Math.PI * 78;
  assert.equal(arcProgress(-999, 0, 100, 78), 0);
  assert.ok(Math.abs(arcProgress(50,0,100,78) - full/2) < 1e-10);
  assert.ok(Math.abs(arcProgress(999,0,100,78) - full) < 1e-10);
  assert.throws(() => arcProgress(1,10,10,78));
});
test('preview loop never teleports between end and beginning', () => {
  const expected = [0,1,2,3,4,3,2,1,0,1];
  assert.deepEqual(expected.map((_,f) => previewPingPongIndex(f,5)), expected);
  assert.equal(previewPingPongIndex(400,1), 0);
});
