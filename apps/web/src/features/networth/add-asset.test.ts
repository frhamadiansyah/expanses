import { describe, expect, it } from 'vitest';
import { byMoneyItem, emptyBuy, emptyDraft, emptyPurchase, needsEstimate, needsPurchases, type NewAssetDraft, planNewAsset } from './add-asset';

/** A whole day, typed to the day. */
const day = (iso: string) => ({ year: iso.slice(0, 4), month: String(Number(iso.slice(5, 7))), day: String(Number(iso.slice(8, 10))) });

const TODAY = '2026-09-12';

const goldDraft = (overrides: Partial<NewAssetDraft> = {}): NewAssetDraft => ({
  ...emptyDraft('gold', 'IDR', TODAY), when: 'past',
  name: 'Antam gold bars',
  purchases: [
    { on: day('2024-02-03'), units: '10', cost: '13.100.000' },
    { on: day('2026-03-09'), units: '5', cost: '9.300.000' },
  ],
  ...overrides,
});

const houseDraft = (overrides: Partial<NewAssetDraft> = {}): NewAssetDraft => ({
  ...emptyDraft('property', 'IDR', TODAY),
  name: 'House in Bintaro',
  acquired: day('2021-03-25'),
  cost: '1.150.000.000',
  estimate: '1.420.000.000',
  ...overrides,
});

describe('the item chosen decides the profile written', () => {
  it('keeps what the eight old kinds always did', () => {
    const plan = planNewAsset(
      { ...emptyDraft('gold', 'IDR', '2026-09-18'), when: 'past', name: 'Antam gold bars', purchases: [{ on: day('2024-02-03'), units: '10', cost: '13100000' }] },
      '2026-09-18',
    );
    expect(plan.profile).toMatchObject({ assetKind: 'gold', coretaxSection: 'lainnya', coretaxCode: '0701', planGroup: 'invest', unitKind: 'grams', acquiredYear: 2024 });
    expect(plan.account.subtype).toBe('investment');
  });

  it('files an apartment under land and buildings, valued by what the owner says', () => {
    const plan = planNewAsset(
      { ...emptyDraft('apartment', 'IDR', '2026-09-18'), name: 'Apartemen Taman Anggrek', acquired: day('2021-06-01'), cost: '1150000000', estimate: '1420000000' },
      '2026-09-18',
    );
    expect(plan.profile).toMatchObject({ assetKind: 'property', coretaxSection: 'tidak_bergerak', coretaxCode: '0503', planGroup: 'use', acquiredYear: 2021 });
    expect(plan.account.subtype).toBe('property');
    expect(plan.valuation).toMatchObject({ valueMinor: 1_420_000_000, basis: 'estimate' });
  });

  it('files unlisted shares under investments, valued by what the owner says', () => {
    const plan = planNewAsset({ ...emptyDraft('unlisted_stock', 'IDR', '2026-09-18'), name: 'PT Keluarga', acquired: day('2023-01-10'), cost: '200000000' }, '2026-09-18');
    expect(plan.profile).toMatchObject({ assetKind: 'other', coretaxSection: 'investasi', coretaxCode: '0302', planGroup: 'invest' });
    expect(plan.account.subtype).toBe('investment');
  });

  it('records anything under Something else as a thing with a value, in the table its family files under', () => {
    const plan = planNewAsset({ ...emptyDraft('else:0409', 'IDR', '2026-09-18'), name: 'Kapal nelayan', acquired: day('2025-05-05'), cost: '80000000' }, '2026-09-18');
    expect(plan.profile).toMatchObject({ assetKind: 'vehicle', coretaxSection: 'bergerak', coretaxCode: '0409', planGroup: 'use' });
  });

  it('weighs gold jewellery in grams, or takes a value when the owner would rather type one', () => {
    const grams = planNewAsset(
      { ...emptyDraft('gold_jewellery', 'IDR', '2026-09-18'), when: 'past', name: 'Kalung', purchases: [{ on: day('2025-01-01'), units: '25', cost: '35000000' }] },
      '2026-09-18',
    );
    expect(grams.profile).toMatchObject({ assetKind: 'gold', coretaxCode: '0702', unitKind: 'grams' });
    expect(grams.trades).toHaveLength(1);

    const typed = planNewAsset(
      { ...emptyDraft('gold_jewellery', 'IDR', '2026-09-18'), when: 'past', name: 'Kalung', typedInstead: true, acquired: day('2025-01-01'), cost: '35000000', estimate: '40000000' },
      '2026-09-18',
    );
    expect(typed.profile).toMatchObject({ assetKind: 'other', coretaxCode: '0702', coretaxSection: 'lainnya', unitKind: null });
    expect(typed.trades).toHaveLength(0);
    expect(typed.valuation).toMatchObject({ valueMinor: 40_000_000 });
  });

  it('sends a receivable to the ledger rather than giving it a profile of its own', () => {
    const plan = planNewAsset({ ...emptyDraft('trade_receivable', 'IDR', '2026-09-18'), name: 'PT Sejahtera', personName: 'PT Sejahtera', cost: '25000000' }, '2026-09-18');
    expect(plan.person).toMatchObject({ direction: 'lent', personName: 'PT Sejahtera', coretaxCode: '0201', balanceMinor: 25_000_000 });
    expect(plan.profile).toBeNull();
  });
});

