import { formatMinor, isoDate } from '@expanses/core';
import { useQuery } from '@tanstack/react-query';
import { Link, Outlet, useNavigate, useParams, useRouter, useSearch } from '@tanstack/react-router';
import { ChevronLeft, Sparkles, Store, X } from 'lucide-react';
import { type ReactNode, useEffect, useRef } from 'react';
import { useApp } from '../../app/context';
import { moneyHolders, useAccounts } from '../../lib/queries';
import { Empty } from '../../ui';
import { CardStack, CornerButton, type CornerAction, InsetGroup, InsetRow, LargeTitle, OverflowMenu, type WalletCard } from '../../ui/native';
import { useCardIdentities, useCards, useProgramAccounts } from './card-queries';
import { type CardPoints, formatPoints, loadCardPoints, pointsValue, shortDate } from './useCardPoints';

/** The ground a native screen is laid on, and the column a desktop reads it in. */
function Screen({ children }: { children: ReactNode }) {
  return (
    <div className="ph-screen -m-4 min-h-dvh p-4 md:-m-8 md:p-8">
      <div className="mx-auto max-w-4xl">{children}</div>
    </div>
  );
}

/** What the figure on a card's band is called: the unit it is counted in, or that there is nothing counting yet. */
const figureLabelOf = (cp: CardPoints) => {
  if (!cp.program) return 'Rewards';
  return cp.program.unit === 'miles' ? 'Miles' : cp.program.unit === 'cashback' ? 'Cashback' : 'Points';
};

/**
 * The card wall: C3, the Wallet stack — and, as in Apple Wallet, the open card too.
 *
 * Cards overlap back to front, every card's top band shows its figure, and tapping a card opens it: this route
 * stays mounted while `/cards/$cardId` is its child, so the card's own element rises to the top of the screen, the
 * others slide away, and the card's page fades in below it. ✕, Back, Escape or a tap on the raised card put it back
 * in its slot. The open card is laid out as Wallet lays out a pass (the user's Suica reference): ✕ on the left, ⋯
 * on the right, the card, its tiles and its latest transactions; the card's sections are behind ⋯. The art is `CardFace`, unchanged — this screen only decides which cards
 * are on the shelf and what each one's figure says.
 *
 * An account that is not in the stack — a debit account not earning yet — still opens its page on its own.
 */
