import { CASH_ITEMS, displayAmount, formatMinor, periodLabel, sumToBase } from '@expanses/core';
import { type AccountRow, type AccountSubtype, pocketParentIds } from '@expanses/db';
import { Link, type LinkProps } from '@tanstack/react-router';
import { Plus } from 'lucide-react';
import { type ReactNode, useState } from 'react';
import { useApp } from '../../app/context';
import { SUBTYPE_LABELS } from '../../lib/account-types';
import { isMoneyAccount, useAccounts, useBalances } from '../../lib/queries';
import { useSetAsideViews } from '../goals/queries';
import { useScheduledAsks } from '../loans/queries';
import { DEBT_GROUP_LABELS, owedMinor } from '../networth/debt-rows';
import { useAssetValues } from '../networth/queries';
import { cx, Empty, Money } from '../../ui';
import { type CornerAction, ActionLine, Figure, groupedFigure, LargeTitle, Panel, ROW_PAD_X, ROW_PAD_Y, heroFigure, rowHeight, SCREEN } from '../../ui/native';
import { SPENDABLE_KINDS, freeOn, freeToSpend, moneySummary, parentTotal, pocketCount, pocketsOf } from './pockets';
import { SpendRing } from './SpendRing';
import { useHeldRates } from './queries';

/**
 * One drawer of a group: what it is called, what it is known by, and — where its group is the debts — what it asks.
 */
interface Drawer {
  key: string;
  label: string;
  /** The figure the drawer carries, when the group's own arithmetic is not the one that belongs on it. */
  figure?: ReactNode;
  /** A unit printed after the drawer's own figure, when what its rows ask is a rate rather than an amount. */
  unit?: string;
}

/**
 * What this page lists: the accounts the ledger posts against.
 *
 * Money you can move, money you lent, the cards you spend with, the loans you pay, the people you settle with —
 * every account a transaction can name, which is the same set the picker behind "Paid with" offers. What you merely
 * own and value is not one of them: shares, gold, art, a house and a car never take a transaction, and they are
 * listed where they are priced, on Net worth's Assets. The two lists are meant to differ: a page whose tile says
 * "Money" over a list that also holds a gold bar and a car is saying two things at once.
 *
 * Each group divides into drawers by what an account *is*: money by its type, a debt by which kind of debt it is.
 * `order` is the order the drawers read in — the catalogue's own for money, so cash comes before the account that
 * holds it, and the Debts page's own for the debts.
 */
const GROUPS: {
  key: string;
  label: string;
  subtypes: AccountSubtype[];
  drawer: (account: AccountRow) => Drawer;
  order: readonly string[];
}[] = [
  {
    key: 'cash',
    /*
     * "Money", not Net worth's "Cash & equivalents": this page names its own pairs, and that plan group is long
     * beside the word opposite it and says nothing the drawers do not. Money and Owed are the two sides of one
     * ledger read out loud — what you hold, and what you owe.
     */
    label: 'Money',
    /* Money, and the money you are owed, in one section — because what you owe is in one section too. A person you
     * lent to and a person you borrowed from are the same kind of fact read from opposite sides, and they used to
     * sit at different depths: Receivables was a section of its own while Payables was a drawer under Debts. Now
     * each side is one section with its kinds inside it, and the pair is symmetric. */
    /* No deposits here, and no broker's cash either. Neither can be paid from: a deposit is locked until it matures,
     * and money in an RDN is moved to a bank account before it is spent. Both belong where they are priced — Net
     * worth's Assets, a broker beside its own holdings — and the tile names what is parked at a broker rather than
     * counting it as spending money. This list is what the ledger can pay out of. */
    subtypes: ['cash', 'bank', 'savings', 'ewallet', 'other_cash', 'receivable'],
    drawer: (account) => ({ key: account.subtype, label: SUBTYPE_LABELS[account.subtype] }),
    /* Money first, in the order the cash picker lists it, and what you are owed after it. */
    order: [...CASH_ITEMS.filter((item) => item.id !== 'fund').map((item) => item.id), 'receivable'],
  },
  {
    key: 'debts',
    label: 'Owed',
    /* Cards, loans and the people you owe are all what you owe: one section, as the Debts page is one page, with the
     * Debts page's own three drawers inside it. The section is called "Owed" rather than "Debts" so that a glance
     * down this list does not read as a second copy of that page. */
    subtypes: ['credit_card', 'loan', 'payable'],
    drawer: (account) => {
      if (account.subtype === 'credit_card') return { key: 'card', label: DEBT_GROUP_LABELS.card };
      if (account.subtype === 'loan') return { key: 'loan', label: DEBT_GROUP_LABELS.loan };
      return { key: 'person', label: DEBT_GROUP_LABELS.person };
    },
    order: ['loan', 'card', 'person'],
  },
];

