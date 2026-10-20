import { CURRENCIES } from '@expanses/core';
import { type UIEvent, useEffect, useId, useRef, useState } from 'react';
import { Sheet } from '../../app/Sheet';
import { cx } from '../../ui';
import { type GroupChild, PickerRow, ROW_PAD_X, TAP } from '../../ui/native';
import { CurrencySheet } from '../transactions/CurrencySheet';
import { type AcquiredParts, daysIn, MONTHS } from './acquired';

const LABEL = 'shrink-0 text-[17px] leading-[22px] md:text-[15px] md:leading-[20px] text-[var(--ph-ink)]';
/** 16 px below md, so iOS does not zoom the page when one of these takes focus — as every form row keeps. */
const FIELD = 'ph-focus rounded bg-transparent text-[17px] leading-[22px] md:leading-[20px] text-[var(--ph-ink)] md:text-[15px] placeholder:text-[var(--ph-ink-3)]';

/** One line of a wheel, and how many show: the chosen one in the middle, two either side. */
const ITEM = 36;
const SHOWN = 5;

function Separator({ position }: GroupChild) {
  if (!position?.separator) return null;
  return <span aria-hidden className="pointer-events-none absolute top-0 bg-[var(--ph-hair)]" style={{ height: 0.5, left: ROW_PAD_X, right: ROW_PAD_X }} />;
}

/** "2021", "Mar 2021" or "14 Mar 2021": only what was picked, as the row reads it back. */
export function partsLabel(parts: AcquiredParts): string | null {
  if (parts.year.trim() === '') return null;
  const month = parts.month === '' ? null : MONTHS[Number(parts.month) - 1];
  return [parts.day || null, month, parts.year].filter(Boolean).join(' ');
}

/**
 * A wheel, as iOS draws a date picker's column: the lines scroll and snap, and the one resting in the middle band is
 * the answer. A line can also be tapped. It is a listbox, so a screen reader — and a test — can pick by name.
 */
function Wheel({ label, items, value, onChange, disabled = false }: { label: string; items: { value: string; label: string }[]; value: string; onChange: (value: string) => void; disabled?: boolean }) {
  const list = useRef<HTMLDivElement>(null);
  const settle = useRef<number | undefined>(undefined);
  const index = Math.max(0, items.findIndex((item) => item.value === value));

  // A wheel closed mid-flick answers nothing afterwards.
  useEffect(() => () => window.clearTimeout(settle.current), []);

  // Brought to the chosen line whenever the answer changes from outside the scroll (opening, a tap, a column that let go).
  useEffect(() => {
    const el = list.current;
    if (el && Math.round(el.scrollTop / ITEM) !== index) el.scrollTo({ top: index * ITEM });
  }, [index]);

  const onScroll = (e: UIEvent<HTMLDivElement>) => {
    if (disabled) return;
    const el = e.currentTarget;
    window.clearTimeout(settle.current);
    // Read once the wheel has come to rest, so a flick through ten years answers once, with where it stopped — and the
    // wheel is laid onto that line exactly. Snapped here rather than by CSS scroll-snap, which rested a few pixels off
    // the band and showed one line while answering the one above.
    settle.current = window.setTimeout(() => {
      const at = Math.min(items.length - 1, Math.max(0, Math.round(el.scrollTop / ITEM)));
      if (el.scrollTop !== at * ITEM) el.scrollTo({ top: at * ITEM, behavior: 'smooth' });
      const item = items[at];
      if (item && item.value !== value) onChange(item.value);
    }, 120);
  };

  return (
    <div className={cx('relative flex-1', disabled && 'pointer-events-none opacity-40')}>
      {/* The middle band: the answer sits here. */}
      <span aria-hidden className="pointer-events-none absolute inset-x-[4px] rounded-[8px] bg-[var(--ph-fill)]" style={{ top: ITEM * 2, height: ITEM }} />
      <div
        ref={list}
        role="listbox"
        aria-label={label}
        aria-disabled={disabled || undefined}
        onScroll={onScroll}
        className="relative overflow-y-scroll [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
        style={{ height: ITEM * SHOWN, paddingBlock: ITEM * 2 }}
      >
        {items.map((item) => (
          <div
            key={item.value}
            role="option"
            aria-selected={item.value === value}
            onClick={() => onChange(item.value)}
            className={cx(
              'flex cursor-pointer items-center justify-center text-[20px] tabular',
              item.value === value ? 'text-[var(--ph-ink)]' : 'text-[var(--ph-ink-3)]',
            )}
            style={{ height: ITEM }}
          >
            {item.label}
          </div>
        ))}
      </div>
    </div>
  );
}

/**
 * When something was acquired, on one row that reads back only what was picked — "2021", "Mar 2021", "14 Mar 2021" —
 * and opens three wheels: the year, then the month and the day, both "—" unless known. The day waits for a month, and
 * a month or year that no longer holds the chosen day lets go of it. ✓ keeps the wheels; ✕ leaves the row as it was.
 */
