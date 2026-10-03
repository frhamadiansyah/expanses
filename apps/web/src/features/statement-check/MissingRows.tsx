import { formatMinor, minorToMajorString, parseMajor } from '@expanses/core';
import type { AccountRow, CheckDraftRow } from '@expanses/db';
import { MoreHorizontal } from 'lucide-react';
import { type ReactNode, useState } from 'react';
import { Sheet } from '../../app/Sheet';
import { Card, cx } from '../../ui';
import { InsetGroup, SegmentedControl, TextRow } from '../../ui/native';
import { CategoryIcon, UnknownCategoryMark } from '../categories/CategoryIcon';
import { CategoryPicker } from '../transactions/CategoryPicker';
import { DayHeader } from '../transactions/DayHeader';
import { missingByDay, needsCategory } from './check-model';

/**
 * The statement's rows missing from cicis, drawn like the Cashflow list (S9): a card per day, the category's circle,
 * the category as the title and "merchant · card" underneath. A tap chooses the category, which fills every row of
 * the same merchant; ⋯ corrects the amount or date the screenshot gave.
 */
export function MissingRows({
  rows,
  currency,
  cardName,
  accounts,
  onPick,
  onCorrect,
  footer,
}: {
  rows: readonly CheckDraftRow[];
  currency: string;
  cardName: string;
  accounts: readonly AccountRow[];
  onPick: (index: number, categoryId: string) => void;
  onCorrect: (index: number, patch: { on: string; amountMinor: number }) => void;
  footer: ReactNode;
}) {
  const [tab, setTab] = useState<'all' | 'gaps'>('all');
  const [picking, setPicking] = useState<CheckDraftRow | null>(null);
  const [editing, setEditing] = useState<CheckDraftRow | null>(null);
  const missing = rows.filter((r) => r.outcome.status === 'missing');
  const gaps = missing.filter((r) => needsCategory(r) && r.categoryId === null);
  const shown = tab === 'gaps' ? gaps : missing;
  const nameOf = (id: string | null) => (id ? (accounts.find((a) => a.id === id)?.name ?? null) : null);

  return (
    <>
      <SegmentedControl
        label="Missing rows"
        className="mb-[12px]"
        value={tab}
        onChange={(key) => setTab(key as 'all' | 'gaps')}
        segments={[
          { key: 'all', label: `All ${missing.length}` },
          { key: 'gaps', label: `Needs a category · ${gaps.length}` },
        ]}
      />
      {shown.length === 0 && <p className="py-4 text-center text-[15px] text-[var(--ph-ink-3)]">Every row has a category.</p>}
      {missingByDay(shown).map((day) => (
        <Card key={day.date} className="mb-3">
          <DayHeader date={day.date} net={day.net} currency={currency} />
          <ul className="divide-y divide-slate-100">
            {day.rows.map((row) => {
              const payment = row.outcome.status === 'missing' && row.outcome.as === 'payment';
              const name = nameOf(row.categoryId);
              const source = row.categorySource === 'known' ? 'known · ' : row.categorySource === 'same-merchant' ? 'same merchant · ' : '';
              return (
                <li key={row.index} data-testid="missing-row" className="flex list-none items-center gap-1">
                  <button
                    type="button"
                    disabled={payment}
                    onClick={() => setPicking(row)}
                    className="ph-focus flex min-w-0 flex-1 items-center gap-3 py-2 text-left"
                  >
                    {payment || row.categoryId ? <CategoryIcon categoryId={row.categoryId} accounts={accounts} transfer={payment} /> : <UnknownCategoryMark />}
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium">
                        {payment ? 'Card payment' : name ? name : <span className="text-[var(--ph-warn)]">Choose category</span>}
                      </span>
                      <span className="block truncate text-xs text-[var(--ph-ink-3)]">
                        {source && <span className="text-[var(--ph-tint)]">{source}</span>}
                        {row.description}
                        {' · '}
                        {cardName}
                      </span>
                    </span>
                    <span className={cx('tabular shrink-0 text-sm font-semibold whitespace-nowrap', row.direction === 'out' ? 'text-[var(--ph-alarm)]' : 'text-[var(--ph-tint)]')}>
                      {formatMinor(row.amountMinor, currency)}
                    </span>
                  </button>
                  <button
                    type="button"
                    aria-label={`Correct ${row.description}`}
                    onClick={() => setEditing(row)}
                    className="ph-focus flex h-11 w-9 shrink-0 items-center justify-center text-[var(--ph-ink-3)]"
                  >
                    <MoreHorizontal size={18} aria-hidden />
                  </button>
                </li>
              );
            })}
          </ul>
        </Card>
      ))}
      {footer}
      {picking && (
        <CategoryPicker
          kind="expense"
          lockKind
          title={picking.description}
          value={picking.categoryId ?? undefined}
          onPick={(categoryId) => onPick(picking.index, categoryId)}
          onClose={() => setPicking(null)}
        />
      )}
      {editing && <CorrectSheet row={editing} currency={currency} onSave={(patch) => onCorrect(editing.index, patch)} onClose={() => setEditing(null)} />}
    </>
  );
}

/** The amount or date the screenshot gave, corrected by hand. Nothing is learned from it yet (plan ruling). */
function CorrectSheet({
  row,
  currency,
  onSave,
  onClose,
}: {
  row: CheckDraftRow;
  currency: string;
  onSave: (patch: { on: string; amountMinor: number }) => void;
  onClose: () => void;
}) {
  const [amount, setAmount] = useState(() => minorToMajorString(row.amountMinor, currency));
  const [on, setOn] = useState(row.on);
  let amountMinor: number | null = null;
  try {
    amountMinor = parseMajor(amount, currency);
  } catch {
    amountMinor = null;
  }
  const valid = amountMinor !== null && amountMinor > 0 && /^\d{4}-\d{2}-\d{2}$/.test(on);
  return (
    <Sheet
      grouped
      title="Correct the row"
      onClose={onClose}
      confirm={{
        label: 'Save',
        disabled: !valid,
        run: () => {
          if (!valid) return;
          onSave({ on, amountMinor: amountMinor! });
          onClose();
        },
      }}
    >
      <InsetGroup header={row.description} footer="As the statement prints it. The screenshot is not kept.">
        <TextRow label={`Amount (${currency})`} value={amount} onChange={(e) => setAmount(e.target.value)} inputMode="decimal" />
        <TextRow label="Date" type="date" value={on} onChange={(e) => setOn(e.target.value)} />
      </InsetGroup>
    </Sheet>
  );
}
