import { expenseLines, minorToMajorString, statementCycleFor, transferLines } from '@expanses/core';
import { cardStatement, createAccount, createCardAccount, createDatabase, createWorkspace, listAccounts, migrate, postTransaction, saveCardTerms } from '@expanses/db';
import { createNodeExecutor } from '@expanses/db/node';
import { afterEach, describe, expect, it } from 'vitest';
import { statementPaySeed } from './card-pay';
import { billBox, cashbackMinor, choiceBack, newestFirst, pickedPay, showsCardColumn, showsPointsColumn } from './card-desk-model';
import { statementTotals } from './statement-totals';

/*
 * Invented figures and names. A card cut on the 20th, due on the 5th: August is 21 Jul – 20 Aug, due 5 Sep.
 */
const AUGUST = statementCycleFor('2026-08-20', 20);
const TODAY = '2026-08-28';

const closers: (() => void)[] = [];
afterEach(() => {
  for (const close of closers.splice(0)) close();
});

async function setUp() {
  const executor = createNodeExecutor();
  closers.push(() => executor.close());
  const database = createDatabase(executor);
  await migrate(database);
  const ws = await createWorkspace(database, { name: 'Personal', type: 'personal', baseCurrency: 'IDR' });
  const visa = await createCardAccount(database, ws, { name: 'Kartu Dua', subtype: 'credit_card', currency: 'IDR' });
  await saveCardTerms(database, ws, { accountId: visa.id, statementDay: 20, dueDay: 5, creditLimitMinor: 20_000_000, annualFeeMinor: null });
  const bank = await createAccount(database, ws, { name: 'Bank Dua', kind: 'asset', subtype: 'bank', currency: 'IDR', openingBalanceMinor: 9_000_000, openedOn: '2026-07-01' });
  const accounts = await listAccounts(database, ws);
  const groceries = accounts.find((a) => a.systemKey === 'household.groceries')!.id;
  const ids: string[] = [];
  for (const [occurredOn, description, amountMinor] of [
    ['2026-08-02', 'Pasar', 318_000],
    ['2026-08-06', 'Ojek', 47_500],
    ['2026-08-11', 'Toko', 702_000],
  ] as const) {
    ids.push(await postTransaction(database, ws, { occurredOn, description, lines: expenseLines({ categoryAccountId: groceries, paymentAccountId: visa.id, amountMinor, currency: 'IDR' }) }));
  }
  const pay = (amountMinor: number, occurredOn: string) =>
    postTransaction(database, ws, { occurredOn, description: 'Credit card payment', lines: transferLines({ fromAccountId: bank.id, toAccountId: visa.id, amountMinor, currency: 'IDR' }), setAside: null, fileTransfer: true });
  return { database, ws, visa, ids, pay };
}

describe('the bill box', () => {
  it('reads the last statement as the phone’s card page does: left to pay, paid since, and due on the due day', async () => {
    const s = await setUp();
    await s.pay(200_000, '2026-08-24');
    const last = await cardStatement(s.database, s.ws, s.visa.id, AUGUST, TODAY);
    const box = billBox(last, { dueDay: 5 }, TODAY);
    expect(box.state).toBe('due');
    if (box.state !== 'due') return;
    const totals = statementTotals(last);
    expect(box.billMinor).toBe(318_000 + 47_500 + 702_000);
    expect(box.paidMinor).toBe(200_000);
    expect(box.toPayMinor).toBe(last.leftToPayMinor);
    expect(box.toPayMinor).toBe(totals.billMinor - totals.paidMinor);
    expect(box.dueOn).toBe('2026-09-05');
    expect(box.due?.text).toBe('in 8 days');
  });

  it('says paid in full once the payments cover the bill, and nothing billed for an empty statement', async () => {
    const s = await setUp();
    await s.pay(1_067_500, '2026-08-25');
    expect(billBox(await cardStatement(s.database, s.ws, s.visa.id, AUGUST, TODAY), { dueDay: 5 }, TODAY)).toMatchObject({ state: 'paid', toPayMinor: 0, paidMinor: 1_067_500 });
    const july = statementCycleFor('2026-07-20', 20);
    expect(billBox(await cardStatement(s.database, s.ws, s.visa.id, july, TODAY), { dueDay: 5 }, TODAY)).toEqual({ state: 'nothing', statementOn: july.end });
    expect(billBox(undefined, undefined, TODAY)).toEqual({ state: 'no-terms' });
  });
});

describe('Pay for the ⌘-picked purchases', () => {
  it('totals what is left of the picked purchases, the amount the Pay credit card screen fills in', async () => {
    const s = await setUp();
    const statement = await cardStatement(s.database, s.ws, s.visa.id, AUGUST, TODAY);
    const picked = pickedPay(statement, [s.ids[0]!, s.ids[2]!]);
    expect(picked.purchases.map((p) => p.description)).toEqual(['Pasar', 'Toko']);
    expect(picked.totalMinor).toBe(318_000 + 702_000);
    expect(statementPaySeed(s.visa.id, picked.purchases, 'IDR').amount).toBe(minorToMajorString(picked.totalMinor, 'IDR'));
  });

  it('pays only what is left of a purchase a payment partly covered, and nothing for one covered whole', async () => {
    const s = await setUp();
    // Payments cover the oldest first: Pasar whole, Ojek for 32.000 of its 47.500.
    await s.pay(350_000, '2026-08-12');
    const statement = await cardStatement(s.database, s.ws, s.visa.id, AUGUST, TODAY);
    const picked = pickedPay(statement, s.ids);
    expect(picked.purchases.map((p) => [p.description, p.leftMinor])).toEqual([
      ['Ojek', 15_500],
      ['Toko', 702_000],
    ]);
    expect(picked.totalMinor).toBe(717_500);
    expect(pickedPay(statement, [])).toEqual({ purchases: [], totalMinor: 0 });
  });
});

describe('the table’s columns and order', () => {
  it('draws the Card column only with more than one card on the account', () => {
    expect(showsCardColumn([])).toBe(false);
    expect(showsCardColumn([{ id: 'primary' }])).toBe(false);
    expect(showsCardColumn([{ id: 'primary' }, { id: 'supplementary' }])).toBe(true);
  });

  it('draws the miles or points column only for a card that works its points out', () => {
    expect(showsPointsColumn({ program: undefined, rules: [] })).toBe(false);
    expect(showsPointsColumn({ program: { id: 'p' }, rules: [] })).toBe(false);
    expect(showsPointsColumn({ program: { id: 'p' }, rules: [{}] })).toBe(true);
  });

  it('lists newest first, and the switch names how far back each statement is', () => {
    const lines = [
      { occurredOn: '2026-08-02', statementOn: '2026-08-02', key: 'a' },
      { occurredOn: '2026-08-11', statementOn: '2026-08-11', key: 'b' },
      { occurredOn: '2026-08-11', statementOn: '2026-08-11', key: 'c' },
    ];
    expect(newestFirst(lines).map((line) => line.key)).toEqual(['c', 'b', 'a']);
    expect([choiceBack('this'), choiceBack('last'), choiceBack('all')]).toEqual([0, 1, null]);
  });

  it('adds up the cashback put on the card, and nothing else', () => {
    const line = (transactionId: string, owedMinor: number, spending = true) => ({ transactionId, owedMinor, spending }) as never;
    expect(cashbackMinor([line('cb', -25_000), line('refund', -40_000), line('buy', 90_000), line('pay', -500_000, false)], (id) => id === 'cb')).toBe(25_000);
  });
});
