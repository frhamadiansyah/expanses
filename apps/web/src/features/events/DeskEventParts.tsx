import { type EventPlan, type EventPlanItemView, formatMinor, minorToMajorString } from '@expanses/core';
import { Link, useNavigate } from '@tanstack/react-router';
import { Check, ChevronDown, Settings } from 'lucide-react';
import { type ReactNode, type RefObject, useEffect, useRef, useState } from 'react';
import { DeskNotices } from '../../app/DeskNotices';
import { cx, Money } from '../../ui';
import { BOX, BoxHead } from '../transactions/CashflowBoxes';
import { PBTN, PlanBar } from './DesktopEvents';
import { DeskEventModeSwitch } from './EventMode';
import { paymentsLine, planItemStatus, planLine, readPlanned, titleMenu } from './events-desk-model';
import { useNewEvent } from './NewEventFlow';
import { quantityWords } from './plan-view';
import { useEvents } from './queries';
import { isoDate } from '@expanses/core';

/*
 * The parts of a Mac event page (option A, owner 2026-11-18) a private event and a shared trip both draw: the title bar
 * with its pop-up menu of events, the boxes' rows, the table's tabs and the Plan table. Figures are handed in — each read
 * the way the phone reads it — so the parts hold no queries but the event list the menu names.
 */

export const TH = 'border-b border-[var(--ph-hair)] bg-[var(--mac-head)] px-[10px] py-[6px] text-left text-[11px] font-semibold whitespace-nowrap text-[var(--ph-ink-3)]';
export const TD = 'px-[10px] py-[6px] align-middle';
const GBTN =
  'inline-flex h-[26px] items-center justify-center rounded-[6px] border border-[var(--ph-chevron)] bg-[var(--ph-surface)] px-[8px] text-[12.5px] text-[var(--ph-ink)] hover:bg-[var(--ph-fill)]';

/** The event page's grey ground, edge to edge, with the bar on top. */
export function EventDesk({ testId, children }: { testId: string; children: ReactNode }) {
  return (
    <div className="min-h-dvh bg-[var(--ov-ground)]" data-testid={testId} data-desk="true">
      {children}
    </div>
  );
}

/**
 * The event page's title bar: ‹ Events, the event's name as a pop-up menu (every event, Now and next then Past, with its
 * first day and a ✓ on this one; ＋ New event; All events…), its dates and currency, the Shared chip, Event mode, ⚙ (the
 * event's Settings page) and the black ＋ Add spending.
 */
export function EventTitleBar({
  barRef,
  eventId,
  name,
  dates,
  chip,
  mode,
  settings,
  add,
}: {
  barRef: RefObject<HTMLElement | null>;
  eventId: string;
  name: string;
  /** "14–18 Sep 2026 · SGD": the dates, and the event's own currency when it is not the base. */
  dates: string;
  chip: string | null;
  /** The Event mode switch's event, or null where none is offered (a shared trip that is done or left). */
  mode: Parameters<typeof DeskEventModeSwitch>[0]['event'] | null;
  settings: { to: '/events/$eventId/settings' | '/events/$eventId/shared-settings' };
  add: { label: string; run: () => void; disabled?: boolean } | null;
}) {
  return (
    <>
      <header ref={barRef} className="desk-titlebar sticky top-0 z-20 flex h-[52px] items-center gap-[10px] border-b border-[var(--ph-hair)] bg-[var(--ph-surface)] pr-[14px] pl-[14px]">
        <Link to="/events" className="shrink-0 text-[13px] text-[var(--ph-ink-3)] hover:text-[var(--ph-ink)]" aria-label="Events">
          <span aria-hidden>‹ </span>Events
        </Link>
        <EventMenu eventId={eventId} name={name} />
        <span data-testid="event-dates" className="min-w-0 shrink truncate text-[12.5px] text-[var(--ph-ink-3)]">
          {dates}
        </span>
        {chip && (
          <span data-testid="event-shared-chip" className="shrink-0 rounded-[5px] bg-[var(--ph-fill)] px-[6px] py-[1px] text-[11px] whitespace-nowrap text-[var(--ph-ink-2)]">
            {chip}
          </span>
        )}
        <span className="flex-1" />
        {mode && <DeskEventModeSwitch event={mode} />}
        <Link to={settings.to} params={{ eventId }} aria-label="Settings" title="Settings" className={GBTN}>
          <Settings size={14} aria-hidden />
        </Link>
        {add && (
          <button type="button" className={PBTN} onClick={add.run} disabled={add.disabled}>
            <span aria-hidden>＋</span>
            {add.label}
          </button>
        )}
      </header>
      <DeskNotices />
    </>
  );
}

