import { findEntry } from '@expanses/catalog';
import { balanceOf, convertDetail, expenseLines, type PointEntry, statementCycleFor } from '@expanses/core';
import { sql } from 'drizzle-orm';
import { afterEach, describe, expect, it } from 'vitest';
import {
  applyCatalogEntry,
  archiveProgramme,
  cardSpendLines,
  listTransactionPointActuals,
  recordTransactionPointActual,
  cardYearRoi,
  createAccount,
  createDatabase,
  createProgram,
  createProgramme,
  createWorkspace,
  type Database,
  deleteConversion,
  deriveCycleEntries,
  expireDueEntries,
  expiringSoonAcross,
  getProgramme,
  listAccounts,
  listPointEntries,
  listProgrammes,
  listTransferPartners,
  migrate,
  MIGRATIONS,
  PointsError,
  postTransaction,
  programBalance,
  programmeEarners,
  programmeHistory,
  recordConversion,
  recordPointSnapshot,
  recordRedemption,
  saveCardTerms,
  saveEarnRule,
  saveTransferPartner,
  setEarnsInto,
  setProgramExpiry,
  updateProgramme,
  type WorkspaceContext,
} from '../src/index';
import { createNodeExecutor, type NodeExecutor } from '../src/node';
import { setupDb } from './helpers';

/*
 * Points programmes (0085): a balance of its own that cards earn into and points convert between. Invented cards,
 * figures and dates throughout.
 */

const TODAY = '2026-09-13';
const CYCLE = statementCycleFor(TODAY, 20);

/** A card earning 1 point per Rp 10.000, its billing date the 20th, with one purchase of `amountMinor` this cycle. */
async function cardEarning(database: Database, ws: WorkspaceContext, name: string, amountMinor: number) {
  const card = await createAccount(database, ws, { name, kind: 'liability', subtype: 'credit_card', currency: 'IDR' });
  await saveCardTerms(database, ws, { accountId: card.id, statementDay: 20, dueDay: 8, creditLimitMinor: null, annualFeeMinor: null });
  const program = await createProgram(database, ws, { cardAccountId: card.id, name: `${name} points`, unit: 'points', cycleAnchor: 'statement' });
  await saveEarnRule(database, ws, program.id, {
    name: 'Base', priority: 0, stackable: false, match: {}, rateNum: 1, rateDen: 10_000,
    rounding: 'per_transaction_floor', capSpendMinor: null, capPoints: null, minTransactionMinor: null, validFrom: null, validTo: null,
  });
  const groceries = (await listAccounts(database, ws)).find((account) => account.name === 'Groceries')!.id;
  await postTransaction(database, ws, {
    occurredOn: TODAY,
    description: `Shop on ${name}`,
    lines: expenseLines({ categoryAccountId: groceries, paymentAccountId: card.id, amountMinor, currency: 'IDR' }),
  });
  return { card, program };
}

const total = async (database: Database, ws: WorkspaceContext, programmeId: string, on = TODAY) => (await programBalance(database, ws, programmeId, on)).total;

