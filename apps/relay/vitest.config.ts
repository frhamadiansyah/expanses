import { defineConfig } from 'vitest/config';

// The relay runs locally only; wrangler's harness needs no network, so keep it from reporting usage over one.
process.env.WRANGLER_SEND_METRICS = 'false';

export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    // Each file starts its own local Worker (wrangler's test harness over Miniflare); starting one takes seconds.
    hookTimeout: 120_000,
    testTimeout: 60_000,
  },
});
