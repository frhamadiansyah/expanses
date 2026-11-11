import { expenseLines } from '@expanses/core';
import { sql } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { createAccount, postTransaction, replaceTransaction, voidTransaction } from '../../src/index';
import { remapId } from '../../src/sync/held';
import { recordLineagesTx, rowsInScopeTx } from '../../src/sync/seed';
import { categoryOf, headOf, Household, postedRowsOf, projectBook, skipsOf, type Device } from './household';

/*
 * Sharing resilience §4.2 D-A6 (H1): a same-book rejoin of a copy whose purchases have no `sync_lineage` row (what a
 * pre-share copy looks like) gives each one its lineage before the pull, so the log edits it in place: no purchase is
 * posted a second time under a remapped id (D-A2), and each lineage keeps the row this phone already had as its head.
 */

async function spend(d: Device, bookId: string, description: string, amountMinor: number): Promise<string> {
  return postTransaction(d.database, d.ws, {
    occurredOn: '2026-09-10',
    description,
    lines: expenseLines({ categoryAccountId: await categoryOf(d.database, bookId, 'Groceries'), paymentAccountId: d.bank, amountMinor, currency: 'IDR' }),
  });
}

async function postedIn(d: Device, bookId: string): Promise<number> {
  const [row] = await d.database.db.values<[number]>(
    sql`SELECT count(*) FROM transactions t JOIN book_transactions bt ON bt.transaction_id = t.id WHERE bt.book_id = ${bookId} AND t.status = 'posted'`,
  );
  return Number(row![0]);
}

/** What the book spent on this phone, in minor units: every posted category line filed in it. */
async function spentIn(d: Device, bookId: string): Promise<number> {
  const [row] = await d.database.db.values<[number]>(sql`
    SELECT COALESCE(sum(e.amount_minor), 0) FROM entries e
    JOIN transactions t ON t.id = e.transaction_id JOIN book_transactions bt ON bt.transaction_id = t.id
    JOIN accounts a ON a.id = e.account_id
    WHERE bt.book_id = ${bookId} AND t.status = 'posted' AND a.kind = 'expense'`);
  return Number(row![0]);
}

async function balanceOf(d: Device, accountId: string): Promise<number> {
  const [row] = await d.database.db.values<[number]>(
    sql`SELECT COALESCE(sum(e.amount_minor), 0) FROM entries e JOIN transactions t ON t.id = e.transaction_id WHERE e.account_id = ${accountId} AND t.status = 'posted'`,
  );
  return Number(row![0]);
}

/** A row and every row that replaced it since, in order. */
async function chainFrom(d: Device, id: string): Promise<string[]> {
  const rows = await d.database.db.values<[string]>(sql`
    WITH RECURSIVE forward(id, depth) AS (
      SELECT ${id}, 0
      UNION ALL
      SELECT t.id, f.depth + 1 FROM transactions t JOIN forward f ON t.replaces_transaction_id = f.id
    )
    SELECT id FROM forward ORDER BY depth`);
  return rows.map(([row]) => row);
}

async function lineagesOf(d: Device, bookId: string): Promise<[string, string | null, string][]> {
  return d.database.db.values<[string, string | null, string]>(
    sql`SELECT lineage_id, head_transaction_id, paid_by FROM sync_lineage WHERE book_id = ${bookId} ORDER BY lineage_id`,
  );
}

/**
 * Dewi shares, Fandri joins, both record (Fandri edits one of his before the leave), settle. Fandri leaves; on his
 * phone the book's lineages go (and, with `clocks`, the purchases' field clocks: a copy taken before the share has
 * neither). Dewi invites him back as the same member and he joins from that database.
 */
