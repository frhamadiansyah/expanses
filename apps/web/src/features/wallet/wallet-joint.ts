import { type AccountRow, PAYABLE_SUBTYPES } from '@expanses/db';
import { memberName, type ReceivedItem } from '../networth/joint-rows';
import { shortDay } from '../networth/shared-item';
import { SUBTYPE_LABELS } from '../../lib/account-types';
import { moneyChip, walletCredit, walletMoney, walletOrder } from './wallet-model';

/*
 * The partner's joint account and joint card as cards in Wallet (owner, 12 Nov: mockups 2026-11-12-wallet-joint-items
 * option A, and -marks option 4 with the name after the type). A member's shared item whose holder turned on "Joint
 * account" or "Joint card", and which can pay, is a card on the other member's phone — in either way the household
 * files — drawn like an own card of its kind from what its summary carries, with "· Rina’s" after the type, and counted
 * in the Balance box as own money and own cards are. Nothing is read from Rina's ledger: only the summary her phone
 * sent, so a summary a day old still counts, as the latest balance known.
 */

/** The kinds a joint item can be a Wallet card as: whatever Paid with offers, and a saving account. */
const JOINT_PAYABLE = new Set<string>([...PAYABLE_SUBTYPES, 'savings']);

/** A joint card's key in Wallet: never an account id, so it cannot be taken for one of this phone's own. */
const PREFIX = 'joint:';
export const jointKey = (itemId: string): string => `${PREFIX}${itemId}`;
export const isJointKey = (key: string): boolean => key.startsWith(PREFIX);

/** A partner's joint item, read as a Wallet card. */
export interface JointCard {
  key: string;
  itemId: string;
  owner: string;
  ownerName: string;
  /** Money (it adds to Spending money) or a credit card (what it owes adds to Owed on cards). */
  side: 'money' | 'credit';
  subtype: string;
  /** Its name, without the last four digits its owner's phone added to it. */
  name: string;
  /** Its card's last four (from its name), else its account number's (the summary's `face`), else none. */
  last4: string | null;
  /** Its bank (Nama institusi) and card tier, as its holder set them (the summary's `face`): what its face is drawn from. */
  bank: string | null;
  tier: string | null;
  currency: string;
  /** In `currency`: what money holds, or what a card owes (below 0 while it is in credit). */
  minor: number;
  /** The day of the summary's figure. */
  asOf: string;
}

/**
 * The digits a summary's name carries: its owner's phone sends "<name> ···· <last4>" when the account has a card with
 * its last four digits (`summaries.ts`). A name without that ending is kept as it is.
 */
export function splitLast4(name: string): { name: string; last4: string | null } {
  const match = /^(.*\S) ···· (\d{4})$/.exec(name);
  return match ? { name: match[1]!, last4: match[2]! } : { name, last4: null };
}

/**
 * The other members' joint items that are Wallet cards here: joint, not this member's own, and of a kind that pays —
 * money held, or a credit card. Anything else shared (a deposit, a fund, a loan) stays on Net worth only.
 */
export function walletJoint(items: readonly ReceivedItem[], me: string, names: Record<string, string>): JointCard[] {
  return items
    .filter((item) => item.joint === true && item.owner !== me && JOINT_PAYABLE.has(item.subtype) && item.kind === (item.subtype === 'credit_card' ? 'liability' : 'asset'))
    .map((item) => {
      const { name, last4 } = splitLast4(item.name);
      return {
        key: jointKey(item.itemId),
        itemId: item.itemId,
        owner: item.owner,
        ownerName: memberName(names, item.owner),
        side: item.subtype === 'credit_card' ? ('credit' as const) : ('money' as const),
        subtype: item.subtype,
        name,
        last4: last4 ?? item.face?.last4 ?? null,
        bank: item.face?.bank ?? null,
        tier: item.face?.tier ?? null,
        currency: item.currency,
        minor: item.balanceMinor,
        asOf: item.asOf,
      };
    });
}

/**
 * The chip of words on a partner's joint money card: what an own card of its kind says ("Debit ···· 7781", "Cash"),
 * except that where an own card falls back to the bare "Account" the summary still names its kind ("Saving account"),
 * so the type line reads "SAVING ACCOUNT · RINA’S".
 */
export function jointChip(subtype: string, last4: string | null): string {
  const chip = moneyChip({ subtype: subtype as AccountRow['subtype'] }, last4);
  return chip === 'Account' ? (SUBTYPE_LABELS[subtype as AccountRow['subtype']] ?? chip) : chip;
}

/** The money ranks own cards are put in by (`walletMoney`): banks, cash, wallets and e-money, then other cash. */
const MONEY_RANK: Record<string, number> = { bank: 0, savings: 0, cash: 1, ewallet: 2, emoney: 2, other_cash: 3 };

