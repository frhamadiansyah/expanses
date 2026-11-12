import type { ItemSummary } from '@expanses/core';
import type { AssetValueRow } from '@expanses/db';
import { describe, expect, it } from 'vitest';
import { groupAssets, liveGroups, totalOf } from './asset-rows';
import { type DebtAccount, groupDebts } from './debt-rows';
import { type Household, householdAssetGroups, householdAssetPage, householdCaption, householdDebtPage, householdDebtSheet, householdFrom, memberMark } from './household-lists';
import { jointStatus, type ReceivedItem } from './joint-rows';
import { assetSegments, debtSegments } from './share-segments';

/*
 * The household's Assets and Liabilities (owner, 12 Nov, option A): Rina's phone reads her own accounts and what Budi
 * shares; Budi's reads his own and what Rina shares. Given the same rates, both draw the same total, the same squares
 * and the same list (a foreign row is converted with each phone's own rates of the day, so a rate that differs between
 * the phones moves the figure by that rate alone).
 */

const RINA = 'm-rina';
const BUDI = 'm-budi';
const members = [RINA, BUDI];
const names = { [RINA]: 'Rina', [BUDI]: 'Budi' };
const rates = { USD: 16_000 };

const value = (partial: Partial<AssetValueRow> & Pick<AssetValueRow, 'accountId' | 'name'>): AssetValueRow => ({
  subtype: 'bank',
  planGroup: 'liquid',
  mode: 'derived',
  person: null,
  valueMinor: 0,
  costMinor: 0,
  source: 'ledger',
  asOf: null,
  currency: 'IDR',
  coretaxCode: null,
  stale: false,
  unitsMicro: null,
  ...partial,
});

/** What the owner's phone sends for one of its own rows: its shared balance and the facts it is filed by. */
function sent(owner: string, row: AssetValueRow): ReceivedItem {
  return summary(owner, { itemId: `item-${row.accountId}`, kind: 'asset', subtype: row.subtype, name: row.name, currency: row.currency, balanceMinor: row.valueMinor, ...(row.coretaxCode ? { sheet: { code: row.coretaxCode } } : {}) });
}

function summary(owner: string, over: Partial<ItemSummary> & { itemId: string }): ReceivedItem {
  return {
    owner,
    kind: 'asset',
    subtype: 'bank',
    name: '',
    currency: 'IDR',
    balanceMinor: 0,
    asOf: '2026-11-12',
    card: null,
    period: { start: '2026-11-01', end: '2026-11-30' },
    openingMinor: 0,
    householdMinor: 0,
    otherUseMinor: 0,
    transferMinor: 0,
    transfers: [],
    monthEnds: [],
    tax: null,
    ...over,
  };
}

const rinaValues = [
  value({ accountId: 'bca', name: 'BCA Tahapan', valueMinor: 18_200_000 }),
  value({ accountId: 'gopay', name: 'GoPay', subtype: 'ewallet', valueMinor: 640_000 }),
  value({ accountId: 'fund', name: 'Mutual fund', subtype: 'investment', planGroup: 'invest', mode: 'market', valueMinor: 12_000_000, unitsMicro: 5_000_000, coretaxCode: '0303' }),
];
const budiValues = [
  value({ accountId: 'mandiri', name: 'Mandiri Payroll', valueMinor: 9_450_000 }),
  value({ accountId: 'ovo', name: 'OVO', subtype: 'ewallet', valueMinor: 215_000 }),
  value({ accountId: 'bond', name: 'Government bond', subtype: 'investment', planGroup: 'invest', mode: 'market', valueMinor: 25_000_000, unitsMicro: 1_000_000, coretaxCode: '0304' }),
  value({ accountId: 'gold', name: 'Gold bars', subtype: 'investment', planGroup: 'invest', mode: 'market', valueMinor: 7_000_000, unitsMicro: 10_000_000, coretaxCode: '0701' }),
  value({ accountId: 'usd', name: 'Dollar savings', currency: 'USD', valueMinor: 100_00 }),
];

