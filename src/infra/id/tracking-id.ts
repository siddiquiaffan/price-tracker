import { randomInt } from 'node:crypto';

const BASE36 = '0123456789abcdefghijklmnopqrstuvwxyz';

/**
 * Collision-resistant tracking id (fixes B19, which used `Math.random`).
 * 10 chars of base36 ≈ 51.7 bits of entropy, matching the legacy id shape.
 */
export function generateTrackingId(length = 10): string {
  let out = '';
  for (let index = 0; index < length; index += 1) {
    out += BASE36[randomInt(BASE36.length)] ?? '';
  }
  return out;
}

export type TrackingIdFactory = () => string;

export function createTrackingIdFactory(length = 10): TrackingIdFactory {
  return () => generateTrackingId(length);
}
