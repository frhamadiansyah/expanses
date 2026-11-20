import { sql } from 'drizzle-orm';
import { describe, expect, it, vi } from 'vitest';
import { settingsKeyClass, SELF_TABLES } from '../../src/self/tables';
import { setupDb } from '../helpers';

// Each test builds two whole databases and their triggers: seconds on a busy machine, more than the default allows.
vi.setConfig({ testTimeout: 60_000 });

/*
 * Link my devices §2.1: every table, and every settings key, is sorted into exactly one class. A migration that adds a
 * table fails here until someone decides whether the owner's other devices get it.
 */
async function liveTables(): Promise<string[]> {
  const { database } = await setupDb();
  const rows = await database.db.values<[string]>(sql`SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name`);
  return rows.map(([name]) => name);
}

describe('which tables the owner’s other devices get', () => {
  it('sorts every table of the schema, and names none that is not there', async () => {
    const tables = await liveTables();
    const sorted = Object.keys(SELF_TABLES).sort();
    expect(tables.filter((t) => !(t in SELF_TABLES))).toEqual([]);
    expect(sorted.filter((t) => !tables.includes(t))).toEqual([]);
  });

  it('keeps device keys, outboxes and the self channel’s own bookkeeping on the device', () => {
    for (const t of ['book_epoch_keys', 'sync_outbox', 'sync_skipped', 'schema_migrations']) expect(SELF_TABLES[t]).toBe('device');
  });

  it('keeps the self channel’s own queue on the device, and its clocks for the copy a new device starts from', () => {
    for (const t of ['self_state', 'self_pending', 'self_outbox', 'self_notes']) expect(SELF_TABLES[t]).toBe('device');
    for (const t of ['self_clocks', 'self_tombstones', 'self_aliases']) expect(SELF_TABLES[t]).toBe('meta');
  });

  it('marks household bookkeeping as the seat’s', () => {
    for (const t of ['shared_books', 'book_devices', 'sync_lineage', 'sync_field_clocks', 'sync_cursor', 'sync_authority', 'nw_group_books', 'goal_share_log'])
      expect(SELF_TABLES[t]).toBe('seat');
  });

  it('sends the owner’s own data, the tables households never move included', () => {
    for (const t of ['accounts', 'transactions', 'entries', 'cards', 'point_entries', 'events', 'event_items', 'transaction_photos', 'settings', 'fx_rates', 'prices'])
      expect(SELF_TABLES[t]).toBe('replicate');
  });

  it('every table that travels has a primary key', async () => {
    const { database } = await setupDb();
    for (const [table, kind] of Object.entries(SELF_TABLES)) {
      if (kind === 'device' || kind === 'meta') continue;
      const pk = await database.db.values<[number]>(sql`SELECT count(*) FROM pragma_table_info(${table}) WHERE pk > 0`);
      expect([table, Number(pk[0]![0])]).not.toEqual([table, 0]);
    }
  });
});

describe('settings keys', () => {
  it.each([
    ['sync.hlc', 'device'],
    ['sync.device', 'device'],
    ['last_backup_at', 'device'],
    ['icloud_backup', 'device'],
    ['icloud_backup_photos', 'device'],
    ['icloud_backup_offer', 'device'],
    ['fx.recalc_failures', 'device'],
    ['active_book:ws-1', 'device'],
    ['sharing.member.b1', 'seat'],
    ['sharing.replay.b1', 'seat'],
    ['share.list.seeded', 'seat'],
    ['sync.seen.b1', 'seat'],
    ['sync.received.b1', 'seat'],
    ['nw.pending_summaries', 'seat'],
    ['nw.marks.b1', 'seat'],
    ['goal.pending_summaries', 'seat'],
    ['goal.summary.g1', 'seat'],
    ['goal.moves.g1', 'seat'],
    ['shared-events.replay.b1', 'seat'],
    ['repair.third-marks-crossed.v1.b1', 'seat'],
    ['event_mode', 'replicate'],
    ['instalment-autolink.v1.ws-1', 'replicate'],
    ['fx.withdrawal_rate_notice', 'replicate'],
  ] as const)('%s is %s', (key, kind) => {
    expect(settingsKeyClass(key)).toBe(kind);
  });
});

describe('migrations every device runs on its own rows', () => {
  it('make no random ids after 0027, so two linked devices migrating alike end alike', async () => {
    const { MIGRATIONS } = await import('../../src/migrations');
    const random = MIGRATIONS.filter((m) => m.version > 27 && /randomblob\s*\(|\brandom\s*\(/i.test(m.sql)).map((m) => m.version);
    expect(random).toEqual([]);
  });
});
