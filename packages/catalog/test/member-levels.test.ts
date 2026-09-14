import { DEFAULT_CATEGORY_KEYS } from '@expanses/core';
import { describe, expect, it } from 'vitest';
import { describeEntry } from '../src/describe';
import { findEntry } from '../src/index';
import { feeOn, termsOn } from '../src/lookup';
import { planCatalogApply } from '../src/plan';
import type { CatalogEntry } from '../src/types';
import { validateEntry } from '../src/validate';

/**
 * A card whose base rate and transfer ratio both depend on the holder's standing with the bank,
 * the way Jenius pays by Club level. Levels are declared once and referenced by key.
 */
const tiered = (): CatalogEntry => ({
  id: 'tiered-card',
  entryVersion: 1,
  bank: 'Test Bank',
  name: 'Tiered Card',
  network: 'visa',
  currency: 'IDR',
  program: {
    unit: 'points',
    name: 'Test Points',
    cycleAnchor: 'statement',
    memberLevels: [
      { key: 'high', name: 'High', condition: 'average balance Rp 10.000.000 or more' },
      { key: 'low', name: 'Low', condition: 'average balance below Rp 10.000.000' },
    ],
  },
  fees: [{ effectiveFrom: null, effectiveTo: null, annualFeeMinor: 500000, supplementaryFeeMinor: null }],
  terms: [
    {
      effectiveFrom: null,
      effectiveTo: null,
      rules: [
        { key: 'base-high', name: 'Base, High', rateNum: 1, rateDen: 10000, rounding: 'per_increment', priority: 0, stackable: false, match: {}, memberLevels: ['high'] },
        { key: 'base-low', name: 'Base, Low', rateNum: 1, rateDen: 20000, rounding: 'per_increment', priority: 0, stackable: false, match: {}, memberLevels: ['low'] },
        { key: 'dining', name: 'Double at restaurants', rateNum: 1, rateDen: 10000, rounding: 'per_increment', priority: 0, stackable: true, match: { mccs: ['5812'] } },
      ],
      cycleBonuses: [],
    },
  ],
  transferPartners: [
    { key: 'krisflyer-high', program: 'KrisFlyer', points: 40000, partnerUnits: 40000, incrementPoints: 40000, effectiveFrom: null, effectiveTo: null, memberLevels: ['high'] },
    { key: 'krisflyer-low', program: 'KrisFlyer', points: 50000, partnerUnits: 40000, incrementPoints: 50000, effectiveFrom: null, effectiveTo: null, memberLevels: ['low'] },
  ],
  cashValue: null,
  welcomeBonus: null,
  notes: [],
  sources: [{ title: 'Bank page', url: 'https://example.com/card' }],
  verifiedOn: '2026-09-13',
});

const errorsFor = (mutate: (entry: CatalogEntry) => void) => {
  const entry = tiered();
  mutate(entry);
  return validateEntry(entry, DEFAULT_CATEGORY_KEYS);
};

describe('member levels: validation', () => {
  it('accepts an entry whose rules and partners name declared levels', () => {
    expect(validateEntry(tiered(), DEFAULT_CATEGORY_KEYS)).toEqual([]);
  });

  it('rejects a rule naming a level the program never declares', () => {
    const errors = errorsFor((entry) => {
      entry.terms[0]!.rules[0]!.memberLevels = ['platinum'];
    });
    expect(errors).toEqual(['terms[0].rules[0].memberLevels: unknown member level "platinum"']);
  });

  it('rejects a transfer partner naming a level the program never declares', () => {
    const errors = errorsFor((entry) => {
      entry.transferPartners[0]!.memberLevels = ['platinum'];
    });
    expect(errors).toEqual(['transferPartners[0].memberLevels: unknown member level "platinum"']);
  });

  it('rejects levels on a rule when the program declares none', () => {
    const errors = errorsFor((entry) => {
      delete entry.program.memberLevels;
    });
    expect(errors).toContain('terms[0].rules[0].memberLevels: the program declares no member levels');
  });

  it('rejects duplicate level keys', () => {
    const errors = errorsFor((entry) => {
      entry.program.memberLevels = [
        { key: 'high', name: 'High', condition: 'a' },
        { key: 'high', name: 'Also high', condition: 'b' },
      ];
    });
    expect(errors).toContain('program.memberLevels[1].key: duplicate key "high"');
  });

  it('requires a name and a condition on every level, so a card can say which one applies', () => {
    const errors = errorsFor((entry) => {
      entry.program.memberLevels = [{ key: 'high', name: 'High', condition: '' }];
    });
    expect(errors).toContain('program.memberLevels[0].condition: is required');
  });

  it('rejects an empty memberLevels list, which would match nothing', () => {
    const errors = errorsFor((entry) => {
      entry.terms[0]!.rules[0]!.memberLevels = [];
    });
    expect(errors).toContain('terms[0].rules[0].memberLevels: must list at least one member level');
  });
});