/** Every subtype this page can list, so an account it does not list is never counted or drawn. */
const LISTED = new Set<AccountSubtype>(GROUPS.flatMap((group) => group.subtypes));

/** The kinds of account whose own page is on `/accounts`: money, not things. */
const CASH_SUBTYPES = new Set<string>(CASH_ITEMS.map((item) => item.id));

/**
 * Where a row opens. One account has to mean one tap wherever it is listed, so this follows the two lists that
 * already file these accounts: money its own page, the way the Assets list opens one; a card the card, a loan its
 * terms, a person Lend & borrow, the way the Debts list opens them — and what is neither, its own asset page.
 *
 * The name used to go straight to the account's ledger. That was the only door a single-currency account had before
 * it had a page of its own, and it made one tap mean two different things depending on which list you came from.
 */
function destination(account: AccountRow): Pick<LinkProps, 'to' | 'params' | 'search'> {
  if (CASH_SUBTYPES.has(account.subtype)) return { to: '/accounts/$accountId', params: { accountId: account.id } };
  if (account.subtype === 'credit_card') return { to: '/cards/$cardId', params: { cardId: account.id } };
  if (account.subtype === 'loan') return { to: '/net-worth/loans/$accountId', params: { accountId: account.id } };
  if (account.subtype === 'payable') return { to: '/net-worth/lend-borrow' };
  return { to: '/net-worth/assets/$accountId', params: { accountId: account.id } };
}

/**
 * How a group's rows read: the figure one row draws, the quieter line under it, and whether that figure was
 * converted rather than held in the currency it names. Null for a row that reads as its own balance — which is what
 * this page drew everywhere before, and still draws wherever there is nothing else to say.
 */
type RowRead = (account: AccountRow) => { minor: number; currency: string; under?: ReactNode; approximate?: boolean } | null;

/**
 * The amounts a set of accounts adds up to, row by row: the reading its group gave a row, or the balance that row
 * would have drawn with none.
 *
 * `totalOf` and the tile's third line both call this, so the figure a section shows and the figure the tile works
 * from can never be two different sums.
 */
function amountsOf(rows: AccountRow[], everything: AccountRow[], balances: Record<string, number>, read?: RowRead): { minor: number; currency: string }[] {
  return rows.flatMap((account) => {
    const own = read?.(account);
    if (own) return [{ minor: own.minor, currency: own.currency }];
    const its = pocketsOf(account.id, everything);
    return (its.length > 0 ? its : [account]).map((row) => ({ minor: displayAmount(row.kind, balances[row.id] ?? 0), currency: row.currency! }));
  });
}

/**
 * What a set of accounts comes to at today's rates — or the rate one of them lacks, named instead. Never a partial
 * sum, and never a different answer for a group than for a drawer inside it.
 *
 * The ≈ goes on only where a rate was used: a group whose rows are all in the base currency is exact.
 */
function totalOf(rows: AccountRow[], everything: AccountRow[], balances: Record<string, number>, baseCurrency: string, rates: Record<string, number>, read?: RowRead): string {
  const amounts = amountsOf(rows, everything, balances, read);
  const converted = amounts.some((amount) => amount.currency !== baseCurrency);
  return groupedFigure(sumToBase({ amounts, baseCurrency, ratesToBase: rates }), baseCurrency, converted).text;
}

/**
 * One type of account, folded away: the line that names it, how many it holds and what they come to.
 *
 * Drawn on the kit's own padding, height, hairline and inks — the same shape to the eye as the rows it hides — and
 * the whole line is the target, because a drawer that opens only when its words are hit is a drawer a thumb
 * misses. It lives in the feature rather than the kit for the reason `BillRow` does: "a type of account" is this
 * page's idea, where the kit holds the shapes more than one screen draws.
 */
