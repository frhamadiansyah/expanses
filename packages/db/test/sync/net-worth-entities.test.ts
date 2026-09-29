import { sql } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { encodeHlc } from '../../src/sync/hlc';
import { meetsMinVersion } from '../../src/sync/net-worth/version';
import { SyncEngine } from '../../src/sync/engine';
import type { ChangeSet, Op } from '../../src/sync/types';
import { Household, type Device } from './household';

/*
 * Joint net worth's foundations (spec §5.1, §9): the five entities `apply.ts` now knows, each with a `writer` — the
 * one member allowed to write it, resolved from the **authority view**'s device→member binding (never a change-set's
 * own claimed `member`, which the sender asserts and nothing signs — task 1 review round 1, finding 1) — and the
 * app-version each device carries on its own `book_devices` row (finding 7's ruling).
 *
 * Every op here travels the real way: signed by a real device's key, through the real relay, decided by
 * `decideOpsTx` against the real authority view built by real introductions (`Household`). A lighter, hand-built
 * change-set applied directly (as task 1's first pass used) cannot exercise this: the authority view it would be
 * checked against is never populated, so every writer would be "undeterminable" — which is itself evidence the old,
 * looser check was checking the wrong thing.
 */

async function household() {
  const home = new Household();
  const fandri = await home.device('Fandri');
  const dewi = await home.device('Dewi');
  const budi = await home.device('Budi');
  const bookId = await home.share(fandri);
  await home.join(dewi, fandri);
  await home.join(budi, fandri);
  await home.settle();
  return { home, fandri, dewi, budi, bookId };
}

/** One change-set of a single op, signed by `from`'s real key and appended straight to the relay (as authority.test.ts does), claiming `member` as its author — truthfully or not. */
async function send(home: Household, from: Device, member: string, op: Op, at = Date.now()): Promise<void> {
  const cs: ChangeSet = { v: 1, hlc: encodeHlc(at, 0, from.deviceId), member, ops: [op] };
  await from.transport.append(home.relayBookId, await from.engine.sealer.seal(home.bookId, 1, cs));
}

const skipsOf = (device: Device, bookId: string) =>
  device.database.db.values<[string, string, string]>(sql`SELECT entity, id, error FROM sync_skipped WHERE book_id = ${bookId} ORDER BY seq`);

const authorityRefusal = expect.stringMatching(/^AUTHORITY:/);

