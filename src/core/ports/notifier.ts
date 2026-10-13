import { type Money } from '../entities/money.js';
import { type Availability } from '../entities/product.js';

export interface InlineKeyboardButton {
  text: string;
  url?: string;
  callbackData?: string;
}

export interface ReplyMarkup {
  inlineKeyboard: InlineKeyboardButton[][];
}

export type ParseMode = 'HTML' | 'Markdown';

export interface NotificationMessage {
  text: string;
  parseMode?: ParseMode;
  disableWebPagePreview?: boolean;
  replyMarkup?: ReplyMarkup;
}

/** Delivers user-facing notifications (price changes, etc.). */
export interface Notifier {
  send(userId: number, message: NotificationMessage): Promise<void>;
}

/** Structured price-change event; formatting is a presentation concern. */
export interface PriceChangeEvent {
  userId: number;
  trackingId: string;
  product: {
    storeId: string;
    productId: string;
    title: string;
    url: string;
    imageUrl: string | null;
    storeName: string;
  };
  previousPrice: Money | null;
  newPrice: Money | null;
  previousAvailability: Availability;
  newAvailability: Availability;
}

/** Notifies a single user about a single price change. */
export interface PriceNotifier {
  notify(event: PriceChangeEvent): Promise<void>;
}
