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
    expect(plan.profile.coretaxFields).toEqual({ loc: 'Jl. Contoh Raya No. 12', land: '120' });
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
    expect(plan.profile.acquiredYear).toBeNull();
  });
});