describe('migration 0085 (point programmes)', () => {
  let executor: NodeExecutor | undefined;
  afterEach(() => {
    executor?.close();
    executor = undefined;
  });

  it('is version 85 and named point_programmes', () => {
    expect(MIGRATIONS.find((m) => m.version === 85)).toMatchObject({ name: 'point_programmes' });
  });

  it("makes every card's program a programme of its own, with every balance exactly what it was", async () => {
    executor = createNodeExecutor();
    const older = createDatabase(executor);
    await migrate(older, MIGRATIONS.filter((m) => m.version < 85));
    const ws = await createWorkspace(older, { name: 'Personal', type: 'personal', baseCurrency: 'IDR' });
    const prioritas = await createAccount(older, ws, { name: 'Mandiri Prioritas', kind: 'liability', subtype: 'credit_card', currency: 'IDR' });
    const krisflyerCard = await createAccount(older, ws, { name: 'BCA KrisFlyer', kind: 'liability', subtype: 'credit_card', currency: 'IDR' });
    const a = await createProgram(older, ws, { cardAccountId: prioritas.id, name: "Livin' Poin", unit: 'points', cycleAnchor: 'statement' });
    const b = await createProgram(older, ws, { cardAccountId: krisflyerCard.id, name: 'KrisFlyer', unit: 'miles', cycleAnchor: 'statement' });
    await older.db.run(sql`UPDATE reward_programs SET expiry_policy = 'months_from_earn', expiry_months = 24 WHERE id = ${a.id}`);
    // Written the way a version 84 database held its ledger, naming only the columns that existed then.
    const entry = (id: string, programId: string, kind: string, quantity: number, on: string, status: string, source: string, batchId: string | null, expiresOn: string | null) =>
      sql`INSERT INTO point_entries (id, workspace_id, program_id, transaction_id, kind, quantity, occurred_on, status, source, batch_id, expires_on, note, created_at)
          VALUES (${id}, ${ws.workspaceId}, ${programId}, NULL, ${kind}, ${quantity}, ${on}, ${status}, ${source}, ${batchId}, ${expiresOn}, NULL, '2026-09-01T00:00:00.000Z')`;
    await older.db.run(entry('a1', a.id, 'earn', 4_000, '2026-06-20', 'posted', 'statement', null, '2028-06-20'));
    await older.db.run(entry('a2', a.id, 'earn', 1_000, '2026-09-01', 'projected', 'projected', null, '2028-09-01'));
    await older.db.run(entry('a3', a.id, 'redeem', -1_500, '2026-08-01', 'posted', 'manual', 'a1', null));
    await older.db.run(entry('a4', a.id, 'adjust', 300, '2026-08-15', 'posted', 'snapshot', null, '2026-10-15'));
    await older.db.run(entry('b1', b.id, 'earn', 2_000, '2026-07-20', 'posted', 'statement', null, null));
    await older.db.run(entry('b2', b.id, 'transfer', -500, '2026-08-02', 'posted', 'manual', 'b1', null));
    await older.db.run(sql`INSERT INTO point_snapshots (id, workspace_id, program_id, balance, observed_on, created_at)
      VALUES ('s1', ${ws.workspaceId}, ${a.id}, 3800, '2026-08-15', '2026-08-15T00:00:00.000Z')`);

    const before = async (programId: string) => {
      const rows = await older.db.values<[string, string, number, string, string, string | null, string | null]>(
        sql`SELECT id, kind, quantity, occurred_on, status, batch_id, expires_on FROM point_entries WHERE program_id = ${programId}`,
      );
      const entries: PointEntry[] = rows.map(([id, kind, quantity, occurredOn, status, batchId, expiresOn]) => ({
        id, kind: kind as PointEntry['kind'], quantity: Number(quantity), occurredOn, status: status as PointEntry['status'], batchId, expiresOn,
      }));
      return balanceOf(entries, TODAY);
    };
    const balanceA = await before(a.id);
    const balanceB = await before(b.id);
    expect(balanceA).toMatchObject({ total: 3_800, postedTotal: 2_800, projectedTotal: 1_000, expiringSoon: 300 });

    expect(await migrate(older)).toContain(85);

    expect(await programBalance(older, ws, a.id, TODAY)).toEqual(balanceA);
    expect(await programBalance(older, ws, b.id, TODAY)).toEqual(balanceB);
    const programmes = await listProgrammes(older, ws);
    expect(programmes.map((p) => [p.id, p.name, p.unit, p.expiryPolicy, p.expiryMonths])).toEqual([
      [a.id, "Livin' Poin", 'points', 'months_from_earn', 24],
      [b.id, 'KrisFlyer', 'miles', 'none', null],
    ]);
    const earners = await programmeEarners(older, ws);
    expect(earners.get(a.id)!.map((earner) => earner.cardName)).toEqual(['Mandiri Prioritas']);
    expect(earners.get(b.id)!.map((earner) => earner.cardName)).toEqual(['BCA KrisFlyer']);
    // Every earning is marked with the card that earned it; nothing else is.
    const marked = await older.db.values<[string, string | null]>(sql`SELECT id, earned_by_id FROM point_entries ORDER BY id`);
    expect(marked).toEqual([
      ['a1', a.id],
      ['a2', a.id],
      ['a3', null],
      ['a4', null],
      ['b1', b.id],
      ['b2', null],
    ]);
    expect(await older.db.values(sql`SELECT id, program_id, balance FROM point_snapshots`)).toEqual([['s1', a.id, 3800]]);

    // The worked-out points carried over are still the derivation's to replace: the cycle has no purchase, so they go.
    await deriveCycleEntries(older, ws, a.id, statementCycleFor('2026-09-01', 20));
    expect((await listPointEntries(older, ws, a.id)).map((e) => e.id).sort()).toEqual(['a1', 'a3', 'a4']);
  });
});

