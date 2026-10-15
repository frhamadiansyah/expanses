import { expenseLines, transferLines } from '@expanses/core';
import { afterEach, describe, expect, it } from 'vitest';
import {
  addCard,
  archiveCard,
  confirmDraft,
  createAccount,
  createCardAccount,
  createDraft,
  importRows,
  listAccounts,
  listCards,
  listTransactions,
  postTransaction,
  replaceTransaction,
  splitBill,
} from '../src/index';
import { setupDb, type TestDb } from './helpers';

let current: TestDb | undefined;
afterEach(() => {
  current?.executor.close();
  current = undefined;
});

/*
 * A card account with one card in use: every purchase on it was made with that card, so it is saved naming it. Paid
 * with offers such an account as one row, which names no card, so every way a purchase is written leaves the card to the
 * ledger, and the ledger fills it in. Invented names and figures.
 */
async function oneCard() {
  current = await setupDb();
  const { database, ws } = current;
  const octo = await createCardAccount(database, ws, { name: 'Octo Card', subtype: 'credit_card', currency: 'IDR', issuer: 'CIMB Niaga', last4: '5190' });
  const [card] = await listCards(database, ws, octo.id);
  const groceries = (await listAccounts(database, ws)).find((a) => a.systemKey === 'household.groceries')!;
  const bank = await createAccount(database, ws, { name: 'Rekening Harian', kind: 'asset', subtype: 'bank', currency: 'IDR' });
  const cardOf = async (id: string) => (await listTransactions(database, ws)).find((t) => t.id === id)?.cardId;
  return { database, ws, octo, card: card!, groceries, bank, cardOf };
}

describe('a purchase on a card account with one card in use', () => {
  it('names that card when the purchase says no card', async () => {
    const { database, ws, octo, card, groceries, cardOf } = await oneCard();
    const id = await postTransaction(database, ws, {
      occurredOn: '2026-10-03',
      description: 'Toko Sayur',
      lines: expenseLines({ categoryAccountId: groceries.id, paymentAccountId: octo.id, amountMinor: 87_000, currency: 'IDR' }),
    });
    expect(await cardOf(id)).toBe(card.id);
  });

  it('names that card when an edit says no card', async () => {
    const { database, ws, octo, card, groceries, bank, cardOf } = await oneCard();
    const id = await postTransaction(database, ws, {
      occurredOn: '2026-10-03',
      description: 'Toko Sayur',
      lines: expenseLines({ categoryAccountId: groceries.id, paymentAccountId: bank.id, amountMinor: 87_000, currency: 'IDR' }),
    });
    // Moved onto the card by an edit, from a form whose Paid with row names no card.
    const edited = await replaceTransaction(database, ws, id, {
      occurredOn: '2026-10-03',
      description: 'Toko Sayur',
      cardId: null,
      lines: expenseLines({ categoryAccountId: groceries.id, paymentAccountId: octo.id, amountMinor: 87_000, currency: 'IDR' }),
    });
    expect(await cardOf(edited)).toBe(card.id);
  });

  it('names that card on a capture confirmed, a statement row imported and a bill shared', async () => {
    const { database, ws, octo, card, groceries, cardOf } = await oneCard();
    const draft = await createDraft(database, ws, {
      source: 'screen',
      occurredOn: '2026-10-04',
      description: 'Warung Kopi',
      amountMinor: 32_000,
      currency: 'IDR',
      accountId: octo.id,
      categoryAccountId: groceries.id,
    });
    const { transactionId } = await confirmDraft(database, ws, draft);
    expect(await cardOf(transactionId)).toBe(card.id);

    await importRows(database, ws, { accountId: octo.id, currency: 'IDR', rows: [{ occurredOn: '2026-10-05', description: 'Pasar Pagi', amountMinor: 54_000, externalRef: 'row-1', categoryAccountId: groceries.id }] });
    const imported = (await listTransactions(database, ws)).find((t) => t.description === 'Pasar Pagi')!;
    expect(imported.cardId).toBe(card.id);

    const { transactionId: shared } = await splitBill(database, ws, {
      occurredOn: '2026-10-06',
      description: 'Makan Malam',
      totalMinor: 300_000,
      moneyAccountId: octo.id,
      ownCategoryId: groceries.id,
      ownShareMinor: 150_000,
      shares: [{ person: { name: 'Teman', currency: 'IDR' }, amountMinor: 150_000 }],
    });
    expect(await cardOf(shared)).toBe(card.id);
  });

  it('keeps a card the purchase does name, even one since removed', async () => {
    const { database, ws, octo, card, groceries, cardOf } = await oneCard();
    // The card it names was replaced since: the purchase still says the card it was made with.
    await addCard(database, ws, { accountId: octo.id, last4: '6624' });
    await archiveCard(database, ws, card.id);
    const id = await postTransaction(database, ws, {
      occurredOn: '2026-10-03',
      description: 'Toko Sayur',
      cardId: card.id,
      lines: expenseLines({ categoryAccountId: groceries.id, paymentAccountId: octo.id, amountMinor: 87_000, currency: 'IDR' }),
    });
    expect(await cardOf(id)).toBe(card.id);
  });

  it('names no card on a payment to the card, which is no purchase', async () => {
    const { database, ws, octo, bank, cardOf } = await oneCard();
    const id = await postTransaction(database, ws, {
      occurredOn: '2026-10-25',
      description: 'Card payment',
      lines: transferLines({ fromAccountId: bank.id, toAccountId: octo.id, amountMinor: 500_000, currency: 'IDR' }),
    });
    expect(await cardOf(id)).toBeNull();
  });
});

describe('a purchase on a card account without exactly one card in use', () => {
  it('names no card on an account with no card, or whose only card was removed', async () => {
    current = await setupDb();
    const { database, ws } = current;
    const groceries = (await listAccounts(database, ws)).find((a) => a.systemKey === 'household.groceries')!;
    const bare = await createCardAccount(database, ws, { name: 'Kartu Tanpa Nomor', subtype: 'credit_card', currency: 'IDR' });
    const removed = await createCardAccount(database, ws, { name: 'Kartu Lama', subtype: 'credit_card', currency: 'IDR', last4: '3058' });
    await archiveCard(database, ws, (await listCards(database, ws, removed.id))[0]!.id);
    for (const account of [bare, removed]) {
      await postTransaction(database, ws, {
        occurredOn: '2026-10-03',
        description: `Belanja ${account.name}`,
        lines: expenseLines({ categoryAccountId: groceries.id, paymentAccountId: account.id, amountMinor: 41_000, currency: 'IDR' }),
      });
    }
    expect((await listTransactions(database, ws)).map((t) => t.cardId)).toEqual([null, null]);
  });

  it('names no card on an account carrying two, where the card is the owner’s to say', async () => {
    current = await setupDb();
    const { database, ws } = current;
    const groceries = (await listAccounts(database, ws)).find((a) => a.systemKey === 'household.groceries')!;
    const octo = await createCardAccount(database, ws, { name: 'Octo Card', subtype: 'credit_card', currency: 'IDR', last4: '5190' });
    await addCard(database, ws, { accountId: octo.id, last4: '6624', holderName: 'Pasangan' });
    await postTransaction(database, ws, {
      occurredOn: '2026-10-03',
      description: 'Toko Sayur',
      lines: expenseLines({ categoryAccountId: groceries.id, paymentAccountId: octo.id, amountMinor: 87_000, currency: 'IDR' }),
    });
    expect((await listTransactions(database, ws))[0]?.cardId).toBeNull();
  });
});