describe('nw_proposal: writer is its proposer, per the authority view', () => {
  it("the proposer's own device applies it; another member's device naming itself as proposer is refused", async () => {
    const { home, fandri, dewi, bookId } = await household();
    const createdHlc = encodeHlc(Date.now(), 0, fandri.deviceId);
    const fields = { mode: 'joint', members: JSON.stringify([fandri.memberId, dewi.memberId]), proposedBy: fandri.memberId, createdHlc, cancelled: 0 };

    await send(home, fandri, fandri.memberId, { entity: 'nw_proposal', id: 'prop-1', op: 'upsert', fields });
    await home.settle();
    const [mine] = await dewi.database.db.values<[string]>(sql`SELECT proposed_by FROM nw_proposals WHERE book_id = ${bookId} AND proposal_id = 'prop-1'`);
    expect(mine).toEqual([fandri.memberId]);

    // Dewi's own device, truthfully signed as Dewi, proposes with proposedBy naming Fandri instead of herself.
    await send(home, dewi, dewi.memberId, { entity: 'nw_proposal', id: 'prop-2', op: 'upsert', fields: { ...fields, proposedBy: fandri.memberId } });
    await home.settle();
    const rows = await fandri.database.db.values(sql`SELECT 1 FROM nw_proposals WHERE book_id = ${bookId} AND proposal_id = 'prop-2'`);
    expect(rows).toEqual([]);
    expect(await skipsOf(fandri, bookId)).toEqual([['nw_proposal', 'prop-2', authorityRefusal]]);
  });

  it("finding 1: a device cannot write another member's row by claiming to be them in the change-set", async () => {
    const { home, fandri, dewi, bookId } = await household();
    const createdHlc = encodeHlc(Date.now(), 0, dewi.deviceId);
    // Dewi's own device signs this, but the change-set LIES and claims Fandri as its member — matching proposedBy.
    // The old check (comparing changeSet.member to the writer) would have accepted this; the fix must not.
    await send(home, dewi, fandri.memberId, {
      entity: 'nw_proposal',
      id: 'prop-lie',
      op: 'upsert',
      fields: { mode: 'joint', members: JSON.stringify([fandri.memberId, dewi.memberId]), proposedBy: fandri.memberId, createdHlc, cancelled: 0 },
    });
    await home.settle();
    const rows = await fandri.database.db.values(sql`SELECT 1 FROM nw_proposals WHERE book_id = ${bookId} AND proposal_id = 'prop-lie'`);
    expect(rows).toEqual([]);
    expect(await skipsOf(fandri, bookId)).toEqual([['nw_proposal', 'prop-lie', authorityRefusal]]);
  });

  it('finding 2: once made, proposedBy can never move — not even by the proposer, who could otherwise hand it off', async () => {
    const { home, fandri, dewi, bookId } = await household();
    const createdHlc = encodeHlc(Date.now(), 0, fandri.deviceId);
    await send(home, fandri, fandri.memberId, {
      entity: 'nw_proposal',
      id: 'prop-3',
      op: 'upsert',
      fields: { mode: 'joint', members: JSON.stringify([fandri.memberId, dewi.memberId]), proposedBy: fandri.memberId, createdHlc, cancelled: 0 },
    });
    await home.settle();

    // Fandri (the rightful, still-current writer) tries to reassign proposedBy to Dewi. Fandri authored both ops, so
    // his own database never applies either (own entries are never re-applied locally, spec §7.2) — Dewi, who
    // authored neither, is checked instead.
    await send(home, fandri, fandri.memberId, { entity: 'nw_proposal', id: 'prop-3', op: 'upsert', fields: { proposedBy: dewi.memberId }, changed: ['proposedBy'] }, Date.now() + 10);
    await home.settle();
    const [row] = await dewi.database.db.values<[string]>(sql`SELECT proposed_by FROM nw_proposals WHERE book_id = ${bookId} AND proposal_id = 'prop-3'`);
    expect(row).toEqual([fandri.memberId]);
    expect((await skipsOf(fandri, bookId)).at(-1)).toEqual(['nw_proposal', 'prop-3', authorityRefusal]);
  });

  it('cancelled may only be set by the proposer, as a partial edit naming only it', async () => {
    const { home, fandri, dewi, budi, bookId } = await household();
    const createdHlc = encodeHlc(Date.now(), 0, fandri.deviceId);
    await send(home, fandri, fandri.memberId, {
      entity: 'nw_proposal',
      id: 'prop-4',
      op: 'upsert',
      fields: { mode: 'joint', members: JSON.stringify([fandri.memberId, dewi.memberId]), proposedBy: fandri.memberId, createdHlc, cancelled: 0 },
    });
    await home.settle();

    // Fandri authored the row, Dewi the refused edit: Budi, who authored neither, is the peer checked.
    await send(home, dewi, dewi.memberId, { entity: 'nw_proposal', id: 'prop-4', op: 'upsert', fields: { cancelled: 1 }, changed: ['cancelled'] }, Date.now() + 10);
    await home.settle();
    const [row] = await budi.database.db.values<[number]>(sql`SELECT cancelled FROM nw_proposals WHERE book_id = ${bookId} AND proposal_id = 'prop-4'`);
    expect(Number(row![0])).toBe(0);
    expect((await skipsOf(fandri, bookId)).at(-1)).toEqual(['nw_proposal', 'prop-4', authorityRefusal]);
  });
});

describe('nw_answer: writer is the member it answers for', () => {
  it("a member's own device applies its own answer; another member's device is refused", async () => {
    const { home, fandri, dewi, budi, bookId } = await household();
    // Dewi authors her own answer, then Budi tries to overwrite it: Fandri, who authors neither, is checked (own
    // entries are never re-applied locally, spec §7.2 — Dewi's own database would not show her own write either).
    await send(home, dewi, dewi.memberId, { entity: 'nw_answer', id: 'prop-1|' + dewi.memberId, op: 'upsert', fields: { answer: 'confirm' } });
    await home.settle();
    const [row] = await fandri.database.db.values<[string]>(sql`SELECT answer FROM nw_answers WHERE book_id = ${bookId} AND proposal_id = 'prop-1' AND member_id = ${dewi.memberId}`);
    expect(row).toEqual(['confirm']);

    await send(home, budi, budi.memberId, { entity: 'nw_answer', id: 'prop-1|' + dewi.memberId, op: 'upsert', fields: { answer: 'decline' } });
    await home.settle();
    const [stillConfirm] = await fandri.database.db.values<[string]>(sql`SELECT answer FROM nw_answers WHERE book_id = ${bookId} AND proposal_id = 'prop-1' AND member_id = ${dewi.memberId}`);
    expect(stillConfirm).toEqual(['confirm']);
    expect((await skipsOf(dewi, bookId)).at(-1)).toEqual(['nw_answer', 'prop-1|' + dewi.memberId, authorityRefusal]);
  });
});