describe('a new card', () => {
  it('earns into a programme of its own, named as its rewards were', async () => {
    const { database, ws } = await setupDb();
    const { program } = await cardEarning(database, ws, 'CIMB Octo', 10_000_000);

    expect((await listProgrammes(database, ws)).map((p) => [p.id, p.name, p.unit])).toEqual([[program.id, 'CIMB Octo points', 'points']]);
    await deriveCycleEntries(database, ws, program.id, CYCLE);
    expect(await total(database, ws, program.id)).toBe(1_000);
  });
});

describe('catalogue terms', () => {
  it("name the card's own programme for the one the entry earns into", async () => {
    const { database, ws } = await setupDb();
    const card = await createAccount(database, ws, { name: 'BCA KrisFlyer', kind: 'liability', subtype: 'credit_card', currency: 'IDR' });
    const program = await createProgram(database, ws, { cardAccountId: card.id, name: 'BCA KrisFlyer rewards', unit: 'points', cycleAnchor: 'statement' });

    await applyCatalogEntry(database, ws, { cardAccountId: card.id, entry: findEntry('bca-sq-krisflyer-visa-infinite')!, today: TODAY, replaceManual: false });

    expect(await getProgramme(database, ws, program.id)).toMatchObject({ name: 'KrisFlyer', unit: 'miles' });
  });

  it('leave a programme other cards earn into as the owner named it', async () => {
    const { database, ws } = await setupDb();
    const a = await cardEarning(database, ws, 'Mandiri Prioritas', 10_000_000);
    const card = await createAccount(database, ws, { name: 'BCA KrisFlyer', kind: 'liability', subtype: 'credit_card', currency: 'IDR' });
    const program = await createProgram(database, ws, { cardAccountId: card.id, name: 'BCA KrisFlyer rewards', unit: 'points', cycleAnchor: 'statement' });
    await setEarnsInto(database, ws, a.program.id, program.id);

    await applyCatalogEntry(database, ws, { cardAccountId: card.id, entry: findEntry('bca-sq-krisflyer-visa-infinite')!, today: TODAY, replaceManual: false });

    expect(await getProgramme(database, ws, program.id)).toMatchObject({ name: 'BCA KrisFlyer rewards', unit: 'points' });
  });
});

