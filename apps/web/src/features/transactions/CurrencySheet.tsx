import { Check } from 'lucide-react';
import { useMemo, useState } from 'react';
import { CURRENCIES } from '@expanses/core';
import { Sheet } from '../../app/Sheet';
import { cx, Input } from '../../ui';
import { readRecentCurrencies, recentCurrencies, rememberCurrency } from './tx-form';

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
        className="flex h-12 w-full items-center gap-3 px-3 text-left text-sm hover:bg-slate-50 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-slate-900"
      >
        <span className="text-lg" aria-hidden>
          {info.flag}
        </span>
        <span className="min-w-0 truncate">{info.name}</span>
        <span className="ml-auto tabular text-slate-500">{info.code}</span>
        <Check size={16} className={cx('shrink-0', code === value ? 'text-emerald-600' : 'invisible')} aria-hidden />
      </button>
    );
  };

  return (
    <Sheet title="Currency" onClose={onClose}>
      <div className="space-y-3">
        <Input aria-label="Search currencies" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search" />
        {!needle && recent.length > 0 && (
          <div>
            <p className="mb-1 px-3 text-xs font-medium uppercase tracking-wide text-slate-500">Recent</p>
            <div className="divide-y divide-slate-200 overflow-hidden rounded-xl ring-1 ring-slate-200">{recent.map(row)}</div>
          </div>
        )}
        <div>
          <p className="mb-1 px-3 text-xs font-medium uppercase tracking-wide text-slate-500">All currencies</p>
          <div className="divide-y divide-slate-200 overflow-hidden rounded-xl ring-1 ring-slate-200">{matches.map((c) => row(c.code))}</div>
        </div>
      </div>
    </Sheet>
  );
}