describe('what each kind asks for', () => {
  it('asks holdings for past purchases and property for an estimate', () => {
    expect(needsPurchases('gold')).toBe(true);
    expect(needsPurchases('fund')).toBe(true);
    expect(needsPurchases('property')).toBe(false);
    expect(needsEstimate('property')).toBe(true);
    expect(needsEstimate('vehicle')).toBe(true);
    expect(needsEstimate('gold')).toBe(false);
    expect(needsEstimate('cash')).toBe(false);
  });

  it('starts a holding with one empty purchase row and property with none', () => {
    expect(emptyDraft('gold', 'IDR', TODAY).purchases).toHaveLength(1);
    expect(emptyDraft('property', 'IDR', TODAY).purchases).toHaveLength(0);
  });
});

describe('planNewAsset', () => {
  it('turns past purchases into opening positions and keeps the bank balance out of it', () => {
    const plan = planNewAsset(goldDraft(), TODAY);

    expect(plan.account).toMatchObject({ name: 'Antam gold bars', subtype: 'investment', currency: 'IDR', openingBalanceMinor: 0 });
    expect(plan.trades).toEqual([
      { occurredOn: '2024-02-03', unitsMicro: 10_000_000, grossMinor: 13_100_000 },
      { occurredOn: '2026-03-09', unitsMicro: 5_000_000, grossMinor: 9_300_000 },
    ]);
    expect(plan.profile).toMatchObject({ assetKind: 'gold', coretaxSection: 'lainnya', coretaxCode: '0701', acquiredYear: 2024 });
    expect(plan.valuation).toBeNull();
  });

  it('skips purchase rows left blank', () => {
    const plan = planNewAsset(goldDraft({ purchases: [emptyPurchase(), { on: day('2026-03-09'), units: '5', cost: '9.300.000' }] }), TODAY);
    expect(plan.trades).toHaveLength(1);
  });

  it('puts a property cost on the account and the estimate in its own row', () => {
    const plan = planNewAsset(houseDraft(), TODAY);

    expect(plan.account).toMatchObject({ subtype: 'property', openingBalanceMinor: 1_150_000_000, openedOn: '2021-03-25' });
    expect(plan.trades).toEqual([]);
    expect(plan.valuation).toEqual({ asOf: TODAY, valueMinor: 1_420_000_000, basis: 'estimate' });
    expect(plan.acquired).toEqual({ on: '2021-03-25', precision: 'day' });
    expect(plan.profile).toMatchObject({ coretaxSection: 'tidak_bergerak', coretaxCode: '0502', acquiredYear: 2021 });
  });

  it('takes a year alone, or a year and month, filling the rest with the start of it', () => {
    const year = planNewAsset(houseDraft({ acquired: { year: '2021', month: '', day: '' } }), TODAY);
    expect(year.account.openedOn).toBe('2021-01-01');
    expect(year.acquired).toEqual({ on: '2021-01-01', precision: 'year' });
    expect(year.profile!.acquiredYear).toBe(2021);

    const month = planNewAsset(houseDraft({ acquired: { year: '2021', month: '3', day: '' } }), TODAY);
    expect(month.account.openedOn).toBe('2021-03-01');
    expect(month.acquired).toEqual({ on: '2021-03-01', precision: 'month' });
  });

  it('keeps the year even when no cost is given yet', () => {
    const plan = planNewAsset(houseDraft({ cost: '', acquired: { year: '2019', month: '', day: '' } }), TODAY);
    expect(plan.account.openingBalanceMinor).toBe(0);
    expect(plan.profile!.acquiredYear).toBe(2019);
    expect(plan.acquired).toEqual({ on: '2019-01-01', precision: 'year' });
  });

  it('dates a holding by its earliest purchase, at the precision that one was typed', () => {
    const plan = planNewAsset(
      goldDraft({
        purchases: [
          { on: { year: '2025', month: '6', day: '' }, units: '5', cost: '9.300.000' },
          { on: { year: '2023', month: '', day: '' }, units: '10', cost: '13.100.000' },
        ],
      }),
      TODAY,
    );
    expect(plan.trades.map((trade) => trade.occurredOn)).toEqual(['2025-06-01', '2023-01-01']);
    expect(plan.acquired).toEqual({ on: '2023-01-01', precision: 'year' });
    expect(plan.profile!.acquiredYear).toBe(2023);
  });

  it('opens money owed today, with no date asked', () => {
    const plan = planNewAsset({ ...emptyDraft('trade_receivable', 'IDR', TODAY), name: 'PT Sejahtera', cost: '25000000' }, TODAY);
    expect(plan.account.openedOn).toBe(TODAY);
    expect(plan.acquired).toBeNull();
  });

  it('says what is missing, in plain words', () => {
    expect(() => planNewAsset(goldDraft({ name: '  ' }), TODAY)).toThrow('Give this asset a name');
    expect(() => planNewAsset(goldDraft({ purchases: [{ on: day('2026-03-09'), units: '5', cost: '' }] }), TODAY)).toThrow(/how much was bought and what it cost/);
    expect(() => planNewAsset(goldDraft({ purchases: [{ on: day('2027-01-01'), units: '5', cost: '1.000' }] }), TODAY)).toThrow(/after today/);
    expect(() => planNewAsset(houseDraft({ acquired: { year: '', month: '', day: '' } }), TODAY)).toThrow('Say the year it was acquired');
    expect(() => planNewAsset(goldDraft({ purchases: [{ on: day('2026-03-09'), units: '0', cost: '1.000' }] }), TODAY)).toThrow(/more than zero units/);
  });

  it('allows a holding with nothing bought yet', () => {
    const plan = planNewAsset(goldDraft({ purchases: [emptyPurchase()] }), TODAY);
    expect(plan.trades).toEqual([]);
    expect(plan.profile!.acquiredYear).toBeNull();
  });
});

