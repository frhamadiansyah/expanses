import { uuidv7 } from '@expanses/core';
import { sql } from 'drizzle-orm';
import { vi } from 'vitest';
import { createAccount, createDatabase, createWorkspace, migrate, personalBook, type Database, type WorkspaceContext } from '../../src/index';
import { createNodeExecutor } from '../../src/node';
import { projectPurchase, withCapture } from '../../src/sync/capture';
import { SyncEngine } from '../../src/sync/engine';
import { deviceIdOf, MemoryTransport, stubSign } from '../../src/sync/memory-transport';
import { SHARED_ENTITIES, buildOpId, type RowEntity } from '../../src/sync/shared-entities';
import type { DevicePublic, SyncTransport } from '../../src/sync/types';

/*
 * A household of devices on one in-memory relay, for the apply and merge tests (spec §13). Joining is the minimal
 * stand-in the task allows — the book, `shared_books`, and the device's own member and device rows written directly —
 * because the real invite and join are task 5's.
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
    const pub: DevicePublic = { signJwk: { kty: 'EC', crv: 'P-256', x: `${name}-${uuidv7()}`, y: 'y' }, agreeJwk: { kty: 'EC', crv: 'P-256', x: name, y: 'y' } };
    const deviceId = await deviceIdOf(pub);
    await database.db.run(sql`INSERT INTO settings (key, value) VALUES ('sync.device', ${deviceId})`);
    const bank = await createAccount(database, ws, { name: `${name} Bank`, kind: 'asset', subtype: 'bank', currency: baseCurrency });
    const usd = await createAccount(database, ws, { name: `${name} Dollars`, kind: 'asset', subtype: 'bank', currency: 'USD' });
    const cash = await createAccount(database, ws, { name: `${name} Wallet`, kind: 'asset', subtype: 'cash', currency: baseCurrency });
    const transport = this.relay.as(deviceId);
    const device: Device = { name, database, ws, deviceId, public: pub, transport, engine: new SyncEngine(database, transport), bank: bank.id, cash: cash.id, usd: usd.id, memberId };
    this.devices.push(device);
    return device;
  }

  /** The owner shares their Personal book (§6.5): the relay book, the seed. Drains nothing. */
  async share(owner: Device): Promise<string> {
    const book = await personalBook(owner.database, owner.ws);
    const { relayBookId } = await owner.engine.shareBook(book.id, { memberId: owner.memberId, memberName: owner.name, deviceName: `${owner.name}'s phone`, device: owner.public });
    this.bookId = book.id;
    this.relayBookId = relayBookId;
    return book.id;
  }

  /** The minimal join: invite and claim on the relay, then the book, `shared_books`, and the introduction. No pull. */
  async join(joiner: Device, owner: Device, baseCurrency = 'IDR'): Promise<void> {
    const inviteId = uuidv7();
    await owner.transport.putInvite(this.relayBookId, {
      inviteId,
      keys: { iv: '', ct: '' },
      preview: { iv: '', ct: '' },
      expiresAt: new Date(Date.now() + 86_400_000).toISOString(),
      sameMember: false,
      sig: stubSign(owner.deviceId),
    });
    await joiner.transport.claimInvite(inviteId, joiner.public);
    await joinBookForTest(joiner, this.bookId, this.relayBookId, baseCurrency);
  }

  /** Every device drains, then every device pulls: nothing is left in flight. */
  async settle(devices: readonly Device[] = this.devices): Promise<void> {
    for (const d of devices) await d.engine.syncOnce(this.bookId);
    for (const d of devices) await d.engine.syncOnce(this.bookId);
  }
}

/** Inserts the joined book on this device and emits the introduction (spec §8.2 steps 6–7), the way task 5's join will. */
export async function joinBookForTest(joiner: Device, bookId: string, relayBookId: string, baseCurrency: string): Promise<void> {
  const { database, ws } = joiner;
  const now = new Date().toISOString();
  await database.transaction(async (tx) => {
    await tx.run(
      sql`INSERT INTO books (id, workspace_id, name, kind, base_currency, count_events_in_budget, sort_order, archived_at, created_at) VALUES (${bookId}, ${ws.workspaceId}, '', 'shared', ${baseCurrency}, 0, 9, NULL, ${now})`,
    );
    await tx.run(
      sql`INSERT INTO shared_books (book_id, relay_book_id, epoch, member_id, state, shared_at) VALUES (${bookId}, ${relayBookId}, 1, ${joiner.memberId}, 'active', ${now})`,
    );
  });
  await database.transaction((tx) =>
    withCapture(tx, [{ entity: 'member', id: joiner.memberId, bookId }, { entity: 'device', id: joiner.deviceId, bookId }], async () => {
      await tx.run(sql`INSERT INTO book_members (book_id, member_id, name, role, joined_at) VALUES (${bookId}, ${joiner.memberId}, ${joiner.name}, 'member', ${now})`);
      await tx.run(
        sql`INSERT INTO book_devices (book_id, device_id, member_id, name, sign_jwk, agree_jwk, added_at, removed_at) VALUES (${bookId}, ${joiner.deviceId}, ${joiner.memberId}, ${`${joiner.name}'s phone`}, ${JSON.stringify(joiner.public.signJwk)}, ${JSON.stringify(joiner.public.agreeJwk)}, ${now}, NULL)`,
      );
    }),
  );
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
