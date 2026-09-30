import { isoDate } from '@expanses/core';
import { sql } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { confirmReview, setShareSetting, upsertRate, memberTransferUnposted, netWorthAt, receivedItems, recordMemberTransfer, editMemberTransfer, voidMemberTransfer } from '../../src/index';
import { encodeHlc } from '../../src/sync/hlc';
import { itemIdOf } from '../../src/sync/net-worth/summaries';
import type { ChangeSet, Op } from '../../src/sync/types';
import { Household, type Device } from './household';

/*
 * Transfers between partners (joint-net-worth §7.2, D15; task 8). Rina, Andi and Sari share the workspace; Rina and Andi
 * are an active net-worth group, each sharing their bank. Rina records one transfer of 5 jt from her bank to Andi's:
 * her phone posts her side (her bank −5 jt, Andi's placeholder +5 jt), his phone his (his bank +5 jt, Rina's placeholder
 * −5 jt), and Sari's nothing. Placeholders are outside Net worth, so hers drops 5 jt and his rises 5 jt.
 */

const today = isoDate();
const JT = 1_000_000_00;

async function settle(home: Household) {
  for (let i = 0; i < 3; i += 1) await home.settle();
}

/** Rina and Andi active in `separate` mode, both banks shared and past review; Sari in the workspace only. */
async function sharing() {
  const home = new Household();
  const rina = await home.device('Rina');
  const andi = await home.device('Andi');
  const sari = await home.device('Sari');
  const bookId = await home.share(rina);
  await home.join(andi, rina);
  await home.join(sari, rina);
  await home.settle();
  const proposalId = await rina.engine.proposeNetWorth(bookId, { mode: 'separate', members: [andi.memberId] });
  await settle(home);
  await andi.engine.answerNetWorth(bookId, proposalId, 'confirm');
  await settle(home);
  await confirmReview(rina.database, rina.ws, { [rina.bank]: 'total' });
  await confirmReview(andi.database, andi.ws, { [andi.bank]: 'total' });
  await settle(home);
  const groupBookId = (await rina.engine.netWorthGroup(bookId)).groupBookId!;
  const rinaItem = await itemIdOf(groupBookId, rina.bank);
  const andiItem = await itemIdOf(groupBookId, andi.bank);
  return { home, rina, andi, sari, bookId, groupBookId, rinaItem, andiItem };
}

type Setup = Awaited<ReturnType<typeof sharing>>;

/** An account's posted balance on a device. */
async function balance(d: Device, accountId: string): Promise<number> {
  const [row] = await d.database.db.values<[number]>(sql`
    SELECT coalesce(sum(e.amount_minor), 0) FROM entries e JOIN transactions t ON t.id = e.transaction_id
    WHERE e.account_id = ${accountId} AND t.status = 'posted'`);
  return Number(row![0]);
}

async function worth(d: Device): Promise<number> {
  return (await netWorthAt(d.database, d.ws, today, { USD: 16_000 })).netWorthMinor!;
}

async function placeholderOf(d: Device, bookId: string, memberId: string): Promise<string | null> {
  const [row] = await d.database.db.values<[string]>(sql`SELECT account_id FROM book_member_accounts WHERE book_id = ${bookId} AND member_id = ${memberId} AND currency = 'IDR'`);
  return row?.[0] ?? null;
}

async function postingsOf(d: Device): Promise<[string, string][]> {
  try {
    return await d.database.db.values<[string, string]>(sql`SELECT transfer_id, transaction_id FROM member_transfer_postings`);
  } catch {
    return [];
  }
}

function rinaToAndi(s: Setup, amountMinor = 5 * JT) {
  return recordMemberTransfer(s.rina.database, s.bookId, {
    occurredOn: today,
    amountMinor,
    currency: 'IDR',
    from: { owner: s.rina.memberId, itemId: s.rinaItem },
    to: { owner: s.andi.memberId, itemId: s.andiItem },
    description: 'For the rent',
  });
}

