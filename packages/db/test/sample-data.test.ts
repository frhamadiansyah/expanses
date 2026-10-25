import { writeFileSync } from 'node:fs';
import { isoDate } from '@expanses/core';
import { afterEach, describe, expect, it } from 'vitest';
import { checkLedgerIntegrity, listDrafts, listEvents, listTransactions, ownerScope, sharedEventSummaries, sharedEventView } from '../src/index';
import { setupDb, type TestDb } from './helpers';
import { seedSampleData } from './sample/seed';

let current: TestDb | undefined;
afterEach(() => {
  current?.executor.close();
  current = undefined;
});

describe('sample data', () => {
  // Kept as a test so the sample keeps working as the app changes. SAMPLE_OUT=path writes it as a backup file
  // that Backup → Restore from file loads.
  it('builds a balanced household to try the app with', async () => {
    current = await setupDb();
    const { database, ws } = current;
    await seedSampleData(database, ws, process.env.SAMPLE_TODAY ?? isoDate());

    expect(await checkLedgerIntegrity(database, ws)).toEqual([]);
    expect((await listTransactions(database, ws, { limit: 5000 })).length).toBeGreaterThan(200);
    expect(await listDrafts(database, ws)).toHaveLength(4);

    // The shared event: listed as shared, four people (two with the app), THB, seven expenses, one settle-up, not Done.
    const lake = (await listEvents(database, ws)).find((event) => event.name === 'Lake house week');
    expect(lake).toBeDefined();
    const summary = (await sharedEventSummaries(database, ws))[lake!.id];
    expect(summary?.sharedWith).toBe(3);
    const view = await sharedEventView(database, ownerScope(ws), lake!.id);
    expect(view).toMatchObject({ currency: 'THB', finishedAt: null, state: 'active', myName: 'Maya' });
    expect(view!.people.filter((p) => p.hasApp)).toHaveLength(2);
    expect(view!.expenses).toHaveLength(7);
    expect(view!.settlements).toHaveLength(1);
    expect(view!.payments.length).toBeGreaterThan(0);
    if (process.env.SAMPLE_OUT) writeFileSync(process.env.SAMPLE_OUT, await database.exportBytes());
  }, 60_000);
});
