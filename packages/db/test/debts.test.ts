import { beforeEach, describe, expect, it } from 'vitest';
import {
  type AccountRow,
  categoryIdsByKey,
  createAccount,
  createDatabase,
  createWorkspace,
  type Database,
  DebtDbError,
  getDebtProfile,
  listDebtProfiles,
  forgiveRemainder,
  goalLinksFor,
  listTransactions,
  migrate,
  MIGRATIONS,
  nativeBalances,
  recordLoan,
  recordRepayment,
  saveDebtProfile,
  saveGoal,
  splitBill,
  type WorkspaceContext,
} from '../src/index';
import { createNodeExecutor } from '../src/node';
import { setupDb } from './helpers';

let database: Database;
let ws: WorkspaceContext;
let andi: AccountRow;
let budi: AccountRow;
let bca: AccountRow;

beforeEach(async () => {
  ({ database, ws } = await setupDb());
  bca = await createAccount(database, ws, { name: 'BCA Tahapan', kind: 'asset', subtype: 'bank', currency: 'IDR', openingBalanceMinor: 50_000_000, openedOn: '2026-01-01' });
  andi = await createAccount(database, ws, { name: 'Andi', kind: 'asset', subtype: 'receivable', currency: 'IDR' });
  budi = await createAccount(database, ws, { name: 'Budi', kind: 'liability', subtype: 'payable', currency: 'IDR' });
});

describe('migration 0010', () => {
  it('applies on a database already populated through version 9', async () => {
    const older = createDatabase(createNodeExecutor());
    await migrate(older, MIGRATIONS.filter((migration) => migration.version <= 9));
    const olderWs = await createWorkspace(older, { name: 'Personal', type: 'personal', baseCurrency: 'IDR' });
    // No opening balance: the ORM always describes the newest columns, and a v9 database has none of 0010's.
    const person = await createAccount(older, olderWs, { name: 'Andi', kind: 'asset', subtype: 'receivable', currency: 'IDR' });

    await migrate(older);

    await saveDebtProfile(older, olderWs, { accountId: person.id, personName: 'Andi' });
    await expect(getDebtProfile(older, olderWs, person.id)).resolves.toMatchObject({ personName: 'Andi' });
  });
});

describe('debt profiles', () => {
  it('keeps who the person is and why they owe it', async () => {
    await saveDebtProfile(database, ws, { accountId: andi.id, personName: 'Andi', reason: 'Motorcycle repair', dueOn: '2026-12-31', personIdNumber: '3174010101900001' });

    await expect(getDebtProfile(database, ws, andi.id)).resolves.toMatchObject({
      personName: 'Andi',
      reason: 'Motorcycle repair',
      dueOn: '2026-12-31',
      personIdNumber: '3174010101900001',
      status: 'open',
      direction: 'lent',
    });
  });

  it('reads the direction from the account, so a payable is money you owe', async () => {
    await saveDebtProfile(database, ws, { accountId: budi.id, personName: 'Budi' });

    await expect(getDebtProfile(database, ws, budi.id)).resolves.toMatchObject({ direction: 'borrowed' });
  });

  it('gives each direction its own Coretax code', async () => {
    await saveDebtProfile(database, ws, { accountId: andi.id, personName: 'Andi' });
    await saveDebtProfile(database, ws, { accountId: budi.id, personName: 'Budi' });

    await expect(getDebtProfile(database, ws, andi.id)).resolves.toMatchObject({ coretaxCode: '021' });
    await expect(getDebtProfile(database, ws, budi.id)).resolves.toMatchObject({ coretaxCode: '104' });
  });

  it('keeps a related-party code when one is given', async () => {
    await saveDebtProfile(database, ws, { accountId: andi.id, personName: 'Andi', coretaxCode: '022' });

    await expect(getDebtProfile(database, ws, andi.id)).resolves.toMatchObject({ coretaxCode: '022' });
  });

  it('saves again in place instead of adding a second profile', async () => {
    await saveDebtProfile(database, ws, { accountId: andi.id, personName: 'Andi', reason: 'Motorcycle repair' });
    await saveDebtProfile(database, ws, { accountId: andi.id, personName: 'Andi Pratama', reason: 'Motorcycle repair', dueOn: '2027-01-31' });

    const profiles = await listDebtProfiles(database, ws);
    expect(profiles).toHaveLength(1);
    expect(profiles[0]).toMatchObject({ personName: 'Andi Pratama', dueOn: '2027-01-31' });
  });

  it('refuses an account that is not a receivable or a payable', async () => {
    await expect(saveDebtProfile(database, ws, { accountId: bca.id, personName: 'Andi' })).rejects.toThrow(DebtDbError);
    await expect(saveDebtProfile(database, ws, { accountId: bca.id, personName: 'Andi' })).rejects.toThrow(/lent to or borrowed from a person/);
  });

  it('refuses an account from another workspace', async () => {
    const other = await createWorkspace(database, { name: 'Other', type: 'personal', baseCurrency: 'IDR' });

    await expect(saveDebtProfile(database, other, { accountId: andi.id, personName: 'Andi' })).rejects.toThrow(/not found in this workspace/);
  });

  it('refuses a person with no name', async () => {
    await expect(saveDebtProfile(database, ws, { accountId: andi.id, personName: '  ' })).rejects.toThrow(/needs a name/);
  });

  it('lists nothing for a workspace with no debts', async () => {
    await expect(listDebtProfiles(database, ws)).resolves.toEqual([]);
  });
});

