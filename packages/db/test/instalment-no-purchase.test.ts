import { statementCycleFor, transferLines } from '@expanses/core';
import { afterEach, describe, expect, it } from 'vitest';
import {
  autoLinkInstalmentPlans,
  cardStatement,
  cardStatementLines,
  categoryTotalsIn,
  createAccount,
  createBook,
  inBook,
  listInstallments,
  nativeBalances,
  periodFlows,
  personalBook,
  postTransaction,
  prepareStatementCheck,
  saveCardTerms,
  saveInstallment,
  setInstallmentCountMode,
} from '../src/index';
import { setupDb, type TestDb } from './helpers';

/*
 * A plan with no purchase — its purchase is not in the app (owner, 16 Nov 2026, simplified). The owner's case, figures
 * invented: 24 × Rp 1.000.000 first billed March 2025, statement day the 13th, due the 2nd; the card started in the app
 * with its opening balance of Rp 8.000.000 on 1 Oct 2026, filed in Family — Rp 3.000.000 of other spending and the
 * Rp 5.000.000 the plan still had to bill (instalments 20–24, Oct 2026 – Feb 2027), as the bank's balance holds it.
 */

let current: TestDb | undefined;
afterEach(() => {
  current?.executor.close();
  current = undefined;
});

const NOV_STATEMENT = statementCycleFor('2026-11-13', 13); // 14 Oct – 13 Nov
const TODAY = '2026-11-16';

async function owner(countMode: 'at_purchase' | 'each_month' = 'at_purchase') {
  current = await setupDb();
  const { database } = current;
  const personal = await personalBook(database, current.ws);
  const family = await createBook(database, current.ws, { name: 'Family', kind: 'family', baseCurrency: 'IDR', copyCategoriesFrom: personal.id });
  const ws = inBook(current.ws, personal.id);
  const familyWs = inBook(current.ws, family);
  const card = await createAccount(database, familyWs, { name: 'Visa Kencana', kind: 'liability', subtype: 'credit_card', currency: 'IDR', openingBalanceMinor: 8_000_000, openedOn: '2026-10-01' });
  const bank = await createAccount(database, ws, { name: 'Bank Sentosa', kind: 'asset', subtype: 'bank', currency: 'IDR', openingBalanceMinor: 50_000_000, openedOn: '2026-10-01' });
  await saveCardTerms(database, ws, { accountId: card.id, statementDay: 13, dueDay: 2, creditLimitMinor: null, annualFeeMinor: null });
  const planId = await saveInstallment(database, ws, { cardAccountId: card.id, description: 'Phone', totalMinor: 24_000_000, months: 24, firstBilledMonth: '2025-03', countMode });
  return { database, ws, familyWs, card: card.id, bank: bank.id, planId };
}

describe('a plan with no purchase (owner’s case)', () => {
  it('is left as it is by the app opening: there is no purchase of its total to tie', async () => {
    const o = await owner();
    expect(await autoLinkInstalmentPlans(o.database, o.familyWs)).toEqual({ linked: 0, left: 1 });
    expect((await listInstallments(o.database, o.ws))[0]).toMatchObject({ transactionId: null, countMode: 'at_purchase' });
  });

  for (const countMode of ['at_purchase', 'each_month'] as const) {
    it(`bills its months on the card’s statements from the card’s start in the app, read from either workspace (${countMode})`, async () => {
      const o = await owner(countMode);
      for (const ws of [o.ws, o.familyWs]) {
        const lines = (await cardStatementLines(o.database, ws, o.card)).filter((line) => line.instalment);
        expect(lines.map((line) => [line.statementOn, line.instalment!.number])).toEqual([
          ['2026-10-13', 20],
          ['2026-11-13', 21],
          ['2026-12-13', 22],
          ['2027-01-13', 23],
          ['2027-02-13', 24],
        ]);
        const nov = await cardStatement(o.database, ws, o.card, NOV_STATEMENT, TODAY);
        expect(nov.lines.filter((line) => line.instalment).map((line) => line.instalment!.number)).toEqual([21]);
      }
    });
  }

  it('counts nothing twice: the opening balance holds the unbilled part, which each instalment bills a month at a time', async () => {
    const o = await owner();
    const oct = await cardStatement(o.database, o.ws, o.card, statementCycleFor('2026-10-13', 13), TODAY);
    // October: the Rp 3.000.000 already billed and instalment 20.
    expect(oct.closingMinor).toBe(4_000_000);
    await postTransaction(o.database, o.ws, { occurredOn: '2026-10-20', description: 'Pay the card', lines: transferLines({ fromAccountId: o.bank, toAccountId: o.card, amountMinor: 4_000_000, currency: 'IDR' }) });
    const nov = await cardStatement(o.database, o.ws, o.card, NOV_STATEMENT, TODAY);
    expect(nov).toMatchObject({ openingMinor: 4_000_000, creditsMinor: 4_000_000, chargesMinor: 1_000_000, closingMinor: 1_000_000 });
    // After the last instalment the statements add back to what the card owes.
    const feb = await cardStatement(o.database, o.ws, o.card, statementCycleFor('2027-02-13', 13), '2027-02-20');
    expect(feb.closingMinor).toBe(-(await nativeBalances(o.database, o.ws))[o.card]!);
  });

  it('a statement check matches the bank’s instalment row', async () => {
    const o = await owner();
    const prepared = await prepareStatementCheck(o.database, o.ws, { cardAccountId: o.card, period: NOV_STATEMENT, images: [], today: TODAY });
    // Its own month's row, and the one from the week before the period the check also looks at.
    expect(prepared.instalments.map((i) => [i.on, i.amountMinor])).toEqual([
      ['2026-10-13', 1_000_000],
      ['2026-11-13', 1_000_000],
    ]);
  });

  it('Investment (At purchase): no spending; each instalment from the card’s start is put away, never a debt payment', async () => {
    const o = await owner('at_purchase');
    expect((await categoryTotalsIn(o.database, o.ws, 'expense', '2026-10-01', '2027-02-28')).rows).toEqual([]);
    const flows = await periodFlows(o.database, o.ws, { from: '2025-03-01', to: '2027-02-28' });
    expect(flows.putAwayMinor).toBe(5_000_000);
    expect(flows.debtPaymentsMinor).toBe(0);
  });

  it('Each month: spending from the card’s start, never before, never a debt payment', async () => {
    const o = await owner('at_purchase');
    await setInstallmentCountMode(o.database, o.ws, o.planId, 'each_month');
    const spent = async (from: string, to: string) => (await categoryTotalsIn(o.database, o.ws, 'expense', from, to, { billMonths: true })).rows.reduce((s, r) => s + r.amountBaseMinor, 0);
    expect(await spent('2026-11-01', '2026-11-30')).toBe(1_000_000);
    expect(await spent('2025-03-01', '2026-09-30')).toBe(0);
    expect((await periodFlows(o.database, o.ws, { from: '2025-03-01', to: '2027-02-28' })).debtPaymentsMinor).toBe(0);
  });
});
