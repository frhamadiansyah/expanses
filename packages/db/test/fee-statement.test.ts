import { expenseLines, statementCycleFor, transferLines } from '@expanses/core';
import { describe, expect, it } from 'vitest';
import {
  addFeeCharge,
  addFeeReversal,
  cardStatement,
  cardStatementLines,
  categoryIdsByKey,
  createAccount,
  nativeBalances,
  paidOffMarkOf,
  postTransaction,
  saveCardTerms,
  type StatementLine,
} from '../src/index';
import { setupDb } from './helpers';

/*
 * Annual fee reversals on card statements (owner, 22 Nov 2026): the money back shows settled on its own, on every card,
 * and still pays like any refund; the fee row added beside a fee reversed before the app shows settled too and changes
 * no total. Invented card name and figures (the owner's shape of example, not her card).
 */

const FEE = 800_000;
const TODAY = '2026-11-20';
const OCTOBER = statementCycleFor('2026-10-20', 25); // 26 Sep – 25 Oct
const NOVEMBER = statementCycleFor('2026-11-20', 25); // 26 Oct – 25 Nov

async function card(feeOn: string, opening?: { minor: number; on: string }) {
  const t = await setupDb();
  const acc = await createAccount(t.database, t.ws, {
    name: 'Sample Platinum',
    kind: 'liability',
    subtype: 'credit_card',
    currency: 'IDR',
    ...(opening ? { openingBalanceMinor: opening.minor, openedOn: opening.on } : {}),
  });
  await saveCardTerms(t.database, t.ws, { accountId: acc.id, statementDay: 25, dueDay: 10, creditLimitMinor: null, annualFeeMinor: FEE, annualFeeOn: feeOn });
  const bank = await createAccount(t.database, t.ws, { name: 'Sample Savings', kind: 'asset', subtype: 'bank', currency: 'IDR', openingBalanceMinor: 50_000_000, openedOn: '2026-01-01' });
  const keys = await categoryIdsByKey(t.database, t.ws);
  const buy = (occurredOn: string, description: string, amountMinor: number) =>
    postTransaction(t.database, t.ws, { occurredOn, description, lines: expenseLines({ categoryAccountId: keys['food_beverage.restaurants']!, paymentAccountId: acc.id, amountMinor, currency: 'IDR' }) });
  const pay = (occurredOn: string, amountMinor: number) =>
    postTransaction(t.database, t.ws, { occurredOn, description: 'Card payment', lines: transferLines({ fromAccountId: bank.id, toAccountId: acc.id, amountMinor, currency: 'IDR' }) });
  const statement = (cycle: typeof OCTOBER) => cardStatement(t.database, t.ws, acc.id, cycle, TODAY);
  const owed = async () => (await nativeBalances(t.database, t.ws))[acc.id] ?? 0;
  return { ...t, id: acc.id, buy, pay, statement, owed };
}

/** Whether a line shows the paid ✓ as the statement draws it: covered whole, settled on its own, paid one by one or paid off. */
const ticked = (s: Awaited<ReturnType<typeof cardStatement>>, line: StatementLine) => s.cover[line.key]?.whole === true || line.feeSettled === true || line.paidBy !== null || line.paidOff;

