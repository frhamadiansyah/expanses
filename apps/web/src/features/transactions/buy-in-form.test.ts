import type { AccountRow, AssetProfileRow, AssetValueRow } from '@expanses/db';
import { describe, expect, it } from 'vitest';
import { buyChoices, emptyPurchaseDraft, type PurchaseDraft, purchaseDraftToInput, transferTargets } from './buy-in-form';

const TODAY = '2026-09-12';

const value = (partial: Partial<AssetValueRow> & Pick<AssetValueRow, 'accountId' | 'name' | 'mode'>): AssetValueRow => ({
  valueMinor: 1_000_000,
  costMinor: 1_000_000,
  source: 'price',
  coretaxCode: null,
  asOf: '2026-09-11',
  currency: 'IDR',
  planGroup: 'invest',
  subtype: 'investment',
  person: null,
  stale: false,
  unitsMicro: 10_000_000,
  ...partial,
});

const profile = (accountId: string, partial: Partial<AssetProfileRow> = {}): AssetProfileRow => ({
  accountId,
  workspaceId: 'ws',
  reportable: true,
  taxTreatment: null,
  assetKind: 'stock',
  planGroup: 'invest',
  unitKind: 'shares',
  lotSize: 100,
  risk: 'high',
  coretaxSection: 'investasi',
  coretaxCode: '0302',
  acquiredYear: null,
  coretaxFields: {},
  updatedAt: '2026-09-12T00:00:00Z',
  ...partial,
});

const account = (id: string, name: string, subtype: AccountRow['subtype'], kind: AccountRow['kind'] = 'asset'): AccountRow => ({
  id,
  workspaceId: 'ws',
  parentId: null,
  kind,
  subtype,
  name,
  icon: null,
  currency: 'IDR',
  valuationMode: 'derived',
  systemKey: null,
  sortOrder: 0,
  archivedAt: null,
  createdAt: '2026-01-01T00:00:00Z',
});

const values: AssetValueRow[] = [
  value({ accountId: 'bbri', name: 'BBRI shares', mode: 'market' }),
  value({ accountId: 'gold', name: 'Antam gold bars', mode: 'market' }),
  value({ accountId: 'tlkm', name: 'TLKM shares', mode: 'market', unitsMicro: 0 }),
  value({ accountId: 'bca', name: 'BCA Tahapan', mode: 'derived', planGroup: 'liquid', unitsMicro: null }),
  value({ accountId: 'house', name: 'House in Bintaro', mode: 'snapshot', planGroup: 'use', unitsMicro: null }),
];
const profiles = [profile('bbri'), profile('gold', { assetKind: 'gold', unitKind: 'grams', lotSize: null, risk: 'medium' })];

const draft = (overrides: Partial<PurchaseDraft> = {}): PurchaseDraft => ({ ...emptyPurchaseDraft('bbri', 'bca', TODAY), ...overrides });

describe('buyChoices', () => {
  it('offers every holding measured in units, and nothing else', () => {
    const { buys } = buyChoices(values, profiles);
    expect(buys.map((choice) => choice.accountId)).toEqual(['bbri', 'gold', 'tlkm']);
    expect(buys[0]!.label).toBe('Investments › BBRI shares');
  });

  it('only offers to sell what is still held', () => {
    const { sells } = buyChoices(values, profiles);
    expect(sells.map((choice) => choice.accountId)).toEqual(['bbri', 'gold']);
    expect(sells[0]!.label).toBe('Sell › BBRI shares');
  });

  it('carries the lot size and what the units are called', () => {
    const { buys } = buyChoices(values, profiles);
    expect(buys.find((choice) => choice.accountId === 'bbri')).toMatchObject({ lotSize: 100, unitLabel: 'Shares' });
    expect(buys.find((choice) => choice.accountId === 'gold')).toMatchObject({ lotSize: null, unitLabel: 'Grams' });
  });
});