/** The name as a pop-up menu: another event opens in its place; ＋ New event and All events… close it. */
function EventMenu({ eventId, name }: { eventId: string; name: string }) {
  const navigate = useNavigate();
  const events = useEvents().data ?? [];
  const create = useNewEvent();
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  const sections = titleMenu(events, isoDate(), eventId);
  useEffect(() => {
    if (!open) return;
    const away = (event: MouseEvent) => {
      if (!box.current?.contains(event.target as Node)) setOpen(false);
    };
    const keys = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        event.stopPropagation();
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', away, true);
    window.addEventListener('keydown', keys, true);
    return () => {
      document.removeEventListener('mousedown', away, true);
      window.removeEventListener('keydown', keys, true);
    };
  }, [open]);
  const item = 'flex w-full items-center gap-[8px] rounded-[5px] px-[10px] py-[4px] text-left text-[13px]';
  return (
    <div ref={box} className="relative min-w-0 shrink">
      <h1 className="min-w-0">
        <button
          type="button"
          aria-haspopup="menu"
          aria-expanded={open}
          data-testid="event-title-menu"
          onClick={() => setOpen(!open)}
          className={cx('flex max-w-[340px] items-center gap-[4px] rounded-[6px] px-[8px] py-[2px] text-[15px] font-semibold text-[var(--ph-ink)] hover:bg-[var(--ph-fill)]', open && 'bg-[var(--ph-fill)]')}
        >
          <span className="truncate">{name}</span>
          <ChevronDown size={13} aria-hidden className="shrink-0 text-[var(--ph-ink-3)]" />
        </button>
      </h1>
      {open && (
        <div role="menu" aria-label="Events" className="absolute top-[34px] left-0 z-30 w-[300px] rounded-[10px] border border-[var(--ph-hair)] bg-[var(--ph-surface)] p-[5px] shadow-[0_8px_28px_rgba(0,0,0,0.18)]">
          {sections.map((section) => (
            <div key={section.title} role="group" aria-label={section.title}>
              <div className="px-[10px] pt-[6px] pb-[3px] text-[10.5px] font-semibold tracking-[0.06em] text-[var(--ph-ink-3)] uppercase">{section.title}</div>
              {section.rows.map((row) => (
                <button
                  key={row.id}
                  type="button"
                  role="menuitemradio"
                  aria-checked={row.current}
                  onClick={() => {
                    setOpen(false);
                    if (!row.current) void navigate({ to: '/events/$eventId', params: { eventId: row.id } });
                  }}
                  className={cx(item, row.current ? 'bg-[var(--mac-accent)] text-white' : 'text-[var(--ph-ink)] hover:bg-[var(--ph-fill)]')}
                >
                  <span className="w-[12px] shrink-0">{row.current && <Check size={12} strokeWidth={3} aria-hidden />}</span>
                  <span className="min-w-0 flex-1 truncate">{row.name}</span>
                  <span className={cx('shrink-0 text-[12px] tabular-nums', row.current ? 'text-white/85' : 'text-[var(--ph-ink-3)]')}>{row.when}</span>
                </button>
              ))}
            </div>
          ))}
          <div className="my-[4px] border-t border-[var(--ph-hair)]" />
          <button
            type="button"
            role="menuitem"
            onClick={() => {
              setOpen(false);
              create.start();
            }}
            className={cx(item, 'text-[var(--mac-accent)] hover:bg-[var(--ph-fill)]')}
          >
            <span className="w-[12px] shrink-0" aria-hidden>
              ＋
            </span>
            New event
          </button>
          <button
            type="button"
            role="menuitem"
            onClick={() => {
              setOpen(false);
              void navigate({ to: '/events' });
            }}
            className={cx(item, 'text-[var(--ph-ink-3)] hover:bg-[var(--ph-fill)]')}
          >
            <span className="w-[12px] shrink-0" />
            All events…
          </button>
        </div>
      )}
      {create.overlay}
    </div>
  );
}

/** A line of a box: what it is on the left, its figure on the right, a hairline between lines. */
export function BoxRow({ label, children, testId, tone }: { label: ReactNode; children: ReactNode; testId?: string; tone?: 'warn' }) {
  return (
    <div data-testid={testId} className={cx('flex items-baseline justify-between gap-[10px] border-t border-[var(--ph-hair)] px-[14px] py-[7px] text-[13px]', tone === 'warn' && 'text-[var(--ph-warn)]')}>
      <dt className="min-w-0 truncate text-[var(--ph-ink)]">{label}</dt>
      <dd className="shrink-0 text-right tabular-nums text-[var(--ph-ink)]">{children}</dd>
    </div>
  );
}

