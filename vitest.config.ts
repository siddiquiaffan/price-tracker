import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts', 'tests/**/*.test.ts'],
    globals: false,
    restoreMocks: true,
    clearMocks: true,
    coverage: {
      provider: 'v8',
      reporter: ['text', 'lcov'],
      include: ['src/**/*.ts'],
      exclude: ['src/**/*.test.ts', 'src/main.ts', 'src/**/index.ts', 'src/**/*.d.ts', 'worker/**'],
      thresholds: {
        'src/core/**': { lines: 80, branches: 80 },
        'src/stores/**': { lines: 80, branches: 80 },
        'src/infra/egress/**': { lines: 80, branches: 80 },
      },
    },
  },
});
