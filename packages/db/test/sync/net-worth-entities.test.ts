import { sql } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { personalBook } from '../../src/index';
import { applyChangeSet } from '../../src/sync/apply';
import { encodeHlc } from '../../src/sync/hlc';
import { meetsMinVersion } from '../../src/sync/net-worth/version';
import type { ChangeSet, Op } from '../../src/sync/types';
import { setupDb } from '../helpers';
import { Household } from './household';
import { shareBookForTest } from './sync-helpers';

/*
 * Joint net worth's foundations (spec §5.1, §9): the five entities `apply.ts` now knows, each with a `writer` — the
 * one member allowed to write it, checked against the change-set's author member — and the app-version each device
 * carries on its own `book_devices` row.
 */

async function sharedBook() {
  const { database, ws } = await setupDb();
  const book = await personalBook(database, ws);
  await shareBookForTest(database, book.id, 'member-me');
  return { database, bookId: book.id };
}

/** One change-set of a single op, authored by `member` (an hlc device id of its own, unrelated to `member`). */
function changeSetOf(member: string, op: Op, at = Date.now()): ChangeSet {
  return { v: 1, hlc: encodeHlc(at, 0, 'device-author'), member, ops: [op] };
}

const skipsOf = (database: Awaited<ReturnType<typeof sharedBook>>['database'], bookId: string) =>
  database.db.values<[string, string, string]>(sql`SELECT entity, id, error FROM sync_skipped WHERE book_id = ${bookId} ORDER BY seq`);

describe('nw_proposal: writer is its proposer', () => {
  it('the proposer’s change-set applies; another member’s is refused', async () => {
    const { database, bookId } = await sharedBook();
    const createdHlc = encodeHlc(Date.now(), 0, 'device-a');
    const fields = { mode: 'joint', members: JSON.stringify(['member-a', 'member-b']), proposedBy: 'member-a', createdHlc, cancelled: 0 };

    await applyChangeSet(database, bookId, changeSetOf('member-a', { entity: 'nw_proposal', id: 'prop-1', op: 'upsert', fields }));
    const [mine] = await database.db.values<[string, string]>(sql`SELECT proposal_id, proposed_by FROM nw_proposals WHERE book_id = ${bookId} AND proposal_id = 'prop-1'`);
    expect(mine).toEqual(['prop-1', 'member-a']);

    await applyChangeSet(database, bookId, changeSetOf('member-b', { entity: 'nw_proposal', id: 'prop-2', op: 'upsert', fields: { ...fields, proposedBy: 'member-a' } }));
    const rows = await database.db.values(sql`SELECT 1 FROM nw_proposals WHERE book_id = ${bookId} AND proposal_id = 'prop-2'`);
    expect(rows).toEqual([]);
    const skips = await skipsOf(database, bookId);
    expect(skips).toEqual([['nw_proposal', 'prop-2', expect.stringMatching(/^AUTHORITY:/)]]);
  });

  it('cancelled may only be set by the proposer, even as a partial edit naming only it', async () => {
    const { database, bookId } = await sharedBook();
    const createdHlc = encodeHlc(Date.now(), 0, 'device-a');
    const made = changeSetOf('member-a', {
      entity: 'nw_proposal',
      id: 'prop-3',
      op: 'upsert',
      fields: { mode: 'joint', members: JSON.stringify(['member-a', 'member-b']), proposedBy: 'member-a', createdHlc, cancelled: 0 },
    });
    await applyChangeSet(database, bookId, made);

    const cancelByOther = changeSetOf('member-b', { entity: 'nw_proposal', id: 'prop-3', op: 'upsert', fields: { cancelled: 1 }, changed: ['cancelled'] }, Date.now() + 10);
    await applyChangeSet(database, bookId, cancelByOther);
    const [row] = await database.db.values<[number]>(sql`SELECT cancelled FROM nw_proposals WHERE book_id = ${bookId} AND proposal_id = 'prop-3'`);
    expect(Number(row![0])).toBe(0);
    expect((await skipsOf(database, bookId)).at(-1)).toEqual(['nw_proposal', 'prop-3', expect.stringMatching(/^AUTHORITY:/)]);
  });
});

