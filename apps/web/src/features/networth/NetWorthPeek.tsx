import { formatMinor, isoDate, lastNMonths, monthOf } from '@expanses/core';
import type { AccountRow } from '@expanses/db';
import { Link, useNavigate } from '@tanstack/react-router';
import { ChevronRight } from 'lucide-react';
import { cx } from '../../ui';
import { RowIcon } from '../../ui/native';
import { PEEK_BUTTON, SidePeek } from '../../ui/native/SidePeek';
import type { AccountDestination } from '../accounts/destination';
import { dueNowMinor, laterByCard } from '../cards/limit-usage';
import { useInstallments, useSchedule } from '../loans/queries';
import { PeekRecent } from '../wallet/WalletPeek';
import { owedMinor } from './debt-rows';
import { type DeskItem, type DeskKind, wholeShares } from './networth-desk-model';
import { useMonthEndValues } from './queries';
import { useBalances } from '../../lib/queries';
import { useBoxWidth } from './DeskNetWorthChart';
import { shortMoney } from './value-chart';

const HEAD = 'px-[14px] pt-[10px] pb-[4px] text-[11px] font-semibold tracking-[0.04em] text-[var(--ph-ink-3)] uppercase';
const LINE = 'flex items-center justify-between gap-3 px-[14px] py-[5px] text-[13px] text-[var(--ph-ink)]';

/** A kind's own look: its colour, its drawing. */
export interface KindLook {
  colour: string;
  Glyph: React.ComponentType<{ size?: number; 'aria-hidden'?: boolean }>;
}

/** What the peek is shown for: a kind (a box of the treemap, a bold row) or one row of a side. */
export type NetWorthPeekSubject =
  | { type: 'kind'; side: 'asset' | 'debt'; kind: DeskKind; look: KindLook; sideLabel: string }
  | {
      type: 'item';
      side: 'asset' | 'debt';
      item: DeskItem;
      kind: DeskKind;
      look: KindLook;
      /** This device's own account; absent for the partner's shared item. */
      account?: AccountRow;
      /** The partner's item: whose it is, and its own figure when it has no rate. */
      received?: { ownerName: string; native: { minor: number; currency: string } | null };
      /** Where a double-click (or Open) goes: the row's own page. */
      to?: AccountDestination;
      /** An account with pockets: its pockets are what the ledger holds. */
      pockets: readonly string[];
    };

/** The tint a kind is drawn in on the treemap and its icon: a light wash of its colour, words a shade deeper. */
export const tintOf = (colour: string) => ({ background: `color-mix(in srgb, ${colour} 17%, var(--ph-surface))`, foreground: `color-mix(in srgb, ${colour} 72%, var(--ph-ink))` });

/**
 * Mac Net worth's side peek. A kind (Cash & equivalents, Investments, Home mortgage…) shows its figure, its share of its
 * side, what it holds by kind (Investments' holding types, as the treemap splits it) and its rows, each opening its own
 * peek. A row shows its figure, and what its page shows first: an asset's value at each month-end of the last year, a
 * loan's next payments and when it ends, a card's due now beside what it owes in full, a money account's or a card's
 * last rows (a click opens the Mac receipt in this peek's place). Edit opens its settings; Open (or a double-click on the
 * row) its whole page.
 */
export function NetWorthPeek({
  subject,
  currency,
  top,
  first,
  last,
  onStep,
  onClose,
  onPick,
  onOpen,
}: {
  subject: NetWorthPeekSubject;
  currency: string;
  top: number;
  first: boolean;
  last: boolean;
  onStep: (by: -1 | 1) => void;
  onClose: () => void;
  /** A row of a kind's list picked: its own peek. */
  onPick: (accountId: string) => void;
  onOpen: () => void;
}) {
  const title = subject.type === 'kind' ? subject.kind.label : subject.item.name;
  return (
    <SidePeek top={top} label={subject.type === 'kind' ? 'Kind details' : 'Account details'} testId="networth-peek" titleTestId="peek-title" noun="row" title={title} first={first} last={last} onStep={onStep} onClose={onClose}>
      {subject.type === 'kind' ? <KindPeek subject={subject} currency={currency} onPick={onPick} onOpen={onOpen} /> : <ItemPeek subject={subject} currency={currency} onOpen={onOpen} />}
    </SidePeek>
  );
}

