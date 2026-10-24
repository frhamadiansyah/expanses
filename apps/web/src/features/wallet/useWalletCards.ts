import { formatMinor, isoDate } from '@expanses/core';
import { type AccountRow, pocketParentIds } from '@expanses/db';
import { useQuery } from '@tanstack/react-query';
import { useApp } from '../../app/context';
import { SUBTYPE_LABELS } from '../../lib/account-types';
import { useAccounts, useBalances } from '../../lib/queries';
import { groupedFigure, type WalletCard } from '../../ui/native';
import { parentTotal, pocketCount, pocketsOf, spendingBook } from '../accounts/pockets';
import { useHeldRates } from '../accounts/queries';
import { useAccountNumberLast4, useCardIdentities, useCards, useCardTiers, useWalletLast4 } from '../cards/card-queries';
import { faceFor, tieredKey } from '../cards/debit-art/faces';
import { type CardPoints, formatPoints, loadCardPoints, pointsValue, shortDate } from '../cards/useCardPoints';
import { owedMinor } from '../networth/debt-rows';
import { useAssetProfiles } from '../networth/queries';
import { bankOf, faceKindsOf, moneyChip, walletCredit, walletMoney, walletOrder } from './wallet-model';

/** What a credit card's points are counted in, for the line beside the stack. */
const unitOf = (cp: CardPoints) => cp.programme?.unit ?? cp.program?.unit ?? 'points';

/**
 * Wallet's cards, each drawn as every view draws it — its face, its figure, where a tap goes — and in the order all
 * three views and Reorder cards read them (`walletOrder`). With them, what they were read from, so Wallet's Balance box
 * counts the same money the cards show.
 */
