import { DEFAULT_CATEGORY_KEYS } from '@expanses/core';
import { describe, expect, it } from 'vitest';
import { type AppliedCategoryChoice, planCatalogApply } from '../src/plan';
import type { CatalogEntry } from '../src/types';
import { validateEntry } from '../src/validate';

/** A card that pays double on one category the holder picks from a menu, changeable each cycle. */
const withChoice = (): CatalogEntry => ({
  id: 'choice-card',
  entryVersion: 1,
  bank: 'Test Bank',
  name: 'Choice Card',
  network: 'visa',
  currency: 'IDR',
  program: {
    unit: 'points',
    name: 'Test Points',
    cycleAnchor: 'statement',
    categoryChoice: {
      key: 'double',
      name: 'Double category',
      changeable: 'once a billing cycle',
      options: [
        { key: 'dining', name: 'Food & Beverages', match: { categoryKeys: ['food_beverage.restaurants'] } },
        { key: 'groceries', name: 'Groceries', match: { categoryKeys: ['household.groceries'] } },
      ],
    },
  },
  fees: [],
  terms: [
    {
      effectiveFrom: null,
      effectiveTo: null,
      rules: [
        { key: 'double-abroad', name: 'Double abroad', rateNum: 1, rateDen: 5000, rounding: 'per_increment', priority: 10, stackable: false, match: { origin: 'foreign' } },
        { key: 'double-category', name: 'Double category', rateNum: 1, rateDen: 5000, rounding: 'per_increment', priority: 10, stackable: false, match: {}, categoryChoice: 'double' },
        { key: 'base', name: 'Base', rateNum: 1, rateDen: 10000, rounding: 'per_increment', priority: 0, stackable: false, match: {} },
      ],
      cycleBonuses: [],
    },
  ],
  transferPartners: [],
  cashValue: null,
  welcomeBonus: null,
  notes: [],
  sources: [{ title: 'Bank page', url: 'https://example.com/card' }],
  verifiedOn: '2026-09-13',
});

const plan = (choices: AppliedCategoryChoice[]) => planCatalogApply(withChoice(), { 'food_beverage.restaurants': ['c-dining'], 'household.groceries': ['c-groceries'] }, '2026-09-13', null, choices);

describe('a category the holder picks: validation', () => {
  it('accepts a menu and a rule that names it', () => {
    expect(validateEntry(withChoice(), DEFAULT_CATEGORY_KEYS)).toEqual([]);
  });

  it('rejects a rule naming a choice the program never declares', () => {
    const entry = withChoice();
    entry.terms[0]!.rules[1]!.categoryChoice = 'nonsense';
    expect(validateEntry(entry, DEFAULT_CATEGORY_KEYS)).toContain('terms[0].rules[1].categoryChoice: unknown category choice "nonsense"');
  });

  it('rejects a choice rule when the program declares no menu', () => {
    const entry = withChoice();
    delete entry.program.categoryChoice;
    expect(validateEntry(entry, DEFAULT_CATEGORY_KEYS)).toContain('terms[0].rules[1].categoryChoice: the program declares no category choice');
  });

  it('rejects a menu of one, which is not a choice', () => {
    const entry = withChoice();
    entry.program.categoryChoice!.options = [{ key: 'dining', name: 'Food & Beverages', match: {} }];
    expect(validateEntry(entry, DEFAULT_CATEGORY_KEYS)).toContain('program.categoryChoice.options: must offer at least two options');
  });

  it('rejects an option whose match names a category that does not exist', () => {
    const entry = withChoice();
    entry.program.categoryChoice!.options[0]!.match = { categoryKeys: ['food.nonsense'] };
    expect(validateEntry(entry, DEFAULT_CATEGORY_KEYS)).toContain('program.categoryChoice.options[0].match.categoryKeys: unknown category key "food.nonsense"');
  });

  it('requires the menu to say how often it may change', () => {
    const entry = withChoice();
    entry.program.categoryChoice!.changeable = '';
    expect(validateEntry(entry, DEFAULT_CATEGORY_KEYS)).toContain('program.categoryChoice.changeable: is required, so the screen can say how often it may change');
  });
});

describe('a category the holder picks: applying it', () => {
  it('says the card needs a choice', () => {
    expect(plan([]).requiresCategoryChoice).toBe(true);
  });

  it('writes no category rule until one is picked, leaving the other rules alone', () => {
    const rules = plan([]).rules.map((rule) => rule.name);
    expect(rules).toEqual(['Double abroad', 'Base']);
  });

  it('earns double on the picked category, with that option named on the rule', () => {
    const rules = plan([{ optionKey: 'dining', from: null, to: null }]).rules;
    const chosen = rules.find((rule) => rule.name.startsWith('Double category'))!;
    expect(chosen.name).toBe('Double category: Food & Beverages');
    expect(chosen.match.categoryIds).toEqual(['c-dining']);
    expect(chosen.rateDen).toBe(5000);
  });

  it('keeps the category each cycle ran with, so a closed cycle is never rewritten', () => {
    const rules = plan([
      { optionKey: 'dining', from: null, to: '2026-08-25' },
      { optionKey: 'groceries', from: '2026-08-26', to: null },
    ]).rules.filter((rule) => rule.name.startsWith('Double category'));

    expect(rules.map((rule) => [rule.name, rule.validFrom, rule.validTo])).toEqual([
      ['Double category: Food & Beverages', null, '2026-08-25'],
      ['Double category: Groceries', '2026-08-26', null],
    ]);
  });

  it('gives every dated stretch its own key, so one does not overwrite another', () => {
    const keys = plan([
      { optionKey: 'dining', from: null, to: '2026-08-25' },
      { optionKey: 'groceries', from: '2026-08-26', to: null },
    ]).rules.map((rule) => rule.catalogKey);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('ignores an option the menu does not offer', () => {
    expect(plan([{ optionKey: 'petrol', from: null, to: null }]).rules.map((rule) => rule.name)).toEqual(['Double abroad', 'Base']);
  });

  it('double abroad and the picked category sit at the same priority, so neither doubles the other', () => {
    const rules = plan([{ optionKey: 'dining', from: null, to: null }]).rules;
    const abroad = rules.find((rule) => rule.name === 'Double abroad')!;
    const chosen = rules.find((rule) => rule.name.startsWith('Double category'))!;
    const base = rules.find((rule) => rule.name === 'Base')!;
    expect(abroad.stackable).toBe(false);
    expect(chosen.stackable).toBe(false);
    expect(abroad.priority).toBe(chosen.priority);
    expect(chosen.priority).toBeGreaterThan(base.priority);
  });

  it('a card with no menu needs no choice and is unaffected', () => {
    const flat = withChoice();
    delete flat.program.categoryChoice;
    flat.terms[0]!.rules = flat.terms[0]!.rules.filter((rule) => !rule.categoryChoice);
    const result = planCatalogApply(flat, {}, '2026-09-13');
    expect(result.requiresCategoryChoice).toBe(false);
    expect(result.rules.map((rule) => rule.name)).toEqual(['Double abroad', 'Base']);
  });
});
