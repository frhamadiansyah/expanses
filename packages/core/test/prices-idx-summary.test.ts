/// <reference types="node" />
import { readFileSync } from 'node:fs';
import { inflateRawSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { idxDate, parseIdxRows, readIdxSummary } from '../src/index';

/** Five rows of IDX's Ringkasan Saham for 29 Sep 2026, cut from the real file with every other part kept. */
const fixture = new Uint8Array(readFileSync(new URL('./fixtures/ringkasan-saham-20260929.xlsx', import.meta.url)));
const inflate = async (bytes: Uint8Array) => new Uint8Array(inflateRawSync(bytes));

describe('IDX’s daily file', () => {
  it('reads each share’s close and the trading day', async () => {
    const summary = await readIdxSummary(fixture, inflate);
    expect(summary.tradeDate).toBe('2026-09-29');
    expect(Object.fromEntries(summary.closes)).toEqual({ ASII: 4700, BBCA: 6150, BBRI: 3170, BMRI: 4030, TLKM: 2370 });
  });

  it('finds the columns by their header, wherever they are', () => {
    const rows = [
      ['Penutupan', 'Tanggal Perdagangan Terakhir', 'Extra', ' kode  saham '],
      ['6150', '29 Sep 2026', 'x', 'bbca'],
      ['0', '29 Sep 2026', 'x', 'NOPE'],
    ];
    expect(parseIdxRows(rows)).toEqual({ tradeDate: '2026-09-29', closes: new Map([['BBCA', 6150]]) });
  });

  it('takes the day most rows carry, so a suspended share’s older date does not move it', () => {
    const rows = [
      ['Kode Saham', 'Tanggal Perdagangan Terakhir', 'Penutupan'],
      ['AAAA', '12 Aug 2026', '50'],
      ['BBCA', '29 Sep 2026', '6150'],
      ['BBRI', '29 Sep 2026', '3170'],
    ];
    expect(parseIdxRows(rows).tradeDate).toBe('2026-09-29');
  });

  it('says plainly when the headers are not there', async () => {
    expect(() => parseIdxRows([['Ticker', 'Close'], ['BBCA', '6150']])).toThrow("This doesn't look like IDX's Ringkasan Saham file");
    await expect(readIdxSummary(new TextEncoder().encode('not a zip'), inflate)).rejects.toThrow(/Ringkasan Saham/);
  });

  it('reads the dates IDX writes', () => {
    expect(idxDate('29 Sep 2026')).toBe('2026-09-29');
    expect(idxDate('1 Agu 2026')).toBe('2026-08-01');
    expect(idxDate('2026-09-29')).toBe('2026-09-29');
    expect(idxDate('46294')).toBe('2026-09-29');
    expect(idxDate('someday')).toBeNull();
  });
});