describe('the rate an asset opens at', () => {
  it('is no longer read by a parser of its own: planNewAsset hands the typed text on untouched', () => {
    // A motorcycle is valued by a figure you type, so its cost is the opening balance (the `draft.cost` branch).
    const plan = planNewAsset({ ...emptyDraft('motorcycle', 'IDR', '2026-09-21'), name: 'Bike bought abroad', currency: 'USD', cost: '1000.00', acquired: day('2026-09-01'), openingRate: '16.500' }, '2026-09-21');
    // `openingRateFor` reads it with parseRate (16,5, which ratePreview shows before saving) — not 16500 as before.
    expect(plan).not.toHaveProperty('openingRateToBase');
    expect([plan.rateNeededMinor, plan.rateDate]).toEqual([100_000, '2026-09-01']);
  });

  it('needs a rate for the purchases, dated at the earliest one', () => {
    const plan = planNewAsset(
      {
        ...emptyDraft('stock', 'IDR', '2026-09-21'), when: 'past',
        name: 'US shares',
        currency: 'USD',
        purchases: [
          { on: day('2026-05-02'), units: '10', cost: '150.25' },
          { on: day('2026-03-01'), units: '5', cost: '70.10' },
        ],
      },
      '2026-09-21',
    );
    expect([plan.rateNeededMinor, plan.rateDate]).toEqual([22_035, '2026-03-01']);
  });
});

describe('a mutual fund, tracked by money', () => {
  const fundDraft = (purchases: { units: string; cost: string }[], estimate = '') => ({
    ...emptyDraft('fund', 'IDR', '2026-10-19'), when: 'past' as const,
    name: 'Sucor Money Market',
    purchases: purchases.map((p) => ({ on: { year: '2026', month: '8', day: '1' }, ...p })),
    estimate,
  });

  it('is bought by amount: units are optional and a current value becomes its first typed value', () => {
    expect(byMoneyItem('fund')).toBe(true);
    const plan = planNewAsset(fundDraft([{ units: '', cost: '1.000.000' }], '1.052.000'), '2026-10-19');
    expect(plan.trades).toEqual([{ occurredOn: '2026-08-01', unitsMicro: 0, grossMinor: 1_000_000 }]);
    expect(plan.valuation).toEqual({ asOf: '2026-10-19', valueMinor: 1_052_000, basis: 'estimate' });
  });

  it('keeps units when the owner knows them', () => {
    const plan = planNewAsset(fundDraft([{ units: '10', cost: '1.000.000' }]), '2026-10-19');
    expect(plan.trades[0]!.unitsMicro).toBe(10_000_000);
  });

  it('asks for the amount when only units are typed', () => {
    expect(() => planNewAsset(fundDraft([{ units: '10', cost: '' }]), '2026-10-19')).toThrow('Each purchase needs the amount put in');
  });

  it('still asks shares for both units and cost', () => {
    expect(byMoneyItem('stock')).toBe(false);
  });
});

