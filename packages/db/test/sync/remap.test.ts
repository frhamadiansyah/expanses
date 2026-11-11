import { expenseLines } from '@expanses/core';
import { sql } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { createAccount, postTransaction, replaceTransaction, voidTransaction } from '../../src/index';
import { freeTransactionIdTx, remapId, sha1 } from '../../src/sync/held';
import { uuidv5 } from '../../src/sync/uuidv5';
import { categoryOf, headOf, Household, projectBook, skipsOf, type Device } from './household';

/* Sharing resilience §4.2 D-A2: a purchase whose transaction id is already on the joining phone gets a local id. */

async function placeholderOf(d: Device, bookId: string, memberId: string): Promise<string> {
  const [row] = await d.database.db.values<[string]>(sql`SELECT account_id FROM book_member_accounts WHERE book_id = ${bookId} AND member_id = ${memberId}`);
  return row![0];
}

async function statusOf(d: Device, id: string): Promise<string | undefined> {
  const [row] = await d.database.db.values<[string]>(sql`SELECT status FROM transactions WHERE id = ${id}`);
  return row?.[0];
}

/** Dewi shares, posts a purchase; Fandri holds a voided leftover under the same id (as an old-build delete left it), then joins. */
async function collided() {
  const home = new Household();
  const dewi = await home.device('Dewi');
  const fandri = await home.device('Fandri');
  const bookId = await home.share(dewi);
  const groceries = await categoryOf(dewi.database, bookId, 'Groceries');
  const id = await postTransaction(dewi.database, dewi.ws, {
    occurredOn: '2026-09-10',
    description: 'market',
    lines: expenseLines({ categoryAccountId: groceries, paymentAccountId: dewi.bank, amountMinor: 41_300, currency: 'IDR' }),
  });
  // Posted through the ledger under the given id (PostTransactionInput.id, as apply posts), then voided.
  const fandriFood = await createAccount(fandri.database, fandri.ws, { name: 'Food', kind: 'expense', subtype: 'category', currency: null });
  await postTransaction(fandri.database, fandri.ws, {
    id,
    occurredOn: '2026-01-01',
    description: 'leftover',
    lines: expenseLines({ categoryAccountId: fandriFood.id, paymentAccountId: fandri.bank, amountMinor: 1_000, currency: 'IDR' }),
  });
  await voidTransaction(fandri.database, fandri.ws, id);
  await home.join(fandri, dewi);
  await home.settle();
  return { home, dewi, fandri, bookId, id };
}

describe('remapId', () => {
  it('is the uuidv5 WebCrypto makes, and a SHA-1 that matches the standard vectors', async () => {
    const hex = (bytes: Uint8Array) => Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
    expect(hex(sha1(new TextEncoder().encode('abc')))).toBe('a9993e364706816aba3e25717850c26c9cd0d89d');
    expect(hex(sha1(new Uint8Array()))).toBe('da39a3ee5e6b4b0d3255bfef95601890afd80709');
    const long = new TextEncoder().encode('abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq');
    expect(hex(sha1(long))).toBe('84983e441c3bd26ebaae4aa1f95129e5e54670f1');
    const ns = 'f6c157a2-6158-434d-81d7-dd27c86d79f0';
    expect(remapId('book-1', 'lineage-1')).toBe(await uuidv5(ns, 'remap:book-1:lineage-1'));
    expect(remapId('book-1', 'lineage-1', 1)).toBe(remapId('book-1', 'lineage-1'));
    expect(remapId('book-1', 'lineage-1', 2)).toBe(await uuidv5(ns, 'remap:book-1:lineage-1:2'));
  });

  it('freeTransactionIdTx keeps a free lineage id and walks past remapped ids already taken', async () => {
    const home = new Household();
    const d = await home.device('Dewi');
    const food = await createAccount(d.database, d.ws, { name: 'Food', kind: 'expense', subtype: 'category', currency: null });
    const post = (id: string) =>
      postTransaction(d.database, d.ws, { id, occurredOn: '2026-02-01', description: 'x', lines: expenseLines({ categoryAccountId: food.id, paymentAccountId: d.bank, amountMinor: 500, currency: 'IDR' }) });
    const lineage = '0191a3b0-0000-7000-8000-000000000001';
    expect(await freeTransactionIdTx(d.database.db, 'book-1', lineage)).toBe(lineage);
    await post(lineage);
    expect(await freeTransactionIdTx(d.database.db, 'book-1', lineage)).toBe(remapId('book-1', lineage));
    await post(remapId('book-1', lineage));
    expect(await freeTransactionIdTx(d.database.db, 'book-1', lineage)).toBe(remapId('book-1', lineage, 2));
  });
});

