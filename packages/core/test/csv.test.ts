import { describe, expect, it } from 'vitest';
import { detectDelimiter, mapCsvRows, parseCsv, parseCsvAmount, parseCsvDate } from '../src/import/csv';

describe('parseCsv', () => {
  it('handles quotes, escaped quotes, CRLF, BOM, and blank lines', () => {
    const text = '﻿Date,Description,Amount\r\n2026-09-01,"Superindo, Kemang",500000\r\n\r\n2026-09-02,"He said ""hi""",-20\n';
    expect(parseCsv(text)).toEqual([
      ['Date', 'Description', 'Amount'],
      ['2026-09-01', 'Superindo, Kemang', '500000'],
      ['2026-09-02', 'He said "hi"', '-20'],
    ]);
    expect(detectDelimiter('a;b;c\n1;2;3')).toBe(';');
  });
});

describe('dates and amounts', () => {
  it('parses supported date formats and rejects impossible dates', () => {
    expect(parseCsvDate('2026-09-01', 'YYYY-MM-DD')).toBe('2026-09-01');
    expect(parseCsvDate('01/09/2026', 'DD/MM/YYYY')).toBe('2026-09-01');
    expect(parseCsvDate('09/01/26', 'MM/DD/YYYY')).toBe('2026-09-01');
    expect(() => parseCsvDate('31/02/2026', 'DD/MM/YYYY')).toThrow('not a real date');
  });
  it('parses bank-style amounts', () => {
    expect(parseCsvAmount('Rp 1.250.000', 'IDR')).toBe(1_250_000);
    expect(parseCsvAmount('(12.50)', 'USD')).toBe(-1250);
    expect(parseCsvAmount('1.234,56 CR', 'USD')).toBe(-123456);
    expect(parseCsvAmount('', 'IDR')).toBeNull();
  });
});

describe('mapCsvRows', () => {
  it('maps a card export with positive charges and dedupes identical rows by occurrence', () => {
    const rows = parseCsv('Date,Merchant,Amount\n2026-09-01,Kopi Kenangan,25000\n2026-09-01,Kopi  Kenangan,25000\n2026-09-03,Payment,-1000000\nbad,Row,1\n');
    const result = mapCsvRows(rows, { hasHeader: true, dateColumn: 0, dateFormat: 'YYYY-MM-DD', descriptionColumn: 1, amountColumn: 2, negativeIsOutflow: false, outflowColumn: null, inflowColumn: null }, 'IDR');
    expect(result.rows.map((r) => [r.occurredOn, r.description, r.amountMinor, r.externalRef])).toEqual([
      ['2026-09-01', 'Kopi Kenangan', 25000, 'csv:2026-09-01|25000|kopi kenangan|0'],
      ['2026-09-01', 'Kopi Kenangan', 25000, 'csv:2026-09-01|25000|kopi kenangan|1'],
      ['2026-09-03', 'Payment', -1_000_000, 'csv:2026-09-03|-1000000|payment|0'],
    ]);
    expect(result.errors).toEqual([{ rowNumber: 5, message: '"bad" is not YYYY-MM-DD' }]);
  });

  it('maps a bank export with separate debit and credit columns', () => {
    const rows = parseCsv('01/09/2026;Transfer in;;5.000.000\n02/09/2026;ATM;500.000;\n', ';');
    const result = mapCsvRows(rows, { hasHeader: false, dateColumn: 0, dateFormat: 'DD/MM/YYYY', descriptionColumn: 1, amountColumn: null, negativeIsOutflow: true, outflowColumn: 2, inflowColumn: 3 }, 'IDR');
    expect(result.rows.map((r) => r.amountMinor)).toEqual([-5_000_000, 500_000]);
  });
});