function KindPeek({ subject, currency, onPick, onOpen }: { subject: Extract<NetWorthPeekSubject, { type: 'kind' }>; currency: string; onPick: (accountId: string) => void; onOpen: () => void }) {
  const { kind, side, look } = subject;
  const debt = side === 'debt';
  return (
    <>
      <div className="px-[14px] pb-[10px]">
        <div className="text-[11px] text-[var(--ph-ink-3)]">{debt ? 'Owed' : 'Value'}</div>
        <div data-testid="peek-figure" className="text-[22px] font-semibold text-[var(--ph-ink)] tabular-nums">
          {kind.totalMinor === null ? '—' : formatMinor(kind.totalMinor, currency)}
        </div>
        <div data-testid="peek-line" className="text-[12px] text-[var(--ph-ink-3)]">
          {kind.share}% of {subject.sideLabel} · {kind.items.length} {kind.items.length === 1 ? 'row' : 'rows'}
        </div>
      </div>
      {kind.parts.length > 1 && kind.totalMinor !== null && kind.totalMinor > 0 && (
        <div className="border-t border-[var(--ph-hair)] pb-[6px]" data-testid="peek-parts">
          <h3 className={HEAD}>By kind</h3>
          {kind.parts.map((part, index) => (
            <div key={part.key} className={LINE}>
              <span className="min-w-0 flex-1">{part.label}</span>
              <span className="shrink-0 text-[var(--ph-ink-3)] tabular-nums">{wholeShares(kind.parts.map((each) => each.minor))[index]}%</span>
              <span className="shrink-0 text-right whitespace-nowrap tabular-nums">{formatMinor(part.minor, currency)}</span>
            </div>
          ))}
        </div>
      )}
      <div className="border-t border-[var(--ph-hair)] pb-[6px]">
        <h3 className={HEAD}>{debt ? 'Debts' : 'Held'}</h3>
        <ul data-testid="peek-items">
          {kind.items.map((item) => (
            <li key={item.accountId}>
              <button type="button" onClick={() => onPick(item.accountId)} className={cx(LINE, 'w-full text-left hover:bg-[var(--ph-fill)]')}>
                <RowIcon size={20} tint={tintOf(look.colour)}>
                  <look.Glyph size={11} aria-hidden />
                </RowIcon>
                <span className="min-w-0 flex-1 truncate">{item.name}</span>
                <span className="shrink-0 tabular-nums">{item.minor === null ? '—' : `${item.approx ? '≈ ' : ''}${formatMinor(item.minor, currency)}`}</span>
              </button>
            </li>
          ))}
        </ul>
      </div>
      <div className="flex flex-wrap gap-2 border-t border-[var(--ph-hair)] px-[14px] py-[12px]">
        <button type="button" className={PEEK_BUTTON} onClick={onOpen}>
          {debt ? 'Open Liabilities' : 'Open Assets'}
        </button>
      </div>
    </>
  );
}

function ItemPeek({ subject, currency, onOpen }: { subject: Extract<NetWorthPeekSubject, { type: 'item' }>; currency: string; onOpen: () => void }) {
  const navigate = useNavigate();
  const { item, kind, side, account, received, to, pockets } = subject;
  const card = account?.subtype === 'credit_card';
  const loan = account?.subtype === 'loan';
  const money = account !== undefined && account.kind === 'asset' && ['cash', 'bank', 'savings', 'fund', 'ewallet', 'emoney', 'other_cash'].includes(account.subtype);
  const shown = item.minor === null && received?.native ? formatMinor(received.native.minor, received.native.currency) : item.minor === null ? '—' : `${item.approx ? '≈ ' : ''}${formatMinor(item.minor, currency)}`;
  const editTo: AccountDestination | null = !account
    ? null
    : card
      ? { to: '/cards/$cardId/settings', params: { cardId: account.id } }
      : side === 'asset' && account.subtype !== 'receivable'
        ? { to: '/net-worth/assets/$accountId/settings', params: { accountId: account.id } }
        : null;
  return (
    <>
      <div className="px-[14px] pb-[10px]">
        <div className="text-[11px] text-[var(--ph-ink-3)]">{side === 'debt' ? (card ? 'Owed in full' : 'Owed') : 'Value'}</div>
        <div data-testid="peek-figure" className={cx('text-[22px] font-semibold tabular-nums', side === 'debt' ? 'text-[var(--ph-alarm)]' : 'text-[var(--ph-ink)]')}>
          {shown}
        </div>
        <div data-testid="peek-line" className="text-[12px] text-[var(--ph-ink-3)]">
          {[received ? `${received.ownerName}’s` : null, item.kind.label, side === 'asset' && item.kind.label !== kind.label ? kind.label : null, account?.currency && account.currency !== currency ? account.currency : null]
            .filter(Boolean)
            .join(' · ')}
        </div>
        {card && account && <DueNow account={account} />}
      </div>
      <div className="flex flex-wrap gap-2 px-[14px] pb-[12px]">
        {editTo && (
          <button type="button" className={PEEK_BUTTON} onClick={() => void navigate(editTo)}>
            Edit
          </button>
        )}
        {to && (
          <button type="button" className={PEEK_BUTTON} onClick={onOpen}>
            Open
          </button>
        )}
      </div>
      {side === 'asset' && account && pockets.length === 0 && <ValueOverTime accountId={account.id} currency={account.currency ?? currency} />}
      {loan && account && <LoanSchedule accountId={account.id} currency={account.currency ?? currency} />}
      {account && (money || card) && <PeekRecent name={item.name} accountId={account.id} ids={pockets.length > 0 ? pockets : [account.id]} />}
      {received && (
        <p className="border-t border-[var(--ph-hair)] px-[14px] py-[10px] text-[12px] text-[var(--ph-ink-3)]">Shared by {received.ownerName}: its settings and history stay on {received.ownerName}’s phone.</p>
      )}
    </>
  );
}

