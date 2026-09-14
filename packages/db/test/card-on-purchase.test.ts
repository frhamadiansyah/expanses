import { expenseLines } from '@expanses/core';
import { afterEach, describe, expect, it } from 'vitest';
import { addCard, createCardAccount, listTransactions, postTransaction } from '../src/index';
import { setupDb, type TestDb } from './helpers';

let current: TestDb | undefined;
afterEach(() => {
  current?.executor.close();
  current = undefined;
});

/**
 * One statement, two cards.
 *
 * The supplement spends against the same account, so the ledger sees one debt and the points pool as
 * they should. Which card was used is recorded on the purchase, because that is the only thing the
 * single statement cannot tell you.
 */
describe('a purchase made on a particular card', () => {
  it('records which card, and reads it back', async () => {
    current = await setupDb();
    const { database, ws } = current;
    const account = await createCardAccount(database, ws, {
      name: 'Mandiri Bonvoy',
      issuer: 'Mandiri',
      subtype: 'credit_card',
      currency: 'IDR',
      last4: '1467',
      holderName: 'Fandrian',
    });
    const supplement = await addCard(database, ws, { accountId: account.id, last4: '8802', holderName: 'Spouse' });
    const groceries = (await import('../src/index')).listAccounts;
    const category = (await groceries(database, ws)).find((a) => a.systemKey === 'household.groceries')!;

    await postTransaction(database, ws, {
      occurredOn: '2026-09-14',
      description: 'Ranch Market',
      cardId: supplement,
      lines: expenseLines({ categoryAccountId: category.id, paymentAccountId: account.id, amountMinor: 450_000, currency: 'IDR' }),
    });

    const [posted] = await listTransactions(database, ws, { accountId: account.id });
    expect(posted?.cardId).toBe(supplement);
  });

  it('leaves the card empty when none was said', async () => {
    current = await setupDb();
    const { database, ws } = current;
    const account = await createCardAccount(database, ws, { name: 'BCA KrisFlyer', subtype: 'credit_card', currency: 'IDR' });
    const { listAccounts } = await import('../src/index');
    const category = (await listAccounts(database, ws)).find((a) => a.systemKey === 'household.groceries')!;

    await postTransaction(database, ws, {
      occurredOn: '2026-09-14',
      description: 'Superindo',
      lines: expenseLines({ categoryAccountId: category.id, paymentAccountId: account.id, amountMinor: 120_000, currency: 'IDR' }),
    });

    const [posted] = await listTransactions(database, ws, { accountId: account.id });
    expect(posted?.cardId).toBeNull();
  });
});
