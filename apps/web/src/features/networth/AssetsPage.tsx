import { CASH_ITEMS } from '@expanses/core';
import { Plus } from 'lucide-react';
import { useState } from 'react';
import { useApp } from '../../app/context';
import { useAccounts } from '../../lib/queries';
import { Empty, ErrorBox, Money } from '../../ui';
import { type CornerAction, Drawer, Figure, groupedFigure, GroupedRow, Hero, InsetGroup, InsetRow, Panel, PushedTitle, SCREEN, useDrawers } from '../../ui/native';
import { assetKindTile } from '../ownables/catalogue-view';
import { pocketCount } from '../accounts/pockets';
import { useHeldRates } from '../accounts/queries';
import { ShareBar, ShareLegend } from './ShareBar';
import { assetSegments, heldShares } from './share-segments';
import { UpdatePricesSheet } from './UpdatePricesSheet';
import { type AssetDrawer, type AssetGroup, type AssetRow, groupAssets, liveGroups, rowSubtitle, soldRows, staleRows, totalOf } from './asset-rows';
import { useAssetProfiles, useAssetValues, useDueDeposits } from './queries';

/** The kinds of account whose whole story lives on their own page: money, not things. */
const CASH_SUBTYPES = new Set<string>(CASH_ITEMS.map((item) => item.id));

/** The sentence naming what is out of date. The same words it has always been, in the group's own footer. */
function staleNote(stale: AssetRow[]): string {
  return `${stale.length === 1 ? '1 asset needs' : `${stale.length} assets need`} a fresh price or estimate: ${stale.map((row) => row.name).join(', ')}.`;
}

/** A kind's drawing, at the size a row draws one: the same mark the add-asset picker gave it. */
function KindIcon({ section, kind }: { section: string; kind: string }) {
  const Glyph = assetKindTile(section, kind);
  return <Glyph size={16} aria-hidden />;
}

function Row({ row, baseCurrency, money }: { row: AssetRow; baseCurrency: string; money: Set<string> }) {
  const icon = <KindIcon section={row.section} kind={row.kind.key} />;
  // An account with pockets: one row at their total (or the missing rate named), opening to the pockets — with the
  // ≈ on its figure only when a pocket is held in another currency.
  if (row.pockets !== null)
    return (
      <GroupedRow
        to="/accounts/$accountId"
        params={{ accountId: row.accountId }}
        icon={icon}
        title={row.name}
        subtitle={`${pocketCount(row.pockets)} · each files its own row`}
        figure={groupedFigure({ totalMinor: row.missing.length ? null : row.valueMinor, missing: row.missing }, baseCurrency, row.converted)}
      />
    );
  /*
   * Money owed to you opens the ledger that keeps it, with the person in front: it is a debt between two people rather
   * than a holding, and the Lend & borrow card is where its reason, its due date and the code that says what kind of
   * receivable it is are administered. It used to open the asset page, which asks a receivable for a cost it never had.
   */
  if (row.person !== null)
    return (
      <InsetRow
        to="/net-worth/lend-borrow"
        search={{ person: row.person }}
        icon={icon}
        title={row.name}
        subtitle={rowSubtitle(row)}
        value={<Money minor={row.valueMinor} currency={row.currency} />}
        valueTone="ink"
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
      icon={icon}
      title={row.name}
      subtitle={rowSubtitle(row)}
      value={<Money minor={row.valueMinor} currency={row.currency} />}
      valueTone={row.stale && !row.sold ? 'warn' : 'ink'}
    />
  );
}

/** What a drawer's rows come to, or — when one of them is waiting on a rate — the rate named instead. */
function DrawerFigure({ drawer, baseCurrency }: { drawer: AssetDrawer; baseCurrency: string }) {
  return (
    <span data-testid={`assets-kind-total-${drawer.key}`}>
      {drawer.totalMinor === null ? <Figure tone="warn">{`No ${drawer.missing.join(', ')} rate`}</Figure> : <Money minor={drawer.totalMinor} currency={baseCurrency} />}
    </span>
  );
}

/**
 * A group of assets: a header with the group's own total, and a drawer per kind of thing inside it.
 *
 * A list of everything you own is as long as the accounts you have opened, so the group folds itself by what each
 * row *is* — current accounts with current accounts, listed shares with listed shares — in the same words the
 * balance sheet on the page above folds the same money by. A kind of one still folds: "Intangible and other" holding
 * nothing but gold must still say that what is in it is gold.
 */
