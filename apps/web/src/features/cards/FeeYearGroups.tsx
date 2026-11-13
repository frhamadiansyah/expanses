import { type FeeWaiver, feeProgressWindow, groupedMajorString, groupTypedAmount, parseGroupedMajor, waiverSpend } from '@expanses/core';
import { addFeeCharge, addFeeReversal, type AccountRow, cardFeeYears, cardSpendLines, type FeeYearRecord, saveFeeWaived, undoFeeWaived } from '@expanses/db';
import { useQuery } from '@tanstack/react-query';
import { getRouteApi, useNavigate } from '@tanstack/react-router';
import { MoreVertical } from 'lucide-react';
import { useState } from 'react';
import { useApp } from '../../app/context';
import { Sheet } from '../../app/Sheet';
import { useInvalidateAll } from '../../lib/queries';
import { ErrorBox } from '../../ui';
import { ActionMenu, type MenuChoice } from '../../ui/native/ActionMenu';
import { ALERT_ROW, NoticeAlert } from '../../ui/native/NoticeAlert';
import { InsetGroup, InsetRow, TextRow } from '../../ui/native';
import { DateRow } from '../transactions/CardRows';
import { CardScreen, useCardPage } from './card-page';
import { earlierFeeText, type FeeRow, feeRows } from './fee-line';
import { expenseAncestors } from './useCardPoints';

/*
 * The fee years on the Fee waiver page (owner, 13 Nov 2026): this year's fee, its lines read from the card's own
 * transactions, each with a ⋮ that opens a few plain choices, and the earlier years one line each.
 */

/** The card's fee years, read from its transactions; null data on a card with no fee date. */
export function useFeeYears(cardId: string, today: string) {
  const { database, ws } = useApp();
  return useQuery({ queryKey: ['fee-years', ws.workspaceId, cardId, today], queryFn: () => cardFeeYears(database.db, ws, { cardId, today }) });
}

/**
 * What a program has counted, for its Progress row: the spend in its window (the covered fee's, or the next one's once
 * this year is settled) and the fee year it counts toward. Undefined while it is read; null for no program or Free for life.
 */
export function useFeeProgress(card: AccountRow, accounts: readonly AccountRow[], waiver: FeeWaiver | null, feeOn: string | null, today: string, settled: boolean) {
  const { database, ws } = useApp();
  const counted = waiver && waiver.kind !== 'lifetime' ? waiver : null;
  const window = counted ? feeProgressWindow(counted, feeOn, today, settled) : null;
  const currency = card.currency ?? ws.baseCurrency;
  const q = useQuery({
    queryKey: ['fee-progress', ws.workspaceId, card.id, window?.from ?? '', window?.to ?? '', JSON.stringify(counted?.categoryIds ?? [])],
    enabled: window !== null,
    queryFn: async () => {
      const lines = await cardSpendLines(database, ws, card.id, window!.from, window!.to);
      return waiverSpend(counted!, window!, lines, expenseAncestors(accounts as AccountRow[]), currency);
    },
  });
  if (!counted || !window) return null;
  if (q.data === undefined) return undefined;
  return { spentMinor: q.data, feeYear: window.feeYear };
}

/** One fee line: `Title  value  ⋮`; a tap anywhere on it opens its choices. A line with none has no ⋮. */
function FeeLine({ row, onMore, testId }: { row: FeeRow; onMore: (() => void) | null; testId: string }) {
  return (
    <InsetRow
      plain
      testId={testId}
      title={row.title}
      label={onMore ? `${row.title}, ${row.value}, more` : undefined}
      chevron={false}
      onClick={onMore ?? undefined}
      value={
        <span className="flex items-center gap-[8px]">
          <span data-testid={`${testId}-value`} className="text-[var(--ph-ink-3)]">
            {row.value}
          </span>
          {onMore && <MoreVertical size={18} aria-hidden className="text-[var(--ph-tint)]" />}
        </span>
      }
    />
  );
}

/** Reset?: asked before a waived year reads as pending again. */
export function ResetAlert({ onReset, onClose }: { onReset: () => void; onClose: () => void }) {
  return (
    <NoticeAlert
      title="Reset?"
      text="The fee reads as pending again."
      actions={
        <button
          type="button"
          data-testid="fee-reset-confirm"
          className={`${ALERT_ROW} font-semibold text-[var(--ph-alarm)]`}
          onClick={() => {
            onClose();
            onReset();
          }}
        >
          Reset
        </button>
      }
      closeLabel="Cancel"
      onClose={onClose}
    />
  );
}

