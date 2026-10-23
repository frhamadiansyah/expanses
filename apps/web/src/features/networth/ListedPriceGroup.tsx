import { setSecurityPriceChoice } from '@expanses/db';
import { useState } from 'react';
import { useApp } from '../../app/context';
import { useInvalidateAll } from '../../lib/queries';
import { ErrorBox } from '../../ui';
import { InsetGroup, InsetRow } from '../../ui/native';
import { CHOICE_LABELS, listedChoiceOf, listedSourceOptions } from '../prices/price-sources';
import { useSecurityPriceChoices } from '../prices/queries';
import { PriceSourceSheet } from './AssetSheets';
import { useStockAndBroker } from './StockAndBroker';

/**
 * Where a listed holding's price comes from, and the way to every price at once: set once and seldom touched, so in its
 * Settings rather than on its page (owner, 23 Oct).
 */
export function ListedPriceGroup({ accountId, priced }: { accountId: string; priced: boolean }) {
  const { database, ws } = useApp();
  const invalidate = useInvalidateAll();
  const stock = useStockAndBroker(accountId);
  const choices = useSecurityPriceChoices();
  const [picking, setPicking] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const security = priced && stock.security?.ticker ? stock.security : null;
  if (!security || !choices.isSuccess) return null;
  const choice = listedChoiceOf(security, choices.data[security.id] ?? null);
  return (
    <>
      <ErrorBox error={error} />
      <InsetGroup header="Prices">
        <InsetRow title="Price source" value={CHOICE_LABELS[choice]} onClick={() => setPicking(true)} />
        {/* Every share and fund held, each with its price box and the exchange's file to fill the shares. */}
        <InsetRow title="Update prices" to="/net-worth/prices" />
      </InsetGroup>
      {picking && (
        <PriceSourceSheet
          choice={choice}
          options={listedSourceOptions(security)}
          onPick={(next) => {
            setPicking(false);
            void (async () => {
              try {
                await setSecurityPriceChoice(database, ws, security.id, next);
                await invalidate();
              } catch (e) {
                setError(e);
              }
            })();
          }}
          onClose={() => setPicking(false)}
        />
      )}
    </>
  );
}