/**
 * The Plan box: what the planned categories spent of the plan (the phone's ring, `planTotals`), the bar, what is still to
 * pay — or left of the plan, or over it — how many costs are bought, and what nobody planned. Money back, when any came
 * back, is named as the phone names it.
 */
export function PlanBox({
  totals,
  boughtCount,
  itemCount,
  currency,
}: {
  /** Not on the plan is left out (null) where the phone does not say it: a shared trip's plan. */
  totals: { plannedMinor: number; plannedSpentMinor: number; toBuyMinor: number; notPlannedMinor: number | null; moneyBackMinor: number };
  boughtCount: number;
  itemCount: number;
  currency: string;
}) {
  const line = planLine(totals);
  return (
    <section className={BOX} aria-label="Plan" data-testid="event-plan-box">
      <BoxHead title="Plan" note={`${itemCount} ${itemCount === 1 ? 'cost' : 'costs'}`} />
      <div className="px-[14px] pb-[10px]">
        <div data-testid="plan-box-spent" className="text-[24px] leading-[30px] font-semibold text-[var(--ph-ink)] tabular-nums">
          {formatMinor(totals.plannedSpentMinor, currency)}
        </div>
        <div data-testid="plan-box-of" className="text-[12px] text-[var(--ph-ink-3)]">
          of {formatMinor(totals.plannedMinor, currency)}
        </div>
        <div className="mt-[8px]">
          <PlanBar part={totals.plannedSpentMinor} whole={totals.plannedMinor} label="Spent against the plan" />
        </div>
        <div data-testid="plan-box-line" className={cx('mt-[5px] text-[12px]', line.kind === 'over' ? 'text-[var(--ph-alarm)]' : 'text-[var(--ph-ink-3)]')}>
          {line.kind === 'to-pay'
            ? `${formatMinor(line.minor, currency)} still to pay`
            : line.kind === 'left'
              ? `${formatMinor(line.minor, currency)} left of the plan`
              : `Over the plan by ${formatMinor(line.minor, currency)}`}
        </div>
      </div>
      <dl>
        <BoxRow label="Bought" testId="plan-box-bought">
          {boughtCount} of {itemCount}
        </BoxRow>
        {totals.notPlannedMinor !== null && (
          <BoxRow label="Not on the plan" testId="plan-box-not-planned">
            <Money minor={totals.notPlannedMinor} currency={currency} />
          </BoxRow>
        )}
        {totals.moneyBackMinor > 0 && (
          <BoxRow label="Money back" testId="plan-box-money-back">
            <Money minor={totals.moneyBackMinor} currency={currency} className="text-[var(--ph-up)]" />
          </BoxRow>
        )}
      </dl>
    </section>
  );
}

/** One cost of the plan as the table reads it, with the category line it sits under. */
export interface PlanTableRow {
  item: EventPlanItemView;
  categoryName: string;
}

/**
 * The Plan tab's table: Cost, Category, Planned, Paid (with a small bar), Status and Payments, then the Total row and
 * ＋ Add a cost. On a private event Planned is typed in place (a cost of one; a cost of several opens its form) and
 * Status is today's tick — Pay, Settle (Done buying) or Reopen; on a shared trip both read only, and a click on a cost
 * opens its page, where it is changed on every phone. Figures are in the event's currency, as the phone's plan page.
 */