/** One phone's household Assets page: what its total, squares and list say. Every own row is sent unless `kept` says not. */
function assetsOn(me: string, own: AssetValueRow[], received: ReceivedItem[], { kept = [] as string[], accounts = [] as { id: string; name: string; parentId: string | null; kind: 'asset'; subtype: 'bank' }[] } = {}) {
  const household: Household = { me, members, names, received, ratesToBase: rates };
  const shared = new Set(own.map((row) => row.accountId).filter((id) => !kept.includes(id)));
  const { live, total, onlyHere } = householdAssetPage(own, [], { accounts, baseCurrency: 'IDR', ratesToBase: rates }, household, shared);
  return {
    total,
    onlyHere: onlyHere.map((row) => `${memberMark(household, row.owner!).name}: ${row.name}`),
    segments: assetSegments(live).map(({ key, minor }) => [key, minor]),
    list: live.map((group) => [group.group, group.totalMinor, group.drawers.map((drawer) => [drawer.key, drawer.totalMinor, drawer.rows.map((row) => `${memberMark(household, row.owner!).name}: ${row.name}`)])]),
  };
}

describe('householdAssetGroups (one square per kind, the same on both phones given the same rates)', () => {
  const rinaPhone = assetsOn(RINA, rinaValues, budiValues.map((row) => sent(BUDI, row)));
  const budiPhone = assetsOn(BUDI, budiValues, rinaValues.map((row) => sent(RINA, row)));

  it('draws the same total, squares and list on both phones, given the same rates', () => {
    expect(rinaPhone).toEqual(budiPhone);
  });

  it('an own account the partner never receives is left out of the household total and squares, and listed apart on its own phone', () => {
    const secret = value({ accountId: 'secret', name: 'Rainy-day cash', subtype: 'cash', valueMinor: 3_000_000 });
    // Rina keeps it to herself ("Don't share"): it never reaches Budi.
    const rina = assetsOn(RINA, [...rinaValues, secret], budiValues.map((row) => sent(BUDI, row)), { kept: ['secret'] });
    const budi = assetsOn(BUDI, budiValues, rinaValues.map((row) => sent(RINA, row)));
    expect(rina.total).toEqual(budi.total);
    expect(rina.segments).toEqual(budi.segments);
    expect(rina.list).toEqual(budi.list);
    expect(rina.onlyHere).toEqual(['Rina: Rainy-day cash']);
    expect(budi.onlyHere).toEqual([]);
  });

  it('an account with pockets gives the same household total and squares on both phones', () => {
    // Rina's account with an IDR and a USD pocket: one row at their total on her phone, and the two pockets — each an
    // item of its own — as two rows on Budi's. The rows differ; what they add up to does not.
    const accounts = [
      { id: 'multi', name: 'Multicurrency', parentId: null, kind: 'asset' as const, subtype: 'bank' as const },
      { id: 'multi-idr', name: 'Multicurrency · IDR', parentId: 'multi', kind: 'asset' as const, subtype: 'bank' as const },
      { id: 'multi-usd', name: 'Multicurrency · USD', parentId: 'multi', kind: 'asset' as const, subtype: 'bank' as const },
    ];
    const pockets = [
      value({ accountId: 'multi-idr', name: 'Multicurrency · IDR', valueMinor: 2_500_000 }),
      value({ accountId: 'multi-usd', name: 'Multicurrency · USD', currency: 'USD', valueMinor: 250_00 }),
    ];
    const rina = assetsOn(RINA, [...rinaValues, ...pockets], budiValues.map((row) => sent(BUDI, row)), { accounts });
    const budi = assetsOn(BUDI, budiValues, [...rinaValues, ...pockets].map((row) => sent(RINA, row)));
    expect(rina.total).toEqual(budi.total);
    expect(rina.segments).toEqual(budi.segments);
    expect(rina.total.totalMinor).toBe(rinaPhone.total.totalMinor! + 2_500_000 + 4_000_000);
  });

  it('counts both people in the total and in each square, converting a dollar item at the day’s rate', () => {
    const owned = 18_200_000 + 640_000 + 12_000_000 + 9_450_000 + 215_000 + 25_000_000 + 7_000_000 + 1_600_000;
    expect(rinaPhone.total).toEqual({ totalMinor: owned, missing: [] });
    // Gold leaves Investments for "Intangible and other" on both phones: its code travels with it.
    expect(rinaPhone.segments).toEqual([
      ['liquid', 18_200_000 + 640_000 + 9_450_000 + 215_000 + 1_600_000],
      ['invest', 12_000_000 + 25_000_000],
      ['other', 7_000_000],
    ]);
  });

  it('mixes both people’s accounts in one list per kind, in the group’s order then by name', () => {
    const liquid = rinaPhone.list[0]![2] as [string, number, string[]][];
    expect(liquid.find(([key]) => key === 'bank')![2]).toEqual(['Rina: BCA Tahapan', 'Budi: Dollar savings', 'Budi: Mandiri Payroll']);
  });

  it('names a missing rate rather than adding the rest', () => {
    const household: Household = { me: RINA, members, names, received: budiValues.map((row) => sent(BUDI, row)), ratesToBase: {} };
    const live = householdAssetGroups(liveGroups(groupAssets(rinaValues, [], { accounts: [], baseCurrency: 'IDR', ratesToBase: {} })), household, 'IDR');
    expect(totalOf(live)).toEqual({ totalMinor: null, missing: ['USD'] });
  });

  it('leaves out an item of someone no longer in the group', () => {
    const household: Household = { me: RINA, members, names, received: [summary('m-gone', { itemId: 'x', name: 'Old', balanceMinor: 5 })], ratesToBase: {} };
    expect(householdAssetGroups([], household, 'IDR')).toEqual([]);
  });

  it('says whose the figure is under the total, in the group’s order on both phones', () => {
    expect(householdCaption({ members, names })).toBe('Household · Rina and Budi');
    expect(householdCaption({ members: [...members, 'm-sari'], names: { ...names, 'm-sari': 'Sari' } })).toBe('Household · Rina, Budi and Sari');
  });
});

