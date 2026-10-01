import { type BrokerFees, parseMajor, parsePercentPpm, ppmPercent } from '@expanses/core';
import { brokerFeesOf, saveBrokerFees } from '@expanses/db';
import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { useApp } from '../../app/context';
import { useInvalidateAll } from '../../lib/queries';
import { ErrorBox } from '../../ui';
import { InsetGroup, TextRow } from '../../ui/native';
import { bareFigure } from './debt-rows';

/** A broker's fees as saved, or its defaults by name. */
export function useBrokerFees(accountId: string | null) {
  const { database, ws } = useApp();
  return useQuery({ queryKey: ['broker-fees', ws.workspaceId, accountId], queryFn: () => brokerFeesOf(database, ws, accountId!), enabled: accountId !== null });
}

const percentText = (ppm: number) => ppmPercent(ppm).replace('%', '');

/**
 * A broker's fees, on its cash account's settings: what the simple Buy and Sell sheets work each trade's fee out from.
 * Each row saves when it is left, as the page's other rows do.
 */
export function BrokerFeesGroup({ accountId }: { accountId: string }) {
  const fees = useBrokerFees(accountId);
  if (!fees.data) return null;
  return <FeeRows key={`${accountId}-${fees.dataUpdatedAt}`} accountId={accountId} fees={fees.data} />;
}

function FeeRows({ accountId, fees }: { accountId: string; fees: BrokerFees }) {
  const { database, ws } = useApp();
  const invalidate = useInvalidateAll();
  const [buy, setBuy] = useState(percentText(fees.buyPpm));
  const [sell, setSell] = useState(percentText(fees.sellPpm));
  const [minimum, setMinimum] = useState(fees.minDailyMinor === null ? '' : bareFigure(fees.minDailyMinor, 'IDR'));
  const [error, setError] = useState<unknown>(null);

  async function save() {
    setError(null);
    try {
      const next: BrokerFees = {
        buyPpm: parsePercentPpm(buy),
        sellPpm: parsePercentPpm(sell),
        minDailyMinor: minimum.trim() === '' ? null : parseMajor(minimum, 'IDR'),
      };
      if (next.buyPpm === fees.buyPpm && next.sellPpm === fees.sellPpm && next.minDailyMinor === fees.minDailyMinor) return;
      await saveBrokerFees(database, ws, accountId, next);
      await invalidate();
    } catch (e) {
      setError(e);
    }
  }

  return (
    <>
      <InsetGroup header="Fees">
        <TextRow label="Buy fee %" value={buy} onChange={(e) => setBuy(e.target.value)} onBlur={() => void save()} inputMode="decimal" />
        <TextRow
          label="Sell fee %"
          value={sell}
          onChange={(e) => setSell(e.target.value)}
          onBlur={() => void save()}
          inputMode="decimal"
          info="Includes IDX's 0,1% final tax on a sale (an ETF pays none, so it sells for 0,1% less). Check the broker's app; most charge 0,15% to buy and 0,25% to sell."
        />
        <TextRow
          label="Minimum fee per day"
          value={minimum}
          onChange={(e) => setMinimum(e.target.value)}
          onBlur={() => void save()}
          inputMode="numeric"
          placeholder="None"
          info="The least the broker charges for a day's trades together, in rupiah. Leave it empty if it has none."
        />
      </InsetGroup>
      <ErrorBox error={error} />
    </>
  );
}
