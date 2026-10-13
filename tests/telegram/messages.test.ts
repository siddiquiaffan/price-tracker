import { describe, expect, it } from 'vitest';
import { Money } from '../../src/core/entities/money.js';
import { type PriceChangeEvent } from '../../src/core/ports/notifier.js';
import {
  HELP_MESSAGE,
  LIMIT_EXCEEDED_MESSAGE,
  LIST_ERROR_MESSAGE,
  LIST_HEADER,
  TRACK_FAILED_MESSAGE,
  UNSUPPORTED_STORE_MESSAGE,
  USERS_HEADER,
  formatPrice,
  invalidUrlMessage,
  listItem,
  priceChangeMessage,
  startMessage,
  statsMessage,
  stopFailMessage,
  stopOkMessage,
  trackOkMessage,
  trackingPendingMessage,
  userLine,
} from '../../src/interfaces/telegram/messages.js';
import { buildAffiliateUrl } from '../../src/interfaces/telegram/affiliate.js';
import { createMemoryBundle } from '../helpers/repositories.js';

/** Creates a single realistic tracking entry for listItem tests. */
async function trackingEntry() {
  const bundle = createMemoryBundle();
  const now = new Date('2024-01-01T00:00:00.000Z');
  const { tracking, product } = await bundle.trackings.addTracking({
    data: {
      storeId: 'amazon',
      productId: 'B00EXAMPLE',
      url: 'https://www.amazon.in/dp/B00EXAMPLE',
      title: 'Example Headphones',
      price: Money.fromMinorUnits(1299900),
      imageUrl: null,
      availability: 'in_stock',
    },
    userId: 42,
    trackingId: 'trk1234567',
    now,
  });
  return { tracking, product };
}

function event(overrides: Partial<PriceChangeEvent> = {}): PriceChangeEvent {
  return {
    userId: 42,
    trackingId: 'trk1234567',
    product: {
      storeId: 'amazon',
      productId: 'B00EXAMPLE',
      title: 'Example Headphones',
      url: 'https://www.amazon.in/dp/B00EXAMPLE',
      imageUrl: 'https://images.example.com/img.jpg',
      storeName: 'Amazon',
    },
    previousPrice: Money.fromMinorUnits(1299900),
    newPrice: Money.fromMinorUnits(1199900),
    previousAvailability: 'in_stock',
    newAvailability: 'in_stock',
    ...overrides,
  };
}

describe('exact legacy reply strings', () => {
  it('start message', () => {
    expect(startMessage('Affan')).toBe(
      'Hello Affan, I can track price for Amazon & Flipkart products (Soon more).\n\nCheck /help to get started.\n',
    );
  });

  it('help message', () => {
    expect(HELP_MESSAGE).toBe(
      '/start - Start the bot\n/help - get this message.\n/track {Product Link} - Add product to tracking list.\n/stop_{Tracking ID} - Stop tracking.\n/list - Get list of products that are being tracked.\n\nFor more help join @@assupportchat.',
    );
  });

  it('limit, track failure and unsupported store messages', () => {
    expect(LIMIT_EXCEEDED_MESSAGE).toContain("you've already reached the maximum limit");
    expect(TRACK_FAILED_MESSAGE).toBe(
      "Sorry, I couldn't track this product. Make sure you've sent correct product link.",
    );
    expect(UNSUPPORTED_STORE_MESSAGE).toBe(
      "Sorry, I can't track this product. Cuz the link you sent is not a amazon or flipkart product link.",
    );
  });

  it('tracking pending, invalid url, stop and stats messages', () => {
    expect(trackingPendingMessage('amazon')).toBe('Tracking amazon product...');
    expect(LIST_ERROR_MESSAGE).toContain('An error has beem occured');
    expect(invalidUrlMessage('Affan')).toContain(
      "Sorry Affan, I can't track this product. Make sure you've sent correct product link.",
    );
    expect(stopOkMessage('trk1234567')).toBe(
      'Stopped tracking product with tracking id trk1234567',
    );
    expect(stopFailMessage('trk1234567')).toBe(
      "Sorry, I can't stop tracking product with tracking id trk1234567.",
    );
    expect(statsMessage(3, 12)).toBe('Total Users: 3\nTotal Products: 12');
  });

  it('list header and list item', async () => {
    const { tracking, product } = await trackingEntry();
    expect(LIST_HEADER).toBe('Here is your tracking list:\n\n');
    expect(listItem({ tracking, product })).toBe(
      `<b>Example Headphones</b>\nLast Price: ₹12,999.00\nLink: <a href="https://www.amazon.in/dp/B00EXAMPLE">amazon</a>\nTo stop send /stop_trk1234567`,
    );
  });

  it('track ok message mirrors the legacy template', () => {
    const text = trackOkMessage({
      imageUrl: 'https://images.example.com/img.jpg',
      title: 'Example Headphones',
      price: Money.fromMinorUnits(1299900),
      link: 'https://www.amazon.in/dp/B00EXAMPLE',
      merchant: 'amazon',
      trackingId: 'trk1234567',
    });
    expect(text).toBe(
      `<a href="https://images.example.com/img.jpg"> </a>\nTracking <b>Example Headphones</b>\n\nCurrent Price: <b>₹12,999.00</b>\nLink: <a href="https://www.amazon.in/dp/B00EXAMPLE">amazon</a>\n\nTo stop tracking send /stop_trk1234567`,
    );
  });

  it('users header and user line', () => {
    expect(USERS_HEADER).toBe('List Of Users: \n\n');
    expect(userLine({ id: 42, name: 'Affan', mail: null })).toBe(
      '42 - <a href="tg://user?id=42">Affan</a>',
    );
  });

  it('formats prices as N/A when missing', () => {
    expect(formatPrice(Money.fromMinorUnits(1299900))).toBe('₹12,999.00');
    expect(formatPrice(null)).toBe('N/A');
  });
});

