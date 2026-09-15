import { expenseLines } from '@expanses/core';
import { afterEach, describe, expect, it } from 'vitest';
import {
  addCard,
  confirmDraft,
  createAccount,
  createCardAccount,
  createDraft,
  editDraft,
  guessCategoryFromHistory,
  listAccounts,
  listDrafts,
  listTransactions,
  postTransaction,
} from '../src/index';
import { setupDb, type TestDb } from './helpers';

let current: TestDb | undefined;
afterEach(() => {
  current?.executor.close();
  current = undefined;
});

async function workspace() {
  current = await setupDb();
  const { database, ws } = current;
  const all = await listAccounts(database, ws);
  const key = (k: string) => all.find((a) => a.systemKey === k)!.id;
  return { database, ws, key };
}

describe('a draft typed into the table', () => {
  it('keeps the card it names all the way into the ledger', async () => {
    const { database, ws, key } = await workspace();
    const bonvoy = await createCardAccount(database, ws, { name: 'Mandiri Marriott Bonvoy', issuer: 'Mandiri', subtype: 'credit_card', currency: 'IDR', last4: '1467' });
    const spouse = await addCard(database, ws, { accountId: bonvoy.id, last4: '8802', holderName: 'Spouse' });

    const id = await createDraft(database, ws, { source: 'manual', occurredOn: '2026-09-15', description: 'Ranch Market', amountMinor: 450_000, currency: 'IDR', accountId: bonvoy.id });
    // Filled in cell by cell, the way the table does it.
    await editDraft(database, ws, id, { cardId: spouse, categoryAccountId: key('household.groceries') });
    expect((await listDrafts(database, ws))[0]).toMatchObject({ id, cardId: spouse });

    const transactionId = await confirmDraft(database, ws, id);
    const [posted] = await listTransactions(database, ws, { accountId: bonvoy.id });
    expect(posted).toMatchObject({ id: transactionId, cardId: spouse });
  });

  it('takes a row even when one like it is already there', async () => {
    const { database, ws } = await workspace();
    const draft = { source: 'manual' as const, occurredOn: '2026-09-15', description: 'Kopi', amountMinor: 32_000, currency: 'IDR' };
    await createDraft(database, ws, draft);
    await createDraft(database, ws, draft);
    // Two coffees in a day is ordinary; only an import is deduplicated.
    expect(await listDrafts(database, ws)).toHaveLength(2);
  });
});

describe('guessing a category from history', () => {
  async function spend(t: Awaited<ReturnType<typeof workspace>>, bank: string, occurredOn: string, description: string, categoryKey: string) {
    await postTransaction(t.database, t.ws, {
      occurredOn,
      description,
      lines: expenseLines({ categoryAccountId: t.key(categoryKey), paymentAccountId: bank, amountMinor: 100_000, currency: 'IDR' }),
    });
  }

  it('uses the category last chosen for that merchant, however the name was written', async () => {
    const t = await workspace();
    const bank = (await createAccount(t.database, t.ws, { name: 'BCA', kind: 'asset', subtype: 'bank', currency: 'IDR' })).id;
    await spend(t, bank, '2026-08-01', 'SUPERINDO KEBAYORAN 0801', 'household.groceries');
    await spend(t, bank, '2026-09-01', 'Superindo Kebayoran', 'household.supplies');

    // The later choice wins: re-filing a merchant changes the next guess.
    expect(await guessCategoryFromHistory(t.database, t.ws, 'superindo kebayoran')).toBe(t.key('household.supplies'));
  });

  it('matches a shop named shorter or longer than before, but an exact name comes first', async () => {
    const t = await workspace();
    const bank = (await createAccount(t.database, t.ws, { name: 'BCA', kind: 'asset', subtype: 'bank', currency: 'IDR' })).id;
    await spend(t, bank, '2026-08-01', 'SUPERINDO KEBAYORAN 0801', 'household.groceries');
    await spend(t, bank, '2026-08-02', 'Grab Food', 'food_beverage.takeaways');

    expect(await guessCategoryFromHistory(t.database, t.ws, 'Superindo')).toBe(t.key('household.groceries'));
    // A whole word has to match: Grabcar is not Grab.
    expect(await guessCategoryFromHistory(t.database, t.ws, 'Grabcar')).toBeNull();

    await spend(t, bank, '2026-08-03', 'Superindo', 'household.supplies');
    await spend(t, bank, '2026-09-01', 'Superindo Pondok', 'food_beverage.takeaways');
    expect(await guessCategoryFromHistory(t.database, t.ws, 'superindo')).toBe(t.key('household.supplies'));
  });

  it('knows nothing about a merchant never seen', async () => {
    const t = await workspace();
    expect(await guessCategoryFromHistory(t.database, t.ws, 'Toko Bangunan Jaya')).toBeNull();
    expect(await guessCategoryFromHistory(t.database, t.ws, '')).toBeNull();
  });

  it('skips a purchase split across categories, which says nothing about either', async () => {
    const t = await workspace();
    const bank = (await createAccount(t.database, t.ws, { name: 'BCA', kind: 'asset', subtype: 'bank', currency: 'IDR' })).id;
    await spend(t, bank, '2026-08-01', 'Lotte Mart', 'household.groceries');
    await postTransaction(t.database, t.ws, {
      occurredOn: '2026-09-01',
      description: 'Lotte Mart',
      lines: [
        { accountId: t.key('household.groceries'), amountMinor: 60_000, currency: 'IDR' },
        { accountId: t.key('shopping.electronics'), amountMinor: 40_000, currency: 'IDR' },
        { accountId: bank, amountMinor: -100_000, currency: 'IDR' },
      ],
    });

    expect(await guessCategoryFromHistory(t.database, t.ws, 'Lotte Mart')).toBe(t.key('household.groceries'));
  });
});
