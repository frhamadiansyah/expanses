import type { BudgetLine } from '@expanses/core';
import type { AccountRow } from '@expanses/db';
import { Info } from 'lucide-react';
import { type ReactNode, useState } from 'react';
import { useCategoryColours } from '../../lib/queries';
import { cx, Money } from '../../ui';
import { type GroupChild, InsetRow, ROW_PAD_X, ROW_PAD_Y, rowHeight } from '../../ui/native';
import { categoryMark } from '../categories/CategoryIcon';
import { bareFigure } from '../networth/debt-rows';

/** A thin bar of what is used: the tint, or the warn colour once it is full and past. */
export function UseBar({ share, height = 4, label }: { share: number; height?: number; label?: string }) {
  const over = share > 1;
  return (
    <span
      role={label ? 'progressbar' : undefined}
      aria-label={label}
      aria-valuenow={label ? Math.round(share * 100) : undefined}
      aria-valuemin={label ? 0 : undefined}
      aria-valuemax={label ? 100 : undefined}
      aria-hidden={label ? undefined : true}
      className="block w-full overflow-hidden rounded-full bg-[var(--ph-track)]"
      style={{ height }}
    >
      <span
        className="block h-full rounded-full"
        style={{ width: `${Math.min(1, Math.max(0, share)) * 100}%`, background: over ? 'var(--ph-warn)' : 'var(--ph-tint)' }}
      />
    </span>
  );
}

/** A category's glyph and colour, as every list in the app draws it. */
export function useCategoryMarks(accounts: readonly AccountRow[]) {
  const chosen = useCategoryColours().data;
  return (id: string) => {
    const { Glyph, colour } = categoryMark(id, accounts, chosen);
    return { icon: <Glyph size={15} strokeWidth={2.2} aria-hidden />, colour };
  };
}

type Mark = ReturnType<ReturnType<typeof useCategoryMarks>>;

/** A two-line figure at a row's end: the amount, and a small line under it. */
function Stacked({ minor, currency, under, warn = false }: { minor: number; currency: string; under: ReactNode; warn?: boolean }) {
  return (
    <span className="block text-right">
      <Money minor={minor} currency={currency} />
      <span className={cx('block text-[12.5px] leading-[16px]', warn ? 'text-[var(--ph-warn)]' : 'text-[var(--ph-ink-3)]')}>{under}</span>
    </span>
  );
}

/** A line past its cap: what it spent, and by how much it is over. */
export function OverRow({ line, mark, currency, onOpen, position }: GroupChild & { line: BudgetLine; mark: Mark; currency: string; onOpen: () => void }) {
  return (
    <InsetRow
      position={position}
      testId={`line-${line.name}`}
      icon={mark.icon}
      iconColour={mark.colour}
      title={line.name}
      subtitle={<UseBar share={2} />}
      value={<Stacked minor={line.totalMinor} currency={currency} under={<>over by <Money minor={line.overMinor} currency={currency} /></>} warn />}
      valueTone="ink"
      chevron={false}
      onClick={onOpen}
      label={`${line.name}, over by ${bareFigure(line.overMinor, currency)}`}
    />
  );
}

/** A capped line: its bar, and what is left of the cap. */
export function CappedRow({
  line,
  mark,
  title,
  depth = 0,
  currency,
  onOpen,
  position,
}: GroupChild & { line: BudgetLine; mark: Mark | null; title?: string; depth?: number; currency: string; onOpen: () => void }) {
  const cap = line.capMinor ?? 0;
  const share = cap > 0 ? line.totalMinor / cap : line.totalMinor > 0 ? 2 : 0;
  return (
    <InsetRow
      position={position}
      testId={`line-${line.name}`}
      depth={depth}
      icon={mark?.icon}
      iconColour={mark?.colour}
      title={title ?? line.name}
      subtitle={<UseBar share={share} />}
      value={<Stacked minor={cap - line.totalMinor} currency={currency} under={`left of ${bareFigure(cap, currency)}`} />}
      valueTone="ink"
      chevron={false}
      onClick={onOpen}
      label={`${title ?? line.name}, ${bareFigure(cap - line.totalMinor, currency)} left of ${bareFigure(cap, currency)}`}
    />
  );
}

/** The ⓘ beside a label, which shows its explanation under the row. */
export function InfoButton({ label, open, onToggle }: { label: string; open: boolean; onToggle: () => void }) {
  return (
    <button
      type="button"
      aria-label={`About ${label}`}
      aria-expanded={open}
      onClick={onToggle}
      className="ph-focus ph-tap flex h-[18px] w-[18px] shrink-0 items-center justify-center rounded-full text-[var(--ph-ink-3)]"
    >
      <Info size={16} aria-hidden />
    </button>
  );
}

/**
 * "Label ⓘ … value ›": a figure row whose explanation waits behind its ⓘ. With `onOpen` the figure end opens it, so the
 * ⓘ stays a button of its own rather than a button inside a button.
 */
export function FigureRow({
  label,
  info,
  value,
  dim = false,
  onOpen,
  testId,
  position,
}: GroupChild & { label: string; info?: ReactNode; value: ReactNode; dim?: boolean; onOpen?: () => void; testId?: string }) {
  const [explained, setExplained] = useState(false);
  const tone = dim ? 'text-[var(--ph-ink-3)]' : 'text-[var(--ph-ink)]';
  const figure = (
    <span className={cx('tabular shrink-0 text-[15px] leading-[20px] whitespace-nowrap', tone)} data-testid={testId}>
      {value}
    </span>
  );
  return (
    <div className="relative">
      {position?.separator && (
        <span aria-hidden className="pointer-events-none absolute top-0 bg-[var(--ph-hair)]" style={{ height: 0.5, left: ROW_PAD_X, right: ROW_PAD_X }} />
      )}
      <div className="flex items-center gap-3" style={{ minHeight: rowHeight(false), padding: `${ROW_PAD_Y}px ${ROW_PAD_X}px` }}>
        <span className="flex min-w-0 flex-1 items-center gap-[6px]">
          <span className={cx('text-[15px] leading-[20px]', tone)}>{label}</span>
          {info && <InfoButton label={label} open={explained} onToggle={() => setExplained((was) => !was)} />}
        </span>
        {onOpen ? (
          <button type="button" onClick={onOpen} aria-label={label} className="ph-focus flex min-h-[32px] items-center gap-[8px]">
            {figure}
            <span aria-hidden className="shrink-0 text-[17px] leading-none text-[var(--ph-chevron)]">
              {'›'}
            </span>
          </button>
        ) : (
          figure
        )}
      </div>
      {info && explained && <p className="px-[13px] pb-[8px] text-[12.5px] leading-[16px] text-[var(--ph-ink-3)]">{info}</p>}
    </div>
  );
}
