import { findEntry } from '@expanses/catalog';
import { formatMinor, isoDate } from '@expanses/core';
import { type AccountRow, pocketParentIds } from '@expanses/db';
import { useQuery } from '@tanstack/react-query';
import { useApp } from '../../app/context';
import { accountKindLine } from '../../lib/account-name';
import { SUBTYPE_LABELS } from '../../lib/account-types';
import { useAccounts, useBalances } from '../../lib/queries';
import { groupedFigure, type WalletCard } from '../../ui/native';
import { parentTotal, pocketCount, pocketsOf, spendingBook } from '../accounts/pockets';
import { useSetAsideViews } from '../goals/queries';
import { useHeldRates } from '../accounts/queries';
import { useAccountNumberLast4, useCardIdentities, useCards, useCardTiers, useWalletLast4 } from '../cards/card-queries';
import { faceFor } from '../cards/debit-art/faces';
import { type CardPoints, formatPoints, loadCardPoints, pointsValue, shortDate } from '../cards/useCardPoints';
import { dueNowMinor, laterByCard } from '../cards/limit-usage';
import { useInstallments } from '../loans/queries';
import { owedMinor } from '../networth/debt-rows';
import { useAssetProfiles, useSharedNetWorth } from '../networth/queries';
import { jointFaceMinor, moneyFace } from './wallet-balance';
import { jointChip, readJointOrder, walletJoint, walletKeys } from './wallet-joint';
import { bankOf, moneyChip, moneyFaceOf, walletAsideCredit, walletAsideMoney, walletCredit, walletMoney } from './wallet-model';

/** What a credit card's points are counted in, for the line beside the stack. */
const unitOf = (cp: CardPoints) => cp.programme?.unit ?? cp.program?.unit ?? 'points';

/**
 * Wallet's cards, each drawn as every view draws it — its face, its figure, where a tap goes — and in the order all
 * three views and Reorder cards read them (`walletOrder`). With them, what they were read from, so Wallet's Balance box
 * counts the same money the cards show.
 *
 * `open` is the card or account open on its page. When it is a credit card switched off "For spending"
 * (`walletAsideCredit`), or money switched off (`walletAsideMoney`), that card is drawn too, as `aside`, so Wallet can
 * raise it over its page as it raises its own cards — and it is in none of `cards`, `money`, `credit` or the figures
 * read from them.
 */
