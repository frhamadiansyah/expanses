import { Check, Search } from 'lucide-react';
import { useMemo, useState } from 'react';
import { CURRENCIES } from '@expanses/core';
import { Sheet } from '../../app/Sheet';
import { cx } from '../../ui';
import { readRecentCurrencies, recentCurrencies, rememberCurrency } from './tx-form';

/** C1's group header, outside and above its group, as the kit draws one. */
const KICKER = 'px-1 pb-[6px] text-[11.5px] font-semibold tracking-[0.06em] text-[var(--ph-ink-3)] uppercase';
const GROUP = 'overflow-hidden rounded-[11px] bg-[var(--ph-surface)] [&>*+*>.ph-row-body]:border-t-[0.5px] [&>*+*>.ph-row-body]:border-[var(--ph-hair)]';

/**
 * Which currency the figure was typed in.
 *
 * Recent comes first — the paying account's currency, the workspace's, then up to three chosen lately — because
 * those are nearly always the answer; All currencies is the whole list underneath, searchable by code or name.
 * The list itself is `CURRENCIES`, so no screen carries a country list of its own.
 */
export function CurrencySheet({
  value,
  accountCurrency,
  baseCurrency,
  onPick,
  onClose,
}: {
  value: string;
  accountCurrency: string;
  baseCurrency: string;
  onPick: (code: string) => void;
  onClose: () => void;
}) {
  const [query, setQuery] = useState('');
  // Read once on open: a pick rewrites the store, and a list that reordered itself under the finger would move
  // the row being aimed at.
  const recent = useMemo(() => recentCurrencies({ accountCurrency, baseCurrency, stored: readRecentCurrencies() }), [accountCurrency, baseCurrency]);
  const needle = query.trim().toLowerCase();
  const matches = CURRENCIES.filter((c) => !needle || c.code.toLowerCase().includes(needle) || c.name.toLowerCase().includes(needle));

  const choose = (code: string) => {
    rememberCurrency(code);
    onPick(code);
    onClose();
  };

  const row = (code: string) => {
    const info = CURRENCIES.find((c) => c.code === code);
    if (!info) return null;
    return (
      <button
        key={code}
        type="button"
        onClick={() => choose(code)}
        aria-label={`${info.code} ${info.name}`}
        aria-current={code === value}
        className="ph-focus-inset flex w-full items-center gap-3 pl-[12px] text-left active:bg-[var(--ph-fill)]"
      >
        <span className="flex h-[30px] w-[30px] shrink-0 items-center justify-center rounded-full bg-[var(--ph-fill)] text-[17px] leading-none" aria-hidden>
          {info.flag}
        </span>
        <span className="ph-row-body flex min-h-12 min-w-0 flex-1 items-center gap-2 pr-[13px]">
          <span className="min-w-0 flex-1 truncate text-[15px] text-[var(--ph-ink)]">{info.name}</span>
          <span className="tabular shrink-0 text-[12.5px] text-[var(--ph-ink-3)]">{info.code}</span>
          <Check size={16} className={cx('shrink-0', code === value ? 'text-[var(--ph-tint)]' : 'invisible')} aria-hidden />
        </span>
      </button>
    );
  };

  return (
    <Sheet grouped title="Currency" onClose={onClose}>
      <div className="flex flex-col gap-3">
        <label className="flex h-10 items-center gap-2 rounded-[10px] bg-[var(--ph-track)] px-3">
          <Search size={16} aria-hidden className="shrink-0 text-[var(--ph-ink-3)]" />
          <input
            aria-label="Search currencies"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search currencies"
            className="min-w-0 flex-1 bg-transparent text-base text-[var(--ph-ink)] placeholder:text-[var(--ph-ink-3)] focus:outline-none md:text-[15px]"
          />
        </label>
        {!needle && recent.length > 0 && (
          <div>
            <p className={KICKER}>Recent</p>
            <div className={GROUP}>{recent.map(row)}</div>
          </div>
        )}
        <div>
          <p className={KICKER}>All currencies</p>
          <div className={GROUP}>{matches.map((c) => row(c.code))}</div>
        </div>
      </div>
    </Sheet>
  );
}