describe('nw_item: writer is its owner, per the authority view', () => {
  it("the owner's device applies it; another member's device is refused", async () => {
    const { home, fandri, dewi, bookId } = await household();
    const fields = { owner: fandri.memberId, summary: JSON.stringify({ kind: 'account', name: 'BCA' }), removed: 0 };
    await send(home, fandri, fandri.memberId, { entity: 'nw_item', id: 'item-1', op: 'upsert', fields });
    await home.settle();
    const [row] = await dewi.database.db.values<[string]>(sql`SELECT owner FROM nw_items WHERE book_id = ${bookId} AND item_id = 'item-1'`);
    expect(row).toEqual([fandri.memberId]);

    await send(home, dewi, dewi.memberId, { entity: 'nw_item', id: 'item-2', op: 'upsert', fields: { ...fields, owner: fandri.memberId } });
    await home.settle();
    const rows = await fandri.database.db.values(sql`SELECT 1 FROM nw_items WHERE book_id = ${bookId} AND item_id = 'item-2'`);
    expect(rows).toEqual([]);
    expect(await skipsOf(fandri, bookId)).toEqual([['nw_item', 'item-2', authorityRefusal]]);
  });

  it('finding 2: an existing item cannot be taken over by rewriting its owner, even by its current owner', async () => {
    const { home, fandri, dewi, budi, bookId } = await household();
    await send(home, fandri, fandri.memberId, {
      entity: 'nw_item',
      id: 'item-3',
      op: 'upsert',
      fields: { owner: fandri.memberId, summary: JSON.stringify({ kind: 'account', name: 'BCA' }), removed: 0 },
    });
    await home.settle();

    // Dewi's device attempts the takeover. Fandri authors two of the three ops here, so Budi — who authors none —
    // is the peer checked throughout (own entries are never re-applied locally, spec §7.2).
    await send(home, dewi, dewi.memberId, { entity: 'nw_item', id: 'item-3', op: 'upsert', fields: { owner: dewi.memberId }, changed: ['owner'] }, Date.now() + 10);
    await home.settle();
    let [row] = await budi.database.db.values<[string]>(sql`SELECT owner FROM nw_items WHERE book_id = ${bookId} AND item_id = 'item-3'`);
    expect(row).toEqual([fandri.memberId]);

    // Even Fandri, the rightful current owner, cannot reassign it.
    await send(home, fandri, fandri.memberId, { entity: 'nw_item', id: 'item-3', op: 'upsert', fields: { owner: dewi.memberId }, changed: ['owner'] }, Date.now() + 20);
    await home.settle();
    [row] = await budi.database.db.values<[string]>(sql`SELECT owner FROM nw_items WHERE book_id = ${bookId} AND item_id = 'item-3'`);
    expect(row).toEqual([fandri.memberId]);
    expect((await skipsOf(budi, bookId)).at(-1)).toEqual(['nw_item', 'item-3', authorityRefusal]);
  });

  it('finding 3: a new row whose owner cannot be determined (the field is absent) is refused, not allowed', async () => {
    const { home, fandri, bookId } = await household();
    await send(home, fandri, fandri.memberId, { entity: 'nw_item', id: 'item-4', op: 'upsert', fields: { summary: JSON.stringify({ kind: 'account' }), removed: 0 } });
    await home.settle();
    const rows = await fandri.database.db.values(sql`SELECT 1 FROM nw_items WHERE book_id = ${bookId} AND item_id = 'item-4'`);
    expect(rows).toEqual([]);
    expect(await skipsOf(fandri, bookId)).toEqual([['nw_item', 'item-4', authorityRefusal]]);
  });

  it('finding 3: a delete of a row not here is refused, not silently allowed', async () => {
    const { home, fandri, bookId } = await household();
    await send(home, fandri, fandri.memberId, { entity: 'nw_item', id: 'item-never-made', op: 'delete' });
    await home.settle();
    expect(await skipsOf(fandri, bookId)).toEqual([['nw_item', 'item-never-made', authorityRefusal]]);
  });

  it('finding 5: a writer refusal is recorded on the authoring device itself, not only its peers', async () => {
    const { home, dewi, budi, bookId } = await household();
    // Dewi signs honestly as herself, but names Budi as the owner: a plain writer mismatch, refused on every device —
    // including Dewi's own, which never runs applyChangeSetTx for its own entries.
    await send(home, dewi, dewi.memberId, { entity: 'nw_item', id: 'item-5', op: 'upsert', fields: { owner: budi.memberId, summary: JSON.stringify({}), removed: 0 } });
    await dewi.engine.syncOnce(bookId);
    expect(await skipsOf(dewi, bookId)).toEqual([['nw_item', 'item-5', authorityRefusal]]);
  });
});

