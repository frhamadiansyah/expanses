import { expenseLines, isoDate } from '@expanses/core';
import { sql } from 'drizzle-orm';
import { describe, expect, it, vi } from 'vitest';
import {
  archiveAccount,
  assetValuesAt,
  createAccount,
  createBook,
  createCardAccount,
  deleteUnusedAccount,
  personalBook,
  postTransaction,
  postTransactionTx,
  recordValuation,
  replaceTransaction,
  saveAssetProfile,
  saveCardTerms,
  voidTransaction,
} from '../../src/index';
import { AuthorityError } from '../../src/sync/authority';
import { withCapture } from '../../src/sync/capture';
import { encodeHlc } from '../../src/sync/hlc';
import { computeItemSummary, itemIdOf, receivedItems, sendSummariesTx } from '../../src/sync/net-worth/summaries';
import type { ChangeSet } from '../../src/sync/types';
import { categoryOf, headOf, Household, type Device } from './household';

/*
 * Summaries — compute, send, receive (joint-net-worth spec §5.2, §9, §10, task 6). Rina and Andi are the net-worth group;
 * Sari is in the workspace and not in the group. Each shared item's balance, chart and one other-use total leave the
 * owner's phone, in the group log only; what a private (non-Household) line was — its amount, description, id — and
 * which local account it sits on never leave it.
 */

const today = isoDate();

async function household() {
  const home = new Household();
  const rina = await home.device('Rina');
  const andi = await home.device('Andi');
  const sari = await home.device('Sari');
  const bookId = await home.share(rina);
  await home.join(andi, rina);
  await home.join(sari, rina);
  await home.settle();
  return { home, rina, andi, sari, bookId };
}

/** A proposal and its confirmation, written the way Task 5's API will: captured, into the group log. */
async function propose(d: Device, groupBookId: string, proposalId: string, mode: 'joint' | 'separate', members: string[]): Promise<void> {
  await d.database.transaction(async (tx) => {
    await withCapture(tx, { entity: 'nw_proposal', id: proposalId, bookId: groupBookId }, async () => {
      await tx.run(sql`
        INSERT INTO nw_proposals (book_id, proposal_id, mode, members_json, proposed_by, created_hlc, cancelled)
        VALUES (${groupBookId}, ${proposalId}, ${mode}, ${JSON.stringify(members)}, ${d.memberId}, ${encodeHlc(Date.now(), 0, d.deviceId)}, 0)`);
    });
    await confirmTx(tx, d, groupBookId, proposalId);
  });
}

async function confirmTx(tx: Parameters<Parameters<Device['database']['transaction']>[0]>[0], d: Device, groupBookId: string, proposalId: string): Promise<void> {
  await withCapture(tx, { entity: 'nw_answer', id: `${proposalId}|${d.memberId}`, bookId: groupBookId }, async () => {
    await tx.run(sql`INSERT INTO nw_answers (book_id, proposal_id, member_id, answer) VALUES (${groupBookId}, ${proposalId}, ${d.memberId}, 'confirm')`);
  });
}

/** Rina opens the group log, admits Andi, and both confirm a proposal of `mode`: an active group. */
async function activeGroup(mode: 'joint' | 'separate' = 'joint') {
  const h = await household();
  const groupBookId = await h.rina.engine.openGroupLog(h.bookId);
  await h.rina.engine.admitToGroupLog(h.bookId, [h.andi.memberId]);
  await h.home.settle();
  await h.home.settle();
  await propose(h.rina, groupBookId, 'proposal-1', mode, [h.rina.memberId, h.andi.memberId]);
  await h.home.settle();
  await h.andi.database.transaction((tx) => confirmTx(tx, h.andi, groupBookId, 'proposal-1'));
  await h.home.settle();
  return { ...h, groupBookId };
}

/** The review's answer for one item (local only, never synced). */
async function setShare(d: Device, accountId: string, setting: 'total' | 'hidden'): Promise<void> {
  await d.database.transaction(async (tx) => {
    await tx.run(sql`INSERT INTO nw_share_settings (account_id, setting) VALUES (${accountId}, ${setting}) ON CONFLICT (account_id) DO UPDATE SET setting = excluded.setting`);
  });
}