describe('nw_answer: writer is the member it answers for', () => {
  it('a member’s own answer applies; another member writing it is refused', async () => {
    const { database, bookId } = await sharedBook();
    const op: Op = { entity: 'nw_answer', id: 'prop-1|member-b', op: 'upsert', fields: { answer: 'confirm' } };
    await applyChangeSet(database, bookId, changeSetOf('member-b', op));
    const [row] = await database.db.values<[string]>(sql`SELECT answer FROM nw_answers WHERE book_id = ${bookId} AND proposal_id = 'prop-1' AND member_id = 'member-b'`);
    expect(row).toEqual(['confirm']);

    const other: Op = { entity: 'nw_answer', id: 'prop-1|member-c', op: 'upsert', fields: { answer: 'decline' } };
    await applyChangeSet(database, bookId, changeSetOf('member-a', other));
    const rows = await database.db.values(sql`SELECT 1 FROM nw_answers WHERE book_id = ${bookId} AND proposal_id = 'prop-1' AND member_id = 'member-c'`);
    expect(rows).toEqual([]);
    expect(await skipsOf(database, bookId)).toEqual([['nw_answer', 'prop-1|member-c', expect.stringMatching(/^AUTHORITY:/)]]);
  });
});

describe('nw_item: writer is its owner', () => {
  it('the owner’s change-set applies; another member’s is refused', async () => {
    const { database, bookId } = await sharedBook();
    const fields = { owner: 'member-a', summary: JSON.stringify({ kind: 'account', name: 'BCA' }), removed: 0 };
    await applyChangeSet(database, bookId, changeSetOf('member-a', { entity: 'nw_item', id: 'item-1', op: 'upsert', fields }));
    const [row] = await database.db.values<[string]>(sql`SELECT owner FROM nw_items WHERE book_id = ${bookId} AND item_id = 'item-1'`);
    expect(row).toEqual(['member-a']);

    await applyChangeSet(database, bookId, changeSetOf('member-b', { entity: 'nw_item', id: 'item-2', op: 'upsert', fields: { ...fields, owner: 'member-a' } }));
    const rows = await database.db.values(sql`SELECT 1 FROM nw_items WHERE book_id = ${bookId} AND item_id = 'item-2'`);
    expect(rows).toEqual([]);
    expect(await skipsOf(database, bookId)).toEqual([['nw_item', 'item-2', expect.stringMatching(/^AUTHORITY:/)]]);
  });
});

describe('nw_pending: writer is the member it counts for', () => {
  it('a member’s own count applies; another member writing it is refused', async () => {
    const { database, bookId } = await sharedBook();
    await applyChangeSet(database, bookId, changeSetOf('member-a', { entity: 'nw_pending', id: 'member-a', op: 'upsert', fields: { count: 2 } }));
    const [row] = await database.db.values<[number]>(sql`SELECT count FROM nw_pending WHERE book_id = ${bookId} AND member_id = 'member-a'`);
    expect(Number(row![0])).toBe(2);

    await applyChangeSet(database, bookId, changeSetOf('member-b', { entity: 'nw_pending', id: 'member-c', op: 'upsert', fields: { count: 5 } }));
    const rows = await database.db.values(sql`SELECT 1 FROM nw_pending WHERE book_id = ${bookId} AND member_id = 'member-c'`);
    expect(rows).toEqual([]);
    expect(await skipsOf(database, bookId)).toEqual([['nw_pending', 'member-c', expect.stringMatching(/^AUTHORITY:/)]]);
  });
});

describe('member_transfer: writer is either party', () => {
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
    const { database, bookId } = await sharedBook();
    await applyChangeSet(database, bookId, changeSetOf('member-a', { entity: 'member_transfer', id: 'xfer-1', op: 'upsert', fields: fieldsOf('member-a', 'member-b') }));
    const [row] = await database.db.values<[string]>(sql`SELECT recorded_by FROM member_transfers WHERE book_id = ${bookId} AND transfer_id = 'xfer-1'`);
    expect(row).toEqual(['member-a']);
  });

  it('the receiver (to.owner) may write it too', async () => {
    const { database, bookId } = await sharedBook();
    await applyChangeSet(database, bookId, changeSetOf('member-b', { entity: 'member_transfer', id: 'xfer-2', op: 'upsert', fields: fieldsOf('member-a', 'member-b') }));
    const [row] = await database.db.values<[string]>(sql`SELECT recorded_by FROM member_transfers WHERE book_id = ${bookId} AND transfer_id = 'xfer-2'`);
    expect(row).toEqual(['member-a']);
  });

  it('a third member is refused', async () => {
    const { database, bookId } = await sharedBook();
    await applyChangeSet(database, bookId, changeSetOf('member-c', { entity: 'member_transfer', id: 'xfer-3', op: 'upsert', fields: fieldsOf('member-a', 'member-b') }));
    const rows = await database.db.values(sql`SELECT 1 FROM member_transfers WHERE book_id = ${bookId} AND transfer_id = 'xfer-3'`);
    expect(rows).toEqual([]);
    expect(await skipsOf(database, bookId)).toEqual([['member_transfer', 'xfer-3', expect.stringMatching(/^AUTHORITY:/)]]);
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

describe('a device’s app version travels to its peers (spec §9)', () => {
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
});
