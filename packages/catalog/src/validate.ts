import { isMccSpec, isSupportedCurrency } from '@expanses/core';
import { CARD_MOTIFS } from './types';

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
  const declaredLevels = new Set<string>();
  let declaredChoiceKey: string | null = null;

  if (typeof entry.id !== 'string' || !/^[a-z0-9]+(-[a-z0-9]+)*$/.test(entry.id)) add('id', 'must be lowercase kebab-case');
  if (!isPositiveInt(entry.entryVersion)) add('entryVersion', 'must be a positive integer');
  for (const field of ['bank', 'name', 'network'] as const) if (!isText(entry[field])) add(field, 'is required');
  if (typeof entry.currency !== 'string' || !isSupportedCurrency(entry.currency)) add('currency', 'must be a supported currency');
  if (entry.cardType !== undefined && !['credit', 'debit'].includes(entry.cardType as string)) add('cardType', 'must be credit or debit');
  // A debit card has no statement to anchor a cycle to, and nothing to charge a yearly fee against.
  if (entry.cardType === 'debit' && isObj(entry.program) && entry.program.cycleAnchor !== 'calendar') {
    add('program.cycleAnchor', 'must be calendar on a debit card, which has no statement');
  }
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
    if (program.memberLevels !== undefined) {
      if (!Array.isArray(program.memberLevels) || program.memberLevels.length === 0) add('program.memberLevels', 'must list at least one level');
      else {
        const seen = new Set<string>();
        program.memberLevels.forEach((level, i) => {
          const path = `program.memberLevels[${i}]`;
          if (!isObj(level)) return add(path, 'must be an object');
          if (!isText(level.key)) add(`${path}.key`, 'is required');
          else if (seen.has(level.key)) add(`${path}.key`, `duplicate key "${level.key}"`);
          else {
            seen.add(level.key);
            declaredLevels.add(level.key);
          }
          if (!isText(level.name)) add(`${path}.name`, 'is required');
          if (!isText(level.condition)) add(`${path}.condition`, 'is required');
        });
      }
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
    const days = match.daysOfWeek;
    if (days !== undefined && (!Array.isArray(days) || days.length === 0 || days.some((d) => !Number.isInteger(d) || (d as number) < 0 || (d as number) > 6))) {
      add(`${path}.daysOfWeek`, 'must list days 0 (Sunday) to 6 (Saturday)');
    }
  };

  if (isObj(program) && program.categoryChoice !== undefined) {
    const choice = program.categoryChoice;
    if (!isObj(choice)) add('program.categoryChoice', 'must be an object');
    else {
      if (!isText(choice.key)) add('program.categoryChoice.key', 'is required');
      else declaredChoiceKey = choice.key;
      if (!isText(choice.name)) add('program.categoryChoice.name', 'is required');
      if (!isText(choice.changeable)) add('program.categoryChoice.changeable', 'is required, so the screen can say how often it may change');
      if (!Array.isArray(choice.options) || choice.options.length < 2) add('program.categoryChoice.options', 'must offer at least two options');
      else {
        const seen = new Set<string>();
        choice.options.forEach((option, i) => {
          const path = `program.categoryChoice.options[${i}]`;
          if (!isObj(option)) return add(path, 'must be an object');
          if (!isText(option.key)) add(`${path}.key`, 'is required');
          else if (seen.has(option.key)) add(`${path}.key`, `duplicate key "${option.key}"`);
          else seen.add(option.key);
          if (!isText(option.name)) add(`${path}.name`, 'is required');
          checkMatch(`${path}.match`, option.match);
        });
      }
    }
  }

  /** A rule may earn only on the holder's chosen option; it must name the choice the program declares. */
  const checkCategoryChoice = (path: string, key: unknown) => {
    if (key === undefined) return;
    if (!isText(key)) return add(`${path}.categoryChoice`, 'must be the key of the program category choice');
    if (declaredChoiceKey === null) return add(`${path}.categoryChoice`, 'the program declares no category choice');
    if (key !== declaredChoiceKey) add(`${path}.categoryChoice`, `unknown category choice "${key}"`);
  };

  /** A row may name the levels it applies at; absent means every level. */
  const checkMemberLevels = (path: string, levels: unknown) => {
    if (levels === undefined) return;
    if (!Array.isArray(levels) || levels.some((level) => !isText(level))) return add(`${path}.memberLevels`, 'must be a list of member level keys');
    if (levels.length === 0) return add(`${path}.memberLevels`, 'must list at least one member level');
    if (declaredLevels.size === 0) return add(`${path}.memberLevels`, 'the program declares no member levels');
    for (const level of levels) if (!declaredLevels.has(level as string)) add(`${path}.memberLevels`, `unknown member level "${String(level)}"`);
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
        if (rule.capSpendAtCreditLimit !== undefined && typeof rule.capSpendAtCreditLimit !== 'boolean') {
          add(`${path}.capSpendAtCreditLimit`, 'must be true or false');
        }
        for (const cap of ['capSpendMinor', 'capPoints', 'minTransactionMinor', 'minCycleSpendMinor', 'minCycleTotalMinor', 'minCyclePurchases', 'minCyclePurchaseMinor'] as const) {
          if (rule[cap] !== undefined && rule[cap] !== null && !isNonNegativeInt(rule[cap])) add(`${path}.${cap}`, 'must be a non-negative integer or null');
        }
        // A size on its own asks nothing of the cycle, so it only means something beside a count.
        if (rule.minCyclePurchaseMinor != null && rule.minCyclePurchases == null) {
          add(`${path}.minCyclePurchaseMinor`, 'needs minCyclePurchases beside it, or it asks nothing');
        }
        checkMemberLevels(path, rule.memberLevels);
        checkCategoryChoice(path, rule.categoryChoice);
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
        checkMemberLevels(path, bonus.memberLevels);
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

  const checkRedemptionCap = (path: string, cap: unknown) => {
    if (cap === undefined) return;
    if (!isObj(cap)) return add(path, 'must be an object when present');
    if (cap.window !== 'month' && cap.window !== 'year') add(`${path}.window`, "must be 'month' or 'year'");
    const measures = (['capPoints', 'capPartnerUnits'] as const).filter((field) => cap[field] !== undefined);
    if (measures.length !== 1) add(path, 'must set exactly one of capPoints and capPartnerUnits');
    for (const field of measures) if (!isPositiveInt(cap[field])) add(`${path}.${field}`, 'must be a positive integer');
    if (cap.shared !== undefined && typeof cap.shared !== 'boolean') add(`${path}.shared`, 'must be a boolean');
    const beyond = (['beyondPoints', 'beyondPartnerUnits'] as const).filter((field) => cap[field] !== undefined);
    if (beyond.length === 1) add(path, 'needs both beyondPoints and beyondPartnerUnits, or neither');
    for (const field of beyond) if (!isPositiveInt(cap[field])) add(`${path}.${field}`, 'must be a positive integer');
  };

  if (!Array.isArray(entry.transferPartners)) add('transferPartners', 'must be a list (possibly empty)');
  else {
    uniqueKeys('transferPartners', entry.transferPartners);
    entry.transferPartners.forEach((partner, i) => {
      const path = `transferPartners[${i}]`;
      if (!isObj(partner)) return add(path, 'must be an object');
      if (!isText(partner.program)) add(`${path}.program`, 'is required');
      for (const field of ['points', 'partnerUnits', 'incrementPoints'] as const) if (!isPositiveInt(partner[field])) add(`${path}.${field}`, 'must be a positive integer');
      if (partner.incrementPartnerUnits !== undefined) {
        if (!isPositiveInt(partner.incrementPartnerUnits)) add(`${path}.incrementPartnerUnits`, 'must be a positive integer');
        else if (isPositiveInt(partner.points) && isPositiveInt(partner.partnerUnits)) {
          const asPoints = Math.ceil((partner.incrementPartnerUnits * partner.points) / partner.partnerUnits);
          if (partner.incrementPoints !== asPoints) add(`${path}.incrementPoints`, `must be ${asPoints} to match incrementPartnerUnits through the ratio`);
        }
      }
      if (partner.minimumPoints !== undefined && !isPositiveInt(partner.minimumPoints)) add(`${path}.minimumPoints`, 'must be a positive integer');
      else if (isPositiveInt(partner.minimumPoints) && isPositiveInt(partner.incrementPoints) && partner.minimumPoints < partner.incrementPoints) {
        add(`${path}.minimumPoints`, 'must be at least incrementPoints, or the step is the only floor and it should be left out');
      }
      if (!isDateOrNull(partner.effectiveFrom) || !isDateOrNull(partner.effectiveTo)) add(path, 'effectiveFrom and effectiveTo must be YYYY-MM-DD or null');
      checkMemberLevels(path, partner.memberLevels);
      checkRedemptionCap(`${path}.cap`, partner.cap);
    });
  }

  const cash = entry.cashValue;
  if (cash !== null && (!isObj(cash) || !isPositiveInt(cash.valueMinor) || !isPositiveInt(cash.perPoints) || typeof cash.currency !== 'string' || !isSupportedCurrency(cash.currency))) {
    add('cashValue', 'must be null or positive valueMinor and perPoints with a supported currency');
  }

  if (entry.look !== undefined) {
    const look = entry.look;
    const oneOf = (field: string, values: readonly string[]) => {
      if (!isObj(look) || !values.includes(look[field] as string)) add(`look.${field}`, `must be one of ${values.join(', ')}`);
    };
    const HEX = /^#[0-9a-f]{6}([0-9a-f]{2})?$/i;
    if (!isObj(look)) add('look', 'must be an object');
    else {
      oneOf('orientation', ['landscape', 'portrait']);
      oneOf('finish', ['matte', 'glossy', 'metallic']);
      oneOf('pattern', ['none', 'diagonal-lines', 'waves', 'arcs', 'dots', 'grid', 'stripe', 'glow']);
      oneOf('ink', ['light', 'dark']);
      if (look.bankMark !== undefined && look.bankMark !== null && !isText(look.bankMark)) add('look.bankMark', 'must be text or null');
      oneOf('chip', ['gold', 'silver', 'none']);
      if (look.motif !== undefined) oneOf('motif', CARD_MOTIFS);
      if (look.motifColour !== undefined && (typeof look.motifColour !== 'string' || !HEX.test(look.motifColour))) add('look.motifColour', 'must be a #rrggbb or #rrggbbaa colour');
      // Up to six, because a holographic card runs through more colours than a plain one has.
      if (!Array.isArray(look.colours) || look.colours.length < 1 || look.colours.length > 6 || look.colours.some((c) => typeof c !== 'string' || !HEX.test(c))) {
        add('look.colours', 'must be one to six #rrggbb colours');
      }
      if (look.angle !== undefined && typeof look.angle !== 'number') add('look.angle', 'must be a number of degrees');
      if (look.patternColour !== undefined && (typeof look.patternColour !== 'string' || !HEX.test(look.patternColour))) add('look.patternColour', 'must be a #rrggbb or #rrggbbaa colour');
      if (look.wordmark !== null && !isText(look.wordmark)) add('look.wordmark', 'must be text or null');
    }
  }
  return errors;
}
