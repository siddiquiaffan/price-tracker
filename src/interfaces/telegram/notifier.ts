import { type Api } from 'grammy';
import { type InlineKeyboardButton, type InlineKeyboardMarkup } from 'grammy/types';
import { type Logger } from '../../core/ports/logger.js';
import {
  type NotificationMessage,
  type Notifier,
  type ReplyMarkup,
} from '../../core/ports/notifier.js';

type SendMessageOther = NonNullable<Parameters<Api['sendMessage']>[2]>;

export function toGrammyMarkup(markup: ReplyMarkup): InlineKeyboardMarkup {
  return {
    inline_keyboard: markup.inlineKeyboard.map((row) =>
      row.map(
        (button) =>
          ({
            text: button.text,
            ...(button.url !== undefined ? { url: button.url } : {}),
            ...(button.callbackData !== undefined ? { callback_data: button.callbackData } : {}),
          }) as InlineKeyboardButton,
      ),
    ),
  };
}

/** Delivers {@link NotificationMessage}s through a grammY {@link Api}. */
export class TelegramNotifier implements Notifier {
  constructor(
    private readonly api: Api,
    private readonly logger: Logger,
  ) {}

  async send(userId: number, message: NotificationMessage): Promise<void> {
    const other: SendMessageOther = {};
    if (message.parseMode !== undefined) other.parse_mode = message.parseMode;
    if (message.disableWebPagePreview === true) other.link_preview_options = { is_disabled: true };
    if (message.replyMarkup !== undefined) other.reply_markup = toGrammyMarkup(message.replyMarkup);

    try {
      await this.api.sendMessage(userId, message.text, other);
    } catch (error) {
      this.logger.warn({ error, userId }, 'failed to send Telegram message');
      throw error;
    }
  }
}
