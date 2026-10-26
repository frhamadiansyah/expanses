import { expenseLines, isoDate, transferLines } from '@expanses/core';
import { sql } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import {
  confirmReview,
  createBook,
  getJointAccount,
  inBook,
  jointAccountRows,
  paidFromAccount,
  paidWithItems,
  postTransaction,
  replaceTransaction,
  setJointAccount,
  setShareSetting,
  voidTransaction,
} from '../../src/index';
import { applyChangeSet } from '../../src/sync/apply';
import { encodeHlc } from '../../src/sync/hlc';
import { itemIdOf, receivedItems } from '../../src/sync/net-worth/summaries';
import type { ChangeSet } from '../../src/sync/types';
import { categoryOf, headOf, Household, skipsOf, type Device } from './household';

/*
 * The Joint account switch (0095). Rina holds a bank account she shares with the household, and turns Joint on. Andi
 * (her partner) then pays from it in the shared workspace, both of them see the rows recorded in the shared workspace
 * against it with who recorded each, and only the person who recorded a row may change it.
 */

const today = isoDate();

async function settle(home: Household) {
  for (let i = 0; i < 3; i += 1) await home.settle();
}

async function sharing() {
  const home = new Household();
  const rina = await home.device('Rina');
  const andi = await home.device('Andi');
  const bookId = await home.share(rina);
  await home.join(andi, rina);
  await home.settle();
  const proposalId = await rina.engine.proposeNetWorth(bookId, { mode: 'separate', members: [andi.memberId] });
  await settle(home);
  await andi.engine.answerNetWorth(bookId, proposalId, 'confirm');
  await settle(home);
  await confirmReview(rina.database, rina.ws, { [rina.bank]: 'total', [rina.cash]: 'total' });
  await confirmReview(andi.database, andi.ws, {});
  await settle(home);
  const groupBookId = (await rina.engine.netWorthGroup(bookId)).groupBookId!;
  const item = await itemIdOf(groupBookId, rina.bank);
  const groceries = await categoryOf(andi.database, bookId, 'Groceries');
  return { home, rina, andi, bookId, groupBookId, item, groceries };
}

type S = Awaited<ReturnType<typeof sharing>>;

async function balanceOf(d: Device, accountId: string): Promise<number> {
  const [row] = await d.database.db.values<[number]>(
    sql`SELECT COALESCE(sum(e.amount_minor), 0) FROM entries e JOIN transactions t ON t.id = e.transaction_id WHERE e.account_id = ${accountId} AND t.status = 'posted'`,
  );
  return Number(row![0]);
}

async function jointItemOn(d: Device, s: S) {
  return (await receivedItems(d.database, s.groupBookId)).find((i) => i.itemId === s.item);
}

/** Andi pays from Rina's joint bank, as the add form does. */
async function andiPays(s: S, amountMinor = 180_000_00, description = 'Groceries'): Promise<string> {
  const item = (await paidWithItems(s.andi.database, s.bookId)).find((i) => i.itemId === s.item)!;
  const account = await paidFromAccount(s.andi.database, s.bookId, item.owner, item.currency);
  return postTransaction(s.andi.database, s.andi.ws, {
    occurredOn: today,
    description,
    lines: expenseLines({ categoryAccountId: s.groceries, paymentAccountId: account, amountMinor, currency: 'IDR' }),
    paidFrom: { owner: item.owner, itemId: item.itemId },
  });
}

async function rinaPays(s: S, amountMinor = 50_000_00, description = 'Water'): Promise<string> {
  const groceries = await categoryOf(s.rina.database, s.bookId, 'Groceries');
  return postTransaction(s.rina.database, s.rina.ws, {
    occurredOn: today,
    description,
    lines: expenseLines({ categoryAccountId: groceries, paymentAccountId: s.rina.bank, amountMinor, currency: 'IDR' }),
  });
}

async function rowsOn(d: Device, s: S, owner: Device) {
  return (await jointAccountRows(d.database, s.bookId, s.item, owner.memberId)).map((r) => [r.kind, r.description, r.amountMinor, r.recordedBy]);
}

