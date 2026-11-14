import type { GoalLinkRow } from '@expanses/db';
import { describe, expect, it } from 'vitest';
import { fundingGroups } from './goal-sharing';
import { fundingLines, type FundingLine } from './funding-lines';

// Invented names and figures: a multicurrency account "Kas Valas" with three pockets, and two plain accounts.
const accounts = [
  { id: 'valas', name: 'Kas Valas', kind: 'asset' as const, parentId: null },
  { id: 'valas-idr', name: 'Kas Valas · IDR', kind: 'asset' as const, parentId: 'valas' },
  { id: 'valas-usd', name: 'Kas Valas · USD', kind: 'asset' as const, parentId: 'valas' },
  { id: 'valas-sar', name: 'Kas Valas · SAR', kind: 'asset' as const, parentId: 'valas' },
  { id: 'harian', name: 'Tabungan Harian', kind: 'asset' as const, parentId: null },
  { id: 'emas', name: 'Emas 7 g', kind: 'asset' as const, parentId: null },
  { id: 'dompet', name: 'Dompet Jalan', kind: 'asset' as const, parentId: null },
  { id: 'dompet-eur', name: 'Dompet Jalan · EUR', kind: 'asset' as const, parentId: 'dompet' },
];

function link(accountId: string, over: Partial<GoalLinkRow> = {}): GoalLinkRow {
  return {
    goalId: 'g1',
    accountId,
    name: accounts.find((account) => account.id === accountId)?.name ?? accountId,
    kind: 'earmark',
    unitsMicro: null,
    valueMinor: 0,
    currency: 'IDR',
    risk: null,
    baseMinor: 0,
    goalMinor: 0,
    overBalance: false,
    promisedMinor: null,
    shortMinor: 0,
    ...over,
  };
}

const idr = link('valas-idr', { valueMinor: 13_000_000, goalMinor: 13_000_000 });
const harian = link('harian', { valueMinor: 9_000_000, goalMinor: 9_000_000 });
const usd = link('valas-usd', { currency: 'USD', valueMinor: 870_00, goalMinor: 13_920_000 });
const sar = link('valas-sar', { currency: 'SAR', valueMinor: 1_400_00, goalMinor: 5_810_000, shortMinor: 250_00, overBalance: true });
const emas = link('emas', { kind: 'tagged', unitsMicro: 7_000_000, valueMinor: 11_340_000, goalMinor: 11_340_000 });

const shape = (lines: FundingLine[]) => lines.map((line) => (line.type === 'link' ? line.link.accountId : [line.accountId, line.children.map((child) => child.code)]));

describe('fundingLines', () => {
  it('folds a multicurrency account into one row where it first appears, its currencies under it', () => {
    const lines = fundingLines([idr, harian, usd, sar, emas], accounts, 'IDR');
    expect(shape(lines)).toEqual([['valas', ['IDR', 'USD', 'SAR']], 'harian', 'emas']);
    const valas = lines[0]!;
    if (valas.type !== 'account') throw new Error('not folded');
    expect(valas.name).toBe('Kas Valas');
    expect(valas.goalMinor).toBe(13_000_000 + 13_920_000 + 5_810_000);
    expect(valas.approx).toBe(true);
    // The account is short because one of its currencies is; only that currency says so.
    expect(valas.short).toBe(true);
    expect(valas.children.map((child) => child.short)).toEqual([false, false, true]);
    expect(valas.children[2]!.link).toBe(sar);
  });

  it('leaves single-currency rows as they were, and a tagged holding is never short', () => {
    const lines = fundingLines([harian, emas, link('harian', { kind: 'tagged', shortMinor: 5 })], accounts, 'IDR');
    expect(lines.map((line) => line.type)).toEqual(['link', 'link', 'link']);
    expect(lines.map((line) => line.short)).toEqual([false, false, false]);
    expect(fundingLines([link('harian', { shortMinor: 100 })], accounts, 'IDR')[0]!.short).toBe(true);
  });

  it('keeps a lone pocket as its own row under its own name', () => {
    const lines = fundingLines([link('dompet-eur', { currency: 'EUR', valueMinor: 300_00, goalMinor: 5_340_000 }), harian], accounts, 'IDR');
    expect(shape(lines)).toEqual(['dompet-eur', 'harian']);
    expect(lines[0]!.type === 'link' && lines[0]!.link.name).toBe('Dompet Jalan · EUR');
  });

  it('adds only the currencies that convert; one with no rate still makes the figure approximate', () => {
    const lines = fundingLines([idr, link('valas-usd', { currency: 'USD', valueMinor: 870_00, goalMinor: null })], accounts, 'IDR');
    const valas = lines[0]!;
    if (valas.type !== 'account') throw new Error('not folded');
    expect(valas.goalMinor).toBe(13_000_000);
    expect(valas.approx).toBe(true);
    expect(valas.short).toBe(false);
  });

  it('is exact when every currency is the goal\'s own', () => {
    // A goal kept in dollars.
    const lines = fundingLines([link('valas-usd', { currency: 'USD', goalMinor: 100_00 }), link('valas-usd', { currency: 'USD', kind: 'tagged', goalMinor: 50_00 })], accounts, 'USD');
    // Two lines on one pocket are one currency: no account row that opens to the same currency twice.
    expect(lines.map((line) => line.type)).toEqual(['link', 'link']);
    const both = fundingLines([link('valas-usd', { currency: 'USD', goalMinor: 100_00 }), link('valas-usd', { currency: 'USD', kind: 'tagged', goalMinor: 50_00 }), link('valas-idr', { goalMinor: 20_00 })], accounts, 'USD');
    const valas = both[0]!;
    if (valas.type !== 'account') throw new Error('not folded');
    expect(valas.goalMinor).toBe(170_00);
    // The rupiah pocket is converted into dollars, so the figure is approximate after all.
    expect(valas.approx).toBe(true);
    expect(valas.children.map((child) => child.key)).toEqual(['valas-usd-earmark-me', 'valas-usd-tagged-me', 'valas-idr-earmark-me']);
    const dollarsOnly = fundingLines([link('valas-usd', { currency: 'USD', goalMinor: 100_00 }), link('valas-sar', { currency: 'USD', goalMinor: 30_00 })], accounts, 'USD')[0]!;
    expect(dollarsOnly.type === 'account' && dollarsOnly.approx).toBe(false);
  });

  it('folds inside each member group of a shared goal, and never folds another member\'s lines', () => {
    const theirs = [link('valas-usd', { owner: 'member-a', currency: 'IDR', goalMinor: 2_000_000 }), link('valas-sar', { owner: 'member-a', currency: 'IDR', goalMinor: 1_000_000 })];
    const groups = fundingGroups([idr, usd, harian, ...theirs], [{ memberId: 'member-a', name: 'Sari' }], 'member-b');
    const shaped = groups.map((group) => [group.label, shape(fundingLines(group.links, accounts, 'IDR'))]);
    expect(shaped).toEqual([
      ['Me', [['valas', ['IDR', 'USD']], 'harian']],
      ['Sari', ['valas-usd', 'valas-sar']],
    ]);
  });
});
