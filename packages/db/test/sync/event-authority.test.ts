import { sql } from 'drizzle-orm';
import { afterEach, describe, expect, it } from 'vitest';
import { createAccount } from '../../src/index';
import type { NodeExecutor } from '../../src/node';
import { AuthorityError, decideOpsTx } from '../../src/sync/authority';
import { bookContextTx } from '../../src/sync/apply';
import { eventWriteRefusal } from '../../src/sync/events/authority';
import { encodeHlc } from '../../src/sync/hlc';
import type { Op } from '../../src/sync/types';
import { setupDb } from '../helpers';
import { shareBookForTest } from './sync-helpers';

/*
 * Who may write a shared event's rows (shared events §3, D8; rulings R1–R3, R11). One pure predicate judges this
 * phone's own write and a peer's op alike. Review Focus 5: an expense's money is its payer's member's alone, and the
 * detail entity — the split, the category, the note — carries none of it.
 */

const expense = (over: Record<string, unknown> = {}) => ({
  occurredOn: '2026-10-06',
  amountMinor: 9_000,
  currency: 'EUR',
  rateToEvent: '31.5',
  payerPersonId: 'p-rina',
  payerMemberId: 'p-rina',
  voidedAt: null,
  ...over,
});
const key = { id: 'exp-1' };

describe('eventWriteRefusal: an expense paid from a member’s account', () => {
  it('is recorded by that member only', () => {
    expect(eventWriteRefusal('event_expense', null, expense(), key, 'p-rina')).toBeNull();
    expect(eventWriteRefusal('event_expense', null, expense(), key, 'p-andi')).toMatch(/only the person whose money it is/);
  });

  it('keeps its amount, currency, rate, date and void to its payer’s member', () => {
    for (const change of [{ amountMinor: 1 }, { currency: 'TRY' }, { rateToEvent: '30' }, { occurredOn: '2026-10-07' }, { voidedAt: '2026-10-08T00:00:00Z' }]) {
      expect(eventWriteRefusal('event_expense', expense(), expense(change), key, 'p-andi')).not.toBeNull();
      expect(eventWriteRefusal('event_expense', expense(), expense(change), key, 'p-rina')).toBeNull();
    }
  });

  it('never changes who paid, nor the member', () => {
    expect(eventWriteRefusal('event_expense', expense(), expense({ payerPersonId: 'p-andi' }), key, 'p-rina')).toMatch(/who paid is fixed/);
    expect(eventWriteRefusal('event_expense', expense(), expense({ payerMemberId: null }), key, 'p-rina')).toMatch(/set once/);
  });

  it('lets anyone write its details: split, category, note (Review Focus 5 — no money travels there)', () => {
    const detail = { note: 'Fish dinner', categoryId: 'cat-1', splitMode: 'equal', splitJson: '["p-rina","p-andi"]', recordedBy: 'p-rina', updatedBy: null };
    expect(eventWriteRefusal('event_expense_detail', detail, { ...detail, splitJson: '["p-andi"]', updatedBy: 'p-andi' }, key, 'p-andi')).toBeNull();
  });
});

describe('eventWriteRefusal: an expense paid outside the app', () => {
  const outside = expense({ payerPersonId: 'p-budi', payerMemberId: null });

  it('is anyone’s to record and change, its payer included', () => {
    expect(eventWriteRefusal('event_expense', null, outside, key, 'p-andi')).toBeNull();
    expect(eventWriteRefusal('event_expense', outside, { ...outside, amountMinor: 8_000, payerPersonId: 'p-dewi' }, key, 'p-andi')).toBeNull();
  });

  it('is taken over by the person who paid it, once they have the app, and by nobody else', () => {
    expect(eventWriteRefusal('event_expense', outside, { ...outside, payerMemberId: 'p-budi' }, key, 'p-budi')).toBeNull();
    expect(eventWriteRefusal('event_expense', outside, { ...outside, payerMemberId: 'p-andi' }, key, 'p-andi')).toMatch(/set only by the person it names/);
    expect(eventWriteRefusal('event_expense', outside, { ...outside, payerMemberId: 'p-budi' }, key, 'p-andi')).toMatch(/set only by the person it names/);
  });
});