function TypeDrawer({ label, count, figure, open, separator, testId, onToggle }: { label: string; count: string; figure: ReactNode; open: boolean; separator: boolean; testId: string; onToggle: () => void }) {
  return (
    <div className="relative">
      {separator && <span aria-hidden className="pointer-events-none absolute top-0 z-10 bg-[var(--ph-hair)]" style={{ height: 0.5, left: ROW_PAD_X, right: ROW_PAD_X }} />}
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        data-testid={testId}
        className="ph-focus-inset flex w-full items-center gap-[10px] text-left"
        style={{ minHeight: rowHeight(true), padding: `${ROW_PAD_Y}px ${ROW_PAD_X}px` }}
      >
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[15px] leading-[20px] font-medium text-[var(--ph-ink)]">{label}</span>
          <span className="mt-[2px] block truncate text-[12.5px] leading-[16px] text-[var(--ph-ink-3)]">{count}</span>
        </span>
        {figure}
        {/* The kit's chevron, turned over to say which way the drawer is: down when it is open, along when it is not. */}
        <span aria-hidden className={cx('shrink-0 text-[17px] leading-none text-[var(--ph-chevron)]', open && 'rotate-90')}>
          {'›'}
        </span>
      </button>
    </div>
  );
}

/**
 * One section of the account list.
 *
 * A native list: one group, and a line per account with its figure on the right. Nothing can be done to an account
 * from here — no rename, no archive, no card's points to set up: its own page carries all three, and its name opens
 * it. The table this replaces scrolled sideways on a phone, and a list of what you own is the one place that must
 * not.
 *
 * The tax code an account files under is *not* here. It is a figure for the report, not for this page, and a row
 * of four-digit codes under every balance read as noise; the asset's own page still names it, and still changes it.
 */
