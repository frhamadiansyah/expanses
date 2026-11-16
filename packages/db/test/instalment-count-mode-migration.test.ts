import { sql } from 'drizzle-orm';
import { afterEach, describe, expect, it } from 'vitest';
import { createDatabase, migrate, MIGRATIONS } from '../src/index';
import { createNodeExecutor, type NodeExecutor } from '../src/node';

let executor: NodeExecutor | undefined;
afterEach(() => {
  executor?.close();
  executor = undefined;
});

const BEFORE = MIGRATIONS.filter((m) => m.version < 120);

describe('migration 0120: how a plan’s spending counts', () => {
  it('is version 120 and named instalment_count_mode', () => {
    expect(MIGRATIONS.find((m) => m.version === 120)).toMatchObject({ name: 'instalment_count_mode' });
  });

  it('moves a plan tied to its purchase to Each month and keeps one without a purchase At purchase', async () => {
    executor = createNodeExecutor();
    const database = createDatabase(executor);
    await migrate(database, BEFORE);
    await database.execScript(`
      PRAGMA foreign_keys = OFF;
      INSERT INTO card_installments (id, workspace_id, card_account_id, transaction_id, description, total_minor, months, monthly_minor, first_billed_month, created_at)
      VALUES ('p-linked', 'w-1', 'c-1', 't-1', 'Laptop', 12000000, 12, 1000000, '2026-12', '2026-11-10'),
             ('p-alone', 'w-1', 'c-1', NULL, 'Sofa', 6000000, 6, 1000000, '2026-12', '2026-11-10');
      PRAGMA foreign_keys = ON;`);
    expect(await migrate(database)).toContain(120);
    const rows = await database.db.values(sql`SELECT id, count_mode FROM card_installments ORDER BY id`);
    expect(rows).toEqual([
      ['p-alone', 'at_purchase'],
      ['p-linked', 'each_month'],
    ]);
    await expect(database.execScript(`UPDATE card_installments SET count_mode = 'weekly' WHERE id = 'p-alone'`)).rejects.toThrow(/CHECK/);
  });
});
