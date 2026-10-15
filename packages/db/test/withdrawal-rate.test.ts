import { exchangeLines, expenseLines, splitExpenseLines, transferLines } from '@expanses/core';
import { sql } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { checkLedgerIntegrity, createAccount, createBook, isLotAccountTx, listAccounts, MAX_CHAIN, personalBook, postTransaction, recalcForeignTx, systemAccountId } from '../src/index';
import { setupDb } from './helpers';
import { clearOutbox, outboxOps, shareBookForTest } from './sync/sync-helpers';

/*
 * Withdrawal rate §3–§6. A rupiah book with lira cash, a lira wallet and euro cash; the day's rates are invented (512
 * rupiah a lira, 17.500 a euro), and so is every withdrawal (525, 540).
 */
const RATES = { TRY: 512, EUR: 17_500 };

async function trip() {
  const t = await setupDb();
  const all = await listAccounts(t.database, t.ws);
  const category = (name: string) => all.find((a) => a.name === name && a.kind === 'expense')!.id;
  const bank = (await createAccount(t.database, t.ws, { name: 'Rupiah current', kind: 'asset', subtype: 'bank', currency: 'IDR', openingBalanceMinor: 50_000_000, openedOn: '2026-10-01' })).id;
  const lira = (await createAccount(t.database, t.ws, { name: 'Lira cash', kind: 'asset', subtype: 'cash', currency: 'TRY' })).id;
  const wallet = (await createAccount(t.database, t.ws, { name: 'Lira wallet', kind: 'asset', subtype: 'ewallet', currency: 'TRY' })).id;
  const euros = (await createAccount(t.database, t.ws, { name: 'Euro cash', kind: 'asset', subtype: 'cash', currency: 'EUR' })).id;
  const exchange = await systemAccountId(t.database.db, t.ws, 'currency_exchange');
  const post = (occurredOn: string, description: string, lines: Parameters<typeof postTransaction>[2]['lines']) => postTransaction(t.database, t.ws, { occurredOn, description, lines, ratesToBase: RATES });
  /** Rupiah into lira at an ATM: `idr` left the bank, `kurus` arrived. */
  const withdraw = (occurredOn: string, idr: number, kurus: number, into = lira) =>
    post(occurredOn, 'ATM', exchangeLines({ fromAccountId: bank, fromAmountMinor: idr, fromCurrency: 'IDR', toAccountId: into, toAmountMinor: kurus, toCurrency: 'TRY', exchangeAccountId: exchange }));
  const spend = (occurredOn: string, kurus: number, from = lira, name = 'Restaurants') =>
    post(occurredOn, 'Dinner', expenseLines({ categoryAccountId: category(name), paymentAccountId: from, amountMinor: kurus, currency: 'TRY' }));
  const move = (occurredOn: string, kurus: number, from: string, to: string) => post(occurredOn, 'Between pockets', transferLines({ fromAccountId: from, toAccountId: to, amountMinor: kurus, currency: 'TRY' }));
  const recalc = (accountId = lira, fromDate: string | null = null, maxSteps?: number) =>
    t.database.transaction((tx) => recalcForeignTx(tx, t.ws, accountId, fromDate, maxSteps === undefined ? {} : { maxSteps }));
  /** A spend's two figures by account (an exchange has two lines on the exchange account: read those with `exchangeBase`). */
  const bases = async (transactionId: string) =>
    Object.fromEntries((await t.database.db.values<[string, number]>(sql`SELECT account_id, amount_base_minor FROM entries WHERE transaction_id = ${transactionId}`)).map(([a, b]) => [a, Number(b)]));
  const exchangeBase = async (transactionId: string) =>
    Number((await t.database.db.values<[number]>(sql`SELECT coalesce(sum(amount_base_minor), 0) FROM entries WHERE transaction_id = ${transactionId} AND account_id = ${exchange}`))[0]![0]);
  const resultLine = (transactionId: string) =>
    t.database.db.values<[string, number]>(sql`
      SELECT a.system_key, e.amount_minor FROM entries e JOIN accounts a ON a.id = e.account_id
      WHERE e.transaction_id = ${transactionId} AND a.system_key IN ('income.exchange_gain', 'expense.exchange_loss')`);
  const revalued = async () => Number((await t.database.db.values<[number]>(sql`SELECT count(*) FROM audit_log WHERE action = 'revalue'`))[0]![0]);
  return { ...t, category, bank, lira, wallet, euros, exchange, post, withdraw, spend, move, recalc, bases, exchangeBase, resultLine, revalued };
}