describe('the Joint account switch', () => {
  it('is off by default, refused on an account that is not shared, and goes when the share does', async () => {
    const s = await sharing();
    expect(await getJointAccount(s.rina.database, s.rina.bank)).toBe(false);
    await setShareSetting(s.rina.database, s.rina.usd, 'hidden');
    await expect(setJointAccount(s.rina.database, s.rina.usd, true)).rejects.toMatchObject({ code: 'item-not-shared' });
    await setJointAccount(s.rina.database, s.rina.bank, true);
    expect(await getJointAccount(s.rina.database, s.rina.bank)).toBe(true);
    await setShareSetting(s.rina.database, s.rina.bank, 'hidden');
    expect(await getJointAccount(s.rina.database, s.rina.bank)).toBe(false);
    await setShareSetting(s.rina.database, s.rina.bank, 'total');
    expect(await getJointAccount(s.rina.database, s.rina.bank)).toBe(false);
  });

  it('reaches the partner with the item, and switching it off reverts', async () => {
    const s = await sharing();
    expect((await jointItemOn(s.andi, s))?.joint).toBeUndefined();
    await setJointAccount(s.rina.database, s.rina.bank, true);
    await settle(s.home);
    expect((await jointItemOn(s.andi, s))?.joint).toBe(true);
    // Paid with still offers it, now as joint.
    expect((await paidWithItems(s.andi.database, s.bookId)).find((i) => i.itemId === s.item)?.joint).toBe(true);
    await setJointAccount(s.rina.database, s.rina.bank, false);
    await settle(s.home);
    expect((await jointItemOn(s.andi, s))?.joint).toBeUndefined();
    expect(await skipsOf(s.andi.database)).toEqual([]);
  });

  it('a purchase Andi records lands once on Rina’s account and balance, and both phones list the same rows', async () => {
    const s = await sharing();
    await setJointAccount(s.rina.database, s.rina.bank, true);
    await settle(s.home);
    const before = await balanceOf(s.rina, s.rina.bank);
    const byAndi = await andiPays(s);
    await settle(s.home);
    await settle(s.home);
    expect(await balanceOf(s.rina, s.rina.bank)).toBe(before - 180_000_00);
    const rinaHead = (await headOf(s.rina.database, byAndi))!;
    const lines = await s.rina.database.db.values(sql`SELECT count(*) FROM entries WHERE transaction_id = ${rinaHead} AND account_id = ${s.rina.bank}`);
    expect(lines).toEqual([[1]]);

    await rinaPays(s);
    await settle(s.home);
    const mine = await rowsOn(s.rina, s, s.rina);
    const theirs = await rowsOn(s.andi, s, s.rina);
    expect(mine).toEqual(theirs);
    expect(mine).toHaveLength(2);
    expect(mine.map((r) => [r[1], r[3]]).sort()).toEqual([['Groceries', s.andi.memberId], ['Water', s.rina.memberId]]);
    // The balance stays on Rina's phone; Andi's copy is the summary she sent.
    expect((await jointItemOn(s.andi, s))?.balanceMinor).toBe(await balanceOf(s.rina, s.rina.bank));
  });

  it('a row recorded in a private workspace never reaches the partner or the list', async () => {
    const s = await sharing();
    await setJointAccount(s.rina.database, s.rina.bank, true);
    const privateBook = await createBook(s.rina.database, s.rina.ws, { name: 'Business', kind: 'business', baseCurrency: 'IDR', copyCategoriesFrom: s.bookId });
    const category = await categoryOf(s.rina.database, privateBook, 'Groceries');
    await postTransaction(s.rina.database, s.rina.ws, {
      occurredOn: today,
      description: 'Private supplier',
      lines: expenseLines({ categoryAccountId: category, paymentAccountId: s.rina.bank, amountMinor: 77_000_00, currency: 'IDR' }),
    });
    await postTransaction(s.rina.database, inBook(s.rina.ws, privateBook), {
      occurredOn: today,
      description: 'Private move',
      fileTransfer: true,
      lines: transferLines({ fromAccountId: s.rina.bank, toAccountId: s.rina.cash, amountMinor: 11_000_00, currency: 'IDR' }),
    });
    await settle(s.home);
    expect(await rowsOn(s.rina, s, s.rina)).toEqual([]);
    expect(await rowsOn(s.andi, s, s.rina)).toEqual([]);
    const seen = JSON.stringify(await s.andi.database.db.values(sql`SELECT * FROM sync_lineage`)) + JSON.stringify(await s.andi.database.db.values(sql`SELECT * FROM shared_transfers`));
    expect(seen).not.toContain('Private');
  });

  it('a transfer from the joint account names it on both phones and is listed on the account', async () => {
    const s = await sharing();
    await setJointAccount(s.rina.database, s.rina.bank, true);
    await settle(s.home);
    await postTransaction(s.rina.database, inBook(s.rina.ws, s.bookId), {
      occurredOn: today,
      description: 'Cash withdrawal',
      fileTransfer: true,
      lines: transferLines({ fromAccountId: s.rina.bank, toAccountId: s.rina.cash, amountMinor: 500_000_00, currency: 'IDR' }),
    });
    await settle(s.home);
    const mine = await rowsOn(s.rina, s, s.rina);
    expect(mine).toEqual([['transfer', 'Cash withdrawal', -500_000_00, s.rina.memberId]]);
    expect(await rowsOn(s.andi, s, s.rina)).toEqual(mine);
    const [named] = await s.andi.database.db.values<[string, string | null]>(sql`SELECT from_name, to_item FROM shared_transfers`);
    expect(named![0]).toBe('Rina Bank');
  });

  it('with the switch off the partner lists no rows, only the balance', async () => {
    const s = await sharing();
    await andiPays(s, 10_000_00);
    await settle(s.home);
    // Rows exist in the lineage as ever, but no row is a joint account's: the page lists them only for a joint item.
    expect((await jointItemOn(s.andi, s))?.joint).toBeUndefined();
    expect((await jointItemOn(s.andi, s))?.balanceMinor).toBeDefined();
  });
});

