import { describe, expect, it } from 'vitest';
import { capturedDayOf, findDateTime } from '../src/index';

describe('findDateTime', () => {
  it.each([
    ['29 Sep 2026 08:12', '2026-09-29T08:12'],
    ['29/09/2026 08:12', '2026-09-29T08:12'],
    ['2026-09-29 08:12:05', '2026-09-29T08:12'],
    ['29 September 2026', '2026-09-29'],
    ['Sep 29, 2026, 8:12 PM', '2026-09-29T20:12'],
    ['29 Sept 2026', '2026-09-29'],
    ['29 Okt 2026', '2026-10-29'],
    ['1 Des 2026', '2026-12-01'],
    ['Transaksi berhasil pada 03 Agu 2026 pukul 14:05', '2026-08-03T14:05'],
    ['no date here', null],
    ['Saldo Rp1.212.000', null],
    ['30 Feb 2026', null],
    ['31/04/2026', null],
    ['29 Feb 2026', null],
    ['29 Feb 2028', '2028-02-29'],
    ['31 Okt 2026', '2026-10-31'],
  ])('%s', (text, iso) => expect(findDateTime(text)).toBe(iso));
});

describe('capturedDayOf', () => {
  it('takes the day from the offset the capture was stamped with', () => {
    // 06:30 in the morning at +07:00 is still the 30th there, whatever UTC says.
    expect(capturedDayOf('2026-09-30T06:30:00+07:00')).toBe('2026-09-30');
    expect(capturedDayOf('2026-09-30T23:30:00-05:00')).toBe('2026-09-30');
    expect(capturedDayOf('2026-09-30T06:30:00.000+0700')).toBe('2026-09-30');
  });

  it('reads a UTC stamp as the day on this device', () => {
    const iso = '2026-09-29T23:30:00Z';
    const local = new Date(iso);
    const expected = `${local.getFullYear()}-${String(local.getMonth() + 1).padStart(2, '0')}-${String(local.getDate()).padStart(2, '0')}`;
    expect(capturedDayOf(iso)).toBe(expected);
  });

  it('leaves a bare date alone', () => expect(capturedDayOf('2026-09-30')).toBe('2026-09-30'));
});
