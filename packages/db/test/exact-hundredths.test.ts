import { computeCycleEarn, expenseLines, incomeLines } from '@expanses/core';
import { sql } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import {
  cardSpendLines,
  createAccount,
  createDatabase,
  createProgram,
  createWorkspace,
  LedgerError,
  listAccounts,
  listEarnRules,
  listTransactions,
  migrate,
  MIGRATIONS,
  postTransaction,
  replaceTransaction,
  saveEarnRule,
} from '../src/index';
import { createNodeExecutor } from '../src/node';
import { setupDb } from './helpers';

/* A rupiah amount typed with cents (0068): the ledger keeps the whole figure, the exact one is stored beside it. */

async function setup() {
  const t = await setupDb();
  const bank = (await createAccount(t.database, t.ws, { name: 'Bank', kind: 'asset', subtype: 'bank', currency: 'IDR' })).id;
  const all = await listAccounts(t.database, t.ws);
  const groceries = all.find((a) => a.name === 'Groceries')!.id;
  const salary = all.find((a) => a.kind === 'income')!.id;
  const spend = (amountMinor: number) => expenseLines({ categoryAccountId: groceries, paymentAccountId: bank, amountMinor, currency: 'IDR' });
  const view = async (id: string) => (await listTransactions(t.database, t.ws, { id, includeVoid: true }))[0]!;
  const stored = async (id: string) => (await t.database.db.values<[number | null]>(sql`SELECT exact_hundredths FROM transactions WHERE id = ${id}`))[0]![0];
  return { ...t, bank, groceries, salary, spend, view, stored };
}

describe('the exact figure of a purchase typed with cents', () => {
  it('is stored beside the whole amount and read back on the transaction', async () => {
    const { database, ws, spend, view, stored } = await setup();
    const id = await postTransaction(database, ws, { occurredOn: '2026-10-14', description: 'Coffee', lines: spend(12_501), exactHundredths: 1_250_030 });
    expect(await stored(id)).toBe(1_250_030);
    const tx = await view(id);
    expect(tx.exactHundredths).toBe(1_250_030);
    expect(tx.entries.map((e) => e.amountMinor)).toEqual([12_501, -12_501]);
  });

  it('is null for a whole amount, and for a figure whose cents are zero', async () => {
    const { database, ws, spend, view, stored } = await setup();
    const whole = await postTransaction(database, ws, { occurredOn: '2026-10-14', description: 'Whole', lines: spend(12_500) });
    expect((await view(whole)).exactHundredths).toBeNull();
    const zeroCents = await postTransaction(database, ws, { occurredOn: '2026-10-14', description: 'Zero cents', lines: spend(12_500), exactHundredths: 1_250_000 });
    expect(await stored(zeroCents)).toBeNull();
  });

  it('refuses a figure that is not a positive whole number of hundredths, or does not round to the amount', async () => {
    const { database, ws, spend } = await setup();
    for (const exactHundredths of [-1_250_030, 0, 12.5, Number.NaN]) {
      await expect(postTransaction(database, ws, { occurredOn: '2026-10-14', description: 'Bad', lines: spend(12_501), exactHundredths })).rejects.toMatchObject({
        name: 'LedgerError',
        code: 'INVALID_EXACT',
      });
    }
    await expect(postTransaction(database, ws, { occurredOn: '2026-10-14', description: 'Far', lines: spend(13_000), exactHundredths: 1_250_030 })).rejects.toBeInstanceOf(LedgerError);
    expect(await listTransactions(database, ws)).toEqual([]);
  });

  it('takes the rounded-down figure for money in', async () => {
    const { database, ws, bank, salary, view } = await setup();
    const id = await postTransaction(database, ws, {
      occurredOn: '2026-10-14',
      description: 'Interest',
      lines: incomeLines({ incomeAccountId: salary, depositAccountId: bank, amountMinor: 12_345, currency: 'IDR' }),
      exactHundredths: 1_234_567,
    });
    expect((await view(id)).exactHundredths).toBe(1_234_567);
  });
});

describe('editing a purchase with an exact figure', () => {
  it('keeps it when the amount does not change', async () => {
    const { database, ws, spend, view } = await setup();
    const id = await postTransaction(database, ws, { occurredOn: '2026-10-14', description: 'Coffee', lines: spend(12_501), exactHundredths: 1_250_030 });
    const edited = await replaceTransaction(database, ws, id, { occurredOn: '2026-10-15', description: 'Coffee and cake', lines: spend(12_501) });
    expect((await view(edited)).exactHundredths).toBe(1_250_030);
  });

  it('clears it when the amount changes and the edit says nothing of it', async () => {
    const { database, ws, spend, view } = await setup();
    const id = await postTransaction(database, ws, { occurredOn: '2026-10-14', description: 'Coffee', lines: spend(12_501), exactHundredths: 1_250_030 });
    const edited = await replaceTransaction(database, ws, id, { occurredOn: '2026-10-14', description: 'Coffee', lines: spend(13_000) });
    expect((await view(edited)).exactHundredths).toBeNull();
  });

  it('replaces it with the figure the edit gives, and clears it on an explicit null', async () => {
    const { database, ws, spend, view } = await setup();
    const id = await postTransaction(database, ws, { occurredOn: '2026-10-14', description: 'Coffee', lines: spend(12_501), exactHundredths: 1_250_030 });
    const changed = await replaceTransaction(database, ws, id, { occurredOn: '2026-10-14', description: 'Coffee', lines: spend(12_502), exactHundredths: 1_250_110 });
    expect((await view(changed)).exactHundredths).toBe(1_250_110);
    const cleared = await replaceTransaction(database, ws, changed, { occurredOn: '2026-10-14', description: 'Coffee', lines: spend(12_502), exactHundredths: null });
    expect((await view(cleared)).exactHundredths).toBeNull();
  });
});

