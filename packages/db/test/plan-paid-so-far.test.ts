import { statementCycleFor, transferLines } from '@expanses/core';
import { sql } from 'drizzle-orm';
import { afterEach, describe, expect, it } from 'vitest';
import {
  allPlanInstalmentStatuses,
  cardStatement,
  cardStatementLines,
  categoryTotalsIn,
  createAccount,
  deleteInstallment,
  inBook,
  listInstallments,
  nativeBalances,
  periodFlows,
  personalBook,
  planInstalmentStatuses,
  planPaidSoFarKey,
  postTransaction,
  refreshPlanOwedTx,
  repairPlanPaidSoFar,
  saveCardTerms,
  saveInstallment,
  setPlanPaidSoFar,
  updateInstallment,
  voidTransaction,
} from '../src/index';
import { setupDb, type TestDb } from './helpers';

/*
 * A plan with no purchase in the app: one plain rule (owner, 17 Nov 2026, mockup 2026-11-17-plan-already-paid 1b). It
 * keeps how many instalments are paid — set when it is added: every one whose payment was due before that day — and the
 * rest is owed, posted once on the card as a balance line. Every page reads the same numbers. The owner's case, figures
 * invented: 24 × Rp 1.000.000 first billed March 2025, statement day the 13th, payment due the 2nd, on a card with
 * nothing else in the app, the plan added on 17 Nov 2026.
 */

let current: TestDb | undefined;
afterEach(() => {
  current?.executor.close();
  current = undefined;
});

const SEP_OCT = statementCycleFor('2026-10-13', 13); // 14 Sep – 13 Oct 2026
const OCT_NOV = statementCycleFor('2026-11-13', 13); // 14 Oct – 13 Nov 2026
const LAST = statementCycleFor('2027-02-13', 13); // 14 Jan – 13 Feb 2027
const ADDED = '2026-11-17T05:00:00.000Z';
const TODAY = '2026-11-17';

async function owner(opts: { addedAt?: string; opening?: { openingBalanceMinor: number; openedOn: string }; countMode?: 'at_purchase' | 'each_month' } = {}) {
  current = await setupDb();
  const { database } = current;
  const ws = inBook(current.ws, (await personalBook(database, current.ws)).id);
  const card = await createAccount(database, ws, { name: 'Visa Kencana', kind: 'liability', subtype: 'credit_card', currency: 'IDR', ...(opts.opening ?? {}) });
  const bank = await createAccount(database, ws, { name: 'Bank Sentosa', kind: 'asset', subtype: 'bank', currency: 'IDR', openingBalanceMinor: 50_000_000, openedOn: '2026-10-01' });
  await saveCardTerms(database, ws, { accountId: card.id, statementDay: 13, dueDay: 2, creditLimitMinor: null, annualFeeMinor: null });
  const planId = await saveInstallment(database, ws, {
    cardAccountId: card.id,
    description: 'ORI030',
    totalMinor: 24_000_000,
    months: 24,
    firstBilledMonth: '2025-03',
    countMode: opts.countMode ?? 'each_month',
    addedAt: opts.addedAt ?? ADDED,
  });
  const balance = async () => (await nativeBalances(database, ws))[card.id] ?? 0;
  const owedLines = () =>
    database.db.values<[string, string, string, number]>(sql`
      SELECT t.id, t.occurred_on, t.description, e.amount_minor FROM transactions t JOIN entries e ON e.transaction_id = t.id AND e.account_id = ${card.id}
      WHERE t.status = 'posted' AND t.external_ref = ${`plan-owed:${planId}`}`);
  const pay = (occurredOn: string, amountMinor: number) =>
    postTransaction(database, ws, { occurredOn, description: 'Pay the card', lines: transferLines({ fromAccountId: bank.id, toAccountId: card.id, amountMinor, currency: 'IDR' }) });
  const paid = async (today: string) => (await planInstalmentStatuses(database, ws, planId, today)).filter((s) => s.status === 'paid').map((s) => s.number);
  const plan = async () => (await listInstallments(database, ws)).find((p) => p.id === planId)!;
  return { database, ws, card: card.id, bank: bank.id, planId, balance, owedLines, pay, paid, plan };
}

const upTo = (n: number) => Array.from({ length: n }, (_, i) => i + 1);

