import { sql } from 'drizzle-orm';
import { vi } from 'vitest';
import { createAccount, createDatabase, createWorkspace, migrate, personalBook, type Database, type WorkspaceContext } from '../../src/index';
import { createNodeExecutor } from '../../src/node';
import { projectPurchase } from '../../src/sync/capture';
import { SyncEngine } from '../../src/sync/engine';
import { generateDevice, requestSignerOf, type DeviceKeys } from '../../src/sync/keys';
import { MemoryTransport } from '../../src/sync/memory-transport';
import { SHARED_ENTITIES, buildOpId, type RowEntity } from '../../src/sync/shared-entities';
import type { DevicePublic, SyncTransport } from '../../src/sync/types';

/*
 * A household of devices on one in-memory relay, for the apply and merge tests (spec §13). Every device has real keys
 * (spec §5): the relay checks each request's signature, entries are sealed and signed at drain, and joining is the real
 * invite and claim (§8.1–8.2).
 */

// A household test builds two or three databases and syncs them several times: under a loaded machine that passes the
// default 5 s, so every test file that builds one gets more room.
vi.setConfig({ testTimeout: 30_000 });

let template: Uint8Array | undefined;

/** A migrated, empty database: migrations run once per test file and are copied from there (they are most of the cost). */
async function freshDatabase(baseCurrency: string): Promise<{ database: Database; ws: WorkspaceContext }> {
  if (!template) {
    const seed = createDatabase(createNodeExecutor());
    await migrate(seed);
    template = await seed.exportBytes();
  }
  const database = createDatabase(createNodeExecutor());
  await database.importBytes(template);
  const ws = await createWorkspace(database, { name: 'Personal', type: 'personal', baseCurrency });
  // The capture run (capture-setup.ts) shares every first Personal book from birth, as a stand-in for Share. A
  // household device shares only what it chooses, through the engine: that stand-in is taken back before any write.
  await database.execScript('DELETE FROM shared_books');
  return { database, ws };
}

export interface Device {
  name: string;
  database: Database;
  ws: WorkspaceContext;
  deviceId: string;
  public: DevicePublic;
  keys: DeviceKeys;
  transport: SyncTransport;
  engine: SyncEngine;
  /** This device's own bank account, in the workspace currency. */
  bank: string;
  /** A second own account in the workspace currency, for purchases paid from two places. */
  cash: string;
  /** This device's own dollar account (lines in another currency than the book's, ruled O2). */
  usd: string;
  memberId: string;
}

export class Household {
  readonly relay = new MemoryTransport();
  readonly devices: Device[] = [];
  bookId = '';
  relayBookId = '';

  async device(name: string, memberId: string = `member-${name}`, baseCurrency = 'IDR'): Promise<Device> {
    const { database, ws } = await freshDatabase(baseCurrency);
    const keys = await generateDevice();
    const { deviceId, public: pub } = keys;
    const bank = await createAccount(database, ws, { name: `${name} Bank`, kind: 'asset', subtype: 'bank', currency: baseCurrency });
    const usd = await createAccount(database, ws, { name: `${name} Dollars`, kind: 'asset', subtype: 'bank', currency: 'USD' });
    const cash = await createAccount(database, ws, { name: `${name} Wallet`, kind: 'asset', subtype: 'cash', currency: baseCurrency });
    const transport = this.relay.as(requestSignerOf(keys));
    const device: Device = { name, database, ws, deviceId, public: pub, keys, transport, engine: new SyncEngine(database, transport, keys), bank: bank.id, cash: cash.id, usd: usd.id, memberId };
    this.devices.push(device);
    return device;
  }

  /** The owner shares their Personal book (§6.5): the relay book, the seed. Drains nothing. */
  async share(owner: Device): Promise<string> {
    const book = await personalBook(owner.database, owner.ws);
    const { relayBookId } = await owner.engine.shareBook(book.id, { memberId: owner.memberId, memberName: owner.name, deviceName: `${owner.name}'s phone` });
    this.bookId = book.id;
    this.relayBookId = relayBookId;
    return book.id;
  }

  /** The real join (§8.1–8.2): the owner invites, the joiner previews, claims, introduces itself and syncs once. */
  async join(joiner: Device, owner: Device): Promise<void> {
    const { code } = await owner.engine.createInvite(this.bookId, { inviterName: owner.name });
    await joiner.engine.joinBook(code, { ws: joiner.ws, memberName: joiner.name, deviceName: `${joiner.name}'s phone`, memberId: joiner.memberId });
  }

  /**
   * A phone restored from a backup of `lost` (§8.7): the same database bytes, new device keys — a new device, as a
   * replaced or restored phone always is (§5.1). The lost phone leaves the household's list.
   */
  async restore(lost: Device, backup: Uint8Array): Promise<Device> {
    const database = createDatabase(createNodeExecutor());
    await database.importBytes(backup);
    const keys = await generateDevice();
    const transport = this.relay.as(requestSignerOf(keys));
    const device: Device = { ...lost, database, keys, deviceId: keys.deviceId, public: keys.public, transport, engine: new SyncEngine(database, transport, keys) };
    this.devices.splice(this.devices.indexOf(lost), 1, device);
    return device;
  }

