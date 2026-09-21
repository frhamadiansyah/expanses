import { eq } from 'drizzle-orm';
import { beforeEach, describe, expect, it } from 'vitest';
import { expenseLines, transferLines } from '@expanses/core';
import {
  type AccountRow,
  createAccount,
  type Database,
  deleteTrade,
  goalContributionsFor,
  goalsSchema,
  listEarmarks,
  postTransaction,
  recordTaggedTransfer,
  recordTrade,
  replaceTrade,
  replaceTransaction,
  saveAssetProfile,
  saveEarmark,
  saveGoal,
  type SetAsideChoice,
  setAsideChoiceOf,
  voidTransaction,
  type WorkspaceContext,
} from '../src/index';
import { entries } from '../src/schema';
import { setupDb } from './helpers';

/**
 * The final review's three blockers, each as the reviewer ran it (final-review.md I1–I3). Umrah is promised on Jenius;
 * the Emergency fund beside it keeps the account from ever being short, so every figure below is the goal's alone.
 */
const DAY = '2026-09-19';
let database: Database;
let ws: WorkspaceContext;
let jenius: AccountRow;
let bca: AccountRow;
let gold: AccountRow;
let electronics: AccountRow;
let efId: string;
let umrahId: string;

beforeEach(async () => {
  ({ database, ws } = await setupDb());
  jenius = await createAccount(database, ws, { name: 'Jenius', kind: 'asset', subtype: 'savings', currency: 'IDR', openingBalanceMinor: 42_500_000, openedOn: '2026-01-01' });
  bca = await createAccount(database, ws, { name: 'BCA', kind: 'asset', subtype: 'bank', currency: 'IDR', openingBalanceMinor: 1_000_000, openedOn: '2026-01-01' });
  gold = await createAccount(database, ws, { name: 'Antam', kind: 'asset', subtype: 'investment', currency: 'IDR' });
  await saveAssetProfile(database, ws, { accountId: gold.id, assetKind: 'gold' });
  electronics = await createAccount(database, ws, { name: 'Electronics', kind: 'expense', subtype: 'category', currency: null });
  efId = await saveGoal(database, ws, { name: 'Emergency fund', kind: 'emergency', growthBps: 0, returnBps: 0, stages: [{ name: 'Emergency fund', targetMinor: 30_000_000, targetMonths: null, dueOn: '2027-12-31' }] });
  umrahId = await saveGoal(database, ws, {
    name: 'Umrah 2027',
    kind: 'umrah',
    growthBps: 0,
    returnBps: 0,
    stages: [
      { name: 'Tickets', targetMinor: 7_500_000, targetMonths: null, dueOn: '2027-03-31' },
      { name: 'Hotel', targetMinor: 5_000_000, targetMonths: null, dueOn: '2027-04-30' },
    ],
  });
  await saveEarmark(database, ws, { goalId: efId, accountId: jenius.id, amountMinor: 30_000_000 });
  await saveEarmark(database, ws, { goalId: umrahId, accountId: jenius.id, amountMinor: 7_500_000 });
});

const promised = async (goalId: string, accountId: string) =>
  (await listEarmarks(database, ws)).find((row) => row.goalId === goalId && row.accountId === accountId)?.amountMinor ?? 0;
const draws = () => database.db.select().from(goalsSchema.goalDraws).where(eq(goalsSchema.goalDraws.workspaceId, ws.workspaceId));
const linesOf = (id: string) => database.db.select({ accountId: entries.accountId, amountMinor: entries.amountMinor, currency: entries.currency }).from(entries).where(eq(entries.transactionId, id));
/** Its own lines again with a new note: the edit that must change nothing. */
const noteOnly = async (id: string, setAside?: SetAsideChoice | null) =>
  replaceTransaction(database, ws, id, { occurredOn: DAY, description: 'Edited note', lines: await linesOf(id), ...(setAside === undefined ? {} : { setAside }) });
const expenseFrom = (from: AccountRow, amountMinor: number, setAside?: SetAsideChoice | null) =>
  postTransaction(database, ws, { occurredOn: DAY, description: 'Laptop', lines: expenseLines({ categoryAccountId: electronics.id, paymentAccountId: from.id, amountMinor, currency: 'IDR' }), setAside });
const spend = (goalId: string, from: AccountRow): SetAsideChoice => ({ accountId: from.id, goalId, intent: 'spend', overMinor: 1 });

