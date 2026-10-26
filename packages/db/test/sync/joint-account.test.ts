import { expenseLines, isoDate, transferLines } from '@expanses/core';
import { sql } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import {
  confirmReview,
  createBook,
  createCardAccount,
  saveCardTerms,
  getJointAccount,
  inBook,
  jointAccountRows,
  editMemberTransfer,
  jointRowNote,
  memberTransferUnposted,
  recordMemberTransfer,
  voidMemberTransfer,
  restoreJointRow,
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
 * The Joint account switch (0097). Rina holds a bank account she shares with the household, and turns Joint on. Andi
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
  return (await jointAccountRows(d.database, s.bookId, s.item, owner.memberId)).filter((r) => !r.deleted).map((r) => [r.kind, r.description, r.amountMinor, r.recordedBy]);
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

describe('equal rights on a joint row', () => {
  async function jointWithRows() {
    const s = await sharing();
    await setJointAccount(s.rina.database, s.rina.bank, true);
    await settle(s.home);
    const byAndi = await andiPays(s);
    const byRina = await rinaPays(s);
    await settle(s.home);
    return { s, byAndi, byRina };
  }

  /** The member placeholder (or own account) a head's money line is on, so an edit keeps paying from the same side. */
  async function paymentAccountOf(d: Device, head: string, groceries: string): Promise<string> {
    return (await d.database.db.values<[string]>(sql`SELECT account_id FROM entries WHERE transaction_id = ${head} AND account_id <> ${groceries}`))[0]![0];
  }

  it('the holder edits and then voids the partner’s row, and the partner’s phone follows both', async () => {
    const { s, byAndi } = await jointWithRows();
    const before = await balanceOf(s.rina, s.rina.bank);
    const head = (await headOf(s.rina.database, byAndi))!;
    const edited = await replaceTransaction(s.rina.database, s.rina.ws, head, {
      occurredOn: today,
      description: 'Groceries, Rina corrected',
      lines: expenseLines({ categoryAccountId: s.groceries, paymentAccountId: await paymentAccountOf(s.rina, head, s.groceries), amountMinor: 100_000_00, currency: 'IDR' }),
      paidFrom: undefined,
    });
    await settle(s.home);
    await settle(s.home);
    // Balance moved once: 180k out became 100k out.
    expect(await balanceOf(s.rina, s.rina.bank)).toBe(before + 80_000_00);
    expect((await rowsOn(s.andi, s, s.rina)).map((r) => [r[1], r[2], r[3]])).toContainEqual(['Groceries, Rina corrected', -100_000_00, s.andi.memberId]);
    expect(await rowsOn(s.andi, s, s.rina)).toEqual(await rowsOn(s.rina, s, s.rina));
    await voidTransaction(s.rina.database, s.rina.ws, edited);
    await settle(s.home);
    await settle(s.home);
    expect(await balanceOf(s.rina, s.rina.bank)).toBe(before + 180_000_00);
    expect((await rowsOn(s.andi, s, s.rina)).map((r) => r[1])).toEqual(['Water']);
    expect(await skipsOf(s.rina.database)).toEqual([]);
    expect(await skipsOf(s.andi.database)).toEqual([]);
  });

  it('the partner edits and then voids the holder’s row, and the holder’s phone follows both', async () => {
    const { s, byRina } = await jointWithRows();
    const before = await balanceOf(s.rina, s.rina.bank);
    const head = (await headOf(s.andi.database, byRina))!;
    const edited = await replaceTransaction(s.andi.database, s.andi.ws, head, {
      occurredOn: today,
      description: 'Water, Andi corrected',
      lines: expenseLines({ categoryAccountId: s.groceries, paymentAccountId: await paymentAccountOf(s.andi, head, s.groceries), amountMinor: 20_000_00, currency: 'IDR' }),
    });
    await settle(s.home);
    await settle(s.home);
    expect(await balanceOf(s.rina, s.rina.bank)).toBe(before + 30_000_00);
    expect((await rowsOn(s.rina, s, s.rina)).map((r) => [r[1], r[2], r[3]])).toContainEqual(['Water, Andi corrected', -20_000_00, s.rina.memberId]);
    expect(await rowsOn(s.andi, s, s.rina)).toEqual(await rowsOn(s.rina, s, s.rina));
    await voidTransaction(s.andi.database, s.andi.ws, edited);
    await settle(s.home);
    await settle(s.home);
    expect(await balanceOf(s.rina, s.rina.bank)).toBe(before + 50_000_00);
    expect((await rowsOn(s.rina, s, s.rina)).map((r) => r[1])).toEqual(['Groceries']);
    expect(await skipsOf(s.rina.database)).toEqual([]);
    expect(await skipsOf(s.andi.database)).toEqual([]);
  });

  it('both edit the same row at once and the phones converge on one answer', async () => {
    const { s, byAndi } = await jointWithRows();
    const rinaHead = (await headOf(s.rina.database, byAndi))!;
    const andiHead = (await headOf(s.andi.database, byAndi))!;
    await replaceTransaction(s.rina.database, s.rina.ws, rinaHead, {
      occurredOn: today,
      description: 'Rina’s words',
      lines: expenseLines({ categoryAccountId: s.groceries, paymentAccountId: await paymentAccountOf(s.rina, rinaHead, s.groceries), amountMinor: 180_000_00, currency: 'IDR' }),
    });
    await replaceTransaction(s.andi.database, s.andi.ws, andiHead, {
      occurredOn: today,
      description: 'Andi’s words',
      lines: expenseLines({ categoryAccountId: s.groceries, paymentAccountId: await paymentAccountOf(s.andi, andiHead, s.groceries), amountMinor: 150_000_00, currency: 'IDR' }),
    });
    for (let i = 0; i < 4; i += 1) await settle(s.home);
    const mine = await rowsOn(s.rina, s, s.rina);
    expect(await rowsOn(s.andi, s, s.rina)).toEqual(mine);
    expect(mine).toHaveLength(2);
    // The holder's balance agrees with the row both phones settled on.
    const settled = mine.find((r) => r[3] === s.andi.memberId)!;
    const base = 1_000_000_00; // nothing else moved but Water (50k) and this row
    void base;
    const row = settled[2] as number;
    expect([-180_000_00, -150_000_00]).toContain(row);
    const [bal] = await s.rina.database.db.values<[number]>(sql`SELECT COALESCE(sum(e.amount_minor), 0) FROM entries e JOIN transactions t ON t.id = e.transaction_id WHERE e.account_id = ${s.rina.bank} AND t.status = 'posted'`);
    const [opening] = await s.rina.database.db.values<[number]>(sql`SELECT COALESCE(sum(e.amount_minor), 0) FROM entries e JOIN transactions t ON t.id = e.transaction_id JOIN accounts a ON a.id = e.account_id WHERE e.account_id = ${s.rina.bank} AND t.status = 'posted' AND t.description NOT IN ('Groceries', 'Water', 'Rina’s words', 'Andi’s words')`);
    expect(Number(bal![0]) - Number(opening![0])).toBe(row - 50_000_00);
    expect(await skipsOf(s.rina.database)).toEqual([]);
    expect(await skipsOf(s.andi.database)).toEqual([]);
  });

  it('a void signed by either phone of the other’s row is taken, on the receiving phone', async () => {
    const { s, byAndi, byRina } = await jointWithRows();
    const voidOf = (by: Device, lineage: string, offset: number): ChangeSet => ({
      v: 1,
      hlc: encodeHlc(Date.now() + offset, 0, by.deviceId),
      member: by.memberId,
      ops: [{ entity: 'purchase', id: lineage, op: 'upsert', fields: { void: 1 } }],
    });
    await applyChangeSet(s.andi.database, s.bookId, voidOf(s.rina, byAndi, 5_000));
    expect(await headOf(s.andi.database, byAndi)).toBeNull();
    await applyChangeSet(s.rina.database, s.bookId, voidOf(s.andi, byRina, 6_000));
    expect(await headOf(s.rina.database, byRina)).toBeNull();
    expect(await skipsOf(s.andi.database)).toEqual([]);
    expect(await skipsOf(s.rina.database)).toEqual([]);
  });

  it('with the switch off nothing changed: either may still change a row paid from the account', async () => {
    const s = await sharing();
    const byAndi = await andiPays(s);
    await settle(s.home);
    const head = (await headOf(s.rina.database, byAndi))!;
    await voidTransaction(s.rina.database, s.rina.ws, head);
    await settle(s.home);
    expect(await headOf(s.andi.database, byAndi)).toBeNull();
  });
});

describe('who changed a joint row, and deleted rows', () => {
  async function paymentAccountOf(d: Device, head: string, groceries: string): Promise<string> {
    return (await d.database.db.values<[string]>(sql`SELECT account_id FROM entries WHERE transaction_id = ${head} AND account_id <> ${groceries}`))[0]![0];
  }
  async function fullRows(d: Device, s: S) {
    return (await jointAccountRows(d.database, s.bookId, s.item, s.rina.memberId)).map((r) => ({ d: r.description, by: r.recordedBy, edited: r.editedBy, deleted: r.deleted, deletedBy: r.deletedBy, amount: r.amountMinor }));
  }
  async function start() {
    const s = await sharing();
    await setJointAccount(s.rina.database, s.rina.bank, true);
    await settle(s.home);
    const byAndi = await andiPays(s);
    await settle(s.home);
    return { s, byAndi };
  }

  it('an edit by the other person reads "edited by" on both phones; an edit by the recorder does not', async () => {
    const { s, byAndi } = await start();
    const head = (await headOf(s.rina.database, byAndi))!;
    await replaceTransaction(s.rina.database, s.rina.ws, head, {
      occurredOn: today,
      description: 'Groceries, fixed',
      lines: expenseLines({ categoryAccountId: s.groceries, paymentAccountId: await paymentAccountOf(s.rina, head, s.groceries), amountMinor: 170_000_00, currency: 'IDR' }),
    });
    await settle(s.home);
    await settle(s.home);
    for (const d of [s.rina, s.andi]) {
      expect(await fullRows(d, s)).toEqual([{ d: 'Groceries, fixed', by: s.andi.memberId, edited: s.rina.memberId, deleted: false, deletedBy: null, amount: -170_000_00 }]);
    }
    // The recorder corrects it again: no longer someone else's edit.
    const again = (await headOf(s.andi.database, byAndi))!;
    await replaceTransaction(s.andi.database, s.andi.ws, again, {
      occurredOn: today,
      description: 'Groceries, final',
      lines: expenseLines({ categoryAccountId: s.groceries, paymentAccountId: await paymentAccountOf(s.andi, again, s.groceries), amountMinor: 170_000_00, currency: 'IDR' }),
    });
    await settle(s.home);
    await settle(s.home);
    for (const d of [s.rina, s.andi]) expect((await fullRows(d, s))[0]).toMatchObject({ d: 'Groceries, final', edited: null });
    const note = await jointRowNote(s.rina.database, (await headOf(s.rina.database, byAndi))!);
    expect(note).toMatchObject({ recordedBy: s.andi.memberId, editedBy: null });
  });

  it('a deleted row stays listed as deleted on both phones, with who deleted it, and either person restores it', async () => {
    const { s, byAndi } = await start();
    const before = await balanceOf(s.rina, s.rina.bank);
    await voidTransaction(s.rina.database, s.rina.ws, (await headOf(s.rina.database, byAndi))!);
    await settle(s.home);
    await settle(s.home);
    expect(await balanceOf(s.rina, s.rina.bank)).toBe(before + 180_000_00);
    for (const d of [s.rina, s.andi]) {
      expect(await fullRows(d, s)).toEqual([{ d: 'Groceries', by: s.andi.memberId, edited: null, deleted: true, deletedBy: s.rina.memberId, amount: -180_000_00 }]);
    }
    // The partner restores the holder's deletion: the balance moves once more, both lists show a live row again.
    const lineage = (await jointAccountRows(s.andi.database, s.bookId, s.item, s.rina.memberId))[0]!.key;
    await restoreJointRow(s.andi.database, inBook(s.andi.ws, s.bookId), lineage);
    await settle(s.home);
    await settle(s.home);
    expect(await balanceOf(s.rina, s.rina.bank)).toBe(before);
    for (const d of [s.rina, s.andi]) {
      const rows = await fullRows(d, s);
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({ d: 'Groceries', deleted: false, amount: -180_000_00 });
    }
    expect(await skipsOf(s.rina.database)).toEqual([]);
    expect(await skipsOf(s.andi.database)).toEqual([]);
  });

  it('the partner deletes the holder’s row and the holder restores it', async () => {
    const s = await sharing();
    await setJointAccount(s.rina.database, s.rina.bank, true);
    await settle(s.home);
    const byRina = await rinaPays(s);
    await settle(s.home);
    const before = await balanceOf(s.rina, s.rina.bank);
    await voidTransaction(s.andi.database, s.andi.ws, (await headOf(s.andi.database, byRina))!);
    await settle(s.home);
    await settle(s.home);
    for (const d of [s.rina, s.andi]) expect(await fullRows(d, s)).toMatchObject([{ d: 'Water', deleted: true, deletedBy: s.andi.memberId, by: s.rina.memberId }]);
    const lineage = (await jointAccountRows(s.rina.database, s.bookId, s.item, s.rina.memberId))[0]!.key;
    await restoreJointRow(s.rina.database, inBook(s.rina.ws, s.bookId), lineage);
    await settle(s.home);
    await settle(s.home);
    expect(await balanceOf(s.rina, s.rina.bank)).toBe(before);
    for (const d of [s.rina, s.andi]) expect(await fullRows(d, s)).toMatchObject([{ d: 'Water', deleted: false }]);
  });
});

describe('a joint credit card', () => {
  it('lists its purchases on both phones, either person changes them, and the balance stays on the holder’s phone', async () => {
    const s = await sharing();
    const card = await createCardAccount(s.rina.database, s.rina.ws, { name: 'Rina Card', subtype: 'credit_card', currency: 'IDR', last4: '1234' });
    await saveCardTerms(s.rina.database, s.rina.ws, { accountId: card.id, statementDay: 25, dueDay: 10, creditLimitMinor: 50_000_000_00, annualFeeMinor: null });
    await setShareSetting(s.rina.database, card.id, 'total');
    await setJointAccount(s.rina.database, card.id, true);
    await settle(s.home);
    const cardItem = await itemIdOf(s.groupBookId, card.id);
    const item = (await paidWithItems(s.andi.database, s.bookId)).find((i) => i.itemId === cardItem)!;
    expect(item.joint).toBe(true);
    const account = await paidFromAccount(s.andi.database, s.bookId, item.owner, item.currency);
    const byAndi = await postTransaction(s.andi.database, s.andi.ws, {
      occurredOn: today,
      description: 'Dinner',
      lines: expenseLines({ categoryAccountId: s.groceries, paymentAccountId: account, amountMinor: 250_000_00, currency: 'IDR' }),
      paidFrom: { owner: item.owner, itemId: item.itemId },
    });
    await settle(s.home);
    await settle(s.home);
    const owed = async () => 0 - (await balanceOf(s.rina, card.id));
    expect(await owed()).toBe(250_000_00);
    const rows = async (d: Device) => (await jointAccountRows(d.database, s.bookId, cardItem, s.rina.memberId)).map((r) => [r.description, r.amountMinor, r.recordedBy, r.editedBy, r.deleted]);
    expect(await rows(s.rina)).toEqual([['Dinner', -250_000_00, s.andi.memberId, null, false]]);
    expect(await rows(s.andi)).toEqual(await rows(s.rina));
    // The holder corrects the partner's charge: the card's balance moves once, both lists say who.
    const head = (await headOf(s.rina.database, byAndi))!;
    const placeholder = (await s.rina.database.db.values<[string]>(sql`SELECT account_id FROM entries WHERE transaction_id = ${head} AND account_id <> ${s.groceries}`))[0]![0];
    await replaceTransaction(s.rina.database, s.rina.ws, head, {
      occurredOn: today,
      description: 'Dinner',
      lines: expenseLines({ categoryAccountId: s.groceries, paymentAccountId: placeholder, amountMinor: 200_000_00, currency: 'IDR' }),
    });
    await settle(s.home);
    await settle(s.home);
    expect(await owed()).toBe(200_000_00);
    expect(await rows(s.andi)).toEqual([['Dinner', -200_000_00, s.andi.memberId, s.rina.memberId, false]]);
    expect(await rows(s.rina)).toEqual(await rows(s.andi));
    // The partner deletes it; the card is clear, the row stays as deleted on both.
    await voidTransaction(s.andi.database, s.andi.ws, (await headOf(s.andi.database, byAndi))!);
    await settle(s.home);
    await settle(s.home);
    expect(await owed()).toBe(0);
    expect((await rows(s.rina)).map((r) => r[4])).toEqual([true]);
    expect(await rows(s.andi)).toEqual(await rows(s.rina));
    expect((await jointItemOn(s.andi, { ...s, item: cardItem } as S))?.balanceMinor).toBe(0);
  });
});

describe('the partner moves money out of and into the joint account', () => {
  const JT = 1_000_000_00;
  async function start() {
    const s = await sharing();
    await setJointAccount(s.rina.database, s.rina.bank, true);
    await settle(s.home);
    return s;
  }
  const withdraw = (s: S, amountMinor = 3 * JT) =>
    recordMemberTransfer(s.andi.database, s.bookId, {
      occurredOn: today,
      amountMinor,
      currency: 'IDR',
      from: { owner: s.rina.memberId, itemId: s.item },
      to: { owner: s.andi.memberId, itemId: 'not-shared' },
      description: null,
      ownAccountId: s.andi.cash,
    });
  const transferRows = async (d: Device, s: S) => (await jointAccountRows(d.database, s.bookId, s.item, s.rina.memberId)).filter((r) => r.kind === 'transfer');

  it('a withdrawal to the partner’s private account lands once on each side, names the joint account on both, and keeps the account private', async () => {
    const s = await start();
    const rinaBefore = await balanceOf(s.rina, s.rina.bank);
    const cashBefore = await balanceOf(s.andi, s.andi.cash);
    const id = await withdraw(s);
    await settle(s.home);
    await settle(s.home);
    expect(await balanceOf(s.rina, s.rina.bank)).toBe(rinaBefore - 3 * JT);
    expect(await balanceOf(s.andi, s.andi.cash)).toBe(cashBefore + 3 * JT);
    const rinaRows = await transferRows(s.rina, s);
    const andiRows = await transferRows(s.andi, s);
    expect(rinaRows).toHaveLength(1);
    expect(andiRows).toHaveLength(1);
    for (const row of [rinaRows[0]!, andiRows[0]!]) {
      expect(row).toMatchObject({ amountMinor: -3 * JT, recordedBy: s.andi.memberId, key: id });
      expect(row.description).toContain('Rina Bank');
    }
    // Rina's phone never learns which account of Andi's it was.
    const seen = JSON.stringify(await s.rina.database.db.values(sql`SELECT * FROM member_transfers`));
    expect(seen).not.toContain(s.andi.cash);
    expect(await s.rina.database.db.values(sql`SELECT * FROM member_transfer_accounts`)).toEqual([]);
    expect(await memberTransferUnposted(s.rina.database, s.groupBookId)).toEqual([]);
    expect(await memberTransferUnposted(s.andi.database, s.groupBookId)).toEqual([]);
    // Rina's summary agrees with her ledger.
    expect((await jointItemOn(s.andi, s))?.balanceMinor).toBe(await balanceOf(s.rina, s.rina.bank));
  });

  it('either person edits and deletes it, and both phones follow', async () => {
    const s = await start();
    const rinaBefore = await balanceOf(s.rina, s.rina.bank);
    const cashBefore = await balanceOf(s.andi, s.andi.cash);
    const id = await withdraw(s);
    await settle(s.home);
    await editMemberTransfer(s.rina.database, s.bookId, id, { amountMinor: 2 * JT });
    await settle(s.home);
    await settle(s.home);
    expect(await balanceOf(s.rina, s.rina.bank)).toBe(rinaBefore - 2 * JT);
    expect(await balanceOf(s.andi, s.andi.cash)).toBe(cashBefore + 2 * JT);
    expect((await transferRows(s.andi, s))[0]!.amountMinor).toBe(-2 * JT);
    await voidMemberTransfer(s.andi.database, s.bookId, id);
    await settle(s.home);
    await settle(s.home);
    expect(await balanceOf(s.rina, s.rina.bank)).toBe(rinaBefore);
    expect(await balanceOf(s.andi, s.andi.cash)).toBe(cashBefore);
    expect(await transferRows(s.rina, s)).toEqual([]);
    expect(await transferRows(s.andi, s)).toEqual([]);
  });

  it('a deposit from the partner’s private account into the joint account works the other way round', async () => {
    const s = await start();
    const rinaBefore = await balanceOf(s.rina, s.rina.bank);
    await recordMemberTransfer(s.andi.database, s.bookId, {
      occurredOn: today,
      amountMinor: JT,
      currency: 'IDR',
      from: { owner: s.andi.memberId, itemId: 'not-shared' },
      to: { owner: s.rina.memberId, itemId: s.item },
      description: 'Top up',
      ownAccountId: s.andi.cash,
    });
    await settle(s.home);
    await settle(s.home);
    expect(await balanceOf(s.rina, s.rina.bank)).toBe(rinaBefore + JT);
    expect((await transferRows(s.rina, s))[0]).toMatchObject({ amountMinor: JT, description: 'Top up' });
    expect(await transferRows(s.andi, s)).toHaveLength(1);
  });

  it('is refused against an account that is not joint, and a modified phone’s record against one is not posted', async () => {
    const s = await sharing();
    await expect(withdraw(s)).rejects.toMatchObject({ code: 'item-not-shared' });
    // Joint on at the record, off by the time Rina's phone reads it: nothing is posted on her books.
    await setJointAccount(s.rina.database, s.rina.bank, true);
    await settle(s.home);
    const rinaBefore = await balanceOf(s.rina, s.rina.bank);
    await withdraw(s);
    await setJointAccount(s.rina.database, s.rina.bank, false);
    await settle(s.home);
    await settle(s.home);
    expect(await balanceOf(s.rina, s.rina.bank)).toBe(rinaBefore);
    expect((await memberTransferUnposted(s.rina.database, s.groupBookId)).map((r) => r.reason)).toEqual(['not-joint']);
  });
});