describe('two cards earning into one programme', () => {
  it("keeps a figure saved for a purchase under the card's own programme, and the shared balance counts it", async () => {
    const { database, ws } = await setupDb();
    const a = await cardEarning(database, ws, 'Mandiri Prioritas', 10_000_000);
    const b = await cardEarning(database, ws, 'Mandiri Platinum', 5_000_000);
    await setEarnsInto(database, ws, b.program.id, a.program.id);
    const lines = await cardSpendLines(database, ws, b.card.id, CYCLE.start, CYCLE.end);
    const transactionId = lines[0]!.transactionId;

    await recordTransactionPointActual(database, ws, { programId: b.program.id, transactionId, actualPoints: 420.5 });
    // Read back the way the page does: by the card's own program, whatever programme it earns into.
    expect(await listTransactionPointActuals(database, ws, b.program.id)).toMatchObject([{ transactionId, actualPoints: 420.5, editedAfterCheck: false }]);
    expect(await listTransactionPointActuals(database, ws, a.program.id)).toEqual([]);

    await deriveCycleEntries(database, ws, a.program.id, CYCLE);
    await deriveCycleEntries(database, ws, b.program.id, CYCLE);
    expect(await total(database, ws, a.program.id)).toBe(1_000 + 420.5);
  });

  it('add up in it, and working one card out again leaves the other card alone', async () => {
    const { database, ws } = await setupDb();
    const a = await cardEarning(database, ws, 'Mandiri Prioritas', 10_000_000);
    const b = await cardEarning(database, ws, 'Mandiri Platinum', 5_000_000);

    expect(await setEarnsInto(database, ws, b.program.id, a.program.id)).toEqual({ previousId: b.program.id, previousArchived: true });
    await deriveCycleEntries(database, ws, a.program.id, CYCLE);
    await deriveCycleEntries(database, ws, b.program.id, CYCLE);
    expect(await total(database, ws, a.program.id)).toBe(1_500);

    await deriveCycleEntries(database, ws, a.program.id, CYCLE);
    expect(await total(database, ws, a.program.id)).toBe(1_500);
    const earned = (await listPointEntries(database, ws, a.program.id)).map((e) => [e.earnedById, e.quantity]);
    expect(earned).toEqual(expect.arrayContaining([[a.program.id, 1_000], [b.program.id, 500]]));
    expect((await programmeEarners(database, ws)).get(a.program.id)!.map((e) => e.cardName)).toEqual(['Mandiri Prioritas', 'Mandiri Platinum']);
    // The second card's own programme held nothing and nothing earns into it, so it is put away.
    expect((await listProgrammes(database, ws)).map((p) => p.id)).toEqual([a.program.id]);
  });

  it("names the programme rather than one card when points in it are about to die", async () => {
    const { database, ws } = await setupDb();
    const a = await cardEarning(database, ws, 'Mandiri Prioritas', 10_000_000);
    const b = await cardEarning(database, ws, 'Mandiri Platinum', 5_000_000);
    await setEarnsInto(database, ws, b.program.id, a.program.id);
    await setProgramExpiry(database, ws, a.program.id, 'months_from_earn', 1);
    await deriveCycleEntries(database, ws, a.program.id, CYCLE);
    await deriveCycleEntries(database, ws, b.program.id, CYCLE);

    expect(await expiringSoonAcross(database, ws, TODAY)).toEqual([
      { programId: a.program.id, cardName: 'Mandiri Prioritas points', unit: 'points', expiringSoon: 1_500, nextExpiryOn: '2026-10-13' },
    ]);
  });

  it("counts only the card's own earning in what its annual fee bought", async () => {
    const { database, ws } = await setupDb();
    const a = await cardEarning(database, ws, 'Mandiri Prioritas', 10_000_000);
    const b = await cardEarning(database, ws, 'Mandiri Platinum', 5_000_000);
    await setEarnsInto(database, ws, b.program.id, a.program.id);
    await deriveCycleEntries(database, ws, a.program.id, CYCLE);
    await deriveCycleEntries(database, ws, b.program.id, CYCLE);

    expect((await cardYearRoi(database, ws, a.program.id, TODAY)).pointsEarned).toBe(1_000);
    expect((await cardYearRoi(database, ws, b.program.id, TODAY)).pointsEarned).toBe(500);
  });
});