function AccountList({
  groupKey,
  title,
  accounts,
  drawers,
  open,
  onToggle,
  balances,
  everything,
  parents,
  rates,
  readOf,
}: {
  /** This group's key, which the open drawers are named by. */
  groupKey: string;
  title: string;
  /** The group's own figure, drawn in its header as the Assets page draws its groups'. */
  trailing?: ReactNode;
  accounts: AccountRow[];
  /** The drawers this group divides into, in the order they read, each holding its own accounts. */
  drawers: (Drawer & { rows: AccountRow[] })[];
  /** The drawers that are open, by `group:key`. Closed to begin with. */
  open: ReadonlySet<string>;
  onToggle: (key: string) => void;
  balances: Record<string, number>;
  /** Every account, pockets included: a parent's row is drawn from its pockets, which are not rows of their own. */
  everything: AccountRow[];
  parents: Set<string>;
  rates: Record<string, number>;
  /** The group's own reading of a row, where its rows do not draw plain balances — see `RowRead`. */
  readOf?: RowRead;
}) {
  const { ws } = useApp();
  // The kit's grouped figure: the ≈ total, or the missing rate named — never a partial sum. A parent holding only
  // the base currency is exact, so it draws a plain figure like any other account's row.
  const totalText = (account: AccountRow) => {
    const pockets = pocketsOf(account.id, everything);
    const converted = pockets.some((pocket) => pocket.currency !== ws.baseCurrency);
    return groupedFigure(parentTotal(pockets, balances, ws.baseCurrency, rates), ws.baseCurrency, converted);
  };
  /** What a row under a drawer says: the drawer names the type and the figure carries the currency, so neither is
   * repeated. A pocket parent keeps the one thing neither of them says — how many pockets it holds. */
  const drawerLine = (account: AccountRow) => (parents.has(account.id) ? pocketCount(pocketsOf(account.id, everything).length) : undefined);
  const kindLine = (account: AccountRow) =>
    parents.has(account.id) ? `${SUBTYPE_LABELS[account.subtype]} · ${pocketCount(pocketsOf(account.id, everything).length)}` : `${SUBTYPE_LABELS[account.subtype]} · ${account.currency}`;
  const parentFigure = (account: AccountRow) => {
    const figure = totalText(account);
    return <Figure tone={figure.complete ? 'ink' : 'warn'}>{figure.text}</Figure>;
  };
  const values = useAssetValues();
  const valued = (id: string) => (values.data ?? []).find((row) => row.accountId === id && row.mode !== 'derived');
  if (accounts.length === 0) return null;
  /** A drawer's own figure, added exactly as its group's is: what its rows come to, or the rate one lacks named. */
  const drawerTotal = (rows: AccountRow[]) => totalOf(rows, everything, balances, ws.baseCurrency, rates, readOf);
  /**
   * One row's figure. A group that reads its rows its own way has already said what the number is; everything else
   * draws what it always drew — a pocket parent its ≈ total, a holding what it is worth, an account its balance.
   */
  const rowFigure = (account: AccountRow): ReactNode => {
    const read = readOf?.(account);
    if (!read) {
      return parents.has(account.id) ? (
        parentFigure(account)
      ) : valued(account.id) ? (
        <Link to="/net-worth/assets/$accountId" params={{ accountId: account.id }} className="ph-focus block shrink-0 text-right">
          <Money minor={valued(account.id)!.valueMinor} currency={account.currency!} className="tabular block font-medium text-[var(--ph-ink)]" />
          <span className="block text-[12.5px] leading-[16px] text-[var(--ph-ink-3)]">
            cost <Money minor={valued(account.id)!.costMinor} currency={account.currency!} />
          </span>
        </Link>
      ) : (
        <Figure>
          <Money minor={displayAmount(account.kind, balances[account.id] ?? 0)} currency={account.currency!} />
        </Figure>
      );
    }
    // A figure that had to be converted wears the kit's ≈; one held in the currency it names is exact.
    return (
      <span className="block shrink-0 text-right">
        {read.approximate ? <Figure>{groupedFigure({ totalMinor: read.minor, missing: [] }, read.currency).text}</Figure> : <Money minor={read.minor} currency={read.currency} />}
        {read.under && <span className="block text-[12.5px] leading-[16px] text-[var(--ph-ink-3)]">{read.under}</span>}
      </span>
    );
  };

  /**
   * One account's line: what it is called, what type it is, and its figure. Nothing is done to an account from here —
   * not renamed, not archived, and a card's points set up nowhere but on the card. Its own page carries every one of
   * those, in the two corners beside its name, and the name is the door to it. A function rather than a map inline,
   * because a type's drawer draws its own rows under itself — and those rows are inside the drawer, so they do not
   * say their type again.
   */
  const line = (account: AccountRow, separator: boolean, depth = 0, inDrawer = false) => (
    <li key={account.id}>
      <ActionLine
        separator={separator}
        depth={depth}
        name={
          /* An account's name opens the account itself: a pocket parent to its pockets, money to the page that
           * tells its whole story, and everything else to the page its own list opens it with. */
          <Link {...destination(account)} className="ph-focus">
            {account.name}
          </Link>
        }
        subtitle={inDrawer ? drawerLine(account) : kindLine(account)}
        figure={rowFigure(account)}
      >
        {parents.has(account.id) && <span className="shrink-0 text-[12.5px] leading-[20px] text-[var(--ph-ink-3)]">Each pocket files its own row</span>}
      </ActionLine>
    </li>
  );

  return (
    <Panel wide pad={false} header={title}>
      <ul>
        {/* One drawer is no division at all: those rows are drawn on their own, with no drawer over them. */}
        {drawers.length <= 1
          ? accounts.map((account, index) => line(account, index > 0))
          : drawers.flatMap((drawer, index) => {
              const key = `${groupKey}:${drawer.key}`;
              const shown = open.has(key);
              return [
                <li key={drawer.key}>
                  <TypeDrawer
                    label={drawer.label}
                    count={plural(drawer.rows.length, 'account')}
                    figure={
                      drawer.figure ?? (
                        /* A drawer that adds instalments up says the word under the figure, where a row says its own
                         * second line: "a month" beside a sum reads as part of the number. */
                        <span className="block shrink-0 text-right">
                          <Figure>{drawerTotal(drawer.rows)}</Figure>
                          {drawer.unit && <span className="block text-[12.5px] leading-[16px] text-[var(--ph-ink-3)]">{drawer.unit}</span>}
                        </span>
                      )
                    }
                    open={shown}
                    separator={index > 0}
                    testId={`type-drawer-${drawer.key}`}
                    onToggle={() => onToggle(key)}
                  />
                </li>,
                ...(shown ? drawer.rows.map((account) => line(account, true, 1, true)) : []),
              ];
            })}
      </ul>
    </Panel>
  );
}

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/**
 * One share of the tile: a dot in the ring's own colour, what it is called, and its figure on the right — with the
 * quieter line under the name, the way iOS draws the rows beneath a ring. The legend and the picture are one thing,
 * so the dot's colour is the ring's colour and never a colour of its own.
 */