describe('purchaseDraftToInput', () => {
  it('reads grams and the amount typed the Indonesian way', () => {
    const input = purchaseDraftToInput(draft({ accountId: 'gold', units: '2', amount: '3.980.000' }), 'IDR', TODAY);
    expect(input).toMatchObject({ kind: 'buy', accountId: 'gold', unitsMicro: 2_000_000, grossMinor: 3_980_000, cashAccountId: 'bca' });
  });

  it('turns lots into shares', () => {
    const input = purchaseDraftToInput(draft({ useLots: true, lots: '1', lotSize: 100, amount: '987.500' }), 'IDR', TODAY);
    expect(input.unitsMicro).toBe(100_000_000);
  });

  it('counts a US stock in single shares', () => {
    const input = purchaseDraftToInput(draft({ accountId: 'vti', useLots: true, lots: '3', lotSize: 1, amount: '900.000' }), 'IDR', TODAY);
    expect(input.unitsMicro).toBe(3_000_000);
  });

  it('carries the goal, and the card category and MCC when a card paid', () => {
    const input = purchaseDraftToInput(
      draft({ accountId: 'gold', units: '2', amount: '3.980.000', moneyId: 'card', moneyIsCard: true, goalId: 'hajj', spendCategoryId: 'shopping', mcc: '5944' }),
      'IDR',
      TODAY,
    );
    expect(input).toMatchObject({ goalId: 'hajj', spendCategoryId: 'shopping', mcc: '5944', cashAccountId: 'card' });
  });

  it('leaves the card fields off when a bank account paid', () => {
    const input = purchaseDraftToInput(draft({ accountId: 'gold', units: '2', amount: '3.980.000', spendCategoryId: 'shopping', mcc: '5944' }), 'IDR', TODAY);
    expect(input.spendCategoryId).toBeNull();
    expect(input.mcc).toBeNull();
  });

  it('refuses to put the proceeds of a sale on a card', () => {
    expect(() => purchaseDraftToInput(draft({ mode: 'sell', units: '1', amount: '1.000.000', moneyIsCard: true }), 'IDR', TODAY)).toThrow(/bank or cash/);
  });

  it('says what is missing, in plain words', () => {
    expect(() => purchaseDraftToInput(draft({ amount: '3.980.000' }), 'IDR', TODAY)).toThrow(/how many units/);
    expect(() => purchaseDraftToInput(draft({ units: '2' }), 'IDR', TODAY)).toThrow(/what it cost/);
    expect(() => purchaseDraftToInput(draft({ units: '2', amount: '1.000', occurredOn: '2026-09-13' }), 'IDR', TODAY)).toThrow(/after today/);
    expect(() => purchaseDraftToInput(draft({ useLots: true, lots: '', amount: '1.000' }), 'IDR', TODAY)).toThrow(/how many lots/);
  });

  it('carries what left a rupiah account for a dollar holding on the input, so the door reads it', () => {
    const draft = { ...emptyPurchaseDraft('aapl', 'bca', '2026-03-08'), units: '10', amount: '1.234,57', charged: '20.000.001' };
    expect(purchaseDraftToInput(draft, 'USD', '2026-03-08', 'IDR')).toMatchObject({ grossMinor: 123_457, cashMinor: 20_000_001 });
    expect(() => purchaseDraftToInput({ ...draft, charged: '' }, 'USD', '2026-03-08', 'IDR')).toThrow(/Charged in IDR/);
    expect(purchaseDraftToInput(draft, 'USD', '2026-03-08').cashMinor).toBeUndefined(); // one currency: no charged figure
  });
});

describe('transferTargets', () => {
  /*
   * The destination side is the mirror of the source, and deliberately wider: a debt may receive money — paying a
   * card's statement, an instalment or a person is a transfer *into* them — while nothing may come out of one. Only
   * a holding measured in units is left out, because money moved into one records no units.
   */
  it('lets money land anywhere but a holding measured in units, the debts included', () => {
    const accounts = [
      account('bca', 'BCA Tahapan', 'bank'),
      account('gold', 'Antam gold bars', 'investment'), // units: left out
      account('bbri', 'BBRI shares', 'investment'),
      account('house', 'House in Bintaro', 'property'), // what a purchase is recorded into
      account('card', 'BCA Visa', 'credit_card', 'liability'), // paying its statement
      account('kpr', 'KPR BCA', 'loan', 'liability'), // an instalment
      account('dewi', 'Dewi', 'receivable'), // settling with her
      account('andi', 'Andi', 'payable', 'liability'),
    ];

    expect(transferTargets(accounts, values).map((row) => row.id)).toEqual(['bca', 'house', 'card', 'kpr', 'dewi', 'andi']);
  });
});