export function PlanTable({
  plan,
  currency,
  baseCurrency,
  mark,
  onOpen,
  edit,
  status,
  addCost,
}: {
  plan: EventPlan;
  currency: string;
  baseCurrency: string;
  mark: (categoryId: string | null) => ReactNode;
  onOpen: (itemId: string) => void;
  edit: { save: (item: EventPlanItemView, unitPriceMinor: number) => Promise<void>; form: (itemId: string) => void } | null;
  status: { pay: (item: EventPlanItemView) => void; done: (item: EventPlanItemView, done: boolean) => void } | null;
  addCost: ReactNode;
}) {
  const rows: PlanTableRow[] = plan.lines.flatMap((line) => line.items.map((item) => ({ item, categoryName: line.name })));
  const [editing, setEditing] = useState<{ id: string; text: string; error: string | null; saving: boolean } | null>(null);
  const plannedTotal = rows.reduce((sum, row) => sum + (row.item.estimateEventMinor ?? 0), 0);
  const paidTotal = rows.reduce((sum, row) => sum + (row.item.paidEventMinor ?? 0), 0);
  const own = (item: EventPlanItemView) => item.currency ?? baseCurrency;

  const begin = (item: EventPlanItemView) => {
    if (!edit) return onOpen(item.id);
    // Several of something is a price each times how many: its form says both, so a total is never split by guesswork.
    if (item.quantity > 1) return edit.form(item.id);
    setEditing({ id: item.id, text: minorToMajorString(item.estimateOwnMinor, own(item)), error: null, saving: false });
  };
  const commit = async (item: EventPlanItemView) => {
    if (!edit || !editing || editing.id !== item.id || editing.saving) return;
    const read = readPlanned(editing.text, own(item));
    if ('error' in read) return setEditing({ ...editing, error: read.error });
    if (read.minor === item.unitPriceMinor) return setEditing(null);
    setEditing({ ...editing, saving: true, error: null });
    try {
      await edit.save(item, read.minor);
      setEditing(null);
    } catch (e) {
      setEditing({ ...editing, saving: false, error: e instanceof Error ? e.message : 'That figure was not saved' });
    }
  };

  const planned = (item: EventPlanItemView) => {
    if (item.noRate || item.estimateEventMinor === null) return formatMinor(item.estimateOwnMinor, own(item));
    const text = formatMinor(item.estimateEventMinor, currency);
    return own(item) === currency ? text : `≈ ${text}`;
  };

  return (
    <table className="w-full border-collapse text-[13px]" data-testid="plan-table">
      <thead>
        <tr>
          <th className={cx(TH, 'pl-[14px]')}>Cost</th>
          <th className={TH}>Category</th>
          <th className={cx(TH, 'text-right')}>Planned</th>
          <th className={cx(TH, 'text-right')}>Paid</th>
          <th className={TH}>Status</th>
          <th className={cx(TH, 'pr-[14px]')}>Payments</th>
        </tr>
      </thead>
      <tbody>
        {rows.length === 0 && (
          <tr>
            <td colSpan={6} className="px-[14px] py-[12px] text-[13px] text-[var(--ph-ink-3)]">
              Nothing planned yet. Add what is planned to pay and roughly what it costs.
            </td>
          </tr>
        )}
        {rows.map(({ item, categoryName }, index) => {
          const word = planItemStatus(item);
          const open = editing?.id === item.id ? editing : null;
          const many = quantityWords(item, own(item));
          return (
            <tr key={item.id} data-testid="plan-row" data-item-id={item.id} className={cx('text-[var(--ph-ink)]', index % 2 === 1 && 'bg-[var(--mac-zebra)]')}>
              <td className={cx(TD, 'pl-[14px]')}>
                <button type="button" onClick={() => onOpen(item.id)} className="block max-w-[260px] truncate text-left font-medium hover:underline" title="Open the cost">
                  {item.name}
                </button>
                {many && <span className="block truncate text-[11.5px] text-[var(--ph-ink-3)]">{many}</span>}
              </td>
              <td className={TD}>
                <span className="flex min-w-0 items-center gap-[6px]">
                  {mark(item.categoryId)}
                  <span className="truncate">{item.categoryId ? categoryName : 'No category'}</span>
                </span>
              </td>
              <td className={cx(TD, 'relative w-[150px] text-right tabular-nums')} data-testid="plan-planned">
                {open ? (
                  <>
                    <input
                      autoFocus
                      aria-label={`Planned for ${item.name}`}
                      value={open.text}
                      disabled={open.saving}
                      inputMode="decimal"
                      onFocus={(e) => e.currentTarget.select()}
                      onChange={(e) => setEditing({ ...open, text: e.target.value, error: null })}
                      onBlur={() => void commit(item)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') {
                          e.preventDefault();
                          void commit(item);
                        } else if (e.key === 'Escape') {
                          e.preventDefault();
                          e.stopPropagation();
                          setEditing(null);
                        }
                      }}
                      className="-my-px h-[22px] w-full rounded-[4px] bg-[var(--ph-surface)] px-[6px] text-right text-[13px] text-[var(--ph-ink)] tabular-nums outline-2 outline-[var(--mac-accent)]"
                    />
                    {open.error && (
                      <span role="alert" className="absolute right-[10px] z-10 mt-[3px] max-w-[260px] rounded-[6px] bg-[var(--ph-alarm)] px-[8px] py-[3px] text-left text-[11.5px] whitespace-normal text-white shadow">
                        {open.error}
                      </span>
                    )}
                  </>
                ) : (
                  <button
                    type="button"
                    aria-label={`Planned for ${item.name}`}
                    title={edit ? (item.quantity > 1 ? 'Opens the cost: price each and how many' : 'Type the planned figure') : 'Open the cost'}
                    onClick={() => begin(item)}
                    className={cx('w-full rounded-[4px] text-right tabular-nums hover:bg-[var(--ph-fill)] focus-visible:outline-2 focus-visible:outline-[var(--mac-accent)]', edit && 'text-[var(--mac-accent)]')}
                  >
                    {planned(item)}
                  </button>
                )}
              </td>
              <td className={cx(TD, 'w-[140px] text-right')} data-testid="plan-paid">
                <span className="block font-semibold tabular-nums">{formatMinor(item.paidEventMinor ?? 0, currency)}</span>
                <span className="mt-[3px] ml-auto block w-[72px]">
                  <PlanBar part={item.paidEventMinor ?? 0} whole={item.estimateEventMinor ?? 0} label={`${item.name} paid`} />
                </span>
              </td>
              <td className={cx(TD, 'whitespace-nowrap')} data-testid="plan-status">
                {status ? (
                  <button
                    type="button"
                    aria-label={item.done ? `Reopen ${item.name}` : item.purchaseCount > 0 ? `Settle ${item.name}` : `Pay ${item.name}`}
                    title={item.done ? 'Reopen: more is still to be bought' : item.purchaseCount > 0 ? 'Done buying' : 'Pay it now'}
                    onClick={() => (item.done ? status.done(item, false) : item.purchaseCount > 0 ? status.done(item, true) : status.pay(item))}
                    className={cx('rounded-[4px] px-[2px] hover:underline', STATUS_TONE[word])}
                  >
                    {word}
                    {word === 'Bought' && ' ✓'}
                  </button>
                ) : (
                  <span className={STATUS_TONE[word]}>
                    {word}
                    {word === 'Bought' && ' ✓'}
                  </span>
                )}
              </td>
              <td className={cx(TD, 'pr-[14px] text-[var(--ph-ink-3)]')} data-testid="plan-payments">
                <button type="button" onClick={() => onOpen(item.id)} className="block max-w-[220px] truncate text-left hover:text-[var(--ph-ink)] hover:underline" title="Open the cost">
                  {paymentsLine(item)}
                </button>
              </td>
            </tr>
          );
        })}
      </tbody>
      <tfoot>
        <tr className="border-t border-[var(--ph-hair)] bg-[var(--mac-head)]" data-testid="plan-total">
          <td className={cx(TD, 'pl-[14px] font-semibold')} colSpan={2}>
            Total
          </td>
          <td className={cx(TD, 'text-right font-semibold tabular-nums')}>{formatMinor(plannedTotal, currency)}</td>
          <td className={cx(TD, 'text-right font-semibold tabular-nums')}>{formatMinor(paidTotal, currency)}</td>
          <td className={cx(TD, 'pr-[14px]')} colSpan={2}>
            {addCost}
          </td>
        </tr>
      </tfoot>
    </table>
  );
}

