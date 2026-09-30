import { type CoretaxInputs, isoDate, type ItemSummary, jointCoretaxInputs } from '@expanses/core';
import fc from 'fast-check';
import { sql } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { confirmReview, coretaxInputsFor, createAccount, draftReport, freezeReport, reportInputsFor, rowDifferences, saveAssetProfile, savedRows, setShareSetting, taxRowFor } from '../../src/index';
import { itemIdOf, receivedItems } from '../../src/sync/net-worth/summaries';
import { Household, type Device } from './household';

/*
 * The joint tax report (joint-net-worth spec §5.2 `tax`, §8.4; task 10). With one tax ID, each item's summary carries its
 * own slice of `coretaxInputsFor` for the latest finished tax year, and each phone's report is its own rows plus every
 * received slice — the same codes and figures its owner's own report has, known by the item id, never by a local
 * account id. An item whose year-end has not reached this phone yet is named as waiting, not left out quietly.
 */

const today = isoDate();
const YEAR = Number(today.slice(0, 4)) - 1;

async function settle(home: Household) {
  for (let i = 0; i < 3; i += 1) await home.settle();
}

/** Rina, Andi and Sari; Rina and Andi active in `mode` and both past their review (Share). */
async function sharing(mode: 'joint' | 'separate') {
  const home = new Household();
  const rina = await home.device('Rina');
  const andi = await home.device('Andi');
  const sari = await home.device('Sari');
  const bookId = await home.share(rina);
  await home.join(andi, rina);
  await home.join(sari, rina);
  await home.settle();
  const proposalId = await rina.engine.proposeNetWorth(bookId, { mode, members: [andi.memberId] });
  await settle(home);
  await andi.engine.answerNetWorth(bookId, proposalId, 'confirm');
  await settle(home);
  await confirmReview(rina.database, rina.ws, {});
  await confirmReview(andi.database, andi.ws, {});
  await settle(home);
  const groupBookId = (await rina.engine.netWorthGroup(bookId)).groupBookId!;
  return { home, rina, andi, sari, bookId, groupBookId };
}

/** Rina's BCA, 50 jt since March of the tax year; Andi's house, 900 jt since 2021. Both shared. */
async function bankAndHouse(rina: Device, andi: Device, home: Household) {
  const bca = await createAccount(rina.database, rina.ws, { name: 'BCA Tahapan', kind: 'asset', subtype: 'bank', currency: 'IDR', openingBalanceMinor: 50_000_000, openedOn: `${YEAR}-03-01` });
  await saveAssetProfile(rina.database, rina.ws, { accountId: bca.id, assetKind: 'cash', coretaxFields: { owner: 'Rina', inst: 'BCA', loc: 'IDN' } });
  await setShareSetting(rina.database, bca.id, 'total');
  const house = await createAccount(andi.database, andi.ws, { name: 'House in Bintaro', kind: 'asset', subtype: 'property', currency: 'IDR', openingBalanceMinor: 900_000_000, openedOn: '2021-03-25' });
  await saveAssetProfile(andi.database, andi.ws, { accountId: house.id, assetKind: 'property' });
  await setShareSetting(andi.database, house.id, 'total');
  await settle(home);
  return { bca: bca.id, house: house.id };
}

const EMPTY: CoretaxInputs = { cash: [], holdings: [], estimated: [], receivables: [], debts: [] };
const every = (inputs: CoretaxInputs) => [...inputs.cash, ...inputs.holdings, ...inputs.estimated, ...inputs.receivables, ...inputs.debts];