describe('eventWriteRefusal: people, settlements, voids and deletes', () => {
  it('a name is claimed once, by the member whose id it is (R1)', () => {
    const budi = { name: 'Budi', memberId: null, removedAt: null };
    expect(eventWriteRefusal('event_person', budi, { ...budi, memberId: 'p-budi' }, { id: 'p-budi' }, 'p-budi')).toBeNull();
    expect(eventWriteRefusal('event_person', budi, { ...budi, memberId: 'p-andi' }, { id: 'p-budi' }, 'p-andi')).not.toBeNull();
    expect(eventWriteRefusal('event_person', { ...budi, memberId: 'p-budi' }, { ...budi, memberId: 'p-dewi' }, { id: 'p-budi' }, 'p-dewi')).toMatch(/set once/);
    expect(eventWriteRefusal('event_person', budi, { ...budi, name: 'Budi S.' }, { id: 'p-budi' }, 'p-andi')).toBeNull();
  });

  it('a settlement is written by either side’s member, anyone’s when neither has the app, and never re-pointed', () => {
    const s = { occurredOn: '2026-10-12', fromPersonId: 'p-andi', toPersonId: 'p-rina', fromMemberId: 'p-andi', toMemberId: 'p-rina', amountMinor: 290_000, voidedAt: null };
    expect(eventWriteRefusal('event_settlement', null, s, { id: 's-1' }, 'p-rina')).toBeNull();
    expect(eventWriteRefusal('event_settlement', null, s, { id: 's-1' }, 'p-dewi')).not.toBeNull();
    expect(eventWriteRefusal('event_settlement', s, { ...s, toPersonId: 'p-dewi' }, { id: 's-1' }, 'p-andi')).toMatch(/who paid whom is fixed/);
    const outside = { ...s, fromPersonId: 'p-budi', fromMemberId: null, toPersonId: 'p-dewi', toMemberId: null };
    expect(eventWriteRefusal('event_settlement', null, outside, { id: 's-2' }, 'p-andi')).toBeNull();
  });

  it('the side that gets the app later takes over its half, even when the other half is already a member’s', () => {
    const s = { occurredOn: '2026-10-12', fromPersonId: 'p-andi', toPersonId: 'p-budi', fromMemberId: 'p-andi', toMemberId: null, amountMinor: 90_000, voidedAt: null };
    expect(eventWriteRefusal('event_settlement', s, { ...s, toMemberId: 'p-budi' }, { id: 's-3' }, 'p-budi')).toBeNull();
    expect(eventWriteRefusal('event_settlement', s, { ...s, toMemberId: 'p-budi', amountMinor: 1 }, { id: 's-3' }, 'p-budi')).not.toBeNull();
  });

  it('a void stays a void; a record is never deleted, a category or an item may be', () => {
    expect(eventWriteRefusal('event_expense', expense({ voidedAt: '2026-10-08T00:00:00Z' }), expense({ voidedAt: null }), key, 'p-rina')).toMatch(/a void stays a void/);
    expect(eventWriteRefusal('event_expense', expense(), null, key, 'p-rina')).toMatch(/never deleted/);
    expect(eventWriteRefusal('event_category', { name: 'Dinners', icon: null, sortOrder: 0, archivedAt: null }, null, { id: 'cat-1' }, 'p-andi')).toBeNull();
  });

  it('says nothing about entities that are not a shared event’s', () => {
    expect(eventWriteRefusal('category', null, { name: 'x' }, { id: 'c' }, null)).toBeNull();
  });
});

let executor: NodeExecutor | undefined;
afterEach(() => {
  executor?.close();
  executor = undefined;
});

