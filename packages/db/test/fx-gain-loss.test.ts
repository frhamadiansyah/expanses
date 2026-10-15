import { transferLines } from '@expanses/core';
import { sql } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { checkLedgerIntegrity, createAccount, personalBook, postTransaction } from '../src/index';
import { gainLossPairOfTx, writeGainLossTx } from '../src/repos/fx-gain-loss';
import { setupDb } from './helpers';
import { clearOutbox, outboxOps, shareBookForTest } from './sync/sync-helpers';

/*
 * Withdrawal rate §5, ruling R8. The pair is written onto a plain rupiah transfer here so nothing else touches it: the
 * figures it is given are invented, and which exchange earns them is Task 6's.
 */
async function setup() {
  const t = await setupDb();
  const bank = (await createAccount(t.database, t.ws, { name: 'Rupiah current', kind: 'asset', subtype: 'bank', currency: 'IDR', openingBalanceMinor: 1_000_000, openedOn: '2026-11-01' })).id;
  const wallet = (await createAccount(t.database, t.ws, { name: 'Rupiah wallet', kind: 'asset', subtype: 'cash', currency: 'IDR' })).id;
  const id = await postTransaction(t.database, t.ws, { occurredOn: '2026-11-20', description: 'Back to rupiah', lines: transferLines({ fromAccountId: bank, toAccountId: wallet, amountMinor: 250_000, currency: 'IDR' }) });
  const personal = await personalBook(t.database, t.ws);
  const pair = () =>
    t.database.db.values<[string | null, string, number, string, number]>(sql`
      SELECT a.system_key, a.name, e.amount_minor, e.currency, e.amount_base_minor FROM entries e JOIN accounts a ON a.id = e.account_id
      WHERE e.transaction_id = ${id} AND (a.kind IN ('income', 'expense') OR a.system_key = 'currency_exchange') ORDER BY e.amount_minor`);
  const filed = () => t.database.db.values<[string]>(sql`SELECT book_id FROM book_transactions WHERE transaction_id = ${id}`);
  const write = (gainLossBaseMinor: number) => t.database.transaction((tx) => writeGainLossTx(tx, t.ws, id, gainLossBaseMinor));
  return { ...t, id, personal, pair, filed, write };
}

describe('writeGainLossTx (§5, R8)', () => {
  it('books a loss on Exchange loss against the exchange account, and files the transfer in Personal', async () => {
    const t = await setup();
    expect(await t.write(-12_500)).toBe(true);
    expect(await t.pair()).toEqual([
      ['currency_exchange', 'Currency Exchange', -12_500, 'IDR', -12_500],
      ['expense.exchange_loss', 'Exchange loss', 12_500, 'IDR', 12_500],
    ]);
    expect(await t.filed()).toEqual([[t.personal.id]]);
    expect(await checkLedgerIntegrity(t.database, t.ws)).toEqual([]);
    const [category] = await t.database.db.values<[string]>(sql`SELECT bc.book_id FROM accounts a JOIN book_categories bc ON bc.category_account_id = a.id WHERE a.system_key = 'expense.exchange_loss'`);
    expect(category).toEqual([t.personal.id]);
  });

  it('writes nothing for the same figure, replaces the pair for a new one, and moves it to Exchange gain for a gain', async () => {
    const t = await setup();
    await t.write(-12_500);
    expect(await t.write(-12_500)).toBe(false);
    await t.write(-10_000);
    expect((await t.pair()).map((row) => row[2])).toEqual([-10_000, 10_000]);
    await t.write(7_500);
    expect(await t.pair()).toEqual([
      ['income.exchange_gain', 'Exchange gain', -7_500, 'IDR', -7_500],
      ['currency_exchange', 'Currency Exchange', 7_500, 'IDR', 7_500],
    ]);
    expect(await t.database.db.values(sql`SELECT count(*) FROM fx_gain_loss WHERE transaction_id = ${t.id}`)).toEqual([[1]]);
    expect((await t.database.transaction((tx) => gainLossPairOfTx(tx, t.id)))?.key).toBe('income.exchange_gain');
  });

  it('takes the pair away at zero, and the transfer back out of every workspace', async () => {
    const t = await setup();
    await t.write(-12_500);
    expect(await t.write(0)).toBe(true);
    expect(await t.pair()).toEqual([]);
    expect(await t.filed()).toEqual([]);
    expect(await t.write(0)).toBe(false);
  });

  it('makes each category once, by its key', async () => {
    const t = await setup();
    for (const figure of [-1, 1, -2, 2]) await t.write(figure);
    expect(await t.database.db.values(sql`SELECT system_key, count(*) FROM accounts WHERE system_key IN ('income.exchange_gain', 'expense.exchange_loss') GROUP BY system_key ORDER BY system_key`)).toEqual([
      ['expense.exchange_loss', 1],
      ['income.exchange_gain', 1],
    ]);
  });

  it('keeps a shared event’s own transaction out of every workspace, pair and all (R7)', async () => {
    const t = await setup();
    await t.database.db.run(sql`INSERT INTO event_postings (book_id, record_id, kind, transaction_id) VALUES ('ev-book', 'rec-1', 'expense', ${t.id})`);
    await t.write(-500);
    expect((await t.pair()).length).toBe(2);
    expect(await t.filed()).toEqual([]);
  });

  it('in a shared Personal book, sends the newly filed transfer as a purchase and its unfiling as a void', async () => {
    const t = await setup();
    // The capture run shares every first Personal book from birth; this test shares it itself, as household.ts does.
    await t.database.execScript('DELETE FROM shared_books');
    await shareBookForTest(t.database, t.personal.id);
    await clearOutbox(t.database);
    await t.write(-12_500);
    const sent = (await outboxOps(t.database)).filter((op) => op.entity === 'purchase' && op.id === t.id);
    expect(sent).toHaveLength(1);
    expect(JSON.stringify(sent[0])).toContain('12500');
    await clearOutbox(t.database);
    await t.write(0);
    expect((await outboxOps(t.database)).filter((op) => op.entity === 'purchase' && op.id === t.id).map((op) => (op as { fields: unknown }).fields)).toEqual([{ void: true }]);
  });
});