describe('joint tax report', () => {
  it('one tax ID: Rina’s bank and Andi’s house are both in each report, with the codes and figures each owner’s own report has', async () => {
    const { home, rina, andi, groupBookId } = await sharing('joint');
    const { bca, house } = await bankAndHouse(rina, andi, home);

    const andiOwn = await coretaxInputsFor(andi.database, andi.ws, YEAR);
    const rinaOwn = await coretaxInputsFor(rina.database, rina.ws, YEAR);
    const ownHouse = andiOwn.estimated.find((row) => row.accountId === house)!;
    const ownBca = rinaOwn.cash.find((row) => row.accountId === bca)!;
    expect(ownHouse).toBeDefined();
    expect(ownBca).toMatchObject({ balanceMinor: 50_000_000 });

    // On Rina's phone: her own rows, and Andi's house as his report has it, known by its item id.
    const onRina = jointCoretaxInputs(rinaOwn, await receivedItems(rina.database, groupBookId), YEAR);
    expect(onRina.waiting).toEqual([]);
    expect(onRina.inputs.cash).toContainEqual(ownBca);
    expect(onRina.inputs.estimated).toContainEqual({ ...ownHouse, accountId: await itemIdOf(groupBookId, house) });

    // On Andi's phone: the other way round.
    const onAndi = jointCoretaxInputs(andiOwn, await receivedItems(andi.database, groupBookId), YEAR);
    expect(onAndi.waiting).toEqual([]);
    expect(onAndi.inputs.estimated).toContainEqual(ownHouse);
    expect(onAndi.inputs.cash).toContainEqual({ ...ownBca, accountId: await itemIdOf(groupBookId, bca) });

    // The report reader does the same merge for the workspace the group lives in, and says whose rows are whose.
    const report = await reportInputsFor(rina.database, rina.ws, YEAR);
    expect(report.joint).toMatchObject({ members: [rina.memberId, andi.memberId], me: rina.memberId, waiting: [], pending: {} });
    expect(report.inputs.estimated).toContainEqual({ ...ownHouse, accountId: await itemIdOf(groupBookId, house) });
    expect(report.joint!.received[await itemIdOf(groupBookId, house)]).toBe(andi.memberId);
    expect(report.joint!.received[bca]).toBeUndefined();
    expect(report.joint!.received[await itemIdOf(groupBookId, bca)]).toBeUndefined();
  });

  it('a slice is exactly its account’s rows, and a received slice carries no local account id', async () => {
    const { home, rina, andi, groupBookId } = await sharing('joint');
    const { house } = await bankAndHouse(rina, andi, home);

    const part = await taxRowFor(andi.database, andi.ws, house, YEAR);
    const own = await coretaxInputsFor(andi.database, andi.ws, YEAR);
    expect(part).toEqual({ ...EMPTY, estimated: own.estimated.filter((row) => row.accountId === house) });
    // An account that files nothing that year has no slice at all.
    const empty = await createAccount(andi.database, andi.ws, { name: 'Empty bank', kind: 'asset', subtype: 'bank', currency: 'IDR' });
    expect(await taxRowFor(andi.database, andi.ws, empty.id, YEAR)).toBeNull();

    const received = await receivedItems(rina.database, groupBookId);
    const andis = received.filter((item) => item.owner === andi.memberId);
    expect(andis.length).toBeGreaterThan(1);
    const text = JSON.stringify(andis);
    for (const id of [house, andi.bank, andi.cash]) expect(text).not.toContain(id);
    for (const item of andis) {
      expect(item.tax?.taxYear).toBe(YEAR);
      for (const row of every(item.tax!.part)) expect(row.accountId).toBe(item.itemId);
    }
  });

  it('separate tax IDs: summaries carry no tax row, and the report is each owner’s own', async () => {
    const { home, rina, andi, groupBookId } = await sharing('separate');
    const { house } = await bankAndHouse(rina, andi, home);

    const received = await receivedItems(rina.database, groupBookId);
    expect(received.some((item) => item.name === 'House in Bintaro')).toBe(true);
    for (const item of received) expect(item.tax).toBeNull();
    const report = await reportInputsFor(rina.database, rina.ws, YEAR);
    expect(report.joint).toBeNull();
    expect(report.inputs).toEqual(await coretaxInputsFor(rina.database, rina.ws, YEAR));
    expect(JSON.stringify(report.inputs)).not.toContain(await itemIdOf(groupBookId, house));
  });

  it('Andi’s phone offline since before 31 December: his items are waiting, not in the report', async () => {
    const { home, rina, andi, groupBookId } = await sharing('joint');
    await bankAndHouse(rina, andi, home);
    const received = await receivedItems(rina.database, groupBookId);
    // What his phone last sent, on 20 December: last year's tax row, and no December month-end yet.
    const stale = received.map((item): ItemSummary & { itemId: string } =>
      item.owner === andi.memberId ? { ...item, tax: item.tax && { ...item.tax, taxYear: YEAR - 1 }, monthEnds: item.monthEnds.filter((m) => m.month < `${YEAR}-12`) } : item,
    );
    const rinaOwn = await coretaxInputsFor(rina.database, rina.ws, YEAR);
    const { inputs, waiting } = jointCoretaxInputs(rinaOwn, stale, YEAR);

    const andiNames = received.filter((item) => item.owner === andi.memberId).map((item) => ({ owner: andi.memberId, name: item.name }));
    expect(waiting).toEqual(andiNames);
    expect(inputs).toEqual(rinaOwn);
    // A December month-end without this year's row (his phone sent it on 1 January, before the app knew) waits too.
    const noRow = received.map((item) => (item.owner === andi.memberId ? { ...item, tax: null } : item));
    expect(jointCoretaxInputs(rinaOwn, noRow, YEAR).waiting).toEqual(andiNames);
  });

  it('freezing the joint report keeps Andi’s rows too, and a partner row is no account of Rina’s', async () => {
    const { home, rina, andi, groupBookId } = await sharing('joint');
    const { house } = await bankAndHouse(rina, andi, home);
    await draftReport(rina.database, rina.ws, { taxYear: YEAR });
    await freezeReport(rina.database, rina.ws, YEAR);

    const saved = await savedRows(rina.database, rina.ws, YEAR);
    const itemId = await itemIdOf(groupBookId, house);
    expect(saved.find((row) => row.key === itemId)).toMatchObject({ name: 'House in Bintaro' });
    const [stored] = await rina.database.db.values<[string | null]>(sql`SELECT account_id FROM tax_year_rows WHERE row_key = ${itemId}`);
    expect(stored?.[0]).toBeNull();
    expect(await rowDifferences(rina.database, rina.ws, YEAR)).toEqual([]);
  });

  it('the report reader reads each member’s pending count from the group log', async () => {
    const { rina, andi, groupBookId } = await sharing('joint');
    await andi.database.db.run(sql`INSERT INTO nw_pending (book_id, member_id, count) VALUES (${groupBookId}, ${rina.memberId}, 1)`);
    const report = await reportInputsFor(andi.database, andi.ws, YEAR);
    expect(report.joint!.pending).toEqual({ [rina.memberId]: 1 });
  });
});

