import { convertPoints, DEFAULT_CATEGORY_KEYS } from '@expanses/core';
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
    const rules = planCatalogApply(jenius(), { 'food_beverage.restaurants': 'c-dining', 'food_beverage.cafe_dessert': 'c-coffee' }, NEW, 'grow-plus', [
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
    expect(choice.options.map((option) => option.name)).toEqual(['Beauty & Fashion', 'Food & Beverages', 'Travel & Leisure', 'Groceries & Gasoline']);
    expect(choice.changeable).toBe('once a month, after the statement is printed');
  });

  it('offers the same four whatever the Club status', () => {
    const names = (level: string) =>
      planCatalogApply(jenius(), { 'household.groceries': 'c-groceries' }, NEW, level, [{ optionKey: 'groceries', from: null, to: null }]).rules
        .filter((rule) => rule.name.startsWith('Double Yay category') && rule.validFrom === NEW)
        .map((rule) => rule.name);
    expect(names('grow-plus')).toEqual(['Double Yay category: Groceries & Gasoline']);
    expect(names('seed-plant')).toEqual(['Double Yay category: Groceries & Gasoline']);
  });

  it('carries the five ratios the app offers, at the steps it offers them in', () => {
    const steps = Object.fromEntries(jenius().transferPartners.map((partner) => [partner.key, [partner.points, partner.partnerUnits]]));
    expect(steps['airasia']).toEqual([10_000, 10_000]);
    expect(steps['linkmiles']).toEqual([15_000, 12_500]);
    expect(steps['garudamiles']).toEqual([25_000, 20_000]);
    expect(steps['traveloka']).toEqual([2_500, 100_000]);
  });

  it('scopes only KrisFlyer by Club status, the one ratio known to follow it', () => {
    for (const partner of jenius().transferPartners) {
      if (partner.program === 'KrisFlyer') continue;
      expect(partner.memberLevels, partner.key).toBeUndefined();
    }
  });

  it('offers every non-KrisFlyer ratio at both levels', () => {
    const programs = (level: string) =>
      planCatalogApply(jenius(), {}, NEW, level)
        // The pre-devaluation KrisFlyer row is still in the plan, dated to end on 2026-07-31.
        .transferPartners.filter((partner) => partner.validTo === null)
        .map((partner) => partner.program)
        .sort();
    expect(programs('grow-plus')).toEqual(['AirAsia rewards', 'GarudaMiles', 'KrisFlyer', 'LinkMiles', 'Traveloka Points']);
    expect(programs('seed-plant')).toEqual(['AirAsia rewards', 'GarudaMiles', 'KrisFlyer', 'LinkMiles', 'Traveloka Points']);
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

describe('Kartu Kredit Jenius: how points are credited', () => {
  const jenius = () => findEntry('jenius-kartu-kredit')!;

  it('credits per transaction, so each purchase can be checked against the app', () => {
    expect(jenius().program.crediting).toBe('per_transaction');
    expect(planCatalogApply(jenius(), {}, '2026-09-14', 'grow-plus').crediting).toBe('per_transaction');
  });

  it('says so in the preview', () => {
    expect(describeEntry(jenius(), '2026-09-14').lines).toContainEqual(expect.stringContaining('credited per purchase'));
  });

  it('says how often the category may change, in the bank\u2019s own words', () => {
    expect(jenius().program.categoryChoice!.changeable).toBe('once a month, after the statement is printed');
  });
});

describe('Kartu Kredit Jenius: the Double Yay categories are the bank\u2019s own MCC lists', () => {
  const choice = () => findEntry('jenius-kartu-kredit')!.program.categoryChoice!;
  const mccsOf = (key: string) => choice().options.find((option) => option.key === key)!.match.mccs!;

  it('matches on merchant category codes, not on this workspace\u2019s categories', () => {
    for (const option of choice().options) {
      expect(option.match.mccs, option.key).toBeDefined();
      expect(option.match.categoryKeys, option.key).toBeUndefined();
    }
  });

  it('Groceries & Gasoline is grocery stores and fuel: 5411, 5541 and 5542', () => {
    expect(mccsOf('groceries')).toEqual(['5411', '5541-5542']);
  });

  it('Food & Beverages is bars, fast food, bakeries and food stores — and not 5812 restaurants', () => {
    expect(mccsOf('food-beverages')).toEqual(['5462', '5499', '5813-5814']);
    expect(mccsOf('food-beverages').join(' ')).not.toContain('5812');
  });

  it('Beauty & Fashion covers clothing, jewellery, cosmetics, salons and department stores', () => {
    expect(mccsOf('beauty-fashion')).toContain('5977');
    expect(mccsOf('beauty-fashion')).toContain('7230');
    expect(mccsOf('beauty-fashion')).toContain('5311');
  });

  it('Travel & Leisure carries the airline and hotel-chain blocks, and not 7011 lodging', () => {
    const specs = mccsOf('travel-leisure');
    expect(specs).toContain('3000-3068');
    expect(specs.some((spec) => spec.startsWith('3501-'))).toBe(true);
    expect(specs).not.toContain('7011');
  });

  it('no code is claimed by two categories', () => {
    const expand = (spec: string) => {
      const [from, to] = spec.includes('-') ? spec.split('-').map(Number) : [Number(spec), Number(spec)];
      return Array.from({ length: to! - from! + 1 }, (_, i) => from! + i);
    };
    const seen = new Set<number>();
    for (const option of choice().options) {
      for (const code of option.match.mccs!.flatMap(expand)) {
        expect(seen.has(code), `MCC ${code} is in two categories`).toBe(false);
        seen.add(code);
      }
    }
  });
});

describe('Kartu Kredit Jenius: only KrisFlyer follows Club status', () => {
  const jenius = () => findEntry('jenius-kartu-kredit')!;

  it('gives Grow and Seed the same ratio at every partner except KrisFlyer', () => {
    const at = (level: string) =>
      Object.fromEntries(
        planCatalogApply(jenius(), {}, '2026-09-14', level)
          .transferPartners.filter((partner) => partner.validTo === null)
          .map((partner) => [partner.program, [partner.points, partner.partnerUnits]]),
      );
    const grow = at('grow-plus');
    const seed = at('seed-plant');

    for (const program of ['AirAsia rewards', 'LinkMiles', 'GarudaMiles', 'Traveloka Points']) {
      expect(seed[program], program).toEqual(grow[program]);
    }
    expect(grow['KrisFlyer']).toEqual([40_000, 30_000]);
    expect(seed['KrisFlyer']).toEqual([50_000, 30_000]);
  });

  it('GarudaMiles stays 25.000 for 20.000 whichever Club you are in', () => {
    const gm = jenius().transferPartners.filter((partner) => partner.program === 'GarudaMiles');
    expect(gm).toHaveLength(1);
    expect(gm[0]!.memberLevels).toBeUndefined();
    expect([gm[0]!.points, gm[0]!.partnerUnits]).toEqual([25_000, 20_000]);
  });
});

/**
 * The effective cost per mile Jenius publishes, for every combination of the Club you transacted in and the
 * Club you convert in. Each figure has to fall out of the encoded rates and ratios, or one of them is wrong.
 */
describe('Kartu Kredit Jenius: the published effective earn tables', () => {
  const NEW = '2026-08-01';
  const rateDen = (level: string, rule: 'Base' | 'Double Yay abroad') =>
    planCatalogApply(findEntry('jenius-kartu-kredit')!, {}, NEW, level).rules.find((row) => row.name === rule && row.validFrom === NEW)!.rateDen;
  const milesPerYay = (level: string, program: string) => {
    const partner = planCatalogApply(findEntry('jenius-kartu-kredit')!, {}, NEW, level).transferPartners.find(
      (row) => row.program === program && row.validTo === null,
    )!;
    return partner.partnerUnits / partner.points;
  };
  /** Rupiah per mile: what a point costs to earn, divided by the miles it converts into. */
  const perMile = (transacted: string, program: string, redeemed: string, rule: 'Base' | 'Double Yay abroad') =>
    Math.round(rateDen(transacted, rule) / milesPerYay(redeemed, program));

  const GROW = 'grow-plus';
  const SEED = 'seed-plant';

  it('transacted at Grow or above', () => {
    expect(perMile(GROW, 'LinkMiles', GROW, 'Base')).toBe(12_000);
    expect(perMile(GROW, 'LinkMiles', GROW, 'Double Yay abroad')).toBe(6_000);
    expect(perMile(GROW, 'GarudaMiles', GROW, 'Base')).toBe(12_500);
    expect(perMile(GROW, 'GarudaMiles', GROW, 'Double Yay abroad')).toBe(6_250);
    expect(perMile(GROW, 'KrisFlyer', GROW, 'Base')).toBe(13_333);
    expect(perMile(GROW, 'KrisFlyer', GROW, 'Double Yay abroad')).toBe(6_667);
  });

  it('transacted at Grow, converted after dropping to Seed or Plant: only KrisFlyer moves', () => {
    expect(perMile(GROW, 'KrisFlyer', SEED, 'Base')).toBe(16_667);
    expect(perMile(GROW, 'KrisFlyer', SEED, 'Double Yay abroad')).toBe(8_333);
    expect(perMile(GROW, 'GarudaMiles', SEED, 'Base')).toBe(perMile(GROW, 'GarudaMiles', GROW, 'Base'));
  });

  it('transacted at Seed or Plant, converted at Grow or above', () => {
    expect(perMile(SEED, 'LinkMiles', GROW, 'Base')).toBe(14_400);
    expect(perMile(SEED, 'LinkMiles', GROW, 'Double Yay abroad')).toBe(7_200);
    expect(perMile(SEED, 'GarudaMiles', GROW, 'Base')).toBe(15_000);
    expect(perMile(SEED, 'GarudaMiles', GROW, 'Double Yay abroad')).toBe(7_500);
    expect(perMile(SEED, 'KrisFlyer', GROW, 'Base')).toBe(16_000);
    // The figure earlier reporting gave, and which a single-level reading wrongly called stale.
    expect(perMile(SEED, 'KrisFlyer', GROW, 'Double Yay abroad')).toBe(8_000);
  });

  it('transacted and converted at Seed or Plant', () => {
    expect(perMile(SEED, 'KrisFlyer', SEED, 'Base')).toBe(20_000);
    expect(perMile(SEED, 'KrisFlyer', SEED, 'Double Yay abroad')).toBe(10_000);
  });
});

describe('Kartu Kredit Jenius: which Club each level covers', () => {
  it('groups Grow, Nurture and Bloom, and names Sinaya Prioritas with them', () => {
    const levels = findEntry('jenius-kartu-kredit')!.program.memberLevels!;
    const grow = levels.find((level) => level.key === 'grow-plus')!;
    expect(grow.condition).toContain('Nurture');
    expect(grow.condition).toContain('Bloom');
    expect(grow.condition).toContain('Sinaya Prioritas');
    expect(levels.find((level) => level.key === 'seed-plant')!.condition).toContain('Seed or Plant');
  });
});

describe('rounding, per full increment', () => {
  it('every Jenius and Danamon rule rounds per increment, not per transaction', () => {
    for (const id of ['jenius-kartu-kredit', 'danamon-jcb-precious']) {
      for (const period of findEntry(id)!.terms) {
        for (const rule of period.rules) expect(rule.rounding, `${id}/${rule.key}`).toBe('per_increment');
      }
    }
  });
});

describe('Mandiri World Prioritas conversion', () => {
  const mandiri = () => findEntry('mandiri-world-prioritas')!;

  it('records the 25.000 a month ceiling on converting Livin’poin to miles', () => {
    expect(mandiri().notes.some((note) => note.includes('25.000 Livin\'poin a month'))).toBe(true);
    // Past the ceiling the points still move, at a third of the rate, which the app does not model.
    expect(mandiri().notes.some((note) => note.includes('3.000 Livin\'poin for 1.000 miles'))).toBe(true);
  });

  it('converts one for one at all five airlines, ANA included', () => {
    // The page's "1:1 Mileage Redemption" names neither partner nor ratio; both come from the cardholder.
    const partners = Object.fromEntries(mandiri().transferPartners.map((p) => [p.program, [p.points, p.partnerUnits]]));
    expect(partners).toEqual({
      KrisFlyer: [1, 1],
      GarudaMiles: [1, 1],
      'Asia Miles': [1, 1],
      'ANA Mileage Club': [1, 1],
      'AirAsia Rewards': [1, 1],
    });
  });

  it('moves AirAsia Rewards in 1.000 steps and every other airline in 10.000', () => {
    const steps = Object.fromEntries(mandiri().transferPartners.map((p) => [p.key, p.incrementPoints]));
    expect(steps).toEqual({ krisflyer: 10_000, garudamiles: 10_000, 'asia-miles': 10_000, ana: 10_000, airasia: 1_000 });
  });

  it('records that points lapse after two years, which the app does not apply', () => {
    expect(mandiri().notes.some((note) => note.includes('expire two years after they are earned'))).toBe(true);
  });

  it('charges no annual fee, main or supplementary', () => {
    const fee = mandiri().fees[0]!;
    expect([fee.annualFeeMinor, fee.supplementaryFeeMinor]).toEqual([0, 0]);
  });

  it('converts in 10.000 steps, one for one, leaving any remainder behind', () => {
    const kf = mandiri().transferPartners.find((p) => p.program === 'KrisFlyer')!;
    const at = (points: number) => convertPoints(points, { points: kf.points, partnerUnits: kf.partnerUnits, incrementPoints: kf.incrementPoints });
    expect(at(9_999)).toBe(0);
    expect(at(10_000)).toBe(10_000);
    // A step, not only a floor: the trailing 5.000 stays put rather than converting.
    expect(at(15_000)).toBe(10_000);
    expect(at(40_000)).toBe(40_000);
  });
});

describe('Maybank TREATS conversion steps', () => {
  const MAYBANK = ['maybank-visa-platinum', 'maybank-visa-infinite', 'maybank-bmw', 'maybank-mini', 'maybank-manchester-united'];

  it('moves miles in 20.000 steps on every card', () => {
    for (const id of MAYBANK) {
      for (const partner of findEntry(id)!.transferPartners) {
        if (partner.program === 'AirAsia points') continue;
        expect(partner.incrementPoints, `${id}/${partner.key}`).toBe(20_000);
      }
    }
  });

  it('keeps AirAsia at 5.000, which is the exception to the 20.000 step', () => {
    // Maybank's own terms say 5.000, and the cardholder confirmed it from the redemption screen on 14 September
    // 2026. The 20.000 minimum covers the mileage partners, not this one.
    for (const id of MAYBANK) {
      const airasia = findEntry(id)!.transferPartners.find((p) => p.program === 'AirAsia points')!;
      expect(airasia.incrementPoints, id).toBe(5_000);
    }
  });
});