describe('joining programmes', () => {
  it("moves the second card's whole ledger into the chosen programme and puts its own away", async () => {
    const { database, ws } = await setupDb();
    const a = await cardEarning(database, ws, 'Mandiri Prioritas', 10_000_000);
    const b = await cardEarning(database, ws, 'Mandiri Platinum', 5_000_000);
    await deriveCycleEntries(database, ws, a.program.id, CYCLE);
    await deriveCycleEntries(database, ws, b.program.id, CYCLE);
    await recordPointSnapshot(database, ws, { programId: b.program.id, balance: 800, observedOn: TODAY });
    await recordRedemption(database, ws, { programId: b.program.id, kind: 'redeem', points: 200, occurredOn: TODAY, note: 'Voucher', valueMinor: null });
    expect(await total(database, ws, a.program.id)).toBe(1_000);
    expect(await total(database, ws, b.program.id)).toBe(600);

    expect(await setEarnsInto(database, ws, b.program.id, a.program.id)).toEqual({ previousId: b.program.id, previousArchived: true });

    expect(await total(database, ws, a.program.id)).toBe(1_600);
    expect(await listPointEntries(database, ws, b.program.id)).toEqual([]);
    expect(await database.db.values(sql`SELECT program_id FROM point_snapshots`)).toEqual([[a.program.id]]);
    const all = await listProgrammes(database, ws, { withArchived: true });
    expect(all.find((p) => p.id === b.program.id)!.archivedAt).not.toBeNull();
    // Working the second card's cycle out again replaces its points where they now are, not beside them.
    await deriveCycleEntries(database, ws, b.program.id, CYCLE);
    expect(await total(database, ws, a.program.id)).toBe(1_600);
  });

  it('takes only its own earning out of a programme other cards still earn into, which stays', async () => {
    const { database, ws } = await setupDb();
    const a = await cardEarning(database, ws, 'Mandiri Prioritas', 10_000_000);
    const b = await cardEarning(database, ws, 'Mandiri Platinum', 5_000_000);
    const c = await cardEarning(database, ws, 'Mandiri Signature', 2_000_000);
    await setEarnsInto(database, ws, b.program.id, a.program.id);
    await setEarnsInto(database, ws, c.program.id, a.program.id);
    for (const card of [a, b, c]) await deriveCycleEntries(database, ws, card.program.id, CYCLE);
    await recordRedemption(database, ws, { programId: a.program.id, kind: 'redeem', points: 100, occurredOn: TODAY, note: null, valueMinor: null });
    expect(await total(database, ws, a.program.id)).toBe(1_600);
    const other = await createProgramme(database, ws, { name: 'Signature Rewards', unit: 'points' });

    expect(await setEarnsInto(database, ws, c.program.id, other.id)).toEqual({ previousId: a.program.id, previousArchived: false });

    expect(await total(database, ws, other.id)).toBe(200);
    expect(await total(database, ws, a.program.id)).toBe(1_400);
    expect((await listProgrammes(database, ws)).map((p) => p.id)).toEqual([a.program.id, other.id]);
  });

  it('keeps a programme that still holds points when the last card leaves it', async () => {
    const { database, ws } = await setupDb();
    const a = await cardEarning(database, ws, 'BCA KrisFlyer', 10_000_000);
    const krisflyer = await createProgramme(database, ws, { name: 'KrisFlyer', unit: 'miles' });
    await recordPointSnapshot(database, ws, { programId: krisflyer.id, balance: 5_000, observedOn: TODAY });
    await setEarnsInto(database, ws, a.program.id, krisflyer.id);
    await deriveCycleEntries(database, ws, a.program.id, CYCLE);
    expect(await total(database, ws, krisflyer.id)).toBe(6_000);
    const elsewhere = await createProgramme(database, ws, { name: 'Asia Miles', unit: 'miles' });

    expect(await setEarnsInto(database, ws, a.program.id, elsewhere.id)).toEqual({ previousId: krisflyer.id, previousArchived: false });

    // The miles read from the airline's app were never the card's, so they stay where they were.
    expect(await total(database, ws, krisflyer.id)).toBe(5_000);
    expect(await total(database, ws, elsewhere.id)).toBe(1_000);
    expect((await listProgrammes(database, ws)).map((p) => p.name)).toEqual(['KrisFlyer', 'Asia Miles']);
  });

  it('brings back a programme that was put away when a card is set to earn into it again', async () => {
    const { database, ws } = await setupDb();
    const a = await cardEarning(database, ws, 'Mandiri Prioritas', 10_000_000);
    const b = await cardEarning(database, ws, 'Mandiri Platinum', 5_000_000);
    await setEarnsInto(database, ws, b.program.id, a.program.id);
    await setEarnsInto(database, ws, b.program.id, b.program.id);

    expect((await listProgrammes(database, ws)).map((p) => p.id)).toEqual([a.program.id, b.program.id]);
  });
});

