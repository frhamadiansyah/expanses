// packages/db/test/set-aside-doors.test.ts
import { expenseLines } from '@expanses/core';
import { beforeEach, describe, expect, it } from 'vitest';
import {
  type AccountRow, archiveGoal, categoryIdsByKeyTx, confirmDraft, convertToPurchase, createAccount, createCardAccount, createDraft, type Database,
  goalContributionsFor, listDraws, listEarmarks, payCardPurchases, postTransaction, recordBillPayments, recordExtraPayment, recordLoan,
  recordLoanPayment, recordRepayment, recordTaggedTransfer, recordTrade, replaceTrade, saveAssetProfile, saveEarmark, saveExpenseTemplate, saveGoal,
  saveLoanTerms, type SetAsideChoice, setAsideChoiceOf, splitBill, type WorkspaceContext,
} from '../src/index';
// `categoryIdsByKeyTx(db, ws)` (categories.ts:183) is the reader main has; there is no non-Tx `categoryIdsByKey`.
import { setupDb } from './helpers';

const DAY = '2026-09-19';
let database: Database;
let ws: WorkspaceContext;
let jenius: AccountRow;
let broker: AccountRow;
let electronics: AccountRow;
let efId: string;
let umrahId: string;
const borrow: () => SetAsideChoice = () => ({ accountId: jenius.id, goalId: efId, intent: 'borrow', overMinor: 1_800_000 });

beforeEach(async () => {
  ({ database, ws } = await setupDb());
  jenius = await createAccount(database, ws, { name: 'Jenius', kind: 'asset', subtype: 'savings', currency: 'IDR', openingBalanceMinor: 42_500_000, openedOn: '2026-01-01' });
  broker = await createAccount(database, ws, { name: 'Broker RDN', kind: 'asset', subtype: 'bank', currency: 'IDR' });
  electronics = await createAccount(database, ws, { name: 'Electronics', kind: 'expense', subtype: 'category', currency: null });
  const goal = (name: string, targetMinor: number) => saveGoal(database, ws, { name, kind: 'other', growthBps: 0, returnBps: 0, stages: [{ name, targetMinor, targetMonths: null, dueOn: '2027-12-31' }] });
  efId = await goal('Emergency fund', 30_000_000);
  umrahId = await goal('Umrah 2027', 7_500_000);
  await saveEarmark(database, ws, { goalId: efId, accountId: jenius.id, amountMinor: 30_000_000 });
  await saveEarmark(database, ws, { goalId: umrahId, accountId: jenius.id, amountMinor: 7_500_000 });
});