const balanceOf = async (accountId: string) => (await nativeBalances(database, ws, '2026-12-31'))[accountId] ?? 0;

const lend = (amountMinor: number, occurredOn = '2026-09-05', name = 'Andi') =>
  recordLoan(database, ws, { person: { name, direction: 'lent', currency: 'IDR' }, occurredOn, amountMinor, moneyAccountId: bca.id });

describe('recording a loan', () => {
  it('opens the person account and moves the money', async () => {
    const { debtAccountId } = await lend(10_000_000);

    expect(await balanceOf(debtAccountId)).toBe(10_000_000);
    expect(await balanceOf(bca.id)).toBe(40_000_000);
    await expect(getDebtProfile(database, ws, debtAccountId)).resolves.toMatchObject({ personName: 'Andi', direction: 'lent', status: 'open' });
  });

  it('lends again to a person already known, on the account they already have', async () => {
    const first = await lend(10_000_000);
    const second = await recordLoan(database, ws, { debtAccountId: first.debtAccountId, occurredOn: '2026-09-20', amountMinor: 2_000_000, moneyAccountId: bca.id });

    expect(second.debtAccountId).toBe(first.debtAccountId);
    expect(await balanceOf(first.debtAccountId)).toBe(12_000_000);
  });

  it('describes the transaction in the owner words', async () => {
    await lend(10_000_000);

    expect((await listTransactions(database, ws, {}))[0]!.description).toBe('Lent to Andi');
  });

  it('refuses a loan of nothing', async () => {
    await expect(lend(0)).rejects.toThrow(/greater than zero/);
  });
});

describe('a repayment', () => {
  it('lowers what is owed', async () => {
    const { debtAccountId } = await lend(10_000_000);

    const result = await recordRepayment(database, ws, { debtAccountId, occurredOn: '2026-10-05', amountMinor: 3_000_000, moneyAccountId: bca.id });

    expect(result.balanceMinor).toBe(7_000_000);
    expect(result.status).toBe('open');
    expect(await balanceOf(bca.id)).toBe(43_000_000);
  });

  it('settles the debt when nothing is left, with the date it happened', async () => {
    const { debtAccountId } = await lend(10_000_000);

    const result = await recordRepayment(database, ws, { debtAccountId, occurredOn: '2026-10-05', amountMinor: 10_000_000, moneyAccountId: bca.id });

    expect(result.status).toBe('settled');
    await expect(getDebtProfile(database, ws, debtAccountId)).resolves.toMatchObject({ status: 'settled', statusOn: '2026-10-05' });
  });

  it('reopens a settled person when they borrow again', async () => {
    const { debtAccountId } = await lend(10_000_000);
    await recordRepayment(database, ws, { debtAccountId, occurredOn: '2026-10-05', amountMinor: 10_000_000, moneyAccountId: bca.id });

    await recordLoan(database, ws, { debtAccountId, occurredOn: '2026-11-01', amountMinor: 2_000_000, moneyAccountId: bca.id });

    await expect(getDebtProfile(database, ws, debtAccountId)).resolves.toMatchObject({ status: 'open' });
  });

  it('puts interest under Other Income, leaving principal alone', async () => {
    const { debtAccountId } = await lend(10_000_000);

    await recordRepayment(database, ws, { debtAccountId, occurredOn: '2026-10-05', amountMinor: 3_000_000, interestMinor: 200_000, moneyAccountId: bca.id });

    const categories = await categoryIdsByKey(database, ws);
    expect(await balanceOf(debtAccountId)).toBe(7_000_000);
    expect(await balanceOf(bca.id)).toBe(43_200_000);
    expect(await balanceOf(categories['income.other']!)).toBe(-200_000);
  });

  it('refuses a repayment above the balance, and writes nothing', async () => {
    const { debtAccountId } = await lend(9_000_000);

    await expect(
      recordRepayment(database, ws, { debtAccountId, occurredOn: '2026-10-05', amountMinor: 12_000_000, moneyAccountId: bca.id }),
    ).rejects.toThrow(/Andi owes Rp\s?9\.000\.000/);
    expect(await balanceOf(debtAccountId)).toBe(9_000_000);
    expect(await balanceOf(bca.id)).toBe(41_000_000);
  });
});

