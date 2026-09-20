import { describe, expect, it } from 'vitest';
import { ROW_PAD_X, textWidth } from './metrics';
import { iconTint, moneyTone, planRow } from './row';

describe('moneyTone', () => {
  it('alarms on money that left, whatever sign it is stored with', () => {
    expect(moneyTone(899_000, 'out')).toBe('alarm');
    expect(moneyTone(-899_000, 'out')).toBe('alarm');
  });

  it('tints money that arrived', () => {
    expect(moneyTone(18_500_000, 'in')).toBe('tint');
  });

  it('leaves a neutral figure in the label ink until it goes below zero', () => {
    expect(moneyTone(712_500_000)).toBe('ink');
    expect(moneyTone(0)).toBe('ink');
    expect(moneyTone(-1)).toBe('alarm');
  });
});

describe('planRow', () => {
  it('starts a separator at the text, not at the row’s edge, when there is no icon', () => {
    expect(planRow({ title: 'Superindo' }).separatorInset).toBe(ROW_PAD_X);
  });

  it('pushes the separator past a leading icon', () => {
    expect(planRow({ icon: true, title: 'Superindo' }).separatorInset).toBe(51);
  });

  it('leaves the words everything the furniture did not take', () => {
    const bare = planRow({ title: 'Superindo' });
    const dressed = planRow({ icon: true, title: 'Superindo', value: 'Rp 184.000', chevron: true });
    expect(bare.textWidth).toBe(364);
    expect(dressed.textWidth).toBeLessThan(bare.textWidth);
  });

  it('reserves the trailing figure its full natural width at 15px, so it is never the thing that shrinks', () => {
    const plan = planRow({ title: 'Superindo', value: 'Rp 184.000' });
    expect(plan.valueWidth).toBe(83);
    expect(plan.valueWidth).toBe(textWidth('Rp 184.000', 15));
  });

  it('calls a row overflowing when a long merchant name has outrun the width left to it', () => {
    expect(planRow({ icon: true, title: 'Superindo Bintaro', value: 'Rp 184.000', chevron: true }).overflowing).toBe(false);
    expect(
      planRow({
        icon: true,
        title: 'Tokopedia — Samsung Galaxy S24 Ultra 512GB Titanium Gray',
        value: 'Rp 21.999.000',
        chevron: true,
      }).overflowing,
    ).toBe(true);
  });

  it('calls a short title overflowing anyway once its column is under a readable width', () => {
    // "Fee" fits in 84px twice over, but 84px is not a column a title can live in, so the row says so.
    expect(planRow({ title: 'Fee' }, 110).overflowing).toBe(true);
    expect(planRow({ title: 'Fee' }, 130).overflowing).toBe(false);
  });

  it('calls a row overflowing when the figure alone has left the words under a readable width', () => {
    // A 12-place KWD figure beside an icon and a chevron on a 200px column: the words have nowhere left to go.
    expect(planRow({ icon: true, title: 'Rent', value: 'KD 1.234.567,890', chevron: true }, 200).overflowing).toBe(true);
  });
});

describe('iconTint', () => {
  it('washes the category’s own colour rather than reaching for a second palette', () => {
    const tint = iconTint('#1d4ed8');
    expect(tint.foreground).toBe('#1d4ed8');
    expect(tint.background).toBe('color-mix(in srgb, #1d4ed8 12%, transparent)');
  });
});