describe('who may change a joint row', () => {
  async function jointWithRows() {
    const s = await sharing();
    await setJointAccount(s.rina.database, s.rina.bank, true);
    await settle(s.home);
    const byAndi = await andiPays(s);
    const byRina = await rinaPays(s);
    await settle(s.home);
    return { s, byAndi, byRina };
  }

  it('the holder cannot edit or void the partner’s row, nor the partner the holder’s, on their own phone', async () => {
    const { s, byAndi, byRina } = await jointWithRows();
    const rinaHeadOfAndis = (await headOf(s.rina.database, byAndi))!;
    await expect(voidTransaction(s.rina.database, s.rina.ws, rinaHeadOfAndis)).rejects.toMatchObject({ code: 'JOINT_ROW' });
    await expect(
      replaceTransaction(s.rina.database, s.rina.ws, rinaHeadOfAndis, {
        occurredOn: today,
        description: 'Changed',
        lines: expenseLines({ categoryAccountId: s.groceries, paymentAccountId: s.rina.bank, amountMinor: 1, currency: 'IDR' }),
      }),
    ).rejects.toMatchObject({ code: 'JOINT_ROW' });
    const andiHeadOfRinas = (await headOf(s.andi.database, byRina))!;
    await expect(voidTransaction(s.andi.database, s.andi.ws, andiHeadOfRinas)).rejects.toMatchObject({ code: 'JOINT_ROW' });
  });

  it('the recorder edits and voids their own row, and the other phone follows', async () => {
    const { s, byAndi } = await jointWithRows();
    const head = (await headOf(s.andi.database, byAndi))!;
    const placeholder = (await s.andi.database.db.values<[string]>(sql`SELECT account_id FROM entries WHERE transaction_id = ${head} AND account_id <> ${s.groceries} AND account_id IN (SELECT account_id FROM book_member_accounts)`))[0]![0];
    const edited = await replaceTransaction(s.andi.database, s.andi.ws, head, {
      occurredOn: today,
      description: 'Groceries, corrected',
      lines: expenseLines({ categoryAccountId: s.groceries, paymentAccountId: placeholder, amountMinor: 200_000_00, currency: 'IDR' }),
    });
    await settle(s.home);
    expect((await rowsOn(s.rina, s, s.rina)).map((r) => [r[1], r[2]])).toContainEqual(['Groceries, corrected', -200_000_00]);
    await voidTransaction(s.andi.database, s.andi.ws, edited);
    await settle(s.home);
    expect((await rowsOn(s.rina, s, s.rina)).map((r) => r[1])).toEqual(['Water']);
    expect(await rowsOn(s.andi, s, s.rina)).toEqual(await rowsOn(s.rina, s, s.rina));
  });

  it('a modified phone’s void of the other’s row is a recorded skip on the receiving phone and the row stays; the recorder’s own void counts', async () => {
    const { s, byAndi, byRina } = await jointWithRows();
    // A void as a modified client would write it straight into the log, signed by `by`'s device.
    const voidOf = (by: Device, lineage: string, offset: number): ChangeSet => ({
      v: 1,
      hlc: encodeHlc(Date.now() + offset, 0, by.deviceId),
      member: by.memberId,
      ops: [{ entity: 'purchase', id: lineage, op: 'upsert', fields: { void: 1 } }],
    });
    const skipsBefore = (await skipsOf(s.andi.database)).length;
    // Rina's phone voids Andi's row: Andi's phone refuses it.
    await applyChangeSet(s.andi.database, s.bookId, voidOf(s.rina, byAndi, 5_000));
    expect(await headOf(s.andi.database, byAndi)).not.toBeNull();
    expect((await skipsOf(s.andi.database)).length).toBeGreaterThan(skipsBefore);
    // Andi's phone voids Rina's row: Rina's phone refuses it.
    await applyChangeSet(s.rina.database, s.bookId, voidOf(s.andi, byRina, 6_000));
    expect(await headOf(s.rina.database, byRina)).not.toBeNull();
    // Control: the recorder's own void is taken, on the other phone.
    await applyChangeSet(s.rina.database, s.bookId, voidOf(s.andi, byAndi, 7_000));
    expect(await headOf(s.rina.database, byAndi)).toBeNull();
    await applyChangeSet(s.andi.database, s.bookId, voidOf(s.rina, byRina, 8_000));
    expect(await headOf(s.andi.database, byRina)).toBeNull();
  });

  it('with the switch off nothing is locked: either may still change a row paid from the account', async () => {
    const s = await sharing();
    const byAndi = await andiPays(s);
    await settle(s.home);
    const head = (await headOf(s.rina.database, byAndi))!;
    await voidTransaction(s.rina.database, s.rina.ws, head);
    await settle(s.home);
    expect(await headOf(s.andi.database, byAndi)).toBeNull();
  });
});