describe('I1: an edit or a delete never gives a goal back promise that was spent since', () => {
  const taggedToBca = async () =>
    (await recordTaggedTransfer(database, ws, { occurredOn: DAY, description: 'To BCA for Umrah', amountMinor: 7_500_000, fromAccountId: jenius.id, toAccountId: bca.id, goalId: umrahId })).transactionId;

  it('a note-only edit of a tagged transfer leaves the spent promise spent', async () => {
    const transfer = await taggedToBca();
    expect([await promised(umrahId, jenius.id), await promised(umrahId, bca.id)]).toEqual([0, 7_500_000]);
    await expenseFrom(bca, 3_000_000, spend(umrahId, bca));
    expect(await promised(umrahId, bca.id)).toBe(4_500_000);

    await noteOnly(transfer);

    // Undo-then-redo read 7.500.000: Rp 3.000.000 of promise back that was spent.
    expect(await promised(umrahId, bca.id)).toBe(4_500_000);
    expect(await promised(umrahId, jenius.id)).toBe(0);
  });

  it('deleting the transfer and then the expense never promises more than the goal started with', async () => {
    const transfer = await taggedToBca();
    const laptop = await expenseFrom(bca, 3_000_000, spend(umrahId, bca));

    await voidTransaction(database, ws, transfer);
    // Only what was still on BCA (4.500.000) goes back to Jenius; the 3.000.000 spent is not given back twice.
    expect([await promised(umrahId, jenius.id), await promised(umrahId, bca.id)]).toEqual([4_500_000, 0]);
    await voidTransaction(database, ws, laptop);

    // The review's run ended at 7.500.000 + 3.000.000 = 10.500.000 with no transactions left.
    expect((await promised(umrahId, jenius.id)) + (await promised(umrahId, bca.id))).toBe(7_500_000);
  });

  it('deleting newest first returns every promise exactly where it started', async () => {
    const transfer = await taggedToBca();
    const laptop = await expenseFrom(bca, 3_000_000, spend(umrahId, bca));
    await voidTransaction(database, ws, laptop);
    await voidTransaction(database, ws, transfer);
    expect([await promised(umrahId, jenius.id), await promised(umrahId, bca.id)]).toEqual([7_500_000, 0]);
    expect(await draws()).toEqual([]);
  });

  it('a note-only edit of a "Move the promise" transfer leaves the destination as spent', async () => {
    const transfer = await postTransaction(database, ws, {
      occurredOn: DAY,
      description: 'To BCA',
      lines: transferLines({ fromAccountId: jenius.id, toAccountId: bca.id, amountMinor: 20_000_000, currency: 'IDR' }),
      setAside: { accountId: jenius.id, goalId: efId, intent: 'move', overMinor: 15_000_000, toAccountId: bca.id },
    });
    await expenseFrom(bca, 10_000_000, spend(efId, bca));
    expect([await promised(efId, jenius.id), await promised(efId, bca.id)]).toEqual([15_000_000, 5_000_000]);

    await noteOnly(transfer);
    expect([await promised(efId, jenius.id), await promised(efId, bca.id)]).toEqual([15_000_000, 5_000_000]);
    // The form's own path: the saved answer given back explicitly.
    const [moved] = (await draws()).filter((draw) => draw.intent === 'move');
    await noteOnly(moved!.transactionId, (await setAsideChoiceOf(database, ws, moved!.transactionId))!);
    expect([await promised(efId, jenius.id), await promised(efId, bca.id)]).toEqual([15_000_000, 5_000_000]);
  });

  it('an edit that makes the transfer smaller after its money was spent takes the difference from the spend, as a fresh post would', async () => {
    const transfer = await taggedToBca();
    const laptop = await expenseFrom(bca, 6_000_000, spend(umrahId, bca));
    expect(await promised(umrahId, bca.id)).toBe(1_500_000);

    const smaller = await replaceTransaction(database, ws, transfer, {
      occurredOn: DAY,
      description: 'To BCA for Umrah',
      lines: transferLines({ fromAccountId: jenius.id, toAccountId: bca.id, amountMinor: 5_000_000, currency: 'IDR' }),
    });
    // Posted fresh: 5.000.000 lands, the laptop spends all 5.000.000 of it, and 2.500.000 stays on Jenius.
    expect([await promised(umrahId, jenius.id), await promised(umrahId, bca.id)]).toEqual([2_500_000, 0]);
    expect((await draws()).find((draw) => draw.intent === 'spend')).toMatchObject({ amountMinor: 5_000_000 });

    await voidTransaction(database, ws, laptop);
    await voidTransaction(database, ws, smaller);
    expect([await promised(umrahId, jenius.id), await promised(umrahId, bca.id)]).toEqual([7_500_000, 0]);
  });
});