const STATUS_TONE = { 'To buy': 'text-[var(--ph-ink-3)]', Paying: 'text-[var(--mac-accent)]', Bought: 'text-[var(--ph-up)]' } as const;

/** The table box's tabs: Transactions · N and Plan · N costs, as a pill switch in the box's header. */
export function TableTabs<T extends string>({ value, onChange, tabs }: { value: T; onChange: (next: T) => void; tabs: readonly { key: T; label: string }[] }) {
  return (
    <div role="tablist" aria-label="Event table" className="flex rounded-[7px] bg-[var(--ph-fill)] p-[2px] text-[12px]">
      {tabs.map((tab) => (
        <button
          key={tab.key}
          type="button"
          role="tab"
          aria-selected={value === tab.key}
          onClick={() => onChange(tab.key)}
          className={cx(
            'rounded-[5px] px-[11px] py-[3px] whitespace-nowrap',
            value === tab.key ? 'bg-[var(--ph-selected)] font-semibold text-[var(--ph-ink)] shadow-[0_0.5px_1.5px_rgba(0,0,0,0.18)]' : 'font-medium text-[var(--ph-ink-2)]',
          )}
        >
          {tab.label}
        </button>
      ))}
    </div>
  );
}

/** "＋ Add a cost" at the foot of the Plan table. */
export function AddCostLink({ to, eventId }: { to: '/events/$eventId/plan/new' | '/events/$eventId/shared-plan/new'; eventId: string }) {
  return (
    <Link to={to} params={{ eventId }} className="text-[12.5px] text-[var(--mac-accent)] hover:underline">
      <span aria-hidden>＋ </span>Add a cost
    </Link>
  );
}