describe('what is paid when the plan is added', () => {
  // Added 10 Nov: the 13 Oct bill was due 2 Nov, paid. Added 17 Nov: the 13 Nov bill is due 2 Dec, still owed. Added 5 Dec: paid.
  for (const [addedAt, paidSoFar] of [
    ['2026-11-10T05:00:00.000Z', 20],
    ['2026-11-17T05:00:00.000Z', 20],
    ['2026-12-05T05:00:00.000Z', 21],
  ] as const) {
    it(`is every instalment whose payment was due before that day (${addedAt.slice(0, 10)}: ${paidSoFar})`, async () => {
      expect((await (await owner({ addedAt })).plan()).paidSoFar).toBe(paidSoFar);
    });
  }

  it('is what the list was ticked to, when it was', async () => {
    current = await setupDb();
    const ws = inBook(current.ws, (await personalBook(current.database, current.ws)).id);
    const card = await createAccount(current.database, ws, { name: 'Visa Kencana', kind: 'liability', subtype: 'credit_card', currency: 'IDR' });
    const id = await saveInstallment(current.database, ws, { cardAccountId: card.id, description: 'ORI030', totalMinor: 24_000_000, months: 24, firstBilledMonth: '2025-03', paidSoFar: 18, addedAt: ADDED });
    expect((await listInstallments(current.database, ws)).find((p) => p.id === id)!.paidSoFar).toBe(18);
    expect((await nativeBalances(current.database, ws))[card.id]).toBe(-6_000_000);
  });
});

