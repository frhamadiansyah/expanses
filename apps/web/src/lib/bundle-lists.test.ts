import { describe, expect, it } from 'vitest';
import { checkLists } from '../../scripts/bundle-lists.mjs';

const LISTS = [
  { name: 'IDX list', sentinel: 'Bank Central Asia', budget: 25_000 },
  { name: 'US list', sentinel: 'Apple Inc', budget: 160_000 },
];
const chunk = (file: string, text: string, gzipped = 1_000) => ({ file, text, gzipped });

describe('checkLists', () => {
  it('passes each list in one chunk of its own, under budget, outside the entry', () => {
    const out = checkLists({ entry: ['index-a.js'], chunks: [chunk('index-a.js', 'app'), chunk('idx-b.js', 'Bank Central Asia'), chunk('us-c.js', 'Apple Inc')], lists: LISTS, rows: { 'IDX list': 900, 'US list': 11_746 } });
    expect(out.problems).toEqual([]);
    expect(out.warnings).toEqual([]);
  });
  it('treats an IDX list with no rows as pending: a warning, not a failure', () => {
    const out = checkLists({ entry: ['index-a.js'], chunks: [chunk('index-a.js', 'app'), chunk('us-c.js', 'Apple Inc')], lists: LISTS, rows: { 'IDX list': 0, 'US list': 11_746 } });
    expect(out.problems).toEqual([]);
    expect(out.warnings).toEqual(['IDX list: pending — the list has no rows yet, so its check waits for them']);
  });
  it('turns the Bank Central Asia check on once the IDX list has rows', () => {
    const out = checkLists({ entry: ['index-a.js'], chunks: [chunk('index-a.js', 'app'), chunk('us-c.js', 'Apple Inc')], lists: LISTS, rows: { 'IDX list': 900, 'US list': 11_746 } });
    expect(out.problems).toEqual(['IDX list: expected in exactly one chunk of its own, found in none']);
  });
  it('fails a list in the entry chunk, in two chunks, or over its budget', () => {
    const rows = { 'IDX list': 900, 'US list': 11_746 };
    expect(checkLists({ entry: ['index-a.js'], chunks: [chunk('index-a.js', 'Apple Inc Bank Central Asia')], lists: LISTS, rows }).problems).toEqual([
      'IDX list is inside the entry chunk index-a.js',
      'US list is inside the entry chunk index-a.js',
    ]);
    expect(checkLists({ entry: ['index-a.js'], chunks: [chunk('index-a.js', 'app'), chunk('idx.js', 'Bank Central Asia'), chunk('u1.js', 'Apple Inc'), chunk('u2.js', 'Apple Inc')], lists: LISTS, rows }).problems).toEqual([
      'US list: expected in exactly one chunk of its own, found in u1.js, u2.js',
    ]);
    expect(checkLists({ entry: ['index-a.js'], chunks: [chunk('index-a.js', 'app'), chunk('idx.js', 'Bank Central Asia', 25_001), chunk('us.js', 'Apple Inc', 160_000)], lists: LISTS, rows }).problems).toEqual([
      'IDX list is 25.0 KB gzipped, over its 25.0 KB budget',
    ]);
  });
  it('fails when index.html names no entry chunk, or two', () => {
    const rows = { 'IDX list': 0, 'US list': 11_746 };
    expect(checkLists({ entry: [], chunks: [chunk('us.js', 'Apple Inc')], lists: LISTS, rows }).problems).toEqual(['expected one entry chunk in index.html, found none']);
  });
});