const card = (id: string, name: string): DebtAccount => ({ id, name, kind: 'liability', subtype: 'credit_card', currency: 'IDR', archivedAt: null });
const loan = (id: string, name: string): DebtAccount => ({ id, name, kind: 'liability', subtype: 'loan', currency: 'IDR', archivedAt: null });

/** One phone's household Liabilities page, from its own debts and the other's shared ones. */
function debtsOn(me: string, accounts: DebtAccount[], balances: Record<string, number>, items: Record<string, string>, received: ReceivedItem[]) {
  const household: Household = { me, members, names, received, ratesToBase: rates };
  const own = groupDebts({ accounts, balances, loans: [], cards: {}, people: [], sheet: null, baseCurrency: 'IDR', ratesToBase: {}, items }, '2026-11-12');
  const sheet = householdDebtSheet(own, household, 'IDR', items);
  return {
    total: sheet.total,
    segments: debtSegments(sheet.groups.flatMap((group) => group.drawers.map((drawer) => ({ key: `${group.kind}:${drawer.key}`, label: drawer.label, totalMinor: drawer.totalMinor, kind: group.kind })))).map(({ key, minor }) => [key, minor]),
    list: sheet.groups.map((group) => [group.kind, group.drawers.map((drawer) => [drawer.key, drawer.rows.map((row) => `${memberMark(household, row.owner!).name}: ${row.name}`)])]),
    received: sheet.groups.flatMap((group) => group.rows).filter((row) => row.received).map((row) => row.key),
  };
}