/** One change-set of one op, signed by `from`'s real key, appended straight to the group log's relay book. */
async function sendToGroup(from: Device, groupBookId: string, member: string, op: Op, at = Date.now()): Promise<void> {
  const [row] = await from.database.db.values<[string, number]>(sql`SELECT relay_book_id, epoch FROM shared_books WHERE book_id = ${groupBookId}`);
  const cs: ChangeSet = { v: 1, hlc: encodeHlc(at, 0, from.deviceId), member, ops: [op] };
  await from.transport.append(row![0], await from.engine.sealer.seal(groupBookId, Number(row![1]), cs));
}

describe('transfers between partners (task 8)', () => {
  it('lands once on both real accounts: Rina’s bank −5 jt on her phone, Andi’s +5 jt on his, nothing on Sari’s; Net worth moves by 5 jt each way', async () => {
    const s = await sharing();
    const before = { rina: await worth(s.rina), andi: await worth(s.andi) };
    const transferId = await rinaToAndi(s);
    await settle(s.home);

    expect(await balance(s.rina, s.rina.bank)).toBe(-5 * JT);
    expect(await balance(s.rina, (await placeholderOf(s.rina, s.bookId, s.andi.memberId))!)).toBe(5 * JT);
    expect(await balance(s.andi, s.andi.bank)).toBe(5 * JT);
    expect(await balance(s.andi, (await placeholderOf(s.andi, s.bookId, s.rina.memberId))!)).toBe(-5 * JT);
    // One posting per party, kept against the transfer; the third device has nothing.
    expect((await postingsOf(s.rina)).map(([id]) => id)).toEqual([transferId]);
    expect((await postingsOf(s.andi)).map(([id]) => id)).toEqual([transferId]);
    expect(await postingsOf(s.sari)).toEqual([]);
    expect(await balance(s.sari, s.sari.bank)).toBe(0);

    expect(await worth(s.rina)).toBe(before.rina - 5 * JT);
    expect(await worth(s.andi)).toBe(before.andi + 5 * JT);
    // Each owner's item summary refreshed and went out: each reads the other's bank as it now is.
    expect((await receivedItems(s.andi.database, s.groupBookId)).find((i) => i.itemId === s.rinaItem)?.balanceMinor).toBe(-5 * JT);
    expect((await receivedItems(s.rina.database, s.groupBookId)).find((i) => i.itemId === s.andiItem)?.balanceMinor).toBe(5 * JT);
    // Nothing went into the workspace log: the postings belong to no workspace book.
    const purchases = await s.sari.database.db.values(sql`SELECT 1 FROM sync_lineage`);
    expect(purchases).toEqual([]);
  });

  it('an edit to 4 jt moves both sides to 4 jt; a void takes both back', async () => {
    const s = await sharing();
    const before = { rina: await worth(s.rina), andi: await worth(s.andi) };
    const transferId = await rinaToAndi(s);
    await settle(s.home);

    await editMemberTransfer(s.rina.database, s.bookId, transferId, { amountMinor: 4 * JT });
    await settle(s.home);
    expect(await balance(s.rina, s.rina.bank)).toBe(-4 * JT);
    expect(await balance(s.andi, s.andi.bank)).toBe(4 * JT);
    expect(await worth(s.rina)).toBe(before.rina - 4 * JT);
    expect(await worth(s.andi)).toBe(before.andi + 4 * JT);

    await voidMemberTransfer(s.rina.database, s.bookId, transferId);
    await settle(s.home);
    expect(await balance(s.rina, s.rina.bank)).toBe(0);
    expect(await balance(s.andi, s.andi.bank)).toBe(0);
    expect(await worth(s.rina)).toBe(before.rina);
    expect(await worth(s.andi)).toBe(before.andi);
    // Void wins: nothing edits it back.
    await expect(editMemberTransfer(s.rina.database, s.bookId, transferId, { amountMinor: 1 * JT })).rejects.toThrow();
  });

  it('Andi, the receiving side, may edit it too, and it lands on both phones', async () => {
    const s = await sharing();
    const transferId = await rinaToAndi(s);
    await settle(s.home);
    await editMemberTransfer(s.andi.database, s.bookId, transferId, { amountMinor: 3 * JT, description: 'Half the rent' });
    await settle(s.home);
    expect(await balance(s.rina, s.rina.bank)).toBe(-3 * JT);
    expect(await balance(s.andi, s.andi.bank)).toBe(3 * JT);
    const [row] = await s.rina.database.db.values(sql`SELECT description, amount_minor FROM member_transfers WHERE transfer_id = ${transferId}`);
    expect(row).toEqual(['Half the rent', 3 * JT]);
  });

  it('Andi records money he received from Rina: the same two sides', async () => {
    const s = await sharing();
    await recordMemberTransfer(s.andi.database, s.bookId, {
      occurredOn: today,
      amountMinor: 2 * JT,
      currency: 'IDR',
      from: { owner: s.rina.memberId, itemId: s.rinaItem },
      to: { owner: s.andi.memberId, itemId: s.andiItem },
      description: null,
    });
    await settle(s.home);
    expect(await balance(s.rina, s.rina.bank)).toBe(-2 * JT);
    expect(await balance(s.andi, s.andi.bank)).toBe(2 * JT);
  });

  it('refuses a transfer in another currency than the items’, one naming an item that is not shared, and one outside the group’s workspace', async () => {
    const s = await sharing();
    const t = {
      occurredOn: today,
      amountMinor: 5 * JT,
      currency: 'IDR',
      from: { owner: s.rina.memberId, itemId: s.rinaItem },
      to: { owner: s.andi.memberId, itemId: s.andiItem },
      description: null,
    };
    await expect(recordMemberTransfer(s.rina.database, s.bookId, { ...t, currency: 'USD' })).rejects.toMatchObject({ code: 'invalid' });
    await expect(recordMemberTransfer(s.rina.database, s.bookId, { ...t, to: { owner: s.andi.memberId, itemId: 'not-an-item' } })).rejects.toMatchObject({ code: 'item-not-shared' });
    // Rina's wallet is not shared (any more): not hers to transfer from here.
    await setShareSetting(s.rina.database, s.rina.cash, 'hidden');
    await expect(
      recordMemberTransfer(s.rina.database, s.bookId, { ...t, from: { owner: s.rina.memberId, itemId: await itemIdOf(s.groupBookId, s.rina.cash) } }),
    ).rejects.toMatchObject({ code: 'item-not-shared' });
    await expect(recordMemberTransfer(s.rina.database, 'another-book', t)).rejects.toMatchObject({ code: 'not-listed' });
    expect(await s.rina.database.db.values(sql`SELECT 1 FROM member_transfers`)).toEqual([]);
    expect(await balance(s.rina, s.rina.bank)).toBe(0);
  });

  it('Sari, outside the group, never holds the group log: she cannot record or edit a transfer', async () => {
    const s = await sharing();
    const transferId = await rinaToAndi(s);
    await settle(s.home);
    expect(await s.sari.database.db.values(sql`SELECT 1 FROM shared_books WHERE book_id = ${s.groupBookId}`)).toEqual([]);
    await expect(editMemberTransfer(s.sari.database, s.bookId, transferId, { amountMinor: 1 })).rejects.toMatchObject({ code: 'not-listed' });
    // A group member who is not a party of it is refused on apply (Task 1's writer check): the three-member test below.
    expect(await balance(s.rina, s.rina.bank)).toBe(-5 * JT);
    expect(await balance(s.andi, s.andi.bank)).toBe(5 * JT);
  });
});

