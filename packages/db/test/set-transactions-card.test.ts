import { expenseLines, statementCycleFor, transferLines } from '@expanses/core';
import { sql } from 'drizzle-orm';
import { afterEach, describe, expect, it } from 'vitest';
import {
  addCard,
  archiveCard,
  cardStatement,
  createAccount,
  createCardAccount,
  LedgerError,
  listAccounts,
  listTransactions,
  postTransaction,
  saveCardTerms,
  setTransactionsCard,
  voidTransaction,
} from '../src/index';
import { setupDb, type TestDb } from './helpers';

let current: TestDb | undefined;
afterEach(() => {
  current?.executor.close();
  current = undefined;
});

/** One card account with a primary and a supplementary card, a second card account, and a bank account. */
async function twoCards() {
  current = await setupDb();
  const { database, ws } = current;
  const card = await createCardAccount(database, ws, { name: 'Mandiri Visa', issuer: 'Mandiri', subtype: 'credit_card', currency: 'IDR', last4: '3051' });
  await saveCardTerms(database, ws, { accountId: card.id, statementDay: 20, dueDay: 5, creditLimitMinor: null, annualFeeMinor: null });
  const supplementary = await addCard(database, ws, { accountId: card.id, last4: '7726' });
  const [primary] = await database.db.values<[string]>(sql`SELECT id FROM cards WHERE account_id = ${card.id} AND is_primary = 1`);
  const other = await createCardAccount(database, ws, { name: 'BNI Mastercard', issuer: 'BNI', subtype: 'credit_card', currency: 'IDR', last4: '9184' });
  const [otherCard] = await database.db.values<[string]>(sql`SELECT id FROM cards WHERE account_id = ${other.id}`);
  const bank = await createAccount(database, ws, { name: 'Bank', kind: 'asset', subtype: 'bank', currency: 'IDR' });
  const groceries = (await listAccounts(database, ws)).find((a) => a.systemKey === 'household.groceries')!.id;
  const buy = (occurredOn: string, description: string, amountMinor: number, on = card.id) =>
    postTransaction(database, ws, { occurredOn, description, lines: expenseLines({ categoryAccountId: groceries, paymentAccountId: on, amountMinor, currency: 'IDR' }) });
  return { database, ws, card, primary: primary![0], supplementary, other, otherCard: otherCard![0], bank, groceries, buy };
}

type Setup = Awaited<ReturnType<typeof twoCards>>;

const SEPTEMBER = statementCycleFor('2026-09-20', 20);

const cardOf = async (h: Setup, id: string, accountId = h.card.id) => (await listTransactions(h.database, h.ws, { accountId })).find((tx) => tx.id === id)?.cardId;

