import { expenseLines } from '@expanses/core';
import { sql } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { addSetCategory, createAccount, createBook, createCategorySet, heldElsewhereOf, moveCategorySet, postTransaction } from '../../src/index';
import { categoryOf, Household, type Device } from './household';

/* A6 re-review 1, as regression tests (invented figures): a share's purchase is never lost behind a live copy, and a
 * partner's entry never debits a member's real account. */

async function balanceOf(d: Device, accountId: string): Promise<number> {
  const [row] = await d.database.db.values<[number]>(
    sql`SELECT COALESCE(sum(e.amount_minor), 0) FROM entries e JOIN transactions t ON t.id = e.transaction_id WHERE e.account_id = ${accountId} AND t.status = 'posted'`,
  );
  return Number(row![0]);
}

async function placeholderOf(d: Device, bookId: string, memberId: string): Promise<string> {
  const [[id]] = (await d.database.db.values<[string]>(
    sql`SELECT account_id FROM book_member_accounts WHERE book_id = ${bookId} AND member_id = ${memberId} AND currency = 'IDR'`,
  )) as [[string]];
  return id;
}

async function settleBook(devices: readonly Device[], bookId: string): Promise<void> {
  for (let round = 0; round < 2; round += 1) for (const d of devices) await d.engine.syncOnce(bookId);
}

describe('a share’s purchase on a category another live copy holds', () => {
  it('a set moved to a private workspace that is shared later: its purchases show in that share at once, no Place needed', async () => {
    const home = new Household();
    const dewi = await home.device('Dewi');
    const fandri = await home.device('Fandri');
    const shared = await home.share(dewi);
    await home.join(fandri, dewi);
    // Dewi adds Pets with Vet in Home; it reaches Fandri. Then she moves the set to her own Business.
    const setId = await createCategorySet(dewi.database, dewi.ws, 'Pets');
    const vet = await addSetCategory(dewi.database, dewi.ws, setId, 'Vet');
    await home.settle();
    const business = await createBook(dewi.database, dewi.ws, { name: 'Business', kind: 'family', baseCurrency: 'IDR' });
    await moveCategorySet(dewi.database, dewi.ws, { setId, toBookId: business });
    // Before the move reaches him, Fandri spends on Vet in Home: Vet stays a category of his Home copy.
    await postTransaction(fandri.database, fandri.ws, {
      occurredOn: '2026-09-12',
      description: 'Fandri vet',
      lines: expenseLines({ categoryAccountId: vet, paymentAccountId: fandri.bank, amountMinor: 15_500, currency: 'IDR' }),
    });
    await fandri.engine.syncOnce(shared);
    await home.settle();

    // Later she shares Business with him, as the same member, and records on Vet there.
    await dewi.engine.shareBook(business, { memberId: dewi.memberId, memberName: dewi.name, deviceName: `${dewi.name}'s phone` });
    const { code } = await dewi.engine.createInvite(business, { inviterName: dewi.name, sameMember: true, memberId: fandri.memberId });
    const joined = await fandri.engine.joinBook(code, { ws: fandri.ws, memberName: fandri.name, deviceName: `${fandri.name}'s phone`, memberId: fandri.memberId });
    expect(joined.result.stopped).toBeUndefined();
    await postTransaction(dewi.database, dewi.ws, {
      occurredOn: '2026-09-13',
      description: 'Dewi vet biz',
      lines: expenseLines({ categoryAccountId: vet, paymentAccountId: dewi.bank, amountMinor: 22_000, currency: 'IDR' }),
    });
    await settleBook([dewi, fandri], business);

    // Vet itself is still his Home's here, so the share's Vet is set aside behind that live copy (D-A3)...
    expect((await heldElsewhereOf(fandri.database, business)).filter((h) => h.entity === 'category').map((h) => [h.id, h.holderBookId])).toEqual([[vet, shared]]);
    // ...but the purchase is not: on his phone it is posted once, filed in Business, on Vet.
    expect(
      await fandri.database.db.values(sql`
        SELECT t.status, bt.book_id FROM transactions t LEFT JOIN book_transactions bt ON bt.transaction_id = t.id WHERE t.description = 'Dewi vet biz'`),
    ).toEqual([['posted', business]]);
    expect((await heldElsewhereOf(fandri.database, business)).filter((h) => h.entity === 'purchase')).toEqual([]);
    const [[onVet]] = (await fandri.database.db.values<[number]>(sql`
      SELECT sum(e.amount_minor) FROM entries e JOIN transactions t ON t.id = e.transaction_id
      WHERE t.description = 'Dewi vet biz' AND t.status = 'posted' AND e.account_id = ${vet}`)) as [[number]];
    expect(Number(onVet)).toBe(22_000);
    // Money to the unit: on Dewi's placeholder in Business on his phone, her bank on hers; his own untouched.
    expect(await balanceOf(fandri, await placeholderOf(fandri, business, dewi.memberId))).toBe(-22_000);
    expect(await balanceOf(dewi, dewi.bank)).toBe(-22_000);
    expect(await balanceOf(fandri, fandri.bank)).toBe(-15_500);
  });
});

