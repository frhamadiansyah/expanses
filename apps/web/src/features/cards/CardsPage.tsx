import { isoDate } from '@expanses/core';
import { useQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { useApp } from '../../app/context';
import { useAccounts } from '../../lib/queries';
import { issuerColour, useCardIdentities, useCards } from './card-queries';
import { Card, Empty, Money, PageHeader } from '../../ui';
import { formatPoints, loadCardPoints, pointsValue, shortDate } from './useCardPoints';

export function CardsPage() {
  const { database, ws } = useApp();
  const accounts = useAccounts();
  const all = accounts.data ?? [];
  const cards = all.filter((a) => a.subtype === 'credit_card' && a.archivedAt === null);
  const identities = useCardIdentities().data ?? {};
  const plastic = useCards().data ?? [];
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
            <div className="flex items-center justify-between gap-3">
              <div className="min-w-0">
                <span
                  aria-hidden
                  className="mr-2 inline-block h-4 w-6 shrink-0 rounded-sm align-[-2px]"
                  style={{ background: issuerColour(identities[cp.card.id]?.issuer ?? null) }}
                />
                <Link to="/cards/$cardId" params={{ cardId: cp.card.id }} className="font-medium hover:underline">
                  {cp.card.name}
                </Link>
                {/* The plastic, not the account: one statement can carry a supplementary card too. */}
                {plastic
                  .filter((card) => card.accountId === cp.card.id && card.last4 !== null)
                  .map((card) => (
                    <span key={card.id} data-testid="card-last4" className="ml-2 text-xs tabular text-slate-500">
                      ···· {card.last4}
                      {card.holderName ? ` ${card.holderName}` : ''}
                    </span>
                  ))}
                {cp.catalog.entry && <span className="ml-2 text-xs uppercase tracking-wide text-slate-400">{cp.catalog.entry.network}</span>}
                <div className="text-xs text-slate-500">
                  {!cp.terms ? 'Add statement day to see points' : cp.current ? `This cycle ${shortDate(cp.current.cycle.start)} – ${shortDate(cp.current.cycle.end)}` : 'Rewards not set up'}
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
    </div>
  );
}
