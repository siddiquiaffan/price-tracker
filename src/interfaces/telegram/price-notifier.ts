import {
  type Notifier,
  type PriceChangeEvent,
  type PriceNotifier,
} from '../../core/ports/notifier.js';
import { buildAffiliateUrl } from './affiliate.js';
import { priceChangeMessage } from './messages.js';

export interface TelegramPriceNotifierOptions {
  affiliateTag: string;
}

/** Formats a price change into the legacy notification and delivers it. */
export class TelegramPriceNotifier implements PriceNotifier {
  constructor(
    private readonly notifier: Notifier,
    private readonly options: TelegramPriceNotifierOptions,
  ) {}

  async notify(event: PriceChangeEvent): Promise<void> {
    const affiliateUrl = buildAffiliateUrl(
      event.product.storeId,
      event.product.url,
      this.options.affiliateTag,
    );
    const { text, replyMarkup } = priceChangeMessage(event, affiliateUrl);
    await this.notifier.send(event.userId, { text, parseMode: 'HTML', replyMarkup });
  }
}
