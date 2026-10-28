import { isSupportedCurrency, makeConverter, type RateRow } from '@expanses/core';
import { sql } from 'drizzle-orm';
import type { WorkspaceContext } from '../context';
import type { Database, Db } from '../database';
import { EventError } from './event-scope';

/*
 * `event_currency` and `event_item_currency` (0104): the currency a personal event plans in, and the one an item is
 * priced in. Read and written by name through raw SQL, like the other side tables, so a database stopped before them
 * reads every event and item as the workspace's base currency — which is what they all were — and never fails a save.
 * Local: the personal plan does not sync, so neither do these.
 *
 * No row means the base currency. An item with no row keeps its price in base minor units whatever its event is in
 * now; an item with a row has its price in that currency's minor units.
 */

const seen = new WeakSet<object>();

/** Whether this copy of the data has the two tables. Only a yes is remembered: `migrate()` may run later on the handle. */
export async function eventCurrencyTablesExist(db: Db): Promise<boolean> {
  if (seen.has(db)) return true;
  const rows = await db.values<[number]>(sql`SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'event_item_currency'`);
  if (rows.length === 0) return false;
  seen.add(db);
  return true;
}

/** Every stored event currency of the workspace, by event id. */
export async function listEventCurrencies(db: Db, ws: WorkspaceContext): Promise<Map<string, string>> {
  if (!(await eventCurrencyTablesExist(db))) return new Map();
  const rows = await db.values<[string, string]>(sql`SELECT event_id, currency FROM event_currency WHERE workspace_id = ${ws.workspaceId}`);
  return new Map(rows);
}

/** Every stored item currency of an event's items, by item id. Items with none are not in the map. */
export async function itemCurrencies(db: Db, ws: WorkspaceContext, itemIds: readonly string[]): Promise<Map<string, string>> {
  if (itemIds.length === 0 || !(await eventCurrencyTablesExist(db))) return new Map();
  const rows = await db.values<[string, string]>(
    sql`SELECT item_id, currency FROM event_item_currency WHERE workspace_id = ${ws.workspaceId} AND item_id IN (${sql.join(
      itemIds.map((id) => sql`${id}`),
      sql`, `,
    )})`,
  );
  return new Map(rows);
}

/** Writes an item's currency, or — with null — takes it off, so the item reads as base again. */
export async function writeItemCurrency(db: Db, ws: WorkspaceContext, itemId: string, currency: string | null): Promise<void> {
  if (!(await eventCurrencyTablesExist(db))) return;
  await db.run(sql`DELETE FROM event_item_currency WHERE workspace_id = ${ws.workspaceId} AND item_id = ${itemId}`);
  if (currency !== null) {
    if (!isSupportedCurrency(currency)) throw new EventError('BAD_CURRENCY', `${currency} is not a currency this app knows`);
    await db.run(sql`INSERT INTO event_item_currency (item_id, workspace_id, currency) VALUES (${itemId}, ${ws.workspaceId}, ${currency})`);
  }
}

/** Whether anything on the event has been bought: an item with a payment against it, or marked done. */
export async function anythingBought(db: Db, ws: WorkspaceContext, eventId: string): Promise<boolean> {
  const exists = await db.values<[number]>(sql`SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'event_items'`);
  if (exists.length === 0) return false;
  const [done] = await db.values<[number]>(
    sql`SELECT count(*) FROM event_items WHERE workspace_id = ${ws.workspaceId} AND event_id = ${eventId} AND done_at IS NOT NULL`,
  );
  if (Number(done?.[0] ?? 0) > 0) return true;
  const table = await db.values<[number]>(sql`SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'event_item_purchases'`);
  if (table.length === 0) return false;
  const [paid] = await db.values<[number]>(
    sql`SELECT count(*) FROM event_item_purchases p JOIN event_items i ON i.id = p.item_id
        WHERE p.workspace_id = ${ws.workspaceId} AND i.event_id = ${eventId}`,
  );
  return Number(paid?.[0] ?? 0) > 0;
}

/**
 * Sets the currency an event plans in; null, or the base currency, takes it back to the default.
 *
 * Fixed once anything is bought, as a shared event's is after its first expense: a bought item is held at what was
 * paid, and changing the currency under it would change what those figures are read in. Until then it rewrites
 * nothing — items keep their own currencies, and an item with none keeps reading as base. Asking for the currency the
 * event already has is always fine.
 */
export async function setEventCurrency(database: Database, ws: WorkspaceContext, eventId: string, currency: string | null): Promise<void> {
  const db = database.db;
  if (!(await eventCurrencyTablesExist(db))) return;
  const next = currency === null || currency === ws.baseCurrency ? null : currency;
  if (next !== null && !isSupportedCurrency(next)) throw new EventError('BAD_CURRENCY', `${next} is not a currency this app knows`);
  const now = (await listEventCurrencies(db, ws)).get(eventId) ?? null;
  if (now === next) return;
  if (await anythingBought(db, ws, eventId)) {
    throw new EventError('CURRENCY_FIXED', 'The currency cannot change once something is bought for the event');
  }
  await db.run(sql`DELETE FROM event_currency WHERE workspace_id = ${ws.workspaceId} AND event_id = ${eventId}`);
  if (next !== null) await db.run(sql`INSERT INTO event_currency (event_id, workspace_id, currency) VALUES (${eventId}, ${ws.workspaceId}, ${next})`);
}

/** A converter over every stored rate: one snapshot, the table holds a handful of rows per pair. */
export async function storedConverter(db: Db, baseCurrency: string) {
  const rows = await db.values<[string, string, string, number]>(sql`SELECT from_currency, to_currency, on_date, rate FROM fx_rates`);
  const list: RateRow[] = rows.map(([from, to, onDate, rate]) => ({ from, to, onDate, rate }));
  return makeConverter(list, baseCurrency);
}
