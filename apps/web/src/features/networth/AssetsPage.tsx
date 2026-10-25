import { CASH_ITEMS, isoDate } from '@expanses/core';
import { useNavigate } from '@tanstack/react-router';
import { ArrowLeftRight, Percent, Plus } from 'lucide-react';
import { type ReactNode, useState } from 'react';
import { useApp } from '../../app/context';
import { useAccounts } from '../../lib/queries';
import { Empty, ErrorBox, Money } from '../../ui';
import { type CornerAction, Drawer, Figure, groupedFigure, GroupedRow, Hero, InsetGroup, InsetRow, Panel, PushedTitle, SCREEN, useDrawers, type TreePlace } from '../../ui/native';
import { assetKindTile, assetSectionTile } from '../ownables/catalogue-view';
import { pocketCount } from '../accounts/pockets';
import { useHeldRates } from '../accounts/queries';
import { useHoldingLinks, useSecurities } from '../investments/queries';
import { ShareBoxes, ShowAll } from './ShareBoxes';
import { assetSegments, heldShares, kindSegments } from './share-segments';
import { type AssetDrawer, type AssetGroup, type AssetRow, groupAssets, liveGroups, rowSubtitle, soldRows, staleRows, totalOf } from './asset-rows';
import { useAssetProfiles, useAssetValues, useDueDeposits, useTrades } from './queries';
import { type ByStockInputs, linesByStock, type StockLine } from './stock-rows';

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

/**
 * `nested`: drawn inside its kind's open drawer, one step in and with no circle — the drawer above already wears it, and
 * the name then sits level with the kind's.
 */
function Row({ row, baseCurrency, money, nested = false, tree }: { row: AssetRow; baseCurrency: string; money: Set<string>; nested?: boolean; tree?: TreePlace }) {
  const icon = nested ? undefined : <KindIcon section={row.section} kind={row.kind.key} />;
  const depth = nested ? 1 : 0;
  // An account with pockets: one row at their total (or the missing rate named), opening to the pockets — with the
  // ≈ on its figure only when a pocket is held in another currency.
  if (row.pockets !== null)
    return (
      <GroupedRow
        to="/accounts/$accountId"
        params={{ accountId: row.accountId }}
        icon={icon}
        depth={depth}
        tree={tree}
        title={row.name}
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
        depth={depth}
        tree={tree}
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
      depth={depth}
      tree={tree}
      title={row.name}
      subtitle={rowSubtitle(row)}
      value={<Money minor={row.valueMinor} currency={row.currency} />}
      valueTone={row.stale && !row.sold ? 'warn' : 'ink'}
    />
  );
}

/**
 * A listed share held at two or more brokers: one row for the stock, at what its holdings come to together, opening
 * the stock across them — where each broker's holding is a row of its own. Drawn as a holding's row is, inside the
 * drawer, so the list reads one row per stock rather than one per stock per broker. A fund tied across places by
 * "Same fund as" is drawn the same way, one row for the fund.
 */
