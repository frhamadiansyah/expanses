import { describe, expect, it } from 'vitest';
import { findRows, findSpans, foundLine, replaceAll, replaceAssignments } from './find-replace';
import { groupRows } from './group-rows';

/* Find and replace, and Group by, on the Mac tables (owner 2026-11-25). Invented rows. */

describe('find and replace', () => {
  const rows = [
    { id: 'a', text: 'GrabRide' },
    { id: 'b', text: 'grab food' },
    { id: 'c', text: 'Apotek Contoh' },
    { id: 'd', text: 'Grab Grab' },
  ];

  it('finds the words in any case, every place they are', () => {
    expect(findSpans('Grab Grab', 'grab')).toEqual([
      [0, 4],
      [5, 9],
    ]);
    expect(findSpans('GrabRide', '  ')).toEqual([]);
    expect(findSpans('a.b', '.')).toEqual([[1, 2]]);
    expect(findRows(rows, 'GRAB')).toEqual(['a', 'b', 'd']);
  });

  it('replaces the words inside a note, every place, any case', () => {
    expect(replaceAll('Grab Grab', 'grab', 'Gojek')).toBe('Gojek Gojek');
    expect(replaceAll('GrabRide', 'Grab', '$&')).toBe('$&Ride');
    expect(replaceAssignments(rows, 'description', 'grab', 'Gojek')).toEqual([
      { id: 'a', column: 'description', text: 'GojekRide' },
      { id: 'b', column: 'description', text: 'Gojek food' },
      { id: 'd', column: 'description', text: 'Gojek Gojek' },
    ]);
  });

  it('gives a category or a payment method the new name whole', () => {
    const named = [
      { id: 'a', text: 'Ride hailing' },
      { id: 'b', text: 'Takeaways' },
    ];
    expect(replaceAssignments(named, 'category', 'ride', 'Transport')).toEqual([{ id: 'a', column: 'category', text: 'Transport' }]);
  });

  it('says how many it found, and how many of them are picked', () => {
    expect(foundLine(6, 3)).toBe('6 found · 3 on picked rows');
    expect(foundLine(6, 1)).toBe('6 found · 1 on picked row');
    expect(foundLine(2, 0)).toBe('2 found');
    expect(foundLine(0, 0)).toBe('No match');
  });
});

describe('group by', () => {
  type Row = { id: string; cat: string; date: string; minor: number };
  const rows: Row[] = [
    { id: '1', cat: 'Ride hailing', date: '2026-09-03', minor: 38_000 },
    { id: '2', cat: 'Takeaways', date: '2026-09-05', minor: 92_500 },
    { id: '3', cat: 'Ride hailing', date: '2026-09-09', minor: 24_000 },
    { id: '4', cat: 'Takeaways', date: '2026-09-05', minor: 118_000 },
  ];
  const figure = (row: Row) => ({ minor: row.minor, currency: 'IDR' });

  it('groups by category, largest total first, each with its rows in the table’s order, its count and its sum', () => {
    const groups = groupRows(rows, 'category', (row) => ({ key: row.cat, label: row.cat }), figure, 'IDR');
    expect(groups.map((group) => group.label)).toEqual(['Takeaways', 'Ride hailing']);
    expect(groups[0]!.rows.map((row) => row.id)).toEqual(['2', '4']);
    expect(groups[0]!.sum).toEqual({ count: 2, minor: 210_500, currency: 'IDR' });
    expect(groups[1]!.sum).toEqual({ count: 2, minor: 62_000, currency: 'IDR' });
  });

  it('groups by day along the calendar, newest first when the table reads so, an undated row last', () => {
    const dated = [...rows, { id: '5', cat: 'x', date: '', minor: 1 }];
    const key = (row: Row) => ({ key: row.date, label: row.date || 'No date' });
    expect(groupRows(dated, 'day', key, figure, 'IDR').map((group) => group.key)).toEqual(['2026-09-03', '2026-09-05', '2026-09-09', '']);
    expect(groupRows(dated, 'day', key, figure, 'IDR', true).map((group) => group.key)).toEqual(['2026-09-09', '2026-09-05', '2026-09-03', '']);
  });
});