describe('recalcForeignTx: spending (§4)', () => {
  it('spends lira withdrawn at 525 at 525, not at the day’s 512, and the withdrawal costs the rupiah that left', async () => {
    const t = await trip();
    const atm = await t.withdraw('2026-11-02', 5_250_000, 1_000_000);
    const dinner = await t.spend('2026-11-03', 45_000);
    await t.recalc();
    expect(await t.bases(dinner)).toEqual({ [t.lira]: -236_250, [t.category('Restaurants')]: 236_250 });
    expect((await t.bases(atm))[t.lira]).toBe(5_250_000);
    expect(await t.exchangeBase(atm)).toBe(0);
    expect(await t.database.db.values(sql`SELECT fx_rate_to_base FROM entries WHERE transaction_id = ${dinner} AND account_id = ${t.lira}`)).toEqual([[525]]);
  });

  it('adds a three-way split up to the money line exactly, the remainder on the largest line (Review Focus 4)', async () => {
    const t = await trip();
    await t.withdraw('2026-11-02', 5_250_000, 1_000_000);
    const market = await t.post(
      '2026-11-03',
      'Market',
      splitExpenseLines({
        paymentAccountId: t.lira,
        currency: 'TRY',
        splits: [
          { categoryAccountId: t.category('Restaurants'), amountMinor: 10_000 },
          { categoryAccountId: t.category('Groceries'), amountMinor: 10_000 },
          { categoryAccountId: t.category('Hotels'), amountMinor: 10_001 },
        ],
      }),
    );
    await t.recalc();
    const b = await t.bases(market);
    expect(b[t.lira]).toBe(-157_505);
    expect([b[t.category('Restaurants')], b[t.category('Groceries')], b[t.category('Hotels')]]).toEqual([52_499, 52_499, 52_507]);
  });

  it('spends the oldest withdrawal first', async () => {
    const t = await trip();
    await t.withdraw('2026-11-02', 52_500, 10_000);
    await t.withdraw('2026-11-09', 54_000, 10_000);
    const dinner = await t.spend('2026-11-12', 15_000);
    await t.recalc();
    expect((await t.bases(dinner))[t.lira]).toBe(-79_500);
  });

  it('values what no withdrawal covers at its posted figure, and records the shortfall (R4)', async () => {
    const t = await trip();
    await t.withdraw('2026-11-02', 105_000, 20_000);
    const dinner = await t.spend('2026-11-03', 50_000);
    await t.recalc();
    expect((await t.bases(dinner))[t.lira]).toBe(-258_600);
    expect(await t.database.db.values(sql`SELECT uncovered_minor FROM fx_shortfalls WHERE account_id = ${t.lira}`)).toEqual([[30_000]]);
  });

  it('keeps every figure of an account that never recorded a withdrawal (R4)', async () => {
    const t = await trip();
    const dinner = await t.spend('2026-11-03', 45_000);
    const before = await t.bases(dinner);
    const audits = await t.revalued();
    await t.recalc();
    expect(await t.bases(dinner)).toEqual(before);
    expect(before[t.lira]).toBe(-230_400);
    expect(await t.revalued()).toBe(audits);
    expect(await t.database.db.values(sql`SELECT uncovered_minor FROM fx_shortfalls WHERE account_id = ${t.lira}`)).toEqual([[45_000]]);
  });

  it('never moves a figure dated before the change (R10)', async () => {
    const t = await trip();
    await t.withdraw('2026-11-02', 52_500, 10_000);
    await t.spend('2026-11-03', 2_000);
    await t.spend('2026-11-05', 3_000);
    await t.recalc();
    const snapshot = async () => t.database.db.values<[string, string, number]>(sql`SELECT e.id, t.occurred_on, e.amount_base_minor FROM entries e JOIN transactions t ON t.id = e.transaction_id ORDER BY e.id`);
    const earlier = (await snapshot()).filter(([, on]) => on < '2026-11-04');
    await t.withdraw('2026-11-04', 54_000, 10_000);
    const later = await t.spend('2026-11-10', 10_000);
    await t.recalc(t.lira, '2026-11-04');
    expect((await snapshot()).filter(([, on]) => on < '2026-11-04')).toEqual(earlier);
    // ₺50 left of the 2 Nov withdrawal (26.250), then ₺50 of the 4 Nov one (27.000).
    expect((await t.bases(later))[t.lira]).toBe(-53_250);
  });
});

