import { Check, Search, Star } from 'lucide-react';
import { useMemo, useState } from 'react';
import { currencyInfo, type CurrencyInfo } from '@expanses/core';
import { Sheet } from '../../app/Sheet';
import { cx } from '../../ui';
import { readRecentCurrencies, recentCurrencies, rememberCurrency } from '../transactions/tx-form';
import { currencyMatches, currencySections, readFavoriteCurrencies, toggleFavoriteCurrency } from './currency-list';

/** A group header, outside and above its group, as the kit draws one. */
const KICKER = 'px-1 pb-[6px] text-[15px] font-semibold text-[var(--ph-ink-3)]';
const GROUP =
  'overflow-hidden rounded-[18px] border-[0.5px] border-[var(--ph-hair)] bg-[var(--ph-surface)] [&>*+*>.ph-row-body]:border-t-[0.5px] [&>*+*>.ph-row-body]:border-[var(--ph-hair)]';

/**
 * The one currency list every currency field opens: a search by code, name, symbol or country; the person's
 * starred currencies, the ones used lately and a few popular ones above; then every currency by letter.
 * The list itself is `CURRENCIES`, so no screen carries a currency list of its own.
 *
 * A tap on the star toggles it and leaves the sheet open; a tap on the rest of the row picks and closes.
 */
export function CurrencySheet({
  value,
  accountCurrency = '',
  baseCurrency,
  onPick,
  onClose,
  exclude,
  only,
}: {
  value: string;
  accountCurrency?: string;
  baseCurrency: string;
  onPick: (code: string) => void;
  onClose: () => void;
  /** Codes not offered: the workspace's own, or those an account already holds. */
  exclude?: readonly string[];
  /** When given, only these codes are offered. */
  only?: readonly string[];
}) {
  const [query, setQuery] = useState('');
  const [favorites, setFavorites] = useState(() => readFavoriteCurrencies(baseCurrency));
  // Read once on open: a pick rewrites the store, and a list that reordered itself under the finger would move
  // the row being aimed at.
  const recent = useMemo(() => recentCurrencies({ accountCurrency, baseCurrency, stored: readRecentCurrencies() }), [accountCurrency, baseCurrency]);
  const searching = query.trim() !== '';
  // Sections follow the stars as they are toggled: a starred row also appears under Favorites at once.
  const sections = useMemo(() => currencySections({ favorites, recent, exclude, only }), [favorites, recent, exclude, only]);
  const matches = useMemo(() => (searching ? currencyMatches(query, { exclude, only }) : []), [query, searching, exclude, only]);

  const choose = (code: string) => {
    rememberCurrency(code);
    onPick(code);
    onClose();
  };

  const row = (info: CurrencyInfo, section: string) => {
    const starred = favorites.includes(info.code);
    return (
      <div key={`${section}-${info.code}`} className="flex w-full items-stretch pl-[12px] active:bg-[var(--ph-fill)]">
        <button
          type="button"
          onClick={() => choose(info.code)}
          aria-label={`${info.code} ${info.name}`}
          aria-current={info.code === value}
          className="ph-focus-inset flex min-w-0 flex-1 items-center gap-3 text-left"
        >
          <span className="flex h-[38px] w-[38px] shrink-0 items-center justify-center rounded-full bg-[var(--ph-fill)] text-[15px] font-semibold leading-none text-[var(--ph-ink)]" aria-hidden>
            {info.symbol}
          </span>
          <span className="ph-row-body flex min-h-[56px] min-w-0 flex-1 items-center gap-2">
            <span className="min-w-0 flex-1">
              <span className="block truncate text-[17px] leading-[22px] font-medium text-[var(--ph-ink)]">{info.code}</span>
              <span className="block truncate text-[14px] leading-[18px] text-[var(--ph-ink-3)]">{info.name}</span>
            </span>
            <Check size={20} strokeWidth={2.2} className={cx('shrink-0 text-[var(--ph-ink)]', info.code === value ? '' : 'invisible')} aria-hidden />
          </span>
        </button>
        <span className="ph-row-body flex shrink-0 items-center">
          <button
            type="button"
            onClick={() => setFavorites((list) => toggleFavoriteCurrency(info.code, list))}
            aria-label={starred ? `Remove ${info.code} from favorites` : `Add ${info.code} to favorites`}
            aria-pressed={starred}
            className="ph-focus flex h-11 w-11 items-center justify-center rounded-full"
          >
            <Star size={22} strokeWidth={1.6} className={starred ? 'fill-[var(--ph-ink)] text-[var(--ph-ink)]' : 'text-[var(--ph-ink-3)]'} aria-hidden />
          </button>
        </span>
      </div>
    );
  };

  return (
    <Sheet grouped largeTitle tall expanded title="Currency" onClose={onClose}>
      <div className="flex flex-col gap-4">
        <label className="flex h-11 items-center gap-2 rounded-full bg-[var(--ph-track)] px-4">
          <Search size={18} aria-hidden className="shrink-0 text-[var(--ph-ink-3)]" />
          <input
            aria-label="Search currencies"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search currency or country"
            className="min-w-0 flex-1 bg-transparent text-base text-[var(--ph-ink)] placeholder:text-[var(--ph-ink-3)] focus:outline-none md:text-[15px]"
          />
        </label>
        {searching ? (
          matches.length > 0 ? (
            <div className={GROUP}>{matches.map((c) => row(c, 'found'))}</div>
          ) : (
            <p className="px-1 text-[15px] text-[var(--ph-ink-3)]">No currency matches.</p>
          )
        ) : (
          sections.map((section) => (
            <div key={section.title}>
              <p className={KICKER}>{section.title}</p>
              <div className={GROUP}>{section.codes.map((code) => row(currencyInfo(code), section.title))}</div>
            </div>
          ))
        )}
      </div>
    </Sheet>
  );
}
