import type { NamedPayment, SharedEventView, SharedSettlementView } from '@expanses/db';
import { useNavigate, useSearch } from '@tanstack/react-router';
import { formatMinor } from '@expanses/core';
import { ArrowLeftRight, CircleEllipsis, HandCoins, MoreHorizontal, Plus } from 'lucide-react';
import { type ReactNode, useState } from 'react';
import { ErrorBox, Money } from '../../ui';
import { ICONS } from '../categories/CategoryIcon';
import { chartColour, OTHER_COLOUR } from '../transactions/category-colours';
import { ShareLine } from '../transactions/CategoryLines';
import { type CornerAction, InsetGroup, InsetRow, Panel, rowPositions, SCREEN, PushedTitle } from '../../ui/native';
import { addSpendingTarget } from './buy-item';
import { EventModeGroup } from './EventMode';
import { eventDates } from './EventsPage';
import { EventNameBox } from './EventNameBox';
import { FinishSharing } from './FinishSharing';
import { SettlementSheet } from './SettlementSheet';
import { SettleUpSheet } from './SettleUpSheet';
import { HeroSwipe } from './HeroSwipe';
import { SharedPlanHero, SharedPlanTab } from './SharedPlanTab';
import { useFetchEventRates, useSharedEventPlan } from './shared-queries';
import { balanceBars, dayGroups, expenseRow, mineToSettle, pageLocks, paymentLine, pickedDays, readOnlyLine, settlementDeletable, settlementRow, signedBalance, spendingSlices, transferRow, waitingLine } from './shared-view';
import { TakeOverSheet } from './TakeOverSheet';

const CARDS = ['spending', 'balances', 'plan'] as const;

const RING = 2 * Math.PI * 42;

/** Where each category's arc starts and how long it runs round the ring, a hair apart when there are several. */
function ringArcs(slices: readonly { key: string; totalMinor: number }[], whole: number) {
  const gap = slices.length > 1 ? 3 : 0;
  let at = 0;
  return slices.map((slice) => {
    const share = whole > 0 ? (slice.totalMinor / whole) * RING : 0;
    const arc = { key: slice.key, start: at, length: Math.max(0.5, share - gap) };
    at += share;
    return arc;
  });
}

/**
 * A shared event (shared events §6), laid out as a private one is: the dates as the bar's title, the name in a box at the top of the Spending panel only, the tabs Spending,
 * Balances and Plan above a chart panel — the ring by category with the total in its middle — and
 * the records by day below it. The ⋯ menu (People, Done, Leave) is `menu`'s, so this page reads the same
 * on every phone whatever its person may do.
 *
 * Done locks every write but Reopen; an event this phone's person is no longer in (left, or removed) is kept to read,
 * with a notice at the top of Balances and no action anywhere (I5). `error` is the menu's, drawn under the title as other screens draw it.
 */
