import { dayMonth, formatMinor, isoDate, monthName, type SinkingHistoryRow } from '@expanses/core';
import { setSinkingMonthSkipped, sinkingHistoryOf } from '@expanses/db';
import { useQuery } from '@tanstack/react-query';
import { useParams } from '@tanstack/react-router';
import { useState } from 'react';
import { useApp } from '../../app/context';
import { useInvalidateAll } from '../../lib/queries';
import { ErrorBox } from '../../ui';
import { InsetGroup, InsetRow, PushedTitle, SCREEN } from '../../ui/native';
import { ALERT_ROW, NoticeAlert } from '../../ui/native/NoticeAlert';

export function FundHistoryRoute() {
  const { billId } = useParams({ from: '/bills/$billId/fund-history' });
  return <FundHistoryPage billId={billId} />;
}

const monthLabel = (month: string) => `${monthName(month, 'short')} ${month.slice(0, 4)}`;
const dateLabel = (date: string) => `${dayMonth(date)} ${date.slice(0, 4)}`;

/** Every month begun and every amount put in or set aside at the start, newest first. A month can be skipped from here. */
export function FundHistoryPage({ billId }: { billId: string }) {
  const { database, ws } = useApp();
  const invalidate = useInvalidateAll();
  const today = isoDate();
  const history = useQuery({ queryKey: ['sinking-history', ws.workspaceId, billId, today], queryFn: () => sinkingHistoryOf(database, ws, billId, today) });
  const [picked, setPicked] = useState<SinkingHistoryRow | null>(null);
  const [error, setError] = useState<unknown>(null);
  const data = history.data;
  const currency = data?.currency ?? ws.baseCurrency;

  async function toggle(row: SinkingHistoryRow) {
    setError(null);
    try {
      await setSinkingMonthSkipped(database, ws, billId, row.date, !row.skipped, today);
      await invalidate();
    } catch (e) {
      setError(e);
    } finally {
      setPicked(null);
    }
  }

  return (
    <div className={SCREEN}>
      <PushedTitle title="History" back={data?.name ?? 'Bill'} backTo="/bills/$billId" backParams={{ billId }} />
      <ErrorBox error={history.error ?? error} />
      {data && (
        <InsetGroup>
          {data.rows.map((row) => {
            const month = row.kind === 'month';
            const title = month ? monthLabel(row.date) : row.kind === 'opening' ? monthLabel(row.date.slice(0, 7)) : dateLabel(row.date);
            const subtitle = row.kind === 'opening' ? 'Already saved, when set up' : row.kind === 'extra' ? 'Put in extra' : row.skipped ? 'Skipped' : `Month ${row.index} of ${row.monthsTotal}`;
            return (
              <InsetRow
                key={`${row.kind}-${row.entryId ?? row.date}`}
                testId={month ? `history-month-${row.date}` : `history-${row.kind}`}
                title={
                  <span>
                    {title}
                    {row.current && <span className="ml-2 text-[13px] font-semibold text-[var(--ph-tint)]">now</span>}
                  </span>
                }
                subtitle={subtitle}
                value={row.skipped ? 'Skipped' : `+ ${formatMinor(row.amountMinor, currency)}`}
                valueTone={row.skipped ? 'ink-3' : 'gain'}
                chevron={false}
                onClick={month ? () => setPicked(row) : undefined}
              />
            );
          })}
        </InsetGroup>
      )}
      {picked && (
        <NoticeAlert
          title={monthLabel(picked.date)}
          text={picked.skipped ? 'Skipped' : formatMinor(picked.amountMinor, currency)}
          closeLabel="Not now"
          onClose={() => setPicked(null)}
          actions={
            <button type="button" className={`${ALERT_ROW} font-semibold`} onClick={() => void toggle(picked)}>
              {picked.skipped ? 'Add this month again' : 'Skip this month'}
            </button>
          }
        />
      )}
    </div>
  );
}