describe('a new purchase, paid now', () => {
  /* Invented figures: a bond bought today on a card, through a marketplace. */
  const bondDraft = (buy: Partial<NewAssetDraft['buy']> = {}, overrides: Partial<NewAssetDraft> = {}): NewAssetDraft => {
    const draft = emptyDraft('bond', 'IDR', TODAY);
    return { ...draft, name: 'ORI031', ...overrides, buy: { ...draft.buy, units: '7.000.000', cost: '7.000.000', moneyId: 'bank', ...buy } };
  };
  const bank = { cashCurrency: 'IDR', isCard: false };
  const card = { cashCurrency: 'IDR', isCard: true };

  it('is what adding a holding starts on, dated today', () => {
    expect(emptyDraft('bond', 'IDR', TODAY).when).toBe('new');
    expect(emptyDraft('gold', 'IDR', TODAY).when).toBe('new');
    expect(emptyDraft('bond', 'IDR', TODAY).buy.on).toBe(TODAY);
    expect(emptyBuy(TODAY)).toMatchObject({ on: TODAY, units: '', cost: '', fee: '', moneyId: '' });
  });

  it('gives the buy Trade records, paid from the account chosen, and no opening positions', () => {
    const plan = planNewAsset(bondDraft({ fee: '15.000' }), TODAY, bank);
    expect(plan.trades).toEqual([]);
    expect(plan.buy).toEqual({
      kind: 'buy', occurredOn: TODAY, unitsMicro: 7_000_000_000_000, grossMinor: 7_000_000, feeMinor: 15_000, taxMinor: 0, cashAccountId: 'bank', goalId: null,
    });
    expect(plan.account.openingBalanceMinor).toBe(0);
    expect(plan.acquired).toEqual({ on: TODAY, precision: 'day' });
    expect(plan.profile).toMatchObject({ assetKind: 'bond', acquiredYear: 2026 });
    // Nothing posts against Opening Balances, so the opening asks no rate.
    expect(plan.rateNeededMinor).toBe(0);
  });

  it('carries the category for points and the MCC when a card pays', () => {
    const plan = planNewAsset(bondDraft({ moneyId: 'visa', spendCategoryId: 'investments', mcc: ' 6211 ' }), TODAY, card);
    expect(plan.buy).toMatchObject({ cashAccountId: 'visa', spendCategoryId: 'investments', mcc: '6211' });
  });

  it('drops the card facts when a bank account pays', () => {
    const plan = planNewAsset(bondDraft({ spendCategoryId: 'investments', mcc: '6211' }), TODAY, bank);
    expect(plan.buy).not.toHaveProperty('spendCategoryId');
    expect(plan.buy).not.toHaveProperty('mcc');
  });

  it('asks what was charged when the paying account is in another currency, as Trade does', () => {
    const usd = (charged: string) => planNewAsset(bondDraft({ moneyId: 'jenius', charged }, { currency: 'USD', name: 'US Treasury' }), TODAY, bank);
    expect(() => usd('')).toThrow('Charged in IDR');
    expect(usd('1.650.000').buy).toMatchObject({ cashMinor: 1_650_000, grossMinor: 700_000_000 });
  });

  it('never sells, and only ever records one buy', () => {
    const plan = planNewAsset(bondDraft(), TODAY, bank);
    expect(plan.buy!.kind).toBe('buy');
  });

  it('says what is missing, in Trade’s words', () => {
    expect(() => planNewAsset(bondDraft({ moneyId: '' }), TODAY, bank)).toThrow('Choose what paid for it');
    expect(() => planNewAsset(bondDraft({ cost: '' }), TODAY, bank)).toThrow('Enter what it cost, before fees');
    expect(() => planNewAsset(bondDraft({ units: '' }), TODAY, bank)).toThrow(/how many units/);
    expect(() => planNewAsset(bondDraft({ on: '2027-01-01' }), TODAY, bank)).toThrow(/after today/);
  });

  it('buys a fund tracked by money by amount, its units optional', () => {
    const draft = emptyDraft('fund', 'IDR', TODAY);
    const plan = planNewAsset({ ...draft, name: 'Money market fund', buy: { ...draft.buy, cost: '2.500.000', moneyId: 'bank' } }, TODAY, bank);
    expect(plan.buy).toMatchObject({ unitsMicro: 0, grossMinor: 2_500_000 });
  });

  it('leaves Past purchase exactly as it was: opening positions, no buy', () => {
    const plan = planNewAsset(goldDraft(), TODAY, bank);
    expect(plan.buy).toBeNull();
    expect(plan.trades).toHaveLength(2);
  });

  it('leaves the buy off anything that is not a holding', () => {
    expect(planNewAsset(houseDraft(), TODAY, bank).buy).toBeNull();
  });
});
