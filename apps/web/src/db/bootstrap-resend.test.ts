import { createDatabase, migrate } from '@expanses/db';
import { createNodeExecutor } from '@expanses/db/node';
import { afterEach, describe, expect, it, vi } from 'vitest';

/*
 * Final review M6: the daily resend of shared goal summaries is upkeep, not the open. It runs after the app has opened
 * (after first paint), and the open never waits for it.
 */

const resend = vi.hoisted(() => vi.fn<(database: unknown, date: string) => Promise<number>>());
vi.mock('@expanses/db', async (original) => ({ ...(await original<typeof import('@expanses/db')>()), resendGoalSummaries: resend }));

const { openAppDb } = await import('./bootstrap');

const store = new Map<string, string>();
vi.stubGlobal('localStorage', {
  getItem: (key: string) => store.get(key) ?? null,
  setItem: (key: string, value: string) => void store.set(key, value),
  removeItem: (key: string) => void store.delete(key),
});

afterEach(() => {
  resend.mockReset();
  store.clear();
});

async function freshDatabase() {
  const executor = createNodeExecutor();
  const database = createDatabase(executor);
  await migrate(database);
  return { executor, database };
}

describe('the daily resend of shared goal summaries', () => {
  it('runs after the open, once a day', async () => {
    const { executor, database } = await freshDatabase();
    try {
      resend.mockResolvedValue(0);
      const later: (() => Promise<void>)[] = [];
      await openAppDb(database, undefined, { afterOpen: (task) => void later.push(task) });
      expect(resend).not.toHaveBeenCalled();
      expect(later).toHaveLength(1);
      await later[0]!();
      expect(resend).toHaveBeenCalledTimes(1);
      // The same day again: nothing to do.
      await later[0]!();
      expect(resend).toHaveBeenCalledTimes(1);
    } finally {
      executor.close();
    }
  });

  it('is never waited for: a resend that has not finished does not hold the open', async () => {
    const { executor, database } = await freshDatabase();
    try {
      resend.mockReturnValue(new Promise<number>(() => undefined));
      let ran = 0;
      const app = await openAppDb(database, undefined, {
        afterOpen: (task) => {
          ran += 1;
          void task();
        },
      });
      expect(app.workspaceName).toBe('Personal');
      expect(ran).toBe(1);
      expect(resend).toHaveBeenCalledTimes(1);
    } finally {
      executor.close();
    }
  });
});