describe('priceChangeMessage', () => {
  it('reports a price decrease with an absolute amount', () => {
    const { text } = priceChangeMessage(event(), 'https://amzn.in/dp/B00EXAMPLE?tag=asloot-21');
    expect(text).toContain('Price has been decreased by ₹1,000.00');
    expect(text).toContain('Current Price: <b>₹11,999.00</b>');
    expect(text).toContain('To stop tracking send /stop_trk1234567');
  });

  it('reports a price increase', () => {
    const { text } = priceChangeMessage(
      event({ newPrice: Money.fromMinorUnits(1399900) }),
      'https://example.com',
    );
    expect(text).toContain('Price has been increased by ₹1,000.00');
  });

  it('handles a previously-priceless product becoming available', () => {
    const { text } = priceChangeMessage(
      event({ previousPrice: null, newPrice: Money.fromMinorUnits(1299900) }),
      'https://example.com',
    );
    expect(text).toContain('Price has been increased by ₹12,999.00');
  });

  it('handles a product going out of stock', () => {
    const { text } = priceChangeMessage(
      event({ previousPrice: Money.fromMinorUnits(1299900), newPrice: null }),
      'https://example.com',
    );
    expect(text).toContain('Price has been decreased by ₹12,999.00');
    expect(text).toContain('Current Price: <b>₹12,999.00</b>');
  });

  it('falls back to an availability headline when no price ever existed', () => {
    const { text } = priceChangeMessage(
      event({ previousPrice: null, newPrice: null, newAvailability: 'out_of_stock' }),
      'https://example.com',
    );
    expect(text).toContain('Availability has changed');
  });

  it('attaches the affiliate link to the Buy Now button', () => {
    const affiliate = 'https://amzn.in/dp/B00EXAMPLE?tag=asloot-21';
    const { replyMarkup } = priceChangeMessage(event(), affiliate);
    expect(replyMarkup.inlineKeyboard[0]?.[0]).toEqual({ text: 'Buy Now', url: affiliate });
    expect(replyMarkup.inlineKeyboard[1]?.[0]).toEqual({
      text: 'Stop Tracking - trk1234567',
      callbackData: 'stopTracking:trk1234567',
    });
  });
});

describe('buildAffiliateUrl', () => {
  it('appends the tag only for amazon links', () => {
    expect(buildAffiliateUrl('amazon', 'https://www.amazon.in/dp/B00EXAMPLE', 'asloot-21')).toBe(
      'https://www.amazon.in/dp/B00EXAMPLE?tag=asloot-21',
    );
    expect(
      buildAffiliateUrl('flipkart', 'https://www.flipkart.com/p/itmexample', 'asloot-21'),
    ).toBe('https://www.flipkart.com/p/itmexample');
  });

  it('skips the tag when none is configured', () => {
    expect(buildAffiliateUrl('amazon', 'https://www.amazon.in/dp/B00EXAMPLE', '')).toBe(
      'https://www.amazon.in/dp/B00EXAMPLE',
    );
  });
});
