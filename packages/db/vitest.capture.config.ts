import { defineConfig } from 'vitest/config';

/*
 * The capture completeness run (household-sharing spec §6.4): the whole db suite, with the first book of every
 * workspace shared and every write to it checked against the outbox. `npm run test:capture`.
 * capture.test.ts shares books itself (and tests the unshared path), so it runs only in the default suite.
 * net-worth-tax-slice.test.ts counts calls through a module mock, which the setup file's own imports load before the
 * mock can take hold, so it too runs only in the default suite (its sends are captured in joint-tax.test.ts here).
 * test/self/ (link my devices) writes raw rows into byte copies of one database to test the self channel, which no
 * household share is part of, so it too runs only in the default suite. fee-before-app-pair.test.ts does the same for
 * its two linked-devices cases (byte copies with a shared book and no sync device), so it runs only in the default suite.
 */
export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    exclude: ['test/sync/capture.test.ts', 'test/sync/capture-harness.test.ts', 'test/sync/net-worth-tax-slice.test.ts', 'test/self/**', 'test/fee-before-app-pair.test.ts'],
    setupFiles: ['test/sync/capture-setup.ts'],
    // The watch is judged after every test: over a long history (2,000 transactions) that takes longer than a hook's
    // default 10 s on a loaded machine (G8).
    hookTimeout: 120_000,
  },
});
