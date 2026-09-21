import { describe, expect, it } from 'vitest';
import { emptyDraft, needsEstimate, needsPurchases, type NewAssetDraft, planNewAsset } from './add-asset';

const TODAY = '2026-09-12';

const goldDraft = (overrides: Partial<NewAssetDraft> = {}): NewAssetDraft => ({
  ...emptyDraft('gold', 'IDR', TODAY),
  name: 'Antam gold bars',
  purchases: [
    { occurredOn: '2024-02-03', units: '10', cost: '13.100.000' },
    { occurredOn: '2026-03-09', units: '5', cost: '9.300.000' },
  ],
  ...overrides,
});

const houseDraft = (overrides: Partial<NewAssetDraft> = {}): NewAssetDraft => ({
  ...emptyDraft('property', 'IDR', TODAY),
  name: 'House in Bintaro',
  purchasedOn: '2021-03-25',
  cost: '1.150.000.000',
  estimate: '1.420.000.000',
  estimateBasis: 'appraisal',
  ...overrides,
});

describe('the item chosen decides the profile written', () => {
  it('keeps what the eight old kinds always did', () => {
    const plan = planNewAsset(
      { ...emptyDraft('gold', 'IDR', '2026-09-18'), name: 'Antam gold bars', purchases: [{ occurredOn: '2024-02-03', units: '10', cost: '13100000' }] },
      '2026-09-18',
    );
    expect(plan.profile).toMatchObject({ assetKind: 'gold', coretaxSection: 'lainnya', coretaxCode: '0701', planGroup: 'invest', unitKind: 'grams', acquiredYear: 2024 });
    expect(plan.account.subtype).toBe('investment');
  });

  it('files an apartment under land and buildings, valued by what the owner says', () => {
    const plan = planNewAsset(
      { ...emptyDraft('apartment', 'IDR', '2026-09-18'), name: 'Apartemen Taman Anggrek', purchasedOn: '2021-06-01', cost: '1150000000', estimate: '1420000000' },
      '2026-09-18',
    );
    expect(plan.profile).toMatchObject({ assetKind: 'property', coretaxSection: 'tidak_bergerak', coretaxCode: '0503', planGroup: 'use', acquiredYear: 2021 });
    expect(plan.account.subtype).toBe('property');
    expect(plan.valuation).toMatchObject({ valueMinor: 1_420_000_000, basis: 'estimate' });
  });

  it('files unlisted shares under investments, valued by what the owner says', () => {
    const plan = planNewAsset({ ...emptyDraft('unlisted_stock', 'IDR', '2026-09-18'), name: 'PT Keluarga', purchasedOn: '2023-01-10', cost: '200000000' }, '2026-09-18');
    expect(plan.profile).toMatchObject({ assetKind: 'other', coretaxSection: 'investasi', coretaxCode: '0302', planGroup: 'invest' });
    expect(plan.account.subtype).toBe('investment');
  });

  it('records anything under Something else as a thing with a value, in the table its family files under', () => {
    const plan = planNewAsset({ ...emptyDraft('else:0409', 'IDR', '2026-09-18'), name: 'Kapal nelayan', purchasedOn: '2025-05-05', cost: '80000000' }, '2026-09-18');
    expect(plan.profile).toMatchObject({ assetKind: 'vehicle', coretaxSection: 'bergerak', coretaxCode: '0409', planGroup: 'use' });
  });

  it('weighs gold jewellery in grams, or takes a value when the owner would rather type one', () => {
    const grams = planNewAsset(
      { ...emptyDraft('gold_jewellery', 'IDR', '2026-09-18'), name: 'Kalung', purchases: [{ occurredOn: '2025-01-01', units: '25', cost: '35000000' }] },
      '2026-09-18',
    );
    expect(grams.profile).toMatchObject({ assetKind: 'gold', coretaxCode: '0702', unitKind: 'grams' });
    expect(grams.trades).toHaveLength(1);

    const typed = planNewAsset(
      { ...emptyDraft('gold_jewellery', 'IDR', '2026-09-18'), name: 'Kalung', typedInstead: true, purchasedOn: '2025-01-01', cost: '35000000', estimate: '40000000' },
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
    const plan = planNewAsset(goldDraft({ purchases: [{ occurredOn: TODAY, units: '', cost: '' }, { occurredOn: '2026-03-09', units: '5', cost: '9.300.000' }] }), TODAY);
    expect(plan.trades).toHaveLength(1);
  });

  it('puts a property cost on the account and the estimate in its own row', () => {
    const plan = planNewAsset(houseDraft(), TODAY);

    expect(plan.account).toMatchObject({ subtype: 'property', openingBalanceMinor: 1_150_000_000, openedOn: '2021-03-25' });
    expect(plan.trades).toEqual([]);
    expect(plan.valuation).toEqual({ asOf: TODAY, valueMinor: 1_420_000_000, basis: 'appraisal' });
    expect(plan.profile).toMatchObject({ coretaxSection: 'tidak_bergerak', coretaxCode: '0502', acquiredYear: 2021 });
  });

  it('keeps only the Coretax fields that were filled in', () => {
    const plan = planNewAsset(houseDraft({ coretaxFields: { loc: 'Jl. Contoh Raya No. 12', land: '120', cert: '  ' } }), TODAY);
    expect(plan.profile!.coretaxFields).toEqual({ loc: 'Jl. Contoh Raya No. 12', land: '120' });
  });

  it('says what is missing, in plain words', () => {
    expect(() => planNewAsset(goldDraft({ name: '  ' }), TODAY)).toThrow('Give this asset a name');
    expect(() => planNewAsset(goldDraft({ purchases: [{ occurredOn: '2026-03-09', units: '5', cost: '' }] }), TODAY)).toThrow(/how much you bought and what it cost/);
    expect(() => planNewAsset(goldDraft({ purchases: [{ occurredOn: '2027-01-01', units: '5', cost: '1.000' }] }), TODAY)).toThrow(/after today/);
    expect(() => planNewAsset(goldDraft({ purchases: [{ occurredOn: '2026-03-09', units: '0', cost: '1.000' }] }), TODAY)).toThrow(/more than zero units/);
  });

  it('allows a holding with nothing bought yet', () => {
    const plan = planNewAsset(goldDraft({ purchases: [{ occurredOn: TODAY, units: '', cost: '' }] }), TODAY);
    expect(plan.trades).toEqual([]);
    expect(plan.profile!.acquiredYear).toBeNull();
  });
});

describe('the rate an asset opens at', () => {
  it('is no longer read by a parser of its own: planNewAsset hands the typed text on untouched', () => {
    // A motorcycle is valued by a figure you type, so its cost is the opening balance (the `draft.cost` branch).
    const plan = planNewAsset({ ...emptyDraft('motorcycle', 'IDR', '2026-09-21'), name: 'Bike bought abroad', currency: 'USD', cost: '1000.00', purchasedOn: '2026-09-01', openingRate: '16.500' }, '2026-09-21');
    // `openingRateFor` reads it with parseRate (16,5, which ratePreview shows before saving) — not 16500 as before.
    expect(plan).not.toHaveProperty('openingRateToBase');
    expect([plan.rateNeededMinor, plan.rateDate]).toEqual([100_000, '2026-09-01']);
  });

  it('needs a rate for the purchases, dated at the earliest one', () => {
    const plan = planNewAsset(
      {
        ...emptyDraft('stock', 'IDR', '2026-09-21'),
        name: 'US shares',
        currency: 'USD',
        purchases: [
          { occurredOn: '2026-05-02', units: '10', cost: '150.25' },
          { occurredOn: '2026-03-01', units: '5', cost: '70.10' },
        ],
      },
      '2026-09-21',
    );
    expect([plan.rateNeededMinor, plan.rateDate]).toEqual([22_035, '2026-03-01']);
  });
});