describe('member levels: applying an entry', () => {
  const plan = (level?: string) => planCatalogApply(tiered(), {}, '2026-09-13', level);

  it('keeps only the base rule for the chosen level', () => {
    expect(plan('high').rules.map((rule) => rule.catalogKey)).toEqual(['start:base-high', 'start:dining']);
    expect(plan('low').rules.map((rule) => rule.catalogKey)).toEqual(['start:base-low', 'start:dining']);
  });

  it('earns at the rate of the chosen level', () => {
    expect(plan('high').rules[0]!.rateDen).toBe(10000);
    expect(plan('low').rules[0]!.rateDen).toBe(20000);
  });

  it('a rule with no level applies at every level', () => {
    expect(plan('high').rules.some((rule) => rule.catalogKey === 'start:dining')).toBe(true);
    expect(plan('low').rules.some((rule) => rule.catalogKey === 'start:dining')).toBe(true);
  });

  it('keeps only the transfer ratio for the chosen level', () => {
    expect(plan('high').transferPartners.map((partner) => partner.points)).toEqual([40000]);
    expect(plan('low').transferPartners.map((partner) => partner.points)).toEqual([50000]);
  });

  it('drops every level-scoped row when no level is chosen, and says the entry needs one', () => {
    const none = plan();
    expect(none.rules.map((rule) => rule.catalogKey)).toEqual(['start:dining']);
    expect(none.transferPartners).toEqual([]);
    expect(none.requiresMemberLevel).toBe(true);
    expect(none.memberLevel).toBeNull();
  });

  it('records the level it was applied at', () => {
    expect(plan('high').memberLevel).toBe('high');
  });

  it('an entry with no levels needs none and keeps every row', () => {
    const flat = tiered();
    delete flat.program.memberLevels;
    for (const rule of flat.terms[0]!.rules) delete rule.memberLevels;
    for (const partner of flat.transferPartners) delete partner.memberLevels;
    const result = planCatalogApply(flat, {}, '2026-09-13');
    expect(result.requiresMemberLevel).toBe(false);
    expect(result.rules).toHaveLength(3);
    expect(result.transferPartners).toHaveLength(2);
  });

  it('an unknown level keeps only the rows that apply everywhere', () => {
    expect(plan('platinum').rules.map((rule) => rule.catalogKey)).toEqual(['start:dining']);
  });

  it('a cycle bonus paid only at one level is dropped at the other', () => {
    const entry = tiered();
    entry.terms[0]!.cycleBonuses = [
      { key: 'milestone', name: 'Milestone', tiers: [{ minSpendMinor: 30000000, bonus: 2500 }], match: {}, memberLevels: ['high'] },
    ];
    const at = (level: string) => planCatalogApply(entry, {}, '2026-09-13', level).bonuses.map((bonus) => bonus.key);
    expect(at('high')).toEqual(['milestone']);
    expect(at('low')).toEqual([]);
  });

  it('a spend tier inside a bonus is not a member level', () => {
    const entry = tiered();
    entry.terms[0]!.cycleBonuses = [
      { key: 'milestone', name: 'Milestone', tiers: [{ minSpendMinor: 30000000, bonus: 2500 }], match: {} },
    ];
    expect(validateEntry(entry, DEFAULT_CATEGORY_KEYS)).toEqual([]);
    expect(planCatalogApply(entry, {}, '2026-09-13', 'low').bonuses[0]!.tiers).toEqual([{ minSpendMinor: 30000000, bonus: 2500 }]);
  });
});

describe('member levels: the preview', () => {
  it('says which level a rule and a transfer ratio belong to, by name', () => {
    const { lines } = describeEntry(tiered(), '2026-09-13');
    expect(lines).toContainEqual(expect.stringMatching(/^Base, High:.*at High level\.$/));
    expect(lines).toContainEqual(expect.stringMatching(/^Base, Low:.*at Low level\.$/));
    expect(lines.filter((line) => line.startsWith('Transfers to KrisFlyer'))).toEqual([
      expect.stringContaining('at High level.'),
      expect.stringContaining('at Low level.'),
    ]);
  });

  it('says nothing about levels on a line that applies at every level', () => {
    const { lines } = describeEntry(tiered(), '2026-09-13');
    const dining = lines.find((line) => line.startsWith('Double at restaurants'))!;
    expect(dining).not.toContain('level');
  });

  it('leaves an untiered card\u2019s wording untouched', () => {
    const flat = tiered();
    delete flat.program.memberLevels;
    for (const rule of flat.terms[0]!.rules) delete rule.memberLevels;
    for (const partner of flat.transferPartners) delete partner.memberLevels;
    expect(describeEntry(flat, '2026-09-13').lines.some((line) => line.includes(' level.'))).toBe(false);
  });
});

