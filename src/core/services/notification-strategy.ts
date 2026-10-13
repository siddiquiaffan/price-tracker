import { type Money } from '../entities/money.js';
import { type Availability } from '../entities/product.js';
import { ValidationError } from '../errors/app-error.js';

export interface PriceChange {
  previousPrice: Money | null;
  newPrice: Money | null;
  previousAvailability: Availability;
  newAvailability: Availability;
}

export function priceChanged(change: PriceChange): boolean {
  const { previousPrice, newPrice } = change;
  if (previousPrice === null && newPrice === null) return false;
  if (previousPrice === null || newPrice === null) return true;
  return !previousPrice.equals(newPrice);
}

export function availabilityChanged(change: PriceChange): boolean {
  return change.previousAvailability !== change.newAvailability;
}

/**
 * Whether a change is worth notifying about. Extension point: the default matches
 * today's behaviour (notify on every change).
 */
export interface NotificationStrategy {
  readonly id: string;
  shouldNotify(change: PriceChange): boolean;
}

export class EveryChangeStrategy implements NotificationStrategy {
  readonly id = 'every-change';
  shouldNotify(change: PriceChange): boolean {
    return priceChanged(change) || availabilityChanged(change);
  }
}

export class OnlyOnDropStrategy implements NotificationStrategy {
  readonly id = 'only-drop';
  shouldNotify(change: PriceChange): boolean {
    const { previousPrice, newPrice } = change;
    if (previousPrice === null || newPrice === null) {
      return availabilityChanged(change);
    }
    return newPrice.lessThan(previousPrice);
  }
}

export class ThresholdStrategy implements NotificationStrategy {
  readonly id = 'threshold';
  constructor(private readonly thresholdPercent: number) {
    if (thresholdPercent < 0) {
      throw new ValidationError('Notification threshold must be >= 0');
    }
  }

  shouldNotify(change: PriceChange): boolean {
    const { previousPrice, newPrice } = change;
    if (previousPrice === null || newPrice === null) {
      return availabilityChanged(change);
    }
    if (previousPrice.isZero()) return !newPrice.equals(previousPrice);
    const percent = Math.abs(newPrice.percentageChangeFrom(previousPrice));
    return percent >= this.thresholdPercent;
  }
}

export function createNotificationStrategy(
  name: 'every-change' | 'only-drop' | 'threshold',
  thresholdPercent = 0,
): NotificationStrategy {
  switch (name) {
    case 'every-change':
      return new EveryChangeStrategy();
    case 'only-drop':
      return new OnlyOnDropStrategy();
    case 'threshold':
      return new ThresholdStrategy(thresholdPercent);
  }
}
