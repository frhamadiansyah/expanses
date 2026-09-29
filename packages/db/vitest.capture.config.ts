import { defineConfig } from 'vitest/config';

/*
 * The capture completeness run (household-sharing spec §6.4): the whole db suite, with the first book of every
 * workspace shared and every write to it checked against the outbox. `npm run test:capture`.
 * capture.test.ts shares books itself (and tests the unshared path), so it runs only in the default suite.
 * net-worth-entities.test.ts does too (via `shareBookForTest`, for its `applyChangeSet` calls), so it is excluded the
 * same way: under this config `createWorkspace` already shares each workspace's first personal book (`shareFirstBook`
 * in capture-setup.ts), and a second `shareBookForTest` on the same book id would conflict.
 */
export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    exclude: ['test/sync/capture.test.ts', 'test/sync/capture-harness.test.ts', 'test/sync/net-worth-entities.test.ts'],
    setupFiles: ['test/sync/capture-setup.ts'],
  },
});
