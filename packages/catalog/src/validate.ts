import { isMccSpec, isSupportedCurrency } from '@expanses/core';

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const ROUNDINGS = new Set(['per_transaction_floor', 'per_cycle_sum', 'per_increment']);

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v);
const isText = (v: unknown): v is string => typeof v === 'string' && v.trim().length > 0;
const isPositiveInt = (v: unknown): v is number => Number.isSafeInteger(v) && (v as number) > 0;
const isNonNegativeInt = (v: unknown): v is number => Number.isSafeInteger(v) && (v as number) >= 0;
const isDateOrNull = (v: unknown) => v === null || (typeof v === 'string' && DATE.test(v));

/** Returns human-readable problems with a catalogue entry; an empty array means the entry is valid. */
export function validateEntry(entry: unknown, knownCategoryKeys: ReadonlySet<string>): string[] {
  const errors: string[] = [];
  const add = (path: string, message: string) => errors.push(`${path}: ${message}`);
  if (!isObj(entry)) return ['entry: must be an object'];

  if (typeof entry.id !== 'string' || !/^[a-z0-9]+(-[a-z0-9]+)*$/.test(entry.id)) add('id', 'must be lowercase kebab-case');
  if (!isPositiveInt(entry.entryVersion)) add('entryVersion', 'must be a positive integer');
  for (const field of ['bank', 'name', 'network'] as const) if (!isText(entry[field])) add(field, 'is required');
  if (typeof entry.currency !== 'string' || !isSupportedCurrency(entry.currency)) add('currency', 'must be a supported currency');
  if (typeof entry.verifiedOn !== 'string' || !DATE.test(entry.verifiedOn)) add('verifiedOn', 'must be a YYYY-MM-DD date');
  if (!Array.isArray(entry.sources) || entry.sources.length === 0) add('sources', 'at least one source is required');
  else entry.sources.forEach((s, i) => {
    if (!isObj(s) || !isText(s.title) || typeof s.url !== 'string' || !s.url.startsWith('https://')) add(`sources[${i}]`, 'needs a title and an https url');
  });
  if (!Array.isArray(entry.notes) || entry.notes.some((n) => typeof n !== 'string')) add('notes', 'must be a list of strings');
  if (entry.welcomeBonus !== null && typeof entry.welcomeBonus !== 'string') add('welcomeBonus', 'must be text or null');

  const program = entry.program;
  if (!isObj(program)) add('program', 'is required');
  else {
    if (!['points', 'miles', 'cashback'].includes(program.unit as string)) add('program.unit', 'must be points, miles, or cashback');
    if (!isText(program.name)) add('program.name', 'is required');
    if (!['statement', 'calendar'].includes(program.cycleAnchor as string)) add('program.cycleAnchor', 'must be statement or calendar');
    if (program.fixedStatementDay !== undefined && !(Number.isInteger(program.fixedStatementDay) && (program.fixedStatementDay as number) >= 1 && (program.fixedStatementDay as number) <= 31)) {
      add('program.fixedStatementDay', 'must be a day from 1 to 31');
    }
    if (program.crediting !== undefined && program.crediting !== 'per_transaction' && program.crediting !== 'per_statement') {
      add('program.crediting', 'must be per_transaction or per_statement');
    }
  }

  const checkPeriods = (path: string, periods: unknown[]) => {
    periods.forEach((p, i) => {
      if (!isObj(p) || !isDateOrNull(p.effectiveFrom) || !isDateOrNull(p.effectiveTo)) {
        add(`${path}[${i}]`, 'effectiveFrom and effectiveTo must be YYYY-MM-DD or null');
        return;
      }
      if (p.effectiveFrom && p.effectiveTo && (p.effectiveFrom as string) > (p.effectiveTo as string)) add(`${path}[${i}]`, 'effectiveFrom is after effectiveTo');
      if (i === 0) return;
      const prev = periods[i - 1] as Obj;
      if (!isObj(prev)) return;
      if (prev.effectiveTo === null || p.effectiveFrom === null) add(`${path}[${i}]`, 'periods overlap: only the first may start open and only the last may end open');
      else if ((p.effectiveFrom as string) <= (prev.effectiveTo as string)) add(`${path}[${i}]`, 'periods overlap or are out of order');
    });
  };

  const checkMatch = (path: string, match: unknown) => {
    if (!isObj(match)) {
      add(path, 'must be an object');
      return;
    }
    for (const field of ['categoryKeys', 'excludeCategoryKeys'] as const) {
      const keys = match[field];
      if (keys === undefined) continue;
      if (!Array.isArray(keys)) add(`${path}.${field}`, 'must be a list');
      else for (const key of keys) if (typeof key !== 'string' || !knownCategoryKeys.has(key)) add(`${path}.${field}`, `unknown category key "${String(key)}"`);
    }
    for (const field of ['merchantPatterns', 'excludeMerchantPatterns'] as const) {
      const patterns = match[field];
      if (patterns !== undefined && (!Array.isArray(patterns) || patterns.some((p) => !isText(p)))) add(`${path}.${field}`, 'must be a list of non-empty keywords');
    }
    if (match.currencies !== undefined && (!Array.isArray(match.currencies) || match.currencies.some((c) => typeof c !== 'string' || !isSupportedCurrency(c)))) {
      add(`${path}.currencies`, 'must list supported currencies');
    }
    if (match.origin !== undefined && match.origin !== 'domestic' && match.origin !== 'foreign') add(`${path}.origin`, 'must be domestic or foreign');
    for (const field of ['mccs', 'excludeMccs'] as const) {
      const specs = match[field];
      if (specs !== undefined && (!Array.isArray(specs) || specs.some((spec) => typeof spec !== 'string' || !isMccSpec(spec)))) {
        add(`${path}.${field}`, 'must list four-digit MCCs or ranges like 3000-3299');
      }
    }
  };

  const uniqueKeys = (path: string, items: unknown[]) => {
    const seen = new Set<string>();
    items.forEach((item, i) => {
      const key = isObj(item) ? item.key : undefined;
      if (!isText(key)) add(`${path}[${i}].key`, 'is required');
      else if (seen.has(key)) add(`${path}[${i}].key`, `duplicate key "${key}"`);
      else seen.add(key);
    });
  };

  if (!Array.isArray(entry.terms) || entry.terms.length === 0) add('terms', 'at least one terms period is required');
  else {
    checkPeriods('terms', entry.terms);
    entry.terms.forEach((period, t) => {
      if (!isObj(period)) return;
      const rules = Array.isArray(period.rules) ? period.rules : [];
      const bonuses = Array.isArray(period.cycleBonuses) ? period.cycleBonuses : [];
      if (!Array.isArray(period.rules)) add(`terms[${t}].rules`, 'must be a list');
      if (!Array.isArray(period.cycleBonuses)) add(`terms[${t}].cycleBonuses`, 'must be a list');
      uniqueKeys(`terms[${t}].rules`, rules);
      uniqueKeys(`terms[${t}].cycleBonuses`, bonuses);
      rules.forEach((rule, r) => {
        const path = `terms[${t}].rules[${r}]`;
        if (!isObj(rule)) return add(path, 'must be an object');
        if (!isText(rule.name)) add(`${path}.name`, 'is required');
        const rateNum = rule.rateNum;
        if (typeof rateNum !== 'number' || rateNum < 0 || Math.abs(rateNum * 10 - Math.round(rateNum * 10)) > 1e-9) add(`${path}.rateNum`, 'must be zero or more with at most one decimal');
        if (!isPositiveInt(rule.rateDen)) add(`${path}.rateDen`, 'must be a positive integer');
        if (!ROUNDINGS.has(rule.rounding as string)) add(`${path}.rounding`, 'is not a supported rounding mode');
        if (!Number.isInteger(rule.priority)) add(`${path}.priority`, 'must be an integer');
        if (typeof rule.stackable !== 'boolean') add(`${path}.stackable`, 'must be true or false');
        for (const cap of ['capSpendMinor', 'capPoints', 'minTransactionMinor'] as const) {
          if (rule[cap] !== undefined && rule[cap] !== null && !isNonNegativeInt(rule[cap])) add(`${path}.${cap}`, 'must be a non-negative integer or null');
        }
        checkMatch(`${path}.match`, rule.match);
      });
      bonuses.forEach((bonus, b) => {
        const path = `terms[${t}].cycleBonuses[${b}]`;
        if (!isObj(bonus)) return add(path, 'must be an object');
        if (!isText(bonus.name)) add(`${path}.name`, 'is required');
        const tiers = Array.isArray(bonus.tiers) ? bonus.tiers : [];
        if (tiers.length === 0) add(`${path}.tiers`, 'at least one tier is required');
        tiers.forEach((tier, i) => {
          if (!isObj(tier) || !isPositiveInt(tier.minSpendMinor) || !isPositiveInt(tier.bonus)) add(`${path}.tiers[${i}]`, 'needs positive integer minSpendMinor and bonus');
          const prev = tiers[i - 1];
          if (i > 0 && isObj(prev) && isObj(tier) && (tier.minSpendMinor as number) <= (prev.minSpendMinor as number)) add(`${path}.tiers[${i}]`, 'tiers must be ascending by minSpendMinor');
        });
        checkMatch(`${path}.match`, bonus.match);
      });
    });
  }

  if (!Array.isArray(entry.fees)) add('fees', 'must be a list (possibly empty)');
  else {
    checkPeriods('fees', entry.fees);
    entry.fees.forEach((fee, i) => {
      if (!isObj(fee)) return;
      if (!isNonNegativeInt(fee.annualFeeMinor)) add(`fees[${i}].annualFeeMinor`, 'must be a non-negative integer');
      if (fee.supplementaryFeeMinor !== null && !isNonNegativeInt(fee.supplementaryFeeMinor)) add(`fees[${i}].supplementaryFeeMinor`, 'must be a non-negative integer or null');
      if (fee.condition !== undefined && !isText(fee.condition)) add(`fees[${i}].condition`, 'must be non-empty text');
    });
  }

  if (!Array.isArray(entry.transferPartners)) add('transferPartners', 'must be a list (possibly empty)');
  else {
    uniqueKeys('transferPartners', entry.transferPartners);
    entry.transferPartners.forEach((partner, i) => {
      const path = `transferPartners[${i}]`;
      if (!isObj(partner)) return add(path, 'must be an object');
      if (!isText(partner.program)) add(`${path}.program`, 'is required');
      for (const field of ['points', 'partnerUnits', 'incrementPoints'] as const) if (!isPositiveInt(partner[field])) add(`${path}.${field}`, 'must be a positive integer');
      if (!isDateOrNull(partner.effectiveFrom) || !isDateOrNull(partner.effectiveTo)) add(path, 'effectiveFrom and effectiveTo must be YYYY-MM-DD or null');
    });
  }

  const cash = entry.cashValue;
  if (cash !== null && (!isObj(cash) || !isPositiveInt(cash.valueMinor) || !isPositiveInt(cash.perPoints) || typeof cash.currency !== 'string' || !isSupportedCurrency(cash.currency))) {
    add('cashValue', 'must be null or positive valueMinor and perPoints with a supported currency');
  }

  return errors;
}
