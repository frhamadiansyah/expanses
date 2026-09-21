import { formatMinor, minorToMajorString, parseMajor, type TermMonths } from '@expanses/core';
import type { DepositProposal } from '@expanses/db';
import { maturityLabel, rateBpsFrom, rateInputText, rateLabel } from './deposit-terms';
import { termLabel } from './maturity-settings';

export interface ProposalDraft {
  gross: string;
  tax: string;
  principal: string;
  rate: string;
  term: TermMonths;
}

export interface ProposalFigures {
  grossMinor: number;
  taxMinor: number;
  principalMinor: number;
  newRateBps?: number;
  newTermMonths?: TermMonths;
}

export const closing = (p: DepositProposal): boolean => p.event.kind === 'maturity' && p.settings.atMaturity === 'close';
export const rolling = (p: DepositProposal): boolean => p.event.kind === 'maturity' && p.settings.atMaturity !== 'close';

export function draftFrom(p: DepositProposal): ProposalDraft {
  return {
    gross: minorToMajorString(p.grossMinor, p.currency),
    tax: minorToMajorString(p.taxMinor, p.currency),
    principal: minorToMajorString(p.principalMinor, p.currency),
    rate: p.settings.keepRate ? rateInputText(p.rateBps) : '',
    term: p.settings.termMonths,
  };
}

const amount = (text: string, currency: string): number => (text.trim() === '' ? 0 : parseMajor(text, currency));

/** The figures to post, read by `parseMajor` in the deposit's currency. Throws a sentence the card shows. */
export function readDraft(p: DepositProposal, draft: ProposalDraft): ProposalFigures {
  const grossMinor = amount(draft.gross, p.currency);
  const taxMinor = p.settings.taxExempt ? 0 : amount(draft.tax, p.currency);
  if (grossMinor < 0 || taxMinor < 0) throw new Error('Interest cannot be below zero');
  if (taxMinor > grossMinor) throw new Error('The tax cannot be more than the interest');
  const principalMinor = closing(p) ? parseMajor(draft.principal, p.currency) : p.principalMinor;
  if (closing(p) && principalMinor <= 0) throw new Error('Say how much came back');
  if (!rolling(p)) return { grossMinor, taxMinor, principalMinor };
  if (!draft.rate.trim()) throw new Error('Type the rate the new term pays');
  return { grossMinor, taxMinor, principalMinor, newRateBps: rateBpsFrom(draft.rate), newTermMonths: draft.term };
}

/** What lands while the figures are being typed: gross − tax, by the same reader, or a dash until both read. */
export function landsText(p: DepositProposal, draft: ProposalDraft): string {
  try {
    const { grossMinor, taxMinor } = readDraft(p, { ...draft, rate: draft.rate || '1' });
    return formatMinor(grossMinor - taxMinor, p.currency);
  } catch {
    return '—';
  }
}

export function proposalHeader(p: DepositProposal, today: string): string {
  const when = p.event.dueOn === today ? 'today' : maturityLabel(p.event.dueOn);
  return p.event.kind === 'maturity' ? `Matured ${when}` : `Interest due ${when}`;
}

/**
 * The net that lands, with how it was taxed. Given the figures on the card, it prints those: a tax typed over the
 * estimate is no longer the setting's percentage of the gross, so it says "after tax" instead of a percentage.
 */
export function interestLine(p: DepositProposal, figures: Pick<ProposalFigures, 'grossMinor' | 'taxMinor'> = p): string {
  const how = p.settings.taxExempt ? 'tax-free' : figures.taxMinor === p.taxMinor && figures.grossMinor === p.grossMinor ? `after ${rateLabel(p.settings.taxBps)} tax` : 'after tax';
  return `${formatMinor(figures.grossMinor - figures.taxMinor, p.currency)} ${how}`;
}

export interface CardFigures {
  principal: string;
  gross: string;
  interest: string;
  term: TermMonths;
}

/**
 * What the read-only card shows: the figures as they stand in the draft, which are exactly what Confirm and
 * "Recorded it myself" will send. A draft that does not read shows a dash, as the Lands row does, never the estimate.
 */
export function cardFigures(p: DepositProposal, draft: ProposalDraft): CardFigures {
  try {
    // The rate is not shown here (the New rate row prints it), so an empty one must not blank the figures.
    const f = readDraft(p, { ...draft, rate: draft.rate || '1' });
    return {
      principal: formatMinor(f.principalMinor, p.currency),
      gross: formatMinor(f.grossMinor, p.currency),
      interest: interestLine(p, f),
      term: draft.term,
    };
  } catch {
    return { principal: '—', gross: '—', interest: '—', term: draft.term };
  }
}

export function outcomeLine(p: DepositProposal, payoutName: string | null, termMonths: TermMonths = p.settings.termMonths): string {
  const to = payoutName ?? 'the account you choose';
  if (p.event.kind === 'monthly') return p.settings.atMaturity === 'principal_interest' ? 'Stays in the deposit' : `To ${to}`;
  if (p.settings.atMaturity === 'close') return `Everything to ${to} · the deposit closes`;
  const term = `Roll over ${termLabel(termMonths)}`;
  return p.settings.atMaturity === 'principal_interest' ? `${term} · interest stays in the deposit` : `${term} · interest to ${to}`;
}

/** The new term's rate as the card prints it: "4,25%", or what was typed while it does not read yet. */
export function newRateText(text: string): string {
  if (!text.trim()) return 'Type it';
  try {
    return rateLabel(rateBpsFrom(text));
  } catch {
    return text;
  }
}