describe('recalcForeignTx: exchanges (§5)', () => {
  it('changing leftovers back books an exchange loss as spending, filed in Personal', async () => {
    const t = await trip();
    await t.withdraw('2026-11-02', 5_250_000, 1_000_000);
    const back = await t.post('2026-11-20', 'Back to rupiah', exchangeLines({ fromAccountId: t.lira, fromAmountMinor: 50_000, fromCurrency: 'TRY', toAccountId: t.bank, toAmountMinor: 250_000, toCurrency: 'IDR', exchangeAccountId: t.exchange }));
    await t.recalc();
    expect(await t.resultLine(back)).toEqual([['expense.exchange_loss', 12_500]]);
    expect(await t.exchangeBase(back)).toBe(0);
    const personal = await personalBook(t.database, t.ws);
    expect(await t.database.db.values(sql`SELECT book_id FROM book_transactions WHERE transaction_id = ${back}`)).toEqual([[personal.id]]);
    expect(await checkLedgerIntegrity(t.database, t.ws)).toEqual([]);
  });

  it('a better rate the other way is an exchange gain', async () => {
    const t = await trip();
    await t.withdraw('2026-11-02', 5_250_000, 1_000_000);
    const back = await t.post('2026-11-20', 'Back to rupiah', exchangeLines({ fromAccountId: t.lira, fromAmountMinor: 50_000, fromCurrency: 'TRY', toAccountId: t.bank, toAmountMinor: 270_000, toCurrency: 'IDR', exchangeAccountId: t.exchange }));
    await t.recalc();
    expect(await t.resultLine(back)).toEqual([['income.exchange_gain', -7_500]]);
  });

  it('lira changed into euros: the euros keep their own figure and the difference is a loss (R6)', async () => {
    const t = await trip();
    await t.withdraw('2026-11-02', 5_250_000, 1_000_000);
    const change = await t.post('2026-11-06', 'Lira to euros', exchangeLines({ fromAccountId: t.lira, fromAmountMinor: 100_000, fromCurrency: 'TRY', toAccountId: t.euros, toAmountMinor: 2_900, toCurrency: 'EUR', exchangeAccountId: t.exchange }));
    await t.recalc();
    expect((await t.bases(change))[t.euros]).toBe(507_500);
    expect(await t.resultLine(change)).toEqual([['expense.exchange_loss', 17_500]]);
  });
});

describe('recalcForeignTx: moving lira between pockets (§3, Review Focus 2)', () => {
  it('carries the withdrawals into the other pocket with their own dates, oldest spent first', async () => {
    const t = await trip();
    await t.withdraw('2026-11-02', 52_500, 10_000);
    await t.withdraw('2026-11-05', 54_000, 10_000, t.wallet);
    await t.move('2026-11-08', 10_000, t.lira, t.wallet);
    const first = await t.spend('2026-11-09', 10_000, t.wallet);
    const second = await t.spend('2026-11-10', 10_000, t.wallet);
    await t.recalc(t.lira);
    expect((await t.bases(first))[t.wallet]).toBe(-52_500);
    expect((await t.bases(second))[t.wallet]).toBe(-54_000);
  });

  it('ends a same-day round trip between two pockets, and the two spends add up to the one withdrawal', async () => {
    const t = await trip();
    await t.withdraw('2026-11-02', 105_000, 20_000);
    await t.move('2026-11-05', 10_000, t.lira, t.wallet);
    await t.move('2026-11-05', 5_000, t.wallet, t.lira);
    const fromLira = await t.spend('2026-11-06', 15_000, t.lira);
    const fromWallet = await t.spend('2026-11-06', 5_000, t.wallet);
    const { steps } = await t.recalc(t.lira);
    await t.recalc(t.wallet);
    expect(steps).toBeLessThan(MAX_CHAIN);
    expect((await t.bases(fromLira))[t.lira]).toBe(-78_750);
    expect((await t.bases(fromWallet))[t.wallet]).toBe(-26_250);
    expect(await t.database.db.values(sql`SELECT count(*) FROM fx_recalc_pending`)).toEqual([[0]]);
  });

  it('leaves the rest of a chain past its limit to the queue (R10)', async () => {
    const t = await trip();
    await t.withdraw('2026-11-02', 52_500, 10_000);
    await t.move('2026-11-08', 10_000, t.lira, t.wallet);
    // Forget what the lira's outflows used, so this pass sees the move's lots as new and chains (whether or not the
    // doors already recalculated: Task 7 wires them).
    await t.database.db.run(sql`DELETE FROM fx_lot_uses`);
    await t.database.db.run(sql`DELETE FROM fx_recalc_pending`);
    await t.recalc(t.lira, null, 1);
    expect(await t.database.db.values(sql`SELECT account_id, from_date FROM fx_recalc_pending`)).toEqual([[t.wallet, '2026-11-08']]);
  });
});

