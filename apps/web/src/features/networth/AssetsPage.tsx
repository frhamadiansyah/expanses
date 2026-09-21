import { HelpCircle, Plus } from 'lucide-react';
import { useState } from 'react';
import { useApp } from '../../app/context';
import { useAccounts } from '../../lib/queries';
import { Empty, ErrorBox, Money } from '../../ui';
import { type CornerAction, Figure, groupedFigure, GroupedRow, Hero, InsetGroup, InsetRow, LargeTitle, Panel, SCREEN } from '../../ui/native';
import { useHeldRates } from '../accounts/queries';
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

function Row({ row, baseCurrency }: { row: AssetRow; baseCurrency: string }) {
  // An account with pockets: one row at their ≈ total (or the missing rate named), opening to the pockets.
  if (row.pockets !== null)
    return (
      <GroupedRow
        to="/accounts/$accountId"
        params={{ accountId: row.accountId }}
        title={row.name}
        subtitle={`${row.pockets} pockets · each files its own row`}
        figure={groupedFigure({ totalMinor: row.missing.length ? null : row.valueMinor, missing: row.missing }, baseCurrency)}
      />
    );
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

function Group({ group, baseCurrency }: { group: AssetGroup; baseCurrency: string }) {
  const trailing = group.totalMinor === null ? <Figure tone="warn">{`No ${group.missing.join(', ')} rate yet`}</Figure> : <Money minor={group.totalMinor} currency={baseCurrency} />;
  return (
    <InsetGroup header={group.label} trailing={trailing}>
      {group.rows.map((row) => (
        <Row key={row.accountId} row={row} baseCurrency={baseCurrency} />
      ))}
    </InsetGroup>
  );
}

export function AssetsPage() {
  const { ws } = useApp();
  const values = useAssetValues();
  const profiles = useAssetProfiles();
  const accounts = useAccounts();
  const held = useHeldRates((values.data ?? []).map((row) => row.currency));
  const [showSold, setShowSold] = useState(false);
  const [adding, setAdding] = useState(false);
  const [updatingPrices, setUpdatingPrices] = useState(false);

  const baseCurrency = ws.baseCurrency;
  const ready = values.data && profiles.data && accounts.data && held.data;
  const groups = ready ? groupAssets(values.data!, profiles.data!, { accounts: accounts.data!, baseCurrency, ratesToBase: held.data!.rates }) : [];
  const total = totalOf(groups);
  const live = liveGroups(groups);
  const sold = soldRows(groups);
  const stale = staleRows(groups);

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
      {total.totalMinor !== null ? (
        <Hero minor={total.totalMinor} currency={baseCurrency} caption="Everything you own" />
      ) : (
        <Empty>No {total.missing.join(', ')} rate yet, so your assets cannot be added up. Each figure below is exact.</Empty>
      )}
      {adding && <AddAssetForm onDone={() => setAdding(false)} />}
      <ErrorBox error={values.error ?? profiles.error ?? accounts.error ?? held.error} />

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

      {live.length === 0 && ready && <Empty>No assets yet. Add a bank account, fund, gold or property to see it here.</Empty>}
      {live.map((group) => (
        <Group key={group.group} group={group} baseCurrency={baseCurrency} />
      ))}

      {sold.length > 0 && (
        <>
          <InsetGroup>
            <InsetRow title={`${showSold ? 'Hide' : 'Show'} sold holdings (${sold.length})`} onClick={() => setShowSold((open) => !open)} chevron={false} />
          </InsetGroup>
          {showSold && (
            <InsetGroup header="Sold">
              {sold.map((row) => (
                <Row key={row.accountId} row={row} baseCurrency={baseCurrency} />
              ))}
            </InsetGroup>
          )}
        </>
      )}
    </div>
  );
}