describe('jointCoretaxInputs (property)', () => {
  const summary = (itemId: string, taxYear: number | null, december: boolean, year: number): ItemSummary & { itemId: string } => ({
    itemId,
    owner: 'andi',
    kind: 'asset',
    subtype: 'bank',
    name: `Item ${itemId}`,
    currency: 'IDR',
    balanceMinor: 1,
    asOf: `${year + 1}-02-01`,
    card: null,
    period: { start: `${year + 1}-02-01`, end: `${year + 1}-02-28` },
    openingMinor: 1,
    householdMinor: 0,
    otherUseMinor: 0,
    monthEnds: december ? [{ month: `${year}-12`, balanceMinor: 1 }] : [{ month: `${year}-11`, balanceMinor: 1 }],
    tax:
      taxYear === null
        ? null
        : { taxYear, part: { ...EMPTY, cash: [{ accountId: itemId, name: `Item ${itemId}`, code: '0102', balanceMinor: 1, currency: 'IDR', fields: {} }] } },
  });

  it('a malformed received summary waits instead of breaking the report', () => {
    const bad = [
      { ...summary('a', 2025, true, 2025), tax: { taxYear: 2025, part: null } },
      { ...summary('b', 2025, true, 2025), monthEnds: null },
      { ...summary('c', 2025, true, 2025), tax: { taxYear: 2025, part: { cash: 'x' } } },
    ] as unknown as (ItemSummary & { itemId: string })[];
    const { inputs, waiting } = jointCoretaxInputs(EMPTY, bad, 2025);
    expect(waiting.map((w) => w.name)).toEqual(['Item a', 'Item b']);
    expect(every(inputs)).toEqual([]);
  });

  it('every received item is either in the report (once) or waiting, and the own rows stay as they were', () => {
    fc.assert(
      fc.property(
        fc.array(fc.record({ taxYear: fc.option(fc.integer({ min: 2023, max: 2025 }), { nil: null }), december: fc.boolean() }), { maxLength: 8 }),
        (specs) => {
          const year = 2025;
          const received = specs.map((spec, i) => summary(`item-${i}`, spec.taxYear, spec.december, year));
          const own: CoretaxInputs = { ...EMPTY, debts: [{ accountId: 'own-card', name: 'Card', code: '102', balanceMinor: 5, currency: 'IDR', note: null }] };
          const { inputs, waiting } = jointCoretaxInputs(own, received, year);
          const inReport = inputs.cash.map((row) => row.accountId);
          const complete = received.filter((item) => item.tax?.taxYear === year && item.monthEnds.some((m) => m.month === `${year}-12`));
          expect(inReport).toEqual(complete.map((item) => item.itemId));
          expect(waiting.map((w) => w.name)).toEqual(received.filter((item) => !complete.includes(item)).map((item) => item.name));
          expect(inputs.debts).toEqual(own.debts);
        },
      ),
    );
  });
});
