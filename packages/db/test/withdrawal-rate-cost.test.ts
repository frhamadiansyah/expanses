import { exchangeLines, expenseLines } from '@expanses/core';
import { sql } from 'drizzle-orm';
import { describe, expect, it, vi } from 'vitest';
import { createAccount, createDatabase, createWorkspace, listAccounts, migrate, postTransaction, postTransactionTx, systemAccountId } from '../src/index';
import { createNodeExecutor } from '../src/node';
import { recalcPendingForeign } from '../src/repos/fx-pending';
import { withCapturePaused } from '../src/sync/capture';

/*
 * Final review I2: a save in a foreign account with a long history costs a small, fixed number of queries plus what
 * changed — not two per transaction in the account. On the phone every query is a round trip to the sqlite worker.
 * Invented: a lira pocket with one withdrawal (at 520–539) for every 19 dinners, 2.000 transactions in all.
 */
const RATES = { TRY: 512 };

// The capture run checks every write of the 2.000 against the outbox after the test, which takes longer than a hook's
// default 10 s on a loaded machine.
vi.setConfig({ hookTimeout: 180_000 });

async function longHistory() {
  const executor = createNodeExecutor();
  let queries = 0;
  const counted = { ...executor, query: (...args: Parameters<typeof executor.query>) => ((queries += 1), executor.query(...args)) };
  const database = createDatabase(counted);
  await migrate(database);
  const ws = await createWorkspace(database, { name: 'Personal', type: 'personal', baseCurrency: 'IDR' });
  const restaurants = (await listAccounts(database, ws)).find((a) => a.name === 'Restaurants')!.id;
  const bank = (await createAccount(database, ws, { name: 'Rupiah current', kind: 'asset', subtype: 'bank', currency: 'IDR', openingBalanceMinor: 9_000_000_000, openedOn: '2020-01-01' })).id;
  const lira = (await createAccount(database, ws, { name: 'Lira cash', kind: 'asset', subtype: 'cash', currency: 'TRY' })).id;
  const exchange = await systemAccountId(database.db, ws, 'currency_exchange');
  const day = (n: number) => new Date(Date.UTC(2021, 0, 1) + n * 86_400_000).toISOString().slice(0, 10);
  const withdrawal = (occurredOn: string, rate: number) => ({
    occurredOn,
    description: 'ATM',
    lines: exchangeLines({ fromAccountId: bank, fromAmountMinor: 200_000 * rate / 100, fromCurrency: 'IDR', toAccountId: lira, toAmountMinor: 200_000, toCurrency: 'TRY', exchangeAccountId: exchange }),
    ratesToBase: RATES,
  });
  const dinner = (occurredOn: string, kurus: number) => ({
    occurredOn,
    description: 'Dinner',
    lines: expenseLines({ categoryAccountId: restaurants, paymentAccountId: lira, amountMinor: kurus, currency: 'TRY' }),
    ratesToBase: RATES,
  });
  // Written as sync apply writes (capture paused, so each account waits in the queue), then recalculated once.
  await database.transaction((tx) =>
    withCapturePaused(tx, async () => {
      for (let i = 0; i < 2_000; i++) {
        if (i % 20 === 0) await postTransactionTx(tx, ws, withdrawal(day(i), 520 + (i % 20 === 0 ? (i / 20) % 20 : 0)));
        else await postTransactionTx(tx, ws, dinner(day(i), 9_000 + (i % 7) * 100));
      }
    }),
  );
  await recalcPendingForeign(database);
  const measure = async (fn: () => Promise<unknown>) => {
    const before = queries;
    const started = performance.now();
    await fn();
    return { queries: queries - before, ms: Math.round(performance.now() - started) };
  };
  return { database, ws, lira, day, withdrawal, dinner, measure };
}

describe('the cost of a save in a long foreign history (final review I2)', () => {
  it('a new dinner at the end of 2.000 transactions is a small, fixed number of queries, and writes only its own cache rows', async () => {
    const t = await longHistory();
    const before = Number((await t.database.db.values<[number]>(sql`SELECT count(*) FROM fx_lot_uses`))[0]![0]);
    const latest = await t.measure(() => postTransaction(t.database, t.ws, t.dinner(t.day(2_001), 9_500)));
    // Was about 4.200 queries (two per transaction in the account, and every cache row deleted and written again).
    expect(latest.queries).toBeLessThan(80);
    const after = Number((await t.database.db.values<[number]>(sql`SELECT count(*) FROM fx_lot_uses`))[0]![0]);
    expect(after - before).toBeGreaterThanOrEqual(1);
    expect(after - before).toBeLessThanOrEqual(2);
    // A dinner back-dated into the middle moves every dinner after it, and costs about what that moves, not twice the history.
    const middle = await t.measure(() => postTransaction(t.database, t.ws, t.dinner(t.day(1_000), 9_500)));
    const moved = Number((await t.database.db.values<[number]>(sql`SELECT count(*) FROM audit_log WHERE action = 'revalue'`))[0]![0]);
    expect(middle.queries).toBeLessThan(80 + 4 * 1_000);
    console.info(`withdrawal rate, 2.000 transactions: a new dinner ${latest.queries} queries in ${latest.ms} ms; a dinner back-dated to the middle ${middle.queries} queries in ${middle.ms} ms (${moved} revalue rows so far)`);
  }, 120_000);
});
