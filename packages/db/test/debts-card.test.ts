import { beforeEach, describe, expect, it } from 'vitest';
import {
  type AccountRow,
  cardSpendLines,
  categoryIdsByKey,
  createAccount,
  type Database,
  listTransactions,
  nativeBalances,
  recordLoan,
  type WorkspaceContext,
} from '../src/index';
import { setupDb } from './helpers';

const YEAR = { from: '2026-01-01', to: '2026-12-31' };

let database: Database;
let ws: WorkspaceContext;
let card: AccountRow;
let bca: AccountRow;
let categories: Record<string, string>;

beforeEach(async () => {
  ({ database, ws } = await setupDb());
  bca = await createAccount(database, ws, { name: 'BCA Tahapan', kind: 'asset', subtype: 'bank', currency: 'IDR', openingBalanceMinor: 50_000_000, openedOn: '2026-01-01' });
  card = await createAccount(database, ws, { name: 'BCA KrisFlyer', kind: 'liability', subtype: 'credit_card', currency: 'IDR' });
  categories = await categoryIdsByKey(database, ws);
});

const lendOnCard = (amountMinor: number, spendCategoryId: string | null, mcc: string | null) =>
  recordLoan(database, ws, {
    person: { name: 'Andi', direction: 'lent', currency: 'IDR' },
    occurredOn: '2026-09-05',
    amountMinor,
    moneyAccountId: card.id,
    spendCategoryId,
    mcc,
  });

describe('lending money put on a credit card', () => {
  it('raises what the card owes, and leaves the bank alone', async () => {
    const { debtAccountId } = await lendOnCard(4_000_000, categories['shopping']!, '5311');

    const balances = await nativeBalances(database, ws, '2026-12-31');
    // The card is a liability, so what is owed shows as a credit.
    expect(balances[card.id]).toBe(-4_000_000);
    expect(balances[debtAccountId]).toBe(4_000_000);
    expect(balances[bca.id]).toBe(50_000_000);
  });

  it('writes the purchase category and the MCC on the card line', async () => {
    await lendOnCard(4_000_000, categories['shopping']!, '5311');

    const tx = (await listTransactions(database, ws, {}))[0]!;
    const cardLine = tx.entries.find((entry) => entry.accountId === card.id)!;
    expect(cardLine.spendCategoryId).toBe(categories['shopping']);
    expect(tx.mcc).toBe('5311');
  });

  it('counts as card spend, so the points still come', async () => {
    await lendOnCard(4_000_000, categories['shopping']!, '5311');

    const lines = await cardSpendLines(database, ws, card.id, YEAR.from, YEAR.to);
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatchObject({ amountMinor: 4_000_000, categoryId: categories['shopping'], mcc: '5311' });
  });

  it('counts nothing as card spend when no category was given', async () => {
    await lendOnCard(4_000_000, null, null);

    await expect(cardSpendLines(database, ws, card.id, YEAR.from, YEAR.to)).resolves.toEqual([]);
  });

  it('never counts the loan as spending', async () => {
    await lendOnCard(4_000_000, categories['shopping']!, '5311');

    const tx = (await listTransactions(database, ws, {}))[0]!;
    // Only the receivable and the card: no expense category is touched.
    expect(tx.entries.every((entry) => entry.accountKind !== 'expense')).toBe(true);
  });

  it('lends from a bank account without any card fields', async () => {
    const { debtAccountId } = await recordLoan(database, ws, {
      person: { name: 'Andi', direction: 'lent', currency: 'IDR' },
      occurredOn: '2026-09-05',
      amountMinor: 4_000_000,
      moneyAccountId: bca.id,
    });

    const balances = await nativeBalances(database, ws, '2026-12-31');
    expect(balances[bca.id]).toBe(46_000_000);
    expect(balances[debtAccountId]).toBe(4_000_000);
  });
});
