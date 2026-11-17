import { exchangeLines, exchangeWithFeeLines, incomeLines } from '@expanses/core';
import { sql } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import {
  budgetSheetFor,
  categoryTotalsIn,
  checkLedgerIntegrity,
  createAccount,
  dailyTotalsIn,
  essentialSplitIn,
  eventPlanFor,
  eventSpendingBetween,
  listAccounts,
  MIGRATIONS,
  migrate,
  nativeBalances,
  netWorthAt,
  periodFlows,
  personalBook,
  postTransaction,
  recalcForeignTx,
  recalcPendingForeign,
  saveEvent,
  systemAccountId,
  tagTransaction,
} from '../src/index';
import { setupDb } from './helpers';

/*
 * Exchange gain or loss counts nowhere (owner, 17 Nov 2026). Invented: £1.000 of pay into a pound bank on 1 March at the
 * market's 21.000, so the pounds stand at Rp 21.000.000; on 17 November they go to the rupiah bank, which receives
 * Rp 20.700.000 (a bank rate 1,4 % under the market) or Rp 21.300.000 (over it). The withdrawal rate still writes its
 * pair; nothing that adds up spending or income reads it.
 */
const RATES = { GBP: 21_000 };
const NOV = { from: '2026-11-01', to: '2026-11-30' };

async function pounds() {
  const t = await setupDb();
  const all = await listAccounts(t.database, t.ws);
  const category = (name: string, kind: 'expense' | 'income' = 'expense') => all.find((a) => a.name === name && a.kind === kind)!.id;
  const gbp = (await createAccount(t.database, t.ws, { name: 'BCA GBP', kind: 'asset', subtype: 'bank', currency: 'GBP' })).id;
  const idr = (await createAccount(t.database, t.ws, { name: 'BCA IDR', kind: 'asset', subtype: 'bank', currency: 'IDR' })).id;
  const exchange = await systemAccountId(t.database.db, t.ws, 'currency_exchange');
  await postTransaction(t.database, t.ws, {
    occurredOn: '2026-03-01',
    description: 'Pay',
    lines: incomeLines({ incomeAccountId: category('Salary, wage, or pay', 'income'), depositAccountId: gbp, amountMinor: 100_000, currency: 'GBP' }),
    ratesToBase: RATES,
  });
  const move = (receivedMinor: number, feeMinor = 0) =>
    postTransaction(t.database, t.ws, {
      occurredOn: '2026-11-17',
      description: 'BCA GBP → BCA IDR',
      lines: exchangeWithFeeLines({
        fromAccountId: gbp,
        fromAmountMinor: 100_000 - feeMinor,
        fromCurrency: 'GBP',
        toAccountId: idr,
        toAmountMinor: receivedMinor,
        toCurrency: 'IDR',
        exchangeAccountId: exchange,
        feeMinor,
        feeCategoryId: feeMinor > 0 ? category('Fees & charges') : null,
      }),
      ratesToBase: RATES,
    });
  const resultLine = (transactionId: string) =>
    t.database.db.values<[string, number]>(sql`
      SELECT a.system_key, e.amount_minor FROM entries e JOIN accounts a ON a.id = e.account_id
      WHERE e.transaction_id = ${transactionId} AND a.system_key IN ('income.exchange_gain', 'expense.exchange_loss')`);
  const book = await personalBook(t.database, t.ws);
  const inPersonal = { ...t.ws, bookId: book.id };
  const total = (rows: readonly { amountBaseMinor: number }[]) => rows.reduce((sum, row) => sum + row.amountBaseMinor, 0);
  /** Every figure that adds up November's spending or income, owner-wide and in Personal. */
  const november = async () => {
    const out: Record<string, number> = {};
    for (const [name, ws] of [
      ['all', t.ws],
      ['personal', inPersonal],
    ] as const) {
      const flows = await periodFlows(t.database, ws, NOV);
      const split = await essentialSplitIn(t.database, ws, NOV.from, NOV.to, { excludeEvents: true });
      out[`${name}.spending`] = total((await categoryTotalsIn(t.database, ws, 'expense', NOV.from, NOV.to, { billMonths: true })).rows);
      out[`${name}.income`] = total((await categoryTotalsIn(t.database, ws, 'income', NOV.from, NOV.to, { billMonths: true })).rows);
      out[`${name}.dailySpending`] = (await dailyTotalsIn(t.database, ws, 'expense', NOV.from, NOV.to, { billMonths: true })).days.reduce((sum, day) => sum + day.amountMinor, 0);
      out[`${name}.dailyIncome`] = (await dailyTotalsIn(t.database, ws, 'income', NOV.from, NOV.to, { billMonths: true })).days.reduce((sum, day) => sum + day.amountMinor, 0);
      out[`${name}.flowsSpending`] = flows.spendingMinor;
      out[`${name}.flowsIncome`] = flows.incomeMinor;
      out[`${name}.splitSpending`] = split.split.spendingMinor;
      out[`${name}.splitIncome`] = split.split.incomeMinor;
    }
    const sheet = await budgetSheetFor(t.database, inPersonal, '2026-11');
    out['budget.spending'] = sheet.spendingActualMinor;
    out['budget.income'] = sheet.incomeActualMinor;
    out['budget.exchangeLines'] = sheet.lines.filter((line) => /exchange/i.test(line.name)).length;
    return out;
  };
  const zeros = (figures: Record<string, number>) => Object.fromEntries(Object.keys(figures).map((key) => [key, 0]));
  return { ...t, category, gbp, idr, exchange, move, resultLine, november, zeros, inPersonal };
}

