/** Display math for custom instrument dials, independent of React and the browser. */
export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/** Pointer sweeps 270 degrees from lower left to lower right. Scale is UI-only. */
export function gaugeAngle(value: number, minimum: number, maximum: number): number {
  if (maximum <= minimum) throw new Error('Gauge maximum must exceed minimum');
  return 135 + clamp((value - minimum) / (maximum - minimum), 0, 1) * 270;
}

/** Convert a dial angle into SVG coordinates. */
export function polar(cx: number, cy: number, radius: number, angle: number) {
  return { x: cx + Math.cos(angle * Math.PI / 180) * radius,
           y: cy + Math.sin(angle * Math.PI / 180) * radius };
}

/** Return a fixed-length semicircle stroke, so SVG updates animate without changing the path. */
export function arcProgress(value: number, minimum: number, maximum: number, radius: number): number {
  if (maximum <= minimum || radius <= 0) throw new Error('Invalid auxiliary gauge dimensions');
  return Math.PI * radius * clamp((value - minimum) / (maximum - minimum), 0, 1);
}

/** Ping-pong through the built-in preview instead of teleporting from the last frame to zero. */
export function previewPingPongIndex(frame: number, length: number): number {
  if (length <= 1) return 0;
  const cycle = 2 * (length - 1);
  const forward = ((Math.trunc(frame) % cycle) + cycle) % cycle;
  return forward < length ? forward : cycle - forward;
}
