import { findEntry } from '@expanses/catalog';
import { sql } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import {
  createAccount,
  createDatabase,
  createProgram,
  createWorkspace,
  getCatalogState,
  migrate,
  MIGRATIONS,
} from '../src/index';
import { createNodeExecutor } from '../src/node';

/** A database on version 38, holding a program linked to the entry id the Jenius card used to have. */
async function linkedToTheOldId() {
  const older = createDatabase(createNodeExecutor());
  await migrate(older, MIGRATIONS.filter((migration) => migration.version <= 38));
  const ws = await createWorkspace(older, { name: 'Personal', type: 'personal', baseCurrency: 'IDR' });
  const card = await createAccount(older, ws, { name: 'Jenius', kind: 'liability', subtype: 'credit_card', currency: 'IDR' });
  const program = await createProgram(older, ws, { cardAccountId: card.id, name: 'Yay Points', unit: 'points', cycleAnchor: 'statement' });
  await older.db.values(sql`UPDATE reward_programs
    SET catalog_entry_id = 'jenius-kartu-kredit', catalog_entry_version = 11, catalog_status = 'linked'
    WHERE id = ${program.id}`);
  return { older, ws, program };
}

describe('migration 0039', () => {
  it('is version 39 and named jenius_entry_id', () => {
    expect(MIGRATIONS.find((migration) => migration.version === 39)).toMatchObject({ name: 'jenius_entry_id' });
  });

  it('points a program at the renamed entry, so it can still be synced', async () => {
    const { older, ws, program } = await linkedToTheOldId();
    expect((await getCatalogState(older, ws, program.id)).entryId).toBe('jenius-kartu-kredit');

    await migrate(older);

    expect((await getCatalogState(older, ws, program.id)).entryId).toBe('jenius-platinum');
    expect(findEntry('jenius-platinum')!.name).toBe('Jenius Platinum');
    // The old id is gone, so a program left on it would have had nothing to sync against.
    expect(findEntry('jenius-kartu-kredit')).toBeUndefined();
  });

  it('leaves a program linked to another card alone', async () => {
    const older = createDatabase(createNodeExecutor());
    await migrate(older, MIGRATIONS.filter((migration) => migration.version <= 38));
    const ws = await createWorkspace(older, { name: 'Personal', type: 'personal', baseCurrency: 'IDR' });
    const card = await createAccount(older, ws, { name: 'Danamon', kind: 'liability', subtype: 'credit_card', currency: 'IDR' });
    const program = await createProgram(older, ws, { cardAccountId: card.id, name: 'D-Point', unit: 'points', cycleAnchor: 'statement' });
    await older.db.values(sql`UPDATE reward_programs SET catalog_entry_id = 'danamon-jcb-precious' WHERE id = ${program.id}`);

    await migrate(older);

    expect((await getCatalogState(older, ws, program.id)).entryId).toBe('danamon-jcb-precious');
  });
});