describe('recalcForeignTx: whose account, and how often', () => {
  it('never takes a household placeholder for a lira account of this phone’s (Review Focus 3, R2)', async () => {
    const t = await trip();
    const partner = (await createAccount(t.database, t.ws, { name: 'Partner · TRY', kind: 'asset', subtype: 'cash', currency: 'TRY' })).id;
    await t.database.db.run(sql`INSERT INTO book_member_accounts (account_id, book_id, member_id, currency) VALUES (${partner}, 'book-x', 'member-x', 'TRY')`);
    const dinner = await t.spend('2026-11-03', 45_000, partner);
    const before = await t.bases(dinner);
    await t.recalc(partner);
    expect(await t.bases(dinner)).toEqual(before);
    expect(await t.database.transaction((tx) => isLotAccountTx(tx, t.ws, partner))).toBeNull();
    expect(await t.database.db.values(sql`SELECT count(*) FROM fx_shortfalls WHERE account_id = ${partner}`)).toEqual([[0]]);
  });

  it('writes nothing the second time', async () => {
    const t = await trip();
    await t.withdraw('2026-11-02', 5_250_000, 1_000_000);
    await t.spend('2026-11-03', 45_000);
    await t.recalc();
    const audits = await t.revalued();
    await t.recalc();
    expect(await t.revalued()).toBe(audits);
  });

  it('in a shared Personal book, the spend goes out at the withdrawal rate', async () => {
    const t = await trip();
    const personal = await personalBook(t.database, t.ws);
    // The capture run shares every first Personal book from birth; this test shares it itself, as household.ts does.
    await t.database.execScript('DELETE FROM shared_books');
    await shareBookForTest(t.database, personal.id);
    await clearOutbox(t.database);
    await t.withdraw('2026-11-02', 5_250_000, 1_000_000);
    const dinner = await t.spend('2026-11-03', 45_000);
    await t.recalc();
    const sent = (await outboxOps(t.database)).filter((op) => op.entity === 'purchase' && op.id === dinner && op.op === 'upsert') as { fields: { money?: { lines: { amountBaseMinor: number }[] } } }[];
    const latest = [...sent].reverse().find((op) => op.fields.money);
    expect(latest?.fields.money?.lines.map((line) => line.amountBaseMinor)).toEqual([236_250]);
  });
});

