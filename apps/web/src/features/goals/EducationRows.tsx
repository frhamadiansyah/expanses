import { Trash2, X } from 'lucide-react';
import type { ReactNode } from 'react';
import { SwipeRow } from '../../ui/SwipeRow';
import { type GroupChild, ROW_PAD_X, ROW_PAD_Y, rowHeight } from '../../ui/native';
import type { FeeDraft } from './education-model';

const FIELD = 'ph-focus min-w-0 rounded bg-transparent text-[17px] leading-[22px] text-[var(--ph-ink)] placeholder:text-[var(--ph-ink-3)] md:text-[15px] md:leading-[20px]';
const LABEL = 'shrink-0 text-[17px] leading-[22px] md:text-[15px] md:leading-[20px] text-[var(--ph-ink)]';

/** The hairline above a row, as the form rows draw it. */
function Hairline({ show }: { show: boolean }) {
  if (!show) return null;
  return <span aria-hidden className="pointer-events-none absolute top-0 z-10 bg-[var(--ph-hair)]" style={{ height: 0.5, left: ROW_PAD_X, right: ROW_PAD_X }} />;
}

/**
 * A level's years as one row: "from to" in two inline numeric fields, the way a range reads. Ages when the child's
 * birthday is given, calendar years when it is not. A figure that does not read says so under the row.
 */
export function YearsRow({
  byAge,
  from,
  to,
  onFrom,
  onTo,
  hint,
  position,
}: GroupChild & { byAge: boolean; from: string; to: string; onFrom: (next: string) => void; onTo: (next: string) => void; hint?: ReactNode }) {
  const word = byAge ? 'Ages' : 'Years';
  return (
    <div className="relative">
      <Hairline show={Boolean(position?.separator)} />
      <div className="flex items-center gap-3" style={{ minHeight: rowHeight(false), padding: `${ROW_PAD_Y}px ${ROW_PAD_X}px` }}>
        <span className={LABEL}>{word}</span>
        <span className="flex min-w-0 flex-1 items-baseline justify-end gap-[8px]">
          <input aria-label={`${word} from`} value={from} onChange={(e) => onFrom(e.target.value)} inputMode="numeric" size={1} className={`${FIELD} w-[64px] text-right`} />
          <span className="shrink-0 text-[17px] leading-[22px] text-[var(--ph-ink-3)] md:text-[15px]">to</span>
          <input aria-label={`${word} to`} value={to} onChange={(e) => onTo(e.target.value)} inputMode="numeric" size={1} className={`${FIELD} w-[64px] text-right`} />
        </span>
      </div>
      {hint && <p className="px-[13px] pb-[8px] text-[12.5px] leading-[16px] text-[var(--ph-ink-3)]">{hint}</p>}
    </div>
  );
}

/**
 * One cost on one line: its name (any text, tap to rename — Enrollment, Academic and Other are only where it starts),
 * the amount at the right, and how it is paid as a small control after it. Swipe the row left to delete it; where
 * there is a pointer a ✕ does the same. How it is paid is a select laid invisibly over its own words, so a phone
 * opens its own picker and a desktop its own list.
 */
export function CostRow({
  index,
  fee,
  currency,
  onName,
  onAmount,
  onCharged,
  onDelete,
  position,
}: GroupChild & {
  index: number;
  fee: FeeDraft;
  currency: string;
  onName: (next: string) => void;
  onAmount: (typed: string) => void;
  onCharged: (next: FeeDraft['charged']) => void;
  onDelete: () => void;
}) {
  const cost = fee.name.trim() || `Cost ${index + 1}`;
  return (
    <div className="relative">
      <Hairline show={Boolean(position?.separator)} />
      <SwipeRow enabled actions={[{ label: 'Delete', name: `Delete ${cost}`, icon: Trash2, tone: 'destructive', onPress: onDelete }]}>
        {() => (
          <div className="flex items-center gap-[10px]" style={{ minHeight: rowHeight(false), padding: `${ROW_PAD_Y}px ${ROW_PAD_X}px` }}>
            <input aria-label={`Cost ${index + 1} name`} value={fee.name} onChange={(e) => onName(e.target.value)} placeholder="Name" size={1} className={`${FIELD} min-w-0 flex-1 text-left`} />
            <span className="flex shrink-0 items-baseline justify-end gap-[5px]">
              {fee.amount && <span className="text-[13px] leading-[22px] text-[var(--ph-ink-3)]">{currency}</span>}
              <input
                aria-label={`${cost} today`}
                value={fee.amount}
                onChange={(e) => onAmount(e.target.value)}
                inputMode="decimal"
                placeholder="Amount"
                size={1}
                className={`${FIELD} tabular w-[112px] text-right`}
              />
            </span>
            <span className="relative flex shrink-0 items-center text-[15px] leading-[22px] text-[var(--ph-ink-3)]">
              <span aria-hidden className="whitespace-nowrap">
                {fee.charged === 'once' ? 'Once' : 'Yearly'} {'›'}
              </span>
              <select
                aria-label={`${cost} is paid`}
                value={fee.charged}
                onChange={(e) => onCharged(e.target.value as FeeDraft['charged'])}
                className="absolute inset-0 h-full w-full cursor-pointer opacity-0"
              >
                <option value="once">Once, at entry</option>
                <option value="yearly">Every year</option>
              </select>
            </span>
            <button
              type="button"
              aria-label={`Remove ${cost}`}
              onClick={onDelete}
              className="ph-focus ph-tap hidden h-[22px] w-[22px] shrink-0 items-center justify-center rounded-full text-[var(--ph-ink-3)] md:flex"
            >
              <X size={15} aria-hidden />
            </button>
          </div>
        )}
      </SwipeRow>
    </div>
  );
}