async function rejoinWithoutLineages(options: { clocks: boolean }) {
  const home = new Household();
  const dewi = await home.device('Dewi');
  const fandri = await home.device('Fandri');
  const bookId = await home.share(dewi);
  await home.join(fandri, dewi);
  const dewiMarket = await spend(dewi, bookId, 'Dewi market', 41_300);
  const fandriMarket = await spend(fandri, bookId, 'Fandri market', 27_500);
  const pharmacy = await spend(fandri, bookId, 'Fandri pharmacy', 15_800);
  await home.settle();
  // Edited before the leave: the lineage is rooted at the first row, its head is the replacement.
  const pharmacyHead = await replaceTransaction(fandri.database, fandri.ws, pharmacy, {
    occurredOn: '2026-09-11',
    description: 'Fandri pharmacy',
    lines: expenseLines({ categoryAccountId: await categoryOf(fandri.database, bookId, 'Groceries'), paymentAccountId: fandri.bank, amountMinor: 16_200, currency: 'IDR' }),
  });
  await home.settle();
  expect(await projectBook(fandri.database, bookId)).toEqual(await projectBook(dewi.database, bookId));

  const before = {
    posted: await postedIn(fandri, bookId),
    spent: await spentIn(fandri, bookId),
    bank: await balanceOf(fandri, fandri.bank),
    lineages: await lineagesOf(fandri, bookId),
  };
  expect(before.posted).toBe(3);
  expect(before.spent).toBe(41_300 + 27_500 + 16_200);
  expect(before.bank).toBe(-(27_500 + 16_200));
  // Dewi's purchase sits on her placeholder on Fandri's phone; the lineages name who paid.
  expect(before.lineages).toEqual(
    [
      [dewiMarket, expect.any(String), dewi.memberId],
      [fandriMarket, fandriMarket, fandri.memberId],
      [pharmacy, pharmacyHead, fandri.memberId],
    ].sort((a, b) => ((a[0] as string) < (b[0] as string) ? -1 : 1)),
  );
  const dewiHead = before.lineages.find(([id]) => id === dewiMarket)![1]!;

  await fandri.engine.leave(bookId);
  expect((await fandri.database.db.values<[string]>(sql`SELECT state FROM shared_books WHERE book_id = ${bookId}`))[0]![0]).toBe('unshared');
  await fandri.database.db.run(sql`DELETE FROM sync_lineage WHERE book_id = ${bookId}`);
  if (options.clocks) await fandri.database.db.run(sql`DELETE FROM sync_field_clocks WHERE book_id = ${bookId} AND entity = 'purchase'`);

  // recordLineagesTx on its own, rolled back: one lineage per posted purchase, rooted where capture roots it, headed by
  // the row here, paid by whoever's money side it is on (Dewi's sits on her placeholder here); a second run finds none.
  const probe = new Error('rolled back');
  await expect(
    fandri.database.transaction(async (tx) => {
      expect(await recordLineagesTx(tx, { bookId, memberId: fandri.memberId, epoch: 0 })).toBe(3);
      expect(await recordLineagesTx(tx, { bookId, memberId: fandri.memberId, epoch: 0 })).toBe(0);
      expect(await tx.values(sql`SELECT lineage_id, head_transaction_id, paid_by FROM sync_lineage WHERE book_id = ${bookId} ORDER BY lineage_id`)).toEqual(before.lineages);
      throw probe;
    }),
  ).rejects.toBe(probe);
  expect(await lineagesOf(fandri, bookId)).toEqual([]);

  // A device that left counts for nothing in the log from then on (I2), so Fandri comes back as a new device over the
  // same database, as a restored or reinstalled phone does (edges.test: a restored phone of a member who left rejoins).
  const back = await home.restore(fandri, await fandri.database.exportBytes());
  const { code } = await dewi.engine.createInvite(bookId, { inviterName: 'Dewi', sameMember: true, memberId: fandri.memberId });
  const joined = await back.engine.joinBook(code, { ws: back.ws, memberName: 'Fandri', deviceName: "Fandri's phone" });
  await home.settle();
  return { home, dewi, fandri: back, bookId, joined, before, dewiMarket, dewiHead, fandriMarket, pharmacy, pharmacyHead };
}

