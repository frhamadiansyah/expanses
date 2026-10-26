import type { GoldPriceChoice, ListedPriceChoice, UnitKind } from '@expanses/core';
import { setGoldPriceChoice, setSecurityPriceChoice } from '@expanses/db';
import { useState } from 'react';
import { useApp } from '../../app/context';
import { useInvalidateAll } from '../../lib/queries';
import { ErrorBox } from '../../ui';
import { InsetGroup, InsetRow, PickerRow, SelectRow } from '../../ui/native';
import { GOLD_SOURCES, listedChoiceOf, listedSourceOptions } from '../prices/price-sources';
import { useSecurityPriceChoices } from '../prices/queries';
import { TradeSheet } from './AssetSheets';
import { usePositions } from './queries';
import { useStockAndBroker } from './StockAndBroker';
import { useGoldPriceChoice } from './world-gold';

/**
 * The row that changes how many are held with no money moving, by what one unit is: a split or bonus shares for a
 * share, and the same plain change for a fund's units, a bond's par or gold's grams.
 */
const UNITS_CHANGED: Record<Exclude<UnitKind, 'grams'>, { title: string; info: string }> = {
  shares: { title: 'Shares changed', info: 'A split or bonus shares' },
  units: { title: 'Units changed', info: 'A split or bonus units' },
  face: { title: 'Units changed', info: 'Added or taken off, no money moving' },
};

/**
 * A holding priced by the unit: where its price comes from, and the way to every price at once. Set once and seldom
 * touched, so in its Settings rather than on its page (owner, 23 Oct). A listed share chooses its security's source, gold
 * counted in grams the world price or typing, and anything else priced by the unit only has Update prices; the Assets
 * corner that used to open Update prices now opens Income.
 *
 * With units held, the group also changes how many there are with no money moving — a split, bonus shares — in the
 * same Units form Buy & sell's Units button opened, before that page was folded away. It is as seldom as a price
 * source, so it waits here with it.
 */
export function PricesGroup({
  accountId,
  priced,
  gold,
  holding,
}: {
  accountId: string;
  priced: boolean;
  gold: boolean;
  /** The holding as the Units form needs it, and what one unit of it is. */
  holding: { name: string; currency: string; unitKind: UnitKind | null };
}) {
  const { database, ws } = useApp();
  const invalidate = useInvalidateAll();
  const stock = useStockAndBroker(accountId);
  const choices = useSecurityPriceChoices();
  const goldChoice = useGoldPriceChoice(accountId, priced && gold);
  const positions = usePositions();
  const [changing, setChanging] = useState(false);
  const [error, setError] = useState<unknown>(null);
  if (!priced) return null;
  // As Buy & sell offered Units: a holding counted by the unit, with some held to change.
  // Gold counted in grams has no such change (owner, 26 Oct): its grams change only by a buy or a sell.
  const held = (positions.data?.[accountId]?.unitsMicro ?? 0) > 0 && holding.unitKind !== 'grams' && !gold;
  const unitsWords = UNITS_CHANGED[holding.unitKind === 'grams' ? 'units' : (holding.unitKind ?? 'units')];
  const security = stock.security?.ticker ? stock.security : null;
  const listed = security && choices.isSuccess ? listedChoiceOf(security, choices.data[security.id] ?? null) : null;
  const listedOptions = security ? listedSourceOptions(security) : [];
  const golden = gold ? (goldChoice.data ?? null) : null;

  const pick = (write: () => Promise<void>) => {
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
        {security && listed ? (
          <SelectRow
            label="Price source"
            info={`${listedOptions.map((o) => `${o.label}: ${o.detail}`).join('. ')}.`}
            value={listed}
            onChange={(e) => pick(() => setSecurityPriceChoice(database, ws, security.id, e.target.value as ListedPriceChoice))}
          >
            {listedOptions.map((o) => (
              <option key={o.choice} value={o.choice}>
                {o.label}
              </option>
            ))}
          </SelectRow>
        ) : null}
        {golden ? (
          <SelectRow
            label="Price source"
            info={`${GOLD_SOURCES.map((o) => `${o.label}: ${o.detail}`).join('. ')}.`}
            value={golden}
            onChange={(e) => pick(() => setGoldPriceChoice(database, ws, accountId, e.target.value as GoldPriceChoice))}
          >
            {GOLD_SOURCES.map((o) => (
              <option key={o.choice} value={o.choice}>
                {o.label}
              </option>
            ))}
          </SelectRow>
        ) : null}
        {/* Every holding priced by the unit, each with its price box and the exchange's file to fill the shares. */}
        <InsetRow plain title="Update prices" to="/net-worth/prices" />
        {held ? <PickerRow label={unitsWords.title} value="" info={unitsWords.info} onOpen={() => setChanging(true)} /> : null}
      </InsetGroup>
      {changing && (
        <TradeSheet
          title="Units"
          holding={{ accountId, name: holding.name, currency: holding.currency, byMoney: false }}
          initial={{ kind: 'unit_change' }}
          editing={null}
          onClose={() => setChanging(false)}
        />
      )}
    </>
  );
}