/** Every door pays Rp 6.800.000 from Jenius (Rp 5.000.000 free) and says Rp 1.800.000 came from the Emergency fund. */
const doors: [string, () => Promise<string>][] = [
  ['a split bill', async () => (await splitBill(database, ws, { occurredOn: DAY, description: 'Dinner', totalMinor: 6_800_000, moneyAccountId: jenius.id, ownCategoryId: electronics.id, ownShareMinor: 3_400_000, shares: [{ person: { name: 'Andi', currency: 'IDR' }, amountMinor: 3_400_000 }], setAside: borrow() })).transactionId],
  ['a loan to a person', async () => (await recordLoan(database, ws, { person: { name: 'Andi', direction: 'lent', currency: 'IDR' }, occurredOn: DAY, amountMinor: 6_800_000, moneyAccountId: jenius.id, setAside: borrow() })).transactionId],
  ['repaying someone you owe', async () => {
    const { debtAccountId } = await recordLoan(database, ws, { person: { name: 'Budi', direction: 'borrowed', currency: 'IDR' }, occurredOn: '2026-09-01', amountMinor: 10_000_000, moneyAccountId: jenius.id });
    // The repository forwards what it is given; whether to ask is the screen's question (Task 8).
    return (await recordRepayment(database, ws, { debtAccountId, occurredOn: DAY, amountMinor: 10_000_000, moneyAccountId: jenius.id, setAside: borrow() })).transactionId;
  }],
  ['a bill', async () => {
    const keys = await categoryIdsByKeyTx(database.db, ws);
    const bill = await saveExpenseTemplate(database, ws, { name: 'Rent', categoryAccountId: keys['household.groceries']!, moneyAccountId: jenius.id, amountMinor: 6_800_000, dayOfMonth: 1, startsMonth: '2026-09' });
    return (await recordBillPayments(database, ws, { paidOn: DAY, payments: [{ templateId: bill, billMonth: '2026-09', amountMinor: 6_800_000, setAside: borrow() }] }))[0]!;
  }],
  ['a loan instalment', async () => {
    const kpr = await createAccount(database, ws, { name: 'KPR', kind: 'liability', subtype: 'loan', currency: 'IDR', openingBalanceMinor: 700_000_000, openedOn: '2026-01-01' });
    await saveLoanTerms(database, ws, { accountId: kpr.id, lenderName: 'BTN', originalMinor: 700_000_000, firstPaymentOn: '2026-01-25', tenorMonths: 180, method: 'annuity', paymentDay: 25, rateBps: 900 });
    return (await recordLoanPayment(database, ws, { accountId: kpr.id, occurredOn: DAY, moneyAccountId: jenius.id, principalMinor: 5_000_000, interestMinor: 1_800_000, setAside: borrow() })).transactionId;
  }],
  ['an extra loan payment', async () => {
    const kpr = await createAccount(database, ws, { name: 'KPR', kind: 'liability', subtype: 'loan', currency: 'IDR', openingBalanceMinor: 700_000_000, openedOn: '2026-01-01' });
    await saveLoanTerms(database, ws, { accountId: kpr.id, lenderName: 'BTN', originalMinor: 700_000_000, firstPaymentOn: '2026-01-25', tenorMonths: 180, method: 'annuity', paymentDay: 25, rateBps: 900 });
    return (await recordExtraPayment(database, ws, { accountId: kpr.id, occurredOn: DAY, moneyAccountId: jenius.id, amountMinor: 6_800_000, keep: 'payment', setAside: borrow() })).transactionId;
  }],
  ['paying card purchases now', async () => {
    const card = await createCardAccount(database, ws, { name: 'BCA Visa', subtype: 'credit_card', currency: 'IDR' });
    const purchase = await postTransaction(database, ws, { occurredOn: '2026-09-10', description: 'Laptop', lines: expenseLines({ categoryAccountId: electronics.id, paymentAccountId: card.id, amountMinor: 6_800_000, currency: 'IDR' }) });
    return payCardPurchases(database, ws, { cardAccountId: card.id, fromAccountId: jenius.id, occurredOn: DAY, purchaseTransactionIds: [purchase], setAside: borrow() });
  }],
  ['confirming a draft', async () => {
    const draft = await createDraft(database, ws, { source: 'manual', occurredOn: DAY, description: 'Laptop', amountMinor: 6_800_000, currency: 'IDR', accountId: jenius.id, categoryAccountId: electronics.id });
    return confirmDraft(database, ws, draft, { setAside: borrow() });
  }],
  ['a buy with no goal', async () => {
    const gold = await createAccount(database, ws, { name: 'Antam', kind: 'asset', subtype: 'investment', currency: 'IDR' });
    await saveAssetProfile(database, ws, { accountId: gold.id, assetKind: 'gold' });
    return (await recordTrade(database, ws, { accountId: gold.id, kind: 'buy', occurredOn: DAY, unitsMicro: 4_000_000, grossMinor: 6_800_000, feeMinor: 0, taxMinor: 0, cashAccountId: jenius.id, setAside: borrow() })).transactionId!;
  }],
];

describe('every door forwards the answer', () => {
  it.each(doors)('%s', async (_name, pay) => {
    const transactionId = await pay();
    expect(await listDraws(database, ws)).toEqual([expect.objectContaining({ transactionId, goalId: efId, accountId: jenius.id, intent: 'borrow', amountMinor: 1_800_000 })]);
  });
});