describe('nw_pending: writer is the member it counts for', () => {
  it("a member's own device applies its own count; another member's device is refused", async () => {
    const { home, fandri, dewi, bookId } = await household();
    await send(home, fandri, fandri.memberId, { entity: 'nw_pending', id: fandri.memberId, op: 'upsert', fields: { count: 2 } });
    await home.settle();
    const [row] = await dewi.database.db.values<[number]>(sql`SELECT count FROM nw_pending WHERE book_id = ${bookId} AND member_id = ${fandri.memberId}`);
    expect(Number(row![0])).toBe(2);

    // Fandri authored the row, so his own database is never re-applied to (own entries are never re-applied locally,
    // spec §7.2); Dewi, a peer to Fandri's write and the (refused) author of the second, is checked instead.
    await send(home, dewi, dewi.memberId, { entity: 'nw_pending', id: fandri.memberId, op: 'upsert', fields: { count: 9 } });
    await home.settle();
    const [still] = await dewi.database.db.values<[number]>(sql`SELECT count FROM nw_pending WHERE book_id = ${bookId} AND member_id = ${fandri.memberId}`);
    expect(Number(still![0])).toBe(2);
    expect((await skipsOf(fandri, bookId)).at(-1)).toEqual(['nw_pending', fandri.memberId, authorityRefusal]);
  });
});

describe('member_transfer: writer is either party, per the authority view', () => {
  const line = (owner: string) => JSON.stringify({ owner, label: owner });
  const fieldsOf = (from: string, to: string) => ({
    occurredOn: '2026-09-29',
    amountMinor: 10_000,
    currency: 'IDR',
    from: line(from),
    to: line(to),
    description: 'reimbursement',
    void: 0,
    recordedBy: from,
  });

  it('the payer (from.owner) may write it', async () => {
    const { home, fandri, dewi, bookId } = await household();
    await send(home, fandri, fandri.memberId, { entity: 'member_transfer', id: 'xfer-1', op: 'upsert', fields: fieldsOf(fandri.memberId, dewi.memberId) });
    await home.settle();
    const [row] = await dewi.database.db.values<[string]>(sql`SELECT recorded_by FROM member_transfers WHERE book_id = ${bookId} AND transfer_id = 'xfer-1'`);
    expect(row).toEqual([fandri.memberId]);
  });

  it('the receiver (to.owner) may write it too', async () => {
    const { home, fandri, dewi, bookId } = await household();
    await send(home, dewi, dewi.memberId, { entity: 'member_transfer', id: 'xfer-2', op: 'upsert', fields: fieldsOf(fandri.memberId, dewi.memberId) });
    await home.settle();
    const [row] = await fandri.database.db.values<[string]>(sql`SELECT recorded_by FROM member_transfers WHERE book_id = ${bookId} AND transfer_id = 'xfer-2'`);
    expect(row).toEqual([fandri.memberId]);
  });

  it('a third member is refused', async () => {
    const { home, fandri, dewi, budi, bookId } = await household();
    await send(home, budi, budi.memberId, { entity: 'member_transfer', id: 'xfer-3', op: 'upsert', fields: fieldsOf(fandri.memberId, dewi.memberId) });
    await home.settle();
    const rows = await fandri.database.db.values(sql`SELECT 1 FROM member_transfers WHERE book_id = ${bookId} AND transfer_id = 'xfer-3'`);
    expect(rows).toEqual([]);
    expect(await skipsOf(fandri, bookId)).toEqual([['member_transfer', 'xfer-3', authorityRefusal]]);
  });

  it('finding 2: neither party can redirect an existing transfer by rewriting from/to/recordedBy', async () => {
    const { home, fandri, dewi, budi, bookId } = await household();
    await send(home, fandri, fandri.memberId, { entity: 'member_transfer', id: 'xfer-4', op: 'upsert', fields: fieldsOf(fandri.memberId, dewi.memberId) });
    await home.settle();

    // Fandri authors both ops, so his own database is never re-applied to (own entries are never re-applied
    // locally, spec §7.2); Budi, a peer to both, is checked instead.
    await send(home, fandri, fandri.memberId, { entity: 'member_transfer', id: 'xfer-4', op: 'upsert', fields: { to: line(budi.memberId) }, changed: ['to'] }, Date.now() + 10);
    await home.settle();
    const [row] = await budi.database.db.values<[string]>(sql`SELECT to_json FROM member_transfers WHERE book_id = ${bookId} AND transfer_id = 'xfer-4'`);
    expect(row).toEqual([line(dewi.memberId)]);
    expect((await skipsOf(budi, bookId)).at(-1)).toEqual(['member_transfer', 'xfer-4', authorityRefusal]);
  });

  it('finding 4: malformed from/to is refused, not an unhandled crash that wedges the log', async () => {
    const { home, fandri, dewi, bookId } = await household();
    await send(home, fandri, fandri.memberId, {
      entity: 'member_transfer',
      id: 'xfer-5',
      op: 'upsert',
      fields: { ...fieldsOf(fandri.memberId, dewi.memberId), from: 'not valid json{' },
    });
    // Must not throw and must not stop the sync (a bad decision would leave the cursor stuck before this entry).
    const result = await fandri.engine.syncOnce(home.bookId);
    expect(result.stopped).toBeUndefined();
    await home.settle();
    const rows = await dewi.database.db.values(sql`SELECT 1 FROM member_transfers WHERE book_id = ${bookId} AND transfer_id = 'xfer-5'`);
    expect(rows).toEqual([]);
    expect(await skipsOf(fandri, bookId)).toEqual([['member_transfer', 'xfer-5', authorityRefusal]]);
  });
});