/** A stand-in event book on this phone: shared as Rina, held in the Personal workspace, with Andi in its view. */
async function eventBook() {
  const t = await setupDb();
  executor = t.executor;
  const trip = await createAccount(t.database, t.ws, { name: 'Coast week', kind: 'asset', subtype: 'event_balance', currency: 'TRY' });
  await shareBookForTest(t.database, 'ev-book', 'p-rina');
  await t.database.execScript(`
    INSERT INTO event_books (book_id, workspace_id, event_id, balance_account_id) VALUES ('ev-book', '${t.ws.workspaceId}', 'ev-local', '${trip.id}');
    INSERT INTO shared_events (book_id, name, starts_on, ends_on, currency, finished_at) VALUES ('ev-book', 'Coast week', '2026-10-05', '2026-10-12', 'TRY', NULL);
    INSERT INTO sync_authority (book_id, member_id, role, role_hlc, deleted, row_hlc) VALUES ('ev-book', 'p-andi', 'owner', '0', 0, '0');
    INSERT INTO sync_authority_devices (book_id, device_id, member_id, removed_seq, added_seq) VALUES ('ev-book', 'dev-andi', 'p-andi', NULL, 2);
    INSERT INTO event_expenses (book_id, id, occurred_on, amount_minor, currency, rate_to_event, payer_person_id, payer_member_id, voided_at)
      VALUES ('ev-book', 'exp-1', '2026-10-06', 9000, 'EUR', '31.5', 'p-rina', 'p-rina', NULL);
  `);
  return t;
}

describe('a peer’s op, decided against the stored row and the authority view', () => {
  it('refuses Andi’s change to the amount of Rina’s expense, and takes Andi’s change to its split', async () => {
    const t = await eventBook();
    const hlc = encodeHlc(Date.parse('2026-10-09T00:00:00Z'), 0, 'dev-andi');
    const decided = await t.database.transaction((tx) =>
      decideOpsTx(tx, { bookId: 'ev-book', author: 'dev-andi', hlc, creator: false }, [
        { entity: 'event_expense', id: 'exp-1', op: 'upsert', fields: { amountMinor: 1 } },
        { entity: 'event_expense_detail', id: 'exp-1', op: 'upsert', fields: { splitJson: '["p-andi"]', updatedBy: 'p-andi' } },
      ]),
    );
    expect(decided[0]).toBeInstanceOf(AuthorityError);
    expect((decided[0] as AuthorityError).message).toMatch(/^AUTHORITY: only the person whose money it is/);
    expect(decided[1]).not.toBeInstanceOf(AuthorityError);
  });

  it('strips a currency change that comes after the first expense in the log (R8)', async () => {
    const t = await eventBook();
    const hlc = encodeHlc(Date.parse('2026-10-09T00:00:00Z'), 0, 'dev-andi');
    const decided = await t.database.transaction(async (tx) => {
      await decideOpsTx(tx, { bookId: 'ev-book', author: 'dev-andi', hlc, creator: false }, [
        { entity: 'shared_event', id: 'ev-book', op: 'upsert', fields: { name: 'Coast week', startsOn: '2026-10-05', endsOn: '2026-10-12', currency: 'TRY', finishedAt: null } },
        { entity: 'event_expense', id: 'exp-2', op: 'upsert', fields: { occurredOn: '2026-10-07', amountMinor: 500, currency: 'TRY', rateToEvent: '1', payerPersonId: 'p-budi', payerMemberId: null, voidedAt: null } },
      ]);
      return decideOpsTx(tx, { bookId: 'ev-book', author: 'dev-andi', hlc, creator: false }, [
        { entity: 'shared_event', id: 'ev-book', op: 'upsert', fields: { name: 'Coast weekend', currency: 'EUR' }, changed: ['name', 'currency'] },
      ]);
    });
    expect(decided[0]).not.toBeInstanceOf(AuthorityError);
    const op = decided[0] as Op;
    expect(op.op === 'upsert' && op.fields).toEqual({ name: 'Coast weekend' });
  });
});

describe('an event book’s context', () => {
  it('is the workspace that holds it, in that workspace’s currency, as this phone’s member', async () => {
    const t = await eventBook();
    const ctx = await t.database.transaction((tx) => bookContextTx(tx, 'ev-book'));
    expect(ctx).toEqual({ bookId: 'ev-book', ws: { workspaceId: t.ws.workspaceId, baseCurrency: 'IDR' }, memberId: 'p-rina', currency: 'IDR' });
    expect((await t.database.db.values(sql`SELECT 1 FROM sync_skipped`)).length).toBe(0);
  });
});