describe('householdDebtSheet (cards, loans and debts of both, the same on both phones given the same rates)', () => {
  const rinaDebts = { accounts: [card('rina-card', 'Card 1188')], balances: { 'rina-card': -2_000_000 }, items: {} };
  const budiDebts = { accounts: [card('budi-card', 'Card 4417'), loan('budi-loan', 'Paylater')], balances: { 'budi-card': -4_820_000, 'budi-loan': -1_500_000 }, items: { 'budi-loan': 'online_loan' } };
  const rinaSends = [summary(RINA, { itemId: 'i-rina-card', kind: 'liability', subtype: 'credit_card', name: 'Card 1188', balanceMinor: 2_000_000 })];
  const budiSends = [
    summary(BUDI, { itemId: 'i-budi-card', kind: 'liability', subtype: 'credit_card', name: 'Card 4417', balanceMinor: 4_820_000 }),
    summary(BUDI, { itemId: 'i-budi-loan', kind: 'liability', subtype: 'loan', name: 'Paylater', balanceMinor: 1_500_000, sheet: { item: 'online_loan', icon: 'loan' } }),
  ];
  const rinaPhone = debtsOn(RINA, rinaDebts.accounts, rinaDebts.balances, rinaDebts.items, budiSends);
  const budiPhone = debtsOn(BUDI, budiDebts.accounts, budiDebts.balances, budiDebts.items, rinaSends);

  it('draws the same total, squares and list on both phones, given the same rates', () => {
    const { received: _a, ...rina } = rinaPhone;
    const { received: _b, ...budi } = budiPhone;
    expect(rina).toEqual(budi);
    expect(rinaPhone.total).toEqual({ totalMinor: 2_000_000 + 4_820_000 + 1_500_000, missing: [] });
    // The paylater keeps its kind on Rina's phone: its catalogue item travels with it.
    expect(rinaPhone.segments).toEqual([
      ['loan:online_loan', 1_500_000],
      ['card:credit_card', 2_000_000 + 4_820_000],
    ]);
  });

  it('an own debt the partner never receives is left out of the household total and listed apart on its own phone', () => {
    const household: Household = { me: RINA, members, names, received: budiSends, ratesToBase: rates };
    const accounts = [...rinaDebts.accounts, card('rina-secret', 'Card 9090')];
    const input = { accounts, balances: { ...rinaDebts.balances, 'rina-secret': -700_000 }, loans: [], cards: {}, people: [], sheet: null, baseCurrency: 'IDR', ratesToBase: {}, items: {} };
    const page = householdDebtPage(input, household, new Set(['rina-card']), '2026-11-12');
    expect(page.sheet.total).toEqual(rinaPhone.total);
    expect(page.onlyHere.map((row) => [row.name, row.owner])).toEqual([['Card 9090', RINA]]);
  });

  it('marks the other’s rows as theirs to open read-only, and leaves out a debt that owes nothing', () => {
    expect(rinaPhone.received).toEqual(['i-budi-loan', 'i-budi-card']);
    const paid = debtsOn(RINA, [], {}, {}, [summary(BUDI, { itemId: 'paid', kind: 'liability', subtype: 'credit_card', name: 'Paid card', balanceMinor: 0 })]);
    expect(paid.list).toEqual([]);
  });
});

describe('householdFrom (Assets and Liabilities never wait on the household)', () => {
  const data = { me: RINA, members, names, received: [], ratesToBase: {} };

  it('with no household group the status is personal, never pending, whatever the own inputs are doing', () => {
    expect(jointStatus({ group: { pending: false, error: null, mode: null }, inputs: { pending: true, error: null } })).toBe('personal');
    expect(jointStatus({ group: { pending: false, error: null, mode: 'separate' }, inputs: { pending: true, error: null } })).toBe('personal');
  });

  it('draws the own page while the household loads or failed (offline), and the household page once all of it is in', () => {
    expect(householdFrom({ status: 'pending', data: null }, undefined)).toBeNull();
    expect(householdFrom({ status: 'error', data: null }, undefined)).toBeNull();
    expect(householdFrom({ status: 'personal', data: null }, ['a'])).toBeNull();
    // The rates and the summaries are in, but not yet which own accounts were sent: still the own page.
    expect(householdFrom({ status: 'joint', data }, undefined)).toBeNull();
    const ready = householdFrom({ status: 'joint', data }, ['a']);
    expect(ready?.household.me).toBe(RINA);
    expect([...ready!.sent]).toEqual(['a']);
  });
});