describe('meetsMinVersion', () => {
  it('compares release segments numerically, and reads null as not meeting it', () => {
    expect(meetsMinVersion('0.3.0')).toBe(true);
    expect(meetsMinVersion('0.2.9')).toBe(false);
    expect(meetsMinVersion(null)).toBe(false);
    expect(meetsMinVersion('0.10.0')).toBe(true);
  });
});

describe("a device's app version travels to its peers (spec §9)", () => {
  it('two devices built with appVersion see each other’s app_version after settling', async () => {
    const home = new Household();
    const fandri = await home.device('Fandri', undefined, 'IDR', '0.3.0');
    const dewi = await home.device('Dewi', undefined, 'IDR', '0.3.0');
    const bookId = await home.share(fandri);
    await home.join(dewi, fandri);
    await home.settle();

    const onFandri = await fandri.database.db.values<[string]>(sql`SELECT app_version FROM book_devices WHERE book_id = ${bookId} AND device_id = ${dewi.deviceId}`);
    expect(onFandri).toEqual([['0.3.0']]);
    const onDewi = await dewi.database.db.values<[string]>(sql`SELECT app_version FROM book_devices WHERE book_id = ${bookId} AND device_id = ${fandri.deviceId}`);
    expect(onDewi).toEqual([['0.3.0']]);
  });

  it('ruling: a device upgraded since it shared corrects its app_version on its next sync, and its peer sees the new one', async () => {
    const home = new Household();
    const fandri = await home.device('Fandri', undefined, 'IDR', '0.2.0');
    const dewi = await home.device('Dewi', undefined, 'IDR', '0.3.0');
    const bookId = await home.share(fandri);
    await home.join(dewi, fandri);
    await home.settle();
    const before = await dewi.database.db.values<[string]>(sql`SELECT app_version FROM book_devices WHERE book_id = ${bookId} AND device_id = ${fandri.deviceId}`);
    expect(before).toEqual([['0.2.0']]);

    // Fandri's phone is upgraded: the same device and database, wired to a fresh engine reporting the new version.
    fandri.engine = new SyncEngine(fandri.database, fandri.transport, fandri.keys, undefined, { appVersion: '0.3.0' });
    await home.settle();
    const after = await dewi.database.db.values<[string]>(sql`SELECT app_version FROM book_devices WHERE book_id = ${bookId} AND device_id = ${fandri.deviceId}`);
    expect(after).toEqual([['0.3.0']]);
  });
});
