import { describe, expect, it } from 'vitest';
import {
  cardStatementLines,
  createAccount,
  listTransactions,
  nativeBalances,
  pastMarkDefault,
  pastMarkFor,
  postTransaction,
  replaceTransaction,
  settledBeforeAppOf,
} from '../src/index';
import { setupDb } from './helpers';

/*
 * A card purchase dated before the card was added starts out paid off (owner, 22 Nov 2026): what the card owed when it
 * was added already holds it. The same date rule a money account's past purchase follows. Invented names and figures:
 * a card added on 1 November 2026 owing Rp 2.000.000.
 */
async function world() {
  const { database, ws } = await setupDb();
  const card = await createAccount(database, ws, { name: 'Kartu Contoh', kind: 'liability', subtype: 'credit_card', currency: 'IDR', openingBalanceMinor: 2_000_000, openedOn: '2026-11-01' });
  const bare = await createAccount(database, ws, { name: 'Kartu Kosong', kind: 'liability', subtype: 'credit_card', currency: 'IDR' });
  const wallet = await createAccount(database, ws, { name: 'Dompet Contoh', kind: 'asset', subtype: 'ewallet', currency: 'IDR', openingBalanceMinor: 300_000, openedOn: '2026-11-01' });
  const loan = await createAccount(database, ws, { name: 'Pinjaman Contoh', kind: 'liability', subtype: 'loan', currency: 'IDR', openingBalanceMinor: 900_000, openedOn: '2026-11-01' });
  const dining = await createAccount(database, ws, { name: 'Dining', kind: 'expense', subtype: 'category', currency: null });
  const lines = (accountId: string, amount: number) => [
    { accountId: dining.id, amountMinor: amount, currency: 'IDR' },
    { accountId, amountMinor: -amount, currency: 'IDR' },
  ];
  const owed = async (id = card.id) => 0 - ((await nativeBalances(database, ws))[id] ?? 0) || 0;
  /** A purchase posted the way every door now posts a new one: with the date's default mark. */
  const buy = async (accountId: string, amount: number, occurredOn: string, description = 'Warung Contoh') =>
    postTransaction(database, ws, { occurredOn, description, lines: lines(accountId, amount), ...(await pastMarkFor(database, ws, accountId, occurredOn)) });
  return { database, ws, card, bare, wallet, loan, dining, lines, owed, buy };
}

describe('pastMarkDefault', () => {
  const card = { kind: 'liability', subtype: 'credit_card' };
  const bank = { kind: 'asset', subtype: 'bank' };
  it('is a card’s paid off and a money account’s past purchase strictly before the day, nothing on or after it', () => {
    expect(pastMarkDefault(card, '2026-11-01', '2026-10-31')).toEqual({ settledBeforeApp: true });
    expect(pastMarkDefault(bank, '2026-11-01', '2026-10-31')).toEqual({ pastPurchase: true });
    expect(pastMarkDefault(card, '2026-11-01', '2026-11-01')).toEqual({});
    expect(pastMarkDefault(bank, '2026-11-01', '2026-11-02')).toEqual({});
  });
  it('is nothing for an account with no opening day, a loan, a holding, or no account', () => {
    expect(pastMarkDefault(card, null, '2026-10-31')).toEqual({});
    expect(pastMarkDefault({ kind: 'liability', subtype: 'loan' }, '2026-11-01', '2026-10-31')).toEqual({});
    expect(pastMarkDefault({ kind: 'asset', subtype: 'investment' }, '2026-11-01', '2026-10-31')).toEqual({});
    expect(pastMarkDefault(undefined, '2026-11-01', '2026-10-31')).toEqual({});
  });
});

