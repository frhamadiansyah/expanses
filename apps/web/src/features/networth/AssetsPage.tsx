import { CASH_ITEMS } from '@expanses/core';
import { Plus } from 'lucide-react';
import { useState } from 'react';
import { useApp } from '../../app/context';
import { useAccounts } from '../../lib/queries';
import { Empty, ErrorBox, Money } from '../../ui';
import { type CornerAction, Figure, groupedFigure, GroupedRow, Hero, InsetGroup, InsetRow, LargeTitle, Panel, SCREEN } from '../../ui/native';
import { pocketCount } from '../accounts/pockets';
import { useHeldRates } from '../accounts/queries';
import { NetWorthTabs } from './NetWorthTabs';
import { UpdatePricesSheet } from './UpdatePricesSheet';
import { type AssetGroup, type AssetRow, groupAssets, liveGroups, rowSubtitle, soldRows, staleRows, totalOf } from './asset-rows';
import { useAssetProfiles, useAssetValues, useDueDeposits } from './queries';

/** The kinds of account whose whole story lives on their own page: money, not things. */
const CASH_SUBTYPES = new Set<string>(CASH_ITEMS.map((item) => item.id));

/** The sentence naming what is out of date. The same words it has always been, in the group's own footer. */
function staleNote(stale: AssetRow[]): string {
  return `${stale.length === 1 ? '1 asset needs' : `${stale.length} assets need`} a fresh price or estimate: ${stale.map((row) => row.name).join(', ')}.`;
}

function Row({ row, baseCurrency, money }: { row: AssetRow; baseCurrency: string; money: Set<string> }) {
  // An account with pockets: one row at their ≈ total (or the missing rate named), opening to the pockets.
  if (row.pockets !== null)
    return (
      <GroupedRow
        to="/accounts/$accountId"
        params={{ accountId: row.accountId }}
        title={row.name}
        subtitle={`${pocketCount(row.pockets)} · each files its own row`}
        figure={groupedFigure({ totalMinor: row.missing.length ? null : row.valueMinor, missing: row.missing }, baseCurrency)}
      />
    );
  /*
   * A money account opens on its own page, which tells the whole story: what is in it, what is set aside and free,
   * what is promised to it, and the rows behind the balance. Only what you *own* — a holding, gold, a house —
   * opens on the asset page, because only those have a cost, a price and a chart of what they are worth.
   */
  const to = money.has(row.accountId) ? ('/accounts/$accountId' as const) : ('/net-worth/assets/$accountId' as const);
  return (
    <InsetRow
      to={to}
      params={{ accountId: row.accountId }}
      title={row.name}
      subtitle={rowSubtitle(row)}
      value={<Money minor={row.valueMinor} currency={row.currency} />}
      valueTone={row.stale && !row.sold ? 'warn' : 'ink'}
    />
  );
}

function Group({ group, baseCurrency, money }: { group: AssetGroup; baseCurrency: string; money: Set<string> }) {
  const trailing = group.totalMinor === null ? <Figure tone="warn">{`No ${group.missing.join(', ')} rate yet`}</Figure> : <Money minor={group.totalMinor} currency={baseCurrency} />;
  return (
    <InsetGroup header={group.label} trailing={trailing}>
      {group.rows.map((row) => (
        <Row key={row.accountId} row={row} baseCurrency={baseCurrency} money={money} />
      ))}
      {/* The same holdings read by stock and by broker: its last row, under the group's own total. */}
      {group.group === 'invest' && <InsetRow title="By stock and broker" to="/net-worth/investments" />}
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
  const [updatingPrices, setUpdatingPrices] = useState(false);

  const due = useDueDeposits();
  const dueIds = new Set((due.data ?? []).map((proposal) => proposal.accountId));
  const baseCurrency = ws.baseCurrency;
  const ready = values.data && profiles.data && accounts.data && held.data;
  const groups = ready
    ? groupAssets(values.data!, profiles.data!, { accounts: accounts.data!, baseCurrency, ratesToBase: held.data!.rates, due: dueIds })
    : [];
  const total = totalOf(groups);
  const live = liveGroups(groups);
  const sold = soldRows(groups);
  const stale = staleRows(groups);
  // Which of the rows drawn below are money: those open their own page, not the asset page.
  const money = new Set((accounts.data ?? []).filter((account) => CASH_SUBTYPES.has(account.subtype)).map((account) => account.id));

  /*
   * The title row used to carry the running total, a text link and a dark rectangle at once, which at 390 px was
   * four things fighting for one line. The total is the page's figure, so it is the hero; adding is one corner
   * glyph, and it opens the add-asset page — the picker that asks what you own and then draws the form that
   * choice needs — rather than unfolding every field of every kind over the list you came to read.
   */
  const actions: CornerAction[] = [{ key: 'add', label: 'Add asset', glyph: <Plus size={20} aria-hidden />, to: '/net-worth/assets/new' }];

  return (
    <div className={SCREEN}>
      <LargeTitle title="Assets" actions={actions} />
      <NetWorthTabs />
      {total.totalMinor !== null ? (
        <Hero minor={total.totalMinor} currency={baseCurrency} caption="Everything you own" />
      ) : (
        <Empty>No {total.missing.join(', ')} rate yet, so your assets cannot be added up. Each figure below is exact.</Empty>
      )}
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
        <Group key={group.group} group={group} baseCurrency={baseCurrency} money={money} />
      ))}

      {sold.length > 0 && (
        <>
          <InsetGroup>
            <InsetRow title={`${showSold ? 'Hide' : 'Show'} sold holdings (${sold.length})`} onClick={() => setShowSold((open) => !open)} chevron={false} />
          </InsetGroup>
          {showSold && (
            <InsetGroup header="Sold">
              {sold.map((row) => (
                <Row key={row.accountId} row={row} baseCurrency={baseCurrency} money={money} />
              ))}
            </InsetGroup>
          )}
        </>
      )}
    </div>
  );
}