type Adding = { kind: 'charge' | 'reversal'; amount: string; on: string };

/** Add the charge / Add reversal: the amount and the date, nothing else. ✓ writes it on the card through the ledger. */
function AddFeeSheet({ cardId, currency, today, adding, onClose }: { cardId: string; currency: string; today: string; adding: Adding; onClose: () => void }) {
  const { database, ws } = useApp();
  const invalidate = useInvalidateAll();
  const [amount, setAmount] = useState(adding.amount);
  const [on, setOn] = useState(adding.on);
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const minor = amount.trim() ? parseGroupedMajor(amount, currency) : 0;
  const save = async () => {
    setError(null);
    setBusy(true);
    try {
      const input = { cardId, today, amountMinor: minor, on };
      await (adding.kind === 'charge' ? addFeeCharge(database, ws, input) : addFeeReversal(database, ws, input));
      await invalidate();
      onClose();
    } catch (e) {
      setError(e);
    }
    setBusy(false);
  };
  return (
    <Sheet grouped title={adding.kind === 'charge' ? 'Add the charge' : 'Add reversal'} onClose={onClose} confirm={{ label: 'Save', disabled: busy || !(minor > 0) || on === '', run: () => void save() }}>
      <InsetGroup>
        <TextRow label="Amount" prefix={currency} value={amount} onChange={(e) => setAmount(groupTypedAmount(e.target.value, currency))} inputMode="decimal" placeholder="Amount" />
        <DateRow on={on} onChange={setOn} max={today} />
      </InsetGroup>
      <ErrorBox error={error} />
    </Sheet>
  );
}

/**
 * This year's fee and the earlier years, below the program. `reached` puts Waived, not charged first on a pending
 * fee: the program says the bank is likely to skip it.
 */
export function FeeYearGroups({ cardId, currency, today, reached }: { cardId: string; currency: string; today: string; reached: boolean }) {
  const { database, ws } = useApp();
  const invalidate = useInvalidateAll();
  const navigate = useNavigate();
  const years = useFeeYears(cardId, today);
  const [menu, setMenu] = useState<{ title: string; choices: MenuChoice[] } | null>(null);
  const [adding, setAdding] = useState<Adding | null>(null);
  const [resetting, setResetting] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const data = years.data;
  if (!data) return null;
  const record: FeeYearRecord = data.current;
  const feeMinor = data.feeMinor;
  const amountText = (minor: number | null) => (minor !== null ? groupedMajorString(minor, currency) : '');

  const run = async (write: () => Promise<unknown>) => {
    setError(null);
    try {
      await write();
      await invalidate();
    } catch (e) {
      setError(e);
    }
  };
  const open = (transactionId: string) => void navigate({ to: '/transactions/$transactionId', params: { transactionId } });
  const notCharged: MenuChoice = { key: 'waived', label: 'Waived, not charged', testId: 'fee-menu-waived', run: () => void run(() => saveFeeWaived(database, ws, { cardId, today })) };
  const addCharge: MenuChoice = {
    key: 'charge',
    label: 'Add the charge',
    testId: 'fee-menu-add-charge',
    run: () => setAdding({ kind: 'charge', amount: amountText(feeMinor), on: record.covered <= today ? record.covered : today }),
  };
  // The charge's own amount (the fee and its tax, as charged) when it is on the card; the card's fee before the app.
  const addReversal: MenuChoice = {
    key: 'reversal',
    label: 'Add reversal',
    testId: 'fee-menu-add-reversal',
    run: () => setAdding({ kind: 'reversal', amount: amountText(record.charge ? record.charge.amountMinor : feeMinor), on: today }),
  };
  const reset: MenuChoice = { key: 'reset', label: 'Reset', destructive: true, testId: 'fee-menu-reset', run: () => setResetting(true) };

  const choicesFor = (row: FeeRow): MenuChoice[] => {
    switch (row.kind) {
      case 'pending':
        // A charge before the card is counted from is in its starting balance: it is never added again, only reversed.
        if (record.beforeApp) return [notCharged, addReversal];
        // A fee still ahead has nothing to add yet: it can only be waived in advance.
        if (record.covered > today) return [notCharged];
        return reached ? [notCharged, addCharge] : [addCharge, notCharged];
      case 'charged':
        return [
          ...(record.reversal ? [] : [addReversal]),
          { key: 'open', label: 'Open the charge', testId: 'fee-menu-open-charge', run: () => open(row.transactionId!) },
        ];
      case 'reversal':
        return [{ key: 'open', label: 'Open the reversal', testId: 'fee-menu-open-reversal', run: () => open(row.transactionId!) }];
      case 'waived':
        return [reset];
      default:
        return [];
    }
  };

  const rows = feeRows(record, feeMinor, currency);
  return (
    <>
      <ErrorBox error={error} />
      <InsetGroup header="This year's fee">
        {rows.map((row) => {
          const choices = choicesFor(row);
          return <FeeLine key={row.kind} row={row} testId={`fee-line-${row.kind}`} onMore={choices.length > 0 ? () => setMenu({ title: row.title, choices }) : null} />;
        })}
      </InsetGroup>
      {data.earlier.length > 0 && (
        <InsetGroup header="Earlier years">
          {data.earlier.map((year) => (
            <InsetRow
              key={year.year}
              plain
              testId={`fee-year-${year.year}`}
              title={String(year.year)}
              value={earlierFeeText(year, currency)}
              to="/cards/$cardId/settings/fee-waiver/$year"
              params={{ cardId, year: String(year.year) }}
            />
          ))}
        </InsetGroup>
      )}
      {menu && <ActionMenu label={menu.title} choices={menu.choices} onClose={() => setMenu(null)} testId="fee-menu" />}
      {adding && <AddFeeSheet cardId={cardId} currency={currency} today={today} adding={adding} onClose={() => setAdding(null)} />}
      {resetting && <ResetAlert onClose={() => setResetting(false)} onReset={() => void run(() => undoFeeWaived(database, ws, { cardId, today }))} />}
    </>
  );
}

