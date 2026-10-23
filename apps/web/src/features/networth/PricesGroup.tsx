import { setGoldPriceChoice, setSecurityPriceChoice } from '@expanses/db';
import { useState } from 'react';
import { useApp } from '../../app/context';
import { useInvalidateAll } from '../../lib/queries';
import { ErrorBox } from '../../ui';
import { InsetGroup, InsetRow } from '../../ui/native';
import { CHOICE_LABELS, listedChoiceOf, listedSourceOptions } from '../prices/price-sources';
import { useSecurityPriceChoices } from '../prices/queries';
import { GOLD_SOURCES, PriceSourceSheet } from './AssetSheets';
import { useStockAndBroker } from './StockAndBroker';
import { useGoldPriceChoice } from './world-gold';

/**
 * A holding priced by the unit: where its price comes from, and the way to every price at once. Set once and seldom
 * touched, so in its Settings rather than on its page (owner, 23 Oct). A listed share chooses its security's source, gold
 * counted in grams the world price or typing, and anything else priced by the unit only has Update prices; the Assets
 * corner that used to open Update prices now opens Dividends.
 */
export function PricesGroup({ accountId, priced, gold }: { accountId: string; priced: boolean; gold: boolean }) {
  const { database, ws } = useApp();
  const invalidate = useInvalidateAll();
  const stock = useStockAndBroker(accountId);
  const choices = useSecurityPriceChoices();
  const goldChoice = useGoldPriceChoice(accountId, priced && gold);
  const [picking, setPicking] = useState(false);
  const [error, setError] = useState<unknown>(null);
  if (!priced) return null;
  const security = stock.security?.ticker ? stock.security : null;
  const listed = security && choices.isSuccess ? listedChoiceOf(security, choices.data[security.id] ?? null) : null;
  const golden = gold ? (goldChoice.data ?? null) : null;

  const pick = (write: () => Promise<void>) => {
    setPicking(false);
    void (async () => {
      try {
        await write();
        await invalidate();
      } catch (e) {
        setError(e);
      }
    })();
  };

  return (
    <>
      <ErrorBox error={error} />
      <InsetGroup header="Prices">
        {listed ? <InsetRow title="Price source" value={CHOICE_LABELS[listed]} onClick={() => setPicking(true)} /> : null}
        {golden ? <InsetRow title="Price source" value={golden === 'world' ? 'World price' : "I'll type it"} onClick={() => setPicking(true)} /> : null}
        {/* Every holding priced by the unit, each with its price box and the exchange's file to fill the shares. */}
        <InsetRow title="Update prices" to="/net-worth/prices" />
      </InsetGroup>
      {picking && security && listed && (
        <PriceSourceSheet
          choice={listed}
          options={listedSourceOptions(security)}
          onPick={(next) => pick(() => setSecurityPriceChoice(database, ws, security.id, next))}
          onClose={() => setPicking(false)}
        />
      )}
      {picking && golden && (
        <PriceSourceSheet choice={golden} options={GOLD_SOURCES} onPick={(next) => pick(() => setGoldPriceChoice(database, ws, accountId, next))} onClose={() => setPicking(false)} />
      )}
    </>
  );
}