function StockRowAcross({ stock, tree }: { stock: StockLine; tree?: TreePlace }) {
  return (
    <InsetRow
      to="/net-worth/investments/security/$securityId"
      params={{ securityId: stock.securityId }}
      testId={`assets-${stock.kind}-row`}
      depth={1}
      tree={tree}
      title={stock.title}
      subtitle={stock.subtitle}
      value={<Money minor={stock.valueMinor} currency={stock.currency} />}
      valueTone={stock.stale ? 'warn' : 'ink'}
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
function Group({ group, baseCurrency, money, stocks, opened = false, after }: { group: AssetGroup; baseCurrency: string; money: Set<string>; stocks: ByStockInputs; opened?: boolean; after?: ReactNode }) {
  // A group picked on the chart above is shown with everything in it, not as drawers still to open.
  const drawers = useDrawers(opened ? group.drawers.map((drawer) => `${group.group}:${drawer.key}`) : []);
  const trailing = group.totalMinor === null ? <Figure tone="warn">{`No ${group.missing.join(', ')} rate yet`}</Figure> : <Money minor={group.totalMinor} currency={baseCurrency} />;
  return (
    <InsetGroup header={group.label} trailing={trailing}>
      {group.drawers.flatMap((drawer, index) => {
        const key = `${group.group}:${drawer.key}`;
        const shown = drawers.open.has(key);
        // Listed shares read one row per stock: a stock at two brokers is one row, opening it across them; tied funds too.
        const lines = shown ? linesByStock(drawer.key, drawer.rows, stocks) : [];
        return [
          <Drawer
            key={key}
            icon={<KindIcon section={group.group} kind={drawer.key} />}
            label={drawer.label}
            figure={<DrawerFigure drawer={drawer} baseCurrency={baseCurrency} />}
            open={shown}
            stem={shown && drawer.rows.length > 0}
            separator={index > 0}
            testId={`type-drawer-${key}`}
            onToggle={() => drawers.toggle(key)}
          />,
          ...lines.map((line, at) => {
            const tree = { last: at === lines.length - 1 };
            return line.stock ? (
              <StockRowAcross key={`security:${line.stock.securityId}`} stock={line.stock} tree={tree} />
            ) : (
              <Row key={line.row.accountId} row={line.row} baseCurrency={baseCurrency} money={money} nested tree={tree} />
            );
          }),
        ];
      })}
      {after}
    </InsetGroup>
  );
}

export function AssetsPage() {
  const { ws } = useApp();
  const values = useAssetValues();
  const profiles = useAssetProfiles();
  const accounts = useAccounts();
  const held = useHeldRates((values.data ?? []).map((row) => row.currency));
  // What each holding is a share of, so a stock kept at two brokers is listed once.
  const links = useHoldingLinks();
  const securities = useSecurities();
  // Any buy or sell recorded: the All trades line closes the section only once there is one to read.
  const trades = useTrades();
  const hasTrades = Boolean(trades.data && trades.data.length > 0);
  const navigate = useNavigate();
  const traded = new Set((trades.data ?? []).map((trade) => trade.accountId));
  const [showSold, setShowSold] = useState(false);
  // The section picked on the chart, if one is: the list below narrows to it.
  const [picked, setPicked] = useState<string | null>(null);
  // Inside a picked section with more than one kind, the kind picked on its own boxes: the list narrows to that drawer.
  const [kind, setKind] = useState<string | null>(null);
  const pick = (key: string | null) => {
    setPicked(key);
    setKind(null);
  };

  const due = useDueDeposits();
  const dueIds = new Set((due.data ?? []).map((proposal) => proposal.accountId));
  const baseCurrency = ws.baseCurrency;
  const ready = values.data && profiles.data && accounts.data && held.data && links.data && securities.data;
  const groups = ready
    ? groupAssets(values.data!, profiles.data!, { accounts: accounts.data!, baseCurrency, ratesToBase: held.data!.rates, due: dueIds })
    : [];
  const total = totalOf(groups);
  const live = liveGroups(groups);
  // The section All trades closes: Investments, or — with none, gold alone say — the first that holds a traded holding.
  const tradesHome = (live.find((group) => group.group === 'invest') ?? live.find((group) => group.rows.some((row) => traded.has(row.accountId))))?.group ?? null;
  const sold = soldRows(groups);
  const stale = staleRows(groups);
  // The chart divides what is held: a section taken below nought by an overdraft is named under it instead.
  const shares = heldShares(assetSegments(live));
  // The pick holds only while its box is drawn: a section gone or taken below nought lets go of it.
  const active = shares.shown.some((segment) => segment.key === picked) ? picked : null;
  /*
   * A picked section opens into its own kinds — Investments into listed shares, mutual funds, government bonds — when it
   * has more than one: its box divides where it stands, so the chart keeps its shape and only that box gains detail.
   */
  const activeGroup = active === null ? null : (live.find((group) => group.group === active) ?? null);
  const kindShares = activeGroup ? heldShares(kindSegments(activeGroup.drawers)) : null;
  const deeper = activeGroup !== null && kindShares !== null && kindShares.shown.length > 1;
  const activeKind = deeper && kindShares!.shown.some((segment) => segment.key === kind) ? kind : null;
  // Which of the rows drawn below are money: those open their own page, not the asset page.
  const money = new Set((accounts.data ?? []).filter((account) => CASH_SUBTYPES.has(account.subtype)).map((account) => account.id));
  const stocks: ByStockInputs = {
    links: links.data ?? [],
    securities: securities.data ?? [],
    units: new Map((values.data ?? []).map((row) => [row.accountId, row.unitsMicro ?? 0])),
    places: new Map((profiles.data ?? []).filter((row) => row.coretaxFields.inst?.trim()).map((row) => [row.accountId, row.coretaxFields.inst!.trim()])),
  };

  /*
   * The title row used to carry the running total, a text link and a dark rectangle at once, which at 390 px was
   * four things fighting for one line. Adding is one corner glyph, and it opens the add-asset page — the picker that
   * asks what you own and then draws the form that choice needs — rather than unfolding every field of every kind
   * over the list you came to read.
   */
  const estimatesStale = stale.filter((row) => row.method !== 'Units × price');
  /*
   * The corner beside + opens Income: what the shares and bonds held pay in dividends and coupons, a year at a glance and
   * month by month (owner, 23 Oct). It used to hold the price tag; Update prices is now in each priced holding's
   * Settings, under Prices. The glyph is a yield's sign, chosen over coins, a hand of them and a sprout (owner, 23 Oct).
   */
  const income: CornerAction = { key: 'income', label: 'Income', glyph: <Percent size={19} aria-hidden />, to: '/net-worth/investments/dividends' };
  const actions: CornerAction[] = [income, { key: 'add', label: 'Add asset', glyph: <Plus size={22} aria-hidden />, to: '/net-worth/assets/new' }];

  return (
    <div className={SCREEN}>
      <PushedTitle title="Assets" back="Net worth" backTo="/net-worth" actions={actions} />
      {/* A rate that is missing is named where the figure would be, because there is no box to put a figure in. */}
      {total.totalMinor === null && <Empty>No {total.missing.join(', ')} rate yet, so these assets cannot be added up. Each figure below is exact.</Empty>}
      <ErrorBox error={values.error ?? profiles.error ?? accounts.error ?? held.error ?? links.error ?? securities.error} />

      {/*
       * The page's figure, inside the box it is made of: the boxes under it are that total divided, so the number and
       * the drawing of it read as one thing rather than a figure with a chart somewhere below it. The caption went
       * with the move — the page is called Assets, and the box sits under that title.
       *
       * What the total is made of is drawn where the list it divides is. It used to sit on the Overview's own column,
       * beside a total it was read as part of; here the page is about what is owned, and the chart is that page's
       * subject: one segment per section of the statement, in the catalogue's own words.
       */}
      {total.totalMinor !== null && (
        <Panel wide className="mb-[18px] space-y-2">
          <div data-testid="assets-total">
            {/* What the list below comes to, in the page's ink: a red total warned about rows that warn about nothing. */}
            <Hero minor={total.totalMinor} currency={baseCurrency} plain align="center" />
          </div>
          {shares.shown.length > 0 && (
            <ShareBoxes
              segments={shares.shown}
              totalMinor={shares.heldMinor}
              currency={baseCurrency}
              iconOf={assetSectionTile}
              picked={active}
              onPick={pick}
              inner={deeper ? { key: active!, segments: kindShares!.shown, iconOf: (key) => assetKindTile(active!, key), picked: activeKind, onPick: setKind } : null}
            />
          )}
          {shares.below.length > 0 && (
            <p data-testid="assets-below-zero" className="text-[12.5px] leading-[16px] text-[var(--ph-ink-3)]">
              {shares.below.map((segment, index) => (
                <span key={segment.key}>
                  {index > 0 && ' · '}
                  {segment.label} is below zero at <Money minor={segment.minor} currency={baseCurrency} />
                </span>
              ))}
              , so the chart divides the rest.
            </p>
          )}
        </Panel>
      )}

      {/* An estimate gone stale (a house, a car) has no price to fetch: it is named here, and its own page updates it. */}
      {estimatesStale.length > 0 && (
        <Panel header="Needs a fresh figure">
          <p className="text-[13px] leading-[17px] text-[var(--ph-warn)]">{staleNote(estimatesStale)}</p>
        </Panel>
      )}

      {live.length === 0 && ready && <Empty>No assets yet. Add a bank account, fund, gold or property to see it here.</Empty>}
      {active !== null && <ShowAll onClick={() => pick(null)} />}
      {live
        .filter((group) => active === null || group.group === active)
        .map((group) => (
          // Keyed by the pick too, so a group picked opens afresh and goes back to its drawers when let go.
          <Group
            key={`${group.group}:${active === group.group}:${activeKind ?? ''}`}
            group={activeKind && active === group.group ? { ...group, drawers: group.drawers.filter((drawer) => drawer.key === activeKind) } : group}
            baseCurrency={baseCurrency}
            money={money}
            stocks={stocks}
            opened={active === group.group}
            // Every buy and sell, read on a page of its own: a row closing the section the trades are in.
            after={
              hasTrades && group.group === tradesHome ? (
                // Drawn as the kinds above it are drawn — the same glyph circle, 15 px medium name and ›, no second line — so it
                // reads as one more line of the section rather than a row of another size.
                <Drawer
                  icon={<ArrowLeftRight size={16} aria-hidden />}
                  label="All trades"
                  open={false}
                  separator
                  testId="all-trades"
                  onToggle={() => void navigate({ to: '/net-worth/investments/trades' })}
                />
              ) : undefined
            }
          />
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
