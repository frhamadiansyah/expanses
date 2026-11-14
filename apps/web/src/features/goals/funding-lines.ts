import type { AccountRow, GoalLinkRow } from '@expanses/db';

/** A link that leaves its account short of what was promised on it: a set-aside that the balance no longer covers. */
export const linkShort = (link: GoalLinkRow): boolean => link.kind !== 'tagged' && link.shortMinor > 0;

/** One currency of a multicurrency account, under its account's row on Funded by. */
export interface FundingCurrencyLine {
  key: string;
  /** The pocket's currency code: the row's whole title, since the account's name is on the row above. */
  code: string;
  link: GoalLinkRow;
  short: boolean;
}

/**
 * One row of Funded by. A link is the row it always was; a multicurrency account whose currencies fund the goal is one
 * row for the account, at what its currencies come to in the goal's money, opening to each currency.
 */
export type FundingLine =
  | { type: 'link'; key: string; link: GoalLinkRow; short: boolean }
  | {
      type: 'account';
      key: string;
      /** The multicurrency account itself, the pockets' parent. */
      accountId: string;
      name: string;
      /** The currencies that convert, added up in the goal's money. One with no rate is left out of it (`unconverted`). */
      goalMinor: number;
      /** How many of its currencies have no rate for the day, so are missing from `goalMinor`. */
      unconverted: number;
      /** Any currency other than the goal's, or one with no rate: the figure is converted, so it is drawn with ≈. */
      approx: boolean;
      /** Any of its currencies short. */
      short: boolean;
      children: FundingCurrencyLine[];
    };

const keyOf = (link: GoalLinkRow) => `${link.accountId}-${link.kind}-${link.owner ?? 'me'}`;

/**
 * Funded by's rows, one per account, in the order the links first name them.
 *
 * A pocket is an account whose `parentId` names the multicurrency account it sits in (the same fact Net worth folds
 * pockets by). Links on two or more pockets of one account fold into that account's row; a lone pocket, even with two
 * lines on it, keeps its own row and its own name ("Valas · USD"), since a row that opens to one currency says nothing
 * more than the currency. Another member's lines name accounts this phone does not have, so they are never folded.
 */
export function fundingLines(
  links: readonly GoalLinkRow[],
  accounts: readonly Pick<AccountRow, 'id' | 'name' | 'kind' | 'parentId'>[],
  goalCurrency: string,
): FundingLine[] {
  const byId = new Map(accounts.map((account) => [account.id, account]));
  const parentOf = (link: GoalLinkRow) => {
    if (link.owner !== undefined) return null;
    const account = byId.get(link.accountId);
    if (account?.kind !== 'asset' || !account.parentId) return null;
    return byId.get(account.parentId) ?? null;
  };
  // The account's currencies that fund the goal, counted by pocket: two lines on one pocket are still one currency.
  const pockets = new Map<string, Set<string>>();
  for (const link of links) {
    const parent = parentOf(link);
    if (parent) pockets.set(parent.id, (pockets.get(parent.id) ?? new Set()).add(link.accountId));
  }

  const out: FundingLine[] = [];
  const at = new Map<string, number>();
  for (const link of links) {
    const short = linkShort(link);
    const parent = parentOf(link);
    if (!parent || (pockets.get(parent.id)?.size ?? 0) < 2) {
      out.push({ type: 'link', key: keyOf(link), link, short });
      continue;
    }
    const child: FundingCurrencyLine = { key: keyOf(link), code: link.currency, link, short };
    const converted = link.currency !== goalCurrency || link.goalMinor === null;
    const noRate = link.goalMinor === null ? 1 : 0;
    const seen = at.get(parent.id);
    if (seen === undefined) {
      at.set(parent.id, out.length);
      out.push({ type: 'account', key: `account-${parent.id}`, accountId: parent.id, name: parent.name, goalMinor: link.goalMinor ?? 0, unconverted: noRate, approx: converted, short, children: [child] });
      continue;
    }
    const row = out[seen]!;
    if (row.type !== 'account') continue;
    out[seen] = { ...row, goalMinor: row.goalMinor + (link.goalMinor ?? 0), unconverted: row.unconverted + noRate, approx: row.approx || converted, short: row.short || short, children: [...row.children, child] };
  }
  return out;
}