describe('a same-book rejoin of a copy with no lineages (D-A6)', () => {
  for (const clocks of [false, true]) {
    const what = clocks ? 'no lineages and no purchase clocks' : 'no lineages';
    it(`${what}: every purchase is edited in place, none is posted twice`, async () => {
      const { dewi, fandri, bookId, joined, before, dewiMarket, dewiHead, fandriMarket, pharmacy, pharmacyHead } = await rejoinWithoutLineages({ clocks });
      expect(joined.memberId).toBe(fandri.memberId);
      expect(joined.result.stopped).toBeUndefined();
      expect(await skipsOf(fandri.database)).toEqual([]);

      // No duplicates: the same three posted purchases, the same money to the unit on both phones.
      expect(await postedIn(fandri, bookId)).toBe(before.posted);
      expect(await spentIn(fandri, bookId)).toBe(before.spent);
      expect(await balanceOf(fandri, fandri.bank)).toBe(before.bank);
      expect(await postedIn(dewi, bookId)).toBe(3);
      expect(await spentIn(dewi, bookId)).toBe(41_300 + 27_500 + 16_200);

      // No remap (D-A2 never ran): each lineage's head is the row this phone held before the leave, or that row's own
      // replacement as the log's values were written over it, never a second row beside it. For the edited one that row
      // is the chain head, not the voided first version.
      for (const [lineageId, held] of [
        [dewiMarket, dewiHead],
        [fandriMarket, fandriMarket],
        [pharmacy, pharmacyHead],
      ] as const) {
        const head = (await headOf(fandri.database, lineageId))!;
        expect(await postedRowsOf(fandri.database, bookId, lineageId)).toEqual([head]);
        expect(await chainFrom(fandri, held)).toContain(head);
        expect(head).not.toBe(remapId(bookId, lineageId));
      }
      expect(await chainFrom(fandri, pharmacy)).toContain(pharmacyHead);
      const lineages = await lineagesOf(fandri, bookId);
      expect(lineages.map(([id, , paidBy]) => [id, paidBy])).toEqual(
        [
          [dewiMarket, dewi.memberId],
          [fandriMarket, fandri.memberId],
          [pharmacy, fandri.memberId],
        ].sort((a, b) => (a[0]! < b[0]! ? -1 : 1)),
      );
      // No remapped id took a purchase's place: every posted row in the book is the head of one lineage.
      const heads = new Set(lineages.map(([, head]) => head));
      const posted = await fandri.database.db.values<[string]>(
        sql`SELECT t.id FROM transactions t JOIN book_transactions bt ON bt.transaction_id = t.id WHERE bt.book_id = ${bookId} AND t.status = 'posted'`,
      );
      for (const [id] of posted) expect(heads.has(id)).toBe(true);

      expect(await projectBook(fandri.database, bookId)).toEqual(await projectBook(dewi.database, bookId));

      // And it keeps working both ways.
      await spend(fandri, bookId, 'Fandri bakery', 9_900);
      await spend(dewi, bookId, 'Dewi bakery', 12_400);
      const fandriBank = await balanceOf(fandri, fandri.bank);
      expect(fandriBank).toBe(before.bank - 9_900);
      await fandri.engine.syncOnce(bookId);
      await dewi.engine.syncOnce(bookId);
      await fandri.engine.syncOnce(bookId);
      expect(await postedIn(fandri, bookId)).toBe(5);
      expect(await postedIn(dewi, bookId)).toBe(5);
      expect(await balanceOf(fandri, fandri.bank)).toBe(fandriBank);
      expect(await projectBook(fandri.database, bookId)).toEqual(await projectBook(dewi.database, bookId));
    });
  }
});

/** Every posted purchase in the book as description and amount, sorted: what both phones must read alike. */
async function purchasesIn(d: Device, bookId: string): Promise<[string, number][]> {
  const rows = await d.database.db.values<[string, number]>(sql`
    SELECT t.description, e.amount_minor FROM transactions t JOIN book_transactions bt ON bt.transaction_id = t.id
    JOIN entries e ON e.transaction_id = t.id JOIN accounts a ON a.id = e.account_id AND a.kind = 'expense'
    WHERE bt.book_id = ${bookId} AND t.status = 'posted' ORDER BY t.description, e.amount_minor`);
  return rows.map(([description, amount]) => [description, Number(amount)]);
}

/** Every posted row of the book here is the head of exactly one of its lineages, and every live lineage heads one. */
async function expectOneLineagePerRow(d: Device, bookId: string): Promise<void> {
  const posted = (
    await d.database.db.values<[string]>(
      sql`SELECT t.id FROM transactions t JOIN book_transactions bt ON bt.transaction_id = t.id WHERE bt.book_id = ${bookId} AND t.status = 'posted' ORDER BY t.id`,
    )
  ).map(([id]) => id);
  const heads = (
    await d.database.db.values<[string]>(
      sql`SELECT head_transaction_id FROM sync_lineage WHERE book_id = ${bookId} AND head_transaction_id IS NOT NULL ORDER BY head_transaction_id`,
    )
  ).map(([id]) => id);
  expect(heads).toEqual(posted);
}