describe('a card purchase dated before the card was added', () => {
  it('posted with the default is paid off: the card owes what it did, and the spending stands in its month', async () => {
    const t = await world();
    const old = await t.buy(t.card.id, 450_000, '2026-10-20', 'Old dinner');
    expect(await t.owed()).toBe(2_000_000);
    expect(await settledBeforeAppOf(t.database, t.ws, old)).toBe(true);
    const posted = await listTransactions(t.database, t.ws, { from: '2026-10-01', to: '2026-10-31' });
    expect(posted.find((tx) => tx.id === old)!.entries.find((e) => e.accountId === t.dining.id)!.amountMinor).toBe(450_000);
    // The statement reads it Paid off, and nothing is left owed on it.
    const line = (await cardStatementLines(t.database, t.ws, t.card.id)).find((l) => l.transactionId === old)!;
    expect(line.paidOff).toBe(true);
  });

  it('on or after the day is owed as before', async () => {
    const t = await world();
    const onDay = await t.buy(t.card.id, 100_000, '2026-11-01');
    const after = await t.buy(t.card.id, 75_000, '2026-11-05');
    expect(await t.owed()).toBe(2_175_000);
    expect(await settledBeforeAppOf(t.database, t.ws, onDay)).toBe(false);
    expect(await settledBeforeAppOf(t.database, t.ws, after)).toBe(false);
  });

  it('counts money back the same way: an old refund leaves the card as it was', async () => {
    const t = await world();
    const refund = await postTransaction(t.database, t.ws, {
      occurredOn: '2026-10-25',
      description: 'Old refund',
      lines: t.lines(t.card.id, -60_000),
      ...(await pastMarkFor(t.database, t.ws, t.card.id, '2026-10-25')),
    });
    expect(await t.owed()).toBe(2_000_000);
    expect(await settledBeforeAppOf(t.database, t.ws, refund)).toBe(true);
  });

  it('a card added at nothing counts from the day it was added: anything older is paid off', async () => {
    const t = await world();
    const addedOn = t.bare.createdAt.slice(0, 10);
    const dayBefore = new Date(Date.parse(`${addedOn}T00:00:00Z`) - 86_400_000).toISOString().slice(0, 10);
    await t.buy(t.bare.id, 80_000, dayBefore);
    expect(await t.owed(t.bare.id)).toBe(0);
    await t.buy(t.bare.id, 30_000, addedOn);
    expect(await t.owed(t.bare.id)).toBe(30_000);
  });

  it('the money account and the loan follow their own rules: a past purchase, and no mark', async () => {
    const t = await world();
    expect(await pastMarkFor(t.database, t.ws, t.wallet.id, '2026-10-20')).toEqual({ pastPurchase: true });
    expect(await pastMarkFor(t.database, t.ws, t.loan.id, '2026-10-20')).toEqual({});
    await t.buy(t.wallet.id, 40_000, '2026-10-20');
    expect((await nativeBalances(t.database, t.ws))[t.wallet.id]).toBe(300_000);
  });

  it('is only a default: a purchase posted without it is owed, and an edit keeps whatever mark it was saved with', async () => {
    const t = await world();
    const owedOne = await postTransaction(t.database, t.ws, { occurredOn: '2026-10-20', description: 'Kept owed', lines: t.lines(t.card.id, 50_000) });
    expect(await t.owed()).toBe(2_050_000);
    // A new note changes nothing either way: the edit names no mark, so the saved one follows.
    await replaceTransaction(t.database, t.ws, owedOne, { occurredOn: '2026-10-20', description: 'Kept owed, renamed', lines: t.lines(t.card.id, 50_000) });
    expect(await t.owed()).toBe(2_050_000);
    const paid = await t.buy(t.card.id, 20_000, '2026-10-21');
    await replaceTransaction(t.database, t.ws, paid, { occurredOn: '2026-10-21', description: 'Renamed', lines: t.lines(t.card.id, 20_000) });
    expect(await t.owed()).toBe(2_050_000);
  });

  it('the settlement beside it never moves the card’s opening day', async () => {
    const t = await world();
    await t.buy(t.card.id, 450_000, '2026-10-20');
    expect(await pastMarkFor(t.database, t.ws, t.card.id, '2026-10-31')).toEqual({ settledBeforeApp: true });
    expect(await pastMarkFor(t.database, t.ws, t.card.id, '2026-11-01')).toEqual({});
  });
});
