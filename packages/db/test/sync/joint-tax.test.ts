import { type CoretaxInputs, coretaxRows, expenseLines, isoDate, type ItemSummary, jointCoretaxInputs, utangRows } from '@expanses/core';
import fc from 'fast-check';
import { sql } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import {
  activeNetWorthGroup,
  addHolding,
  confirmReview,
  coretaxInputsFor,
  createAccount,
  createCardAccount,
  draftReport,
  freezeReport,
  postTransaction,
  recordLoan,
  reportInputsFor,
  rowDifferences,
  saveAssetProfile,
  saveCardTerms,
  savedRows,
  saveLoanTerms,
  setShareSetting,
  taxRowFor,
} from '../../src/index';
import { itemIdOf, receivedItems, refreshSummariesTx, sendSummariesTx } from '../../src/sync/net-worth/summaries';
import { categoryOf, Household, type Device } from './household';

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

  it('a Change to one tax ID sends no tax row before this person’s own Share of it, and the rows after it', async () => {
    const { home, rina, andi, bookId, groupBookId } = await sharing('separate');
    const change = await rina.engine.proposeNetWorth(bookId, { mode: 'joint', members: [andi.memberId] });
    await settle(home);
    await andi.engine.answerNetWorth(bookId, change, 'confirm');
    await settle(home);
    expect((await activeNetWorthGroup(rina.database))?.mode).toBe('joint');

    // A Household spend on Rina's bank: the live item refreshes (allowed before the Share), with no tax row.
    const groceries = await categoryOf(rina.database, bookId, 'Groceries');
    await postTransaction(rina.database, rina.ws, {
      occurredOn: today,
      description: 'Household groceries',
      lines: expenseLines({ categoryAccountId: groceries, paymentAccountId: rina.bank, amountMinor: 7_000_000, currency: 'IDR' }),
    });
    await settle(home);
    const bankOnAndi = async () => (await receivedItems(andi.database, groupBookId)).find((item) => item.name === 'Rina Bank')!;
    expect((await bankOnAndi()).householdMinor).toBe(-7_000_000);
    for (const item of await receivedItems(andi.database, groupBookId)) expect(item.tax).toBeNull();

    // Her Share of the Change: now each item carries its row.
    await confirmReview(rina.database, rina.ws, {});
    await settle(home);
    const rinas = (await receivedItems(andi.database, groupBookId)).filter((item) => item.owner === rina.memberId);
    expect(rinas.length).toBeGreaterThan(0);
    for (const item of rinas) expect(item.tax?.taxYear).toBe(YEAR);
  });

  it('the new year’s tax row goes out in January, even on a card whose cycle runs over the new year', async () => {
    const { rina, groupBookId } = await sharing('joint');
    const card = await createCardAccount(rina.database, rina.ws, { name: 'Rina Card', subtype: 'credit_card', currency: 'IDR', last4: '1234' });
    await saveCardTerms(rina.database, rina.ws, { accountId: card.id, statementDay: 25, dueDay: 10, creditLimitMinor: 500_000_000, annualFeeMinor: null });
    await setShareSetting(rina.database, card.id, 'total');
    const itemId = await itemIdOf(groupBookId, card.id);
    const sent = async () => {
      const [row] = await rina.database.db.values<[string]>(sql`SELECT summary_json FROM nw_items WHERE book_id = ${groupBookId} AND item_id = ${itemId}`);
      return JSON.parse(row![0]) as ItemSummary;
    };
    // Sent on 28 December: the cycle 26 Dec – 25 Jan, and the row of the year before.
    await rina.database.transaction((tx) => sendSummariesTx(tx, [card.id], `${YEAR}-12-28`));
    expect((await sent()).tax?.taxYear).toBe(YEAR - 1);
    // 5 January: the cycle has not ended, but the year has.
    await rina.database.transaction((tx) => refreshSummariesTx(tx, [], `${YEAR + 1}-01-05`));
    expect((await sent()).tax?.taxYear).toBe(YEAR);
    expect((await sent()).monthEnds.some((m) => m.month === `${YEAR}-12`)).toBe(true);
  });

  it('a foreign holding, a loan and a receivable travel as their owner’s rows: price and years equal, purchases stay home, the lender travels', async () => {
    const { home, rina, andi, groupBookId } = await sharing('joint');
    const ibkr = await createAccount(andi.database, andi.ws, { name: 'Interactive Brokers', kind: 'asset', subtype: 'fund', currency: 'USD' });
    const { accountId: aapl } = await addHolding(andi.database, andi.ws, {
      security: { ticker: 'AAPL', name: 'AAPL name', market: 'NASDAQ', currency: 'USD', lotSize: null, kind: 'share', source: 'owner' },
      broker: { accountId: ibkr.id },
      buy: { occurredOn: `${YEAR}-03-08`, unitsMicro: 10_000_000, grossMinor: 182_500, feeMinor: 0, taxMinor: 0, cashAccountId: null, ratesToBase: { USD: 15_800 } },
    });
    const kpr = await createAccount(andi.database, andi.ws, { name: 'KPR Bintaro', kind: 'liability', subtype: 'loan', currency: 'IDR', openingBalanceMinor: 700_000_000, openedOn: `${YEAR}-01-01` });
    await saveLoanTerms(andi.database, andi.ws, { accountId: kpr.id, lenderName: 'Bank BTN', originalMinor: 700_000_000, firstPaymentOn: `${YEAR}-01-25`, tenorMonths: 180, method: 'annuity', paymentDay: 25, rateBps: 900 });
    const lent = await recordLoan(andi.database, andi.ws, { person: { name: 'Budi', direction: 'lent', currency: 'IDR' }, occurredOn: `${YEAR}-05-01`, amountMinor: 9_000_000, moneyAccountId: andi.bank });
    for (const id of [aapl, kpr.id, lent.debtAccountId]) await setShareSetting(andi.database, id, 'total');
    await settle(home);

    const own = await coretaxInputsFor(andi.database, andi.ws, YEAR);
    const { inputs } = jointCoretaxInputs(EMPTY, await receivedItems(rina.database, groupBookId), YEAR);

    const ownHolding = own.holdings.find((row) => row.accountId === aapl)!;
    expect(ownHolding.purchases).toHaveLength(1);
    const { purchases: _purchases, ...shared } = ownHolding;
    const aaplItem = await itemIdOf(groupBookId, aapl);
    expect(inputs.holdings).toContainEqual({ ...shared, accountId: aaplItem });
    expect(inputs.holdings.find((row) => row.accountId === aaplItem)).not.toHaveProperty('purchases');

    const ownKpr = own.debts.find((row) => row.accountId === kpr.id)!;
    expect(ownKpr.note).toBe('Bank BTN');
    expect(inputs.debts).toContainEqual({ ...ownKpr, accountId: await itemIdOf(groupBookId, kpr.id) });

    const ownLent = own.receivables.find((row) => row.accountId === lent.debtAccountId)!;
    expect(ownLent.fields).toMatchObject({ name: 'Budi' });
    expect(inputs.receivables).toContainEqual({ ...ownLent, accountId: await itemIdOf(groupBookId, lent.debtAccountId) });
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
    transferMinor: 0,
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
    expect(waiting.map((w) => w.name)).toEqual(['Item a', 'Item b', 'Item c']);
    expect(every(inputs)).toEqual([]);
  });

  it('a malformed row in a received slice sends its whole item to waiting, and the rows still render', () => {
    const good = summary('good', 2025, true, 2025);
    const withRow = (itemId: string, part: Partial<Record<keyof CoretaxInputs, unknown[]>>) =>
      ({ ...summary(itemId, 2025, true, 2025), tax: { taxYear: 2025, part: { ...EMPTY, ...part } } }) as unknown as ItemSummary & { itemId: string };
    const bad = [
      withRow('cash-nan', { cash: [{ accountId: 'cash-nan', name: 'x', code: '0102', balanceMinor: 'lots', currency: 'IDR', fields: {} }] }),
      withRow('cash-nofields', { cash: [{ accountId: 'cash-nofields', name: 'x', code: '0102', balanceMinor: 1, currency: 'IDR' }] }),
      withRow('holding-noyears', { holdings: [{ accountId: 'h', name: 'x', code: '0399', currency: 'USD', priceMicro: 1, byYear: null, fields: {} }] }),
      withRow('holding-badbucket', { holdings: [{ accountId: 'h', name: 'x', code: '0399', currency: 'USD', priceMicro: 1, byYear: { '2024': { unitsMicro: 'a' } }, fields: {} }] }),
      withRow('estimated-nocost', { estimated: [{ accountId: 'e', name: 'x', code: '0509', currency: 'IDR', valueMinor: 1, fields: {} }] }),
      withRow('debt-badnote', { debts: [{ accountId: 'd', name: 'x', code: '101', balanceMinor: 1, currency: 'IDR', note: 5 }] }),
      withRow('row-null', { receivables: [null] }),
    ];
    const { inputs, waiting } = jointCoretaxInputs(EMPTY, [good, ...bad], 2025);
    expect(waiting.map((w) => w.name)).toEqual(bad.map((item) => item.name));
    expect(inputs.cash.map((row) => row.accountId)).toEqual(['good']);
    const settings = { propertyBasis: 'cost' as const, repeatRows: 'year' as const, kmkRateBps: {} };
    expect(() => [...coretaxRows(2025, inputs, settings), ...utangRows(2025, inputs, settings)]).not.toThrow();
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