describe('borrowing money', () => {
  const borrow = (amountMinor: number) =>
    recordLoan(database, ws, { person: { name: 'Budi', direction: 'borrowed', currency: 'IDR' }, occurredOn: '2026-09-05', amountMinor, moneyAccountId: bca.id });

  it('raises the payable and the bank together', async () => {
    const { debtAccountId } = await borrow(5_000_000);

    expect(await balanceOf(debtAccountId)).toBe(-5_000_000);
    expect(await balanceOf(bca.id)).toBe(55_000_000);
  });

  it('charges interest to Interest when paying it back', async () => {
    const { debtAccountId } = await borrow(5_000_000);

    await recordRepayment(database, ws, { debtAccountId, occurredOn: '2026-10-05', amountMinor: 2_000_000, interestMinor: 100_000, moneyAccountId: bca.id });

    const categories = await categoryIdsByKey(database, ws);
    expect(await balanceOf(debtAccountId)).toBe(-3_000_000);
    expect(await balanceOf(categories['fees.interest']!)).toBe(100_000);
    expect(await balanceOf(bca.id)).toBe(52_900_000);
  });

  it('refuses to repay more than is owed, naming the person', async () => {
    const { debtAccountId } = await borrow(5_000_000);

    await expect(
      recordRepayment(database, ws, { debtAccountId, occurredOn: '2026-10-05', amountMinor: 6_000_000, moneyAccountId: bca.id }),
    ).rejects.toThrow(/Budi is owed Rp\s?5\.000\.000/);
  });
});

describe('forgiving what is left', () => {
  it('empties the balance and marks it forgiven', async () => {
    const { debtAccountId } = await lend(10_000_000);
    await recordRepayment(database, ws, { debtAccountId, occurredOn: '2026-10-05', amountMinor: 6_000_000, moneyAccountId: bca.id });

    await forgiveRemainder(database, ws, { debtAccountId, occurredOn: '2026-11-01' });

    expect(await balanceOf(debtAccountId)).toBe(0);
    await expect(getDebtProfile(database, ws, debtAccountId)).resolves.toMatchObject({ status: 'forgiven', statusOn: '2026-11-01' });
  });

  it('books the forgiven amount as a gift', async () => {
    const { debtAccountId } = await lend(10_000_000);

    await forgiveRemainder(database, ws, { debtAccountId, occurredOn: '2026-11-01' });

    const categories = await categoryIdsByKey(database, ws);
    expect(await balanceOf(categories['gifts_donations']!)).toBe(10_000_000);
  });

  it('refuses to forgive a debt with nothing left', async () => {
    const { debtAccountId } = await lend(10_000_000);
    await recordRepayment(database, ws, { debtAccountId, occurredOn: '2026-10-05', amountMinor: 10_000_000, moneyAccountId: bca.id });

    await expect(forgiveRemainder(database, ws, { debtAccountId, occurredOn: '2026-11-01' })).rejects.toThrow(/greater than zero/);
  });
});

describe('splitting a bill', () => {
  it('charges your own share and opens a receivable for each friend', async () => {
    const categories = await categoryIdsByKey(database, ws);

    const { debtAccountIds } = await splitBill(database, ws, {
      occurredOn: '2026-09-05',
      description: 'Dinner at Plataran',
      totalMinor: 900_000,
      moneyAccountId: bca.id,
      ownCategoryId: categories['food.dining']!,
      ownShareMinor: 300_000,
      shares: [
        { person: { name: 'Andi', currency: 'IDR' }, amountMinor: 300_000 },
        { person: { name: 'Budi', currency: 'IDR' }, amountMinor: 300_000 },
      ],
    });

    expect(debtAccountIds).toHaveLength(2);
    expect(await balanceOf(categories['food.dining']!)).toBe(300_000);
    expect(await balanceOf(debtAccountIds[0]!)).toBe(300_000);
    expect(await balanceOf(debtAccountIds[1]!)).toBe(300_000);
    expect(await balanceOf(bca.id)).toBe(49_100_000);
  });

  it('refuses a split that does not add up to the bill', async () => {
    const categories = await categoryIdsByKey(database, ws);

    await expect(
      splitBill(database, ws, {
        occurredOn: '2026-09-05',
        description: 'Dinner',
        totalMinor: 900_000,
        moneyAccountId: bca.id,
        ownCategoryId: categories['food.dining']!,
        ownShareMinor: 200_000,
        shares: [{ person: { name: 'Andi', currency: 'IDR' }, amountMinor: 300_000 }],
      }),
    ).rejects.toThrow(/adds up to/);
  });
});

describe('goals', () => {
  it('are never funded by money a person owes you', async () => {
    await saveGoal(database, ws, {
      name: 'Hajj for two',
      kind: 'hajj',
      growthBps: 500,
      returnBps: 600,
      stages: [{ name: 'Setoran awal', targetMinor: 50_000_000, targetMonths: null, dueOn: '2027-06-30' }],
    });
    await lend(10_000_000);

    await expect(goalLinksFor(database, ws, '2026-12-31')).resolves.toEqual([]);
  });
});