/** Rina, Andi and Sari all in one `separate` group, each sharing their bank. */
async function threeInGroup() {
  const home = new Household();
  const rina = await home.device('Rina');
  const andi = await home.device('Andi');
  const sari = await home.device('Sari');
  const bookId = await home.share(rina);
  await home.join(andi, rina);
  await home.join(sari, rina);
  await home.settle();
  const proposalId = await rina.engine.proposeNetWorth(bookId, { mode: 'separate', members: [andi.memberId, sari.memberId] });
  await settle(home);
  await andi.engine.answerNetWorth(bookId, proposalId, 'confirm');
  await sari.engine.answerNetWorth(bookId, proposalId, 'confirm');
  await settle(home);
  for (const d of [rina, andi, sari]) await confirmReview(d.database, d.ws, { [d.bank]: 'total' });
  await settle(home);
  const groupBookId = (await rina.engine.netWorthGroup(bookId)).groupBookId!;
  return { home, rina, andi, sari, bookId, groupBookId, proposalId, rinaItem: await itemIdOf(groupBookId, rina.bank), andiItem: await itemIdOf(groupBookId, andi.bank) };
}

describe('transfers between partners: who may land one on a real account (task 8)', () => {
  it('a group member who is not a party of the transfer cannot edit it (Task 1 writer check), and nothing moves', async () => {
    const s = await threeInGroup();
    const transferId = await recordMemberTransfer(s.rina.database, s.bookId, {
      occurredOn: today,
      amountMinor: 5 * JT,
      currency: 'IDR',
      from: { owner: s.rina.memberId, itemId: s.rinaItem },
      to: { owner: s.andi.memberId, itemId: s.andiItem },
      description: null,
    });
    await settle(s.home);
    expect(await postingsOf(s.sari)).toEqual([]);
    await sendToGroup(s.sari, s.groupBookId, s.andi.memberId, { entity: 'member_transfer', id: transferId, op: 'upsert', fields: { amountMinor: 1 } });
    await settle(s.home);
    expect(await balance(s.rina, s.rina.bank)).toBe(-5 * JT);
    expect(await balance(s.andi, s.andi.bank)).toBe(5 * JT);
    const [skip] = await s.rina.database.db.values<[string, string]>(sql`SELECT entity, error FROM sync_skipped WHERE book_id = ${s.groupBookId} AND id = ${transferId}`);
    expect(skip).toEqual(['member_transfer', expect.stringMatching(/^AUTHORITY:/)]);
  });

  it('a party who has left the group lands nothing on the other’s real account, and the reason is kept', async () => {
    const s = await threeInGroup();
    // Andi's `left` reaches Rina's phone before his device is taken out of the log: the group is Rina and Sari now.
    await sendToGroup(s.andi, s.groupBookId, s.andi.memberId, { entity: 'nw_answer', id: `${s.proposalId}|${s.andi.memberId}`, op: 'upsert', fields: { answer: 'left' } });
    const line = (owner: string, itemId: string) => JSON.stringify({ owner, itemId });
    // …and a transfer from Andi's device, naming him as the payer and Rina's bank as where it landed.
    await sendToGroup(s.andi, s.groupBookId, s.andi.memberId, {
      entity: 'member_transfer',
      id: 'xfer-after-leaving',
      op: 'upsert',
      fields: {
        occurredOn: today,
        amountMinor: 9 * JT,
        currency: 'IDR',
        from: line(s.andi.memberId, s.andiItem),
        to: line(s.rina.memberId, s.rinaItem),
        description: null,
        void: 0,
        recordedBy: s.andi.memberId,
      },
    });
    await s.rina.engine.syncOnce(s.bookId);
    expect(await s.rina.database.db.values(sql`SELECT 1 FROM member_transfers WHERE transfer_id = 'xfer-after-leaving'`)).toEqual([[1]]);
    expect(await balance(s.rina, s.rina.bank)).toBe(0);
    expect(await postingsOf(s.rina)).toEqual([]);
    expect(await memberTransferUnposted(s.rina.database, s.groupBookId)).toEqual([{ transferId: 'xfer-after-leaving', reason: 'author-not-member' }]);
  });
});

