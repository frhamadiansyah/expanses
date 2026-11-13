import { transferLines, transferWithFeeLines } from '@expanses/core';
import { describe, expect, it } from 'vitest';
import { createBook, inBook, listSharedTransfers, listTransactions, postTransaction, replaceTransaction, voidTransaction } from '../../src/index';
import { categoryOf, Household, projectBook, skipsOf } from './household';

/* A transfer recorded in a shared workspace reaches the partner as a redacted row: no accounts, no balance effect. */

async function setup() {
  const home = new Household();
  const a = await home.device('Fandri');
  const b = await home.device('Dewi');
  const bookId = await home.share(a);
  await home.join(b, a);
  return { home, a, b, bookId };
}

describe('transfers in a shared workspace', () => {
  it('reach the partner as a redacted row, and the recorder lists the real one once', async () => {
    const { home, a, b, bookId } = await setup();
    const id = await postTransaction(a.database, inBook(a.ws, bookId), {
      occurredOn: '2026-09-10',
      description: 'Move to savings',
      fileTransfer: true,
      lines: transferLines({ fromAccountId: a.bank, toAccountId: a.cash, amountMinor: 250_000, currency: 'IDR' }),
    });
    await home.settle();
    expect(await skipsOf(b.database)).toEqual([]);
    // The partner: one redacted row, nothing about accounts, and no transaction or entry of its own.
    const seen = await listSharedTransfers(b.database, bookId);
    expect(seen).toHaveLength(1);
    expect(seen[0]).toMatchObject({ occurredOn: '2026-09-10', amountMinor: 250_000, currency: 'IDR', description: 'Move to savings', recordedBy: a.memberId });
    expect(JSON.stringify(seen)).not.toContain(a.bank);
    expect(JSON.stringify(seen)).not.toContain(a.cash);
    expect((await listTransactions(b.database, inBook(b.ws, bookId), {})).length).toBe(0);
    // The recorder: the real transfer once, and no shadow beside it.
    expect(await listSharedTransfers(a.database, bookId)).toEqual([]);
    expect((await listTransactions(a.database, inBook(a.ws, bookId), {})).map((r) => r.id)).toEqual([id]);
  });

  it('names an account the recorder shares with the household, never a private one', async () => {
    const { home, a, b, bookId } = await setup();
    await a.database.db.run(`INSERT INTO nw_share_settings (account_id, setting) VALUES ('${a.bank}', 'total')` as never);
    await postTransaction(a.database, inBook(a.ws, bookId), {
      occurredOn: '2026-09-10',
      description: 'Cash withdrawal',
      fileTransfer: true,
      lines: transferLines({ fromAccountId: a.bank, toAccountId: a.cash, amountMinor: 300_000, currency: 'IDR' }),
    });
    await home.settle();
    const [seen] = await listSharedTransfers(b.database, bookId);
    expect([seen!.fromName, seen!.toName]).toEqual(['Fandri Bank', null]);
    expect(JSON.stringify(seen)).not.toContain('Wallet');
  });

  it('follows an edit and goes when the transfer is voided', async () => {
    const { home, a, b, bookId } = await setup();
    const ws = inBook(a.ws, bookId);
    const id = await postTransaction(a.database, ws, {
      occurredOn: '2026-09-10',
      description: 'Top up wallet',
      fileTransfer: true,
      lines: transferLines({ fromAccountId: a.bank, toAccountId: a.cash, amountMinor: 100_000, currency: 'IDR' }),
    });
    await home.settle();
    const edited = await replaceTransaction(a.database, ws, id, {
      occurredOn: '2026-09-11',
      description: 'Top up wallet',
      lines: transferLines({ fromAccountId: a.bank, toAccountId: a.cash, amountMinor: 120_000, currency: 'IDR' }),
    });
    await home.settle();
    expect((await listSharedTransfers(b.database, bookId)).map((r) => [r.occurredOn, r.amountMinor])).toEqual([['2026-09-11', 120_000]]);
    await voidTransaction(a.database, ws, edited);
    await home.settle();
    expect(await listSharedTransfers(b.database, bookId)).toEqual([]);
    expect(await skipsOf(b.database)).toEqual([]);
  });

  it('edited into a transfer with a fee (a purchase now), its redacted row goes: the partner sees the purchase, never a stale transfer', async () => {
    const { home, a, b, bookId } = await setup();
    const ws = inBook(a.ws, bookId);
    const id = await postTransaction(a.database, ws, {
      occurredOn: '2026-09-10',
      description: 'Cash withdrawal',
      fileTransfer: true,
      lines: transferLines({ fromAccountId: a.bank, toAccountId: a.cash, amountMinor: 400_000, currency: 'IDR' }),
    });
    await home.settle();
    expect(await listSharedTransfers(b.database, bookId)).toHaveLength(1);
    const fee = await categoryOf(a.database, bookId, 'Groceries');
    await replaceTransaction(a.database, ws, id, {
      occurredOn: '2026-09-10',
      description: 'Cash withdrawal',
      lines: transferWithFeeLines({ fromAccountId: a.bank, toAccountId: a.cash, amountMinor: 400_000, feeMinor: 6_500, currency: 'IDR', feeCategoryId: fee }),
    });
    await home.settle();
    expect(await skipsOf(b.database)).toEqual([]);
    expect(await listSharedTransfers(b.database, bookId)).toEqual([]);
    expect(await projectBook(a.database, bookId)).toEqual(await projectBook(b.database, bookId));
  });

  it('moved into the shared workspace it appears, moved out it goes, and it is listed by one workspace on the recorder', async () => {
    const { home, a, b, bookId } = await setup();
    const privateId = await createBook(a.database, a.ws, { name: 'Private', kind: 'business', baseCurrency: 'IDR' });
    const id = await postTransaction(a.database, inBook(a.ws, privateId), {
      occurredOn: '2026-09-10',
      description: 'Private move',
      fileTransfer: true,
      lines: transferLines({ fromAccountId: a.bank, toAccountId: a.cash, amountMinor: 9_000, currency: 'IDR' }),
    });
    await home.settle();
    expect(await listSharedTransfers(b.database, bookId)).toEqual([]);
    const lines = transferLines({ fromAccountId: a.bank, toAccountId: a.cash, amountMinor: 9_000, currency: 'IDR' });
    const into = await replaceTransaction(a.database, a.ws, id, { occurredOn: '2026-09-10', description: 'Private move', lines, moveToBook: true, toBookId: bookId });
    await home.settle();
    expect((await listSharedTransfers(b.database, bookId)).map((r) => r.description)).toEqual(['Private move']);
    expect((await listTransactions(a.database, inBook(a.ws, privateId), {})).map((r) => r.id)).not.toContain(into);
    expect((await listTransactions(a.database, inBook(a.ws, bookId), {})).map((r) => r.id)).toContain(into);
    await replaceTransaction(a.database, a.ws, into, { occurredOn: '2026-09-10', description: 'Private move', lines, moveToBook: true, toBookId: privateId });
    await home.settle();
    expect(await listSharedTransfers(b.database, bookId)).toEqual([]);
  });
});