/** What Share does after the review: every item's summary, in one transaction. */
const shareAll = (d: Device) => d.database.transaction((tx) => sendSummariesTx(tx, 'all', today));

/** Rina's card: limit 5 jt, statement day 25. */
async function rinaCard(rina: Device): Promise<string> {
  const card = await createCardAccount(rina.database, rina.ws, { name: 'Rina Card', subtype: 'credit_card', currency: 'IDR', last4: '1234' });
  await saveCardTerms(rina.database, rina.ws, { accountId: card.id, statementDay: 25, dueDay: 10, creditLimitMinor: 500_000_000, annualFeeMinor: null });
  return card.id;
}

/** A category of a Business workspace of Rina's own, which is not shared with anyone. */
async function businessCategory(rina: Device, bookId: string): Promise<string> {
  const business = await createBook(rina.database, rina.ws, { name: 'Business', kind: 'business', baseCurrency: 'IDR', copyCategoriesFrom: bookId });
  return categoryOf(rina.database, business, 'Groceries');
}

async function spend(d: Device, categoryId: string, paymentId: string, amountMinor: number, description: string): Promise<string> {
  return postTransaction(d.database, d.ws, {
    occurredOn: today,
    description,
    lines: expenseLines({ categoryAccountId: categoryId, paymentAccountId: paymentId, amountMinor, currency: 'IDR' }),
  });
}

/** Every change-set this device seals for the relay (plaintext, just before sealing), with the book it goes to. */
function recordSealed(d: Device): { bookId: string; changeSet: ChangeSet }[] {
  const seen: { bookId: string; changeSet: ChangeSet }[] = [];
  const seal = d.engine.sealer.seal.bind(d.engine.sealer);
  vi.spyOn(d.engine.sealer, 'seal').mockImplementation(async (bookId, epoch, changeSet) => {
    seen.push({ bookId, changeSet });
    return seal(bookId, epoch, changeSet);
  });
  return seen;
}