describe('an exchange’s gain or loss counts nowhere (owner, 17 Nov 2026)', () => {
  it('a loss: November spends and earns nothing, the pair is still written, the banks hold what the bank paid', async () => {
    const t = await pounds();
    const before = await netWorthAt(t.database, t.ws, '2026-11-16', RATES);
    const id = await t.move(20_700_000);
    // The withdrawal rate's bookkeeping is kept as it was: the stored data is not rewritten, only no longer counted.
    expect(await t.resultLine(id)).toEqual([['expense.exchange_loss', 300_000]]);
    const figures = await t.november();
    expect(figures).toEqual(t.zeros(figures));
    const balances = await nativeBalances(t.database, t.ws);
    expect([balances[t.gbp], balances[t.idr]]).toEqual([0, 20_700_000]);
    // Net worth reads what each account holds at the market's rate: the pounds were Rp 21.000.000, the bank paid
    // Rp 20.700.000, so it is Rp 300.000 lower — the bank's rate, which no category ever carried.
    const after = await netWorthAt(t.database, t.ws, '2026-11-17', RATES);
    expect(after.netWorthMinor).toBe(before.netWorthMinor! - 300_000);
    expect(await checkLedgerIntegrity(t.database, t.ws)).toEqual([]);
  });

  it('a gain: November earns nothing either', async () => {
    const t = await pounds();
    const id = await t.move(21_300_000);
    expect(await t.resultLine(id)).toEqual([['income.exchange_gain', -300_000]]);
    const figures = await t.november();
    expect(figures).toEqual(t.zeros(figures));
    const balances = await nativeBalances(t.database, t.ws);
    expect([balances[t.gbp], balances[t.idr]]).toEqual([0, 21_300_000]);
  });

  it('the pay that brought the pounds in is still March’s income', async () => {
    const t = await pounds();
    await t.move(20_700_000);
    const march = await periodFlows(t.database, t.ws, { from: '2026-03-01', to: '2026-03-31' });
    expect(march.incomeMinor).toBe(21_000_000);
  });

  it('a fee typed on the transfer still counts, as the fee alone', async () => {
    const t = await pounds();
    // £5 fee from the pounds, £995 changed for Rp 20.600.000.
    await t.move(20_600_000, 500);
    const figures = await t.november();
    const fee = figures['personal.spending']!;
    expect(fee).toBeGreaterThan(0);
    expect(figures['all.spending']).toBe(fee);
    expect(figures['all.flowsSpending']).toBe(fee);
    expect(figures['personal.flowsSpending']).toBe(fee);
    expect(figures['budget.spending']).toBe(fee);
    expect(figures['all.income']).toBe(0);
    expect(figures['budget.exchangeLines']).toBe(0);
    // The fee alone (owner, 17 Nov 2026): £5 of pounds that cost 21.000 each. The Rp 295.000 the bank's rate kept on the
    // £995 counts nowhere: it stays on the Currency Exchange account, as an exchange's gap always did.
    expect(fee).toBe(105_000);
  });

  it('an exchange tagged to an event is no part of what the event spent', async () => {
    const t = await pounds();
    const eventId = await saveEvent(t.database, t.ws, { name: 'London', startsOn: '2026-11-15', endsOn: '2026-11-20' });
    const id = await t.move(20_700_000);
    await tagTransaction(t.database, t.ws, id, eventId);
    expect(await t.resultLine(id)).toEqual([['expense.exchange_loss', 300_000]]);
    expect((await eventPlanFor(t.database, t.ws, eventId)).spentMinor).toBe(0);
    expect((await eventSpendingBetween(t.database, t.ws, NOV.from, NOV.to)).amountMinor).toBe(0);
    expect((await eventSpendingBetween(t.database, t.inPersonal, NOV.from, NOV.to)).amountMinor).toBe(0);
  });
});

