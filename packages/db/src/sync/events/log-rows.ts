import { sql } from 'drizzle-orm';
import type { Db } from '../../database';
import { entityOf, type RowEntity } from '../shared-entities';
import type { Op } from '../types';

/*
 * A shared event's rows as the log has them (final review I3). Every phone decides a write to an event row by the one
 * predicate (`eventWriteRefusal`), against the row as it stood. The row this phone stores is not always that: it holds
 * this phone's own writes the moment they are made, before the log has them, and a friend's op the log took first can
 * make one of them a write the log refuses (Budi takes over the dinner Rina paid for him a moment before Andi, offline,
 * voids it). Judged against the stored row, Andi's own phone would let its void stand while every other phone refused
 * it, and Andi's balances would differ from everyone's for good.
 *
 * So each phone keeps, beside the stored rows, the rows as the log made them: every op the log takes, in log order,
 * merged field by field by its clock exactly as apply merges it. Decisions read this (own entries and peers' alike), and
 * an own write the log refused is put back to it. Local bookkeeping in `settings`, one key per row; never synced.
 */

const PREFIX = (bookId: string) => `shared-events.log.${bookId}|`;
const KEY = (bookId: string, entity: string, id: string) => `${PREFIX(bookId)}${entity}|${id}`;

export interface EventLogRow {
  values: Record<string, unknown>;
  clocks: Record<string, string>;
}

/** The row as the log has it, or null when the log has never taken it (or this phone kept no account of it). */
export async function eventLogRowTx(tx: Db, bookId: string, entity: string, id: string): Promise<EventLogRow | null> {
  const [row] = await tx.values<[string]>(sql`SELECT value FROM settings WHERE key = ${KEY(bookId, entity, id)}`);
  return row ? (JSON.parse(row[0]) as EventLogRow) : null;
}

/**
 * One op the log took, merged in as apply merges it (`rowWinnersOf`): a field the op names as changed at the change-set's
 * hlc, any other at the clock it carries (never later than the change-set); a field wins over an older clock or none.
 */
export async function noteEventLogOpTx(tx: Db, bookId: string, op: Op, hlc: string): Promise<void> {
  const key = KEY(bookId, op.entity, op.id);
  if (op.op === 'delete') {
    await tx.run(sql`DELETE FROM settings WHERE key = ${key}`);
    return;
  }
  const row = (await eventLogRowTx(tx, bookId, op.entity, op.id)) ?? { values: {}, clocks: {} };
  const changed = op.changed ?? Object.keys(op.fields);
  for (const [field, value] of Object.entries(op.fields)) {
    const carried = op.clocks?.[field];
    const at = changed.includes(field) ? hlc : carried !== undefined && carried > hlc ? hlc : carried;
    const clock = row.clocks[field];
    if (at === undefined) {
      if (clock === undefined && !op.changed) {
        row.values[field] = value;
        row.clocks[field] = hlc;
      }
      continue;
    }
    if (clock === undefined || at > clock) {
      row.values[field] = value;
      row.clocks[field] = at;
    }
  }
  await tx.run(sql`INSERT INTO settings (key, value) VALUES (${key}, ${JSON.stringify(row)}) ON CONFLICT (key) DO UPDATE SET value = excluded.value`);
}

/** Everything kept of an event's log rows goes, with the rows themselves (a rejoin pulls the log again from its start). */
export async function dropEventLogRowsTx(tx: Db, bookId: string): Promise<void> {
  const prefix = PREFIX(bookId);
  await tx.run(sql`DELETE FROM settings WHERE substr(key, 1, ${prefix.length}) = ${prefix}`);
}

/**
 * This phone's own write to an event row, refused by the log (I3): each field it wrote, while that field still holds
 * this write here, goes back to what the log has, with the log's clock, so a later op merges exactly as on every other
 * phone. A field written since (by this phone again, or by a friend with a newer clock) keeps what it has. Nothing is
 * emitted. Returns whether anything went back; the caller then brings the record's own lines here in line.
 */
export async function restoreRefusedOwnEventOpTx(tx: Db, bookId: string, op: Op, hlc: string): Promise<boolean> {
  const entity = entityOf(op.entity) as RowEntity;
  // Records, people, categories and plan items are keyed by their own id; the event's own row is never refused.
  if (entity.kind !== 'row' || op.op !== 'upsert' || entity.keyColumns.length !== 1 || entity.keyColumns[0] !== 'id') return false;
  // A row the log has no account of here (a book followed before these were kept) is left as it is: nothing to go back to.
  const logged = await eventLogRowTx(tx, bookId, op.entity, op.id);
  if (!logged) return false;
  for (const field of Object.keys(op.fields)) {
    const column = entity.fields[field];
    if (typeof column !== 'string' || !(field in logged.values)) continue;
    const [clock] = await tx.values<[string]>(sql`SELECT hlc FROM sync_field_clocks WHERE book_id = ${bookId} AND entity = ${op.entity} AND id = ${op.id} AND field = ${field}`);
    if (clock && clock[0] !== hlc) continue;
    const value = (logged.values[field] ?? null) as string | number | null;
    await tx.run(sql`UPDATE ${sql.raw(entity.table)} SET ${sql.raw(column)} = ${value} WHERE book_id = ${bookId} AND id = ${op.id}`);
    const at = logged.clocks[field];
    if (at === undefined) await tx.run(sql`DELETE FROM sync_field_clocks WHERE book_id = ${bookId} AND entity = ${op.entity} AND id = ${op.id} AND field = ${field}`);
    else {
      await tx.run(sql`
        INSERT INTO sync_field_clocks (book_id, entity, id, field, hlc) VALUES (${bookId}, ${op.entity}, ${op.id}, ${field}, ${at})
        ON CONFLICT (book_id, entity, id, field) DO UPDATE SET hlc = excluded.hlc`);
    }
  }
  return true;
}
