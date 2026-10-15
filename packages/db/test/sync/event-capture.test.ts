import { sql } from 'drizzle-orm';
import { afterEach, describe, expect, it } from 'vitest';
import { createAccount, personalBook } from '../../src/index';
import type { NodeExecutor } from '../../src/node';
import { AuthorityError } from '../../src/sync/authority';
import { withCapture } from '../../src/sync/capture';
import { setupDb } from '../helpers';
import { installCaptureTriggers, uncapturedWrites } from './capture-harness';
import { outboxOps, shareBookForTest } from './sync-helpers';

/*
 * This phone's own writes to a shared event's book (shared events §3, §7): captured whole (§6.4: nothing escapes),
 * judged before they commit by the same rules a peer's op meets, and kept out of any book that is not an event's.
 */

let executor: NodeExecutor | undefined;
afterEach(() => {
  executor?.close();
  executor = undefined;
});

async function eventBook() {
  const t = await setupDb();
  executor = t.executor;
  const trip = await createAccount(t.database, t.ws, { name: 'Coast week', kind: 'asset', subtype: 'event_balance', currency: 'TRY' });
  await shareBookForTest(t.database, 'ev-book', 'p-rina');
  await t.database.execScript(`
    INSERT INTO event_books (book_id, workspace_id, event_id, balance_account_id) VALUES ('ev-book', '${t.ws.workspaceId}', 'ev-local', '${trip.id}');
    INSERT INTO shared_events (book_id, name, starts_on, ends_on, currency, finished_at) VALUES ('ev-book', 'Coast week', '2026-10-05', '2026-10-12', 'TRY', NULL);
  `);
  await installCaptureTriggers(t.database, 'ev-book');
  return t;
}

const insertExpense = (payerMember: string | null) => sql`
  INSERT INTO event_expenses (book_id, id, occurred_on, amount_minor, currency, rate_to_event, payer_person_id, payer_member_id, voided_at)
  VALUES ('ev-book', 'exp-1', '2026-10-06', 9000, 'EUR', '31.5', ${payerMember ?? 'p-budi'}, ${payerMember}, NULL)`;

describe('capturing a shared event’s rows', () => {
  it('captures a new expense whole, and nothing escapes', async () => {
    const t = await eventBook();
    await t.database.transaction((tx) => withCapture(tx, { entity: 'event_expense', id: 'exp-1', bookId: 'ev-book' }, () => tx.run(insertExpense('p-rina'))));
    const ops = await outboxOps(t.database);
    expect(ops).toEqual([expect.objectContaining({ entity: 'event_expense', id: 'exp-1', op: 'upsert', fields: expect.objectContaining({ amountMinor: 9000, payerMemberId: 'p-rina' }) })]);
    expect(await uncapturedWrites(t.database, 'ev-book')).toEqual([]);
  });

  it('refuses, before it commits, an amount change to an expense another member paid', async () => {
    const t = await eventBook();
    await t.database.execScript(`INSERT INTO event_expenses (book_id, id, occurred_on, amount_minor, currency, rate_to_event, payer_person_id, payer_member_id, voided_at)
      VALUES ('ev-book', 'exp-9', '2026-10-06', 9000, 'EUR', '31.5', 'p-andi', 'p-andi', NULL)`);
    await expect(
      t.database.transaction((tx) => withCapture(tx, { entity: 'event_expense', id: 'exp-9', bookId: 'ev-book' }, () => tx.run(sql`UPDATE event_expenses SET amount_minor = 1 WHERE id = 'exp-9'`))),
    ).rejects.toBeInstanceOf(AuthorityError);
    expect(await t.database.db.values(sql`SELECT amount_minor FROM event_expenses WHERE id = 'exp-9'`)).toEqual([[9000]]);
  });

  it('refuses a currency change once an expense exists here (R8)', async () => {
    const t = await eventBook();
    await t.database.transaction((tx) => withCapture(tx, { entity: 'event_expense', id: 'exp-1', bookId: 'ev-book' }, () => tx.run(insertExpense(null))));
    await expect(
      t.database.transaction((tx) => withCapture(tx, { entity: 'shared_event', id: 'ev-book', bookId: 'ev-book' }, () => tx.run(sql`UPDATE shared_events SET currency = 'EUR' WHERE book_id = 'ev-book'`))),
    ).rejects.toThrow(/currency is fixed/);
  });

  it('refuses a shared event’s row written into a workspace’s book', async () => {
    const t = await eventBook();
    const book = await personalBook(t.database, t.ws);
    // The capture run shares every first Personal book from birth: share it here only when it is not already.
    await t.database.db.run(sql`INSERT INTO shared_books (book_id, relay_book_id, epoch, member_id, state, shared_at)
      VALUES (${book.id}, ${'relay-' + book.id}, 1, 'member-me', 'active', '2026-10-01T00:00:00Z') ON CONFLICT (book_id) DO NOTHING`);
    await expect(
      t.database.transaction((tx) =>
        withCapture(tx, { entity: 'event_person', id: 'p-x', bookId: book.id }, () =>
          tx.run(sql`INSERT INTO event_people (book_id, id, name, member_id, removed_at) VALUES (${book.id}, 'p-x', 'Someone', NULL, NULL)`),
        ),
      ),
    ).rejects.toThrow(/outside a shared event/);
  });
});