describe('recalcForeignTx: where a gain or loss may go (§5, R7, R8)', () => {
  /** Lira changed back with a fee filed in a second workspace: lira −₺500, exchange ₺480, the fee ₺20, Rp 250.000 in. */
  async function feeInBusiness() {
    const t = await trip();
    const personal = await personalBook(t.database, t.ws);
    const business = await createBook(t.database, t.ws, { name: 'Business', kind: 'business', baseCurrency: 'IDR', copyCategoriesFrom: personal.id });
    const [row] = await t.database.db.values<[string]>(sql`
      SELECT a.id FROM accounts a JOIN book_categories bc ON bc.category_account_id = a.id
      WHERE bc.book_id = ${business} AND a.kind = 'expense' ORDER BY a.name LIMIT 1`);
    const fee = row![0];
    await t.withdraw('2026-11-02', 5_250_000, 1_000_000);
    const back = await t.post('2026-11-20', 'Back to rupiah', [
      { accountId: t.lira, amountMinor: -50_000, currency: 'TRY' },
      { accountId: t.exchange, amountMinor: 48_000, currency: 'TRY' },
      { accountId: fee, amountMinor: 2_000, currency: 'TRY' },
      { accountId: t.bank, amountMinor: 250_000, currency: 'IDR' },
      { accountId: t.exchange, amountMinor: -250_000, currency: 'IDR' },
    ]);
    return { ...t, business, fee, back };
  }

  it('never puts a pair on a transaction filed in a workspace: its own foreign lines take the whole cost', async () => {
    const t = await feeInBusiness();
    await t.recalc();
    // ₺500 at 525 is 262.500; the rupiah received keeps its 250.000, so the fee carries the 12.500 the pair would have.
    expect((await t.bases(t.back))[t.lira]).toBe(-262_500);
    expect((await t.bases(t.back))[t.fee]).toBe(12_500);
    expect(await t.resultLine(t.back)).toEqual([]);
    expect(await t.exchangeBase(t.back)).toBe(0);
    expect(await t.database.db.values(sql`SELECT count(*) FROM fx_gain_loss`)).toEqual([[0]]);
    expect(await t.database.db.values(sql`SELECT book_id FROM book_transactions WHERE transaction_id = ${t.back}`)).toEqual([[t.business]]);
    expect(await checkLedgerIntegrity(t.database, t.ws)).toEqual([]);
  });

  it('a filed exchange into euros gives the euros the lira’s cost, and recalculates the euro pocket with it', async () => {
    const t = await feeInBusiness();
    const change = await t.post('2026-11-06', 'Lira to euros', [
      { accountId: t.lira, amountMinor: -102_000, currency: 'TRY' },
      { accountId: t.exchange, amountMinor: 100_000, currency: 'TRY' },
      { accountId: t.fee, amountMinor: 2_000, currency: 'TRY' },
      { accountId: t.euros, amountMinor: 2_900, currency: 'EUR' },
      { accountId: t.exchange, amountMinor: -2_900, currency: 'EUR' },
    ]);
    const dinner = await t.post('2026-11-07', 'Dinner', expenseLines({ categoryAccountId: t.category('Restaurants'), paymentAccountId: t.euros, amountMinor: 2_900, currency: 'EUR' }));
    await t.recalc();
    // ₺1.020 at 525 is 535.500, shared by day figures (fee 10.240, euros 507.500): 10.591 and 524.909.
    expect((await t.bases(change))[t.euros]).toBe(524_909);
    expect((await t.bases(change))[t.fee]).toBe(10_591);
    expect(await t.resultLine(change)).toEqual([]);
    expect((await t.bases(dinner))[t.euros]).toBe(-524_909);
  });

  it('a transfer filed in Personal only by its own pair keeps the pair on the next pass', async () => {
    const t = await trip();
    await t.withdraw('2026-11-02', 5_250_000, 1_000_000);
    const back = await t.post('2026-11-20', 'Back to rupiah', exchangeLines({ fromAccountId: t.lira, fromAmountMinor: 50_000, fromCurrency: 'TRY', toAccountId: t.bank, toAmountMinor: 250_000, toCurrency: 'IDR', exchangeAccountId: t.exchange }));
    await t.recalc();
    const audits = await t.revalued();
    await t.recalc();
    expect(await t.resultLine(back)).toEqual([['expense.exchange_loss', 12_500]]);
    expect(await t.revalued()).toBe(audits);
  });

  it('revalues a shared event’s own transaction in place, and gives its exchange a pair filed nowhere (R7)', async () => {
    const t = await trip();
    await t.withdraw('2026-11-02', 5_250_000, 1_000_000);
    const share = await t.spend('2026-11-03', 45_000);
    const charged = await t.post('2026-11-04', 'Dinner, charged in rupiah', [
      { accountId: t.lira, amountMinor: -50_000, currency: 'TRY' },
      { accountId: t.exchange, amountMinor: 50_000, currency: 'TRY' },
      { accountId: t.category('Restaurants'), amountMinor: 250_000, currency: 'IDR' },
      { accountId: t.exchange, amountMinor: -250_000, currency: 'IDR' },
    ]);
    // What a shared event's derivation leaves: an event_postings row and no workspace (shared events §5.1).
    for (const [id, record] of [[share, 'rec-1'], [charged, 'rec-2']] as const) {
      await t.database.db.run(sql`DELETE FROM book_transactions WHERE transaction_id = ${id}`);
      await t.database.db.run(sql`INSERT INTO event_postings (book_id, record_id, kind, transaction_id) VALUES ('ev-book', ${record}, 'expense', ${id})`);
    }
    const before = await t.database.db.values(sql`SELECT id, status FROM transactions ORDER BY id`);
    await t.recalc();
    // Rewritten where it stands: no void, no replacement, the same two rows still posted.
    expect(await t.database.db.values(sql`SELECT id, status FROM transactions ORDER BY id`)).toEqual(before);
    expect((await t.bases(share))[t.lira]).toBe(-236_250);
    expect(await t.resultLine(charged)).toEqual([['expense.exchange_loss', 12_500]]);
    expect(await t.database.db.values(sql`SELECT count(*) FROM book_transactions WHERE transaction_id IN (${share}, ${charged})`)).toEqual([[0]]);
    expect(await checkLedgerIntegrity(t.database, t.ws)).toEqual([]);
  });
});
