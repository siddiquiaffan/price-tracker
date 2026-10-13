import { Hono, type Handler, type MiddlewareHandler } from 'hono';
import { webhookCallback } from 'grammy';
import { type Bot } from 'grammy';
import {
  isAppError,
  ParseError,
  InvalidUrlError,
  UnsupportedStoreError,
} from '../../core/errors/app-error.js';
import { type TrackingWithProduct } from '../../core/entities/tracking.js';
import { type Logger } from '../../core/ports/logger.js';
import { type UserRepository } from '../../core/ports/user-repository.js';
import { type TrackingService } from '../../core/services/tracking-service.js';

export interface ApiServerDeps {
  apiKey: string;
  logger: Logger;
  trackingService: TrackingService;
  users: UserRepository;
  bot?: Bot;
  webhookPath?: string;
}

/** Render a tracking as a legacy-shaped `tasks` document (superset of the old shape). */
function legacyTaskDoc(entry: TrackingWithProduct): Record<string, unknown> {
  const { product, tracking } = entry;
  return {
    tracking_id: tracking.trackingId,
    userId: tracking.userId,
    merchant: product.storeId,
    title: product.title,
    link: product.url,
    initPrice: product.initialPrice?.toMajorString() ?? null,
    price: product.currentPrice?.toMajorString() ?? null,
    image: product.imageUrl,
    availability: product.availability,
    lastCheckedAt: product.lastCheckedAt?.toISOString() ?? null,
    users: [{ userId: tracking.userId, tracking_id: tracking.trackingId }],
  };
}

/** API-key guard applied to every route except the Telegram webhook (A3). */
function authGuard(apiKey: string): MiddlewareHandler {
  return async (c, next) => {
    const authorization = c.req.header('authorization') ?? '';
    const presented = authorization.replace('Bearer ', '');
    if (presented !== apiKey) {
      return c.json({ error: 'Invalid API key' }, 401);
    }
    return next();
  };
}

/** HTTP API preserving the legacy Express routes and response shapes. */
export function createApiServer(deps: ApiServerDeps): Hono {
  const app = new Hono();
  const { trackingService, users, logger } = deps;
  const guard = authGuard(deps.apiKey);

  // GET /healthz -> liveness probe. Deliberately unauthenticated (A9): the API
  // key guard protects business routes only, so orchestrators and the Docker CI
  // smoke test can probe the process without credentials.
  app.get('/healthz', (c) => c.json({ ok: true }));

  // GET / -> user's tracked products (legacy: manageProducts({userId}, 'read'))
  app.get('/', guard, async (c) => {
    const userId = Number(c.req.query('userId'));
    if (!userId || !Number.isInteger(userId)) {
      return c.json({ error: 'Please pass a valid user id.' }, 500);
    }
    try {
      const trackings = await trackingService.list(userId);
      return c.json({ ok: true, result: trackings.map(legacyTaskDoc) }, 200);
    } catch (error) {
      return c.json({ error: (error as Error).message }, 500);
    }
  });

  // POST / -> track a product for a user (legacy: API-only flow, top-level userId/email)
  app.post('/', guard, async (c) => {
    const body = (await c.req.json().catch(() => null)) as {
      url?: unknown;
      userId?: unknown;
      email?: unknown;
    } | null;
    const rawUrl = typeof body?.url === 'string' ? body.url : '';
    const rawUserId = Number(body?.userId);
    const email = typeof body?.email === 'string' ? body.email : null;

    if (!rawUrl || !rawUserId || !Number.isInteger(rawUserId)) {
      return c.json({ error: 'Either url or userId is missing/incorrect' }, 503);
    }

    try {
      const existing = await users.findById(rawUserId);
      await users.upsert({
        id: rawUserId,
        name: existing?.name ?? String(rawUserId),
        mail: email,
      });
      const result = await trackingService.track(rawUserId, rawUrl);
      return c.json({ ok: true, tracking_id: result.tracking.trackingId }, 200);
    } catch (error) {
      if (
        error instanceof InvalidUrlError ||
        error instanceof UnsupportedStoreError ||
        error instanceof ParseError
      ) {
        return c.json({ error: 'Failed to add product to tracking list' }, 500);
      }
      if (isAppError(error)) {
        return c.json({ error: error.userMessage }, 500);
      }
      return c.json({ error: (error as Error).message }, 500);
    }
  });

  // DELETE / -> remove one tracking (both ids required; fixes the legacy truthiness bug)
  app.delete('/', guard, async (c) => {
    const body = (await c.req.json().catch(() => null)) as {
      tracking_id?: unknown;
      userId?: unknown;
    } | null;
    const trackingId = typeof body?.tracking_id === 'string' ? body.tracking_id : '';
    const userId = Number(body?.userId);
    if (!trackingId || !userId || !Number.isInteger(userId)) {
      return c.json({ error: 'Either tracking_id or userId is incorrect/missing.' }, 503);
    }
    try {
      const removed = await trackingService.stop(userId, trackingId);
      if (!removed) {
        return c.json({ error: 'Either tracking_id or userId is incorrect/missing.' }, 503);
      }
      return c.json({ ok: true }, 200);
    } catch (error) {
      return c.json({ error: (error as Error).message }, 500);
    }
  });

  // GET /stats -> total users + total trackings
  app.get('/stats', guard, async (c) => {
    const [users, trackings] = await Promise.all([
      deps.users.count(),
      trackingService.countTrackings(),
    ]);
    return c.json({ users, products: trackings }, 200);
  });

  // GET /info -> users list (Bearer auth; legacy behaviour, mail trimmed)
  app.get('/info', guard, async (c) => {
    const authorization = c.req.header('authorization') ?? '';
    if (authorization.replace('Bearer ', '') !== deps.apiKey) {
      return c.json({ error: 'Invalid API key' }, 401);
    }
    const allUsers = await users.listAll();
    return c.json(
      allUsers.map((user) => ({
        id: user.id,
        name: user.name,
        ...(user.mail && user.mail.trim().length > 0 ? { mail: user.mail.trim() } : {}),
      })),
      200,
    );
  });

  // /setup -> point Telegram at this host's /bot webhook
  app.get('/setup', guard, async (c) => {
    if (!deps.bot) return c.text('error');
    try {
      const host = c.req.header('host') ?? c.req.url;
      await deps.bot.api.setWebhook(`https://${host}${deps.webhookPath ?? '/bot'}`);
      return c.text('ok');
    } catch (error) {
      logger.error({ error }, 'failed to set webhook');
      return c.text('error');
    }
  });

  // /bot -> Telegram webhook (only registered when a bot is provided)
  if (deps.bot) {
    const webhook = webhookCallback(deps.bot, 'hono') as unknown as Handler;
    app.post(deps.webhookPath ?? '/bot', webhook);
  }

  return app;
}