export function CardsPage() {
  const { database, ws } = useApp();
  const navigate = useNavigate();
  const router = useRouter();
  const { cardId } = useParams({ strict: false }) as { cardId?: string };
  const { tab } = useSearch({ strict: false }) as { tab?: string };
  const accounts = useAccounts();
  const all = accounts.data ?? [];
  // A debit card is a bank account that earns, so it joins the credit cards once its terms are applied.
  const earning = useProgramAccounts().data ?? new Set<string>();
  const cards = all.filter((a) => a.archivedAt === null && (a.subtype === 'credit_card' || earning.has(a.id)));
  // Bank accounts that could carry a debit card but have no rewards yet: without these there is no way in.
  const spendable = moneyHolders(all).filter((a) => ['bank', 'savings'].includes(a.subtype) && !earning.has(a.id));
  const identities = useCardIdentities().data ?? {};
  const plastic = useCards().data ?? [];
  const today = isoDate();
  const data = useQuery({
    // Distinct from the card page's key: this query caches an array, that one a single CardPoints.
    queryKey: ['card-points-list', ws.workspaceId, today, cards.map((c) => c.id).join(',')],
    enabled: accounts.isSuccess,
    queryFn: () => Promise.all(cards.map((card) => loadCardPoints(database, ws, card, all, today))),
  });

  const wallet: WalletCard[] = (data.data ?? []).map((cp) => {
    const own = [...plastic.filter((card) => card.accountId === cp.card.id)].sort((a, b) => Number(b.isPrimary) - Number(a.isPrimary));
    const points = cp.current?.earn.totalPoints ?? 0;
    const value = pointsValue(points, cp.best);
    // Every card on this account, so a supplementary card is still named where the wall can see it.
    const digits = own.filter((card) => card.last4 !== null).map((card) => `···· ${card.last4}${card.holderName ? ` ${card.holderName}` : ''}`);
    const cycle = !cp.terms && cp.card.subtype === 'credit_card'
      ? 'Add billing date to see points'
      : cp.current
        ? `This cycle ${shortDate(cp.current.cycle.start)} – ${shortDate(cp.current.cycle.end)}`
        : 'Rewards not set up';
    const worth = value !== null && cp.best ? `≈ ${formatMinor(value, cp.best.currency)}` : null;
    return {
      key: cp.card.id,
      issuer: identities[cp.card.id]?.issuer ?? null,
      name: cp.card.name,
      last4: own[0]?.last4 ?? null,
      holderName: own[0]?.holderName,
      network: cp.catalog.entry?.network,
      look: cp.catalog.entry?.look,
      // Points are a count, not money: they keep their own unit and never go through a currency formatter.
      figure: cp.current && cp.program ? `${formatPoints(points)} ${cp.program.unit}` : '—',
      figureLabel: figureLabelOf(cp),
      subtitle: [...digits, cycle, worth].filter(Boolean).join(' · '),
      to: '/cards/$cardId' as const,
      params: { cardId: cp.card.id },
      // The card's own name, so a link to it reads as the card rather than as a sentence about it.
      label: cp.card.name,
    };
  });

  const raised = cardId !== undefined ? wallet.find((card) => card.key === cardId) : undefined;
  /*
   * Opened from the stack, the way back is the history's own steps, so ✕ and Back are one gesture and the stack is
   * where they land; reached by a link from elsewhere, ✕ goes to the stack instead of out of the app. The same for
   * ‹ from one of the card's sections back to the card. Where each was is the history's own index.
   */
  const at = () => (router.history.location.state as { __TSR_index?: number }).__TSR_index ?? 0;
  const stackAt = useRef<number | null>(null);
  const summaryAt = useRef<number | null>(null);
  useEffect(() => {
    if (cardId === undefined) stackAt.current = at();
    else if (!tab) summaryAt.current = at();
  });
  const back = (to: number | null, otherwise: () => void) => {
    const now = at();
    if (to !== null && now > to) router.history.go(to - now);
    else otherwise();
  };
  const close = () => back(stackAt.current, () => void navigate({ to: '/cards' }));
  // Opening a card moves focus to its heading, so a reader lands on the card they chose.
  const header = useRef<HTMLDivElement>(null);
  const raisedKey = raised?.key;
  useEffect(() => {
    if (raisedKey) header.current?.querySelector<HTMLElement>('h1')?.focus({ preventScroll: true });
  }, [raisedKey]);

  // Corner actions are glyphs at every width, including desktop, and the journeys stay links.
  const actions: CornerAction[] = [
    { key: 'merchants', label: 'Merchants & MCCs', glyph: <Store size={20} aria-hidden />, to: '/cards/merchants' },
    { key: 'recommend', label: 'Which card?', glyph: <Sparkles size={20} aria-hidden />, to: '/recommend' },
  ];
  /*
   * An open card's sections — what the segmented tabs held on the card's page — are behind ⋯, each its own screen
   * under the raised card. A debit card has no statement: its spending settles against the account as it happens.
   */
  const debit = all.find((account) => account.id === cardId)?.subtype !== 'credit_card';
  const sections: CornerAction[] = cardId
    ? [
        ...(debit ? [] : [{ key: 'statement', label: 'Statement', search: { tab: 'statement' } }]),
        { key: 'points', label: 'Points', search: { tab: 'points' } },
        { key: 'rules', label: 'Rewards rules', search: { tab: 'rules' } },
        { key: 'card', label: 'Card details', search: { tab: 'card' } },
      ].map((item) => ({ ...item, to: '/cards/$cardId' as const, params: { cardId } }))
    : [];

  // A card's page for an account the stack does not hold stands on its own, as it always has. Until the stack has
  // loaded it cannot be told which, so nothing is drawn rather than the wrong one.
  if (cardId !== undefined && !raised) return data.isSuccess || accounts.isError ? <Outlet /> : null;

  return (
    <Screen>
      <div ref={header}>
        {raised ? (
          /*
           * Wallet's bar over an open pass: ✕ on the left, ⋯ on the right, and no title — the raised card is the
           * header. The card's name is still the heading a reader hears. In one of its sections the left button is
           * the way back to the card instead.
           */
          <header className="mb-[14px] flex items-center justify-between gap-3" style={{ paddingTop: 8 }}>
            {tab ? (
              <CornerButton
                label={`Back to ${raised.name}`}
                onClick={() => back(summaryAt.current, () => void navigate({ to: '/cards/$cardId', params: { cardId: raised.key }, replace: true }))}
              >
                <ChevronLeft size={22} aria-hidden />
              </CornerButton>
            ) : (
              <CornerButton label="Close" onClick={close}>
                <X size={20} aria-hidden />
              </CornerButton>
            )}
            <h1 tabIndex={-1} className="sr-only">
              {raised.name}
            </h1>
            <OverflowMenu actions={sections} />
          </header>
        ) : (
          <LargeTitle title="Cards & points" actions={actions} />
        )}
      </div>
      {!raised && accounts.isSuccess && cards.length === 0 && (
        <Empty>
          Add a credit card on the{' '}
          <Link to="/accounts" className="underline">
            Accounts
          </Link>{' '}
          page first.
        </Empty>
      )}
      {wallet.length > 0 && (
        <CardStack
          label="Your cards"
          cards={wallet}
          raised={raised?.key ?? null}
          onClose={close}
          onOpen={(key) => void navigate({ to: '/cards/$cardId', params: { cardId: key } })}
        >
          <Outlet />
        </CardStack>
      )}
      {!raised && spendable.length > 0 && (
        <InsetGroup
          header="Earning on a debit card?"
          footer="A debit card earns on the account it spends from, so pick that account and apply its card's terms. It joins the cards above once it does."
        >
          {spendable.map((account) => (
            <InsetRow key={account.id} title={account.name} to="/cards/$cardId" params={{ cardId: account.id }} />
          ))}
        </InsetGroup>
      )}
    </Screen>
  );
}
