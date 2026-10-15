import { expenseLines } from '@expanses/core';
import { sql } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { createAccount, listAccounts, personalBook, postTransaction } from '../../src/index';
import { beforeFlushTx, captureRevaluingTx, capturePausedTx, configureCapture, sessionValueTx, withCapturePaused } from '../../src/sync/capture';
import { setupDb } from '../helpers';
import { clearOutbox, outboxOps, shareBookForTest } from './sync-helpers';

/* Withdrawal rate §6 and ruling R9: the recalculation runs at the end of the db transaction, and what it rewrites in
   place in a shared book goes out like any other change to a purchase. Invented figures. */

describe('a step left for the end of a db transaction', () => {
  it('runs once per key, before COMMIT, inside the same transaction', async () => {
    const { database } = await setupDb();
    const ran: string[] = [];
    await database.transaction(async (tx) => {
      expect(
        beforeFlushTx(tx, 'k', async () => {
          ran.push('k');
          await tx.run(sql`INSERT INTO settings (key, value) VALUES ('test.step', 'written')`);
        }),
      ).toBe(true);
      beforeFlushTx(tx, 'k', async () => void ran.push('again'));
      expect(ran).toEqual([]);
    });
    expect(ran).toEqual(['k']);
    expect(await database.db.values(sql`SELECT value FROM settings WHERE key = 'test.step'`)).toEqual([['written']]);
  });

  it('runs a step another step leaves', async () => {
    const { database } = await setupDb();
    const ran: string[] = [];
    await database.transaction(async (tx) => {
      beforeFlushTx(tx, 'first', async () => {
        ran.push('first');
        beforeFlushTx(tx, 'second', async () => void ran.push('second'));
      });
    });
    expect(ran).toEqual(['first', 'second']);
  });

  it('takes the whole transaction back when a step fails', async () => {
    const { database } = await setupDb();
    await expect(
      database.transaction(async (tx) => {
        await tx.run(sql`INSERT INTO settings (key, value) VALUES ('test.write', 'kept?')`);
        beforeFlushTx(tx, 'k', async () => {
          throw new Error('step failed');
        });
      }),
    ).rejects.toThrow('step failed');
    expect(await database.db.values(sql`SELECT value FROM settings WHERE key = 'test.write'`)).toEqual([]);
  });

  it('keeps a value for the rest of its transaction only', async () => {
    const { database } = await setupDb();
    const seen = await database.transaction(async (tx) => {
      sessionValueTx(tx, 'bag', () => ({ n: 0 }))!.n += 1;
      return sessionValueTx(tx, 'bag', () => ({ n: 0 }))!.n;
    });
    expect(seen).toBe(1);
    expect(await database.transaction(async (tx) => sessionValueTx(tx, 'bag', () => ({ n: 0 }))!.n)).toBe(0);
  });

  it('knows when apply paused capture, and not when capture is off for the whole database', async () => {
    const { database } = await setupDb();
    expect(await database.transaction(async (tx) => capturePausedTx(tx))).toBe(false);
    expect(await database.transaction((tx) => withCapturePaused(tx, async () => capturePausedTx(tx)))).toBe(true);
    configureCapture(database, { enabled: false });
    expect(await database.transaction((tx) => withCapturePaused(tx, async () => capturePausedTx(tx)))).toBe(false);
  });
});

describe('captureRevaluingTx', () => {
  async function liraPurchase() {
    const t = await setupDb();
    const book = await personalBook(t.database, t.ws);
    // The capture run shares every first Personal book from birth; this test shares it itself, as household.ts does.
    await t.database.execScript('DELETE FROM shared_books');
    await shareBookForTest(t.database, book.id);
    const lira = (await createAccount(t.database, t.ws, { name: 'Lira cash', kind: 'asset', subtype: 'cash', currency: 'TRY' })).id;
    const restaurants = (await listAccounts(t.database, t.ws)).find((a) => a.name === 'Restaurants')!.id;
    const id = await postTransaction(t.database, t.ws, {
      occurredOn: '2026-11-03',
      description: 'Dinner',
      lines: expenseLines({ categoryAccountId: restaurants, paymentAccountId: lira, amountMinor: 45_000, currency: 'TRY' }),
      ratesToBase: { TRY: 512 },
    });
    await clearOutbox(t.database);
    return { ...t, lira, restaurants, id };
  }

  it('sends a shared purchase whose base figures were rewritten in place as a money change', async () => {
    const { database, lira, restaurants, id } = await liraPurchase();
    await database.transaction(async (tx) => {
      await captureRevaluingTx(tx, id);
      await tx.run(sql`UPDATE entries SET amount_base_minor = -236250 WHERE transaction_id = ${id} AND account_id = ${lira}`);
      await tx.run(sql`UPDATE entries SET amount_base_minor = 236250 WHERE transaction_id = ${id} AND account_id = ${restaurants}`);
    });
    const ops = (await outboxOps(database)).filter((op) => op.entity === 'purchase');
    expect(ops).toHaveLength(1);
    const fields = (ops[0] as unknown as { fields: { money: { lines: { amountBaseMinor: number }[] } } }).fields;
    expect(Object.keys(fields)).toEqual(['money']);
    expect(fields.money.lines.map((line) => line.amountBaseMinor)).toEqual([236_250]);
  });

  it('sends nothing when no figure moved', async () => {
    const { database, id } = await liraPurchase();
    await database.transaction((tx) => captureRevaluingTx(tx, id));
    expect(await outboxOps(database)).toEqual([]);
  });
});