export function useWalletCards(open: { cardId?: string; accountId?: string } = {}) {
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
  /*
   * Each card's instalments not billed yet (owner, 17 Nov 2026): a card's figure, and Outstanding on cards in the
   * Balance box, are what is due now — what it owes less those. Net worth and Debts keep the whole debt.
   */
  const plans = useInstallments();
  const laterOnCards = laterByCard(plans.data ?? [], today);
  /*
   * The partner's joint account and joint card (owner, 12 Nov): the other members' shared items whose holder turned
   * Joint on and which can pay, in either way the household files. Read from the summaries their phones sent.
   */
  const shared = useSharedNetWorth();
  const joint = shared.data ? walletJoint(shared.data.items, shared.data.group.me, shared.data.names) : [];

  /* What the stack holds. The money is read from the accounts kept for spending; the credit cards whatever they say. */
  const book = spendingBook(everything);
  const money = walletMoney(everything);
  const credit = walletCredit(everything);
  // The money kept aside that is open: its pockets are all of its open ones, as its own page and Assets count them.
  const asideMoney = walletAsideMoney(everything, open.accountId);
  const asidePockets = asideMoney ? pocketsOf(asideMoney.id, everything) : [];
  // Every currency the cards and the box convert: the money's, a pocket's, a card's — and the open money kept aside's.
  const rates = useHeldRates([
    ...book.filter((a) => a.kind === 'asset' && a.archivedAt === null).map((a) => a.currency!),
    ...credit.map((a) => a.currency ?? ws.baseCurrency),
    ...joint.map((card) => card.currency),
    ...asidePockets.map((a) => a.currency!),
  ]);
  const held = rates.data?.rates ?? {};
  // What goals and sinking funds have set aside of each account: off its face as off Spending money (owner, 22 Nov 2026).
  const setAsideViews = useSetAsideViews();
  const setAsides = Object.values(setAsideViews.data ?? {});

  /* Each credit card's points, for the line beside the stack and its catalogue art. */
  const data = useQuery({
    // Distinct from the card page's key: this query caches an array, that one a single CardPoints.
    queryKey: ['card-points-list', ws.workspaceId, today, credit.map((c) => c.id).join(',')],
    enabled: accounts.isSuccess,
    queryFn: () => Promise.all(credit.map((card) => loadCardPoints(database, ws, card, everything, today))),
  });
  // The card kept aside that is open, read on its own so opening it never reads every card's points again.
  const asideAccount = walletAsideCredit(everything, open.cardId);
  const asideData = useQuery({
    queryKey: ['card-points-list', ws.workspaceId, today, 'aside', asideAccount?.id ?? ''],
    enabled: accounts.isSuccess && asideAccount !== undefined,
    queryFn: () => loadCardPoints(database, ws, asideAccount!, everything, today),
  });

  /**
   * A money card's figure: what is free to spend on it (owner, 22 Nov 2026) — its balance, or for an account with
   * pockets what its pockets kept for spending come to, less what goals and sinking funds have set aside of it, the
   * same amount Spending money takes off (`moneyFace`), so the faces add up to it. No mark on the face says so; its
   * label reads "Free to spend" once anything is set aside, and the account's page shows the balance and the split.
   * A pocket switched off (the lira left after a trip) is savings, so it is not in the card's figure any more than in
   * the Balance box; the account's page and Assets still count it.
   *
   * Money kept aside (switched off "For spending") is in no Spending money: read from `pool`, its every open pocket, as
   * its page reads it, at its full balance.
   */
  const moneyFigure = (account: AccountRow, pool: readonly AccountRow[] | null = null) => {
    if (pool !== null) {
      if (!parents.has(account.id)) return { text: formatMinor(all[account.id] ?? 0, account.currency!), setAside: false };
      const pockets = pocketsOf(account.id, pool);
      return { text: groupedFigure(parentTotal(pockets, all, ws.baseCurrency, held), ws.baseCurrency, pockets.some((p) => p.currency !== ws.baseCurrency)).text, setAside: false };
    }
    const face = moneyFace(account, book, all, ws.baseCurrency, held, setAsides);
    const text = !parents.has(account.id) ? formatMinor(face.minor!, face.currency) : groupedFigure({ totalMinor: face.minor, missing: face.missing }, face.currency, face.converted).text;
    return { text, setAside: face.setAsideMinor !== 0 };
  };
  /*
   * The drawn face for each money card: its bank's (the tax report's Nama institusi, read off its profile or its
   * pockets'), else whatever its own name names — a wallet's app, a prepaid card. Electronic money whose name names no
   * card is drawn as the card its bank issues (`prepaidFaceOf`). On a debit face the digits and holder are the account's
   * debit card's where one is recorded, else the account number's last four and the account's name; a wallet's digits
   * are its phone's. Money nothing is drawn for keeps the plain face with its chip of words ("E-money").
   */
  const faceOf = (account: AccountRow) => moneyFaceOf(bankOf(account.id, everything, profiles), account.name, account.subtype, tiers[account.id]);
  const moneyCard = (account: AccountRow, pool: readonly AccountRow[] | null = null): WalletCard => {
    const face = faceOf(account);
    const figure = moneyFigure(account, pool);
    const debit = face?.kind === 'debit' ? [...plastic.filter((card) => card.accountId === account.id)].sort((a, b) => Number(b.isPrimary) - Number(a.isPrimary))[0] : undefined;
    return {
      key: account.id,
      issuer: null,
      name: account.name,
      last4: face === null ? null : face.kind === 'ewallet' ? (phones[account.id] ?? null) : (debit?.last4 ?? digits[account.id] ?? phones[account.id] ?? null),
      holderName: face?.kind === 'debit' ? (debit?.holderName ?? account.name) : undefined,
      kind: moneyChip(account, digits[account.id]),
      face: face ?? undefined,
      figure: figure.text,
      figureLabel: figure.setAside ? 'Free to spend' : 'Balance',
      subtitle: parents.has(account.id) ? `${accountKindLine(account)} · ${pocketCount(pocketsOf(account.id, pool ?? book).length)}` : `${accountKindLine(account)} · ${account.currency}`,
      to: '/accounts/$accountId' as const,
      params: { accountId: account.id },
      label: account.name,
    };
  };
  const moneyCards: WalletCard[] = money.map((account) => moneyCard(account));
  const creditCard = (cp: CardPoints): WalletCard => {
    const own = [...plastic.filter((card) => card.accountId === cp.card.id)].sort((a, b) => Number(b.isPrimary) - Number(a.isPrimary));
    const points = cp.current?.earn.totalPoints ?? 0;
    const value = pointsValue(points, cp);
    // Every card on this account, so a supplementary card is still named where the wall can see it.
    const named = own.filter((card) => card.last4 !== null).map((card) => `···· ${card.last4}${card.holderName ? ` ${card.holderName}` : ''}`);
    const cycle = !cp.terms
      ? 'Add billing date to see points'
      : cp.current
        ? `This cycle ${shortDate(cp.current.cycle.start)} – ${shortDate(cp.current.cycle.end)}`
        : 'Rewards not set up';
    // Points are a count, not money: they keep their own unit and never go through a currency formatter.
    const earned = cp.current && cp.program ? `${formatPoints(points)} ${unitOf(cp)}` : null;
    const worth = value ? `≈ ${formatMinor(value.valueMinor, value.currency)}` : null;
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
      // What is due now on the card, unmasked: the figure a credit card is opened to read, as its back says it.
      figure: formatMinor(dueNowMinor(owedMinor(all, cp.card.id), laterOnCards[cp.card.id] ?? 0), cp.card.currency ?? ws.baseCurrency),
      figureLabel: 'Outstanding',
      // Captioned under a face in the grid, what is owed is in the owed red, as it is everywhere else.
      figureTone: 'alarm',
      subtitle: [...named, cycle, earned, worth].filter(Boolean).join(' · '),
      to: '/cards/$cardId' as const,
      params: { cardId: cp.card.id },
      // The card's own name, so a link to it reads as the card rather than as a sentence about it.
      label: cp.card.name,
    };
  };
  const creditCards: WalletCard[] = (data.data ?? []).map(creditCard);
  const aside = asideMoney ? moneyCard(asideMoney, everything) : asideAccount && asideData.data ? creditCard(asideData.data) : undefined;
  /*
   * The partner's joint cards, drawn like an own card of their kind from what the summary carries — its name, its kind,
   * its currency, its bank and card tier, and the last four digits of its card or its number — and "· Rina’s" after
   * the type, so the face is the one its holder's phone draws (`moneyFaceOf`). Money nothing is drawn for keeps the
   * plain face with its chip of words. A credit card is drawn as its holder's Wallet draws it (fix/joint-card-face): its
   * catalogue product's art and network, with its issuer; one with no product this phone's catalogue knows is the plain
   * card face, its issuer's colour, or a PayLater line's drawn face by its name.
   */
  const jointCards: WalletCard[] = joint.map((card) => {
    const product = card.side === 'credit' && card.entry ? findEntry(card.entry) : undefined;
    const face = card.side === 'money' ? moneyFaceOf(card.bank, card.name, card.subtype, card.tier) : product?.look ? null : faceFor([card.name], ['paylater']);
    const whose = `${card.ownerName}’s`;
    return {
      key: card.key,
      issuer: card.side === 'credit' ? card.bank : null,
      ...(card.side === 'credit' ? { network: product?.network, look: product?.look } : {}),
      name: card.name,
      // A plain money face prints no digits: what it is is its chip of words ("Debit ···· 7781").
      last4: card.side === 'credit' || face !== null ? card.last4 : null,
      whose,
      ...(card.side === 'money' ? { kind: jointChip(card.subtype, card.last4) } : {}),
      face: face ? { key: face.key, kind: face.kind, mark: face.mark } : undefined,
      // Joint money less what its holder's phone set aside of it, as Spending money counts it (`jointFaceMinor`).
      figure: formatMinor(jointFaceMinor(card), card.currency),
      figureLabel: card.side === 'credit' ? 'Owed' : card.setAsideMinor > 0 ? 'Free to spend' : 'Balance',
      ...(card.side === 'credit' ? { figureTone: 'alarm' as const } : {}),
      subtitle: [whose, SUBTYPE_LABELS[card.subtype as keyof typeof SUBTYPE_LABELS] ?? card.subtype, card.currency].join(' · '),
      to: '/wallet/joint/$itemId' as const,
      params: { itemId: card.itemId },
      // Whose it is is said with its name, so a reader hears "Joint savings, Rina’s" as the face prints it.
      label: `${card.name}, ${whose}`,
    };
  });
  /*
   * One list, in Wallet's order: the money then the credit cards, or — once they have been put in order by hand — the
   * order chosen, a credit card in front of a bank account if that is where it was put (`walletOrder`). The partner's
   * cards go by the same rules, and stand where Reorder cards put them (`walletKeys`).
   */
  const byKey = new Map([...moneyCards, ...creditCards, ...jointCards].map((card) => [card.key, card]));
  const cards = walletKeys(everything, joint, readJointOrder()).flatMap((key) => byKey.get(key) ?? []);
  const ready = accounts.isSuccess && balances.isSuccess && data.isSuccess && !setAsideViews.isPending && !plans.isPending && !shared.isPending && (asideAccount === undefined || !asideData.isPending);

  return { accounts, balances, everything, all, parents, book, money, credit, joint, rates, held, today, cards, aside, ready, laterOnCards, plansRead: !plans.isPending };
}
