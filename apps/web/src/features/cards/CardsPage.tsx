import { isoDate } from '@expanses/core';
import { useQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { useApp } from '../../app/context';
import { useAccounts } from '../../lib/queries';
import { CardFace } from './CardFace';
import { useCardIdentities, useCards, useProgramAccounts } from './card-queries';
import { Card, Empty, Money, PageHeader } from '../../ui';
import { formatPoints, loadCardPoints, pointsValue, shortDate } from './useCardPoints';

/** How far each supplementary card peeks out from behind the one in front. */
const STACK_OFFSET = 26;

export function CardsPage() {
  const { database, ws } = useApp();
  const accounts = useAccounts();
  const all = accounts.data ?? [];
  // A debit card is a bank account that earns, so it joins the credit cards once its terms are applied.
  const earning = useProgramAccounts().data ?? new Set<string>();
  const cards = all.filter((a) => a.archivedAt === null && (a.subtype === 'credit_card' || earning.has(a.id)));
  // Bank accounts that could carry a debit card but have no rewards yet: without these there is no way in.
  const spendable = all.filter((a) => a.archivedAt === null && ['bank', 'savings'].includes(a.subtype) && !earning.has(a.id));
  const identities = useCardIdentities().data ?? {};
  const plastic = useCards().data ?? [];
  /** The cards on an account, back to front; an account with none recorded still gets one face. */
  const stackOf = (accountId: string) => {
    // Supplementary cards first, so the primary card is drawn last and sits in front.
    const own = plastic.filter((card) => card.accountId === accountId).sort((a, b) => Number(a.isPrimary) - Number(b.isPrimary));
    return own.length > 0 ? own : [null];
  };
  const today = isoDate();
  const data = useQuery({
    // Distinct from the card page's key: this query caches an array, that one a single CardPoints.
    queryKey: ['card-points-list', ws.workspaceId, today, cards.map((c) => c.id).join(',')],
    enabled: accounts.isSuccess,
    queryFn: () => Promise.all(cards.map((card) => loadCardPoints(database, ws, card, all, today))),
  });

  return (
    <div className="space-y-4">
      <PageHeader
        title="Cards & points"
        action={
          <div className="flex items-center gap-3">
            <Link to="/cards/merchants" className="text-sm underline">
              Merchants & MCCs
            </Link>
            <Link to="/recommend" className="rounded-lg bg-slate-900 px-3 py-2 text-sm font-medium text-white hover:bg-slate-700">
              Which card?
            </Link>
          </div>
        }
      />
      {accounts.isSuccess && cards.length === 0 && (
        <Empty>
          Add a credit card on the{' '}
          <Link to="/accounts" className="underline">
            Accounts
          </Link>{' '}
          page first.
        </Empty>
      )}
      {(data.data ?? []).map((cp) => {
        const points = cp.current?.earn.totalPoints ?? 0;
        const value = pointsValue(points, cp.best);
        return (
          <Card key={cp.card.id}>
            <div className="flex flex-wrap items-center gap-5">
              {/* The plastic, not the account: one statement can carry a supplementary card too, stacked behind. */}
              <Link
                to="/cards/$cardId"
                params={{ cardId: cp.card.id }}
                // A shortcut for the mouse; the name beside it is the link for keyboards and screen readers.
                aria-hidden
                tabIndex={-1}
                className="relative block shrink-0"
                style={{
                  width: `calc(15rem + ${(stackOf(cp.card.id).length - 1) * STACK_OFFSET}px)`,
                  height: `calc(15rem / 1.586 + ${(stackOf(cp.card.id).length - 1) * STACK_OFFSET * 0.5}px)`,
                }}
              >
                {stackOf(cp.card.id).map((piece, index, stack) => (
                  <div
                    key={piece?.id ?? 'account'}
                    className="absolute"
                    // The front card sits top-left; each card behind it shows a strip down its right and bottom edges.
                    style={{ left: (stack.length - 1 - index) * STACK_OFFSET, top: (stack.length - 1 - index) * STACK_OFFSET * 0.5, zIndex: index }}
                  >
                    <CardFace
                      issuer={identities[cp.card.id]?.issuer ?? null}
                      name={cp.card.name}
                      last4={piece?.last4 ?? null}
                      holderName={piece?.holderName}
                      network={cp.catalog.entry?.network}
                      look={cp.catalog.entry?.look}
                      behind={index < stack.length - 1}
                    />
                  </div>
                ))}
              </Link>
              <div className="min-w-0 flex-1">
                <Link to="/cards/$cardId" params={{ cardId: cp.card.id }} className="font-medium hover:underline">
                  {cp.card.name}
                </Link>
                <div className="mt-0.5 flex flex-wrap gap-x-3">
                  {plastic
                    .filter((card) => card.accountId === cp.card.id && card.last4 !== null)
                    .map((card) => (
                      <span key={card.id} data-testid="card-last4" className="text-xs tabular text-slate-500">
                        ···· {card.last4}
                        {card.holderName ? ` ${card.holderName}` : ''}
                      </span>
                    ))}
                </div>
                <div className="mt-1 text-xs text-slate-500">
                  {!cp.terms && cp.card.subtype === 'credit_card'
                    ? 'Add statement day to see points'
                    : cp.current
                      ? `This cycle ${shortDate(cp.current.cycle.start)} – ${shortDate(cp.current.cycle.end)}`
                      : 'Rewards not set up'}
                </div>
              </div>
              {cp.current ? (
                <div className="text-right">
                  <div className="tabular font-semibold">
                    {formatPoints(points)} {cp.program!.unit}
                  </div>
                  {value !== null && cp.best && (
                    <div className="text-xs text-slate-500">
                      ≈ <Money minor={value} currency={cp.best.currency} />
                    </div>
                  )}
                </div>
              ) : (
                <Link to="/cards/$cardId" params={{ cardId: cp.card.id }} className="text-sm font-medium underline">
                  Set up
                </Link>
              )}
            </div>
          </Card>
        );
      })}
      {spendable.length > 0 && (
        <Card>
          <div className="text-sm font-medium">Earning on a debit card?</div>
          <p className="mt-1 text-sm text-slate-600">
            A debit card earns on the account it spends from, so pick that account and apply its card's terms. It joins
            the cards above once it does.
          </p>
          <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1">
            {spendable.map((account) => (
              <Link key={account.id} to="/cards/$cardId" params={{ cardId: account.id }} className="text-sm underline">
                {account.name}
              </Link>
            ))}
          </div>
        </Card>
      )}
    </div>
  );
}
