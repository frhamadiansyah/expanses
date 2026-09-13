import { DEFAULT_CATEGORY_KEYS } from '@expanses/core';
import { describe, expect, it } from 'vitest';
import { describeEntry, diffCatalogEntries, findEntry, planCatalogApply, validateEntry } from '../src/index';
import type { CatalogEntry } from '../src/types';

const unionpay = (): CatalogEntry => structuredClone(findEntry('bca-unionpay')!);
const ids = Object.fromEntries([...DEFAULT_CATEGORY_KEYS].map((key) => [key, `id:${key}`]));

describe('MCC rules in catalogue entries', () => {
  it('rejects malformed MCC codes and ranges', () => {
    const entry = unionpay();
    entry.terms[0]!.rules[0]!.match.mccs = ['5812', '581'];
    entry.terms[0]!.rules[1]!.match.excludeMccs = ['3300-3000'];
    const errors = validateEntry(entry, DEFAULT_CATEGORY_KEYS);
    expect(errors.some((e) => e.includes('rules[0].match.mccs')), errors.join(' | ')).toBe(true);
    expect(errors.some((e) => e.includes('rules[1].match.excludeMccs')), errors.join(' | ')).toBe(true);
    entry.terms[0]!.rules[0]!.match.mccs = ['5812', '3000-3299'];
    entry.terms[0]!.rules[1]!.match.excludeMccs = ['5814'];
    expect(validateEntry(entry, DEFAULT_CATEGORY_KEYS)).toEqual([]);
  });

  it('rejects an unknown crediting', () => {
    const entry = unionpay();
    (entry.program as { crediting?: string }).crediting = 'daily';
    expect(validateEntry(entry, DEFAULT_CATEGORY_KEYS).some((e) => e.startsWith('program.crediting'))).toBe(true);
  });

  it('plans MCC conditions and crediting, defaulting to per statement', () => {
    const entry = unionpay();
    entry.terms[0]!.rules[0]!.match.excludeMccs = ['5814', '3000-3299'];
    entry.terms[0]!.rules[1]!.match.mccs = ['5812'];
    const plan = planCatalogApply(entry, ids, '2026-09-11');
    expect(plan.rules[0]!.match.excludeMccs).toEqual(['5814', '3000-3299']);
    expect(plan.rules[1]!.match.mccs).toEqual(['5812']);
    expect(plan.crediting).toBe('per_statement');
    entry.program.crediting = 'per_transaction';
    expect(planCatalogApply(entry, ids, '2026-09-11').crediting).toBe('per_transaction');
  });

  it('describes MCC exclusions by name, ranges by bounds, and per-purchase crediting', () => {
    const entry = unionpay();
    for (const rule of entry.terms[0]!.rules) rule.match.excludeMccs = ['5814'];
    entry.terms[0]!.rules[1]!.match.mccs = ['3000-3299'];
    entry.program.crediting = 'per_transaction';
    const lines = describeEntry(entry, '2026-09-11').lines.join('\n');
    expect(lines).toMatch(/Earns nothing on Fees & charges; MCC 5814 Fast Food Restaurants\./);
    expect(lines).toMatch(/at MCC 3000–3299/);
    expect(lines).toMatch(/credited per purchase/);
  });

  it('reports MCC and crediting changes', () => {
    const before = unionpay();
    const after = unionpay();
    after.terms[0]!.rules[0]!.match.excludeMccs = ['5814'];
    after.program.crediting = 'per_transaction';
    expect(diffCatalogEntries(before, after)).toEqual(['Points now credited per purchase instead of per statement.', 'Base: now excludes MCC 5814 Fast Food Restaurants.']);
  });
});
