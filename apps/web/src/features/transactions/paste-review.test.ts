import { parsePurchaseList } from '@expanses/core';
import type { AccountRow } from '@expanses/db';
import { describe, expect, it } from 'vitest';
import { addedText, canSave, dateRowMode, dayGroups, purchaseInputs, readingKey, reviewCounts, reviewHeader, reviewLabel, reviewRowsFrom, saveLabel, sections, totalMinor, withEdit, withRemoved } from './paste-review';

const account = (id: string, kind: AccountRow['kind'], subtype: AccountRow['subtype'], currency: string | null): AccountRow => ({
  id, workspaceId: 'ws', parentId: null, kind, subtype, name: id, icon: null, currency, valuationMode: 'derived', systemKey: null, sortOrder: 0, archivedAt: null, createdAt: '2026-09-01T00:00:00Z',
});
const accounts = [
  account('bank', 'asset', 'bank', 'IDR'),
  account('card', 'liability', 'credit_card', 'IDR'),
  account('wise', 'asset', 'bank', 'USD'),
  account('transport', 'expense', 'category', null),
  account('food', 'expense', 'category', null),
  account('uncat', 'expense', 'category', null),
];

const TEXT = 'gocar 18000\nyoshinoya 249000\ntaxi bluebird 25000\ncatering 90000';
const rowsOf = (text: string, guesses = {}) => reviewRowsFrom(parsePurchaseList(text, { today: '2026-10-28' }), '2026-10-28', guesses);

describe('the review rows', () => {
  it('start from the parsed lines, with the guessed category and the page date', () => {
    const rows = rowsOf(TEXT, { 1: 'transport', 3: 'transport' });
    expect(rows.map((r) => [r.lineNo, r.note, r.amountMinor, r.categoryId, r.occurredOn, r.flagged])).toEqual([
      [1, 'gocar', 18_000, 'transport', '2026-10-28', false],
      [2, 'yoshinoya', 249_000, '', '2026-10-28', false],
      [3, 'taxi bluebird', 25_000, 'transport', '2026-10-28', false],
      [4, 'catering', 90_000, '', '2026-10-28', false],
    ]);
  });

  it('take the day of a date line over the page date, and flag a doubtful figure', () => {
    const rows = rowsOf('gocar 18000\n26/10\nkopi 2\nparkir');
    expect(rows.map((r) => [r.note, r.occurredOn, r.flagged, r.amountMinor])).toEqual([
      ['gocar', '2026-10-28', false, 18_000],
      ['kopi', '2026-10-26', true, 2],
      ['parkir', '2026-10-26', false, null],
    ]);
  });
});

describe('counts, readiness and the total', () => {
  it('count every line, those with an amount, and those still without a category', () => {
    const rows = rowsOf(`${TEXT}\nparkir`, { 1: 'transport' });
    expect(reviewCounts(rows)).toEqual({ total: 5, ready: 4, unread: 1, needCategory: 3 });
    expect(reviewHeader(rows)).toBe('4 of 5 lines ready');
    expect(canSave(rows)).toBe(false);
  });

  it('are ready once every line has an amount, whatever the categories', () => {
    const rows = rowsOf(TEXT);
    expect(canSave(rows)).toBe(true);
    expect(reviewHeader(rows)).toBe('4 lines');
    expect(saveLabel(rows)).toBe('Save 4');
    expect(totalMinor(rows)).toBe(382_000);
  });

  it('say "1 line" for one line, and are never ready with none', () => {
    const rows = rowsOf('gocar 18000');
    expect(reviewHeader(rows)).toBe('1 line');
    expect(canSave([])).toBe(false);
    expect(reviewLabel(4)).toBe('Review 4');
    expect(addedText(1)).toBe('Added 1 purchase');
    expect(addedText(4)).toBe('Added 4 purchases');
  });

  it('split into rows with an amount and rows to read, in the order written', () => {
    const { read, unread } = sections(rowsOf('a 100\nb\nc 300\nd'));
    expect(read.map((r) => r.note)).toEqual(['a', 'c']);
    expect(unread.map((r) => r.note)).toEqual(['b', 'd']);
  });

  it('follow a fix: an amount typed for a line that had none, a row removed, a category chosen', () => {
    let rows = rowsOf('gocar 18000\nparkir');
    expect(canSave(rows)).toBe(false);
    rows = withEdit(rows, 2, { amountMinor: 5_000 });
    expect(canSave(rows)).toBe(true);
    expect(totalMinor(rows)).toBe(23_000);
    rows = withEdit(rows, 1, { categoryId: 'transport', flagged: false });
    expect(rows[0]!.categoryId).toBe('transport');
    rows = withRemoved(rows, 2);
    expect(rows.map((r) => r.lineNo)).toEqual([1]);
    expect(totalMinor(rows)).toBe(18_000);
    // Removing the last unread line is what lets Save through.
    expect(canSave(withRemoved(rowsOf('gocar 18000\nparkir'), 2))).toBe(true);
  });

  it('keep a reading apart from another by the text, payer and date', () => {
    expect(readingKey('a', 'bank', '2026-10-28')).toBe(readingKey('a', 'bank', '2026-10-28'));
    expect(readingKey('a', 'bank', '2026-10-28')).not.toBe(readingKey('a b', 'bank', '2026-10-28'));
    expect(readingKey('a', 'bank', '2026-10-28')).not.toBe(readingKey('a', 'card', '2026-10-28'));
    expect(readingKey('a', 'bank', '2026-10-28')).not.toBe(readingKey('a', 'bank', '2026-10-27'));
  });
});