export function SharedEventPage({ view, menu = [], error = null }: { view: SharedEventView; menu?: CornerAction[]; error?: unknown }) {
  const navigate = useNavigate();
  // Back from a cost's page lands on the Plan card, which is where the trip was left.
  const { card: arrivedOn } = useSearch({ from: '/events/$eventId' });
  const [card, setCard] = useState(arrivedOn === 'plan' ? CARDS.indexOf('plan') : 0);
  const plan = useSharedEventPlan(view.eventId);
  const [settling, setSettling] = useState<NamedPayment | null>(null);
  const [opened, setOpened] = useState<SharedSettlementView | null>(null);
  const [takingOver, setTakingOver] = useState(false);
  const [picked, setPicked] = useState<string | null>(null);
  /* The category rows under the ring, folded away until the ring is tapped — the private event page does the same. */
  const [showRows, setShowRows] = useState(false);
  const { readOnly, locked } = pageLocks(view);
  useFetchEventRates(view.waiting.some((w) => w.reason === 'no-rate'));
  const waiting = waitingLine(view);
  // Read-only, there is nothing to add and the menu is People alone: it stays behind a ⋯ rather than becoming a corner
  // button of its own, which would be a circle with no glyph (a corner button never carries a word).
  // Everything is one ⋯: a corner button never carries a word, so Add spending (a line of the menu, not a ＋ of its own)
  // goes inside it rather than standing in the bar as a circle with no glyph.
  const actions: CornerAction[] = [
    // On the Plan card the bar's ＋ adds a cost, as it does on the private plan.
    ...(CARDS[card] === 'plan' && !locked
      ? [{ key: 'add-cost', label: 'Add a cost', glyph: <Plus size={22} aria-hidden />, to: '/events/$eventId/shared-plan/new', params: { eventId: view.eventId } } satisfies CornerAction]
      : []),
    {
      key: 'more',
      label: 'More',
      glyph: <MoreHorizontal size={20} aria-hidden />,
      menu: readOnly ? menu : [{ key: 'add', label: 'Add spending', run: () => void navigate(addSpendingTarget(view.eventId)), disabled: locked }, ...menu],
    },
  ];
  // Settle up is offered on a payment this person pays or receives, or one between two people without the app — §3's
  // writer rule for settlements, which the repository enforces again.
  const slices = spendingSlices(view);
  const days = pickedDays(dayGroups(view), picked);
  const whole = slices.reduce((sum, slice) => sum + slice.totalMinor, 0);
  // The ring is the switch for its own rows: one tap shows them, another folds them and drops any category picked.
  const fold = () => {
    if (showRows) setPicked(null);
    setShowRows(!showRows);
  };
  const pick = (key: string) => setPicked(picked === key ? null : key);
  const chartFrame = (content: ReactNode) => (
    <div
      role="button"
      tabIndex={0}
      onClick={fold}
      onKeyDown={(event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          fold();
        }
      }}
      aria-expanded={showRows}
      aria-label={showRows ? 'Hide categories' : 'See all categories'}
      data-testid={showRows ? 'hide-categories' : 'see-categories'}
      className="block w-full cursor-pointer"
    >
      {content}
    </div>
  );
  const colourOf = (key: string) => (key === 'none' ? OTHER_COLOUR : chartColour(key));
  const bars = balanceBars(view);
  const mine = new Set(mineToSettle(view));
  const offerSettle = (p: NamedPayment) => mine.has(p) || !view.people.some((x) => x.hasApp && (x.personId === p.fromPersonId || x.personId === p.toPersonId));

  const topThree = slices.slice(0, 3);
  const cardBox = 'flex flex-1 flex-col justify-center rounded-[11px] bg-[var(--ph-surface)]';
  // The Spending card: the ring by category beside the total and the three biggest categories. The name sits above, out of the
  // tap target; the rest of the card is the switch for the full category rows under the hero.
  const spendingCard = (
    <div className={`${cardBox} px-[14px] py-[14px]`} data-testid="shared-event-total">
      <EventNameBox name={view.name} />
      {slices.length > 0 ? (
        chartFrame(
          <div className="flex items-center gap-[14px]">
            <svg viewBox="0 0 100 100" width={104} height={104} role="img" aria-label={`${formatMinor(view.spentMinor, view.currency)} Total spent`} className="shrink-0">
              <circle cx="50" cy="50" r="42" fill="none" stroke="var(--ph-track)" strokeWidth="12" />
              {ringArcs(slices, whole).map((arc) => (
                <circle
                  key={arc.key}
                  cx="50"
                  cy="50"
                  r="42"
                  fill="none"
                  stroke={colourOf(arc.key)}
                  strokeWidth="12"
                  strokeDasharray={`${arc.length} ${RING - arc.length}`}
                  strokeDashoffset={-arc.start}
                  transform="rotate(-90 50 50)"
                  opacity={picked === null || picked === arc.key ? 1 : 0.25}
                />
              ))}
              <text x="50" y="46" textAnchor="middle" dominantBaseline="central" fontSize="22" fontWeight="700" fill="var(--ph-ink)">
                {slices.length}
              </text>
              <text x="50" y="63" textAnchor="middle" dominantBaseline="central" fontSize="10" fill="var(--ph-ink-3)">
                {slices.length === 1 ? 'category' : 'categories'}
              </text>
            </svg>
            <div className="min-w-0 flex-1">
              <div className="text-[12px] leading-[15px] text-[var(--ph-ink-3)]">Total spent</div>
              <div className="tabular text-[clamp(13px,5cqw,20px)] leading-[26px] font-bold whitespace-nowrap text-[var(--ph-ink)]">{formatMinor(view.spentMinor, view.currency)}</div>
              {topThree.map((slice) => (
                <div key={slice.key} className="mt-[5px] flex justify-between gap-2 text-[12px] leading-[15px] text-[var(--ph-ink-3)]">
                  <span className="min-w-0 truncate">{slice.label}</span>
                  <span className="tabular shrink-0 whitespace-nowrap">{formatMinor(slice.totalMinor, view.currency)}</span>
                </div>
              ))}
            </div>
          </div>,
        )
      ) : (
        <div className="flex flex-col items-center py-[10px]">
          <span className="text-[12.5px] leading-[16px] text-[var(--ph-ink-3)]">Total spent</span>
          <span className="text-[24px] leading-[30px] font-bold text-[var(--ph-ink)]">{formatMinor(view.spentMinor, view.currency)}</span>
        </div>
      )}
    </div>
  );
  // The Balances card: the Net balance panel as it was, a bar per person.
  const balanceCard = (
    <div className={`${cardBox} px-[13px] py-[13px]`} data-testid="shared-balance-bars">
      <h2 className="pb-[8px] text-[11.5px] leading-[14px] font-semibold tracking-[0.06em] text-[var(--ph-ink-3)] uppercase">Net balance</h2>
      <div className="flex flex-col gap-[10px]">
        {bars.map((bar) => (
          <div key={bar.personId} className="flex items-center gap-[10px]" data-testid="shared-balance-row">
            <span className="w-[100px] shrink-0 truncate text-[15px] leading-[20px] text-[var(--ph-ink)]">{bar.name}</span>
            <span className="h-[12px] min-w-0 flex-1" aria-hidden>
              <span
                className="block h-full rounded-full"
                data-tone={bar.tone}
                style={{ width: `${bar.percent}%`, minWidth: bar.percent > 0 ? 6 : 0, background: bar.tone === 'owing' ? 'var(--ph-warn)' : 'var(--ph-up)' }}
              />
            </span>
            <span className={`tabular shrink-0 text-[15px] leading-[20px] ${bar.tone === 'owing' ? 'text-[var(--ph-warn)]' : bar.tone === 'ahead' ? 'text-[var(--ph-up)]' : 'text-[var(--ph-ink-3)]'}`}>
              {signedBalance(bar.balanceMinor, view.currency)}
            </span>
          </div>
        ))}
      </div>
    </div>
  );

  return (
    <div className={SCREEN} data-testid="shared-event">
      <PushedTitle title={eventDates(view)} back="Events" backTo="/events" actions={actions} />
      <ErrorBox error={error} />
      {locked ? null : <FinishSharing view={view} />}
      {waiting && !readOnly ? (
        <InsetGroup>
          <InsetRow title={waiting} subtitle="Choose the account for each" onClick={() => setTakingOver(true)} testId="take-over-row" />
        </InsetGroup>
      ) : null}
      {/* Event mode (screen 1): this phone's own, so each person in the event turns it on for themselves. */}
      {locked ? null : <EventModeGroup event={{ id: view.eventId, name: view.name, startsOn: view.startsOn, endsOn: view.endsOn, currency: view.currency }} />}
      <HeroSwipe
        label={`${view.name} sections`}
        active={card}
        onActive={setCard}
        slides={[
          { key: 'spending', label: 'Spending', node: spendingCard },
          { key: 'balances', label: 'Balances', node: balanceCard },
          { key: 'plan', label: 'Plan', node: <SharedPlanHero view={view} plan={plan.data} /> },
        ]}
      />
      {CARDS[card] === 'spending' ? (
        <>
          {slices.length > 0 && !showRows ? <p className="mb-[10px] text-center text-[12.5px] leading-[16px] text-[var(--ph-ink-3)]">Tap the card to see all categories</p> : <div className="mb-[6px]" />}
          {showRows && slices.length > 0 ? (
            <Panel testId="shared-event-categories" className="[&>*+*]:border-t-[0.5px] [&>*+*]:border-[var(--ph-hair)]">
              {slices.map((slice) => (
                <button
                  type="button"
                  key={slice.key}
                  onClick={() => pick(slice.key)}
                  aria-pressed={picked === slice.key}
                  data-testid="event-category-row"
                  className={`ph-focus-inset -mx-[13px] flex min-h-12 w-[calc(100%+26px)] flex-col justify-center px-[13px] py-2.5 text-left ${picked === slice.key ? 'bg-[var(--ph-fill)]' : ''}`}
                >
                  <ShareLine colour={colourOf(slice.key)} name={slice.label} amountMinor={slice.totalMinor} wholeMinor={whole} currency={view.currency} chevron={false} />
                </button>
              ))}
            </Panel>
          ) : null}
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
                  if (item.kind === 'transfer') {
                    // A household transfer listed here (an ATM withdrawal): grey, not counted, no share. The phone that
                    // recorded it opens its transaction, where Remove from event puts it back in its workspace.
                    const t = item.transfer;
                    const row = transferRow(t);
                    return (
                      <InsetRow
                        key={`transfer-${t.transferId}`}
                        position={{ ...positions[index]!, separator: index > 0 }}
                        icon={<ArrowLeftRight size={16} strokeWidth={2.2} aria-hidden />}
                        iconColour="var(--ph-ink-3)"
                        title={row.title}
                        subtitle={row.subtitle}
                        value={<span className="text-[var(--ph-ink-3)]">{row.amount}</span>}
                        onClick={t.transactionId ? () => void navigate({ to: '/transactions/$transactionId', params: { transactionId: t.transactionId! } }) : undefined}
                        testId="shared-transfer-row"
                      />
                    );
                  }
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
      {CARDS[card] === 'balances' ? (
        <>
          {readOnly ? (
            <InsetGroup>
              <InsetRow title={readOnlyLine(view)} chevron={false} testId="shared-event-read-only" />
            </InsetGroup>
          ) : null}
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
      {CARDS[card] === 'plan' ? <SharedPlanTab view={view} plan={plan.data} error={plan.error} /> : null}
      {opened ? <SettlementSheet view={view} settlement={opened} onClose={() => setOpened(null)} /> : null}
      {settling ? <SettleUpSheet view={view} payment={settling} onClose={() => setSettling(null)} /> : null}
      {takingOver ? <TakeOverSheet view={view} onClose={() => setTakingOver(false)} /> : null}
    </div>
  );
}