describe('I2: a carried spend keeps the amount it drew', () => {
  it('re-filing a spend does not take more because the promise grew since', async () => {
    await saveEarmark(database, ws, { goalId: umrahId, accountId: jenius.id, amountMinor: 5_000_000 });
    const laptop = await expenseFrom(jenius, 6_000_000, spend(umrahId, jenius));
    expect(await promised(umrahId, jenius.id)).toBe(0);
    await saveEarmark(database, ws, { goalId: umrahId, accountId: jenius.id, amountMinor: 7_500_000 });

    const carried = await noteOnly(laptop);
    // Re-applied against the grown promise it read 6.500.000.
    expect(await promised(umrahId, jenius.id)).toBe(7_500_000);
    expect((await draws())[0]).toMatchObject({ intent: 'spend', amountMinor: 5_000_000 });

    // The edit form gives the same answer back: the same.
    await noteOnly(carried, spend(umrahId, jenius));
    expect(await promised(umrahId, jenius.id)).toBe(7_500_000);
    expect((await draws())[0]).toMatchObject({ intent: 'spend', amountMinor: 5_000_000 });
  });

  it('a larger payment draws only the growth on top', async () => {
    await saveEarmark(database, ws, { goalId: umrahId, accountId: jenius.id, amountMinor: 5_000_000 });
    const laptop = await expenseFrom(jenius, 6_000_000, spend(umrahId, jenius));
    await saveEarmark(database, ws, { goalId: umrahId, accountId: jenius.id, amountMinor: 7_500_000 });
    await replaceTransaction(database, ws, laptop, { occurredOn: DAY, description: 'Laptop', lines: expenseLines({ categoryAccountId: electronics.id, paymentAccountId: jenius.id, amountMinor: 7_000_000, currency: 'IDR' }) });
    // 5.000.000 drawn, plus the 1.000.000 the payment grew by.
    expect((await draws())[0]).toMatchObject({ amountMinor: 6_000_000 });
    expect(await promised(umrahId, jenius.id)).toBe(6_500_000);
  });
});

describe('I3: a tagged buy gives its cash promise back, and an unchanged edit takes nothing new', () => {
  const buy = (grossMinor: number) => ({ accountId: gold.id, kind: 'buy' as const, occurredOn: DAY, unitsMicro: 4_000_000, grossMinor, feeMinor: 0, taxMinor: 0, cashAccountId: jenius.id, goalId: umrahId });

  it('an unchanged edit leaves the promise, and a delete gives it back', async () => {
    const first = await recordTrade(database, ws, buy(3_000_000));
    expect(await promised(umrahId, jenius.id)).toBe(4_500_000);
    expect(await draws()).toEqual([expect.objectContaining({ transactionId: first.transactionId, intent: 'move', accountId: jenius.id, toAccountId: null, amountMinor: 3_000_000 })]);

    const edited = await replaceTrade(database, ws, first.tradeId, buy(3_000_000));
    // The review's run read 1.500.000: the lowering taken a second time.
    expect(await promised(umrahId, jenius.id)).toBe(4_500_000);

    await deleteTrade(database, ws, edited.tradeId);
    expect(await promised(umrahId, jenius.id)).toBe(7_500_000);
    expect(await draws()).toEqual([]);
  });

  it('the lowering is not a tagged transfer in the month\'s contributions', async () => {
    const before = (await goalContributionsFor(database, ws, '2026-09'))[umrahId] ?? 0;
    await recordTrade(database, ws, buy(3_000_000));
    // Paid from a savings pot, the buy itself is not counted; the draw must not be read as −3.000.000 moved away.
    expect((await goalContributionsFor(database, ws, '2026-09'))[umrahId] ?? 0).toBe(before);
  });
});

describe('M1: a carried borrow stands after its goal\'s promise there was spent to nought', () => {
  it('an edit and a conversion keep the borrow', async () => {
    const borrow: SetAsideChoice = { accountId: jenius.id, goalId: efId, intent: 'borrow', overMinor: 1_800_000, wasWhole: true, wholeSince: '2026-08-03' };
    const laptop = await expenseFrom(jenius, 6_800_000, borrow);
    // The fund's whole promise on Jenius is then spent.
    await expenseFrom(jenius, 30_000_000, spend(efId, jenius));
    expect(await promised(efId, jenius.id)).toBe(0);
    const edited = await noteOnly(laptop);
    expect((await draws()).filter((draw) => draw.intent === 'borrow')).toEqual([expect.objectContaining({ transactionId: edited, goalId: efId, amountMinor: 1_800_000, wasWhole: 1 })]);
    const { convertToPurchase } = await import('../src/index');
    const converted = await convertToPurchase(database, ws, { transactionId: edited, accountId: gold.id, unitsMicro: 1_000_000 });
    expect((await draws()).filter((draw) => draw.intent === 'borrow')).toEqual([expect.objectContaining({ transactionId: converted.transactionId, goalId: efId, amountMinor: 1_800_000 })]);
  });
});

