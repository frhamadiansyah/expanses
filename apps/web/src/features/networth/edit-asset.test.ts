import { describe, expect, it } from 'vitest';
import { type AssetEditStart, planAssetEdit } from './edit-asset';

const TODAY = '2026-10-19';

const car: AssetEditStart = {
  name: 'Passenger car',
  acquired: { year: '2021', month: '3', day: '' },
  section: 'bergerak',
  fields: { model: 'Hatchback 1.5', plate: 'X 1234 YZ' },
};

describe('Save on an asset’s Edit screen', () => {
  it('writes nothing when nothing changed', () => {
    expect(planAssetEdit(car, { ...car }, TODAY)).toEqual({ rename: null, acquired: null, fields: null });
  });

  it('renames, trimmed', () => {
    expect(planAssetEdit(car, { ...car, name: '  Family car ' }, TODAY).rename).toBe('Family car');
  });

  it('moves when it was acquired, at the precision now typed', () => {
    expect(planAssetEdit(car, { ...car, acquired: { year: '2021', month: '', day: '' } }, TODAY).acquired).toEqual({ on: '2021-01-01', precision: 'year' });
    expect(planAssetEdit(car, { ...car, acquired: { year: '2021', month: '3', day: '9' } }, TODAY).acquired).toEqual({ on: '2021-03-09', precision: 'day' });
  });

  it('leaves the acquired day alone for a holding dated by its purchases', () => {
    const gold = { ...car, acquired: null };
    expect(planAssetEdit(gold, { ...gold, name: 'Gold' }, TODAY).acquired).toBeNull();
  });

  it('saves the tax fields as typed, a field emptied dropped', () => {
    expect(planAssetEdit(car, { ...car, fields: { model: 'Hatchback 1.5', plate: '  ', own: 'Sendiri' } }, TODAY).fields).toEqual({ model: 'Hatchback 1.5', own: 'Sendiri' });
  });

  it('refuses what does not hold, in plain words', () => {
    expect(() => planAssetEdit(car, { ...car, name: ' ' }, TODAY)).toThrow('Give this asset a name');
    expect(() => planAssetEdit(car, { ...car, acquired: { year: '', month: '', day: '' } }, TODAY)).toThrow('Say the year it was acquired');
    expect(() => planAssetEdit(car, { ...car, acquired: { year: '2027', month: '', day: '' } }, TODAY)).toThrow(/after today/);
    expect(() => planAssetEdit(car, { ...car, fields: { ...car.fields, ownerNpwp: '12' } }, TODAY)).toThrow();
  });
});