/** Fandri leaves and keeps the copy as his own; `meanwhile` runs on it; Dewi shares the workspace again and he joins. */
async function keptThenRejoined(home: Household, dewi: Device, fandri: Device, bookId: string, meanwhile: () => Promise<void>) {
  await fandri.engine.leave(bookId);
  await fandri.engine.forgetSharing(bookId);
  await meanwhile();
  await dewi.engine.stopSharing(bookId);
  const again = await dewi.engine.shareBook(bookId, { memberName: 'Dewi', deviceName: "Dewi's phone" });
  home.relayBookId = again.relayBookId;
  await dewi.engine.syncOnce(bookId);
  const { code } = await dewi.engine.createInvite(bookId, { inviterName: 'Dewi', sameMember: true, memberId: fandri.memberId });
  // A share made again is another relay book, so the device that left joins it as itself.
  const joined = await fandri.engine.joinBook(code, { ws: fandri.ws, memberName: 'Fandri', deviceName: "Fandri's phone" });
  expect(joined.result.stopped).toBeUndefined();
  await home.settle();
  await home.settle();
  expect(await skipsOf(fandri.database)).toEqual([]);
  expect(await skipsOf(dewi.database)).toEqual([]);
}

describe('a rejoin of a copy kept as its own (D-A6, fix round 1)', () => {
  it('a remapped purchase edited while kept as own keeps one lineage, so it is never a second purchase', async () => {
    const home = new Household();
    const dewi = await home.device('Dewi');
    const fandri = await home.device('Fandri');
    const bookId = await home.share(dewi);
    const groceries = await categoryOf(dewi.database, bookId, 'Groceries');
    const id = await postTransaction(dewi.database, dewi.ws, {
      occurredOn: '2026-09-10',
      description: 'Dewi market',
      lines: expenseLines({ categoryAccountId: groceries, paymentAccountId: dewi.bank, amountMinor: 41_300, currency: 'IDR' }),
    });
    // Fandri's phone holds a voided leftover under the same id: the purchase arrives remapped (D-A2), so its lineage id
    // is not its chain root here.
    const food = await createAccount(fandri.database, fandri.ws, { name: 'Food', kind: 'expense', subtype: 'category', currency: null });
    await postTransaction(fandri.database, fandri.ws, {
      id,
      occurredOn: '2026-01-01',
      description: 'leftover',
      lines: expenseLines({ categoryAccountId: food.id, paymentAccountId: fandri.bank, amountMinor: 1_000, currency: 'IDR' }),
    });
    await voidTransaction(fandri.database, fandri.ws, id);
    await home.join(fandri, dewi);
    await home.settle();
    expect(await headOf(fandri.database, id)).toBe(remapId(bookId, id));
    const fandriBank = await balanceOf(fandri, fandri.bank);

    await keptThenRejoined(home, dewi, fandri, bookId, async () => {
      // Renamed in his own copy, nothing captured: the lineage still names the row before the edit.
      const [[placeholder]] = (await fandri.database.db.values<[string]>(
        sql`SELECT account_id FROM book_member_accounts WHERE book_id = ${bookId} AND member_id = ${dewi.memberId}`,
      )) as [[string]];
      await replaceTransaction(fandri.database, fandri.ws, (await headOf(fandri.database, id))!, {
        occurredOn: '2026-09-10',
        description: 'Dewi market, renamed',
        lines: expenseLines({ categoryAccountId: await categoryOf(fandri.database, bookId, 'Groceries'), paymentAccountId: placeholder, amountMinor: 41_300, currency: 'IDR' }),
      });
    });

    const lineages = await fandri.database.db.values<[string]>(sql`SELECT lineage_id FROM sync_lineage WHERE book_id = ${bookId}`);
    expect(lineages).toEqual([[id]]);
    await expectOneLineagePerRow(fandri, bookId);
    expect(await purchasesIn(fandri, bookId)).toEqual(await purchasesIn(dewi, bookId));
    expect(await purchasesIn(dewi, bookId)).toHaveLength(1);
    expect(await balanceOf(dewi, dewi.bank)).toBe(-41_300);
    expect(await balanceOf(fandri, fandri.bank)).toBe(fandriBank);
    expect(await projectBook(fandri.database, bookId)).toEqual(await projectBook(dewi.database, bookId));

    // Dewi edits it afterwards: one purchase on both phones, at her figure.
    await replaceTransaction(dewi.database, dewi.ws, (await headOf(dewi.database, id))!, {
      occurredOn: '2026-09-10',
      description: 'Dewi market',
      lines: expenseLines({ categoryAccountId: groceries, paymentAccountId: dewi.bank, amountMinor: 45_000, currency: 'IDR' }),
    });
    await home.settle();
    await expectOneLineagePerRow(fandri, bookId);
    expect(await purchasesIn(fandri, bookId)).toEqual([['Dewi market', 45_000]]);
    expect(await purchasesIn(dewi, bookId)).toEqual([['Dewi market', 45_000]]);
    expect(await balanceOf(dewi, dewi.bank)).toBe(-45_000);
    expect(await balanceOf(fandri, fandri.bank)).toBe(fandriBank);
    expect(await projectBook(fandri.database, bookId)).toEqual(await projectBook(dewi.database, bookId));
  });

  it('an edit and a new purchase made while kept as own each reach the partner once, the bank exact', async () => {
    const home = new Household();
    const dewi = await home.device('Dewi');
    const fandri = await home.device('Fandri');
    const bookId = await home.share(dewi);
    await home.join(fandri, dewi);
    const market = await spend(fandri, bookId, 'Fandri market', 30_000);
    await spend(dewi, bookId, 'Dewi market', 50_000);
    await home.settle();

    let bankBefore = 0;
    await keptThenRejoined(home, dewi, fandri, bookId, async () => {
      await replaceTransaction(fandri.database, fandri.ws, (await headOf(fandri.database, market))!, {
        occurredOn: '2026-09-10',
        description: 'Fandri market',
        lines: expenseLines({ categoryAccountId: await categoryOf(fandri.database, bookId, 'Groceries'), paymentAccountId: fandri.bank, amountMinor: 31_000, currency: 'IDR' }),
      });
      await spend(fandri, bookId, 'Fandri bakery', 9_000);
      bankBefore = await balanceOf(fandri, fandri.bank);
    });
    expect(bankBefore).toBe(-(31_000 + 9_000));

    const expected: [string, number][] = [
      ['Dewi market', 50_000],
      ['Fandri bakery', 9_000],
      ['Fandri market', 31_000],
    ];
    expect(await purchasesIn(fandri, bookId)).toEqual(expected);
    expect(await purchasesIn(dewi, bookId)).toEqual(expected);
    expect(await balanceOf(fandri, fandri.bank)).toBe(bankBefore);
    expect(await balanceOf(dewi, dewi.bank)).toBe(-50_000);
    await expectOneLineagePerRow(fandri, bookId);
    await expectOneLineagePerRow(dewi, bookId);
    expect(await projectBook(fandri.database, bookId)).toEqual(await projectBook(dewi.database, bookId));
  });
});

