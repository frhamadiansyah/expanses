import { addMonths, formatMinor } from '@expanses/core';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { useApp } from '../../app/context';
import { ErrorBox } from '../../ui';
import { Panel } from '../../ui/native';
import { monthYearLabel } from '../loans/loan-view';
import { dayMonth } from '../networth/debt-rows';
import { Hair } from './ByHandList';
import { PAY_BUTTON } from './PayFirstRowView';
import { PayLink } from './PayLink';
import type { PlanItem } from './plan-inputs';
import { whenWords } from './plan-view';
import { usePlanMonth } from './queries';
import { type MonthInput, monthSections, monthTotals } from './schedule-view';

/**
 * A month of the plan (spec §4.2): Due, Paid and Late, then the Late, Coming up and Paid sections, every unpaid row
 * with Pay. Drawn by the Schedule page on a phone and by the plan's Schedule tab on a wide screen.
 */

export function MonthStepper({ month, onMonth }: { month: string; onMonth: (month: string) => void }) {
  const step = 'ph-focus flex h-[36px] w-[36px] items-center justify-center rounded-full text-[var(--ph-tint)] hover:bg-[var(--ph-fill)]';
  return (
    <div className="mb-[12px] flex items-center justify-center gap-2">
      <button type="button" className={step} aria-label="Previous month" onClick={() => onMonth(addMonths(month, -1))}>
        <ChevronLeft size={20} aria-hidden />
      </button>
      <span data-testid="schedule-month" className="min-w-[96px] text-center text-[16px] font-semibold text-[var(--ph-ink)]">
        {monthYearLabel(month)}
      </span>
      <button type="button" className={step} aria-label="Next month" onClick={() => onMonth(addMonths(month, 1))}>
        <ChevronRight size={20} aria-hidden />
      </button>
    </div>
  );
}

function Tile({ testId, label, minor, currency, tone }: { testId: string; label: string; minor: number; currency: string; tone: string }) {
  return (
    <div data-testid={testId} className="min-w-0 rounded-[12px] bg-[var(--ph-surface)] px-[10px] py-[10px]">
      <p className="text-[12.5px] leading-[16px] text-[var(--ph-ink-3)]">{label}</p>
      {/* A third of a phone is narrow: the figure steps down a size and wraps rather than being cut. */}
      <p className={`tabular text-[13px] leading-[18px] font-bold break-words md:text-[15px] md:leading-[20px] ${tone}`}>{formatMinor(minor, currency)}</p>
    </div>
  );
}

function Tag({ tone, children }: { tone: 'alarm' | 'warn' | 'up' | 'quiet'; children: string }) {
  const look = {
    alarm: 'bg-[var(--ph-alarm-panel)] text-[var(--ph-alarm)] font-semibold',
    warn: 'bg-[var(--ph-warn-panel)] text-[var(--ph-warn-ink)] font-semibold',
    up: 'bg-[var(--ph-up-panel)] text-[var(--ph-up-ink)] font-semibold',
    quiet: 'text-[var(--ph-ink-3)]',
  }[tone];
  return <span className={`shrink-0 rounded-[4px] px-[5px] whitespace-nowrap ${look}`}>{children}</span>;
}

/** The row's tag: how late, how soon (Today / Tomorrow in amber, otherwise the day), or when it was paid. */
function tagOf(item: PlanItem, today: string): { tone: 'alarm' | 'warn' | 'up' | 'quiet'; text: string } {
  if (item.status === 'late') return { tone: 'alarm', text: whenWords(item, today) };
  if (item.status === 'paid') return { tone: 'up', text: item.paidOn ? `Paid ${dayMonth(item.paidOn)}` : 'Paid' };
  const when = whenWords(item, today);
  if (when === 'due today') return { tone: 'warn', text: 'Today' };
  if (when === 'due tomorrow') return { tone: 'warn', text: 'Tomorrow' };
  return { tone: 'quiet', text: dayMonth(item.dueOn) };
}