describe('a card statement with an annual fee reversed', () => {
  it('the owner’s example: every line ✓, the reversal settled on its own and used as credit, and the card owes nothing', async () => {
    const t = await card('2025-10-06');
    await addFeeCharge(t.database, t.ws, { cardId: t.id, today: TODAY, amountMinor: FEE, on: '2026-10-06' });
    await t.buy('2026-10-15', 'Dinner', 1_000_000);
    await t.pay('2026-10-19', 800_000);
    await t.buy('2026-10-28', 'Lunch', 508_250);
    const back = await addFeeReversal(t.database, t.ws, { cardId: t.id, today: TODAY, amountMinor: FEE, on: '2026-11-03' });
    await t.pay('2026-11-12', 200_000);
    await t.pay('2026-11-12', 508_250);
    expect(await t.owed()).toBe(0);

    const october = await t.statement(OCTOBER);
    const november = await t.statement(NOVEMBER);
    expect(october).toMatchObject({ openingMinor: 0, chargesMinor: 1_800_000, creditsMinor: 800_000, closingMinor: 1_000_000, paidSinceMinor: 1_508_250, leftToPayMinor: 0 });
    expect(november).toMatchObject({ openingMinor: 1_000_000, chargesMinor: 508_250, creditsMinor: 1_508_250, closingMinor: 0 });
    // Every purchase and the fee are covered whole by the payments and the reversal, oldest first.
    for (const s of [october, november]) for (const line of s.lines.filter((l) => l.countedMinor > 0)) expect(s.cover[line.key]?.whole).toBe(true);
    // The reversal shows settled on its own, with no Settled mark to give (that would change what the card owes).
    const reversal = november.lines.find((line) => line.transactionId === back)!;
    expect(reversal).toMatchObject({ feeSettled: true, paidOff: false, countedMinor: -FEE });
    expect(await paidOffMarkOf(t.database, t.ws, back)).toBeNull();
    // Every line drawn wears the ✓ but the payments, which the list keeps off.
    for (const s of [october, november]) for (const line of s.lines.filter((l) => l.spending)) expect(ticked(s, line)).toBe(true);
  });

  it('a fee charged before the app: its added fee row shows settled, and every total is what the lone reversal left', async () => {
    // The card starts 1 Nov with what the bank said was owed; its fee came on 28 Oct, inside the first statement shown.
    const build = async (paired: boolean) => {
      const t = await card('2025-10-28', { minor: 3_000_000, on: '2026-11-01' });
      await t.buy('2026-11-05', 'Dinner', 400_000);
      let back: string;
      if (paired) back = await addFeeReversal(t.database, t.ws, { cardId: t.id, today: TODAY, amountMinor: FEE, on: '2026-11-03' });
      else {
        const keys = await categoryIdsByKey(t.database, t.ws);
        back = await postTransaction(t.database, t.ws, {
          occurredOn: '2026-11-03',
          description: 'Annual fee reversal',
          lines: [
            { accountId: keys['miscellaneous.membership_fee']!, amountMinor: -FEE, currency: 'IDR' },
            { accountId: t.id, amountMinor: FEE, currency: 'IDR' },
          ],
        });
      }
      await t.pay('2026-11-12', 1_000_000);
      return { t, back, s: await t.statement(NOVEMBER) };
    };
    const paired = await build(true);
    const lone = await build(false);
    const totals = (s: typeof paired.s) => [s.openingMinor, s.chargesMinor, s.creditsMinor, s.closingMinor, s.paidSinceMinor, s.leftToPayMinor];
    expect(totals(paired.s)).toEqual(totals(lone.s));
    expect(await paired.t.owed()).toBe(await lone.t.owed());
    const charges = (s: typeof paired.s) => s.lines.filter((line) => line.countedMinor > 0).map((line) => [line.description, s.cover[line.key]?.coveredMinor]);
    expect(charges(paired.s)).toEqual(charges(lone.s));

    const fee = paired.s.lines.find((line) => line.description === 'Annual fee')!;
    expect(fee).toMatchObject({ occurredOn: '2026-10-28', feeSettled: true, countedMinor: 0 });
    expect(paired.s.lines.find((line) => line.transactionId === paired.back)).toMatchObject({ feeSettled: true });
    // Nothing to mark or take back on either.
    const lines = await cardStatementLines(paired.t.database, paired.t.ws, paired.t.id);
    expect(lines.filter((line) => line.feeSettled).map((line) => line.description).sort()).toEqual(['Annual fee', 'Annual fee reversal']);
    expect(await paidOffMarkOf(paired.t.database, paired.t.ws, fee.transactionId)).toBeNull();
  });
});
