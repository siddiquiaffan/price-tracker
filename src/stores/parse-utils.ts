import { type Availability } from '../core/entities/product.js';

const OUT_OF_STOCK = [
  'out of stock',
  'outofstock',
  'currently unavailable',
  'unavailable',
  'sold out',
  'soldout',
  'notify me',
  'coming soon',
];

const IN_STOCK = ['in stock', 'instock', 'in-stock', 'available'];

/** Map free-text / schema.org availability to our tri-state. */
export function parseAvailability(text: string | null | undefined): Availability {
  if (!text) return 'unknown';
  const value = text.toLowerCase();
  // Check out-of-stock first: "unavailable" contains "available".
  if (OUT_OF_STOCK.some((token) => value.includes(token))) return 'out_of_stock';
  if (IN_STOCK.some((token) => value.includes(token))) return 'in_stock';
  return 'unknown';
}

export function collapseWhitespace(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}
