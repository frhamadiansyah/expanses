import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { exchangeLines, expenseLines, transferLines } from '@expanses/core';
import {
  type AccountRow,
  archiveGoal,
  createAccount,
  createDatabase,
  createWorkspace,
  type Database,
  goalsSchema,
  listEarmarks,
  listGoals,
  migrate,
  MIGRATIONS,
  nativeBalances,
  postTransaction,
  replaceTransaction,
  saveEarmark,
  saveGoal,
  type SetAsideChoice,
  setStagePaid,
  systemAccountId,
  voidTransaction,
  type WorkspaceContext,
} from '../src/index';
import { createNodeExecutor, type NodeExecutor } from '../src/node';
import { setupDb } from './helpers';

const DAY = '2026-09-19';
let database: Database;
let ws: WorkspaceContext;
let jenius: AccountRow;
let bca: AccountRow;
let wise: AccountRow;
let card: AccountRow;
let electronics: AccountRow;
let efId: string;
let umrahId: string;

beforeEach(async () => {
  ({ database, ws } = await setupDb());
  jenius = await createAccount(database, ws, { name: 'Jenius', kind: 'asset', subtype: 'savings', currency: 'IDR', openingBalanceMinor: 42_500_000, openedOn: '2026-01-01' });
  bca = await createAccount(database, ws, { name: 'BCA', kind: 'asset', subtype: 'bank', currency: 'IDR', openingBalanceMinor: 1_000_000, openedOn: '2026-01-01' });
  wise = await createAccount(database, ws, { name: 'Wise USD', kind: 'asset', subtype: 'bank', currency: 'USD' });
  card = await createAccount(database, ws, { name: 'BCA Visa', kind: 'liability', subtype: 'credit_card', currency: 'IDR' });
  electronics = await createAccount(database, ws, { name: 'Electronics', kind: 'expense', subtype: 'category', currency: null });
  // kind 'emergency' is what makes it a standing level (ledger Ruling Q3); a fixed target keeps the figures exact.
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
const stages = async (goalId: string) => (await listGoals(database, ws)).find((goal) => goal.id === goalId)!.stages;
const laptop = (amountMinor: number, setAside?: SetAsideChoice | null, from = jenius.id) =>
  postTransaction(database, ws, {
    occurredOn: DAY,
    description: 'Laptop',
    lines: expenseLines({ categoryAccountId: electronics.id, paymentAccountId: from, amountMinor, currency: 'IDR' }),
    setAside,
  });
const borrowEf = (overMinor: number): SetAsideChoice => ({ accountId: jenius.id, goalId: efId, intent: 'borrow', overMinor, wasWhole: true, wholeSince: '2026-08-03' });

describe('applying an answer', () => {
  it('writes a borrow and touches no promise', async () => {
    const id = await laptop(6_800_000, borrowEf(1_800_000));
    expect(await draws()).toEqual([
      expect.objectContaining({ transactionId: id, goalId: efId, accountId: jenius.id, intent: 'borrow', amountMinor: 1_800_000, wasWhole: 1, wholeSince: '2026-08-03', occurredOn: DAY }),
    ]);
    expect(await promised(efId, jenius.id)).toBe(30_000_000);
    expect(await promised(umrahId, jenius.id)).toBe(7_500_000);
    expect((await nativeBalances(database, ws))[jenius.id]).toBe(35_700_000);
  });

  it('borrows no more than left the account', async () => {
    await laptop(6_800_000, borrowEf(9_000_000));
    expect((await draws())[0]!.amountMinor).toBe(6_800_000);
  });

  it('spends the whole payment up to the promise, and pays the earliest unpaid stage', async () => {
    const id = await laptop(6_800_000, { accountId: jenius.id, goalId: umrahId, intent: 'spend', overMinor: 1_800_000 });
    // 7.500.000 − 6.800.000. Taking only the part over what was free would leave 5.700.000.
    expect(await promised(umrahId, jenius.id)).toBe(700_000);
    const [tickets, hotel] = await stages(umrahId);
    expect(tickets!.paidOn).toBe(DAY);
    expect(hotel!.paidOn).toBeNull();
    expect(await draws()).toEqual([expect.objectContaining({ transactionId: id, intent: 'spend', amountMinor: 6_800_000, stageId: tickets!.id })]);
  });

  it('empties a promise a spend is larger than', async () => {
    await laptop(9_000_000, { accountId: jenius.id, goalId: umrahId, intent: 'spend', overMinor: 4_000_000 });
    expect((await listEarmarks(database, ws)).some((row) => row.goalId === umrahId)).toBe(false);
    expect((await draws())[0]!.amountMinor).toBe(7_500_000);
  });

  it('pays a one-stage goal off, so it reads done', async () => {
    const car = await saveGoal(database, ws, { name: 'Car deposit', kind: 'vehicle', growthBps: 0, returnBps: 0, stages: [{ name: 'Deposit', targetMinor: 2_000_000, targetMonths: null, dueOn: '2027-06-30' }] });
    await saveEarmark(database, ws, { goalId: car, accountId: jenius.id, amountMinor: 2_000_000 });
    await laptop(6_800_000, { accountId: jenius.id, goalId: car, intent: 'spend', overMinor: 3_800_000 });
    const [deposit] = await stages(car);
    expect(deposit!.paidOn).toBe(DAY);
    expect(await promised(car, jenius.id)).toBe(0);
  });

  it('draws the emergency fund down but never pays it off: it is a standing level, rebuilt after', async () => {
    const id = await laptop(6_800_000, { accountId: jenius.id, goalId: efId, intent: 'spend', overMinor: 1_800_000 });
    // 30.000.000 − 6.800.000: drawn down by the whole payment, exactly as any spend…
    expect(await promised(efId, jenius.id)).toBe(23_200_000);
    // …but its one stage stays open, so it never reads Done and asks to be topped back up to 30.000.000.
    expect((await stages(efId))[0]!.paidOn).toBeNull();
    expect(await draws()).toEqual([expect.objectContaining({ transactionId: id, intent: 'spend', amountMinor: 6_800_000, stageId: null })]);
    await voidTransaction(database, ws, id);
    expect(await promised(efId, jenius.id)).toBe(30_000_000);
  });

  it('moves the promise with a transfer', async () => {
    await postTransaction(database, ws, {
      occurredOn: DAY,
      description: 'To BCA',
      lines: transferLines({ fromAccountId: jenius.id, toAccountId: bca.id, amountMinor: 20_000_000, currency: 'IDR' }),
      setAside: { accountId: jenius.id, goalId: efId, intent: 'move', overMinor: 15_000_000, toAccountId: bca.id },
    });
    expect(await promised(efId, jenius.id)).toBe(15_000_000);
    expect(await promised(efId, bca.id)).toBe(15_000_000);
    expect((await draws())[0]).toMatchObject({ intent: 'move', amountMinor: 15_000_000, toAccountId: bca.id, toAmountMinor: 15_000_000 });
  });

  it('moves a promise across currencies at the transfer\'s own rate, floored', async () => {
    const lines = exchangeLines({
      fromAccountId: jenius.id,
      fromAmountMinor: 20_000_000,
      fromCurrency: 'IDR',
      toAccountId: wise.id,
      toAmountMinor: 123_463,
      toCurrency: 'USD',
      exchangeAccountId: await systemAccountId(database.db, ws, 'currency_exchange'),
    });
    await postTransaction(database, ws, {
      occurredOn: DAY,
      description: 'To Wise',
      lines,
      ratesToBase: { USD: 16_200 },
      setAside: { accountId: jenius.id, goalId: efId, intent: 'move', overMinor: 1_800_000, toAccountId: wise.id },
    });
    // 1.800.000 × 123.463 ÷ 20.000.000 = 11.111,67 cents: floored, never rounded to 11.112.
    expect(await promised(efId, wise.id)).toBe(11_111);
    expect(await promised(efId, jenius.id)).toBe(28_200_000);
  });
});

describe('refusing an answer, with nothing written', () => {
  const cases: [string, () => Promise<unknown>, RegExp][] = [
    ['an account the posting does not pay from', () => laptop(6_800_000, { ...borrowEf(1_800_000), accountId: bca.id }), /not in the account this pays from/],
    ['an archived goal', async () => { await archiveGoal(database, ws, efId); return laptop(6_800_000, borrowEf(1_800_000)); }, /not a goal/],
    ['a goal that promises nothing there', async () => {
      const other = await saveGoal(database, ws, { name: 'Car', kind: 'vehicle', growthBps: 0, returnBps: 0, stages: [{ name: 'Car', targetMinor: 1, targetMonths: null, dueOn: '2030-01-01' }] });
      return laptop(6_800_000, { ...borrowEf(1_800_000), goalId: other });
    }, /Nothing is set aside/],
    ['a move to an account the money did not reach', () =>
      postTransaction(database, ws, { occurredOn: DAY, description: 'x', lines: transferLines({ fromAccountId: jenius.id, toAccountId: bca.id, amountMinor: 20_000_000, currency: 'IDR' }), setAside: { accountId: jenius.id, goalId: efId, intent: 'move', overMinor: 1, toAccountId: wise.id } }), /only follow the money/],
    ['a move to a card', () =>
      postTransaction(database, ws, { occurredOn: DAY, description: 'x', lines: transferLines({ fromAccountId: jenius.id, toAccountId: card.id, amountMinor: 20_000_000, currency: 'IDR' }), setAside: { accountId: jenius.id, goalId: efId, intent: 'move', overMinor: 1, toAccountId: card.id } }), /cannot hold/],
    ['another workspace\'s goal', async () => {
      const other = await createWorkspace(database, { name: 'Shared', type: 'shared', baseCurrency: 'IDR' });
      const theirs = await saveGoal(database, other, { name: 'Theirs', kind: 'other', growthBps: 0, returnBps: 0, stages: [{ name: 'x', targetMinor: 1, targetMonths: null, dueOn: '2030-01-01' }] });
      return laptop(6_800_000, { ...borrowEf(1_800_000), goalId: theirs });
    }, /not a goal/],
  ];
  it.each(cases)('refuses %s', async (_name, run, message) => {
    await expect(run()).rejects.toThrow(message);
    expect((await nativeBalances(database, ws))[jenius.id]).toBe(42_500_000);
    expect(await draws()).toEqual([]);
  });
});

describe('voiding and editing', () => {
  it('gives a spend back and un-pays the stage it paid', async () => {
    const id = await laptop(6_800_000, { accountId: jenius.id, goalId: umrahId, intent: 'spend', overMinor: 1_800_000 });
    await voidTransaction(database, ws, id);
    expect(await promised(umrahId, jenius.id)).toBe(7_500_000);
    expect((await stages(umrahId))[0]!.paidOn).toBeNull();
    expect(await draws()).toEqual([]);
  });

  it('leaves a stage the owner re-dated by hand alone', async () => {
    const id = await laptop(6_800_000, { accountId: jenius.id, goalId: umrahId, intent: 'spend', overMinor: 1_800_000 });
    await setStagePaid(database, ws, (await stages(umrahId))[0]!.id, '2026-09-20');
    await voidTransaction(database, ws, id);
    expect((await stages(umrahId))[0]!.paidOn).toBe('2026-09-20');
  });

  it('puts both promises back when a move is voided', async () => {
    const id = await postTransaction(database, ws, {
      occurredOn: DAY,
      description: 'To BCA',
      lines: transferLines({ fromAccountId: jenius.id, toAccountId: bca.id, amountMinor: 20_000_000, currency: 'IDR' }),
      setAside: { accountId: jenius.id, goalId: efId, intent: 'move', overMinor: 15_000_000, toAccountId: bca.id },
    });
    await voidTransaction(database, ws, id);
    expect(await promised(efId, jenius.id)).toBe(30_000_000);
    expect(await promised(efId, bca.id)).toBe(0);
  });

  it('carries a borrow onto an edit that does not mention it, clamped to the new payment', async () => {
    const id = await laptop(6_800_000, borrowEf(1_800_000));
    const replacement = await replaceTransaction(database, ws, id, {
      occurredOn: DAY,
      description: 'Laptop',
      lines: expenseLines({ categoryAccountId: electronics.id, paymentAccountId: jenius.id, amountMinor: 1_000_000, currency: 'IDR' }),
    });
    expect(await draws()).toEqual([expect.objectContaining({ transactionId: replacement, intent: 'borrow', amountMinor: 1_000_000, wasWhole: 1, wholeSince: '2026-08-03' })]);
  });

  it('clears it on null, obeys a new answer, and drops it when the edit pays from elsewhere', async () => {
    const lines = (from: string) => expenseLines({ categoryAccountId: electronics.id, paymentAccountId: from, amountMinor: 6_800_000, currency: 'IDR' });
    const first = await laptop(6_800_000, borrowEf(1_800_000));
    const cleared = await replaceTransaction(database, ws, first, { occurredOn: DAY, description: 'Laptop', lines: lines(jenius.id), setAside: null });
    expect(await draws()).toEqual([]);
    await replaceTransaction(database, ws, cleared, { occurredOn: DAY, description: 'Laptop', lines: lines(jenius.id), setAside: { ...borrowEf(1_800_000), goalId: umrahId } });
    expect((await draws())[0]).toMatchObject({ goalId: umrahId });
    const [row] = await draws();
    await replaceTransaction(database, ws, row!.transactionId, { occurredOn: DAY, description: 'Laptop', lines: lines(bca.id) });
    expect(await draws()).toEqual([]);
  });
});

describe('an edit whose goal no longer promises anything there', () => {
  it('drops a carried borrow from an archived goal instead of refusing the edit', async () => {
    const id = await laptop(6_800_000, borrowEf(1_800_000));
    await archiveGoal(database, ws, efId);
    const replacement = await replaceTransaction(database, ws, id, {
      occurredOn: DAY,
      description: 'Laptop',
      lines: expenseLines({ categoryAccountId: electronics.id, paymentAccountId: jenius.id, amountMinor: 6_000_000, currency: 'IDR' }),
    });
    expect(await draws()).toEqual([]);
    expect((await nativeBalances(database, ws))[jenius.id]).toBe(36_500_000);
    expect(replacement).not.toBe(id);
  });

  it('still refuses a new answer naming that goal', async () => {
    const id = await laptop(6_800_000);
    await archiveGoal(database, ws, efId);
    await expect(
      replaceTransaction(database, ws, id, {
        occurredOn: DAY,
        description: 'Laptop',
        lines: expenseLines({ categoryAccountId: electronics.id, paymentAccountId: jenius.id, amountMinor: 6_800_000, currency: 'IDR' }),
        setAside: borrowEf(1_800_000),
      }),
    ).rejects.toThrow(/not a goal/);
  });
});

describe('a database stopped at 49', () => {
  let executor: NodeExecutor | undefined;
  afterEach(() => executor?.close());

  it('posts exactly as before and ignores the answer', async () => {
    executor = createNodeExecutor();
    const older = createDatabase(executor);
    await migrate(older, MIGRATIONS.filter((m) => m.version <= 49));
    const oldWs = await createWorkspace(older, { name: 'Personal', type: 'personal', baseCurrency: 'IDR' });
    const pot = await createAccount(older, oldWs, { name: 'Jenius', kind: 'asset', subtype: 'savings', currency: 'IDR', openingBalanceMinor: 10_000_000, openedOn: '2026-01-01' });
    const cat = await createAccount(older, oldWs, { name: 'Electronics', kind: 'expense', subtype: 'category', currency: null });
    const goal = await saveGoal(older, oldWs, { name: 'Umrah', kind: 'umrah', growthBps: 0, returnBps: 0, stages: [{ name: 'Tickets', targetMinor: 7_500_000, targetMonths: null, dueOn: '2027-03-31' }] });
    await saveEarmark(older, oldWs, { goalId: goal, accountId: pot.id, amountMinor: 7_500_000 });
    await postTransaction(older, oldWs, {
      occurredOn: DAY,
      description: 'Tickets',
      lines: expenseLines({ categoryAccountId: cat.id, paymentAccountId: pot.id, amountMinor: 6_000_000, currency: 'IDR' }),
      setAside: { accountId: pot.id, goalId: goal, intent: 'spend', overMinor: 3_500_000 },
    });
    expect((await listEarmarks(older, oldWs))[0]!.amountMinor).toBe(7_500_000);
    expect((await nativeBalances(older, oldWs))[pot.id]).toBe(4_000_000);
  });
});
