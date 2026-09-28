import { asc, eq, sql } from 'drizzle-orm';
import type { Database } from '../../src/database';
import { sharedBooks, syncOutbox } from '../../src/schema-sharing';
import { configureCapture } from '../../src/sync/capture';
import { decodeHlc } from '../../src/sync/hlc';
import type { ChangeSet, Op } from '../../src/sync/types';

/** Marks a book shared on this device (the minimal stand-in for Share, which is task 4/5's). */
export async function shareBookForTest(database: Database, bookId: string, memberId = 'member-me', epoch = 1): Promise<void> {
  // A test of capture alone has no engine: the stand-in device id is allowed here, and nowhere in the app (final review, I3).
  configureCapture(database, { standInDeviceId: true });
  await database.db.insert(sharedBooks).values({ bookId, relayBookId: `relay-${bookId}`, epoch, memberId, state: 'active', sharedAt: new Date().toISOString() });
}

export interface OutboxChangeSet extends ChangeSet {
  bookId: string;
  deviceId: string;
}

/** Every change-set in the outbox (plaintext until the engine seals it at drain), oldest first. */
export async function outboxChangeSets(database: Database): Promise<OutboxChangeSet[]> {
  const rows = await database.db.select().from(syncOutbox).orderBy(asc(syncOutbox.hlc));
  return rows.map((row) => {
    const changeSet = JSON.parse(row.entryJson) as ChangeSet;
    return { ...changeSet, bookId: row.bookId, deviceId: decodeHlc(changeSet.hlc).deviceId };
  });
}

/** Every op in the outbox, in hlc order. */
export async function outboxOps(database: Database): Promise<Op[]> {
  return (await outboxChangeSets(database)).flatMap((cs) => cs.ops);
}

/** Empties the outbox, so a test can look at what one write emits. */
export async function clearOutbox(database: Database): Promise<void> {
  await database.db.delete(syncOutbox);
}

export async function fieldClock(database: Database, entity: string, id: string, field: string): Promise<string | undefined> {
  const rows = await database.db.values<[string]>(
    sql`SELECT hlc FROM sync_field_clocks WHERE entity = ${entity} AND id = ${id} AND field = ${field}`,
  );
  return rows[0]?.[0];
}

export async function lineageRow(database: Database, lineageId: string) {
  const rows = await database.db.values<[string, string | null, string, string]>(
    sql`SELECT book_id, head_transaction_id, paid_by, paid_label FROM sync_lineage WHERE lineage_id = ${lineageId}`,
  );
  const row = rows[0];
  return row ? { bookId: row[0], head: row[1], paidBy: row[2], paidLabel: row[3] } : undefined;
}

export async function sharedBookRow(database: Database, bookId: string) {
  const [row] = await database.db.select().from(sharedBooks).where(eq(sharedBooks.bookId, bookId));
  return row;
}