describe('moving money for a goal', () => {
  it('takes the goal\'s own promise with a tagged transfer, and nets its month to nought', async () => {
    const today = new Date().toISOString().slice(0, 10);
    // saveEarmark already logged Umrah's 7.500.000 today, so the move is read as what it adds to the month: nothing.
    const before = (await goalContributionsFor(database, ws, today.slice(0, 7)))[umrahId] ?? 0;
    await recordTaggedTransfer(database, ws, { occurredOn: today, description: 'To broker', amountMinor: 7_500_000, fromAccountId: jenius.id, toAccountId: broker.id, goalId: umrahId });
    const earmarks = await listEarmarks(database, ws);
    expect(earmarks.find((row) => row.goalId === umrahId && row.accountId === jenius.id)).toBeUndefined();
    expect(earmarks.find((row) => row.goalId === umrahId && row.accountId === broker.id)!.amountMinor).toBe(7_500_000);
    // +7.500.000 arrived, −7.500.000 left the Jenius promise: Umrah's money moved, nothing new was saved.
    expect(before).toBe(7_500_000);
    expect((await goalContributionsFor(database, ws, today.slice(0, 7)))[umrahId] ?? 0).toBe(before);
  });

  it('does not read a goal\'s own move as the answer the owner gave, and reads a borrow beside it', async () => {
    const plain = await recordTaggedTransfer(database, ws, { occurredOn: DAY, description: 'To broker', amountMinor: 7_500_000, fromAccountId: jenius.id, toAccountId: broker.id, goalId: umrahId });
    // The own move is kept (a void gives it back) but nobody answered a question: an edit has nothing to carry.
    expect(await listDraws(database, ws)).toEqual([expect.objectContaining({ transactionId: plain.transactionId, goalId: umrahId, intent: 'move', toAccountId: null, amountMinor: 7_500_000 })]);
    expect(await setAsideChoiceOf(database, ws, plain.transactionId)).toBeNull();

    const both = await recordTaggedTransfer(database, ws, { occurredOn: DAY, description: 'To broker', amountMinor: 6_800_000, fromAccountId: jenius.id, toAccountId: broker.id, goalId: umrahId, setAside: borrow() });
    expect(await setAsideChoiceOf(database, ws, both.transactionId)).toMatchObject({ goalId: efId, intent: 'borrow', overMinor: 1_800_000 });
  });

  it('lowers the cash promise by what left the cash account, not by the holding\'s figure', async () => {
    const shares = await createAccount(database, ws, { name: 'US shares', kind: 'asset', subtype: 'investment', currency: 'USD' });
    await saveAssetProfile(database, ws, { accountId: shares.id, assetKind: 'stock' });
    await recordTrade(database, ws, { accountId: shares.id, kind: 'buy', occurredOn: DAY, unitsMicro: 1_000_000, grossMinor: 10_000, feeMinor: 0, taxMinor: 0, cashAccountId: jenius.id, cashMinor: 1_600_000, goalId: umrahId, ratesToBase: { USD: 16_000 } });
    // 7.500.000 − 1.600.000. The old figure was 7.500.000 − 10.000 cents read as rupiah.
    expect((await listEarmarks(database, ws)).find((row) => row.goalId === umrahId)!.amountMinor).toBe(5_900_000);
  });

  it('carries a borrow onto the purchase an expense is turned into', async () => {
    const gold = await createAccount(database, ws, { name: 'Antam', kind: 'asset', subtype: 'investment', currency: 'IDR' });
    await saveAssetProfile(database, ws, { accountId: gold.id, assetKind: 'gold' });
    const expense = await postTransaction(database, ws, { occurredOn: DAY, description: 'Gold', lines: expenseLines({ categoryAccountId: electronics.id, paymentAccountId: jenius.id, amountMinor: 6_800_000, currency: 'IDR' }), setAside: borrow() });
    const { transactionId } = await convertToPurchase(database, ws, { transactionId: expense, accountId: gold.id, unitsMicro: 4_000_000 });
    expect(await listDraws(database, ws)).toEqual([expect.objectContaining({ transactionId, goalId: efId, intent: 'borrow', amountMinor: 1_800_000 })]);
  });

  it('drops the borrow rather than refusing the purchase when its goal was archived since', async () => {
    const gold = await createAccount(database, ws, { name: 'Antam', kind: 'asset', subtype: 'investment', currency: 'IDR' });
    await saveAssetProfile(database, ws, { accountId: gold.id, assetKind: 'gold' });
    const expense = await postTransaction(database, ws, { occurredOn: DAY, description: 'Gold', lines: expenseLines({ categoryAccountId: electronics.id, paymentAccountId: jenius.id, amountMinor: 6_800_000, currency: 'IDR' }), setAside: borrow() });
    await archiveGoal(database, ws, efId);
    const { transactionId } = await convertToPurchase(database, ws, { transactionId: expense, accountId: gold.id, unitsMicro: 4_000_000 });
    expect(transactionId).toBeTruthy();
    expect(await listDraws(database, ws)).toEqual([]);
  });
});

