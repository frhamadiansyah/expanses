import { formatMinor, isoDate } from '@expanses/core';
import { useQuery } from '@tanstack/react-query';
import { Link, useNavigate } from '@tanstack/react-router';
import { Sparkles, Store } from 'lucide-react';
import type { ReactNode } from 'react';
import { useApp } from '../../app/context';
import { useAccounts } from '../../lib/queries';
import { Empty } from '../../ui';
import { CardStack, type CornerAction, InsetGroup, InsetRow, LargeTitle, type WalletCard } from '../../ui/native';
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

/** What the figure on a card's strip is called: the unit it is counted in, or that there is nothing counting yet. */
const figureLabelOf = (cp: CardPoints) => {
  if (!cp.program) return 'Rewards';
  return cp.program.unit === 'miles' ? 'Miles' : cp.program.unit === 'cashback' ? 'Cashback' : 'Points';
};

/**
 * The card wall: C3, the Wallet stack.
 *
 * Cards overlap like Apple Wallet, every card is visible at once, and tapping a covered one lifts it while the
 * rest slide down. The art is `CardFace`, unchanged — this screen only decides which cards are on the shelf and
 * what each one's figure says. Wide screens fan the stack sideways instead of overlapping it downwards.
 *
 * What the old two-column row carried — the digits, the cycle, what the points are worth — rides on each card's
 * strip, so a covered card still answers for itself without a tap.
 */
export function CardsPage() {
  const { database, ws } = useApp();
  const navigate = useNavigate();
  const accounts = useAccounts();
  const all = accounts.data ?? [];
  // A debit card is a bank account that earns, so it joins the credit cards once its terms are applied.
  const earning = useProgramAccounts().data ?? new Set<string>();
  const cards = all.filter((a) => a.archivedAt === null && (a.subtype === 'credit_card' || earning.has(a.id)));
  // Bank accounts that could carry a debit card but have no rewards yet: without these there is no way in.
  const spendable = all.filter((a) => a.archivedAt === null && ['bank', 'savings'].includes(a.subtype) && !earning.has(a.id));
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

  // Corner actions are glyphs at every width, including desktop, and the journeys stay links.
  const actions: CornerAction[] = [
    { key: 'merchants', label: 'Merchants & MCCs', glyph: <Store size={20} aria-hidden />, to: '/cards/merchants' },
    { key: 'recommend', label: 'Which card?', glyph: <Sparkles size={20} aria-hidden />, to: '/recommend' },
  ];

  return (
    <Screen>
      <LargeTitle title="Cards & points" actions={actions} />
      {accounts.isSuccess && cards.length === 0 && (
        <Empty>
          Add a credit card on the{' '}
          <Link to="/accounts" className="underline">
            Accounts
          </Link>{' '}
          page first.
        </Empty>
      )}
      {/* One section around the wall, so a card and its figures read as one thing however the stack is sitting. */}
      {wallet.length > 0 && (
        <section aria-label="Your cards">
          <CardStack cards={wallet} onOpen={(cardId) => void navigate({ to: '/cards/$cardId', params: { cardId } })} />
        </section>
      )}
      {spendable.length > 0 && (
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
