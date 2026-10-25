import type { NamedPayment, SharedEventView, SharedSettlementView } from '@expanses/db';
import { useNavigate } from '@tanstack/react-router';
import { formatMinor } from '@expanses/core';
import { CircleEllipsis, HandCoins, MoreHorizontal, Plus } from 'lucide-react';
import { useState } from 'react';
import { ErrorBox, Money } from '../../ui';
import { ICONS } from '../categories/CategoryIcon';
import { chartColour, OTHER_COLOUR } from '../transactions/category-colours';
import { Donut } from '../transactions/Donut';
import { type CornerAction, InsetGroup, InsetRow, Panel, rowPositions, SCREEN, type Segment, SegmentedControl, PushedTitle } from '../../ui/native';
import { addSpendingTarget } from './buy-item';
import { eventDates } from './EventsPage';
import { FinishSharing } from './FinishSharing';
import { SettlementSheet } from './SettlementSheet';
import { SettleUpSheet } from './SettleUpSheet';
import { SharedPlanTab } from './SharedPlanTab';
import { useFetchEventRates } from './shared-queries';
import { balanceBars, dayGroups, expenseRow, mineToSettle, pageLocks, paymentLine, readOnlyLine, settlementDeletable, settlementRow, shareLine, signedBalance, spendingSlices, waitingLine } from './shared-view';
import { TakeOverSheet } from './TakeOverSheet';

const TABS: readonly Segment[] = [
  { key: 'spending', label: 'Spending' },
  { key: 'balances', label: 'Balances' },
  { key: 'plan', label: 'Plan' },
];

