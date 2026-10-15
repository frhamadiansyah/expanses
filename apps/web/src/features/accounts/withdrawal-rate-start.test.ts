import { expenseLines } from '@expanses/core';
import { createAccount, createDatabase, createWorkspace, listAccounts, MemoryKeyStore, migrate, MIGRATIONS, postTransaction, withdrawalRateNoticeDue } from '@expanses/db';
import { createNodeExecutor } from '@expanses/db/node';
import { sql } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { openAppDb } from '../../db/bootstrap';
import { recalcInBatches } from './withdrawal-rate-start';

/*
 * The first run after the update (withdrawal rate §6, R18; Review Focus 5). Three foreign cash accounts from before
 * migration 0071, each opened at one rate and spent from at a later day's: invented figures throughout.
 */
async function beforeTheUpdate() {
  const database = createDatabase(createNodeExecutor());
  await migrate(database, MIGRATIONS.filter((m) => m.version < 71));
  const ws = await createWorkspace(database, { name: 'Personal', type: 'personal', baseCurrency: 'IDR' });
  const restaurants = (await listAccounts(database, ws)).find((a) => a.name === 'Restaurants')!.id;
  for (const [name, currency, opened, spent] of [
    ['Lira cash', 'TRY', 512, 530],
    ['Euro cash', 'EUR', 17_500, 17_800],
    ['Dollar cash', 'USD', 16_250, 16_400],
  ] as const) {
    const id = (await createAccount(database, ws, { name, kind: 'asset', subtype: 'cash', currency, openingBalanceMinor: 100_000, openingRateToBase: opened, openedOn: '2026-11-01' })).id;
    await postTransaction(database, ws, {
      occurredOn: '2026-11-03',
      description: `Dinner in ${currency}`,
      lines: expenseLines({ categoryAccountId: restaurants, paymentAccountId: id, amountMinor: 4_500, currency }),
      ratesToBase: { [currency]: spent },
    });
  }
  return { database, ws };
}

const queued = async (database: Awaited<ReturnType<typeof beforeTheUpdate>>['database']) => Number((await database.db.values<[number]>(sql`SELECT count(*) FROM fx_recalc_pending`))[0]![0]);

describe('the first run after the update (R18)', () => {
  it('opens the app without recalculating anything: the work waits for the screen (Review Focus 5)', async () => {
    const { database } = await beforeTheUpdate();
    await openAppDb(database, undefined, { keyStore: new MemoryKeyStore() });
    expect(await queued(database)).toBe(3);
    expect(await withdrawalRateNoticeDue(database)).toBe(false);
  });

  it('recalculates one account at a time, giving the app a turn between, then the notice is due', async () => {
    const { database } = await beforeTheUpdate();
    await migrate(database);
    const turns: number[] = [];
    const done = await recalcInBatches(database, { yieldTo: async () => void turns.push(await queued(database)) });
    expect(done).toBe(3);
    expect(turns).toEqual([2, 1]);
    expect(await withdrawalRateNoticeDue(database)).toBe(true);
    // ₺45 spent from lira opened at 512: Rp 23.040, not the Rp 23.850 it was posted at on a 530 day.
    const [row] = await database.db.values<[number]>(sql`
      SELECT e.amount_base_minor FROM entries e JOIN transactions t ON t.id = e.transaction_id JOIN accounts a ON a.id = e.account_id
      WHERE t.description = 'Dinner in TRY' AND a.kind = 'expense'`);
    expect(Number(row?.[0])).toBe(23_040);
  });

  it('stops between accounts when the screen goes away', async () => {
    const { database } = await beforeTheUpdate();
    await migrate(database);
    let stop = false;
    const done = await recalcInBatches(database, { yieldTo: async () => void (stop = true), stopped: () => stop });
    expect(done).toBe(1);
    expect(await queued(database)).toBe(2);
  });
});
