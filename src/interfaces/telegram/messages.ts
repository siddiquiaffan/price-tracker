import { type Money } from '../../core/entities/money.js';
import { type PriceChangeEvent, type ReplyMarkup } from '../../core/ports/notifier.js';
import { type UserRecord } from '../../core/entities/user.js';
import { type TrackingWithProduct } from '../../core/entities/tracking.js';

/**
 * Exact user-facing strings from the legacy bot (see docs/MIGRATION_NOTES.md §3.3).
 * Marked `preserve:` where the snapshot tests assert byte-for-byte equality.
 */

export const COMMON_INLINE_KEYBOARD: ReplyMarkup = {
  inlineKeyboard: [
    [
      { text: '👨‍💻 Developer', url: 'https://github.com/siddiquiaffan' },
      // { text: '🛒 Deals Channel', url: 'https://t.me/aslootdeals' },
    ],
    [
      { text: '🔃 Updates', url: 'https://t.me/asprojects' },
      { text: '💁‍♂️ Support', url: 'https://t.me/assupportchat' },
    ],
  ],
};

export const startMessage = (firstName: string): string =>
  `Hello ${firstName}, I can track price for Amazon & Flipkart products (Soon more).\n\nCheck /help to get started.\n`;

export const HELP_MESSAGE =
  '/start - Start the bot\n/help - get this message.\n/track {Product Link} - Add product to tracking list.\n/stop_{Tracking ID} - Stop tracking.\n/list - Get list of products that are being tracked.\n\nFor more help join @@assupportchat.';

export const trackingPendingMessage = (merchant: string): string =>
  `Tracking ${merchant} product...`;

export const TRACK_FAILED_MESSAGE =
  "Sorry, I couldn't track this product. Make sure you've sent correct product link.";

export const LIMIT_EXCEEDED_MESSAGE =
  "I'm sorry, but you can't add more products as you've already reached the maximum limit.\n\nPlease delete atleast one product. And try again.\n\nTo get list send /list";

export const UNSUPPORTED_STORE_MESSAGE =
  "Sorry, I can't track this product. Cuz the link you sent is not a amazon or flipkart product link.";

export const invalidUrlMessage = (firstName: string): string =>
  `Sorry ${firstName}, I can't track this product. Make sure you've sent correct product link.`;

export const LIST_ERROR_MESSAGE =
  "An error has beem occured please report it to admin. This my be due to you've added too many products.";

export const stopOkMessage = (trackingId: string): string =>
  `Stopped tracking product with tracking id ${trackingId}`;

export const stopFailMessage = (trackingId: string): string =>
  `Sorry, I can't stop tracking product with tracking id ${trackingId}.`;

export const statsMessage = (users: number, products: number): string =>
  `Total Users: ${users}\nTotal Products: ${products}`;

export const USERS_HEADER = 'List Of Users: \n\n';

export const userLine = (user: UserRecord): string =>
  `${user.id} - <a href="tg://user?id=${user.id}">${user.name}</a>`;

export const UPDATE_STARTED_MESSAGE = 'Updating products...';

export const LIST_HEADER = 'Here is your tracking list:\n\n';

export const listItem = (entry: TrackingWithProduct): string =>
  `<b>${entry.product.title}</b>\nLast Price: ${formatPrice(entry.product.currentPrice)}\nLink: <a href="${entry.product.url}">${entry.product.storeId}</a>\nTo stop send /stop_${entry.tracking.trackingId}`;

export const trackOkMessage = (input: {
  imageUrl: string | null;
  title: string;
  price: Money | null;
  link: string;
  merchant: string;
  trackingId: string;
}): string =>
  `<a href="${input.imageUrl ?? ''}"> </a>\nTracking <b>${input.title}</b>\n\nCurrent Price: <b>${formatPrice(input.price)}</b>\nLink: <a href="${input.link}">${input.merchant}</a>\n\nTo stop tracking send /stop_${input.trackingId}`;

export function formatPrice(price: Money | null): string {
  return price ? price.format() : 'N/A';
}

export interface FormattedPriceChange {
  text: string;
  replyMarkup: ReplyMarkup;
}

/** Notification body + inline keyboard, matching the legacy template. */
export function priceChangeMessage(
  event: PriceChangeEvent,
  affiliateUrl: string,
): FormattedPriceChange {
  const { previousPrice, newPrice } = event;
  const imageHref = event.product.imageUrl ?? '';
  const currentPrice = formatPrice(newPrice ?? previousPrice);

  let headline: string;
  if (previousPrice && newPrice) {
    const direction = newPrice.greaterThan(previousPrice) ? 'increased' : 'decreased';
    const amount = previousPrice.subtract(newPrice).abs();
    headline = `Price has been ${direction} by ${amount.format()}`;
  } else if (!previousPrice && newPrice) {
    headline = `Price has been increased by ${newPrice.format()}`;
  } else if (previousPrice && !newPrice) {
    headline = `Price has been decreased by ${previousPrice.format()}`;
  } else {
    headline = 'Availability has changed';
  }

  const text =
    `<a href="${imageHref}"> </a><b>${headline}</b>. \n\n<b>${event.product.title}</b>\n\n` +
    `Current Price: <b>${currentPrice}</b>\nLink: <a href="${affiliateUrl}">${event.product.storeName}</a>\n\n` +
    `To stop tracking send /stop_${event.trackingId}`;

  return {
    text,
    replyMarkup: {
      inlineKeyboard: [
        [{ text: 'Buy Now', url: affiliateUrl }],
        [
          {
            text: `Stop Tracking - ${event.trackingId}`,
            callbackData: `stopTracking:${event.trackingId}`,
          },
        ],
      ],
    },
  };
}