/** Every number anywhere in a value, reading JSON-in-a-string fields (a summary travels as JSON text) too. */
function numbersIn(value: unknown, out: number[] = []): number[] {
  if (typeof value === 'number') out.push(value);
  else if (typeof value === 'string') {
    if (/^[[{]/.test(value)) {
      try {
        numbersIn(JSON.parse(value), out);
      } catch {
        // plain text
      }
    }
  } else if (Array.isArray(value)) for (const v of value) numbersIn(v, out);
  else if (value && typeof value === 'object') for (const v of Object.values(value)) numbersIn(v, out);
  return out;
}

const nwOpsOf = (sealed: { changeSet: ChangeSet }[], itemId: string) => sealed.flatMap(({ changeSet }) => changeSet.ops).filter((op) => op.entity === 'nw_item' && op.id === itemId);

describe('summaries: compute, send, receive (joint-net-worth §5.2, §9)', () => {
  it("Rina's card reaches Andi with its Household lines, one other-use total, its balance and its limit", async () => {
    const { home, rina, andi, bookId, groupBookId } = await activeGroup();
    const card = await rinaCard(rina);
    await setShare(rina, card, 'total');
    await shareAll(rina);
    const groceries = await categoryOf(rina.database, bookId, 'Groceries');
    const business = await businessCategory(rina, bookId);
    await spend(rina, groceries, card, 50_000_000, 'Household groceries');
    await spend(rina, business, card, 100_000_000, 'Konsultan PT Rahasia');
    await home.settle();

    const items = await receivedItems(andi.database, groupBookId);
    expect(items).toHaveLength(1);
    const [item] = items;
    expect(item).toMatchObject({
      itemId: await itemIdOf(groupBookId, card),
      owner: rina.memberId,
      kind: 'liability',
      subtype: 'credit_card',
      name: 'Rina Card ···· 1234',
      currency: 'IDR',
      openingMinor: 0,
      householdMinor: 50_000_000,
      otherUseMinor: 100_000_000,
      balanceMinor: 150_000_000,
      asOf: today,
      tax: null,
    });
    expect(item!.card).toMatchObject({ limitMinor: 500_000_000 });
    expect(item!.period).toEqual({ start: item!.card!.cycleStart, end: item!.card!.cycleEnd });
    expect(item!.period.start <= today && today <= item!.period.end).toBe(true);
    expect(item!.monthEnds).toHaveLength(24);
    expect(item!.openingMinor + item!.householdMinor + item!.otherUseMinor).toBe(item!.balanceMinor);
    // Rina's own phone never lists her own item as received.
    expect(await receivedItems(rina.database, groupBookId)).toEqual([]);
  });

  it('privacy: nothing Rina sends carries a private line (amount, description, id) or any of her account ids', async () => {
    const { home, rina, bookId, groupBookId } = await activeGroup();
    const sealed = recordSealed(rina);
    const card = await rinaCard(rina);
    await setShare(rina, card, 'total');
    await setShare(rina, rina.bank, 'total');
    await shareAll(rina);
    const groceries = await categoryOf(rina.database, bookId, 'Groceries');
    const business = await businessCategory(rina, bookId);
    await spend(rina, groceries, card, 50_000_000, 'Household groceries');
    await spend(rina, groceries, rina.bank, 10_000_000, 'Household, from the bank');
    // Two private lines recorded together, so the one other-use total (1,25 jt) is neither of them. (A lone private
    // line in a period is its own total: that is the one figure §5.2 sends by design.)
    const privateIds = await rina.database.transaction(async (tx) => [
      await postTransactionTx(tx, rina.ws, { occurredOn: today, description: 'Konsultan PT Rahasia', lines: expenseLines({ categoryAccountId: business, paymentAccountId: card, amountMinor: 100_000_000, currency: 'IDR' }) }),
      await postTransactionTx(tx, rina.ws, { occurredOn: today, description: 'Hotel rahasia Bali', lines: expenseLines({ categoryAccountId: business, paymentAccountId: card, amountMinor: 25_000_000, currency: 'IDR' }) }),
    ]);
    await home.settle();

    const accountIds = (await rina.database.db.values<[string]>(sql`SELECT id FROM accounts WHERE kind IN ('asset', 'liability')`)).map(([id]) => id);
    expect(accountIds).toContain(card);
    expect(sealed.some(({ changeSet }) => changeSet.ops.some((op) => op.entity === 'nw_item'))).toBe(true);
    for (const { changeSet } of sealed) {
      const text = JSON.stringify(changeSet);
      for (const words of ['Konsultan PT Rahasia', 'Hotel rahasia Bali']) expect(text).not.toContain(words);
      for (const id of [...privateIds, ...accountIds]) expect(text).not.toContain(id);
      const numbers = numbersIn(changeSet.ops);
      expect(numbers).not.toContain(100_000_000);
      expect(numbers).not.toContain(25_000_000);
    }
    const [cardSummary] = await receivedItems(home.devices[1]!.database, groupBookId).then((items) => items.filter((i) => i.subtype === 'credit_card'));
    expect(cardSummary).toMatchObject({ householdMinor: 50_000_000, otherUseMinor: 125_000_000, balanceMinor: 175_000_000 });
    // The summaries did go, to the group log alone.
    expect(nwOpsOf(sealed, await itemIdOf(groupBookId, card)).length).toBeGreaterThan(0);
    expect(nwOpsOf(sealed, await itemIdOf(groupBookId, rina.bank)).length).toBeGreaterThan(0);
    for (const { bookId: to, changeSet } of sealed) if (changeSet.ops.some((op) => op.entity.startsWith('nw_'))) expect(to).toBe(groupBookId);
  });

  it("a hidden item (separate mode) emits no nw_item op at all, and an unreviewed one neither", async () => {
    const { home, rina, bookId } = await activeGroup('separate');
    const sealed = recordSealed(rina);
    const card = await rinaCard(rina);
    await setShare(rina, card, 'hidden');
    await shareAll(rina);
    const groceries = await categoryOf(rina.database, bookId, 'Groceries');
    await spend(rina, groceries, card, 50_000_000, 'Household groceries');
    await spend(rina, groceries, rina.bank, 10_000_000, 'Household groceries, from the bank');
    await home.settle();
    expect(sealed.flatMap(({ changeSet }) => changeSet.ops).filter((op) => op.entity === 'nw_item')).toEqual([]);
  });

  it('an archived item is removed: Andi no longer has it', async () => {
    const { home, rina, andi, groupBookId } = await activeGroup();
    const card = await rinaCard(rina);
    await setShare(rina, card, 'total');
    await shareAll(rina);
    await home.settle();
    expect((await receivedItems(andi.database, groupBookId)).map((i) => i.itemId)).toEqual([await itemIdOf(groupBookId, card)]);

    await archiveAccount(rina.database, rina.ws, card);
    await home.settle();
    expect(await receivedItems(andi.database, groupBookId)).toEqual([]);
    // Its history went with it: nothing of the summary is left on Andi's phone.
    const [row] = await andi.database.db.values<[string, number]>(sql`SELECT summary_json, removed FROM nw_items WHERE book_id = ${groupBookId}`);
    expect(row).toEqual(['null', 1]);
    expect(await rina.database.db.values(sql`SELECT 1 FROM nw_sent`)).toEqual([]);
  });

  it("a setting changed to hidden sends removed, and sharing again sends a fresh summary", async () => {
    const { home, rina, andi, groupBookId } = await activeGroup('separate');
    await setShare(rina, rina.bank, 'total');
    await shareAll(rina);
    await home.settle();
    expect(await receivedItems(andi.database, groupBookId)).toHaveLength(1);
    await setShare(rina, rina.bank, 'hidden');
    expect(await rina.database.transaction((tx) => sendSummariesTx(tx, [rina.bank], today))).toBe(1);
    await home.settle();
    expect(await receivedItems(andi.database, groupBookId)).toEqual([]);
    await setShare(rina, rina.bank, 'total');
    expect(await rina.database.transaction((tx) => sendSummariesTx(tx, [rina.bank], today))).toBe(1);
    await home.settle();
    expect(await receivedItems(andi.database, groupBookId)).toMatchObject([{ name: 'Rina Bank', balanceMinor: 0 }]);
  });

  it('an unchanged recompute sends nothing', async () => {
    const { home, rina, groupBookId } = await activeGroup();
    const card = await rinaCard(rina);
    await setShare(rina, card, 'total');
    expect(await shareAll(rina)).toBe(1);
    await home.settle();
    const outbox = async () => (await rina.database.db.values<[number]>(sql`SELECT count(*) FROM sync_outbox WHERE book_id = ${groupBookId}`))[0]![0];
    const before = await outbox();
    expect(await shareAll(rina)).toBe(0);
    expect(await outbox()).toBe(before);
  });

  it("a new estimate of a property, and a card's new limit, reach Andi without any ledger write", async () => {
    const { home, rina, andi, groupBookId } = await activeGroup();
    const house = await createAccount(rina.database, rina.ws, { name: 'House in Bintaro', kind: 'asset', subtype: 'property', currency: 'IDR', openingBalanceMinor: 1_150_000_000, openedOn: '2025-01-01' });
    await saveAssetProfile(rina.database, rina.ws, { accountId: house.id, assetKind: 'property' });
    const card = await rinaCard(rina);
    await setShare(rina, house.id, 'total');
    await setShare(rina, card, 'total');
    await shareAll(rina);
    await home.settle();

    await recordValuation(rina.database, rina.ws, { accountId: house.id, asOf: today, valueMinor: 1_380_000_000, basis: 'appraisal' });
    await saveCardTerms(rina.database, rina.ws, { accountId: card, statementDay: 25, dueDay: 10, creditLimitMinor: 700_000_000, annualFeeMinor: null });
    await home.settle();
    const items = await receivedItems(andi.database, groupBookId);
    const got = items.find((i) => i.subtype === 'property')!;
    expect(got).toMatchObject({ kind: 'asset', balanceMinor: 1_380_000_000, householdMinor: 0 });
    expect(got.openingMinor + got.householdMinor + got.otherUseMinor).toBe(got.balanceMinor);
    expect(items.find((i) => i.subtype === 'credit_card')!.card).toMatchObject({ limitMinor: 700_000_000 });
  });

  it('Sari, in the workspace and not in the group, never has any nw_items row', async () => {
    const { home, rina, sari, bookId } = await activeGroup();
    const card = await rinaCard(rina);
    await setShare(rina, card, 'total');
    await shareAll(rina);
    await spend(rina, await categoryOf(rina.database, bookId, 'Groceries'), card, 50_000_000, 'Household groceries');
    await home.settle();
    expect(await sari.database.db.values(sql`SELECT * FROM nw_items`)).toEqual([]);
  });

  it('with no active group (proposal unconfirmed), nothing is sent', async () => {
    const h = await household();
    const groupBookId = await h.rina.engine.openGroupLog(h.bookId);
    await h.rina.engine.admitToGroupLog(h.bookId, [h.andi.memberId]);
    await h.home.settle();
    await h.home.settle();
    await propose(h.rina, groupBookId, 'proposal-1', 'joint', [h.rina.memberId, h.andi.memberId]);
    await setShare(h.rina, h.rina.bank, 'total');
    expect(await shareAll(h.rina)).toBe(0);
  });
});

describe('group entities live in group logs only (task 4 carry, capture guard)', () => {
  it('an nw_item written into the workspace book is refused at capture, and net_worth_group into a group log too', async () => {
    const { rina, bookId, groupBookId } = await activeGroup();
    await expect(
      rina.database.transaction((tx) =>
        withCapture(tx, { entity: 'nw_item', id: 'item-x', bookId }, async () => {
          await tx.run(sql`INSERT INTO nw_items (book_id, item_id, owner, summary_json, removed) VALUES (${bookId}, 'item-x', ${rina.memberId}, '{}', 0)`);
        }),
      ),
    ).rejects.toBeInstanceOf(AuthorityError);
    expect(await rina.database.db.values(sql`SELECT 1 FROM nw_items WHERE book_id = ${bookId}`)).toEqual([]);
    await expect(
      rina.database.transaction((tx) =>
        withCapture(tx, { entity: 'net_worth_group', id: groupBookId, bookId: groupBookId }, async () => {
          await tx.run(sql`INSERT INTO group_logs (book_id, group_book_id, relay_book_id, invites_json) VALUES (${groupBookId}, 'another', 'relay', '[]')`);
        }),
      ),
    ).rejects.toBeInstanceOf(AuthorityError);
    expect(await rina.database.db.values(sql`SELECT 1 FROM group_logs WHERE book_id = ${groupBookId}`)).toEqual([]);
  });
});

describe('a restored phone (§9 "Restored backup", S8.7)', () => {
  it('rejoins the group log when a member re-admits it, and re-sends every shared item', async () => {
    const { home, rina, andi, bookId, groupBookId } = await activeGroup();
    const groceries = await categoryOf(andi.database, bookId, 'Groceries');
    await setShare(andi, andi.bank, 'total');
    await shareAll(andi);
    await spend(andi, groceries, andi.bank, 2_000_000, 'Household, before the backup');
    await home.settle();
    expect(await receivedItems(rina.database, groupBookId)).toMatchObject([{ owner: andi.memberId, balanceMinor: -2_000_000 }]);

    const backup = await andi.database.exportBytes();
    const restored = await home.restore(andi, backup);
    expect((await restored.engine.checkRestore()).sort()).toEqual([bookId, groupBookId].sort());
    // Recorded while the phone waits: nothing goes anywhere yet.
    await spend(restored, groceries, restored.bank, 3_000_000, 'Household, while waiting');

    const { code } = await rina.engine.createInvite(bookId, { inviterName: 'Rina', sameMember: true, memberId: andi.memberId });
    await restored.engine.joinBook(code, { ws: restored.ws, memberName: 'Andi', deviceName: 'new phone' });
    await home.settle();
    expect(await restored.engine.groupLogOf(bookId)).toBeNull();
    // A group member's device lets the restored phone back in, as it would a new device of Andi's.
    await rina.engine.admitToGroupLog(bookId, [andi.memberId]);
    await home.settle();
    await home.settle();
    expect(await restored.engine.groupLogOf(bookId)).toBe(groupBookId);
    expect(await receivedItems(rina.database, groupBookId)).toMatchObject([{ owner: andi.memberId, balanceMinor: -5_000_000, householdMinor: -5_000_000 }]);
    expect(await restored.database.db.values(sql`SELECT seq, entity, id, error FROM sync_skipped WHERE book_id = ${groupBookId}`)).toEqual([]);
    expect(await rina.database.db.values(sql`SELECT seq, entity, id, error FROM sync_skipped WHERE book_id = ${groupBookId}`)).toEqual([]);
  });
});

describe('review round 1 (task 6)', () => {
  it("Andi's edit, then void, of Rina's Household purchase on her shared card re-sends the card's summary each time", async () => {
    const { home, rina, andi, bookId, groupBookId } = await activeGroup();
    const card = await rinaCard(rina);
    await setShare(rina, card, 'total');
    await shareAll(rina);
    const groceries = await categoryOf(rina.database, bookId, 'Groceries');
    const lineage = await spend(rina, groceries, card, 50_000_000, 'Household groceries');
    await home.settle();
    expect(await receivedItems(andi.database, groupBookId)).toMatchObject([{ householdMinor: 50_000_000, balanceMinor: 50_000_000 }]);

    const [[placeholder]] = (await andi.database.db.values<[string]>(sql`SELECT account_id FROM book_member_accounts WHERE member_id = ${rina.memberId}`)) as [[string]];
    await replaceTransaction(andi.database, andi.ws, (await headOf(andi.database, lineage))!, {
      occurredOn: today,
      description: 'Household groceries',
      lines: expenseLines({ categoryAccountId: groceries, paymentAccountId: placeholder, amountMinor: 70_000_000, currency: 'IDR' }),
    });
    await home.settle();
    expect(await receivedItems(andi.database, groupBookId)).toMatchObject([{ householdMinor: 70_000_000, balanceMinor: 70_000_000 }]);

    await voidTransaction(andi.database, andi.ws, (await headOf(andi.database, lineage))!);
    await home.settle();
    expect(await receivedItems(andi.database, groupBookId)).toMatchObject([{ householdMinor: 0, balanceMinor: 0 }]);
  });

  it('a deleted account sends removed', async () => {
    const { home, rina, andi, groupBookId } = await activeGroup();
    const spare = await createAccount(rina.database, rina.ws, { name: 'Spare wallet', kind: 'asset', subtype: 'cash', currency: 'IDR', openingBalanceMinor: 10_000_000, openedOn: today });
    await setShare(rina, spare.id, 'total');
    await shareAll(rina);
    await home.settle();
    expect(await receivedItems(andi.database, groupBookId)).toMatchObject([{ name: 'Spare wallet', balanceMinor: 10_000_000 }]);
    await deleteUnusedAccount(rina.database, rina.ws, spare.id);
    await home.settle();
    expect(await receivedItems(andi.database, groupBookId)).toEqual([]);
  });

  it("a new period refreshes the summary on the next sync, with no write at all", async () => {
    const { home, rina, andi, bookId, groupBookId } = await activeGroup();
    await setShare(rina, rina.bank, 'total');
    await spend(rina, await categoryOf(rina.database, bookId, 'Groceries'), rina.bank, 5_000_000, 'Household groceries');
    await shareAll(rina);
    await home.settle();
    const [before] = await receivedItems(andi.database, groupBookId);
    expect(before!.householdMinor).toBe(-5_000_000);
    // Forty days on: the calendar month the summary was for is over.
    const later = Date.now() + 40 * 86_400_000;
    (rina.engine as unknown as { now: () => number }).now = () => later;
    await home.settle();
    const [after] = await receivedItems(andi.database, groupBookId);
    expect(after!.period.start > before!.period.end).toBe(true);
    expect(after).toMatchObject({ openingMinor: -5_000_000, householdMinor: 0, otherUseMinor: 0, balanceMinor: -5_000_000 });
  });
});

describe('computeItemSummary at the edges of a card cycle (task 6 review round 1)', () => {
  it('a line dated before the period lands in the opening only; statement day 31 clamps to a 30-day month', async () => {
    const home = new Household();
    const rina = await home.device('Rina');
    const bookId = (await personalBook(rina.database, rina.ws)).id;
    const card = await createCardAccount(rina.database, rina.ws, { name: 'Rina Card', subtype: 'credit_card', currency: 'IDR' });
    await saveCardTerms(rina.database, rina.ws, { accountId: card.id, statementDay: 31, dueDay: 10, creditLimitMinor: 500_000_000, annualFeeMinor: null });
    const groceries = await categoryOf(rina.database, bookId, 'Groceries');
    const post = (occurredOn: string, amountMinor: number) =>
      postTransaction(rina.database, rina.ws, { occurredOn, description: 'x', lines: expenseLines({ categoryAccountId: groceries, paymentAccountId: card.id, amountMinor, currency: 'IDR' }) });
    await post('2026-03-31', 7_000_000); // the last day of March's cycle
    await post('2026-04-01', 2_000_000); // the first day of April's
    await post('2026-04-30', 1_000_000); // April's statement day, clamped from 31
    await post('2026-05-01', 9_000_000); // after today
    const summary = await rina.database.transaction((tx) => computeItemSummary(tx, rina.ws, card.id, rina.memberId, bookId, '2026-04-30'));
    expect(summary.period).toEqual({ start: '2026-04-01', end: '2026-04-30' });
    expect(summary.card).toEqual({ limitMinor: 500_000_000, cycleStart: '2026-04-01', cycleEnd: '2026-04-30' });
    expect(summary).toMatchObject({ openingMinor: 7_000_000, householdMinor: 3_000_000, otherUseMinor: 0, balanceMinor: 10_000_000 });
    expect(summary.monthEnds.at(-1)).toEqual({ month: '2026-03', balanceMinor: 7_000_000 });
  });

  it("a valued asset's month-ends are what the Net worth reader says at each month-end", async () => {
    const home = new Household();
    const rina = await home.device('Rina');
    const bookId = (await personalBook(rina.database, rina.ws)).id;
    const house = await createAccount(rina.database, rina.ws, { name: 'House', kind: 'asset', subtype: 'property', currency: 'IDR', openingBalanceMinor: 1_000_000_000, openedOn: '2025-01-01' });
    await saveAssetProfile(rina.database, rina.ws, { accountId: house.id, assetKind: 'property' });
    await recordValuation(rina.database, rina.ws, { accountId: house.id, asOf: '2025-06-15', valueMinor: 1_200_000_000, basis: 'appraisal' });
    await recordValuation(rina.database, rina.ws, { accountId: house.id, asOf: '2026-02-10', valueMinor: 1_300_000_000, basis: 'estimate' });
    const summary = await rina.database.transaction((tx) => computeItemSummary(tx, rina.ws, house.id, rina.memberId, bookId, '2026-04-20'));
    for (const { month, balanceMinor } of summary.monthEnds) {
      const [y, m] = month.split('-').map(Number) as [number, number];
      const end = new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);
      const expected = (await assetValuesAt(rina.database, rina.ws, end)).find((row) => row.accountId === house.id)?.valueMinor ?? 0;
      expect(balanceMinor, month).toBe(expected);
    }
    expect(summary.balanceMinor).toBe(1_300_000_000);
  });
});