function SpendRow({ colour, label, value, currency, under, separator = false }: { colour: string; label: string; value: number; currency: string; under: string; separator?: boolean }) {
  return (
    <div className={cx('flex items-start justify-between gap-[10px]', separator && 'mt-3 border-t-[0.5px] border-[var(--ph-hair)] pt-3')}>
      <span className="min-w-0">
        <span className="flex items-center gap-[7px]">
          <span aria-hidden className="h-[9px] w-[9px] shrink-0 rounded-full" style={{ background: colour }} />
          <span className="text-[15px] leading-[20px] font-medium text-[var(--ph-ink)]">{label}</span>
        </span>
        <span className="mt-[1px] block pl-[16px] text-[12.5px] leading-[16px] text-[var(--ph-ink-3)]">{under}</span>
      </span>
      <span className="shrink-0 tabular text-[15px] leading-[20px] font-medium text-[var(--ph-ink)]">{formatMinor(value, currency)}</span>
    </div>
  );
}

export function AccountsPage() {
  const { ws } = useApp();
  const accounts = useAccounts();
  const balances = useBalances();
  const everything = accounts.data ?? [];
  /* What this page lists, and what it does not: money, the money you lent, and what you owe. See `GROUPS`. */
  const money = everything.filter((account) => LISTED.has(account.subtype) && isMoneyAccount(account));
  const all = balances.data ?? {};
  const parents = pocketParentIds(everything);
  const byId = new Map(everything.map((account) => [account.id, account]));
  const asks = useScheduledAsks();
  const owed = useSetAsideViews();
  // Every currency this page converts: the money's own, and the debts' — a card's bill and a loan's instalment too.
  const rates = useHeldRates([
    ...everything.filter((a) => a.kind === 'asset' && a.archivedAt === null).map((a) => a.currency!),
    ...everything.filter((a) => a.kind === 'liability' && a.archivedAt === null).map((a) => a.currency ?? ws.baseCurrency),
  ]);
  const held = rates.data?.rates ?? {};
  /**
   * Which type drawers are open, by `group:type`. Closed to begin with: the page opens as a list of sums, and the
   * balances inside a type are one tap away rather than a wall of rows nobody asked for.
   */
  const [openTypes, setOpenTypes] = useState<ReadonlySet<string>>(new Set());
  const toggleType = (key: string) =>
    setOpenTypes((open) => {
      const next = new Set(open);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  /**
   * Free to spend, and the three parts it is read from: money that can be moved, what goals have claimed of it, and
   * what the debts ask of it.
   *
   * The debts are read as what each of them wants, not as what they cost in total: a loan wants its instalment, a
   * card wants everything it has taken — billed or not, because that money is already spent — and a person wants
   * what you owe them. Two things are deliberately outside it: money that cannot be moved (a deposit until it
   * matures), and the long part of a debt, which is a balance-sheet fact rather than a claim on this month — a
   * mortgage's principal is read on Net worth, against a year's schedule, and never here.
   */
  const spendable = moneySummary(everything, all, ws.baseCurrency, held, SPENDABLE_KINDS);
  const promiseAmounts = Object.values(owed.data ?? {})
    .filter((row) => SPENDABLE_KINDS.has(byId.get(row.accountId)?.subtype ?? ''))
    .map((row) => ({ minor: row.setAsideMinor, currency: row.currency }));
  const promised = sumToBase({ amounts: promiseAmounts, baseCurrency: ws.baseCurrency, ratesToBase: held });
  /**
   * One money account's row: what is free on it — what it holds, less what goals have claimed of it — with what it
   * holds named underneath, so the subtraction can be read rather than trusted.
   *
   * Null where the row should draw exactly what it always drew: nothing is promised (so free *is* the balance), the
   * money cannot be spent at all (a deposit holds money it cannot be paid from), or a rate is missing.
   */
  const spareOn: RowRead = (account) => {
    if (!SPENDABLE_KINDS.has(account.subtype)) return null;
    const pockets = pocketsOf(account.id, everything);
    const read = freeOn(account, pockets, all, owed.data ?? {}, ws.baseCurrency, held);
    if (read.freeMinor === null || read.balanceMinor === null || read.setAsideMinor === 0) return null;
    /* A parent holding only the base currency adds up exactly, so it draws a plain figure — and the line beneath it
     * names what it holds the same way. Only a conversion earns the kit's ≈. */
    const converted = pockets.some((pocket) => pocket.currency !== ws.baseCurrency);
    const whole = parents.has(account.id) ? groupedFigure({ totalMinor: read.balanceMinor, missing: [] }, read.currency, converted).text : <Money minor={read.balanceMinor} currency={read.currency} />;
    return { minor: read.freeMinor, currency: read.currency, under: <>of {whole} held</>, approximate: parents.has(account.id) && converted };
  };

  /**
   * What one debt's row reads as: what it asks you to pay. Only a loan says anything underneath it.
   *
   * A loan wants its instalment — its principal is a balance-sheet fact and appears nowhere on this page — and the
   * line under it says when the debt ends, which is how a balloon inside the term shows itself without a principal
   * being printed. A card wants everything it has taken, billed or not: that money is already spent, and a page that
   * showed only the bill would flatter the reader. Which part of it is billed, and the day the bill falls due, is
   * the card's own page — its statements band is the whole explanation — so the row says nothing more: a figure with
   * words under it reads as two debts where there is one, and a row that wraps is a row that no longer lines up. A
   * person wants what you owe them, and nothing more is said because a promise has no schedule.
   *
   * Null for a debt with nothing to ask: a loan whose schedule cannot be read draws its balance instead, as it always
   * did, and a card paid past its bill owes nothing.
   */
  const debtRead: RowRead = (account) => {
    const currency = account.currency ?? ws.baseCurrency;
    if (account.subtype === 'loan') {
      const ask = asks.data?.[account.id];
      if (!ask || ask.paymentMinor <= 0) return null;
      return { minor: ask.paymentMinor, currency, under: `a month${ask.paysOffOn ? ` · pays off ${periodLabel(ask.paysOffOn)}` : ''}` };
    }
    const owes = owedMinor(all, account.id);
    if (owes <= 0) return null;
    return { minor: owes, currency };
  };
  /**
   * What the rows below already show: money that can be moved, less what goals have claimed of it — the same sum the
   * sections add up, so the tile and the list agree to the rupiah. The promise is taken out here rather than on a
   * line of its own: an account's row draws its free figure with the balance under it ("of Rp 5.000.000 held"), and
   * what a promise is comes apart on the account's own page and on each goal.
   */
  const unclaimed = freeToSpend(spendable, promised, { totalMinor: 0, missing: [] });
  /** What every listed debt asks — the very readings its own row draws, so the section and the tile agree. */
  const debtRows = money.filter((account) => account.parentId === null && GROUPS.some((group) => group.key === 'debts' && group.subtypes.includes(account.subtype)));
  const askedAmounts = amountsOf(debtRows, everything, all, debtRead);
  const asked = sumToBase({ amounts: askedAmounts, baseCurrency: ws.baseCurrency, ratesToBase: held });
  const free = freeToSpend(spendable, promised, asked);
  /**
   * Whether any figure the tile is worked from came from another currency. Only such a total wears the kit's ≈: money
   * held, promised and owed all in rupiah adds up exactly, and a figure that needed a rate is an estimate until the
   * rate is the day's own.
   */
  const estimated = spendable.converted || [...promiseAmounts, ...askedAmounts].some((amount) => amount.currency !== ws.baseCurrency);
  /** A group's drawers, in the group's own order, each holding the accounts that fell into it. */
  const drawersOf = (group: (typeof GROUPS)[number], rows: AccountRow[]) => {
    const found = new Map<string, Drawer & { rows: AccountRow[] }>();
    for (const account of rows) {
      const drawer = group.drawer(account);
      const at = found.get(drawer.key);
      if (at) at.rows.push(account);
      else found.set(drawer.key, { ...drawer, rows: [account] });
    }
    /* A drawer the group's order does not name reads last, in the order it was found. */
    const rank = (key: string) => {
      const at = group.order.indexOf(key);
      return at === -1 ? group.order.length : at;
    };
    return [...found.values()].sort((a, b) => rank(a.key) - rank(b.key));
  };
  /*
   * One corner: adding an account. Import CSV and Backup used to sit behind a `…` here, and neither is about an
   * account — a page whose corner offers what the page is not reads as a menu of everything. Both keep their own
   * addresses, `/import` and `/backup`.
   */
  const actions: CornerAction[] = [{ key: 'new', label: 'Add account', to: '/accounts/new', glyph: <Plus size={20} aria-hidden /> }];
  return (
    <div className={SCREEN}>
      <LargeTitle title="Accounts" actions={actions} />
      {accounts.isSuccess && money.length === 0 && <Empty>No accounts yet. Add one with the + above: money you can spend, or money you are owed.</Empty>}
      {/*
       * Balance, and the two numbers it is made of, as one block: a ring, the figure, and the rows that are the
       * ring's legend — the shape iOS draws a metric in, where the figure answers "how much" and the ring answers "of
       * what". The goals are already subtracted in the first row: an account's own row below draws itself free of its
       * promises, so the two rows still add up to the figure above them.
       */}
      {accounts.isSuccess && balances.isSuccess && rates.isSuccess && spendable.accounts > 0 &&
        (free.freeMinor !== null && unclaimed.freeMinor !== null ? (
          <Panel className="space-y-3">
            <div className="flex items-center gap-3">
              <SpendRing
                size={68}
                thickness={9}
                segments={[
                  { key: 'free', label: 'Balance', minor: free.freeMinor, colour: 'var(--ph-tint)' },
                  ...(free.dueMinor !== null && free.dueMinor > 0 ? [{ key: 'due', label: 'Debt owed', minor: free.dueMinor, colour: 'var(--ph-alarm)' }] : []),
                ]}
              />
              <div className="min-w-0">
                <p className="text-[12px] font-semibold tracking-[0.08em] text-[var(--ph-ink-3)] uppercase">Balance</p>
                {/* One line, whatever the amount is: a figure that wraps reads as two figures where there is one. */}
                <p className="tabular truncate text-[26px] leading-[32px] font-bold tracking-[-0.02em]">
                  {estimated && <span className="text-[var(--ph-ink-3)]">≈ </span>}
                  {heroFigure(free.freeMinor, ws.baseCurrency).text}
                </p>
              </div>
            </div>
            {/* The ring's legend: the same two shares, each with the figure it is drawn from, and a hairline between
             * them — the way iOS separates the rows under a ring, so each reads as its own line. */}
            <div className="border-t-[0.5px] border-[var(--ph-hair)] pt-3">
              <SpendRow
                colour="var(--ph-tint)"
                label="Spending money"
                value={unclaimed.freeMinor}
                currency={ws.baseCurrency}
                under={`across ${plural(spendable.accounts, 'account')} · ${plural(spendable.currencies, 'currency', 'currencies')}`}
              />
              <SpendRow separator colour="var(--ph-alarm)" label="Debt owed" value={-(free.dueMinor ?? 0)} currency={ws.baseCurrency} under={plural(debtRows.length, 'debt')} />
            </div>
          </Panel>
        ) : (
          <Panel header="Balance">
            <p className="text-[13px] leading-[17px] text-[var(--ph-ink-2)]">
              No {free.missing.join(', ')} rate yet, so what is left to spend cannot be worked out. Each balance below is exact.
            </p>
          </Panel>
        ))}
      {/* A pocket is never a row of its own: its account's row adds it up (P1). */}
      {GROUPS.map((group) => {
        const rows = money.filter((account) => account.parentId === null && group.subtypes.includes(account.subtype));
        if (rows.length === 0) return null;
        /*
         * What this group divides into. One drawer is no division at all, and gets no divider: a line naming the
         * only kind of thing in the panel says nothing the panel's own header has not already said.
         */
        const debts = group.key === 'debts';
        /* What this group's rows read as: money says what is free on it, a debt what it asks you to pay. */
        const read: RowRead | undefined = group.key === 'cash' ? spareOn : debts ? debtRead : undefined;
        const drawers = drawersOf(group, rows).map((drawer) =>
          /* A loan drawer adds up instalments, so its figure needs the word beside it; the others are amounts. */
          drawer.key === 'loan' ? { ...drawer, unit: 'a month' } : drawer,
        );
        return (
          <AccountList
            key={group.key}
            groupKey={group.key}
            title={group.label}
            accounts={rows}
            drawers={drawers}
            open={openTypes}
            onToggle={toggleType}
            balances={all}
            everything={everything}
            parents={parents}
            rates={held}
            readOf={read}
          />
        );
      })}
    </div>
  );
}