/**
 * A shared event (shared events §6), laid out as a private one is: the dates and currency under the title, the tabs Spending,
 * Balances and Plan above a chart panel — the ring by category with the total and this person's share in its middle — and
 * the records by day below it. The ⋯ menu (People, Done, Leave) is `menu`'s, so this page reads the same
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
  const slices = spendingSlices(view);
  const days = dayGroups(view);
  const bars = balanceBars(view);
  const mine = new Set(mineToSettle(view));
  const offerSettle = (p: NamedPayment) => mine.has(p) || !view.people.some((x) => x.hasApp && (x.personId === p.fromPersonId || x.personId === p.toPersonId));

  return (
    <div className={SCREEN} data-testid="shared-event">
      <PushedTitle title={view.name} back="Events" backTo="/events" actions={actions} />
      <p className="-mt-[8px] mb-[14px] text-center text-[13px] leading-[17px] text-[var(--ph-ink-3)]">{`${eventDates(view)} · ${view.currency}`}</p>
      <ErrorBox error={error} />
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
      <div className="mb-[14px] w-full md:max-w-sm" data-testid="shared-event-tabs">
        <SegmentedControl label={`${view.name} sections`} segments={TABS} value={tab} onChange={setTab} />
      </div>
      {tab === 'spending' ? (
        <>
          <Panel testId="shared-event-total">
            {slices.length > 0 ? (
              <Donut
                slices={slices.map((slice) => ({ ...slice, colour: slice.key === 'none' ? OTHER_COLOUR : chartColour(slice.key) }))}
                totalMinor={slices.reduce((sum, slice) => sum + slice.totalMinor, 0)}
                middle={formatMinor(view.spentMinor, view.currency)}
                label="Total spent"
                under={shareLine(view)}
              />
            ) : (
              <div className="flex flex-col items-center py-[10px]">
                <span className="text-[12.5px] leading-[16px] text-[var(--ph-ink-3)]">Total spent</span>
                <span className="text-[24px] leading-[30px] font-bold text-[var(--ph-ink)]">{formatMinor(view.spentMinor, view.currency)}</span>
                <span className="text-[12.5px] leading-[16px] text-[var(--ph-ink-3)]">{shareLine(view)}</span>
              </div>
            )}
          </Panel>
          {days.map((day) => {
            const d = new Date(`${day.date}T00:00:00`);
            const positions = rowPositions(day.items.length);
            return (
              <Panel key={day.date} pad={false} testId="shared-event-day">
                <div className="flex items-center gap-3 border-b-[0.5px] border-[var(--ph-hair)] px-[13px] py-2">
                  <span className="tabular w-9 shrink-0 text-2xl leading-none font-semibold text-[var(--ph-ink)]">{d.getDate()}</span>
                  <span className="flex flex-col text-[12.5px] leading-tight text-[var(--ph-ink-3)]">
                    <b className="font-semibold text-[var(--ph-ink-2)]">{d.toLocaleDateString('en-GB', { weekday: 'long' })}</b>
                    {d.toLocaleDateString('en-GB', { month: 'long', year: 'numeric' })}
                  </span>
                  {day.spentMinor > 0 ? <Money minor={day.spentMinor} currency={view.currency} className="ml-auto text-[13px] font-semibold text-[var(--ph-ink-2)]" /> : null}
                </div>
                {day.items.map((item, index) => {
                  if (item.kind === 'settlement') {
                    const s = item.settlement;
                    const row = settlementRow(s, view);
                    return (
                      <InsetRow
                        key={s.settlementId}
                        position={{ ...positions[index]!, separator: index > 0 }}
                        icon={<HandCoins size={16} strokeWidth={2.2} aria-hidden />}
                        iconColour="var(--ph-tint)"
                        title={row.title}
                        subtitle={row.flags.join(' · ') || undefined}
                        value={row.amount}
                        onClick={!locked && settlementDeletable(s, view) ? () => setOpened(s) : undefined}
                        testId="shared-settlement-row"
                      />
                    );
                  }
                  const e = item.expense;
                  const row = expenseRow(e, view);
                  const Glyph = ICONS[view.categories.find((c) => c.categoryId === e.categoryId)?.icon ?? 'circle-ellipsis'] ?? CircleEllipsis;
                  return (
                    <InsetRow
                      key={e.expenseId}
                      position={{ ...positions[index]!, separator: index > 0 }}
                      icon={<Glyph size={16} strokeWidth={2.2} aria-hidden />}
                      iconColour={e.categoryId ? chartColour(e.categoryId) : OTHER_COLOUR}
                      title={row.title}
                      subtitle={[row.detail, ...row.flags].filter(Boolean).join(' · ')}
                      value={
                        <span className="flex flex-col items-end">
                          <span>{row.amount}</span>
                          {row.share ? <span className="text-[12.5px] leading-[16px] text-[var(--ph-ink-3)]">{row.share}</span> : null}
                        </span>
                      }
                      onClick={e.voided || locked ? undefined : () => void navigate({ to: '/transactions/new', search: { event: view.eventId, expense: e.expenseId } })}
                      testId="shared-expense-row"
                    />
                  );
                })}
              </Panel>
            );
          })}
        </>
      ) : null}
      {tab === 'balances' ? (
        <>
          <Panel header="Net balance" testId="shared-balance-bars">
            <div className="flex flex-col gap-[10px]">
              {bars.map((bar) => (
                <div key={bar.personId} className="flex items-center gap-[10px]" data-testid="shared-balance-row">
                  <span className="flex w-[100px] shrink-0 flex-col">
                    <span className="truncate text-[15px] leading-[20px] text-[var(--ph-ink)]">{bar.name}</span>
                    {bar.hasApp ? null : <span className="whitespace-nowrap text-[11px] leading-[14px] text-[var(--ph-ink-3)]">Without the app</span>}
                  </span>
                  <span className="h-[12px] min-w-0 flex-1" aria-hidden>
                    <span
                      className="block h-full rounded-full"
                      data-tone={bar.tone}
                      style={{ width: `${bar.percent}%`, minWidth: bar.percent > 0 ? 6 : 0, background: bar.tone === 'owing' ? 'var(--ph-warn)' : 'var(--ph-tint)' }}
                    />
                  </span>
                  <span className={`tabular shrink-0 text-[15px] leading-[20px] ${bar.tone === 'owing' ? 'text-[var(--ph-warn)]' : bar.tone === 'ahead' ? 'text-[var(--ph-tint)]' : 'text-[var(--ph-ink-3)]'}`}>
                    {signedBalance(bar.balanceMinor, view.currency)}
                  </span>
                </div>
              ))}
            </div>
          </Panel>
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