/**
 * Every Wallet card's key, own and the partner's, in the order the three views and Reorder cards read.
 *
 * Until the own cards are put in an order by hand, the partner's cards follow the own cards' rules: money at the back,
 * by kind (an own card before the partner's of the same kind), and the credit cards in front, the partner's after the
 * own. Once the own cards carry places (`walletOrder`), a partner's card not placed yet is appended, as an own card added
 * since is. A partner's card placed by Reorder cards stands where it was put (`placeJoint`, from `saved`).
 */
export function walletKeys(accounts: readonly AccountRow[], joint: readonly Pick<JointCard, 'key' | 'side' | 'subtype'>[], saved: readonly string[] | null): string[] {
  const own = walletOrder(accounts);
  const manual = own.some((account) => account.sortOrder > 0);
  const jointMoney = joint.filter((card) => card.side === 'money');
  const jointCredit = joint.filter((card) => card.side === 'credit');
  const base = manual
    ? [...own.map((account) => account.id), ...jointMoney.map((card) => card.key), ...jointCredit.map((card) => card.key)]
    : [
        // A stable sort: own money is already in its own order, so it stays ahead of the partner's of one rank.
        ...[...walletMoney(accounts).map((account) => ({ key: account.id, subtype: account.subtype })), ...jointMoney]
          .map((card, index) => ({ card, index }))
          .sort((a, b) => (MONEY_RANK[a.card.subtype] ?? 3) - (MONEY_RANK[b.card.subtype] ?? 3) || a.index - b.index)
          .map(({ card }) => card.key),
        ...walletCredit(accounts).map((account) => account.id),
        ...jointCredit.map((card) => card.key),
      ];
  return placeJoint(base, new Set(joint.map((card) => card.key)), saved);
}

/**
 * The partner's cards put where Reorder cards left them. `saved` is the whole order as it was saved; each partner's
 * card in it goes straight after the nearest card before it in that order that is still in Wallet (first, when none
 * is). A key no card has any more is skipped; a partner's card not in `saved` keeps its place in `base`.
 */
export function placeJoint(base: readonly string[], jointKeys: ReadonlySet<string>, saved: readonly string[] | null): string[] {
  if (!saved) return [...base];
  const placed = new Set(saved.filter((key) => jointKeys.has(key) && base.includes(key)));
  if (placed.size === 0) return [...base];
  const out = base.filter((key) => !placed.has(key));
  saved.forEach((key, index) => {
    if (!placed.has(key)) return;
    let at = 0;
    for (let before = index - 1; before >= 0; before--) {
      const found = out.indexOf(saved[before]!);
      if (found >= 0) {
        at = found + 1;
        break;
      }
    }
    out.splice(at, 0, key);
  });
  return out;
}

/**
 * Where the partner's cards' places are kept: this device's storage, as the Wallet view and the hidden Balance are.
 * The own cards' places are synced on the accounts themselves (`setWalletOrder`); a partner's item is no account of
 * this phone's, so its place stays here. Lost, the partner's cards are only appended again.
 */
export const JOINT_ORDER_KEY = 'wallet.joint-order';

/** The whole order last saved with a partner's card in it, or null. Storage that cannot be read reads as none. */
export function readJointOrder(storage: Pick<Storage, 'getItem'> | undefined = globalThis.localStorage): string[] | null {
  try {
    const parsed: unknown = JSON.parse(storage?.getItem(JOINT_ORDER_KEY) ?? 'null');
    return Array.isArray(parsed) && parsed.every((key) => typeof key === 'string') ? parsed : null;
  } catch {
    return null;
  }
}

/** Keeps `order` while it holds a partner's card, and forgets it once it holds none. */
export function writeJointOrder(order: readonly string[], storage: Pick<Storage, 'setItem' | 'removeItem'> | undefined = globalThis.localStorage): void {
  try {
    if (order.some(isJointKey)) storage?.setItem(JOINT_ORDER_KEY, JSON.stringify(order));
    else storage?.removeItem(JOINT_ORDER_KEY);
  } catch {
    /* Kept for this visit only: the cards are still in the order chosen until the page is read again. */
  }
}

/**
 * Where a joint card's figure came from, and how fresh it is: "from Rina’s phone · 2 min ago" — the last time her
 * phone was heard from, while that was today — else the day of the summary itself ("· today", "· 8 Nov").
 */
export function fromPhoneLine(ownerName: string, seenAt: number | null, asOf: string, now: number, today: string): string {
  const lead = `from ${ownerName}’s phone`;
  if (seenAt !== null) {
    const minutes = Math.floor(Math.max(0, now - seenAt) / 60_000);
    if (minutes < 1) return `${lead} · just now`;
    if (minutes < 60) return `${lead} · ${minutes} min ago`;
    if (minutes < 24 * 60) return `${lead} · ${Math.floor(minutes / 60)} h ago`;
  }
  return `${lead} · ${asOf === today ? 'today' : shortDay(asOf, today)}`;
}
