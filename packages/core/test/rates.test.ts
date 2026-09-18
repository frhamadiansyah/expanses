import { describe, expect, it } from 'vitest';
import { pickRate } from '../src/index';

const rows = [
  { onDate: '2026-08-01', rate: 11_800 },
  { onDate: '2026-09-01', rate: 12_050 },
  { onDate: '2026-08-15', rate: 11_900 },
];

describe('pickRate', () => {
  it('takes the rate of the day when there is one', () => {
    expect(pickRate(rows, '2026-08-15')).toEqual({ onDate: '2026-08-15', rate: 11_900 });
  });

  it('falls back to the latest earlier day, whatever order the rows arrive in', () => {
    expect(pickRate(rows, '2026-08-20')).toEqual({ onDate: '2026-08-15', rate: 11_900 });
    expect(pickRate(rows, '2026-12-31')).toEqual({ onDate: '2026-09-01', rate: 12_050 });
  });

  it('has nothing to say before the first rate it holds', () => {
    expect(pickRate(rows, '2026-07-31')).toBeNull();
    expect(pickRate([], '2026-08-15')).toBeNull();
  });
});
