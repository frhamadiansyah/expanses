import type { NamedPayment, SharedEventView } from '@expanses/db';
import { useNavigate } from '@tanstack/react-router';
import { Plus } from 'lucide-react';
import { useState } from 'react';
import { type CornerAction, InsetGroup, InsetRow, LargeTitle, SCREEN, type Segment, SegmentedControl } from '../../ui/native';
import { addSpendingTarget } from './buy-item';
import { eventDates } from './EventsPage';
import { SettleUpSheet } from './SettleUpSheet';
import { SharedPlanTab } from './SharedPlanTab';
import { useFetchEventRates } from './shared-queries';
import { balanceLine, expenseRow, headerLine, mineToSettle, paymentLine, settlementRow, waitingLine } from './shared-view';
import { TakeOverSheet } from './TakeOverSheet';

const TABS: readonly Segment[] = [
  { key: 'spending', label: 'Spending' },
  { key: 'balances', label: 'Balances' },
  { key: 'plan', label: 'Plan' },
];

/**
 * A shared event (shared events §6): its header — the dates, the currency, what was spent and this person's share —
 * then Spending, Balances and Plan. The ⋯ menu (People, Currency, Done, Leave) is `menu`'s, so this page reads the same
 * on every phone whatever its person may do.
 */
export function SharedEventPage({ view, menu = [] }: { view: SharedEventView; menu?: CornerAction[] }) {
  const navigate = useNavigate();
  const [tab, setTab] = useState('spending');
  const [settling, setSettling] = useState<NamedPayment | null>(null);
  const [takingOver, setTakingOver] = useState(false);
  useFetchEventRates(view.waiting.some((w) => w.reason === 'no-rate'));
  const waiting = waitingLine(view);
  const actions: CornerAction[] = [
    {
      key: 'add',
      label: 'Add spending',
      glyph: <Plus size={22} aria-hidden />,
      run: () => void navigate(addSpendingTarget(view.eventId)),
      disabled: view.finishedAt !== null || view.state !== 'active',
    },
    ...menu,
  ];
  // Settle up is offered on a payment this person pays or receives, or one between two people without the app — §3's
  // writer rule for settlements, which the repository enforces again.
  const mine = new Set(mineToSettle(view));
  const offerSettle = (p: NamedPayment) => mine.has(p) || !view.people.some((x) => x.hasApp && (x.personId === p.fromPersonId || x.personId === p.toPersonId));

  return (
    <div className={SCREEN} data-testid="shared-event">
      <LargeTitle title={view.name} back="Events" backTo="/events" actions={actions} subtitle={`${eventDates(view)} · ${view.currency}`} />
      <p className="px-[4px] pb-[12px] text-[15px] leading-[20px] text-[var(--ph-ink-2)]" data-testid="shared-event-header">
        {headerLine(view)}
      </p>
      {waiting ? (
        <InsetGroup>
          <InsetRow title={waiting} subtitle="Choose the account it came from" onClick={() => setTakingOver(true)} testId="take-over-row" />
        </InsetGroup>
      ) : null}
      <SegmentedControl label={`${view.name} sections`} segments={TABS} value={tab} onChange={setTab} />
      {tab === 'spending' ? (
        <InsetGroup>
          {[
            ...view.expenses.map((e) => {
              const row = expenseRow(e, view);
              return (
                <InsetRow
                  key={e.expenseId}
                  title={row.title}
                  subtitle={[row.detail, row.share, ...row.flags].filter(Boolean).join(' · ')}
                  value={row.amount}
                  onClick={e.voided || view.finishedAt ? undefined : () => void navigate({ to: '/transactions/new', search: { event: view.eventId, expense: e.expenseId } })}
                  testId="shared-expense-row"
                />
              );
            }),
            ...view.settlements.map((s) => {
              const row = settlementRow(s, view);
              return <InsetRow key={s.settlementId} title={row.title} subtitle={row.flags.join(' · ') || undefined} value={row.amount} testId="shared-settlement-row" />;
            }),
          ]}
        </InsetGroup>
      ) : null}
      {tab === 'balances' ? (
        <>
          <InsetGroup header="Balances">
            {view.people
              .filter((p) => !p.removed)
              .map((p) => (
                <InsetRow key={p.personId} title={balanceLine(p, view.currency)} subtitle={p.hasApp ? undefined : 'Without the app'} testId="shared-balance-row" />
              ))}
          </InsetGroup>
          <InsetGroup header="To settle up">
            {view.payments.map((p) => (
              <InsetRow
                key={`${p.fromPersonId}-${p.toPersonId}`}
                title={paymentLine(p, view.currency)}
                onClick={offerSettle(p) && !view.finishedAt ? () => setSettling(p) : undefined}
                label={`Settle up: ${paymentLine(p, view.currency)}`}
                testId="shared-payment-row"
              />
            ))}
          </InsetGroup>
        </>
      ) : null}
      {tab === 'plan' ? <SharedPlanTab view={view} /> : null}
      {settling ? <SettleUpSheet view={view} payment={settling} onClose={() => setSettling(null)} /> : null}
      {takingOver ? <TakeOverSheet view={view} onClose={() => setTakingOver(false)} /> : null}
    </div>
  );
}
