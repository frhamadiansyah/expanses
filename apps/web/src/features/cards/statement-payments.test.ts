import { expenseLines, refundLines, statementCycleFor, transferLines } from '@expanses/core';
import { cardStatement, createAccount, createCardAccount, createDatabase, createWorkspace, listAccounts, migrate, payCardPurchases, postTransaction, saveCardTerms } from '@expanses/db';
import { createNodeExecutor } from '@expanses/db/node';
import { afterEach, describe, expect, it } from 'vitest';
import { isPaymentLine, paidFootText, statementPaid } from './statement-payments';
import { statementTotals } from './statement-totals';

/* Invented figures and names throughout. A card with a statement on the 20th: August is 21 Jul – 20 Aug. */
const AUGUST = statementCycleFor('2026-08-20', 20);
const SEPTEMBER = statementCycleFor('2026-09-20', 20);
const TODAY = '2026-09-10';

let close: (() => void) | undefined;
afterEach(() => {
  close?.();
  close = undefined;
});

async function card() {
  const executor = createNodeExecutor();
  close = () => executor.close();
  const database = createDatabase(executor);
  await migrate(database);
  const ws = await createWorkspace(database, { name: 'Personal', type: 'personal', baseCurrency: 'IDR' });
  const visa = await createCardAccount(database, ws, { name: 'Kartu Satu', subtype: 'credit_card', currency: 'IDR' });
  await saveCardTerms(database, ws, { accountId: visa.id, statementDay: 20, dueDay: 5, creditLimitMinor: null, annualFeeMinor: null });
  const bank = await createAccount(database, ws, { name: 'Bank Satu', kind: 'asset', subtype: 'bank', currency: 'IDR' });
  const groceries = (await listAccounts(database, ws)).find((a) => a.systemKey === 'household.groceries')!.id;
  const buy = (occurredOn: string, description: string, amountMinor: number) =>
    postTransaction(database, ws, { occurredOn, description, lines: expenseLines({ categoryAccountId: groceries, paymentAccountId: visa.id, amountMinor, currency: 'IDR' }) });
  const refund = (occurredOn: string, description: string, amountMinor: number) =>
    postTransaction(database, ws, { occurredOn, description, lines: refundLines({ categoryAccountId: groceries, paymentAccountId: visa.id, amountMinor, currency: 'IDR' }) });
  const pay = (occurredOn: string, amountMinor: number) =>
    postTransaction(database, ws, { occurredOn, description: 'Card payment', lines: transferLines({ fromAccountId: bank.id, toAccountId: visa.id, amountMinor, currency: 'IDR' }) });
  const payFor = (occurredOn: string, ids: string[]) => payCardPurchases(database, ws, { cardAccountId: visa.id, fromAccountId: bank.id, occurredOn, purchaseTransactionIds: ids });
  const statement = (cycle = AUGUST) => cardStatement(database, ws, visa.id, cycle, TODAY);
  return { buy, refund, pay, payFor, statement };
}

describe('payments are kept off the statement’s purchase list', () => {
  it('takes off bill payments and batches paid for chosen purchases, and keeps purchases and money back', async () => {
    const c = await card();
    const shoes = await c.buy('2026-08-02', 'Toko Sepatu', 610_000);
    await c.buy('2026-08-03', 'Toko Buku', 230_000);
    await c.payFor('2026-08-05', [shoes]);
    await c.refund('2026-08-06', 'Toko Buku refund', 30_000);
    await c.pay('2026-08-07', 100_000);
    const s = await c.statement();
    expect(s.lines.filter((line) => !isPaymentLine(line)).map((line) => line.description)).toEqual(['Toko Sepatu', 'Toko Buku', 'Toko Buku refund']);
    expect(s.lines.filter(isPaymentLine).map((line) => line.owedMinor)).toEqual([-610_000, -100_000]);
  });
});

describe('what Paid opens', () => {
  it('on a closed statement: the credits since its date that make up Paid, the last one as far as the bill needed', async () => {
    const c = await card();
    await c.buy('2026-08-02', 'Toko Sepatu', 610_000);
    await c.buy('2026-08-03', 'Toko Buku', 230_000);
    // Paid between its own dates: comes off the bill before it, listed apart.
    await c.pay('2026-08-10', 50_000);
    // Since its date: 300.000, money back of 100.000, then 900.000 of which only what the bill still needed counts.
    await c.pay('2026-08-25', 300_000);
    await c.refund('2026-08-27', 'Toko Buku refund', 100_000);
    await c.pay('2026-09-02', 900_000);
    const s = await c.statement();
    const paid = statementPaid(s);
    expect(statementTotals(s).paidMinor).toBe(790_000);
    expect(paid).toMatchObject({ row: 'Paid', totalMinor: 790_000 });
    expect(paid.entries.map((entry) => [entry.line.occurredOn, entry.countedMinor, entry.wholeMinor, entry.refund])).toEqual([
      ['2026-08-25', 300_000, 300_000, false],
      ['2026-08-27', 100_000, 100_000, true],
      ['2026-09-02', 390_000, 900_000, false],
    ]);
    expect(paid.entries.reduce((sum, entry) => sum + entry.countedMinor, 0)).toBe(paid.totalMinor);
    expect(paid.during.map((entry) => [entry.line.occurredOn, entry.countedMinor])).toEqual([['2026-08-10', 50_000]]);
  });

  it('on an open statement: its own payments, from Previous bill, adding up to the sheet’s figure', async () => {
    const c = await card();
    await c.buy('2026-08-02', 'Toko Sepatu', 610_000);
    const late = await c.buy('2026-09-01', 'Toko Kopi', 45_000);
    await c.pay('2026-08-25', 300_000);
    await c.payFor('2026-09-03', [late]);
    const paid = statementPaid(await c.statement(SEPTEMBER));
    expect(paid.row).toBe('Previous bill');
    expect(paid.entries.map((entry) => entry.countedMinor)).toEqual([300_000, 45_000]);
    expect(paid.totalMinor).toBe(345_000);
    expect(paid.during).toEqual([]);
  });

  it('lists nothing when nothing was paid', async () => {
    const c = await card();
    await c.buy('2026-08-02', 'Toko Sepatu', 610_000);
    expect(statementPaid(await c.statement())).toMatchObject({ totalMinor: 0, entries: [], during: [] });
    expect(statementPaid(await c.statement(SEPTEMBER))).toMatchObject({ totalMinor: 0, entries: [], during: [] });
  });
});

describe('the Paid sheet’s foot', () => {
  it('names the one account that paid, or the paying accounts, and says nothing with no payment', () => {
    expect(paidFootText(['Bank Satu', 'Bank Satu'])).toBe('Payments stay in Cashflow and on Bank Satu as transfers.');
    expect(paidFootText(['Bank Satu', 'Bank Dua'])).toBe('Payments stay in Cashflow and on the paying accounts as transfers.');
    expect(paidFootText([null])).toBe('Payments stay in Cashflow and on the paying accounts as transfers.');
    expect(paidFootText([])).toBeNull();
  });
});