  /** Every device drains, then every device pulls: nothing is left in flight. */
  async settle(devices: readonly Device[] = this.devices): Promise<void> {
    for (const d of devices) await d.engine.syncOnce(this.bookId);
    for (const d of devices) await d.engine.syncOnce(this.bookId);
  }
}

/** Ops this device's apply skipped (§7.1): a property run must end with none. */
export async function skipsOf(database: Database): Promise<unknown[]> {
  return database.db.values(sql`SELECT seq, entity, id, error FROM sync_skipped`);
}

/** This device's member in the book. */
export async function memberOf(database: Database, bookId: string): Promise<string> {
  const [row] = await database.db.values<[string]>(sql`SELECT member_id FROM shared_books WHERE book_id = ${bookId}`);
  return row![0];
}

/**
 * Every `SHARED_ENTITIES` entity of the book as this device reads it, in a form that must be identical on every
 * device: rows by `Op.id` with their synced fields; a bill's payer as the member only (its account is local and its
 * label is the paying device's account name); a purchase by lineage, as the purchase it reads as, or `'void'`.
 */
export async function projectBook(database: Database, bookId: string): Promise<Record<string, Record<string, unknown>>> {
  const memberId = await memberOf(database, bookId);
  const out: Record<string, Record<string, unknown>> = {};
  for (const entity of SHARED_ENTITIES) {
    if (entity.kind === 'purchase') {
      const lineages = await database.db.values<[string, string | null, string, string]>(
        sql`SELECT lineage_id, head_transaction_id, paid_by, paid_label FROM sync_lineage WHERE book_id = ${bookId} ORDER BY lineage_id`,
      );
      const purchases: Record<string, unknown> = {};
      for (const [lineageId, head, paidBy, paidLabel] of lineages) {
        purchases[lineageId] = head === null ? 'void' : await projectPurchase(database.db, head, memberId, { paidBy, paidLabel });
      }
      out.purchase = purchases;
      continue;
    }
    out[entity.entity] = await projectRows(database, bookId, entity);
  }
  return out;
}

async function projectRows(database: Database, bookId: string, entity: RowEntity): Promise<Record<string, unknown>> {
  const fields = Object.entries(entity.fields);
  const derived = entity.derivedFields ? Object.values(entity.derivedFields).flat() : [];
  const columns = [...entity.keyColumns, ...fields.map(([, c]) => c), ...derived];
  const rows = await database.db.values<unknown[]>(
    sql`SELECT ${sql.raw(columns.map((c) => `t.${c}`).join(', '))} FROM ${sql.raw(entity.table)} t WHERE ${entity.scope(bookId)}`,
  );
  const out: Record<string, unknown> = {};
  for (const row of rows) {
    const key = Object.fromEntries(entity.keyColumns.map((c, i) => [c, String(row[i])]));
    const values: Record<string, unknown> = {};
    fields.forEach(([name], i) => (values[name] = row[entity.keyColumns.length + i]));
    if (derived.length) {
      const accountId = String(row[entity.keyColumns.length + fields.length]);
      const [placeholder] = await database.db.values<[string]>(sql`SELECT member_id FROM book_member_accounts WHERE account_id = ${accountId}`);
      values.payer = placeholder ? placeholder[0] : await memberOf(database, bookId);
    }
    out[buildOpId(entity, key)] = values;
  }
  return Object.fromEntries(Object.entries(out).sort(([a], [b]) => (a < b ? -1 : 1)));
}

/** The posted rows of one lineage in the book on this device. */
export async function postedRowsOf(database: Database, bookId: string, lineageId: string): Promise<string[]> {
  const rows = await database.db.values<[string]>(sql`
    WITH RECURSIVE forward(id) AS (
      SELECT ${lineageId}
      UNION ALL
      SELECT t.id FROM transactions t JOIN forward f ON t.replaces_transaction_id = f.id
    )
    SELECT t.id FROM transactions t JOIN forward f ON f.id = t.id
    WHERE t.status = 'posted' AND t.id IN (SELECT transaction_id FROM book_transactions WHERE book_id = ${bookId})`);
  return rows.map((r) => r[0]);
}

/** The head a lineage has on this device, or null when void. */
export async function headOf(database: Database, lineageId: string): Promise<string | null> {
  const [row] = await database.db.values<[string | null]>(sql`SELECT head_transaction_id FROM sync_lineage WHERE lineage_id = ${lineageId}`);
  return row ? row[0] : null;
}

/** The categories of the book on this device, by name. */
export async function categoryOf(database: Database, bookId: string, name: string): Promise<string> {
  const [row] = await database.db.values<[string]>(
    sql`SELECT a.id FROM accounts a JOIN book_categories bc ON bc.category_account_id = a.id WHERE bc.book_id = ${bookId} AND a.name = ${name} AND a.kind = 'expense'`,
  );
  if (!row) throw new Error(`no category ${name} in ${bookId}`);
  return row[0];
}