describe('a void lineage rooted at a row back in the book (fix round 1, M4)', () => {
  it('records nothing and sends nothing for it, as capture says nothing more under a void lineage', async () => {
    const home = new Household();
    const dewi = await home.device('Dewi');
    const fandri = await home.device('Fandri');
    const bookId = await home.share(dewi);
    await home.join(fandri, dewi);
    const market = await spend(fandri, bookId, 'Fandri market', 27_500);
    await home.settle();
    // Moved out of the book and back under the same id: the lineage went void while it was out, the row is posted here.
    await fandri.database.db.run(sql`UPDATE sync_lineage SET head_transaction_id = NULL WHERE lineage_id = ${market}`);
    const probe = new Error('rolled back');
    await expect(
      fandri.database.transaction(async (tx) => {
        const book = { bookId, memberId: fandri.memberId, epoch: 0 };
        expect(await recordLineagesTx(tx, book, { rejoin: true })).toBe(0);
        const ops = await rowsInScopeTx(tx, book, () => true, { device: false });
        expect(ops.filter((op) => op.entity === 'purchase')).toEqual([]);
        throw probe;
      }),
    ).rejects.toBe(probe);
    expect(await lineagesOf(fandri, bookId)).toEqual([[market, null, fandri.memberId]]);
  });
});
