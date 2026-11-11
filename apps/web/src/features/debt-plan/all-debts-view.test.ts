import { describe, expect, it } from 'vitest';
import { readings, TODAY } from './plan-fixtures';
import { planDebts } from './plan-inputs';
import { allDebtsSubtitle, chipCounts, filterDebts, readSort, sortDebts, writeSort } from './all-debts-view';

const debts = planDebts(readings(), TODAY);
const keys = (list: { key: string }[]) => list.map((d) => d.key);

describe('chips and filters', () => {
  it('counts every debt, the active, the late and the paid off', () => {
    expect(chipCounts(debts)).toEqual({ all: 5, active: 4, late: 1, paidOff: 1 });
  });
  it('filters', () => {
    expect(keys(filterDebts(debts, 'late'))).toEqual(['L1']);
    expect(keys(filterDebts(debts, 'paidOff'))).toEqual(['L3']);
    expect(filterDebts(debts, 'active')).toHaveLength(4);
    expect(filterDebts(debts, 'all')).toHaveLength(5);
  });
});

describe('sortDebts', () => {
  it('most left first, paid off always last', () => {
    // The dollar loan Rp 16.250.000, BCA Visa 6.214.300, Kredit 3.120.400, Dewi 850.000; then the paid-off Bank.
    expect(keys(sortDebts(debts, 'mostLeft'))).toEqual(['L2', 'C1', 'L1', 'person:Dewi:IDR', 'L3']);
    expect(keys(sortDebts(debts, 'leastLeft'))).toEqual(['person:Dewi:IDR', 'L1', 'C1', 'L2', 'L3']);
  });
  it('highest rate puts unknown rates after the known ones', () => {
    const order = keys(sortDebts(debts, 'highestRate'));
    expect(order[0]).toBe('L1');
    expect(order.indexOf('L2')).toBe(3);
    expect(order.at(-1)).toBe('L3');
  });
  it('ends soonest, then by name', () => {
    expect(keys(sortDebts(debts, 'endsSoonest'))[0]).toBe('L1');
    expect(keys(sortDebts(debts, 'name'))).toEqual(['C1', 'person:Dewi:IDR', 'L2', 'L1', 'L3']);
  });
});

describe('allDebtsSubtitle', () => {
  const by = (key: string) => debts.find((d) => d.key === key)!;
  it('each kind in its own words', () => {
    expect(allDebtsSubtitle(by('L1'), TODAY)).toMatch(/^Late · \d+% repaid · 3 of 6 paid$/);
    expect(allDebtsSubtitle(by('C1'), TODAY)).toBe('Statement due 18 Nov');
    expect(allDebtsSubtitle(by('person:Dewi:IDR'), TODAY)).toBe('Lend & borrow · due 3 Dec');
    expect(allDebtsSubtitle(by('L2'), TODAY)).toBe('0% repaid · No terms yet');
    expect(allDebtsSubtitle(by('L3'), TODAY)).toBe('Sep 2026');
  });
  it('a loan on time: repaid share and the month it ends', () => {
    const onTime = planDebts(readings({ loanFacts: [{ ...readings().loanFacts[0]!, instalments: readings().loanFacts[0]!.instalments.map((i) => ({ ...i, status: 'paid' as const })) }] }), TODAY).find((d) => d.key === 'L1')!;
    expect(allDebtsSubtitle(onTime, TODAY)).toMatch(/^\d+% repaid · ends Jan 2027$/);
  });
  it('a person with no due date', () => {
    const r = readings();
    const p = { ...r.people.youOwe[0]!, loans: r.people.youOwe[0]!.loans.map((l) => ({ ...l, dueOn: null })) };
    const dewi = planDebts(readings({ people: { ...r.people, youOwe: [p] } }), TODAY).find((d) => d.kind === 'person')!;
    expect(allDebtsSubtitle(dewi, TODAY)).toBe('Lend & borrow · no fixed months');
  });
});

describe('the sort kept on the device', () => {
  it('reads what was written, and falls back when storage refuses', () => {
    const store = new Map<string, string>();
    const storage = { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v) };
    expect(readSort(storage)).toBe('mostLeft');
    writeSort('name', storage);
    expect(readSort(storage)).toBe('name');
    const broken = {
      getItem: () => {
        throw new Error('blocked');
      },
      setItem: () => {
        throw new Error('blocked');
      },
    };
    expect(readSort(broken)).toBe('mostLeft');
    expect(() => writeSort('name', broken)).not.toThrow();
    store.set('debt-plan.sort', 'nonsense');
    expect(readSort(storage)).toBe('mostLeft');
  });
});