describe('what is posted', () => {
  const lines = (input: ReturnType<typeof purchaseInputs>[number]) => input.lines.map((l) => [l.accountId, l.amountMinor]);

  it('is one ordinary expense per row, paid from the chosen account, in Uncategorised when no category is chosen', () => {
    const rows = rowsOf(TEXT, { 1: 'transport' });
    const inputs = purchaseInputs(rows, { account: accounts[0]!, cardId: null }, accounts, 'uncat', () => undefined);
    expect(inputs.map((i) => [i.description, i.occurredOn, i.cardId])).toEqual([
      ['gocar', '2026-10-28', null],
      ['yoshinoya', '2026-10-28', null],
      ['taxi bluebird', '2026-10-28', null],
      ['catering', '2026-10-28', null],
    ]);
    expect(lines(inputs[0]!)).toEqual([['transport', 18_000], ['bank', -18_000]]);
    expect(lines(inputs[1]!)).toEqual([['uncat', 249_000], ['bank', -249_000]]);
    expect(inputs.every((i) => i.lines.reduce((sum, l) => sum + l.amountMinor, 0) === 0)).toBe(true);
  });

  it('keeps the card on a card payment, and the day of each line', () => {
    const rows = rowsOf('26/10\ngocar 18000\n27/10\nkopi 12000', { 1: 'transport' });
    const inputs = purchaseInputs(rows, { account: accounts[1]!, cardId: 'c1' }, accounts, 'uncat', () => undefined);
    expect(inputs.map((i) => [i.occurredOn, i.cardId])).toEqual([['2026-10-26', 'c1'], ['2026-10-27', 'c1']]);
  });

  it('carries the day\'s rates for a payer in another currency', () => {
    const rows = reviewRowsFrom(parsePurchaseList('lunch 12,5', { today: '2026-10-28', currency: 'USD' }), '2026-10-28');
    const inputs = purchaseInputs(rows, { account: accounts[2]!, cardId: null }, accounts, 'uncat', (day) => (day === '2026-10-28' ? { USD: 16_000 } : undefined));
    expect(lines(inputs[0]!)).toEqual([['uncat', 1_250], ['wise', -1_250]]);
    expect(inputs[0]!.ratesToBase).toEqual({ USD: 16_000 });
  });

  it('refuses a row with no amount', () => {
    expect(() => purchaseInputs(rowsOf('parkir'), { account: accounts[0]!, cardId: null }, accounts, 'uncat', () => undefined)).toThrow(/Line 1/);
  });
});

describe('dateRowMode', () => {
  const mode = (text: string) => dateRowMode(parsePurchaseList(text, { today: '2026-10-28' }));
  it('is none for an empty text or a list with no date', () => {
    expect(mode('')).toBe('none');
    expect(mode('kopi 11000\nteh 3000')).toBe('none');
  });
  it('is all when every line has a date from the list', () => {
    expect(mode('21okt kopi 11000\nteh 3000')).toBe('some');
    expect(mode('21okt\nkopi 11000\nteh 3000')).toBe('all');
    expect(mode('21okt kopi 11000\n22 okt teh 3000')).toBe('all');
  });
  it('is some when a line comes before the first date', () => {
    expect(mode('kopi 11000\n21okt\nteh 3000')).toBe('some');
  });
});

describe('dayGroups', () => {
  const rows = reviewRowsFrom(parsePurchaseList('kopi 11000\n21 okt\nnasi 22000\nteh 3000\nparkir\n20 okt\nsate 44000', { today: '2026-10-28' }), '2026-10-27');
  it('groups by each row\'s own day, oldest first, with the page date for undated lines', () => {
    const groups = dayGroups(rows);
    expect(groups.map((g) => g.date)).toEqual(['2026-10-20', '2026-10-21', '2026-10-27']);
    expect(groups.map((g) => g.rows.map((r) => r.note))).toEqual([['sate'], ['nasi', 'teh', 'parkir'], ['kopi']]);
  });
  it('totals the amounts of a day and leaves out rows without one', () => {
    expect(dayGroups(rows).map((g) => g.totalMinor)).toEqual([44000, 25000, 11000]);
  });
  it('marks only the lines that took the page date', () => {
    expect(rows.map((r) => r.noListDate)).toEqual([true, false, false, false, false]);
  });
});
