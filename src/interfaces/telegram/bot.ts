import { Bot, type Context } from 'grammy';
import { isAppError } from '../../core/errors/app-error.js';
import { type Logger } from '../../core/ports/logger.js';
import { type Notifier, type ReplyMarkup } from '../../core/ports/notifier.js';
import { type PriceCheckService } from '../../core/services/price-check-service.js';
import { type TrackingService } from '../../core/services/tracking-service.js';
import { type UserRepository } from '../../core/ports/user-repository.js';
import { type Store } from '../../core/ports/store.js';
import { extractUrl } from './extract-url.js';
import { toGrammyMarkup } from './notifier.js';
import * as messages from './messages.js';

export interface TelegramBotDeps {
  token: string;
  admins: readonly number[];
  limit: number;
  logger: Logger;
  trackingService: TrackingService;
  priceCheckService: PriceCheckService;
  users: UserRepository;
  notifier: Notifier;
  /** Pre-existing bot instance (lets the caller build a notifier from its API). */
  bot?: Bot;
}

function firstNameOf(ctx: Context): string {
  return ctx.from?.first_name ?? 'there';
}

function isAdmin(deps: TelegramBotDeps, ctx: Context): boolean {
  return ctx.from !== undefined && deps.admins.includes(ctx.from.id);
}

/** Only include `reply_to_message_id` when we actually have a message id. */
function replyTo(messageId: number | undefined): { reply_to_message_id?: number } {
  return messageId !== undefined ? { reply_to_message_id: messageId } : {};
}