describe('a database stopped before 0068', () => {
  it('still posts, edits and lists, with no exact figure', async () => {
    const executor = createNodeExecutor();
    const database = createDatabase(executor);
    try {
      await migrate(database, MIGRATIONS.filter((m) => m.version < 68));
      const ws = await createWorkspace(database, { name: 'Personal', type: 'personal', baseCurrency: 'IDR' });
      const bank = (await createAccount(database, ws, { name: 'Bank', kind: 'asset', subtype: 'bank', currency: 'IDR' })).id;
      const groceries = (await listAccounts(database, ws)).find((a) => a.name === 'Groceries')!.id;
      const lines = expenseLines({ categoryAccountId: groceries, paymentAccountId: bank, amountMinor: 12_501, currency: 'IDR' });
      const id = await postTransaction(database, ws, { occurredOn: '2026-10-14', description: 'Coffee', lines, exactHundredths: 1_250_030 });
      const edited = await replaceTransaction(database, ws, id, { occurredOn: '2026-10-14', description: 'Coffee', lines });
      const [tx] = await listTransactions(database, ws);
      expect(tx!.id).toBe(edited);
      expect(tx!.exactHundredths).toBeNull();
    } finally {
      executor.close();
    }
  });
});

describe('card points on a purchase typed with cents', () => {
  async function card() {
    const t = await setupDb();
    const { database, ws } = t;
    const cardAccount = await createAccount(database, ws, { name: 'BCA Card', kind: 'liability', subtype: 'credit_card', currency: 'IDR' });
    const program = await createProgram(database, ws, { cardAccountId: cardAccount.id, name: 'BCA Points', unit: 'points', cycleAnchor: 'statement' });
    await saveEarnRule(database, ws, program.id, {
      name: 'Base', priority: 0, stackable: false, match: {}, rateNum: 1, rateDen: 2_500,
      rounding: 'per_transaction_floor', capSpendMinor: null, capPoints: null, minTransactionMinor: null, validFrom: null, validTo: null,
    });
    const groceries = (await listAccounts(database, ws)).find((a) => a.name === 'Groceries')!.id;
    const lines = (amountMinor: number) => expenseLines({ categoryAccountId: groceries, paymentAccountId: cardAccount.id, amountMinor, currency: 'IDR' });
    const earned = async () => {
      const spend = await cardSpendLines(database, ws, cardAccount.id, '2026-10-01', '2026-10-31');
      const rules = await listEarnRules(database, ws, program.id);
      return { spend, earn: computeCycleEarn(spend, rules, {}) };
    };
    return { ...t, cardAccount, lines, earned };
  }

  it('are worked out on the exact figure rounded down, while the card is charged the figure rounded up', async () => {
    const { database, ws, cardAccount, lines, earned } = await card();
    // 2.499,70 is charged 2.500, which would earn a point at 1 per 2.500; the bank counts 2.499 and gives none.
    const id = await postTransaction(database, ws, { occurredOn: '2026-10-14', description: 'Bakery', lines: lines(2_500), exactHundredths: 249_970 });
    const { spend, earn } = await earned();
    expect(spend.map((l) => l.amountMinor)).toEqual([2_499]);
    expect(earn.pointsByTransaction[id] ?? 0).toBe(0);
    const charged = (await listTransactions(database, ws, { id }))[0]!.entries.find((e) => e.accountId === cardAccount.id)!;
    expect(charged.amountMinor).toBe(-2_500);
  });

  it('a whole purchase still earns on its whole figure', async () => {
    const { database, ws, lines, earned } = await card();
    const id = await postTransaction(database, ws, { occurredOn: '2026-10-14', description: 'Bakery', lines: lines(2_500) });
    expect((await earned()).earn.pointsByTransaction[id]).toBe(1);
  });

  it('a refund typed with the same cents takes back what the purchase earned, by the same rounding down', async () => {
    const { database, ws, lines, earned } = await card();
    const bought = await postTransaction(database, ws, { occurredOn: '2026-10-14', description: 'Shoes', lines: lines(12_501), exactHundredths: 1_250_030 });
    const refunded = await postTransaction(database, ws, { occurredOn: '2026-10-15', description: 'Shoes refund', lines: lines(-12_501), exactHundredths: 1_250_030 });
    const { spend, earn } = await earned();
    expect(spend.map((l) => l.amountMinor)).toEqual([12_500, -12_500]);
    expect(earn.pointsByTransaction[bought]).toBe(5);
    expect(earn.pointsByTransaction[refunded]).toBe(-5);
  });
});