describe('Kartu Kredit Jenius', () => {
  const jenius = () => findEntry('jenius-kartu-kredit')!;
  const OLD = '2026-07-31';
  const NEW = '2026-08-01';

  it('earned the same for everyone until the devaluation', () => {
    const before = termsOn(jenius(), OLD)!;
    expect(before.rules.every((rule) => rule.memberLevels === undefined)).toBe(true);
    expect(before.rules.find((rule) => rule.key === 'base')!.rateDen).toBe(10_000);
  });

  it('splits the base rate by Club status from 1 August 2026', () => {
    const after = termsOn(jenius(), NEW)!;
    expect(after.rules.find((rule) => rule.key === 'base-grow')!.rateDen).toBe(10_000);
    expect(after.rules.find((rule) => rule.key === 'base-seed-plant')!.rateDen).toBe(12_000);
  });

  it('Grow keeps 40.000 Yay for 30.000 KrisFlyer; Seed and Plant need 50.000', () => {
    const at = (level: string) => planCatalogApply(jenius(), {}, NEW, level).transferPartners.filter((partner) => partner.program === 'KrisFlyer' && partner.validFrom === NEW);
    expect(at('grow-plus').map((partner) => partner.points)).toEqual([40_000]);
    expect(at('seed-plant').map((partner) => partner.points)).toEqual([50_000]);
  });

  it('Double Yay abroad replaces the base rate rather than adding to it', () => {
    const rules = planCatalogApply(jenius(), {}, NEW, 'seed-plant').rules.filter((rule) => rule.validFrom === NEW);
    const double = rules.find((rule) => rule.name === 'Double Yay abroad')!;
    const base = rules.find((rule) => rule.name === 'Base')!;
    expect(double.stackable).toBe(false);
    expect(double.match.origin).toBe('foreign');
    // Rp 6.000 per Yay at Seed and Plant, against Rp 12.000 at base: double, not triple.
    expect(double.rateDen).toBe(6_000);
    expect(base.rateDen).toBe(12_000);
    expect(double.priority).toBeGreaterThan(base.priority);
  });

  it('a foreign purchase in the chosen category earns double once, not four times', () => {
    const rules = planCatalogApply(jenius(), { 'food.dining': 'c-dining', 'food.coffee': 'c-coffee' }, NEW, 'grow-plus', [
      { optionKey: 'food-beverages', from: null, to: null },
    ]).rules.filter((rule) => rule.validFrom === NEW);

    const abroad = rules.find((rule) => rule.name === 'Double Yay abroad')!;
    const category = rules.find((rule) => rule.name.startsWith('Double Yay category'))!;
    // Same priority and neither stacks, so the engine's cascade gives the spend to one of them and no more.
    expect([abroad.stackable, category.stackable]).toEqual([false, false]);
    expect(abroad.priority).toBe(category.priority);
    expect(category.rateDen).toBe(5_000);
  });

  it('offers the four Jenius categories, one at a time, changeable each cycle', () => {
    const choice = jenius().program.categoryChoice!;
    expect(choice.options.map((option) => option.name)).toEqual(['Beauty & Fashion', 'Food & Beverages', 'Travel & Leisure', 'Groceries']);
    expect(choice.changeable).toBe('once a billing cycle');
  });

  it('offers the same four whatever the Club status', () => {
    const names = (level: string) =>
      planCatalogApply(jenius(), { 'food.groceries': 'c-groceries' }, NEW, level, [{ optionKey: 'groceries', from: null, to: null }]).rules
        .filter((rule) => rule.name.startsWith('Double Yay category') && rule.validFrom === NEW)
        .map((rule) => rule.name);
    expect(names('grow-plus')).toEqual(['Double Yay category: Groceries']);
    expect(names('seed-plant')).toEqual(['Double Yay category: Groceries']);
  });

  it('GarudaMiles was not devalued, so one ratio covers both levels and both periods', () => {
    const gm = jenius().transferPartners.filter((partner) => partner.program === 'GarudaMiles');
    expect(gm).toHaveLength(1);
    expect(gm[0]!.memberLevels).toBeUndefined();
    expect(planCatalogApply(jenius(), {}, NEW, 'seed-plant').transferPartners.some((partner) => partner.program === 'GarudaMiles')).toBe(true);
  });
});

describe('Kartu Kredit Jenius: the annual fee', () => {
  it('charges Rp 500.000 a year, with no end date', () => {
    const fee = feeOn(findEntry('jenius-kartu-kredit')!, '2026-09-13')!;
    expect(fee.annualFeeMinor).toBe(500_000);
    expect(fee.effectiveTo).toBeNull();
  });

  it('applies the fee to the card whatever level the holder is on', () => {
    const at = (level: string) => planCatalogApply(findEntry('jenius-kartu-kredit')!, {}, '2026-09-13', level).annualFeeMinor;
    expect(at('grow-plus')).toBe(500_000);
    expect(at('seed-plant')).toBe(500_000);
  });
});