function ScheduleRow({ item, today, first }: { item: PlanItem; today: string; first: boolean }) {
  const tag = tagOf(item, today);
  const soFar = item.kind === 'card' && item.approximate && item.status !== 'paid';
  return (
    <li data-testid="schedule-row" data-title={item.title} className="relative">
      {!first && <Hair />}
      <div className="flex items-center gap-3 px-[16px] py-[11px]">
        <span aria-hidden className="flex h-[28px] w-[28px] shrink-0 items-center justify-center rounded-full bg-[var(--ph-fill)] text-[13px] font-semibold text-[var(--ph-ink-2)]">
          {item.name.charAt(0).toUpperCase()}
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[16px] leading-[21px] font-medium text-[var(--ph-ink)]">{item.title}</span>
          <span className="mt-[2px] flex min-w-0 items-center gap-[6px] text-[12.5px] leading-[16px] text-[var(--ph-ink-3)]">
            <Tag tone={tag.tone}>{tag.text}</Tag>
            <span className="truncate">{item.fromMessage ? 'from bank message' : item.detail}</span>
          </span>
        </span>
        {item.minor !== null && (
          <span className="tabular shrink-0 text-right text-[15px] text-[var(--ph-ink)]">
            {soFar && <span className="mr-[4px] text-[12.5px] text-[var(--ph-ink-3)]">so far</span>}
            {formatMinor(item.minor, item.currency)}
          </span>
        )}
        {item.pay && item.status !== 'paid' ? (
          <PayLink target={item.pay} className={PAY_BUTTON} label={`Pay ${item.title}`}>
            Pay
          </PayLink>
        ) : (
          <span className="w-[52px] shrink-0" aria-hidden />
        )}
      </div>
    </li>
  );
}

function Section({ testId, header, items, today }: { testId: string; header: string; items: readonly PlanItem[]; today: string }) {
  if (items.length === 0) return null;
  return (
    <Panel header={header} pad={false} testId={testId}>
      <ul>
        {items.map((item, index) => (
          <ScheduleRow key={item.key} item={item} today={today} first={index === 0} />
        ))}
      </ul>
    </Panel>
  );
}

export function SchedulePanel({ month, onMonth, show, today }: { month: string; onMonth: (month: string) => void; show: MonthInput['show']; today: string }) {
  const { ws } = useApp();
  const { items, error } = usePlanMonth(month, show);
  const sections = items ? monthSections(items, month, today) : null;
  const totals = items ? monthTotals(items, month) : null;
  return (
    <div data-testid="schedule-panel">
      <MonthStepper month={month} onMonth={onMonth} />
      <ErrorBox error={error} />
      {totals && sections && (
        <>
          <div className="mb-[18px] grid grid-cols-3 gap-2">
            <Tile testId="schedule-tile-due" label="Due" minor={totals.dueMinor} currency={ws.baseCurrency} tone="text-[var(--ph-ink)]" />
            <Tile testId="schedule-tile-paid" label="Paid" minor={totals.paidMinor} currency={ws.baseCurrency} tone="text-[var(--ph-up)]" />
            <Tile testId="schedule-tile-late" label="Late" minor={totals.lateMinor} currency={ws.baseCurrency} tone="text-[var(--ph-alarm)]" />
          </div>
          {totals.missing.length > 0 && <p className="mb-[12px] px-[4px] text-[12.5px] text-[var(--ph-warn)]">No {totals.missing.join(', ')} rate yet, so those are not added up</p>}
          <Section testId="schedule-late" header="Late" items={sections.late} today={today} />
          <Section testId="schedule-coming-up" header="Coming up" items={sections.comingUp} today={today} />
          <Section testId="schedule-paid" header="Paid" items={sections.paid} today={today} />
          {items!.length === 0 && <p className="py-8 text-center text-sm text-[var(--ph-ink-3)]">Nothing due in {monthYearLabel(month)}.</p>}
        </>
      )}
    </div>
  );
}