export function useWalletCards() {
  const { database, ws } = useApp();
  const accounts = useAccounts();
  const balances = useBalances();
  const everything = accounts.data ?? [];
  const all = balances.data ?? {};
  const parents = pocketParentIds(everything);
  const digits = useAccountNumberLast4().data ?? {};
  const phones = useWalletLast4().data ?? {};
  const tiers = useCardTiers().data ?? {};
  const profiles = useAssetProfiles().data ?? [];
  const identities = useCardIdentities().data ?? {};
  const plastic = useCards().data ?? [];
  const today = isoDate();

  /* What the stack holds. The money is read from the accounts kept for spending; the credit cards whatever they say. */
  const book = spendingBook(everything);
  const money = walletMoney(everything);
  const credit = walletCredit(everything);
  // Every currency the cards and the box convert: the money's, a pocket's, a card's.
  const rates = useHeldRates([...book.filter((a) => a.kind === 'asset' && a.archivedAt === null).map((a) => a.currency!), ...credit.map((a) => a.currency ?? ws.baseCurrency)]);
  const held = rates.data?.rates ?? {};

  /* Each credit card's points, for the line beside the stack and its catalogue art. */
  const data = useQuery({
    // Distinct from the card page's key: this query caches an array, that one a single CardPoints.
    queryKey: ['card-points-list', ws.workspaceId, today, credit.map((c) => c.id).join(',')],
    enabled: accounts.isSuccess,
    queryFn: () => Promise.all(credit.map((card) => loadCardPoints(database, ws, card, everything, today))),
  });

  /** A money card's figure: its balance, or — for an account with pockets — what they come to here. */
  const moneyFigure = (account: AccountRow) => {
    if (!parents.has(account.id)) return formatMinor(all[account.id] ?? 0, account.currency!);
    const pockets = pocketsOf(account.id, everything);
    return groupedFigure(parentTotal(pockets, all, ws.baseCurrency, held), ws.baseCurrency, pockets.some((p) => p.currency !== ws.baseCurrency)).text;
  };
  /*
   * The drawn face for each money card: its bank's (the tax report's Nama institusi, read off its profile or its
   * pockets'), else whatever its own name names — a wallet's app, a prepaid card. On a debit face the digits and holder
   * are the account's debit card's where one is recorded, else the account number's last four and the account's name;
   * a wallet's digits are its phone's. Money nothing is drawn for keeps the plain face with its chip of words.
   */
  const faceOf = (account: AccountRow) => faceFor([bankOf(account.id, everything, profiles), account.name], faceKindsOf(account.subtype));
  const moneyCards: WalletCard[] = money.map((account) => {
    const face = faceOf(account);
    const debit = face?.kind === 'debit' ? [...plastic.filter((card) => card.accountId === account.id)].sort((a, b) => Number(b.isPrimary) - Number(a.isPrimary))[0] : undefined;
    return {
      key: account.id,
      issuer: null,
      name: account.name,
      last4: face === null ? null : face.kind === 'ewallet' ? (phones[account.id] ?? null) : (debit?.last4 ?? digits[account.id] ?? phones[account.id] ?? null),
      holderName: face?.kind === 'debit' ? (debit?.holderName ?? account.name) : undefined,
      kind: moneyChip(account, digits[account.id]),
      face: face ? { key: tieredKey(face, tiers[account.id]), kind: face.kind, mark: face.mark } : undefined,
      figure: moneyFigure(account),
      figureLabel: 'Balance',
      subtitle: parents.has(account.id) ? `${SUBTYPE_LABELS[account.subtype]} · ${pocketCount(pocketsOf(account.id, everything).length)}` : `${SUBTYPE_LABELS[account.subtype]} · ${account.currency}`,
      to: '/accounts/$accountId' as const,
      params: { accountId: account.id },
      label: account.name,
    };
  });
  const creditCards: WalletCard[] = (data.data ?? []).map((cp) => {
    const own = [...plastic.filter((card) => card.accountId === cp.card.id)].sort((a, b) => Number(b.isPrimary) - Number(a.isPrimary));
    const points = cp.current?.earn.totalPoints ?? 0;
    const value = pointsValue(points, cp.best);
    // Every card on this account, so a supplementary card is still named where the wall can see it.
    const named = own.filter((card) => card.last4 !== null).map((card) => `···· ${card.last4}${card.holderName ? ` ${card.holderName}` : ''}`);
    const cycle = !cp.terms
      ? 'Add billing date to see points'
      : cp.current
        ? `This cycle ${shortDate(cp.current.cycle.start)} – ${shortDate(cp.current.cycle.end)}`
        : 'Rewards not set up';
    // Points are a count, not money: they keep their own unit and never go through a currency formatter.
    const earned = cp.current && cp.program ? `${formatPoints(points)} ${unitOf(cp)}` : null;
    const worth = value !== null && cp.best ? `≈ ${formatMinor(value, cp.best.currency)}` : null;
    return {
      key: cp.card.id,
      issuer: identities[cp.card.id]?.issuer ?? null,
      name: cp.card.name,
      last4: own[0]?.last4 ?? null,
      holderName: own[0]?.holderName,
      network: cp.catalog.entry?.network,
      look: cp.catalog.entry?.look,
      // A PayLater line is a credit account with no catalogue look: its own name finds its drawn face.
      face: cp.catalog.entry?.look ? undefined : faceFor([cp.card.name], ['paylater']),
      // What the card owes, unmasked: the figure a credit card is opened to read.
      figure: formatMinor(owedMinor(all, cp.card.id), cp.card.currency ?? ws.baseCurrency),
      figureLabel: 'Owed',
      // Captioned under a face in the grid, what is owed is in the owed red, as it is everywhere else.
      figureTone: 'alarm',
      subtitle: [...named, cycle, earned, worth].filter(Boolean).join(' · '),
      to: '/cards/$cardId' as const,
      params: { cardId: cp.card.id },
      // The card's own name, so a link to it reads as the card rather than as a sentence about it.
      label: cp.card.name,
    };
  });
  /*
   * One list, in Wallet's order: the money then the credit cards, or — once they have been put in order by hand — the
   * order chosen, a credit card in front of a bank account if that is where it was put (`walletOrder`).
   */
  const byKey = new Map([...moneyCards, ...creditCards].map((card) => [card.key, card]));
  const cards = walletOrder(everything).flatMap((account) => byKey.get(account.id) ?? []);
  const ready = accounts.isSuccess && balances.isSuccess && data.isSuccess;

  return { accounts, balances, everything, all, parents, book, money, credit, rates, held, today, cards, ready };
}