describe('converting points into another programme', () => {
  /** Livin' Poin holding 25.000, its card listing KrisFlyer as a partner at 3 to 2 in steps of 30, from 3.000. */
  async function livinPoin() {
    const { database, ws } = await setupDb();
    const card = await cardEarning(database, ws, 'Mandiri Prioritas', 1_000_000);
    await updateProgramme(database, ws, card.program.id, { name: "Livin' Poin", unit: 'points' });
    await saveTransferPartner(database, ws, card.program.id, {
      key: 'krisflyer', program: 'KrisFlyer', points: 3, partnerUnits: 2, incrementPoints: 30, minimumPoints: 3_000, validFrom: null, validTo: null,
    });
    await recordPointSnapshot(database, ws, { programId: card.program.id, balance: 25_000, observedOn: TODAY });
    const krisflyer = await createProgramme(database, ws, { name: 'KrisFlyer', unit: 'miles', expiryPolicy: 'months_from_earn', expiryMonths: 36 });
    return { database, ws, livin: card.program, krisflyer };
  }

  it('takes the points off one and puts what arrived on the other, both under one conversion', async () => {
    const { database, ws, livin, krisflyer } = await livinPoin();
    const [partner] = await listTransferPartners(database, ws, livin.id);
    // Whole steps of 30 only: 9.990 of the 10.000 move, at 3 to 2.
    const estimate = convertDetail(10_000, partner!);
    expect(estimate).toMatchObject({ units: 6_660, fullRatePoints: 9_990, unconvertedPoints: 10 });
    expect(convertDetail(2_970, partner!).units).toBe(0);

    const { conversionId } = await recordConversion(database, ws, { fromProgrammeId: livin.id, toProgrammeId: krisflyer.id, points: 10_000, received: estimate.units, occurredOn: TODAY });

    expect(await total(database, ws, livin.id)).toBe(15_000);
    expect(await total(database, ws, krisflyer.id)).toBe(6_660);
    const arrived = await listPointEntries(database, ws, krisflyer.id);
    expect(arrived).toEqual([expect.objectContaining({ kind: 'transfer', quantity: 6_660, conversionId, expiresOn: '2029-09-13', note: "From Livin' Poin" })]);
    const left = (await listPointEntries(database, ws, livin.id)).filter((e) => e.conversionId === conversionId);
    expect(left.map((e) => [e.kind, e.quantity, e.note])).toEqual([['transfer', -10_000, 'To KrisFlyer']]);
  });

  it('writes nothing on either side when the source cannot cover it', async () => {
    const { database, ws, livin, krisflyer } = await livinPoin();

    await expect(recordConversion(database, ws, { fromProgrammeId: livin.id, toProgrammeId: krisflyer.id, points: 30_000, received: 20_000, occurredOn: TODAY })).rejects.toBeInstanceOf(PointsError);

    expect(await total(database, ws, livin.id)).toBe(25_000);
    expect(await listPointEntries(database, ws, krisflyer.id)).toEqual([]);
  });

  it('makes a partner programme converted into for the first time, in the same step', async () => {
    const { database, ws, livin } = await livinPoin();

    const { toProgrammeId } = await recordConversion(database, ws, {
      fromProgrammeId: livin.id, newProgramme: { name: 'Asia Miles', unit: 'miles' }, points: 3_000, received: 1_000, occurredOn: TODAY,
    });

    expect(await getProgramme(database, ws, toProgrammeId)).toMatchObject({ name: 'Asia Miles', unit: 'miles' });
    expect(await total(database, ws, toProgrammeId)).toBe(1_000);
    expect(await total(database, ws, livin.id)).toBe(22_000);
    // One that cannot be covered leaves no empty programme behind.
    await expect(recordConversion(database, ws, { fromProgrammeId: livin.id, newProgramme: { name: 'Bonvoy', unit: 'points' }, points: 90_000, received: 1, occurredOn: TODAY })).rejects.toThrow(PointsError);
    expect((await listProgrammes(database, ws)).map((p) => p.name)).not.toContain('Bonvoy');
  });

  it('refuses to convert into the same programme, or for nothing in return', async () => {
    const { database, ws, livin, krisflyer } = await livinPoin();

    await expect(recordConversion(database, ws, { fromProgrammeId: livin.id, toProgrammeId: livin.id, points: 100, received: 60, occurredOn: TODAY })).rejects.toThrow(PointsError);
    await expect(recordConversion(database, ws, { fromProgrammeId: livin.id, toProgrammeId: krisflyer.id, points: 100, received: 0, occurredOn: TODAY })).rejects.toThrow(PointsError);
  });

  it('draws on the points that die soonest, and what arrived dies under the target policy', async () => {
    const { database, ws } = await setupDb();
    const livin = await createProgramme(database, ws, { name: "Livin' Poin", unit: 'points', expiryPolicy: 'fixed_annual' });
    const krisflyer = await createProgramme(database, ws, { name: 'KrisFlyer', unit: 'miles', expiryPolicy: 'months_from_earn', expiryMonths: 2 });
    // 4.000 read last year (dying at the end of it, and still alive on 2025-12-01), then 6.000 this year.
    await recordPointSnapshot(database, ws, { programId: livin.id, balance: 4_000, observedOn: '2025-12-01' });
    await recordPointSnapshot(database, ws, { programId: livin.id, balance: 10_000, observedOn: '2025-12-02', earnedOn: '2026-01-15' });

    await recordConversion(database, ws, { fromProgrammeId: livin.id, toProgrammeId: krisflyer.id, points: 5_000, received: 3_000, occurredOn: '2025-12-10' });

    // The 4.000 dying on 31 Dec went first, then 1.000 of the 6.000; nothing of last year is left to die.
    expect(await expireDueEntries(database, ws, livin.id, '2026-01-01')).toBe(0);
    expect(await total(database, ws, livin.id, '2026-01-01')).toBe(5_000);
    // Two months from the day they arrived, the miles die.
    expect((await programBalance(database, ws, krisflyer.id, '2026-01-01')).nextExpiryOn).toBe('2026-02-10');
    expect(await expireDueEntries(database, ws, krisflyer.id, '2026-02-11')).toBe(1);
    expect(await total(database, ws, krisflyer.id, '2026-02-11')).toBe(0);
  });

  it('is removed on both sides at once', async () => {
    const { database, ws, livin, krisflyer } = await livinPoin();
    const { conversionId } = await recordConversion(database, ws, { fromProgrammeId: livin.id, toProgrammeId: krisflyer.id, points: 10_000, received: 6_660, occurredOn: TODAY });

    await deleteConversion(database, ws, conversionId);

    expect(await total(database, ws, livin.id)).toBe(25_000);
    expect(await total(database, ws, krisflyer.id)).toBe(0);
    expect(await database.db.values(sql`SELECT id FROM point_entries WHERE conversion_id = ${conversionId}`)).toEqual([]);
  });

  it('cannot be removed once what arrived has been spent', async () => {
    const { database, ws, livin, krisflyer } = await livinPoin();
    const { conversionId } = await recordConversion(database, ws, { fromProgrammeId: livin.id, toProgrammeId: krisflyer.id, points: 10_000, received: 6_660, occurredOn: TODAY });
    await recordRedemption(database, ws, { programId: krisflyer.id, kind: 'redeem', points: 5_000, occurredOn: TODAY, note: 'Award seat', valueMinor: null });

    await expect(deleteConversion(database, ws, conversionId)).rejects.toThrow(PointsError);
    expect(await total(database, ws, krisflyer.id)).toBe(1_660);
  });

  it('shows in each history as one line naming the other side', async () => {
    const { database, ws, livin, krisflyer } = await livinPoin();
    await recordConversion(database, ws, { fromProgrammeId: livin.id, toProgrammeId: krisflyer.id, points: 10_000, received: 6_660, occurredOn: TODAY });

    const into = await programmeHistory(database, ws, krisflyer.id);
    expect(into).toEqual([expect.objectContaining({ kind: 'convert_in', quantity: 6_660, counterpart: { programmeName: "Livin' Poin", unit: 'points', quantity: -10_000 } })]);
    const out = (await programmeHistory(database, ws, livin.id)).find((row) => row.kind === 'convert_out');
    expect(out).toMatchObject({ quantity: -10_000, label: 'KrisFlyer', counterpart: { programmeName: 'KrisFlyer', unit: 'miles', quantity: 6_660 } });
  });
});

