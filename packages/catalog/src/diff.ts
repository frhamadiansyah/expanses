import {
  amountOf,
  cashValueText,
  categoryNames,
  cycleText,
  feeText,
  limitText,
  money,
  originText,
  periodLabel,
  rateText,
  ratioText,
  tiersText,
  unitWord,
} from './format';
import type { Period } from './lookup';
import type { CatalogCycleBonus, CatalogEntry, CatalogFeePeriod, CatalogMatch, CatalogRule, CatalogTransferPartner } from './types';

interface Dated<T> {
  item: T;
  period: Period;
}

interface KeyedChanges<T> {
  added(item: T): string;
  removed(item: T): string;
  changed(before: T, after: T): string[];
}

/** Human-readable changes from the entry a program was applied from to the bundled entry, for the update banner. */
export function diffCatalogEntries(applied: CatalogEntry, current: CatalogEntry): string[] {
  const cashBefore = cashValueText(applied, applied.cashValue);
  const cashAfter = cashValueText(current, current.cashValue);
  return [
    ...programChanges(applied, current),
    ...diffKeyed(datedItems(applied, 'rules'), datedItems(current, 'rules'), {
      added: ({ item, period }) => `New rule ${dated(item.name, period)}: ${rateText(current, item)}.`,
      removed: ({ item, period }) => `Rule removed: ${dated(item.name, period)}.`,
      changed: (before, after) => ruleChanges(applied, current, before, after),
    }),
    ...diffKeyed(datedItems(applied, 'cycleBonuses'), datedItems(current, 'cycleBonuses'), {
      added: ({ item, period }) => `New bonus ${dated(item.name, period)}: ${tiersText(current, item.tiers)} per ${cycleText(current)}.`,
      removed: ({ item, period }) => `Bonus removed: ${dated(item.name, period)}.`,
      changed: (before, after) => bonusChanges(applied, current, before, after),
    }),
    ...diffKeyed(keyed(applied.transferPartners, (p) => p.key), keyed(current.transferPartners, (p) => p.key), {
      added: (partner) => `New transfer partner ${partner.program}: ${ratioText(partner)}${availability(partner)}.`,
      removed: (partner) => `Transfer partner removed: ${partner.program}.`,
      changed: partnerChanges,
    }),
    ...(cashBefore === cashAfter ? [] : [`Cash value: ${cashBefore} → ${cashAfter}.`]),
    ...diffKeyed(keyed(applied.fees, periodKey), keyed(current.fees, periodKey), {
      added: (fee) => `New annual fee ${periodLabel(fee)}: ${feeText(current, fee)}.`,
      removed: (fee) => `${feeLabel(fee)} removed.`,
      changed: (before, after) => [
        ...(feeText(applied, before) === feeText(current, after) ? [] : [`${feeLabel(before)}: ${feeText(applied, before)} → ${feeText(current, after)}.`]),
        ...endChange(feeLabel(before), before, after),
      ],
    }),
    ...(applied.welcomeBonus === current.welcomeBonus ? [] : [current.welcomeBonus ? `Welcome bonus: ${current.welcomeBonus}` : 'Welcome bonus removed.']),
    ...current.notes.filter((note) => !applied.notes.includes(note)).map((note) => `New note: ${note}`),
    ...applied.notes.filter((note) => !current.notes.includes(note)).map((note) => `Note removed: ${note}`),
  ];
}

const periodKey = (period: Period) => period.effectiveFrom ?? 'start';
const dated = (name: string, period: Period) => (period.effectiveFrom || period.effectiveTo ? `${name} (${periodLabel(period)})` : name);
const feeLabel = (fee: CatalogFeePeriod) => dated('Annual fee', fee);
const availability = (period: Period) => (period.effectiveFrom || period.effectiveTo ? `, ${periodLabel(period)}` : '');

function keyed<T>(items: readonly T[], keyOf: (item: T) => string): Map<string, T> {
  return new Map(items.map((item) => [keyOf(item), item]));
}

function datedItems(entry: CatalogEntry, field: 'rules'): Map<string, Dated<CatalogRule>>;
function datedItems(entry: CatalogEntry, field: 'cycleBonuses'): Map<string, Dated<CatalogCycleBonus>>;
function datedItems(entry: CatalogEntry, field: 'rules' | 'cycleBonuses'): Map<string, Dated<CatalogRule | CatalogCycleBonus>> {
  return new Map(
    entry.terms.flatMap((period) =>
      (period[field] as readonly (CatalogRule | CatalogCycleBonus)[]).map((item): [string, Dated<CatalogRule | CatalogCycleBonus>] => [
        `${periodKey(period)}:${item.key}`,
        { item, period },
      ]),
    ),
  );
}

function diffKeyed<T>(before: Map<string, T>, after: Map<string, T>, changes: KeyedChanges<T>): string[] {
  const lines: string[] = [];
  for (const [key, item] of before) {
    const next = after.get(key);
    lines.push(...(next === undefined ? [changes.removed(item)] : changes.changed(item, next)));
  }
  for (const [key, item] of after) if (!before.has(key)) lines.push(changes.added(item));
  return lines;
}

function endChange(label: string, before: Period, after: Period): string[] {
  if (before.effectiveTo === after.effectiveTo) return [];
  return [`${label}: ${after.effectiveTo ? `now ends ${after.effectiveTo}` : 'no longer ends'}.`];
}

