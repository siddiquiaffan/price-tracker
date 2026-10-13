import { defineConfig } from 'vitest/config';

/**
 * Opt-in real-network e2e. `pnpm test` (default config) runs this file too, but
 * the suite skips itself unless RUN_ONLINE_E2E is set — this config sets it,
 * so `pnpm test:e2e:online` is the only way the live scrape runs.
 */
export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/e2e/online.test.ts'],
    env: { RUN_ONLINE_E2E: '1' },
    testTimeout: 120_000,
    hookTimeout: 120_000,
  },
});
