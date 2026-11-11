import { sql } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { addCard, archiveAccount, createAccount, personalBook } from '../../src/index';
import type { BookContext } from '../../src/sync/apply';
import { ownAccountForLabelTx } from '../../src/sync/own-account';
import { setupDb } from '../helpers';

/* Sharing resilience §6.5 D-B6: an own purchase with no head here lands on the one own account its label names. */

async function context() {
  const { database, ws } = await setupDb('IDR');
  const book = await personalBook(database, ws);
  const ctx: BookContext = { bookId: book.id, ws, memberId: 'member-Sari', currency: 'IDR' };
  const find = (label: string, currency = 'IDR') => database.transaction((tx) => ownAccountForLabelTx(tx, ctx, label, currency));
  return { database, ws, ctx, book, find };
}

describe('ownAccountForLabelTx (D-B6)', () => {
  it('a label naming exactly one own account gives that account', async () => {
    const { database, ws, find } = await context();
    const bank = await createAccount(database, ws, { name: 'Bank One', kind: 'asset', subtype: 'bank', currency: 'IDR' });
    await createAccount(database, ws, { name: 'Wallet', kind: 'asset', subtype: 'cash', currency: 'IDR' });
    expect(await find('Bank One')).toBe(bank.id);
  });

  it('a card label picks the card by its last four, among cards of the same name', async () => {
    const { database, ws, find } = await context();
    const first = await createAccount(database, ws, { name: 'Card', kind: 'liability', subtype: 'credit_card', currency: 'IDR' });
    const second = await createAccount(database, ws, { name: 'Card', kind: 'liability', subtype: 'credit_card', currency: 'IDR' });
    await addCard(database, ws, { accountId: first.id, last4: '4821', isPrimary: true });
    await addCard(database, ws, { accountId: second.id, last4: '1177', isPrimary: true });
    expect(await find('Card ···· 4821')).toBe(first.id);
    expect(await find('Card ···· 1177')).toBe(second.id);
    expect(await find('Card')).toBeNull(); // two of that name, no card named: no guess
  });

  it('a label of two accounts names no single one', async () => {
    const { database, ws, find } = await context();
    await createAccount(database, ws, { name: 'Bank One', kind: 'asset', subtype: 'bank', currency: 'IDR' });
    await createAccount(database, ws, { name: 'Wallet', kind: 'asset', subtype: 'cash', currency: 'IDR' });
    expect(await find('Bank One + Wallet')).toBeNull();
  });

  it('an archived account is never chosen', async () => {
    const { database, ws, find } = await context();
    const bank = await createAccount(database, ws, { name: 'Bank One', kind: 'asset', subtype: 'bank', currency: 'IDR' });
    await archiveAccount(database, ws, bank.id);
    expect(await find('Bank One')).toBeNull();
  });

  it('a placeholder of the book with the same name is not an own account', async () => {
    const { database, ws, book, find } = await context();
    const placeholder = await createAccount(database, ws, { name: 'Bank One', kind: 'asset', subtype: 'cash', currency: 'IDR' });
    await database.db.run(sql`INSERT INTO book_member_accounts (account_id, book_id, member_id, currency) VALUES (${placeholder.id}, ${book.id}, 'member-Raka', 'IDR')`);
    expect(await find('Bank One')).toBeNull();
  });

  it('an account in another currency than the line is not chosen', async () => {
    const { database, ws, find } = await context();
    const dollars = await createAccount(database, ws, { name: 'Bank One', kind: 'asset', subtype: 'bank', currency: 'USD' });
    expect(await find('Bank One')).toBeNull();
    expect(await find('Bank One', 'USD')).toBe(dollars.id);
  });
});