describe('a partner’s entry “paid by” this member', () => {
  it('stays on his placeholder in the ordinary sync, and in a whole-log pull too, even when an own account has that name', async () => {
    const home = new Household();
    const dewi = await home.device('Dewi');
    const fandri = await home.device('Fandri');
    const shared = await home.share(dewi);
    await home.join(fandri, dewi);
    await postTransaction(fandri.database, fandri.ws, {
      occurredOn: '2026-09-11',
      description: 'Fandri first',
      lines: expenseLines({ categoryAccountId: await categoryOf(fandri.database, shared, 'Groceries'), paymentAccountId: fandri.bank, amountMinor: 1_000, currency: 'IDR' }),
    });
    await home.settle();
    // His own account named as his placeholder is named on her phone, so the label her op carries names it.
    const named = await createAccount(fandri.database, fandri.ws, { name: 'Fandri', kind: 'asset', subtype: 'cash', currency: 'IDR' });
    await postTransaction(dewi.database, dewi.ws, {
      occurredOn: '2026-09-12',
      description: 'Paid by Fandri',
      lines: expenseLines({ categoryAccountId: await categoryOf(dewi.database, shared, 'Groceries'), paymentAccountId: await placeholderOf(dewi, shared, fandri.memberId), amountMinor: 50_000, currency: 'IDR' }),
    });
    await home.settle();
    const lineage = await fandri.database.db.values(sql`
      SELECT l.paid_by, l.paid_label FROM sync_lineage l JOIN transactions t ON t.id = l.head_transaction_id WHERE t.description = 'Paid by Fandri'`);
    expect(lineage).toEqual([[fandri.memberId, 'Fandri']]);
    expect(await balanceOf(fandri, named.id)).toBe(0);
    expect(await balanceOf(fandri, await placeholderOf(fandri, shared, fandri.memberId))).toBe(-50_000);
    expect(await balanceOf(fandri, fandri.bank)).toBe(-1_000);

    // A whole-log pull (Place them now, nothing held) lands an own purchase with no head here only when his own device
    // wrote it. Her second one reaches his phone first in that pull, with no head: it stays on his placeholder too.
    await postTransaction(dewi.database, dewi.ws, {
      occurredOn: '2026-09-13',
      description: 'Paid by Fandri again',
      lines: expenseLines({ categoryAccountId: await categoryOf(dewi.database, shared, 'Groceries'), paymentAccountId: await placeholderOf(dewi, shared, fandri.memberId), amountMinor: 20_000, currency: 'IDR' }),
    });
    await dewi.engine.syncOnce(shared);
    expect(await fandri.engine.placeHeldRows(shared)).toMatchObject({ placed: 0, stillHeld: 0 });
    await home.settle();
    expect(await balanceOf(fandri, named.id)).toBe(0);
    expect(await balanceOf(fandri, await placeholderOf(fandri, shared, fandri.memberId))).toBe(-70_000);
    expect(await balanceOf(fandri, fandri.bank)).toBe(-1_000);
  });
});
