import { exchangeLines, expenseLines } from '@expanses/core';
import { sql } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { createAccount, listTransactions, postTransaction, replaceTransaction, systemAccountId, upsertRate } from '../../src/index';
import { categoryOf, type Device, Household } from './household';

/*
 * Withdrawal rate §6 in a household of two phones. Fandri holds lira cash and spends it in the shared Personal book;
 * Dewi holds the purchase on a placeholder for Fandri. Invented: lira at 525 and 540, the day's 512.
 */
const DAY = '2026-11-03';
const RATES = { TRY: 512 };

async function pair() {
  const home = new Household();
  const fandri = await home.device('Fandri');
  const dewi = await home.device('Dewi');
  const bookId = await home.share(fandri);
  await home.join(dewi, fandri);
  for (const d of [fandri, dewi]) await upsertRate(d.database, { fromCurrency: 'TRY', toCurrency: 'IDR', onDate: '2026-11-01', rate: 512, source: 'manual', sourceDate: '2026-11-01' });
  const lira = (await createAccount(fandri.database, fandri.ws, { name: 'Lira cash', kind: 'asset', subtype: 'cash', currency: 'TRY' })).id;
  const exchange = await systemAccountId(fandri.database.db, fandri.ws, 'currency_exchange');
  const restaurants = await categoryOf(fandri.database, bookId, 'Restaurants');
  const withdraw = (occurredOn: string, idr: number, kurus: number) =>
    postTransaction(fandri.database, fandri.ws, {
      occurredOn,
      description: 'ATM',
      lines: exchangeLines({ fromAccountId: fandri.bank, fromAmountMinor: idr, fromCurrency: 'IDR', toAccountId: lira, toAmountMinor: kurus, toCurrency: 'TRY', exchangeAccountId: exchange }),
      ratesToBase: RATES,
    });
  const spend = (kurus: number) =>
    postTransaction(fandri.database, fandri.ws, { occurredOn: DAY, description: 'Dinner', lines: expenseLines({ categoryAccountId: restaurants, paymentAccountId: lira, amountMinor: kurus, currency: 'TRY' }), ratesToBase: RATES });
  /** The dinner's category figure on a phone. */
  const dinnerBase = async (d: Device) => {
    const [row] = await d.database.db.values<[number]>(sql`
      SELECT e.amount_base_minor FROM entries e JOIN transactions t ON t.id = e.transaction_id
      WHERE t.status = 'posted' AND t.description = 'Dinner' AND e.account_id = ${restaurants}`);
    return row ? Number(row[0]) : null;
  };
  const cacheRows = async (d: Device) =>
    Number(
      (await d.database.db.values<[number]>(sql`SELECT (SELECT count(*) FROM fx_lot_uses) + (SELECT count(*) FROM fx_shortfalls) + (SELECT count(*) FROM fx_day_values) + (SELECT count(*) FROM fx_recalc_pending)`))[0]![0],
    );
  return { home, fandri, dewi, bookId, lira, restaurants, withdraw, spend, dinnerBase, cacheRows };
}

describe('the withdrawal rate in a household', () => {
  it('the partner’s phone takes the payer’s withdrawal-rate figure and recalculates nothing (Review Focus 3)', async () => {
    const h = await pair();
    await h.withdraw('2026-11-02', 5_250_000, 1_000_000);
    await h.spend(45_000);
    await h.home.settle();
    expect(await h.dinnerBase(h.fandri)).toBe(236_250);
    expect(await h.dinnerBase(h.dewi)).toBe(236_250);
    expect(await h.cacheRows(h.dewi)).toBe(0);
    const [placeholder] = await h.dewi.database.db.values<[number]>(sql`
      SELECT e.amount_base_minor FROM entries e JOIN transactions t ON t.id = e.transaction_id
      WHERE t.status = 'posted' AND t.description = 'Dinner' AND e.account_id IN (SELECT account_id FROM book_member_accounts)`);
    expect(Number(placeholder![0])).toBe(-236_250);
  });

  it('a withdrawal back-dated on the payer’s phone reaches the partner as a new figure (Review Focus 1)', async () => {
    const h = await pair();
    await h.spend(45_000);
    await h.home.settle();
    expect(await h.dinnerBase(h.dewi)).toBe(230_400);
    await h.withdraw('2026-11-02', 5_250_000, 1_000_000);
    await h.home.settle();
    expect(await h.dinnerBase(h.fandri)).toBe(236_250);
    expect(await h.dinnerBase(h.dewi)).toBe(236_250);
  });

  it('an amount the partner changed comes back costed by the payer’s phone, after the sync (R9)', async () => {
    const h = await pair();
    await h.withdraw('2026-11-02', 5_250_000, 1_000_000);
    await h.spend(45_000);
    await h.home.settle();
    const [theirs] = (await listTransactions(h.dewi.database, h.dewi.ws, { from: DAY, to: DAY })).filter((tx) => tx.description === 'Dinner');
    const placeholder = theirs!.entries.find((entry) => entry.accountKind === 'asset')!.accountId;
    await replaceTransaction(h.dewi.database, h.dewi.ws, theirs!.id, {
      occurredOn: DAY,
      description: 'Dinner',
      lines: [
        { accountId: h.restaurants, amountMinor: 50_000, currency: 'TRY' },
        { accountId: placeholder, amountMinor: -50_000, currency: 'TRY' },
      ],
      ratesToBase: RATES,
    });
    await h.home.settle();
    await h.home.settle();
    // ₺500 at 525 on the payer's phone, sent back to the partner's.
    expect(await h.dinnerBase(h.fandri)).toBe(262_500);
    expect(await h.dinnerBase(h.dewi)).toBe(262_500);
    expect(await h.cacheRows(h.dewi)).toBe(0);
  });

  it('never fails a sync over an account it cannot recalculate', async () => {
    const h = await pair();
    await h.fandri.database.db.run(sql`INSERT INTO fx_recalc_pending (account_id, from_date) VALUES ('no-such-account', NULL)`);
    await expect(h.fandri.engine.syncOnce(h.bookId)).resolves.toBeDefined();
    expect(await h.fandri.database.db.values(sql`SELECT count(*) FROM fx_recalc_pending`)).toEqual([[0]]);
  });
});