export function AcquiredRow({ label = 'Acquired', value, onChange, position }: GroupChild & { label?: string; value: AcquiredParts; onChange: (next: AcquiredParts) => void }) {
  const [draft, setDraft] = useState<AcquiredParts | null>(null);
  const thisYear = new Date().getFullYear();
  const open = () => setDraft({ ...value, year: value.year.trim() === '' ? String(thisYear) : value.year });
  const change = (patch: Partial<AcquiredParts>) =>
    setDraft((current) => {
      // A wheel still settling after ✓ or ✕ must not open the sheet again.
      if (!current) return current;
      const next = { ...current, ...patch };
      if (next.month === '' || Number(next.day) > daysIn(next.year, next.month)) next.day = '';
      return next;
    });

  const years = Array.from({ length: thisYear - 1900 + 1 }, (_, i) => String(1900 + i)).map((year) => ({ value: year, label: year }));
  const months = [{ value: '', label: '—' }, ...MONTHS.map((name, i) => ({ value: String(i + 1), label: name }))];
  const days = draft ? [{ value: '', label: '—' }, ...Array.from({ length: daysIn(draft.year, draft.month) }, (_, i) => ({ value: String(i + 1), label: String(i + 1) }))] : [];

  return (
    <>
      <PickerRow label={label} value={partsLabel(value)} placeholder="Year" onOpen={open} position={position} />
      {draft && (
        <Sheet
          title={label}
          onClose={() => setDraft(null)}
          confirm={{
            label: 'Done',
            run: () => {
              onChange(draft);
              setDraft(null);
            },
          }}
        >
          <div className="flex gap-[4px] px-[8px] pb-[16px]">
            <Wheel label="Year" items={years} value={draft.year} onChange={(year) => change({ year })} />
            <Wheel label="Month" items={months} value={draft.month} onChange={(month) => change({ month })} />
            <Wheel label="Day" items={days} value={draft.day} onChange={(day) => change({ day })} disabled={draft.month === ''} />
          </div>
          <p className="px-[16px] pb-[12px] text-center text-[12.5px] leading-[16px] text-[var(--ph-ink-3)]">
            Leave month and day at — when only the year is known.
          </p>
        </Sheet>
      )}
    </>
  );
}

/**
 * An amount with its currency on one row, the currency as its quiet symbol before the figure — "Rp 215.000.000" —
 * rather than a code with a chevron, and only once a figure is typed. With `onCurrency` the symbol is the way to change it: a tap opens the same
 * currency list the transaction form uses. Without it, it only says which currency.
 */
export function MoneyRow({
  label,
  value,
  onChange,
  currency,
  base,
  onCurrency,
  placeholder,
  position,
}: GroupChild & {
  label: string;
  value: string;
  onChange: (value: string) => void;
  currency: string;
  /** The workspace's currency, offered first in the list. */
  base?: string;
  onCurrency?: (code: string) => void;
  placeholder?: string;
}) {
  const id = useId();
  const [picking, setPicking] = useState(false);
  const prompt = placeholder ?? 'Amount';
  const symbol = CURRENCIES.find((c) => c.code === currency)?.symbol ?? currency;
  const quiet = 'shrink-0 text-[17px] leading-[22px] md:leading-[20px] text-[var(--ph-ink-3)] md:text-[15px]';
  return (
    <div className="relative">
      <Separator position={position} />
      <div className="flex items-center gap-3" style={{ minHeight: TAP, padding: `0 ${ROW_PAD_X}px` }}>
        <label htmlFor={id} className={LABEL}>
          {label}
        </label>
        {/* Symbol and figure sit together at the right. */}
        <span className="flex min-w-0 flex-1 items-center justify-end gap-[6px]">
          {/* Only once there is a figure: an empty row reads as its prompt alone. */}
          {value.trim() === '' ? null : onCurrency ? (
            <button type="button" aria-label={`${label} currency: ${currency}`} onClick={() => setPicking(true)} className={cx('ph-focus rounded', quiet)}>
              {symbol}
            </button>
          ) : (
            <span aria-label={`${label} currency: ${currency}`} className={quiet}>
              {symbol}
            </span>
          )}
          {/*
           * As wide as what it shows, an unseen copy of the text setting the width — but never narrower than a
           * thirteen-digit figure (1.150.000.000), so the symbols of the rows above and below stand in one column.
           */}
          <span className="inline-grid min-w-[min(13ch,100%)] text-[17px] tabular md:text-[15px]">
            <span aria-hidden className="invisible col-start-1 row-start-1 overflow-hidden whitespace-pre text-[17px] leading-[22px] md:leading-[20px] tabular md:text-[15px]">
              {value || prompt}
            </span>
            <input
              id={id}
              value={value}
              onChange={(e) => onChange(e.target.value)}
              inputMode="decimal"
              placeholder={prompt}
              // One character wide on its own, so the unseen copy alone decides the width (an input is 20 by default).
              size={1}
              className={cx(FIELD, 'col-start-1 row-start-1 w-full min-w-0 text-right tabular')}
            />
          </span>
        </span>
      </div>
      {picking && onCurrency && (
        <CurrencySheet value={currency} accountCurrency={currency} baseCurrency={base ?? currency} onPick={onCurrency} onClose={() => setPicking(false)} />
      )}
    </div>
  );
}