const yearRoute = getRouteApi('/cards/$cardId/settings/fee-waiver/$year');

/**
 * `/cards/$cardId/settings/fee-waiver/$year`: one earlier fee year, read only — its Charged and Reversal lines (a tap
 * opens the transaction) and, for a year marked waived with no money recorded, Reset (asked first). A reset that would
 * move money is not offered here: a reversal is taken back by opening it and deleting it.
 */
export function FeeYearPage() {
  const { cardId, year } = yearRoute.useParams();
  const { page, gate } = useCardPage(cardId);
  const { database, ws } = useApp();
  const invalidate = useInvalidateAll();
  const navigate = useNavigate();
  const today = page?.today ?? '';
  const years = useFeeYears(cardId, today);
  const [resetting, setResetting] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const record = years.data?.earlier.find((y) => String(y.year) === year) ?? null;
  const currency = page?.currency ?? ws.baseCurrency;
  const reset = async () => {
    setError(null);
    try {
      await undoFeeWaived(database, ws, { cardId, today, year: Number(year) });
      await invalidate();
      window.history.back();
    } catch (e) {
      setError(e);
    }
  };
  return (
    <CardScreen title="Fee waiver" back="Fee waiver" fallback={`/cards/${cardId}/settings/fee-waiver`}>
      {gate}
      <ErrorBox error={error} />
      {page && years.isSuccess && (
        <InsetGroup header={`${year} fee`}>
          {!record && <InsetRow plain title="Nothing recorded" />}
          {record &&
            feeRows(record, years.data?.feeMinor ?? null, currency, true).map((row) => (
              <InsetRow
                key={row.kind}
                plain
                testId={`fee-year-line-${row.kind}`}
                title={row.title}
                value={row.value}
                chevron={row.transactionId !== null}
                onClick={row.transactionId ? () => void navigate({ to: '/transactions/$transactionId', params: { transactionId: row.transactionId! } }) : undefined}
              />
            ))}
        </InsetGroup>
      )}
      {record && record.marked && !record.charge && !record.reversal && (
        <InsetGroup>
          <InsetRow destructive title={`Reset ${year}`} testId="fee-year-reset" onClick={() => setResetting(true)} />
        </InsetGroup>
      )}
      {resetting && <ResetAlert onClose={() => setResetting(false)} onReset={() => void reset()} />}
    </CardScreen>
  );
}