function programChanges(applied: CatalogEntry, current: CatalogEntry): string[] {
  const [before, after] = [applied.program, current.program];
  const lines: string[] = [];
  if (before.name !== after.name) lines.push(`Program renamed: ${before.name} → ${after.name}.`);
  if (before.unit !== after.unit) lines.push(`Now earns ${after.unit} instead of ${before.unit}.`);
  if (before.cycleAnchor !== after.cycleAnchor) lines.push(`Now counted per ${cycleText(current)} instead of per ${cycleText(applied)}.`);
  if (before.fixedStatementDay !== after.fixedStatementDay) {
    lines.push(`Statement cycle end day: ${before.fixedStatementDay ?? 'not fixed'} → ${after.fixedStatementDay ?? 'not fixed'}.`);
  }
  return lines;
}

function ruleChanges(applied: CatalogEntry, current: CatalogEntry, before: Dated<CatalogRule>, after: Dated<CatalogRule>): string[] {
  const label = dated(before.item.name, before.period);
  const [a, b] = [before.item, after.item];
  const lines: string[] = [];
  if (a.name !== b.name) lines.push(`${label}: renamed to ${b.name}.`);
  if (rateText(applied, a) !== rateText(current, b)) lines.push(`${label}: ${rateText(applied, a)} → ${rateText(current, b)}.`);
  if (a.priority !== b.priority) lines.push(`${label}: now checked in a different order.`);
  if (a.stackable !== b.stackable) lines.push(`${label}: ${b.stackable ? 'now adds' : 'no longer adds'} on top of other rules.`);
  const limits = [
    ['minTransactionMinor', 'minimum purchase'],
    ['capSpendMinor', 'spend cap'],
    ['capPoints', `${unitWord(current, 2)} cap`],
  ] as const;
  for (const [field, name] of limits) {
    const [x, y] = [a[field] ?? null, b[field] ?? null];
    if (x !== y) lines.push(`${label}: ${name} ${limitText(applied, field, x)} → ${limitText(current, field, y)}.`);
  }
  return [...lines, ...matchChanges(label, current, a.match, b.match), ...endChange(label, before.period, after.period)];
}

function bonusChanges(applied: CatalogEntry, current: CatalogEntry, before: Dated<CatalogCycleBonus>, after: Dated<CatalogCycleBonus>): string[] {
  const label = dated(before.item.name, before.period);
  const [a, b] = [before.item, after.item];
  const lines: string[] = [];
  if (a.name !== b.name) lines.push(`${label}: renamed to ${b.name}.`);
  const previous = new Map(a.tiers.map((tier) => [tier.minSpendMinor, tier.bonus]));
  const next = new Set(b.tiers.map((tier) => tier.minSpendMinor));
  for (const tier of b.tiers) {
    const threshold = money(tier.minSpendMinor, current.currency);
    const old = previous.get(tier.minSpendMinor);
    if (old === undefined) lines.push(`${label}: new tier ${amountOf(current, tier.bonus)} from ${threshold} spent.`);
    else if (old !== tier.bonus) lines.push(`${label}: tier from ${threshold} spent pays ${amountOf(current, tier.bonus)} instead of ${amountOf(applied, old)}.`);
  }
  for (const tier of a.tiers) {
    if (!next.has(tier.minSpendMinor)) lines.push(`${label}: tier from ${money(tier.minSpendMinor, applied.currency)} spent removed.`);
  }
  return [...lines, ...matchChanges(label, current, a.match, b.match), ...endChange(label, before.period, after.period)];
}

function partnerChanges(before: CatalogTransferPartner, after: CatalogTransferPartner): string[] {
  const label = `Transfer to ${before.program}`;
  const lines: string[] = [];
  if (before.program !== after.program) lines.push(`${label}: now transfers to ${after.program}.`);
  if (ratioText(before) !== ratioText(after)) lines.push(`${label}: ${ratioText(before)} → ${ratioText(after)}.`);
  if (before.effectiveFrom !== after.effectiveFrom || before.effectiveTo !== after.effectiveTo) {
    lines.push(`${label}: now available ${periodLabel(after)}.`);
  }
  return lines;
}

function matchChanges(label: string, current: CatalogEntry, a: CatalogMatch, b: CatalogMatch): string[] {
  const lines: string[] = [];
  const say = (text: string) => lines.push(`${label}: ${text}.`);
  const added = (before: readonly string[], after: readonly string[]) => after.filter((item) => !before.includes(item));
  const merchants = (items: readonly string[]) => `merchants matching ${items.join(', ')}`;

  const include = (before: readonly string[] = [], after: readonly string[] = [], show: (items: readonly string[]) => string, everything: string) => {
    if (!before.length && after.length) return say(`now applies only to ${show(after)}`);
    if (before.length && !after.length) return say(`now applies to ${everything}`);
    const more = added(before, after);
    const fewer = added(after, before);
    if (more.length) say(`now also applies to ${show(more)}`);
    if (fewer.length) say(`no longer applies to ${show(fewer)}`);
  };
  const exclude = (before: readonly string[] = [], after: readonly string[] = [], show: (items: readonly string[]) => string) => {
    const more = added(before, after);
    const fewer = added(after, before);
    if (more.length) say(`now excludes ${show(more)}`);
    if (fewer.length) say(`no longer excludes ${show(fewer)}`);
  };

  include(a.categoryKeys, b.categoryKeys, categoryNames, 'every category');
  include(a.merchantPatterns, b.merchantPatterns, merchants, 'every merchant');
  include(a.currencies, b.currencies, (items) => `purchases in ${items.join(', ')}`, 'purchases in every currency');
  exclude(a.excludeCategoryKeys, b.excludeCategoryKeys, categoryNames);
  exclude(a.excludeMerchantPatterns, b.excludeMerchantPatterns, merchants);
  if (a.origin !== b.origin) say(b.origin ? `now applies only to purchases ${originText(current, b.origin)}` : 'now applies to purchases in every currency');
  return lines;
}