describe('a programme of its own', () => {
  it('lists the earning of each card once per statement in its history', async () => {
    const { database, ws } = await setupDb();
    const a = await cardEarning(database, ws, 'Mandiri Prioritas', 10_000_000);
    await deriveCycleEntries(database, ws, a.program.id, CYCLE);

    expect(await programmeHistory(database, ws, a.program.id)).toEqual([
      expect.objectContaining({ kind: 'earn', on: CYCLE.end, quantity: 1_000, estimated: true, label: 'Mandiri Prioritas' }),
    ]);
  });

  it('refuses a second programme of the same name, and renames', async () => {
    const { database, ws } = await setupDb();
    const krisflyer = await createProgramme(database, ws, { name: 'KrisFlyer', unit: 'miles' });

    await expect(createProgramme(database, ws, { name: 'krisflyer ', unit: 'miles' })).rejects.toThrow(PointsError);
    await updateProgramme(database, ws, krisflyer.id, { name: 'Singapore KrisFlyer', unit: 'miles' });
    expect((await listProgrammes(database, ws)).map((p) => p.name)).toEqual(['Singapore KrisFlyer']);
  });

  it('is put away only once no card earns into it', async () => {
    const { database, ws } = await setupDb();
    const a = await cardEarning(database, ws, 'Mandiri Prioritas', 10_000_000);
    const krisflyer = await createProgramme(database, ws, { name: 'KrisFlyer', unit: 'miles' });

    await expect(archiveProgramme(database, ws, a.program.id)).rejects.toThrow(PointsError);
    await archiveProgramme(database, ws, krisflyer.id);
    expect((await listProgrammes(database, ws)).map((p) => p.id)).toEqual([a.program.id]);
  });
});