/** Builds the grammY bot with every legacy command, preserving reply text. */
export function createTelegramBot(deps: TelegramBotDeps): Bot {
  const bot = deps.bot ?? new Bot(deps.token);
  const logger = deps.logger;
  const commonMarkup = toGrammyMarkup(messages.COMMON_INLINE_KEYBOARD);

  const trackUrl = async (ctx: Context, rawUrl: string): Promise<void> => {
    const from = ctx.from;
    const chat = ctx.chat;
    const message = ctx.message;
    if (!from || !chat || !message) return;

    let target: { url: URL; store: Store };
    try {
      target = await deps.trackingService.resolveTarget(rawUrl);
    } catch (error) {
      if (isAppError(error)) {
        await ctx.reply(error.userMessage).catch(() => undefined);
        return;
      }
      logger.error({ error, rawUrl }, 'failed to resolve target URL');
      await ctx.reply(messages.TRACK_FAILED_MESSAGE).catch(() => undefined);
      return;
    }

    const count = await deps.trackingService.count(from.id);
    if (count >= deps.limit) {
      await ctx
        .reply(messages.LIMIT_EXCEEDED_MESSAGE, { reply_to_message_id: message.message_id })
        .catch(() => undefined);
      return;
    }

    const pending = await ctx
      .reply(messages.trackingPendingMessage(target.store.id), {
        reply_to_message_id: message.message_id,
      })
      .catch(() => undefined);
    if (!pending) return;

    try {
      const result = await deps.trackingService.trackTarget(from.id, target.url, target.store);
      const text = messages.trackOkMessage({
        imageUrl: result.product.imageUrl,
        title: result.product.title,
        price: result.product.currentPrice,
        link: result.product.url,
        merchant: result.product.storeId,
        trackingId: result.tracking.trackingId,
      });
      await ctx.api.editMessageText(chat.id, pending.message_id, text, {
        parse_mode: 'HTML',
        reply_markup: commonMarkup,
      });
    } catch (error) {
      logger.warn({ error, userId: from.id }, 'failed to track product');
      await ctx.api
        .editMessageText(chat.id, pending.message_id, messages.TRACK_FAILED_MESSAGE, {
          parse_mode: 'HTML',
          reply_markup: commonMarkup,
        })
        .catch(() => undefined);
    }
  };

  bot.command('start', async (ctx) => {
    await ctx
      .reply(messages.startMessage(firstNameOf(ctx)), {
        ...replyTo(ctx.message?.message_id),
        reply_markup: commonMarkup,
      })
      .catch(() => undefined);
    if (ctx.from) {
      await deps.trackingService
        .registerUser({ id: ctx.from.id, name: ctx.from.first_name, mail: null })
        .catch((error: unknown) => {
          logger.warn({ error }, 'failed to register user');
        });
    }
  });

  bot.command('help', async (ctx) => {
    await ctx
      .reply(messages.HELP_MESSAGE, {
        ...replyTo(ctx.message?.message_id),
        reply_markup: commonMarkup,
      })
      .catch(() => undefined);
  });

  bot.command('track', async (ctx) => {
    const url = extractUrl(ctx.match ?? '');
    if (!url) {
      await ctx.reply(invalidUrl(ctx)).catch(() => undefined);
      return;
    }
    await trackUrl(ctx, url);
  });

  bot.command('list', async (ctx) => {
    const from = ctx.from;
    if (!from) return;
    try {
      const entries = await deps.trackingService.list(from.id);
      const list = entries.map(messages.listItem).join('\n\n');
      await ctx.reply(`${messages.LIST_HEADER}${list}`, {
        ...replyTo(ctx.message?.message_id),
        parse_mode: 'HTML',
        link_preview_options: { is_disabled: true },
      });
    } catch (error) {
      logger.warn({ error, userId: from.id }, 'failed to list trackings');
      await ctx.reply(messages.LIST_ERROR_MESSAGE).catch(() => undefined);
    }
  });

  bot.hears(/^\/stop_([A-Za-z0-9]+)/, async (ctx) => {
    const trackingId = ctx.match?.[1] ?? '';
    const from = ctx.from;
    if (!from || !trackingId) return;
    const removed = await deps.trackingService.stop(from.id, trackingId);
    await ctx.reply(
      removed ? messages.stopOkMessage(trackingId) : messages.stopFailMessage(trackingId),
    );
  });

  bot.callbackQuery(/^stopTracking:(.+)$/, async (ctx) => {
    const trackingId = ctx.match[1] ?? '';
    const from = ctx.from;
    if (!from) return;
    const removed = await deps.trackingService.stop(from.id, trackingId);
    const text = removed
      ? messages.stopOkMessage(trackingId)
      : messages.stopFailMessage(trackingId);
    await ctx.answerCallbackQuery().catch(() => undefined);
    const message = ctx.callbackQuery.message;
    if (message) {
      await ctx.api
        .editMessageText(message.chat.id, message.message_id, text)
        .catch(() => undefined);
    } else {
      await ctx.reply(text).catch(() => undefined);
    }
  });

  bot.command('stats', async (ctx) => {
    try {
      const stats = await deps.trackingService.stats();
      await ctx.reply(messages.statsMessage(stats.users, stats.trackings));
    } catch (error) {
      logger.error({ error }, 'failed to compute stats');
    }
  });

  bot.command('users', async (ctx) => {
    if (!isAdmin(deps, ctx)) return;
    try {
      const users = await deps.users.listAll();
      const text = messages.USERS_HEADER + users.map(messages.userLine).join('\n');
      await ctx.reply(text, { parse_mode: 'HTML' });
    } catch (error) {
      logger.error({ error }, 'failed to list users');
    }
  });

  bot.command('broadcast', async (ctx) => {
    if (!isAdmin(deps, ctx)) return;
    const raw = ctx.match ?? '';
    const [body, keyboardJson] = raw.split('inline_keyboard:');
    const users = await deps.users.listAll();
    const replyMarkup = parseBroadcastKeyboard(keyboardJson);
    await Promise.all(
      users.map(async (user) => {
        const text = (body ?? '')
          .replace(/{name}/gi, `\`${user.name}\``)
          .replace(/{id}/gi, String(user.id));
        await deps.notifier
          .send(user.id, {
            text,
            parseMode: 'Markdown',
            disableWebPagePreview: true,
            ...(replyMarkup ? { replyMarkup } : {}),
          })
          .catch((error: unknown) => {
            logger.debug({ error, userId: user.id }, 'broadcast send failed');
          });
      }),
    );
  });

  bot.command('update', async (ctx) => {
    if (!isAdmin(deps, ctx)) return;
    await ctx.reply(messages.UPDATE_STARTED_MESSAGE);
    void deps.priceCheckService.checkAll().catch((error: unknown) => {
      logger.error({ error }, 'manual price check failed');
    });
  });

  bot.on('::url', async (ctx) => {
    if (ctx.chat?.type !== 'private') return;
    const text = ctx.message?.text ?? '';
    const url = extractUrl(text);
    if (url) await trackUrl(ctx, url);
  });

  bot.catch((error) => {
    logger.error(
      { error: error.error, updateId: error.ctx.update.update_id },
      'telegram update failed',
    );
  });

  return bot;
}

function invalidUrl(ctx: Context): string {
  return messages.invalidUrlMessage(firstNameOf(ctx));
}

function parseBroadcastKeyboard(json: string | undefined): ReplyMarkup | null {
  if (!json || json.trim().length === 0) return null;
  try {
    const parsed = JSON.parse(json.trim()) as {
      text: string;
      url?: string;
      callback_data?: string;
    }[][];
    if (!Array.isArray(parsed)) return null;
    return {
      inlineKeyboard: parsed.map((row) =>
        row.map((button) => ({
          text: button.text,
          ...(button.url !== undefined ? { url: button.url } : {}),
          ...(button.callback_data !== undefined ? { callbackData: button.callback_data } : {}),
        })),
      ),
    };
  } catch {
    return null;
  }
}
