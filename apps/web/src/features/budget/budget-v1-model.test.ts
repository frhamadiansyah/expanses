import { describe, expect, it } from 'vitest';
import type { DeskRow } from './budget-desk-model';
import { leftWords, needCards, planGroups } from './budget-v1-model';
import type { EditRow } from './edit-budgets-model';

const row = (over: Partial<DeskRow>): DeskRow =>
  ({ key: `line:${over.categoryId}`, kind: 'line', section: 'budgeted', label: over.categoryId, name: over.categoryId, depth: 0, groupId: null, budgetMinor: 100, spentMinor: 40, leftMinor: 60, share: 0.4, tone: 'ok', percent: null, frequency: 'monthly', overridden: false, edit: null, ...over }) as DeskRow;

describe('needCards', () => {
  it('puts each budgeted line under what its category counts as, Essential when unmarked, in the table order', () => {
    const cards = needCards(
      [row({ categoryId: 'groceries' }), row({ categoryId: 'restaurants' }), row({ categoryId: 'savings' }), row({ categoryId: 'transport' })],
      { restaurants: 'lifestyle', savings: 'debts_savings' },
    );
    expect(cards.map((card) => [card.title, card.rows.map((r) => r.categoryId)])).toEqual([
      ['Essential', ['groceries', 'transport']],
      ['Lifestyle', ['restaurants']],
      ['Debts & savings', ['savings']],
    ]);
  });
  it('leaves out group rows, rows with no budget, and a part with nothing budgeted', () => {
    const cards = needCards(
      [row({ categoryId: 'food', kind: 'group' }), row({ categoryId: 'books', section: 'none', budgetMinor: null, leftMinor: null }), row({ categoryId: 'zero', budgetMinor: 0 }), row({ categoryId: 'gym' })],
      { gym: 'lifestyle' },
    );
    expect(cards.map((card) => card.title)).toEqual(['Lifestyle']);
  });
});

describe('leftWords', () => {
  const money = (minor: number) => `Rp ${minor}`;
  it('says left, or over when below nought', () => {
    expect(leftWords(880, money)).toEqual({ text: 'Rp 880 left', over: false });
    expect(leftWords(0, money)).toEqual({ text: 'Rp 0 left', over: false });
    expect(leftWords(-110, money)).toEqual({ text: 'Rp 110 over', over: true });
  });
});

describe('planGroups', () => {
  const edit = (id: string): EditRow => ({ id, label: id, name: id, depth: 0, parentId: null, hasChildren: false });
  it('groups Edit plan rows the three ways, keeping their order', () => {
    const groups = planGroups([edit('a'), edit('b'), edit('c')], { b: 'debts_savings' });
    expect(groups.map((group) => [group.title, group.rows.map((r) => r.id)])).toEqual([
      ['Essential', ['a', 'c']],
      ['Debts & savings', ['b']],
    ]);
  });
});