describe('setting the card on several purchases at once', () => {
  it('sets every one in place, nothing reposted, and audits each', async () => {
    const h = await twoCards();
    const a = await h.buy('2026-09-02', 'Hero', 210_000);
    const b = await h.buy('2026-09-04', 'Lotte Mart', 365_000);
    // A card account with two cards names none on a purchase until told.
    expect(await cardOf(h, a)).toBeNull();

    expect(await setTransactionsCard(h.database, h.ws, [a, b], h.supplementary)).toBe(2);

    expect(await cardOf(h, a)).toBe(h.supplementary);
    expect(await cardOf(h, b)).toBe(h.supplementary);
    // The same rows, still standing: metadata, not a correction.
    const [posted] = await h.database.db.values<[number]>(sql`SELECT COUNT(*) FROM transactions WHERE status = 'posted' AND id IN (${a}, ${b})`);
    expect(Number(posted![0])).toBe(2);
    const audits = await h.database.db.values<[string, string]>(sql`SELECT entity_id, payload_json FROM audit_log WHERE action = 'set_card' ORDER BY entity_id`);
    expect(audits).toEqual([a, b].sort().map((id) => [id, JSON.stringify({ cardId: h.supplementary })]));
  });

  it('takes the card off with null, and counts a repeated id once', async () => {
    const h = await twoCards();
    const a = await h.buy('2026-09-02', 'Hero', 210_000);
    await setTransactionsCard(h.database, h.ws, [a], h.primary);
    expect(await setTransactionsCard(h.database, h.ws, [a, a], null)).toBe(1);
    expect(await cardOf(h, a)).toBeNull();
  });

  it('refuses a card from another account, and changes none of them', async () => {
    const h = await twoCards();
    const onOther = await h.buy('2026-09-03', 'Indomaret', 45_000, h.other.id);
    const a = await h.buy('2026-09-02', 'Hero', 210_000);
    const refused = await setTransactionsCard(h.database, h.ws, [onOther, a], h.otherCard).catch((e: unknown) => e);
    expect(refused).toBeInstanceOf(LedgerError);
    expect((refused as LedgerError).code).toBe('NOT_ON_CARD');
    // Whole or not at all: the Mandiri purchase names no card, and the BNI one keeps its account's only card.
    expect(await cardOf(h, a)).toBeNull();
    expect(await cardOf(h, onOther, h.other.id)).toBe(h.otherCard);
  });

  it('refuses a transaction that does not touch the account at all', async () => {
    const h = await twoCards();
    const cash = await postTransaction(h.database, h.ws, {
      occurredOn: '2026-09-02',
      description: 'Market',
      lines: expenseLines({ categoryAccountId: h.groceries, paymentAccountId: h.bank.id, amountMinor: 30_000, currency: 'IDR' }),
    });
    await expect(setTransactionsCard(h.database, h.ws, [cash], h.primary)).rejects.toMatchObject({ code: 'NOT_ON_CARD' });
  });

  it('refuses a void transaction', async () => {
    const h = await twoCards();
    const a = await h.buy('2026-09-02', 'Hero', 210_000);
    const gone = await h.buy('2026-09-03', 'Mistake', 10_000);
    await voidTransaction(h.database, h.ws, gone);
    await expect(setTransactionsCard(h.database, h.ws, [a, gone], h.primary)).rejects.toMatchObject({ code: 'NOT_FOUND' });
    expect(await cardOf(h, a)).toBeNull();
  });

  it('refuses a card that is not there, or was put away', async () => {
    const h = await twoCards();
    const a = await h.buy('2026-09-02', 'Hero', 210_000);
    await expect(setTransactionsCard(h.database, h.ws, [a], '00000000-0000-7000-8000-000000000000')).rejects.toMatchObject({ code: 'CARD_NOT_FOUND' });
    await archiveCard(h.database, h.ws, h.supplementary);
    await expect(setTransactionsCard(h.database, h.ws, [a], h.supplementary)).rejects.toMatchObject({ code: 'CARD_NOT_FOUND' });
  });

  it('accepts a payment onto the account: its line is on the card account', async () => {
    const h = await twoCards();
    const payment = await postTransaction(h.database, h.ws, {
      occurredOn: '2026-09-05',
      description: 'Card payment',
      lines: transferLines({ fromAccountId: h.bank.id, toAccountId: h.card.id, amountMinor: 100_000, currency: 'IDR' }),
    });
    expect(await setTransactionsCard(h.database, h.ws, [payment], h.primary)).toBe(1);
  });

  it('moves the purchases out of Card not recorded on the statement', async () => {
    const h = await twoCards();
    const a = await h.buy('2026-09-02', 'Hero', 210_000);
    const b = await h.buy('2026-09-04', 'Lotte Mart', 365_000);
    const before = await cardStatement(h.database, h.ws, h.card.id, SEPTEMBER, '2026-09-25');
    expect(before.lines.filter((line) => line.spending).map((line) => line.cardId)).toEqual([null, null]);

    await setTransactionsCard(h.database, h.ws, [a, b], h.primary);

    const after = await cardStatement(h.database, h.ws, h.card.id, SEPTEMBER, '2026-09-25');
    expect(after.lines.filter((line) => line.spending).map((line) => [line.transactionId, line.cardId])).toEqual([
      [a, h.primary],
      [b, h.primary],
    ]);
  });
});
