import { isoDate } from '@expanses/core';
import type { AccountRow } from '@expanses/db';
import { useApp } from '../../app/context';
import { useForeignLots } from '../../lib/withdrawal-queries';
import { withdrawalsLeftView } from '../../lib/withdrawal-rate';
import { approxLine, InsetGroup, InsetRow } from '../../ui/native';

/**
 * A foreign pocket's page (withdrawal rate §7): what the money held cost, what it is worth at today's market rate, and
 * each withdrawal still in it — date, what is left of it, the rate it came at — with a line for money spent before any
 * withdrawal was recorded.
 */
export function WithdrawalsLeft({ account, balanceMinor, rates }: { account: AccountRow; balanceMinor: number; rates: { rates: Record<string, number>; stale: string[] } | undefined }) {
  const { ws } = useApp();
  const lots = useForeignLots(account.id);
  if (!lots.data) return null;
  const view = withdrawalsLeftView(lots.data, ws.baseCurrency, isoDate());
  const worth = approxLine(balanceMinor, account.currency!, ws.baseCurrency, rates?.rates ?? {});
  return (
    <>
      <InsetGroup header="What it cost">
        <InsetRow testId="fx-cost" title="Cost" value={view.costText} valueTone="ink" chevron={false} />
        <InsetRow testId="fx-worth" title="Worth today" value={worth ?? '—'} valueTone="ink" chevron={false} />
      </InsetGroup>
      {(view.rows.length > 0 || view.shortfallText) && (
        <InsetGroup header="Withdrawals left">
          {view.rows.map((row) => (
            <InsetRow key={row.key} testId={`lot-${row.key}`} title={row.title} value={row.value} chevron={false} />
          ))}
          {view.shortfallText && <InsetRow testId="fx-shortfall" title="No withdrawal" value={view.shortfallText} chevron={false} />}
        </InsetGroup>
      )}
    </>
  );
}
