import type { PaymentOption } from '@expanses/core';
import type { AccountRow } from '@expanses/db';

/**
 * What the Paid with / From / To sheet draws on its Accounts side: money grouped by the kind of account it is, each
 * account once, an account holding several currencies as one row whose pockets fold out under it (transfer account
 * tree, option A, 12 Nov). Credit cards stay as they were: one flat list.
 */

export type TreeSectionKey = 'cash' | 'bank' | 'wallet' | 'other' | 'cards';

/** One row that picks on tap: an account of one currency, a lone pocket, a card — or, while searching, any pocket. */
export interface SingleRow {
  type: 'single';
  option: PaymentOption;
  /** The account a pocket sits under; the row is then named by it, with the pocket's currency beside it. */
  parent: AccountRow | null;
}

/** An account with pockets in several currencies: tapping it opens its pockets under it, one per currency. */
export interface ParentRow {
  type: 'parent';
  parent: AccountRow;
  /** The digits the account is known by, when every pocket carries the same ones. */
  last4: string | null;
  pockets: PaymentOption[];
}

export type TreeRow = SingleRow | ParentRow;

export interface TreeSection {
  key: TreeSectionKey;
  title: string;
  rows: TreeRow[];
}

const KIND_OF: Readonly<Record<string, TreeSectionKey>> = {
  cash: 'cash',
  bank: 'bank',
  savings: 'bank',
  // A broker's cash (an RDN) is an account at a bank in the investor's name.
  fund: 'bank',
  ewallet: 'wallet',
  emoney: 'wallet',
};

const MONEY_ORDER: readonly { key: TreeSectionKey; title: string }[] = [
  { key: 'cash', title: 'Cash' },
  { key: 'bank', title: 'Bank accounts' },
  { key: 'wallet', title: 'Digital wallets & e-money' },
  { key: 'other', title: 'Other' },
];

/** Which group an account's subtype is drawn under; anything not named is Other. */
export const treeKindOf = (subtype: string | undefined): TreeSectionKey => (subtype ? (KIND_OF[subtype] ?? 'other') : 'other');

/** Whether a row is a card — a card on an account, or a credit card account itself — rather than money held. */
export const isCardOption = (option: PaymentOption, account: AccountRow | undefined): boolean => Boolean(option.cardId) || account?.kind === 'liability';

/**
 * What one Paid with row is called.
 *
 * The digits are part of the name only when they are what tells two rows apart — an account carrying a
 * supplementary card offers one row per card, and "Mandiri Bonvoy" alone would name both. An account with a
 * single card is one choice, so its name is the account's: a name nobody has to read digits out of.
 */
export function paymentLabel(option: PaymentOption): string {
  return option.cardId ? `${option.accountName} ···· ${option.last4 ?? '????'}` : option.accountName;
}

const byOrder = (a: AccountRow | undefined, b: AccountRow | undefined) => {
  if (!a || !b) return 0;
  return a.sortOrder - b.sortOrder || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
};

/**
 * The sheet's sections, in order: Cash, Bank accounts, Digital wallets & e-money, Other, then Credit cards — each only
 * when it has rows.
 *
 * - A tab narrows to its own kind (null narrows nothing); a search looks across both, whatever tab is open.
 * - Not searching, an account with two or more pockets offered is one `parent` row; a pocket offered alone is a
 *   `single` row named by its account. `leadCurrency` (To: the From's currency) puts that pocket first in its parent.
 * - Searching, there is no tree: each matching pocket is a row of its own, named by its account. A search matches a
 *   row's name, its account's name, its digits, whose card it is, and its currency.
 */
export function accountTreeSections(
  options: readonly PaymentOption[],
  accounts: readonly AccountRow[],
  { tab, typed, leadCurrency }: { tab: 'accounts' | 'cards' | null; typed: string; leadCurrency?: string | null },
): TreeSection[] {
  const byId = new Map(accounts.map((a) => [a.id, a]));
  const wanted = typed.trim().toLowerCase();
  const searching = wanted !== '';
  const parentOf = (account: AccountRow | undefined): AccountRow | null => {
    const parent = account?.parentId ? byId.get(account.parentId) : undefined;
    return parent && parent.kind === 'asset' ? parent : null;
  };
  const matches = (option: PaymentOption) => {
    if (!searching) return true;
    const account = byId.get(option.accountId);
    return [paymentLabel(option), parentOf(account)?.name ?? '', option.last4 ?? '', option.holderName ?? '', account?.currency ?? ''].some((text) => text.toLowerCase().includes(wanted));
  };

  const shown = options.filter(matches);
  const cards = shown.filter((option) => isCardOption(option, byId.get(option.accountId)));
  const money = shown.filter((option) => !isCardOption(option, byId.get(option.accountId)));
  const wantsMoney = searching || tab !== 'cards';
  const wantsCards = searching || tab !== 'accounts';

  // Each account once, in the order the options came; a pocket's place is its parent's, at the parent's first pocket.
  const entries: { kind: TreeSectionKey; parent: AccountRow | null; options: PaymentOption[] }[] = [];
  const atParent = new Map<string, (typeof entries)[number]>();
  for (const option of wantsMoney ? money : []) {
    const account = byId.get(option.accountId);
    const parent = parentOf(account);
    if (parent && !searching) {
      const entry = atParent.get(parent.id);
      if (entry) entry.options.push(option);
      else {
        const made = { kind: treeKindOf(parent.subtype), parent, options: [option] };
        atParent.set(parent.id, made);
        entries.push(made);
      }
      continue;
    }
    entries.push({ kind: treeKindOf((parent ?? account)?.subtype), parent, options: [option] });
  }

  const rowOf = (entry: (typeof entries)[number]): TreeRow => {
    const [first] = entry.options;
    if (!entry.parent || entry.options.length < 2) return { type: 'single', option: first!, parent: entry.parent };
    const currency = (option: PaymentOption) => byId.get(option.accountId)?.currency;
    const pockets = [...entry.options]
      .sort((a, b) => byOrder(byId.get(a.accountId), byId.get(b.accountId)))
      .sort((a, b) => Number(currency(b) === leadCurrency) - Number(currency(a) === leadCurrency));
    const digits = new Set(pockets.map((pocket) => pocket.last4 ?? ''));
    return { type: 'parent', parent: entry.parent, last4: digits.size === 1 ? pockets[0]!.last4 || null : null, pockets };
  };

  const sections: TreeSection[] = MONEY_ORDER.map(({ key, title }) => ({ key, title, rows: entries.filter((entry) => entry.kind === key).map(rowOf) }));
  if (wantsCards) sections.push({ key: 'cards', title: 'Credit cards', rows: cards.map((option): TreeRow => ({ type: 'single', option, parent: null })) });
  return sections.filter((section) => section.rows.length > 0);
}

/** The parent row open when the sheet opens: the one holding what is chosen now, if it is a pocket. */
export function openingParent(sections: readonly TreeSection[], chosenAccountId: string): string | null {
  if (!chosenAccountId) return null;
  for (const section of sections) {
    for (const row of section.rows) {
      if (row.type === 'parent' && row.pockets.some((pocket) => pocket.accountId === chosenAccountId)) return row.parent.id;
    }
  }
  return null;
}
