import { describe, expect, it } from 'vitest';
import {
  archiveProgramme,
  createAccount,
  createProgram,
  createProgramme,
  deleteConversion,
  personalBook,
  recordConversion,
  recordPointSnapshot,
  setEarnsInto,
  setProgramExpiry,
  updateProgramme,
} from '../../src/index';
import { setupDb } from '../helpers';
import { clearOutbox, outboxOps, shareBookForTest } from './sync-helpers';

/*
 * Points programmes (0085) are the device's own, like the rest of the points ledger: a card's rules, its points and
 * what they were converted into are never sent to the household. A shared workspace's card earning into a programme,
 * a conversion and its removal, and every change to a programme emit no op.
 */
describe('points programmes in a shared workspace', () => {
  it('send nothing to the household', async () => {
    const { database, ws } = await setupDb();
    const book = await personalBook(database, ws);
    // The capture run shares every first Personal book from birth; this test shares it itself, as household.ts does.
    await database.execScript('DELETE FROM shared_books');
    await shareBookForTest(database, book.id, 'member-me');
    const card = await createAccount(database, ws, { name: 'Mandiri Prioritas', kind: 'liability', subtype: 'credit_card', currency: 'IDR' });
    await clearOutbox(database);

    const program = await createProgram(database, ws, { cardAccountId: card.id, name: "Livin' Poin", unit: 'points', cycleAnchor: 'statement' });
    await recordPointSnapshot(database, ws, { programId: program.id, balance: 20_000, observedOn: '2026-09-13' });
    const krisflyer = await createProgramme(database, ws, { name: 'KrisFlyer', unit: 'miles' });
    await setProgramExpiry(database, ws, krisflyer.id, 'months_from_earn', 36);
    await updateProgramme(database, ws, krisflyer.id, { name: 'Singapore KrisFlyer', unit: 'miles' });
    const { conversionId } = await recordConversion(database, ws, { fromProgrammeId: program.id, toProgrammeId: krisflyer.id, points: 10_000, received: 6_660, occurredOn: '2026-09-13' });
    await deleteConversion(database, ws, conversionId);
    const joined = await createProgramme(database, ws, { name: 'Mandiri Rewards', unit: 'points' });
    await setEarnsInto(database, ws, program.id, joined.id);
    await archiveProgramme(database, ws, krisflyer.id);

    expect(await outboxOps(database)).toEqual([]);
  });
});
