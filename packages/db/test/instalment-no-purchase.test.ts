import { expenseLines, statementCycleFor, transferLines } from '@expanses/core';
import { afterEach, describe, expect, it } from 'vitest';
import {
  autoLinkInstalmentPlans,
  cardStatement,
  cardStatementLines,
  categoryTotalsIn,
  createAccount,
  createBook,
  inBook,
  listAccounts,
  listInstallments,
  nativeBalances,
  periodFlows,
  personalBook,
  postTransaction,
  prepareStatementCheck,
  saveCardTerms,
  saveInstallment,
} from '../src/index';
import { setupDb, type TestDb } from './helpers';

/*
 * The owner's plan from TF 136 (figures invented): added before the plan could name a purchase, its purchase older than
 * the app. 24 × Rp 1.000.000 first billed February 2025, card statement day the 13th, due the 2nd; the card is kept
 * since its opening balance on 1 Sep 2026 of Rp 8.000.000 — Rp 3.000.000 of other spending and the Rp 5.000.000 the
 * plan had still to bill (instalments 20–24, Sep 2026 – Jan 2027), as the bank's own balance holds it.
 */

let current: TestDb | undefined;
afterEach(() => {
  current?.executor.close();
  current = undefined;
});

const NOV_STATEMENT = statementCycleFor('2026-11-13', 13); // 14 Oct – 13 Nov
const TODAY = '2026-11-16';

async function owner() {
  current = await setupDb();
  const { database } = current;
  const personal = await personalBook(database, current.ws);
  const family = { id: await createBook(database, current.ws, { name: 'Family', kind: 'family', baseCurrency: 'IDR', copyCategoriesFrom: personal.id }) };
  const ws = inBook(current.ws, personal.id);
  const card = await createAccount(database, ws, { name: 'Visa Kencana', kind: 'liability', subtype: 'credit_card', currency: 'IDR', openingBalanceMinor: 8_000_000, openedOn: '2026-09-01' });
  const bank = await createAccount(database, ws, { name: 'Bank Sentosa', kind: 'asset', subtype: 'bank', currency: 'IDR', openingBalanceMinor: 50_000_000, openedOn: '2026-09-01' });
  await saveCardTerms(database, ws, { accountId: card.id, statementDay: 13, dueDay: 2, creditLimitMinor: null, annualFeeMinor: null });
  // As the old sheet saved it: no purchase, At purchase.
  const planId = await saveInstallment(database, ws, { cardAccountId: card.id, description: 'Phone', totalMinor: 24_000_000, months: 24, firstBilledMonth: '2025-02', countMode: 'at_purchase' });
  return { database, ws, root: current.ws, personal: personal.id, family: family.id, card: card.id, bank: bank.id, planId };
}

describe('a plan with no purchase, bought before the card’s records (TF 136)', () => {
  it('is set to Each month by the app opening in Family', async () => {
    const o = await owner();
    // The app opened with Family as the open workspace.
    expect(await autoLinkInstalmentPlans(o.database, inBook(o.root, o.family))).toEqual({ linked: 0, beforeRecords: 1, left: 0 });
    expect((await listInstallments(o.database, o.ws))[0]).toMatchObject({ transactionId: null, countMode: 'each_month' });
  });

  it('bills its instalments on the card’s statements from the records’ start, and none before', async () => {
    const o = await owner();
    await autoLinkInstalmentPlans(o.database, o.ws);
    const lines = (await cardStatementLines(o.database, o.ws, o.card)).filter((line) => line.instalment);
    expect(lines.map((line) => [line.statementOn, line.instalment!.number, line.owedMinor])).toEqual([
      ['2026-09-13', 20, 1_000_000],
      ['2026-10-13', 21, 1_000_000],
      ['2026-11-13', 22, 1_000_000],
      ['2026-12-13', 23, 1_000_000],
      ['2027-01-13', 24, 1_000_000],
    ]);
    const nov = await cardStatement(o.database, o.ws, o.card, NOV_STATEMENT, TODAY);
    expect(nov.lines.filter((line) => line.instalment).map((line) => line.description)).toEqual(['Phone']);
  });

  it('counts nothing twice: the opening balance holds the unbilled part, which each instalment bills a month at a time', async () => {
    const o = await owner();
    await autoLinkInstalmentPlans(o.database, o.ws);
    const sep = await cardStatement(o.database, o.ws, o.card, statementCycleFor('2026-09-13', 13), TODAY);
    // Sep: the Rp 3.000.000 already billed and instalment 20.
    expect(sep.closingMinor).toBe(4_000_000);
    // Paid in full on 1 Oct; October bills instalment 21 alone, November 22.
    await postTransaction(o.database, o.ws, { occurredOn: '2026-10-01', description: 'Pay the card', lines: transferLines({ fromAccountId: o.bank, toAccountId: o.card, amountMinor: 4_000_000, currency: 'IDR' }) });
    const oct = await cardStatement(o.database, o.ws, o.card, statementCycleFor('2026-10-13', 13), TODAY);
    expect(oct).toMatchObject({ openingMinor: 4_000_000, creditsMinor: 4_000_000, chargesMinor: 1_000_000, closingMinor: 1_000_000 });
    const nov = await cardStatement(o.database, o.ws, o.card, NOV_STATEMENT, TODAY);
    expect(nov.closingMinor).toBe(2_000_000);
    // After January's statement the statements add back to what the card owes: Rp 4.000.000 left of the 8.000.000.
    const jan = await cardStatement(o.database, o.ws, o.card, statementCycleFor('2027-01-13', 13), '2027-01-20');
    expect(jan.closingMinor).toBe(-(await nativeBalances(o.database, o.ws))[o.card]!);
  });

  it('a statement check matches the bank’s instalment row', async () => {
    const o = await owner();
    await autoLinkInstalmentPlans(o.database, o.ws);
    const prepared = await prepareStatementCheck(o.database, o.ws, { cardAccountId: o.card, period: NOV_STATEMENT, images: [], today: TODAY });
    // Its own month's row, and the one from the week before the period the check also looks at.
    expect(prepared.instalments.map((i) => [i.on, i.amountMinor])).toEqual([
      ['2026-10-13', 1_000_000],
      ['2026-11-13', 1_000_000],
    ]);
  });

  it('counts each month as spending from the records’ start, never before, never a debt payment', async () => {
    const o = await owner();
    await autoLinkInstalmentPlans(o.database, o.ws);
    const spent = async (from: string, to: string) => (await categoryTotalsIn(o.database, o.ws, 'expense', from, to, { billMonths: true })).rows.reduce((s, r) => s + r.amountBaseMinor, 0);
    expect(await spent('2026-11-01', '2026-11-30')).toBe(1_000_000);
    expect(await spent('2025-01-01', '2026-08-31')).toBe(0);
    expect((await periodFlows(o.database, o.ws, { from: '2025-01-01', to: '2027-01-31' })).debtPaymentsMinor).toBe(0);
    void listAccounts;
    void expenseLines;
  });
});
