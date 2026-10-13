import 'dotenv/config';
import { serve } from '@hono/node-server';
import { loadConfig } from './config/env.js';
import { createApp, type AppContainer } from './app.js';

/**
 * Entry point: parse config, compose the app, then start the API server, the
 * Telegram bot (long polling in dev, webhook in production) and the scheduler.
 */
export async function startApp(): Promise<AppContainer> {
  const config = loadConfig();
  const app = await createApp(config);
  const logger = app.logger;

  await app.startWorker();

  const server = serve({ fetch: app.api.fetch, port: config.port }, (info) => {
    logger.info({ address: info.address, port: config.port }, 'api listening');
  });

  if (config.bot.polling) {
    void app.bot.start().catch((error: unknown) => {
      logger.error({ error }, 'bot polling stopped');
    });
    logger.info('telegram bot started in long-polling mode');
  } else if (config.bot.webhookUrl) {
    const options: Parameters<typeof app.bot.api.setWebhook>[1] = {};
    if (config.bot.secretToken !== undefined) options.secret_token = config.bot.secretToken;
    await app.bot.api.setWebhook(config.bot.webhookUrl, options);
    logger.info({ webhookUrl: config.bot.webhookUrl }, 'telegram webhook registered');
  }

  app.scheduler.start();
  logger.info({ intervalMs: config.schedule.intervalMs }, 'scheduler started');

  const shutdown = async (): Promise<void> => {
    logger.info('shutting down');
    app.scheduler.stop();
    await app.close();
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 5_000).unref();
  };
  process.once('SIGINT', () => void shutdown());
  process.once('SIGTERM', () => void shutdown());

  return app;
}

const isMain =
  process.argv[1] !== undefined && import.meta.url.endsWith(process.argv[1].replace(/\\/g, '/'));
if (isMain) {
  startApp().catch((error: unknown) => {
    console.error('failed to start price-tracker', error);
    process.exit(1);
  });
}
