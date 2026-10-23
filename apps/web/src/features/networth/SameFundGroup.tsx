import { InsetGroup, SelectRow } from '../../ui/native';
import { ErrorBox } from '../../ui';
import { useAssetProfiles, useAssetValues } from './queries';
import { useStockAndBroker } from './StockAndBroker';

/**
 * The same fund held at another place: each place is an asset of its own, one tax row per institution, and this ties
 * them into one fund on Investments. Seldom set, so it sits in the fund's Settings rather than on its page.
 */
export function SameFundGroup({ accountId }: { accountId: string }) {
  const stock = useStockAndBroker(accountId);
  const profiles = useAssetProfiles();
  const values = useAssetValues();
  const fundIds = new Set((profiles.data ?? []).filter((row) => row.assetKind === 'fund').map((row) => row.accountId));
  const otherFunds = (values.data ?? []).filter((row) => row.accountId !== accountId && fundIds.has(row.accountId));
  if (otherFunds.length === 0) return null;
  return (
    <>
      <ErrorBox error={stock.error} />
      <InsetGroup footer="For the same fund held at two places: Investments shows them as one fund, with their total.">
        <SelectRow label="Same fund as" value={stock.samePlaces[0] ?? 'none'} onChange={(e) => void stock.sameFund(e.target.value === 'none' ? '' : e.target.value)}>
          <option value="none">No other place</option>
          {otherFunds.map((other) => (
            <option key={other.accountId} value={other.accountId}>
              {other.name}
            </option>
          ))}
        </SelectRow>
      </InsetGroup>
    </>
  );
}