describe('the owner’s case: a card with nothing else, the plan added 17 Nov 2026', () => {
  it('puts the owed rest on the card once, on the day it was added: Wallet owes Rp 4.000.000', async () => {
    const o = await owner();
    expect(await o.balance()).toBe(-4_000_000);
    expect(await o.owedLines()).toEqual([[expect.any(String), '2026-11-17', 'ORI030 · instalments 21–24 owed', -4_000_000]]);
  });

  it('shows 20 paid and nothing due on 14 Sep – 13 Oct; 21 due on 14 Oct – 13 Nov', async () => {
    const o = await owner();
    const sep = await cardStatement(o.database, o.ws, o.card, SEP_OCT, TODAY);
    const row20 = sep.lines.find((line) => line.instalment?.number === 20)!;
    expect(row20).toMatchObject({ paidOff: true, countedMinor: 0, owedMinor: 1_000_000 });
    expect(sep).toMatchObject({ openingMinor: 0, closingMinor: 0, leftToPayMinor: 0 });
    const nov = await cardStatement(o.database, o.ws, o.card, OCT_NOV, TODAY);
    expect(nov.lines.map((line) => [line.instalment?.number, line.countedMinor, line.paidOff])).toEqual([[21, 1_000_000, false]]);
    expect(nov).toMatchObject({ openingMinor: 0, closingMinor: 1_000_000, leftToPayMinor: 1_000_000 });
    // The owed line itself is not drawn: its instalment rows bill it.
    expect((await cardStatementLines(o.database, o.ws, o.card)).filter((line) => !line.instalment)).toEqual([]);
  });

  it('every instalment is on its own statement', async () => {
    const o = await owner();
    const rows = (await cardStatementLines(o.database, o.ws, o.card)).filter((line) => line.instalment).map((line) => line.instalment!.number);
    expect(rows).toEqual(upTo(24));
  });

  it('every page reads 20 of 24 paid', async () => {
    const o = await owner();
    expect(await o.paid(TODAY)).toEqual(upTo(20));
    const statuses = await planInstalmentStatuses(o.database, o.ws, o.planId, TODAY);
    expect(statuses.find((s) => s.number === 21)!.status).toBe('billed');
    expect(statuses.filter((s) => s.status === 'upcoming').map((s) => s.number)).toEqual([22, 23, 24]);
    expect((await allPlanInstalmentStatuses(o.database, o.ws, TODAY))[o.planId]).toEqual(statuses);
  });

  it('the card payment on 2 Dec pays 21 everywhere: Wallet owes Rp 3.000.000', async () => {
    const o = await owner();
    await o.pay('2026-12-02', 1_000_000);
    expect(await o.paid('2026-12-03')).toEqual(upTo(21));
    expect(await o.balance()).toBe(-3_000_000);
    const nov = await cardStatement(o.database, o.ws, o.card, OCT_NOV, '2026-12-03');
    expect(nov.leftToPayMinor).toBe(0);
    expect(nov.cover[`${o.planId}#21`]).toMatchObject({ whole: true });
  });

  it('ticking 21 instead reads the same', async () => {
    const o = await owner();
    await setPlanPaidSoFar(o.database, o.ws, o.planId, 21);
    expect(await o.paid('2026-12-03')).toEqual(upTo(21));
    expect(await o.balance()).toBe(-3_000_000);
    const nov = await cardStatement(o.database, o.ws, o.card, OCT_NOV, '2026-12-03');
    expect(nov.lines.find((line) => line.instalment?.number === 21)).toMatchObject({ paidOff: true, countedMinor: 0 });
    expect(nov).toMatchObject({ closingMinor: 0, leftToPayMinor: 0 });
  });

  it('unticked back to 18: the owed line is Rp 6.000.000 and 19, 20 are due', async () => {
    const o = await owner();
    await setPlanPaidSoFar(o.database, o.ws, o.planId, 18);
    expect(await o.balance()).toBe(-6_000_000);
    expect((await o.owedLines()).map(([, on, description, amount]) => [on, description, amount])).toEqual([['2026-11-17', 'ORI030 · instalments 19–24 owed', -6_000_000]]);
    expect(await o.paid(TODAY)).toEqual(upTo(18));
    const sep = await cardStatement(o.database, o.ws, o.card, SEP_OCT, TODAY);
    expect(sep).toMatchObject({ openingMinor: 1_000_000, chargesMinor: 1_000_000, closingMinor: 2_000_000 });
  });

  it('the statements end where the card’s balance is, after the last instalment', async () => {
    const o = await owner();
    await o.pay('2026-12-02', 1_000_000);
    await o.pay('2027-01-02', 1_000_000);
    const last = await cardStatement(o.database, o.ws, o.card, LAST, '2027-02-20');
    expect(last.closingMinor).toBe(-(await o.balance()));
    expect(last.closingMinor).toBe(2_000_000);
    await setPlanPaidSoFar(o.database, o.ws, o.planId, 17);
    expect((await cardStatement(o.database, o.ws, o.card, LAST, '2027-02-20')).closingMinor).toBe(-(await o.balance()));
  });

  it('removing the plan takes its owed line off the card', async () => {
    const o = await owner();
    await deleteInstallment(o.database, o.ws, o.planId);
    expect(await o.owedLines()).toEqual([]);
    expect(await o.balance()).toBe(0);
  });

  it('all ticked: nothing is owed, so no line', async () => {
    const o = await owner();
    await setPlanPaidSoFar(o.database, o.ws, o.planId, 24);
    expect(await o.owedLines()).toEqual([]);
    expect(await o.balance()).toBe(0);
  });

  it('asking again writes nothing; a change of figures moves the line', async () => {
    const o = await owner();
    const count = async () => (await o.database.db.values<[number]>(sql`SELECT COUNT(*) FROM transactions`))[0]![0];
    const before = await count();
    await o.database.transaction((tx) => refreshPlanOwedTx(tx, o.ws, o.planId));
    await setPlanPaidSoFar(o.database, o.ws, o.planId, 20);
    const plan = await o.plan();
    await updateInstallment(o.database, o.ws, { id: plan.id, description: plan.description, totalMinor: plan.totalMinor, months: plan.months, firstBilledMonth: plan.firstBilledMonth, earnsPoints: plan.earnsPoints });
    expect(await count()).toBe(before);
    await updateInstallment(o.database, o.ws, { id: plan.id, description: plan.description, totalMinor: 26_000_000, months: 26, firstBilledMonth: plan.firstBilledMonth, earnsPoints: plan.earnsPoints });
    expect((await o.plan()).paidSoFar).toBe(20);
    expect(await o.balance()).toBe(-6_000_000);
    expect(await o.owedLines()).toHaveLength(1);
  });

  it('refuses a count outside the plan, and a plan tied to a purchase', async () => {
    const o = await owner();
    await expect(setPlanPaidSoFar(o.database, o.ws, o.planId, 25)).rejects.toThrow();
    await expect(setPlanPaidSoFar(o.database, o.ws, o.planId, -1)).rejects.toThrow();
  });

  it('spending counts only what is owed: instalments 21–24, in their months', async () => {
    const o = await owner();
    const spent = async (from: string, to: string) => (await categoryTotalsIn(o.database, o.ws, 'expense', from, to, { billMonths: true })).rows.reduce((s, r) => s + r.amountBaseMinor, 0);
    expect(await spent('2025-03-01', '2026-10-31')).toBe(0);
    expect(await spent('2026-11-01', '2026-11-30')).toBe(1_000_000);
    expect(await spent('2025-03-01', '2027-02-28')).toBe(4_000_000);
    await setPlanPaidSoFar(o.database, o.ws, o.planId, 21);
    expect(await spent('2026-11-01', '2026-11-30')).toBe(0);
    expect(await spent('2025-03-01', '2027-02-28')).toBe(3_000_000);
    // The owed line is no spending, no income and no debt payment.
    const flows = await periodFlows(o.database, o.ws, { from: '2026-11-01', to: '2026-11-30' });
    expect(flows.debtPaymentsMinor).toBe(0);
    expect(flows.incomeMinor).toBe(0);
  });

  it('Investment (At purchase): what is owed is put away, a month at a time', async () => {
    const o = await owner({ countMode: 'at_purchase' });
    const flows = await periodFlows(o.database, o.ws, { from: '2025-03-01', to: '2027-02-28' });
    expect(flows.putAwayMinor).toBe(4_000_000);
    expect(flows.debtPaymentsMinor).toBe(0);
  });
});

