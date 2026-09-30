import { describe, expect, it } from 'vitest';
import { findDateTime } from '../src/index';

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
  ])('%s', (text, iso) => expect(findDateTime(text)).toBe(iso));
});