describe('an exchange with a typed fee: the fee alone, the rate counts nowhere (owner, 17 Nov 2026)', () => {
  /** The fee'd change of £1.000 (£5 fee, £995 for Rp 20.600.000), and its lines' figures by account. */
  async function feeMove() {
    const t = await pounds();
    const id = await t.move(20_600_000, 500);
    const fees = t.category('Fees & charges');
    const lines = async () =>
      (await t.database.db.values<[string, string, number, number]>(sql`
        SELECT e.account_id, e.currency, e.amount_minor, e.amount_base_minor FROM entries e WHERE e.transaction_id = ${id} ORDER BY e.rowid`)).map(([a, c, m, b]) => [a, c, Number(m), Number(b)]);
    const feeBase = async () => (await lines()).find(([account]) => account === fees)![3];
    const exchangeBase = async () => (await lines()).filter(([account]) => account === t.exchange).reduce((sum, line) => sum + (line[3] as number), 0);
    const revalues = async () => Number((await t.database.db.values<[number]>(sql`SELECT count(*) FROM audit_log WHERE action = 'revalue'`))[0]![0]);
    const recalc = () => t.database.transaction((tx) => recalcForeignTx(tx, t.ws, t.gbp, null));
    /** The figures the old rule left (Rp 400.000 on the fee, the gap spread into it), written back as they were stored. */
    const asBefore = async () => {
      await t.database.db.run(sql`UPDATE entries SET amount_base_minor = 400000 WHERE transaction_id = ${id} AND account_id = ${fees}`);
      await t.database.db.run(sql`UPDATE entries SET amount_base_minor = 20600000 WHERE transaction_id = ${id} AND account_id = ${t.exchange} AND currency = 'GBP'`);
    };
    return { ...t, id, fees, lines, feeBase, exchangeBase, revalues, recalc, asBefore };
  }

  it('the fee is £5 at what the pounds cost; the gap sits on the exchange account, no pair; balances as typed', async () => {
    const t = await feeMove();
    expect(await t.feeBase()).toBe(105_000);
    // The Rp 295.000 the bank's rate kept: on Currency Exchange, which is no category, no balance and no net worth.
    expect(await t.exchangeBase()).toBe(295_000);
    expect(await t.resultLine(t.id)).toEqual([]);
    const balances = await nativeBalances(t.database, t.ws);
    expect([balances[t.gbp], balances[t.idr]]).toEqual([0, 20_600_000]);
    expect(await checkLedgerIntegrity(t.database, t.ws)).toEqual([]);
  });

  it('a past transfer the old rule valued is valued again by the recalculation; balances and net worth do not move', async () => {
    const t = await feeMove();
    await t.asBefore();
    const worth = await netWorthAt(t.database, t.ws, '2026-11-17', RATES);
    const balances = await nativeBalances(t.database, t.ws);
    expect(await t.feeBase()).toBe(400_000);
    await t.recalc();
    expect(await t.feeBase()).toBe(105_000);
    expect(await t.exchangeBase()).toBe(295_000);
    expect(await nativeBalances(t.database, t.ws)).toEqual(balances);
    expect((await netWorthAt(t.database, t.ws, '2026-11-17', RATES)).netWorthMinor).toBe(worth.netWorthMinor);
    expect((await t.november())['personal.spending']).toBe(105_000);
  });

  it('is idempotent: a second recalculation writes nothing', async () => {
    const t = await feeMove();
    await t.asBefore();
    await t.recalc();
    const lines = await t.lines();
    const revalues = await t.revalues();
    await t.recalc();
    expect(await t.lines()).toEqual(lines);
    expect(await t.revalues()).toBe(revalues);
  });

  it('the update queues each pound account with such a transfer, from its first one, and the next run values it again', async () => {
    const t = await feeMove();
    await t.asBefore();
    await t.database.db.run(sql`DELETE FROM fx_recalc_pending`);
    // The update's migration, run again over this book as an older copy would run it on open.
    const migration = MIGRATIONS.find((m) => m.name === 'exchange_fee_only')!;
    await t.database.db.run(sql`DELETE FROM schema_migrations WHERE version = ${migration.version}`);
    await migrate(t.database, [migration]);
    expect(await t.database.db.values(sql`SELECT account_id, from_date FROM fx_recalc_pending`)).toEqual([[t.gbp, '2026-11-17']]);
    // The withdrawal-rate notice is not asked for again: fees only get smaller, nothing else moves.
    expect(await t.database.db.values(sql`SELECT value FROM settings WHERE key = 'fx.withdrawal_rate_notice'`)).toEqual([]);
    await recalcPendingForeign(t.database);
    expect(await t.feeBase()).toBe(105_000);
    expect(await t.database.db.values(sql`SELECT count(*) FROM fx_recalc_pending`)).toEqual([[0]]);
  });
});