/*
 * The call on a card with an opening balance of its own: no owed line. That balance is what the bank said was owed on
 * its day, the plan's months still to bill included (as the app has always read it), so a line beside it would hold the
 * debt twice. The statements bill the owed instalments out of the opening instead. Figures invented: the card started
 * in the app on 1 Oct 2026 owing Rp 8.000.000 — Rp 3.000.000 of other spending and the plan's Rp 5.000.000 still to bill.
 */
describe('a card with an opening balance of its own', () => {
  it('posts no owed line: the debt is not held twice', async () => {
    const o = await owner({ opening: { openingBalanceMinor: 8_000_000, openedOn: '2026-10-01' } });
    expect((await o.plan()).paidSoFar).toBe(20);
    expect(await o.owedLines()).toEqual([]);
    expect(await o.balance()).toBe(-8_000_000);
  });

  it('bills the owed instalments out of the opening, and the statements still end at the card’s balance', async () => {
    const o = await owner({ opening: { openingBalanceMinor: 8_000_000, openedOn: '2026-10-01' } });
    const oct = await cardStatement(o.database, o.ws, o.card, SEP_OCT, TODAY);
    expect(oct.closingMinor).toBe(4_000_000);
    await o.pay('2026-10-20', 4_000_000);
    const nov = await cardStatement(o.database, o.ws, o.card, OCT_NOV, TODAY);
    expect(nov).toMatchObject({ openingMinor: 4_000_000, creditsMinor: 4_000_000, chargesMinor: 1_000_000, closingMinor: 1_000_000 });
    const last = await cardStatement(o.database, o.ws, o.card, LAST, '2027-02-20');
    expect(last.closingMinor).toBe(-(await o.balance()));
  });
});

describe('a plan tied to a purchase', () => {
  it('keeps none paid and posts no owed line: the purchase put the debt on the card', async () => {
    const o = await owner();
    const groceries = (await o.database.db.values<[string]>(sql`SELECT id FROM accounts WHERE system_key = 'household.groceries' LIMIT 1`))[0]![0];
    const { expenseLines } = await import('@expanses/core');
    const purchase = await postTransaction(o.database, o.ws, { occurredOn: '2026-11-05', description: 'Laptop', lines: expenseLines({ categoryAccountId: groceries, paymentAccountId: o.card, amountMinor: 12_000_000, currency: 'IDR' }) });
    const plan = await o.plan();
    await updateInstallment(o.database, o.ws, { id: plan.id, description: plan.description, totalMinor: 12_000_000, months: 12, firstBilledMonth: '2026-12', earnsPoints: false, transactionId: purchase });
    expect((await o.plan()).paidSoFar).toBe(0);
    expect(await o.owedLines()).toEqual([]);
    expect(await o.balance()).toBe(-12_000_000);
  });
});

describe('the plans saved before 0124, once on opening the app', () => {
  it('are set from the day each was added, their owed line posted; never again', async () => {
    const o = await owner({ addedAt: '2026-11-15T05:00:00.000Z' });
    // As a plan from before 0124 stands: nothing paid, nothing owed on the card.
    await o.database.db.run(sql`UPDATE card_installments SET paid_so_far = 0 WHERE id = ${o.planId}`);
    for (const [id] of await o.owedLines()) await voidTransaction(o.database, o.ws, id);
    await o.database.db.run(sql`UPDATE schema_migrations SET applied_at = '2026-11-17T01:00:00.000Z' WHERE version = 124`);
    expect(await o.balance()).toBe(0);

    expect(await repairPlanPaidSoFar(o.database, o.ws)).toEqual({ set: 1 });
    expect((await o.plan()).paidSoFar).toBe(20);
    expect(await o.balance()).toBe(-4_000_000);
    expect((await o.owedLines()).map(([, on]) => on)).toEqual(['2026-11-15']);
    // Run once: ticking after it is never undone by opening the app again.
    await setPlanPaidSoFar(o.database, o.ws, o.planId, 21);
    expect(await repairPlanPaidSoFar(o.database, o.ws)).toBeNull();
    expect((await o.plan()).paidSoFar).toBe(21);
    expect((await o.database.db.values(sql`SELECT 1 FROM settings WHERE key = ${planPaidSoFarKey(o.ws.workspaceId)}`)).length).toBe(1);
  });

  it('leave a plan saved since alone', async () => {
    const o = await owner({ addedAt: '2026-11-18T05:00:00.000Z' });
    await setPlanPaidSoFar(o.database, o.ws, o.planId, 18);
    await o.database.db.run(sql`UPDATE schema_migrations SET applied_at = '2026-11-17T01:00:00.000Z' WHERE version = 124`);
    expect(await repairPlanPaidSoFar(o.database, o.ws)).toEqual({ set: 0 });
    expect((await o.plan()).paidSoFar).toBe(18);
  });
});
