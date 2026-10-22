import type { NamedPayment, SharedEventView, SharedSettlementView } from '@expanses/db';
import { useNavigate } from '@tanstack/react-router';
import { MoreHorizontal, Plus } from 'lucide-react';
import { useState } from 'react';
import { ErrorBox } from '../../ui';
import { type CornerAction, InsetGroup, InsetRow, SCREEN, type Segment, SegmentedControl, PushedTitle } from '../../ui/native';
import { addSpendingTarget } from './buy-item';
import { eventDates } from './EventsPage';
import { FinishSharing } from './FinishSharing';
import { SettlementSheet } from './SettlementSheet';
import { SettleUpSheet } from './SettleUpSheet';
import { SharedPlanTab } from './SharedPlanTab';
import { useFetchEventRates } from './shared-queries';
import { balanceLine, expenseRow, headerLine, mineToSettle, pageLocks, paymentLine, readOnlyLine, settlementDeletable, settlementRow, waitingLine } from './shared-view';
import { TakeOverSheet } from './TakeOverSheet';

const TABS: readonly Segment[] = [
  { key: 'spending', label: 'Spending' },
  { key: 'balances', label: 'Balances' },
  { key: 'plan', label: 'Plan' },
];

/**
 * A shared event (shared events §6): its header — the dates, the currency, what was spent and this person's share —
 * then Spending, Balances and Plan. The ⋯ menu (People, Done, Leave) is `menu`'s, so this page reads the same
 * on every phone whatever its person may do.
 *
 * Done locks every write but Reopen; an event this phone's person is no longer in (left, or removed) is kept to read,
 * with a notice in place of every action (I5). `error` is the menu's, drawn under the title as other screens draw it.
 */
export function SharedEventPage({ view, menu = [], error = null }: { view: SharedEventView; menu?: CornerAction[]; error?: unknown }) {
  const navigate = useNavigate();
  const [tab, setTab] = useState('spending');
  const [settling, setSettling] = useState<NamedPayment | null>(null);
  const [opened, setOpened] = useState<SharedSettlementView | null>(null);
  const [takingOver, setTakingOver] = useState(false);
  const { readOnly, locked } = pageLocks(view);
  useFetchEventRates(view.waiting.some((w) => w.reason === 'no-rate'));
  const waiting = waitingLine(view);
  // Read-only, there is nothing to add and the menu is People alone: it stays behind a ⋯ rather than becoming a corner
  // button of its own, which would be a circle with no glyph (a corner button never carries a word).
  const actions: CornerAction[] = readOnly
    ? [{ key: 'more', label: 'More', glyph: <MoreHorizontal size={20} aria-hidden />, menu }]
    : [
        {
          key: 'add',
          label: 'Add spending',
          glyph: <Plus size={22} aria-hidden />,
          run: () => void navigate(addSpendingTarget(view.eventId)),
          disabled: locked,
        },
        ...menu,
      ];
  // Settle up is offered on a payment this person pays or receives, or one between two people without the app — §3's
  // writer rule for settlements, which the repository enforces again.
  const mine = new Set(mineToSettle(view));
  const offerSettle = (p: NamedPayment) => mine.has(p) || !view.people.some((x) => x.hasApp && (x.personId === p.fromPersonId || x.personId === p.toPersonId));

  return (
    <div className={SCREEN} data-testid="shared-event">
      <PushedTitle title={view.name} back="Events" backTo="/events" actions={actions} />
      <p className="-mt-[8px] mb-[14px] text-center text-[13px] leading-[17px] text-[var(--ph-ink-3)]">{`${eventDates(view)} · ${view.currency}`}</p>
      <ErrorBox error={error} />
      <p className="px-[4px] pb-[12px] text-[15px] leading-[20px] text-[var(--ph-ink-2)]" data-testid="shared-event-header">
        {headerLine(view)}
      </p>
      {readOnly ? (
        <InsetGroup>
          <InsetRow title={readOnlyLine(view)} chevron={false} testId="shared-event-read-only" />
        </InsetGroup>
      ) : null}
      {locked ? null : <FinishSharing view={view} />}
      {waiting && !readOnly ? (
        <InsetGroup>
          <InsetRow title={waiting} subtitle="Choose the account for each" onClick={() => setTakingOver(true)} testId="take-over-row" />
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
                  onClick={e.voided || locked ? undefined : () => void navigate({ to: '/transactions/new', search: { event: view.eventId, expense: e.expenseId } })}
                  testId="shared-expense-row"
                />
              );
            }),
            ...view.settlements.map((s) => {
              const row = settlementRow(s, view);
              return (
                <InsetRow
                  key={s.settlementId}
                  title={row.title}
                  subtitle={row.flags.join(' · ') || undefined}
                  value={row.amount}
                  onClick={!locked && settlementDeletable(s, view) ? () => setOpened(s) : undefined}
                  testId="shared-settlement-row"
                />
              );
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
                onClick={offerSettle(p) && !locked ? () => setSettling(p) : undefined}
                label={`Settle up: ${paymentLine(p, view.currency)}`}
                testId="shared-payment-row"
              />
            ))}
          </InsetGroup>
        </>
      ) : null}
      {tab === 'plan' ? <SharedPlanTab view={view} /> : null}
      {opened ? <SettlementSheet view={view} settlement={opened} onClose={() => setOpened(null)} /> : null}
      {settling ? <SettleUpSheet view={view} payment={settling} onClose={() => setSettling(null)} /> : null}
      {takingOver ? <TakeOverSheet view={view} onClose={() => setTakingOver(false)} /> : null}
    </div>
  );
}