/** A card's due now, as Wallet and the sidebar show it, under what Net worth counts: everything owed, instalments included. */
function DueNow({ account }: { account: AccountRow }) {
  const balances = useBalances();
  const plans = useInstallments(account.id);
  if (!balances.data || !plans.data) return null;
  const later = laterByCard(plans.data, isoDate())[account.id] ?? 0;
  const due = dueNowMinor(owedMinor(balances.data, account.id), later);
  return (
    <p data-testid="peek-due-now" className="mt-[6px] text-[12px] text-[var(--ph-ink-3)]">
      Due now (as Wallet shows it): <span className="text-[var(--ph-ink)] tabular-nums">{formatMinor(due, account.currency ?? 'IDR')}</span>
    </p>
  );
}

const MONTH = (month: string) => new Date(`${month}-01T00:00:00`).toLocaleDateString('en-GB', { month: 'short' });

/** An asset's value at each month-end of the last year, as its own page's chart reads it. */
function ValueOverTime({ accountId, currency }: { accountId: string; currency: string }) {
  const months = lastNMonths(monthOf(isoDate()), 12);
  const history = useMonthEndValues(accountId, months);
  const [box, width] = useBoxWidth<HTMLDivElement>();
  const values = history.data ?? [];
  const H = 70;
  const known = values.length === months.length && values.some((value) => value !== 0);
  const low = Math.min(...values);
  const high = Math.max(...values);
  const y = (value: number) => (high === low ? H / 2 : 8 + ((high - value) / (high - low)) * (H - 16));
  const x = (index: number) => (months.length <= 1 ? 0 : (index * (width - 2)) / (months.length - 1) + 1);
  return (
    <div className="border-t border-[var(--ph-hair)] pb-[8px]" data-testid="peek-value-over-time">
      <h3 className={HEAD}>Value over 12 months</h3>
      <div ref={box} className="px-[14px]">
        {known && width > 0 ? (
          <svg width={width} height={H + 14} role="img" aria-label={`From ${formatMinor(values[0]!, currency)} in ${MONTH(months[0]!)} to ${formatMinor(values.at(-1)!, currency)} now`} className="block">
            <polyline points={values.map((value, index) => `${x(index)},${y(value)}`).join(' ')} fill="none" stroke="var(--ph-up)" strokeWidth={1.8} strokeLinejoin="round" />
            <circle cx={x(values.length - 1)} cy={y(values.at(-1)!)} r={3} fill="var(--ph-up)" />
            <text x={0} y={H + 12} fontSize={10} fill="var(--ph-ink-3)">
              {MONTH(months[0]!)} · {shortMoney(values[0]!, currency)}
            </text>
            <text x={width} y={H + 12} textAnchor="end" fontSize={10} fill="var(--ph-ink-3)">
              {MONTH(months.at(-1)!)} · {shortMoney(values.at(-1)!, currency)}
            </text>
          </svg>
        ) : (
          <p className="py-1 text-[12.5px] text-[var(--ph-ink-3)]">{history.isPending ? 'Reading…' : 'No value recorded over the year yet.'}</p>
        )}
      </div>
    </div>
  );
}

/** A loan's next payments, as its own page's schedule lists them, and the month it ends. */
function LoanSchedule({ accountId, currency }: { accountId: string; currency: string }) {
  const schedule = useSchedule(accountId);
  const rows = schedule.data ?? [];
  const end = rows.at(-1);
  return (
    <div className="border-t border-[var(--ph-hair)] pb-[8px]" data-testid="peek-schedule">
      <h3 className={HEAD}>Next payments</h3>
      {schedule.isSuccess && rows.length === 0 && <p className="px-[14px] py-1 text-[12.5px] text-[var(--ph-ink-3)]">No schedule yet: its terms are set on its page.</p>}
      {rows.slice(0, 4).map((row) => (
        <div key={row.onDate} className={LINE}>
          <span className="shrink-0 text-[var(--ph-ink-3)] tabular-nums">{new Date(`${row.onDate}T00:00:00`).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}</span>
          <span className="min-w-0 flex-1 truncate text-right tabular-nums">{formatMinor(row.paymentMinor, currency)}</span>
        </div>
      ))}
      {end && (
        <p className="px-[14px] pt-[4px] text-[12px] text-[var(--ph-ink-3)]">
          Paid off in {new Date(`${end.onDate}T00:00:00`).toLocaleDateString('en-GB', { month: 'long', year: 'numeric' })} · {rows.length} {rows.length === 1 ? 'payment' : 'payments'} left
        </p>
      )}
      <Link to="/net-worth/loans/$accountId" params={{ accountId }} className="mt-[4px] flex items-center justify-between px-[14px] py-[6px] text-[13px] text-[var(--mac-accent)] hover:bg-[var(--ph-fill)]">
        Whole schedule
        <ChevronRight size={14} aria-hidden />
      </Link>
    </div>
  );
}
