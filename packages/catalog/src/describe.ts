import {
  amountOf,
  cashValueText,
  conditionParts,
  count,
  cycleText,
  exclusionText,
  feeText,
  limitParts,
  periodLabel,
  rateText,
  tiersText,
  unitWord,
} from './format';
import { feeOn, isStale, withinPeriod } from './lookup';
import type { CatalogEntry, CatalogMatch, CatalogTermsPeriod } from './types';

/** Plain-language preview of an entry: earning, bonuses, exclusions with dates, fees, partners, and verification. */
export function describeEntry(entry: CatalogEntry, today: string): { heading: string; lines: string[] } {
  const lines = [`Earns ${unitWord(entry, 2)} in ${entry.program.name}, counted per ${cycleText(entry)}.`];
  if (entry.program.fixedStatementDay !== undefined) {
    lines.push(`The statement cycle ends on day ${entry.program.fixedStatementDay} of each month.`);
  }

  for (const period of entry.terms) {
    if (entry.terms.length > 1) lines.push(`Terms ${periodLabel(period)}${withinPeriod(today, period) ? ' (in force today)' : ''}:`);
    lines.push(...describePeriod(entry, period));
  }

  if (entry.fees.length === 0) lines.push('Annual fee: not published.');
  else {
    const fee = feeOn(entry, today);
    lines.push(fee ? `Annual fee: ${feeText(entry, fee)}.` : 'Annual fee: not published for today.');
    for (const upcoming of entry.fees) {
      if (upcoming.effectiveFrom && upcoming.effectiveFrom > today) lines.push(`From ${upcoming.effectiveFrom}, annual fee: ${feeText(entry, upcoming)}.`);
    }
  }

  for (const partner of entry.transferPartners) {
    if (partner.effectiveTo && partner.effectiveTo < today) continue;
    const from = partner.effectiveFrom && partner.effectiveFrom > today ? `, from ${partner.effectiveFrom}` : '';
    const to = partner.effectiveTo ? `, until ${partner.effectiveTo}` : '';
    lines.push(
      `Transfers to ${partner.program}: ${amountOf(entry, partner.points)} = ${count(partner.partnerUnits)} ${partner.program}, in steps of ${count(partner.incrementPoints)}${from}${to}.`,
    );
  }
  if (entry.cashValue) lines.push(`Cash value: ${cashValueText(entry, entry.cashValue)}.`);
  if (entry.welcomeBonus) lines.push(`Welcome bonus: ${entry.welcomeBonus}`);
  for (const note of entry.notes) lines.push(`Note: ${note}`);
  lines.push(`Verified on ${entry.verifiedOn}.`);
  if (isStale(entry, today)) lines.push('These terms were verified more than 180 days ago and may be out of date. Check the sources before relying on them.');

  return { heading: entry.name, lines };
}

function describePeriod(entry: CatalogEntry, period: CatalogTermsPeriod): string[] {
  const lines: string[] = [];
  const rules = [...period.rules].sort((a, b) => b.priority - a.priority);
  const exclusions = [...rules.map((rule) => exclusionText(rule.match)), ...period.cycleBonuses.map((bonus) => exclusionText(bonus.match))];
  // Cards usually exclude the same spend from every rule; say it once when they do.
  const shared = exclusions.every((text) => text === exclusions[0]);
  const withExclusion = (parts: string[], match: CatalogMatch) => {
    const text = exclusionText(match);
    return !shared && text ? [...parts, `excluding ${text}`] : parts;
  };

  for (const rule of rules) {
    const parts = [...conditionParts(entry, rule.match), ...limitParts(entry, rule), ...(rule.stackable ? ['on top of other rules'] : [])];
    lines.push(`${rule.name}: ${[rateText(entry, rule), ...withExclusion(parts, rule.match)].join('; ')}.`);
  }
  if (new Set(rules.filter((rule) => !rule.stackable).map((rule) => rule.priority)).size > 1) {
    lines.push('Each purchase earns at the first rule above that matches.');
  }
  for (const bonus of period.cycleBonuses) {
    const earn = `${tiersText(entry, bonus.tiers)} per ${cycleText(entry)}${bonus.tiers.length > 1 ? ', highest tier reached only' : ''}`;
    lines.push(`${bonus.name}: ${[earn, ...withExclusion(conditionParts(entry, bonus.match), bonus.match)].join('; ')}.`);
  }
  if (shared && exclusions[0]) lines.push(`Earns nothing on ${exclusions[0]}.`);
  return lines;
}
