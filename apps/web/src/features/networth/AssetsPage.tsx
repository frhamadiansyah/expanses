import { HelpCircle, Plus } from 'lucide-react';
import { useState } from 'react';
import { Empty, ErrorBox, Money } from '../../ui';
import { type CornerAction, Hero, InsetGroup, InsetRow, LargeTitle, Panel, SCREEN } from '../../ui/native';
import { AddAssetForm } from './AddAssetForm';
import { NetWorthTabs } from './NetWorthTabs';
import { UpdatePricesSheet } from './UpdatePricesSheet';
import { type AssetGroup, type AssetRow, groupAssets, liveGroups, soldRows, staleRows, totalOf } from './asset-rows';
import { useAssetProfiles, useAssetValues } from './queries';

/** What the row says under its name: how it is valued, its tax code, and whether it needs attention. */
function subtitleOf(row: AssetRow): string {
  return [row.method, row.coretax, row.stale && !row.sold ? 'Update price' : null, row.sold ? 'Sold' : null].filter(Boolean).join(' · ');
}

/** The sentence naming what is out of date. The same words it has always been, in the group's own footer. */
function staleNote(stale: AssetRow[]): string {
  return `${stale.length === 1 ? '1 asset needs' : `${stale.length} assets need`} a fresh price or estimate: ${stale.map((row) => row.name).join(', ')}.`;
}

function Row({ row }: { row: AssetRow }) {
  return (
    <InsetRow
      to="/net-worth/assets/$accountId"
      params={{ accountId: row.accountId }}
      title={row.name}
      subtitle={subtitleOf(row)}
      value={<Money minor={row.valueMinor} currency={row.currency} />}
      valueTone={row.stale && !row.sold ? 'warn' : 'ink'}
    />
  );
}

function Group({ group }: { group: AssetGroup }) {
  return (
    <InsetGroup header={group.label} trailing={<Money minor={group.totalMinor} currency={group.rows[0]?.currency ?? 'IDR'} />}>
      {group.rows.map((row) => (
        <Row key={row.accountId} row={row} />
      ))}
    </InsetGroup>
  );
}

export function AssetsPage() {
  const values = useAssetValues();
  const profiles = useAssetProfiles();
  const [showSold, setShowSold] = useState(false);
  const [adding, setAdding] = useState(false);
  const [updatingPrices, setUpdatingPrices] = useState(false);

  const groups = values.data && profiles.data ? groupAssets(values.data, profiles.data) : [];
  const live = liveGroups(groups);
  const sold = soldRows(groups);
  const stale = staleRows(groups);
  const baseCurrency = values.data?.[0]?.currency ?? 'IDR';

  /*
   * The title row used to carry the running total, a text link and a dark rectangle at once, which at 390 px was
   * four things fighting for one line. The total is the page's figure, so it is the hero; the two actions are
   * corner glyphs. The inline form is still one click away; the picker is for when you do not know what to call it.
   */
  const actions: CornerAction[] = adding
    ? []
    : [
        { key: 'add', label: 'Add asset', glyph: <Plus size={20} aria-hidden />, run: () => setAdding(true) },
        { key: 'pick', label: 'What do you own?', glyph: <HelpCircle size={20} aria-hidden />, to: '/net-worth/assets/new' },
      ];

  return (
    <div className={SCREEN}>
      <LargeTitle title="Assets" actions={actions} />
      <NetWorthTabs />
      <Hero minor={totalOf(groups)} currency={baseCurrency} caption="Everything you own" />
      {adding && <AddAssetForm onDone={() => setAdding(false)} />}
      <ErrorBox error={values.error ?? profiles.error} />

      {updatingPrices && (
        <UpdatePricesSheet
          holdings={stale
            .filter((row) => row.method === 'Units × price')
            .map((row) => ({ accountId: row.accountId, name: row.name, currency: row.currency, priceLabel: 'Price' }))}
          onDone={() => setUpdatingPrices(false)}
        />
      )}
      {stale.length > 0 &&
        !updatingPrices &&
        (stale.some((row) => row.method === 'Units × price') ? (
          <InsetGroup header="Needs a fresh figure" footer={staleNote(stale)}>
            <InsetRow title="Update prices" onClick={() => setUpdatingPrices(true)} chevron={false} />
          </InsetGroup>
        ) : (
          <Panel header="Needs a fresh figure">
            <p className="text-[13px] leading-[17px] text-[var(--ph-warn)]">{staleNote(stale)}</p>
          </Panel>
        ))}

      {live.length === 0 && !values.isPending && <Empty>No assets yet. Add a bank account, fund, gold or property to see it here.</Empty>}
      {live.map((group) => (
        <Group key={group.group} group={group} />
      ))}

      {sold.length > 0 && (
        <>
          <InsetGroup>
            <InsetRow title={`${showSold ? 'Hide' : 'Show'} sold holdings (${sold.length})`} onClick={() => setShowSold((open) => !open)} chevron={false} />
          </InsetGroup>
          {showSold && (
            <InsetGroup header="Sold">
              {sold.map((row) => (
                <Row key={row.accountId} row={row} />
              ))}
            </InsetGroup>
          )}
        </>
      )}
    </div>
  );
}
