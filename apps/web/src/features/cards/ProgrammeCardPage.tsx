import { isoDate } from '@expanses/core';
import { type CardStatementMonth, cardStatementMonths, catchUpAllCycles, clearCycleActual, deriveCycleEntries, getProgramme, programmeEarners, recordCycleActual } from '@expanses/db';
import { useQuery } from '@tanstack/react-query';
import { useNavigate, useParams } from '@tanstack/react-router';
import { useEffect, useRef, useState } from 'react';
import { useApp } from '../../app/context';
import { Sheet } from '../../app/Sheet';
import { useAccounts, useInvalidateAll } from '../../lib/queries';
import { Empty, ErrorBox } from '../../ui';
import { DestructiveRow, InsetGroup, InsetRow, PushedTitle, ReadOnlyRow, SCREEN, TextRow } from '../../ui/native';
import { formatPoints } from './format-points';
import { hasEarlierYears, yearGroups } from './statement-years';
import { type CycleResult, loadCardPoints, loadCycleResult } from './useCardPoints';

const dayMonth = (date: string) => new Date(`${date}T00:00:00`).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
const dayMonthYear = (date: string) => new Date(`${date}T00:00:00`).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
const monthYear = (date: string) => new Date(`${date}T00:00:00`).toLocaleDateString('en-GB', { month: 'long', year: 'numeric' });
const shortMonthYear = (date: string) => new Date(`${date}T00:00:00`).toLocaleDateString('en-GB', { month: 'short', year: 'numeric' });

/** Posted is the bank's figure, Estimated the app's own working: the two tags a statement carries. */
function Tag({ posted }: { posted: boolean }) {
  return (
    <span
      className={
        posted
          ? 'rounded-full bg-[var(--ph-info-panel)] px-[8px] py-[2px] text-[12px] leading-[16px] font-semibold text-[var(--ph-info-ink)]'
          : 'rounded-full bg-[var(--ph-warn-panel)] px-[8px] py-[2px] text-[12px] leading-[16px] font-semibold text-[var(--ph-warn-ink)]'
      }
    >
      {posted ? 'Posted' : 'Estimated'}
    </span>
  );
}

/**
 * One card earning into a programme: its statements, year by year, newest first. Opening the page works out every
 * statement back to the card's first purchase, so the older months are already there as estimates. A month opens a
 * sheet to type the points the bank's statement shows; saving makes it Posted, clearing the typed figure brings the
 * estimate back. The newest year and the one before it show first, and Show earlier years adds one at a time.
 */
export function ProgrammeCardPage() {
  const { database, ws } = useApp();
  const { programmeId, programId } = useParams({ strict: false }) as { programmeId: string; programId: string };
  const navigate = useNavigate();
  const invalidate = useInvalidateAll();
  const today = isoDate();
  const [ready, setReady] = useState(false);
  const [extra, setExtra] = useState(0);
  const [open, setOpen] = useState<CardStatementMonth | null>(null);
  const [error, setError] = useState<unknown>(null);
  const started = useRef(false);

  // Working every cycle out once, as the page opens; the list reads what that wrote.
  useEffect(() => {
    if (started.current) return;
    started.current = true;
    void (async () => {
      try {
        await catchUpAllCycles(database, ws, programId, today);
        await invalidate();
      } catch (e) {
        setError(e);
      } finally {
        setReady(true);
      }
    })();
  }, [database, ws, programId, today, invalidate]);

  const data = useQuery({
    queryKey: ['programme-card', ws.workspaceId, programmeId, programId, today],
    enabled: ready,
    queryFn: async () => {
      const programme = await getProgramme(database, ws, programmeId);
      const earner = ((await programmeEarners(database, ws)).get(programmeId) ?? []).find((e) => e.programId === programId);
      if (!programme || !earner) return null;
      return { programme, earner, ...(await cardStatementMonths(database, ws, programId, today)) };
    },
  });
  if (data.isSuccess && data.data === null) return <Empty>Card not found.</Empty>;
  if (!data.data) return <p className="text-sm text-slate-500">Working out statements…</p>;
  const { programme, earner, months, firstPurchaseOn, adjusts } = data.data;
  const groups = yearGroups(months, extra);
  const more = hasEarlierYears(months, extra);
  const shownFrom = groups[groups.length - 1]?.months[groups[groups.length - 1]!.months.length - 1]?.start ?? '';
  const twice = adjusts.filter((on) => on >= shownFrom || !more);

  return (
    <div className={SCREEN}>
      <PushedTitle
        title={earner.cardName}
        back="Settings"
        onBack={() => void navigate({ to: '/cards/points/$programmeId', params: { programmeId }, search: { settings: true } })}
      />
      <ErrorBox error={error} />
      <div data-testid="programme-card-statements">
        {groups.length === 0 ? (
          <InsetGroup>
            <InsetRow title={<span className="text-[var(--ph-ink-3)]">Nothing yet</span>} />
          </InsetGroup>
        ) : (
          groups.map((group) => (
            <InsetGroup key={group.year} header={String(group.year)}>
              {group.months.map((month) => (
                <InsetRow
                  key={month.start}
                  testId="programme-card-statement"
                  title={monthYear(month.end)}
                  subtitle={`Closed ${dayMonth(month.end)}`}
                  value={
                    <span className="flex items-center gap-[8px]">
                      <span className="tabular">{formatPoints(month.points)}</span>
                      <Tag posted={month.posted} />
                    </span>
                  }
                  onClick={() => setOpen(month)}
                  chevron
                />
              ))}
            </InsetGroup>
          ))
        )}
      </div>
      {more && firstPurchaseOn && (
        <InsetGroup>
          <InsetRow
            plain
            testId="programme-show-earlier"
            title="Show earlier years"
            subtitle={`Back to ${shortMonthYear(firstPurchaseOn)}, the first purchase on this card`}
            onClick={() => setExtra((n) => n + 1)}
            chevron
          />
        </InsetGroup>
      )}
      {twice.length > 0 && (
        <InsetGroup>
          {twice.slice(0, 3).map((on) => (
            <InsetRow key={on} plain testId="programme-adjust-note" title={`Adjust on ${dayMonthYear(on)} may count some of these twice`} />
          ))}
          {twice.length > 3 && <InsetRow plain title={`and ${twice.length - 3} more`} />}
        </InsetGroup>
      )}
      {open && <MonthSheet programId={programId} unit={programme.unit} cardAccountId={earner.cardAccountId} month={open} today={today} onClose={() => setOpen(null)} />}
    </div>
  );
}

