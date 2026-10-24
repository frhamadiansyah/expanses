import { sql } from 'drizzle-orm';
import { beforeEach, describe, expect, it } from 'vitest';
import {
  archiveProgramme,
  createDatabase,
  createProgramme,
  createWorkspace,
  type Database,
  listProgrammes,
  listProgrammeTiers,
  migrate,
  MIGRATIONS,
  setProgrammeTier,
  type WorkspaceContext,
} from '../src/index';
import { createNodeExecutor } from '../src/node';
import { setupDb } from './helpers';

/**
 * A programme's "Card tier" (0088): which of its membership cards the Points page draws it as. Unset until chosen; the
 * tier's own short word; read and written by name, so a database stopped before the column still lists programmes.
 */

let database: Database;
let ws: WorkspaceContext;

beforeEach(async () => {
  ({ database, ws } = await setupDb());
});

describe('migration 0088', () => {
  it('is version 88 and named programme_tier', () => {
    expect(MIGRATIONS.find((m) => m.version === 88)).toMatchObject({ name: 'programme_tier' });
  });

  it('adds a nullable tier to point_programmes', async () => {
    const columns = await database.db.values<[string, number]>(sql`SELECT name, "notnull" FROM pragma_table_info('point_programmes') WHERE name = 'tier'`);
    expect(columns).toEqual([['tier', 0]]);
  });
});

describe('programme tier', () => {
  it('is unset until chosen, keeps the word chosen, and is cleared with null', async () => {
    const kris = await createProgramme(database, ws, { name: 'KrisFlyer', unit: 'miles' });
    expect(await listProgrammeTiers(database, ws)).toEqual({});
    await setProgrammeTier(database, ws, kris.id, 'gold');
    expect(await listProgrammeTiers(database, ws)).toEqual({ [kris.id]: 'gold' });
    await setProgrammeTier(database, ws, kris.id, 'silver');
    expect(await listProgrammeTiers(database, ws)).toEqual({ [kris.id]: 'silver' });
    await setProgrammeTier(database, ws, kris.id, null);
    expect(await listProgrammeTiers(database, ws)).toEqual({});
  });

  it('is a short lowercase word, and blank is unset; a word with no card is kept for the app to read as the first tier', async () => {
    const bonvoy = await createProgramme(database, ws, { name: 'Marriott Bonvoy', unit: 'points' });
    await expect(setProgrammeTier(database, ws, bonvoy.id, 'Gold Elite!')).rejects.toThrow('short word');
    await expect(setProgrammeTier(database, ws, bonvoy.id, 'GOLD')).rejects.toThrow('short word');
    await setProgrammeTier(database, ws, bonvoy.id, '  ');
    expect(await listProgrammeTiers(database, ws)).toEqual({});
    await setProgrammeTier(database, ws, bonvoy.id, 'unobtainium');
    expect(await listProgrammeTiers(database, ws)).toEqual({ [bonvoy.id]: 'unobtainium' });
  });

  it('does not change the programme row the rest of the app reads', async () => {
    const kris = await createProgramme(database, ws, { name: 'KrisFlyer', unit: 'miles' });
    await setProgrammeTier(database, ws, kris.id, 'gold');
    const [row] = await listProgrammes(database, ws);
    expect(row).toEqual(kris);
    expect(row).not.toHaveProperty('tier');
  });

  it('is only listed for live programmes of this workspace, and refuses a programme it cannot find', async () => {
    const kris = await createProgramme(database, ws, { name: 'KrisFlyer', unit: 'miles' });
    const other = await createWorkspace(database, { name: 'Business', type: 'business', baseCurrency: 'IDR' });
    const theirs = await createProgramme(database, other, { name: 'Asia Miles', unit: 'miles' });
    await setProgrammeTier(database, ws, kris.id, 'gold');
    await setProgrammeTier(database, other, theirs.id, 'diamond');
    expect(await listProgrammeTiers(database, ws)).toEqual({ [kris.id]: 'gold' });
    await expect(setProgrammeTier(database, ws, theirs.id, 'gold')).rejects.toThrow('not found');
    await expect(setProgrammeTier(database, ws, 'no-such-programme', 'gold')).rejects.toThrow('not found');
    await archiveProgramme(database, ws, kris.id);
    expect(await listProgrammeTiers(database, ws)).toEqual({});
  });
});

describe('a database stopped before 0088', () => {
  it('lists no tiers, and refuses to keep one rather than failing on a missing column', async () => {
    const old = createDatabase(createNodeExecutor());
    await migrate(
      old,
      MIGRATIONS.filter((m) => m.version <= 87),
    );
    // (createProgramme writes through the drizzle table, which never names tier: it works on either side of 0088.)
    const oldWs = await createWorkspace(old, { name: 'Personal', type: 'personal', baseCurrency: 'IDR' });
    const kris = await createProgramme(old, oldWs, { name: 'KrisFlyer', unit: 'miles' });
    expect(await listProgrammeTiers(old, oldWs)).toEqual({});
    await expect(setProgrammeTier(old, oldWs, kris.id, 'gold')).rejects.toThrow('cannot keep that yet');
    // The rest of the programme still reads and writes as before.
    expect((await listProgrammes(old, oldWs)).map((p) => p.name)).toEqual(['KrisFlyer']);
  });
});
