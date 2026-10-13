import { describe, expect, it } from 'vitest';
import { createTrackingIdFactory, generateTrackingId } from '../../../src/infra/id/tracking-id.js';

describe('tracking ids (fixes B19)', () => {
  it('generates 10-char base36 ids by default', () => {
    for (let index = 0; index < 50; index += 1) {
      expect(generateTrackingId()).toMatch(/^[0-9a-z]{10}$/);
    }
  });

  it('honours a custom length', () => {
    const id = generateTrackingId(20);
    expect(id).toHaveLength(20);
    expect(id).toMatch(/^[0-9a-z]{20}$/);
  });

  it('never repeats in bulk', () => {
    const ids = new Set(Array.from({ length: 2000 }, () => generateTrackingId()));
    expect(ids.size).toBe(2000);
  });

  it('createTrackingIdFactory returns a working factory', () => {
    const factory = createTrackingIdFactory(12);
    const first = factory();
    const second = factory();
    expect(first).toMatch(/^[0-9a-z]{12}$/);
    expect(first).not.toBe(second);
  });
});
