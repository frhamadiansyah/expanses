import { describe, expect, it } from 'vitest';
import { backLabel, type CornerAction, LARGE_TITLE_FITS, planCornerActions, titleSteps } from './title';

const search: CornerAction = { key: 'search', label: 'Search' };
const add: CornerAction = { key: 'add', label: 'Add a transaction' };
const select: CornerAction = { key: 'select', label: 'Select several' };
const remove: CornerAction = { key: 'delete', label: 'Delete', destructive: true };

describe('planCornerActions', () => {
  it('leaves an empty corner empty', () => {
    expect(planCornerActions([])).toEqual({ inline: [], overflow: [] });
  });

  it('gives one and two actions a corner each, and opens no menu', () => {
    expect(planCornerActions([search])).toEqual({ inline: [search], overflow: [] });
    expect(planCornerActions([search, add])).toEqual({ inline: [search, add], overflow: [] });
  });

  it('counts the … as one of the two, so three actions are one button and a menu of two', () => {
    expect(planCornerActions([search, add, select])).toEqual({ inline: [search], overflow: [add, select] });
  });

  it('keeps the corner at two buttons however many actions arrive', () => {
    const plan = planCornerActions([search, add, select, remove]);
    expect(plan.inline).toHaveLength(1);
    expect(plan.inline.length + (plan.overflow.length > 0 ? 1 : 0)).toBe(2);
    expect(plan.overflow).toEqual([add, select, remove]);
  });

  it('lets a wider screen hold more corners before it reaches for a menu', () => {
    expect(planCornerActions([search, add, select], 3)).toEqual({ inline: [search, add, select], overflow: [] });
  });
});

describe('backLabel', () => {
  it('names where back goes, not the word “Back”, and keeps the chevron with the name', () => {
    expect(backLabel('All cards')).toBe('‹ All cards');
  });
});

describe('titleSteps', () => {
  it('keeps a short title at the large size', () => {
    expect(titleSteps('Cards & points')).toBe(false);
    expect(titleSteps('x'.repeat(LARGE_TITLE_FITS))).toBe(false);
  });

  it('steps a name longer than a phone line down a size', () => {
    expect(titleSteps('BCA KrisFlyer Visa Signature')).toBe(true);
    expect(titleSteps('x'.repeat(LARGE_TITLE_FITS + 1))).toBe(true);
  });
});