describe('a purchase whose transaction id is already here (D-A2)', () => {
  it('posts under a local id, leaves the holder alone, and both phones project the same', async () => {
    const { dewi, fandri, bookId, id } = await collided();
    expect(await skipsOf(fandri.database)).toEqual([]);
    expect(await headOf(fandri.database, id)).toBe(remapId(bookId, id));
    expect(await fandri.database.db.values(sql`SELECT description, status FROM transactions WHERE id = ${id}`)).toEqual([['leftover', 'void']]);
    expect(await projectBook(fandri.database, bookId)).toEqual(await projectBook(dewi.database, bookId));
    // The money, to the unit: Dewi's placeholder carries the purchase on Fandri's phone; his own bank is untouched by it.
    const placeholder = await placeholderOf(fandri, bookId, dewi.memberId);
    const onPlaceholder = (await fandri.database.db.values<[number]>(sql`SELECT sum(amount_minor) FROM entries WHERE transaction_id = ${remapId(bookId, id)} AND account_id = ${placeholder}`))[0]![0];
    expect(Number(onPlaceholder)).toBe(-41_300);
  });

  it('a remapped purchase edited on either phone and then voided converges', async () => {
    const { home, dewi, fandri, bookId, id } = await collided();
    const fandriGroceries = await categoryOf(fandri.database, bookId, 'Groceries');
    const dewiGroceries = await categoryOf(dewi.database, bookId, 'Groceries');
    const placeholder = await placeholderOf(fandri, bookId, dewi.memberId);

    // Fandri corrects the amount on the remapped head.
    await replaceTransaction(fandri.database, fandri.ws, (await headOf(fandri.database, id))!, {
      occurredOn: '2026-09-10',
      description: 'market',
      lines: expenseLines({ categoryAccountId: fandriGroceries, paymentAccountId: placeholder, amountMinor: 52_000, currency: 'IDR' }),
    });
    await home.settle();
    expect(await skipsOf(dewi.database)).toEqual([]);
    expect(await projectBook(fandri.database, bookId)).toEqual(await projectBook(dewi.database, bookId));
    const dewiAmount = (await dewi.database.db.values<[number]>(
      sql`SELECT amount_minor FROM entries WHERE transaction_id = ${(await headOf(dewi.database, id))!} AND account_id = ${dewi.bank}`,
    ))[0]![0];
    expect(Number(dewiAmount)).toBe(-52_000);

    // Dewi renames it.
    await replaceTransaction(dewi.database, dewi.ws, (await headOf(dewi.database, id))!, {
      occurredOn: '2026-09-10',
      description: 'market, weekly',
      lines: expenseLines({ categoryAccountId: dewiGroceries, paymentAccountId: dewi.bank, amountMinor: 52_000, currency: 'IDR' }),
    });
    await home.settle();
    expect(await projectBook(fandri.database, bookId)).toEqual(await projectBook(dewi.database, bookId));
    const described = (await fandri.database.db.values<[string]>(sql`SELECT description FROM transactions WHERE id = ${(await headOf(fandri.database, id))!}`))[0]![0];
    expect(described).toBe('market, weekly');

    // Fandri voids it.
    await voidTransaction(fandri.database, fandri.ws, (await headOf(fandri.database, id))!);
    await home.settle();
    expect(await headOf(fandri.database, id)).toBeNull();
    expect(await headOf(dewi.database, id)).toBeNull();
    const fandriProjection = await projectBook(fandri.database, bookId);
    expect(fandriProjection).toEqual(await projectBook(dewi.database, bookId));
    expect(fandriProjection.purchase![id]).toBe('void');
    expect(await skipsOf(fandri.database)).toEqual([]);
    expect(await skipsOf(dewi.database)).toEqual([]);
    // The holder never moved.
    expect(await statusOf(fandri, id)).toBe('void');
    expect(await fandri.database.db.values(sql`SELECT description FROM transactions WHERE id = ${id}`)).toEqual([['leftover']]);
  });
});