describe('turning an expense into a purchase, by what the answer was', () => {
  let gold: AccountRow;
  beforeEach(async () => {
    gold = await createAccount(database, ws, { name: 'Antam', kind: 'asset', subtype: 'investment', currency: 'IDR' });
    await saveAssetProfile(database, ws, { accountId: gold.id, assetKind: 'gold' });
  });
  const promised = async (goalId: string) => (await listEarmarks(database, ws)).find((row) => row.goalId === goalId && row.accountId === jenius.id)?.amountMinor ?? 0;
  const expense = (setAside: SetAsideChoice) =>
    postTransaction(database, ws, { occurredOn: DAY, description: 'Gold', lines: expenseLines({ categoryAccountId: electronics.id, paymentAccountId: jenius.id, amountMinor: 6_800_000, currency: 'IDR' }), setAside });

  it('gives a spend back and does not spend it again on the purchase', async () => {
    const id = await expense({ accountId: jenius.id, goalId: umrahId, intent: 'spend', overMinor: 1_800_000 });
    expect(await promised(umrahId)).toBe(700_000);
    await convertToPurchase(database, ws, { transactionId: id, accountId: gold.id, unitsMicro: 4_000_000 });
    // Re-applied, the spend would read 700.000 again.
    expect(await promised(umrahId)).toBe(7_500_000);
    expect(await listDraws(database, ws)).toEqual([]);
  });

  it('drops a borrow from the goal the purchase is now for: that goal\'s money is its own to use', async () => {
    const id = await expense(borrow());
    await convertToPurchase(database, ws, { transactionId: id, accountId: gold.id, unitsMicro: 4_000_000, goalId: efId });
    // The buy lowers the Emergency fund's cash promise by the whole 6.800.000; no borrow from itself is kept.
    expect(await promised(efId)).toBe(23_200_000);
    // Only the buy's own lowering is recorded (a move with no destination, ruling I3), so a delete can give it back.
    expect(await listDraws(database, ws)).toEqual([expect.objectContaining({ goalId: efId, intent: 'move', toAccountId: null, amountMinor: 6_800_000 })]);
  });
});

describe('editing a buy through replaceTrade', () => {
  let gold: AccountRow;
  beforeEach(async () => {
    gold = await createAccount(database, ws, { name: 'Antam', kind: 'asset', subtype: 'investment', currency: 'IDR' });
    await saveAssetProfile(database, ws, { accountId: gold.id, assetKind: 'gold' });
  });
  const buy = (grossMinor: number, extra: { cashAccountId?: string; goalId?: string | null; setAside?: SetAsideChoice | null } = {}) => ({
    accountId: gold.id,
    kind: 'buy' as const,
    occurredOn: DAY,
    unitsMicro: 4_000_000,
    grossMinor,
    feeMinor: 0,
    taxMinor: 0,
    cashAccountId: extra.cashAccountId ?? jenius.id,
    goalId: extra.goalId ?? null,
    ...(extra.setAside === undefined ? {} : { setAside: extra.setAside }),
  });

  it('carries a borrow the edit does not mention, clamped to what it now pays, as replaceTransaction does', async () => {
    const first = await recordTrade(database, ws, buy(6_800_000, { setAside: borrow() }));
    const edited = await replaceTrade(database, ws, first.tradeId, buy(1_000_000));
    expect(await listDraws(database, ws)).toEqual([expect.objectContaining({ transactionId: edited.transactionId, goalId: efId, intent: 'borrow', amountMinor: 1_000_000 })]);
  });

  it('clears it on null, and drops it when the buy is paid from elsewhere or is now for that goal', async () => {
    const first = await recordTrade(database, ws, buy(6_800_000, { setAside: borrow() }));
    const cleared = await replaceTrade(database, ws, first.tradeId, buy(6_800_000, { setAside: null }));
    expect(await listDraws(database, ws)).toEqual([]);
    const again = await replaceTrade(database, ws, cleared.tradeId, buy(6_800_000, { setAside: borrow() }));
    const elsewhere = await replaceTrade(database, ws, again.tradeId, buy(6_800_000, { cashAccountId: broker.id }));
    expect(await listDraws(database, ws)).toEqual([]);
    const back = await replaceTrade(database, ws, elsewhere.tradeId, buy(6_800_000, { setAside: borrow() }));
    await replaceTrade(database, ws, back.tradeId, buy(6_800_000, { goalId: efId }));
    // No borrow is kept; the buy for the fund records only its own lowering (ruling I3).
    expect(await listDraws(database, ws)).toEqual([expect.objectContaining({ goalId: efId, intent: 'move', toAccountId: null })]);
  });
});