describe('I5: a pocket parent holds no money, so nothing is promised on it', () => {
  it('is no holder, refuses an earmark, and refuses a move answer naming it', async () => {
    const { openPocketedAccount, canHoldSetAside, SetAsideError } = await import('../src/index');
    const { parent, pockets } = await openPocketedAccount(database, ws, {
      item: 'savings',
      name: 'Pocket Valas',
      openedOn: '2026-01-01',
      pockets: [{ currency: 'IDR', openingBalanceMinor: 1_000_000 }, { currency: 'USD', openingBalanceMinor: 10_000, openingRateToBase: 16_000 }],
    });
    const idrPocket = pockets.find((pocket) => pocket.currency === 'IDR')!;
    expect(await canHoldSetAside(database.db, ws, parent.id)).toBe(false);
    expect(await canHoldSetAside(database.db, ws, idrPocket.id)).toBe(true);
    await expect(saveEarmark(database, ws, { goalId: umrahId, accountId: parent.id, amountMinor: 1 })).rejects.toThrow(/holds no money of its own/);
    await saveEarmark(database, ws, { goalId: umrahId, accountId: idrPocket.id, amountMinor: 500_000 });

    const toParent = postTransaction(database, ws, {
      occurredOn: DAY,
      description: 'To the pocket',
      lines: transferLines({ fromAccountId: jenius.id, toAccountId: idrPocket.id, amountMinor: 20_000_000, currency: 'IDR' }),
      setAside: { accountId: jenius.id, goalId: efId, intent: 'move', overMinor: 15_000_000, toAccountId: parent.id },
    });
    await expect(toParent).rejects.toBeInstanceOf(SetAsideError);
    expect(await promised(efId, jenius.id)).toBe(30_000_000);
    expect(await draws()).toEqual([]);
  });
});

describe('the shortage lands in funding order, compulsory goals funded first (health-ratios merge ruling)', () => {
  it('shorts a holiday ranked above the emergency fund, not the fund', async () => {
    const { reorderGoals, setAsideView } = await import('../src/index');
    const holiday = await saveGoal(database, ws, { name: 'Bali', kind: 'holiday', growthBps: 0, returnBps: 0, stages: [{ name: 'Bali', targetMinor: 5_000_000, targetMonths: null, dueOn: '2027-06-30' }] });
    // A legacy order: the holiday first, the fund after it. Raw rank would short the fund.
    await reorderGoals(database, ws, [holiday, efId, umrahId]);
    const mandiri = await createAccount(database, ws, { name: 'Mandiri', kind: 'asset', subtype: 'bank', currency: 'IDR', openingBalanceMinor: 6_000_000, openedOn: '2026-01-01' });
    await saveEarmark(database, ws, { goalId: holiday, accountId: mandiri.id, amountMinor: 3_000_000 });
    await saveEarmark(database, ws, { goalId: efId, accountId: mandiri.id, amountMinor: 3_000_000 });
    await expenseFrom(mandiri, 2_000_000);
    const view = (await setAsideView(database, ws, mandiri.id))!;
    expect(view.shortMinor).toBe(2_000_000);
    const byGoal = Object.fromEntries(view.goals.map((goal) => [goal.goalId, goal.shortMinor]));
    expect(byGoal[holiday]).toBe(2_000_000);
    expect(byGoal[efId]).toBe(0);
  });
});

describe('a stage money was drawn against cannot be removed by hand (health-ratios M4, on goal_draws)', () => {
  it('refuses the edit that drops the stage a "Yes" paid', async () => {
    await expenseFrom(jenius, 6_800_000, spend(umrahId, jenius));
    const { listGoals } = await import('../src/index');
    const umrah = (await listGoals(database, ws)).find((goal) => goal.id === umrahId)!;
    const [tickets, hotel] = umrah.stages;
    expect(tickets!.paidOn).toBe(DAY);
    await expect(
      saveGoal(database, ws, { id: umrahId, name: umrah.name, kind: 'umrah', growthBps: 0, returnBps: 0, stages: [{ id: hotel!.id, name: 'Hotel', targetMinor: 5_000_000, targetMonths: null, dueOn: '2027-04-30' }] }),
    ).rejects.toThrow(/Money was drawn against "Tickets"/);
  });
});