/** One statement: what the purchases come to, and a field for the points the bank's statement shows. */
function MonthSheet({
  programId,
  cardAccountId,
  unit,
  month,
  today,
  onClose,
}: {
  programId: string;
  cardAccountId: string;
  unit: string;
  month: CardStatementMonth;
  today: string;
  onClose: () => void;
}) {
  const { database, ws } = useApp();
  const invalidate = useInvalidateAll();
  const accounts = useAccounts();
  const [value, setValue] = useState(month.typed === null ? '' : String(month.typed).replace('.', ','));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const cycle = { start: month.start, end: month.end };
  const estimate = useQuery({
    queryKey: ['programme-card-estimate', ws.workspaceId, programId, month.start],
    enabled: !!accounts.data,
    queryFn: async (): Promise<{ result: CycleResult; perPurchase: boolean }> => {
      const all = accounts.data!;
      const card = all.find((account) => account.id === cardAccountId)!;
      const cp = await loadCardPoints(database, ws, card, all, today);
      return { result: await loadCycleResult(database, ws, cp, all, cycle), perPurchase: cp.crediting === 'per_transaction' };
    },
  });
  const perPurchase = estimate.data?.perPurchase ?? false;
  const estimated = estimate.data
    ? perPurchase
      ? Object.values(estimate.data.result.earn.bonusById).reduce((sum, points) => sum + points, 0)
      : estimate.data.result.earn.totalPoints
    : null;

  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
      // The cycle is worked out again now, so the list shows it Posted, or back to the estimate.
      await deriveCycleEntries(database, ws, programId, cycle);
      await invalidate();
      onClose();
    } catch (e) {
      setError(e);
      setBusy(false);
    }
  };
  const typed = Number(value.trim().replace(',', '.'));

  return (
    <Sheet
      grouped
      title={monthYear(month.end)}
      onClose={onClose}
      confirm={{
        label: 'Save statement points',
        disabled: busy || value.trim() === '' || !Number.isFinite(typed),
        run: () => void run(() => recordCycleActual(database, ws, { programId, cycleStart: month.start, actualPoints: typed })),
      }}
    >
      <ErrorBox error={error} />
      <InsetGroup>
        <ReadOnlyRow label="Statement closed" value={dayMonthYear(month.end)} />
        <ReadOnlyRow label="Estimated from purchases" value={estimated === null ? '…' : `${formatPoints(estimated)} ${unit}`} />
        <TextRow label={perPurchase ? 'Bonus points credited' : 'Points on the statement'} value={value} onChange={(e) => setValue(e.target.value)} inputMode="decimal" placeholder={unit} />
      </InsetGroup>
      {month.typed !== null && (
        <InsetGroup>
          <DestructiveRow label="Clear typed points" onClick={() => void run(() => clearCycleActual(database, ws, { programId, cycleStart: month.start }))} />
        </InsetGroup>
      )}
    </Sheet>
  );
}
