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
  /** Lira changed back into rupiah: ₺`kurus` out, Rp `idr` into the bank. */
  const changeBack = (occurredOn: string, kurus: number, idr: number) =>
    postTransaction(fandri.database, fandri.ws, {
      occurredOn,
      description: 'Back to rupiah',
      lines: exchangeLines({ fromAccountId: lira, fromAmountMinor: kurus, fromCurrency: 'TRY', toAccountId: fandri.bank, toAmountMinor: idr, toCurrency: 'IDR', exchangeAccountId: exchange }),
      ratesToBase: RATES,
    });
  return { home, fandri, dewi, bookId, lira, exchange, restaurants, withdraw, spend, changeBack, dinnerBase, cacheRows };
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

  it('an exchange whose note the partner edited keeps its lira and its gain or loss pair, and the loss still follows a back-dated withdrawal (final review I3)', async () => {
    const h = await pair();
    await h.withdraw('2026-11-02', 5_250_000, 1_000_000);
    await h.changeBack('2026-11-20', 50_000, 250_000);
    await h.home.settle();
    /** The posted exchange on Fandri's phone: its id, each line's account, amount and currency, and the pair registered. */
    const exchangeHere = async () => {
      const [[id]] = (await h.fandri.database.db.values<[string]>(sql`SELECT id FROM transactions WHERE status = 'posted' AND occurred_on = '2026-11-20'`)) as [[string]];
      const lines = await h.fandri.database.db.values<[string | null, string, number, string]>(sql`
        SELECT a.system_key, a.name, e.amount_minor, e.currency FROM entries e JOIN accounts a ON a.id = e.account_id WHERE e.transaction_id = ${id} ORDER BY e.rowid`);
      const registered = await h.fandri.database.db.values(sql`SELECT count(*) FROM fx_gain_loss g JOIN entries e ON e.id = g.category_entry_id WHERE g.transaction_id = ${id} AND e.transaction_id = ${id}`);
      return { id, lines, registered: Number((registered[0] as [number])[0]) };
    };
    const loss = async () => (await exchangeHere()).lines.filter(([key]) => key === 'expense.exchange_loss').map(([, , amount]) => amount);
    expect(await loss()).toEqual([12_500]);
    // Dewi sees the exchange as a purchase in the shared Personal book (R8), and changes its note.
    const [theirs] = await listTransactions(h.dewi.database, h.dewi.ws, { from: '2026-11-20', to: '2026-11-20' });
    await replaceTransaction(h.dewi.database, h.dewi.ws, theirs!.id, {
      occurredOn: '2026-11-20',
      description: 'Lira back at the kiosk',
      lines: theirs!.entries.map((entry) => ({ accountId: entry.accountId, amountMinor: entry.amountMinor, currency: entry.currency })),
      ratesToBase: {},
    });
    await h.home.settle();
    await h.home.settle();
    const edited = await exchangeHere();
    // Reposted with the new note: still ₺500 out of the lira (the money side the purchase never carried is kept), and
    // its Exchange loss is the recalculation's pair again, not an ordinary line frozen at 12.500.
    expect(edited.lines.filter(([, name]) => name === 'Lira cash').map(([, , amount, currency]) => [amount, currency])).toEqual([[-50_000, 'TRY']]);
    expect(await loss()).toEqual([12_500]);
    expect(edited.registered).toBe(1);
    // A cheaper withdrawal recorded late, dated before the first: the ₺500 now cost 26.000, and the loss follows to 10.000.
    await h.withdraw('2026-11-01', 520_000, 100_000);
    expect(await loss()).toEqual([10_000]);
    const exchangeLeft = await h.fandri.database.db.values(sql`SELECT sum(amount_base_minor) FROM entries WHERE transaction_id = ${(await exchangeHere()).id} AND account_id = ${h.exchange}`);
    expect(exchangeLeft).toEqual([[0]]);
  });

  it('never fails a sync over an account it cannot recalculate', async () => {
    const h = await pair();
    await h.fandri.database.db.run(sql`INSERT INTO fx_recalc_pending (account_id, from_date) VALUES ('no-such-account', NULL)`);
    await expect(h.fandri.engine.syncOnce(h.bookId)).resolves.toBeDefined();
    expect(await h.fandri.database.db.values(sql`SELECT count(*) FROM fx_recalc_pending`)).toEqual([[0]]);
  });
});