describe('transfers between partners: review round 1 (task 8)', () => {
  it('after Andi leaves, Rina can still delete her side (bank back to 0), a second delete does nothing, and an edit is refused', async () => {
    const s = await threeInGroup();
    const transferId = await recordMemberTransfer(s.rina.database, s.bookId, {
      occurredOn: today,
      amountMinor: 5 * JT,
      currency: 'IDR',
      from: { owner: s.rina.memberId, itemId: s.rinaItem },
      to: { owner: s.andi.memberId, itemId: s.andiItem },
      description: null,
    });
    await settle(s.home);
    await s.andi.engine.leaveNetWorth(s.bookId);
    await settle(s.home);
    expect(await balance(s.rina, s.rina.bank)).toBe(-5 * JT);
    await expect(editMemberTransfer(s.rina.database, s.bookId, transferId, { amountMinor: 4 * JT })).rejects.toMatchObject({ code: 'left-group' });
    expect(await balance(s.rina, s.rina.bank)).toBe(-5 * JT);
    await voidMemberTransfer(s.rina.database, s.bookId, transferId);
    expect(await balance(s.rina, s.rina.bank)).toBe(0);
    await voidMemberTransfer(s.rina.database, s.bookId, transferId);
    expect(await balance(s.rina, s.rina.bank)).toBe(0);
  });

  it('a void from a party who has left still takes the other party’s posted side back', async () => {
    const s = await threeInGroup();
    const transferId = await recordMemberTransfer(s.rina.database, s.bookId, {
      occurredOn: today,
      amountMinor: 5 * JT,
      currency: 'IDR',
      from: { owner: s.rina.memberId, itemId: s.rinaItem },
      to: { owner: s.andi.memberId, itemId: s.andiItem },
      description: null,
    });
    await settle(s.home);
    expect(await balance(s.andi, s.andi.bank)).toBe(5 * JT);
    // Rina's `left` and her void reach Andi in one pull: she is no longer a member when the void applies.
    await sendToGroup(s.rina, s.groupBookId, s.rina.memberId, { entity: 'nw_answer', id: `${s.proposalId}|${s.rina.memberId}`, op: 'upsert', fields: { answer: 'left' } });
    await sendToGroup(s.rina, s.groupBookId, s.rina.memberId, { entity: 'member_transfer', id: transferId, op: 'upsert', fields: { void: 1 } }, Date.now() + 5);
    await s.andi.engine.syncOnce(s.bookId);
    expect(await balance(s.andi, s.andi.bank)).toBe(0);
  });

  it('re-applying the same transfer op leaves one posting, under the same transaction', async () => {
    const s = await sharing();
    await rinaToAndi(s);
    await settle(s.home);
    const before = await postingsOf(s.andi);
    expect(before).toHaveLength(1);
    await s.andi.database.db.run(sql`UPDATE sync_cursor SET applied_seq = 0 WHERE book_id = ${s.groupBookId}`);
    await s.andi.engine.syncOnce(s.bookId);
    expect(await postingsOf(s.andi)).toEqual(before);
    expect(await balance(s.andi, s.andi.bank)).toBe(5 * JT);
  });

  it('a transfer in another currency posts at the rate each phone holds; one with none waits and posts once a rate arrives', async () => {
    const s = await sharing();
    await confirmReview(s.rina.database, s.rina.ws, { [s.rina.bank]: 'total', [s.rina.usd]: 'total' });
    await confirmReview(s.andi.database, s.andi.ws, { [s.andi.bank]: 'total', [s.andi.usd]: 'total' });
    await settle(s.home);
    const transferId = await recordMemberTransfer(s.rina.database, s.bookId, {
      occurredOn: today,
      amountMinor: 100_00,
      currency: 'USD',
      from: { owner: s.rina.memberId, itemId: await itemIdOf(s.groupBookId, s.rina.usd) },
      to: { owner: s.andi.memberId, itemId: await itemIdOf(s.groupBookId, s.andi.usd) },
      description: null,
    });
    await settle(s.home);
    // No rate on either phone: nothing posted, and why is kept.
    expect(await memberTransferUnposted(s.rina.database, s.groupBookId)).toEqual([{ transferId, reason: 'no-rate' }]);
    expect(await memberTransferUnposted(s.andi.database, s.groupBookId)).toEqual([{ transferId, reason: 'no-rate' }]);
    // Andi's phone learns a rate some other way: its next group-log sync posts the side.
    await s.andi.database.db.run(
      sql`INSERT INTO fx_rates (from_currency, to_currency, on_date, rate, source, source_date, fetched_at) VALUES ('USD', 'IDR', ${today}, 16000, 'manual', ${today}, ${new Date().toISOString()})`,
    );
    await settle(s.home);
    expect(await balance(s.andi, s.andi.usd)).toBe(100_00);
    expect(await memberTransferUnposted(s.andi.database, s.groupBookId)).toEqual([]);
    // Rina saves a rate: her side posts at once.
    await upsertRate(s.rina.database, { fromCurrency: 'USD', toCurrency: 'IDR', onDate: today, rate: 16_000, source: 'manual', sourceDate: today });
    expect(await balance(s.rina, s.rina.usd)).toBe(-100_00);
    expect(await memberTransferUnposted(s.rina.database, s.groupBookId)).toEqual([]);
  });
});
