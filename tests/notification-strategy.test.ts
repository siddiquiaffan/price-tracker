import { describe, expect, it } from 'vitest';
import { Money } from '../src/core/entities/money.js';
import {
  availabilityChanged,
  createNotificationStrategy,
  priceChanged,
  type PriceChange,
} from '../src/core/services/notification-strategy.js';

function change(overrides: Partial<PriceChange> = {}): PriceChange {
  return {
    previousPrice: Money.fromMinorUnits(1000),
    newPrice: Money.fromMinorUnits(900),
    previousAvailability: 'in_stock',
    newAvailability: 'in_stock',
    ...overrides,
  };
}

describe('priceChanged', () => {
  it('is true when the price differs', () => {
    expect(priceChanged(change())).toBe(true);
  });

  it('is false when prices are equal and in stock', () => {
    const c = change({ newPrice: Money.fromMinorUnits(1000) });
    expect(priceChanged(c)).toBe(false);
    expect(availabilityChanged(c)).toBe(false);
  });

  it('is true when a price appears or disappears', () => {
    expect(priceChanged(change({ previousPrice: null }))).toBe(true);
    expect(priceChanged(change({ newPrice: null }))).toBe(true);
  });

  it('is false when both prices are null', () => {
    expect(priceChanged(change({ previousPrice: null, newPrice: null }))).toBe(false);
  });
});

describe('availabilityChanged', () => {
  it('detects in-stock transitions', () => {
    expect(availabilityChanged(change({ newAvailability: 'out_of_stock' }))).toBe(true);
  });
});

describe('NotificationStrategy', () => {
  it('every-change notifies on any price or availability change', () => {
    const strategy = createNotificationStrategy('every-change');
    expect(strategy.id).toBe('every-change');
    expect(strategy.shouldNotify(change())).toBe(true);
    expect(strategy.shouldNotify(change({ newPrice: Money.fromMinorUnits(1000) }))).toBe(false);
    expect(strategy.shouldNotify(change({ newAvailability: 'unknown' }))).toBe(true);
  });

  it('only-drop notifies on drops and availability changes but not increases', () => {
    const strategy = createNotificationStrategy('only-drop');
    const drop = change({ newPrice: Money.fromMinorUnits(800) });
    const rise = change({ newPrice: Money.fromMinorUnits(1200) });
    expect(strategy.shouldNotify(drop)).toBe(true);
    expect(strategy.shouldNotify(rise)).toBe(false);
    expect(strategy.shouldNotify(change({ newAvailability: 'out_of_stock' }))).toBe(true);
  });

  it('threshold notifies only when the absolute change is at least the threshold', () => {
    const threshold = createNotificationStrategy('threshold', 10);
    // 12% drop >= 10% -> notify
    const big = change({ newPrice: Money.fromMinorUnits(880) });
    // 5% rise < 10% -> don't notify
    const small = change({ newPrice: Money.fromMinorUnits(1050) });
    expect(threshold.shouldNotify(big)).toBe(true);
    expect(threshold.shouldNotify(small)).toBe(false);
  });

  it('default threshold (0) notifies on any change', () => {
    const strategy = createNotificationStrategy('threshold');
    expect(strategy.shouldNotify(change({ newPrice: Money.fromMinorUnits(995) }))).toBe(true);
  });
});