function Group({ group, baseCurrency, money }: { group: AssetGroup; baseCurrency: string; money: Set<string> }) {
  const drawers = useDrawers();
  const trailing = group.totalMinor === null ? <Figure tone="warn">{`No ${group.missing.join(', ')} rate yet`}</Figure> : <Money minor={group.totalMinor} currency={baseCurrency} />;
  return (
    <InsetGroup header={group.label} trailing={trailing}>
      {group.drawers.flatMap((drawer, index) => {
        const key = `${group.group}:${drawer.key}`;
        const shown = drawers.open.has(key);
        return [
          <Drawer
            key={key}
            icon={<KindIcon section={group.group} kind={drawer.key} />}
            label={drawer.label}
            under={`${drawer.rows.length} ${drawer.rows.length === 1 ? 'asset' : 'assets'}`}
            figure={<DrawerFigure drawer={drawer} baseCurrency={baseCurrency} />}
            open={shown}
            separator={index > 0}
            testId={`type-drawer-${key}`}
            onToggle={() => drawers.toggle(key)}
          />,
          ...(shown ? drawer.rows.map((row) => <Row key={row.accountId} row={row} baseCurrency={baseCurrency} money={money} />) : []),
        ];
      })}
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
  // The bar divides what is held: a section taken below nought by an overdraft is named under it instead.
  const shares = heldShares(assetSegments(live));
  // Which of the rows drawn below are money: those open their own page, not the asset page.
  const money = new Set((accounts.data ?? []).filter((account) => CASH_SUBTYPES.has(account.subtype)).map((account) => account.id));

  /*
   * The title row used to carry the running total, a text link and a dark rectangle at once, which at 390 px was
   * four things fighting for one line. Adding is one corner glyph, and it opens the add-asset page — the picker that
   * asks what you own and then draws the form that choice needs — rather than unfolding every field of every kind
   * over the list you came to read.
   */
  const actions: CornerAction[] = [{ key: 'add', label: 'Add asset', glyph: <Plus size={22} aria-hidden />, to: '/net-worth/assets/new' }];

  return (
    <div className={SCREEN}>
      <PushedTitle title="Assets" back="Net worth" backTo="/net-worth" actions={actions} />
      {/* A rate that is missing is named where the figure would be, because there is no box to put a figure in. */}
      {total.totalMinor === null && <Empty>No {total.missing.join(', ')} rate yet, so your assets cannot be added up. Each figure below is exact.</Empty>}
      <ErrorBox error={values.error ?? profiles.error ?? accounts.error ?? held.error} />

      {/*
       * The page's figure, inside the box it is made of: the bar under it is that total divided, so the number and
       * the drawing of it read as one thing rather than a figure with a chart somewhere below it. The caption went
       * with the move — the page is called Assets, and the box sits under that title.
       *
       * What the total is made of is drawn where the list it divides is. It used to sit on the Overview's own column,
       * beside a total it was read as part of; here the page is about what is owned, and the bar is that page's
       * subject: one segment per section of the statement, in the catalogue's own words.
       */}
      {total.totalMinor !== null && (
        <Panel wide className="mb-[18px] space-y-2">
          <div data-testid="assets-total">
            {/* What the list below comes to, in the page's ink: a red total warned about rows that warn about nothing. */}
            <Hero minor={total.totalMinor} currency={baseCurrency} plain align="center" />
          </div>
          {shares.shown.length > 0 && (
            <>
              <ShareBar segments={shares.shown} totalMinor={shares.heldMinor} />
              <ShareLegend segments={shares.shown} totalMinor={shares.heldMinor} />
            </>
          )}
          {shares.below.length > 0 && (
            <p data-testid="assets-below-zero" className="text-[12.5px] leading-[16px] text-[var(--ph-ink-3)]">
              {shares.below.map((segment, index) => (
                <span key={segment.key}>
                  {index > 0 && ' · '}
                  {segment.label} is below zero at <Money minor={segment.minor} currency={baseCurrency} />
                </span>
              ))}
              , so the bar divides the rest.
            </p>
          )}
        </Panel>
      )}

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
