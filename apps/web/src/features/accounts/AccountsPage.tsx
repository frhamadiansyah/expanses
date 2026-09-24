import { CASH_ITEMS, displayAmount, formatMinor, isoDate, sumToBase } from '@expanses/core';
import { type AccountRow, type AccountSubtype, archiveAccount, pocketParentIds, renameAccount } from '@expanses/db';
import { Link, type LinkProps } from '@tanstack/react-router';
import { Plus } from 'lucide-react';
import { type ReactNode, useState } from 'react';
import { useApp } from '../../app/context';
import { SUBTYPE_LABELS } from '../../lib/account-types';
import { isMoneyAccount, useAccounts, useBalances, useInvalidateAll } from '../../lib/queries';
import { useSetAsideViews } from '../goals/queries';
import { monthlyInstalments } from '../loans/instalments';
import { useCardFacts, useLoans, useScheduledPayments } from '../loans/queries';
import { depositLine } from '../networth/deposit-terms';
import { DEBT_GROUP_LABELS, dayMonth } from '../networth/debt-rows';
import { PLAN_GROUP_LABELS } from '../networth/labels';
import { useAssetValues, useDepositTerms, useSheet } from '../networth/queries';
import { ShareBar } from '../networth/ShareBar';
import { cx, Empty, errorMessage, Money } from '../../ui';
import { type CornerAction, ActionLine, Figure, groupedFigure, Hero, InsetGroup, InsetRow, LargeTitle, LineAction, Panel, ROW_PAD_X, ROW_PAD_Y, rowHeight, SCREEN } from '../../ui/native';
import { SPENDABLE_KINDS, freeToSpend, moneySummary, parentTotal, pocketCount, pocketsOf } from './pockets';
import { useHeldRates } from './queries';

/**
 * One drawer of a group: what it is called, what it is known by, and — where its group is the debts — what it asks.
 */
interface Drawer {
  key: string;
  label: string;
  /** The figure the drawer carries, when the group's own arithmetic is not the one that belongs on it. */
  figure?: ReactNode;
  /** The line under the count: what this kind of debt asks, in its own words ("Rp 14.950.000 a month"). */
  ask?: string;
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
    label: PLAN_GROUP_LABELS.liquid,
    /* A deposit is a cash equivalent, which is what this group is called: it belongs with the money. */
    subtypes: ['cash', 'bank', 'savings', 'time_deposit', 'ewallet', 'fund', 'other_cash'],
    drawer: (account) => ({ key: account.subtype, label: SUBTYPE_LABELS[account.subtype] }),
    order: CASH_ITEMS.map((item) => item.id),
  },
  {
    key: 'owed',
    label: PLAN_GROUP_LABELS.owed,
    /* Money you lent is settled by a transaction, so it is managed here — one side of the same page as the
     * people you owe. */
    subtypes: ['receivable'],
    drawer: (account) => ({ key: account.subtype, label: SUBTYPE_LABELS[account.subtype] }),
    order: ['receivable'],
  },
  {
    key: 'debts',
    label: 'Debts',
    /* Cards, loans and the people you owe are all what you owe: one section, as the Debts page is one page, with
     * the Debts page's own three drawers inside it. */
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
 * What a set of accounts comes to at today's rates — or the rate one of them lacks, named instead. Never a partial
 * sum, and never a different answer for a group than for a drawer inside it.
 */
function totalOf(rows: AccountRow[], everything: AccountRow[], balances: Record<string, number>, baseCurrency: string, rates: Record<string, number>): string {
  const amounts = rows.flatMap((account) => {
    const its = pocketsOf(account.id, everything);
    return (its.length > 0 ? its : [account]).map((row) => ({ minor: displayAmount(row.kind, balances[row.id] ?? 0), currency: row.currency! }));
  });
  return groupedFigure(sumToBase({ amounts, baseCurrency, ratesToBase: rates }), baseCurrency).text;
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
 * A native list: one group, a line per account with its balance on the right, and the things that can be done to
 * it — the points door, Rename and Archive — wrapped under the name rather than pushed into a fifth and sixth
 * column. The table this replaces scrolled sideways on a phone, and a list of what you own is the one place that
 * must not.
 *
 * The tax code an account files under is *not* here. It is a figure for the report, not for this page, and a row
 * of four-digit codes under every balance read as noise; the asset's own page still names it, and still changes it.
 */
function AccountList({
  groupKey,
  title,
  trailing,
  accounts,
  drawers,
  open,
  onToggle,
  balances,
  everything,
  parents,
  rates,
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
}) {
  const { database, ws } = useApp();
  // The kit's grouped figure: the ≈ total, or the missing rate named — never a partial sum.
  const totalText = (account: AccountRow) => groupedFigure(parentTotal(pocketsOf(account.id, everything), balances, ws.baseCurrency, rates), ws.baseCurrency);
  const kindLine = (account: AccountRow) =>
    parents.has(account.id) ? `${SUBTYPE_LABELS[account.subtype]} · ${pocketCount(pocketsOf(account.id, everything).length)}` : `${SUBTYPE_LABELS[account.subtype]} · ${account.currency}`;
  const parentFigure = (account: AccountRow) => {
    const figure = totalText(account);
    return <Figure tone={figure.complete ? 'ink' : 'warn'}>{figure.text}</Figure>;
  };
  const invalidate = useInvalidateAll();
  const values = useAssetValues();
  const deposits = useDepositTerms();
  const valued = (id: string) => (values.data ?? []).find((row) => row.accountId === id && row.mode !== 'derived');
  /** A deposit's own two facts, the same short line its page prints: the day it comes back and what it pays. */
  const terms = (id: string) => {
    const row = (deposits.data ?? []).find((entry) => entry.accountId === id);
    return row ? depositLine(row) : null;
  };
  if (accounts.length === 0) return null;
  /** A drawer's own figure, added exactly as its group's is: what its rows come to, or the rate one lacks named. */
  const drawerTotal = (rows: AccountRow[]) => totalOf(rows, everything, balances, ws.baseCurrency, rates);

  async function rename(account: AccountRow) {
    const next = window.prompt('Rename account', account.name);
    if (next && next.trim() !== account.name) {
      await renameAccount(database, ws, account.id, next);
      await invalidate();
    }
  }
  async function archive(account: AccountRow) {
    if (window.confirm(`Archive ${account.name}? Its history stays in reports.`)) {
      try {
        await archiveAccount(database, ws, account.id);
        await invalidate();
      } catch (e) {
        window.alert(errorMessage(e));
      }
    }
  }

  /**
   * One account's line: what it is called, what type it is, its figure, and the things that can be done to it.
   * A function rather than a map inline, because a type's drawer draws its own rows under itself.
   */
  const line = (account: AccountRow, separator: boolean, depth = 0) => (
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
        subtitle={
          <>
            {kindLine(account)}
            {!parents.has(account.id) && terms(account.id) && ` · ${terms(account.id)}`}
          </>
        }
        figure={
          parents.has(account.id) ? (
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
          )
        }
      >
        {parents.has(account.id) && <span className="shrink-0 text-[12.5px] leading-[20px] text-[var(--ph-ink-3)]">Each pocket files its own row</span>}
        {account.subtype === 'credit_card' && (
          <LineAction to="/cards/$cardId" params={{ cardId: account.id }}>
            Set up points
          </LineAction>
        )}
        <LineAction label={`Rename ${account.name}`} onClick={() => void rename(account)}>
          Rename
        </LineAction>
        <LineAction label={`Archive ${account.name}`} onClick={() => void archive(account)}>
          Archive
        </LineAction>
      </ActionLine>
    </li>
  );

  return (
    <Panel wide pad={false} header={title} trailing={trailing}>
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
                    count={drawer.ask ? `${plural(drawer.rows.length, 'account')} · ${drawer.ask}` : plural(drawer.rows.length, 'account')}
                    figure={drawer.figure ?? <Figure>{drawerTotal(drawer.rows)}</Figure>}
                    open={shown}
                    separator={index > 0}
                    testId={`type-drawer-${drawer.key}`}
                    onToggle={() => onToggle(key)}
                  />
                </li>,
                ...(shown ? drawer.rows.map((account) => line(account, true, 1)) : []),
              ];
            })}
      </ul>
    </Panel>
  );
}

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

export function AccountsPage() {
  const { ws } = useApp();
  const today = isoDate();
  const accounts = useAccounts();
  const balances = useBalances();
  const everything = accounts.data ?? [];
  /* What this page lists, and what it does not: money, the money you lent, and what you owe. See `GROUPS`. */
  const money = everything.filter((account) => LISTED.has(account.subtype) && isMoneyAccount(account));
  const all = balances.data ?? {};
  const parents = pocketParentIds(everything);
  const byId = new Map(everything.map((account) => [account.id, account]));
  const loans = useLoans();
  const payments = useScheduledPayments();
  const owed = useSetAsideViews();
  const sheet = useSheet();
  const cardIds = money.filter((account) => account.subtype === 'credit_card').map((account) => account.id);
  const cards = useCardFacts(cardIds, today);
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
   * A group's own figure: what its rows add up to at today's rates, or the rate one of them lacks, named instead —
   * never a partial sum. Liabilities are added up as what is owed, so a card reads as the same positive figure its
   * own row shows.
   */
  const groupTotal = (rows: AccountRow[]) => totalOf(rows, everything, all, ws.baseCurrency, held);
  /**
   * Free to spend, and the three parts it is read from: money that can be moved, what goals have claimed of it, and
   * what the debts ask before the month is out — a card's billed bill, a loan's next instalment. Three things are
   * deliberately outside it: money that cannot be moved (a deposit until it matures), a debt's long-term principal
   * (a mortgage's balance is not money you must find this month — it is read against a year, on Net worth), and a
   * debt with no schedule at all (a friend you owe is a promise, and its row says so).
   */
  const spendable = moneySummary(everything, all, ws.baseCurrency, held, SPENDABLE_KINDS);
  const promised = sumToBase({
    amounts: Object.values(owed.data ?? {})
      .filter((row) => SPENDABLE_KINDS.has(byId.get(row.accountId)?.subtype ?? ''))
      .map((row) => ({ minor: row.setAsideMinor, currency: row.currency })),
    baseCurrency: ws.baseCurrency,
    ratesToBase: held,
  });
  const openLoans = (loans.data ?? []).filter((loan) => loan.status === 'open');
  const instalments = monthlyInstalments(openLoans, everything, payments.data ?? {}, ws.baseCurrency, held);
  const billed = sumToBase({
    amounts: cardIds.map((id) => ({ minor: cards.data?.[id]?.leftToPayMinor ?? 0, currency: byId.get(id)?.currency ?? ws.baseCurrency })),
    baseCurrency: ws.baseCurrency,
    ratesToBase: held,
  });
  const asked = {
    totalMinor: instalments.total.totalMinor === null || billed.totalMinor === null ? null : instalments.total.totalMinor + billed.totalMinor,
    missing: [...new Set([...instalments.total.missing, ...billed.missing])].sort(),
  };
  const free = freeToSpend(spendable, promised, asked);
  /** What the loans ask each month, and the bills the cards have billed and not yet paid: each drawer's own line. */
  const perMonth = instalments.total.totalMinor === null || instalments.total.totalMinor <= 0 ? null : `${formatMinor(instalments.total.totalMinor, ws.baseCurrency)} a month`;
  const billDates = cardIds.flatMap((id) => {
    const facts = cards.data?.[id];
    return facts && facts.leftToPayMinor > 0 && facts.dueOn ? [facts.dueOn] : [];
  });
  const oneBillDate = billDates.length > 0 && billDates.every((date) => date === billDates[0]) ? billDates[0]! : null;
  const cardAsk =
    billed.totalMinor === null || billed.totalMinor <= 0
      ? null
      : oneBillDate
        ? `${formatMinor(billed.totalMinor, ws.baseCurrency)} due ${dayMonth(oneBillDate)}`
        : `${formatMinor(billed.totalMinor, ws.baseCurrency)} billed`;
  /**
   * What each kind of debt asks within a year — the balance sheet's own reading of a debt, and the figure `/net-worth`
   * shows: a loan gives the principal its schedule names over twelve months, a card everything except a long plan's
   * tail, a person the whole promise. The rest of a loan is a schedule, and a schedule is the balance sheet's.
   */
  const withinYear = (subtype: AccountSubtype) =>
    (sheet.data?.liabilities ?? []).filter((row) => row.subtype === subtype).reduce((total, row) => total + row.dueWithinYearMinor, 0);
  const sheetMissing = sheet.data?.missing ?? [];
  const debtsTotal = withinYear('credit_card') + withinYear('loan') + withinYear('payable');
  const debtFigure = (subtype: AccountSubtype) =>
    sheetMissing.length > 0 ? <Figure tone="warn">{`No ${sheetMissing.join(', ')} rate yet`}</Figure> : <Money minor={withinYear(subtype)} currency={ws.baseCurrency} />;
  /** Each kind of debt, with what it asks here rather than the principal it owes. */
  const DEBT_ASKS: Record<string, { subtype: AccountSubtype; ask: string | null }> = {
    loan: { subtype: 'loan', ask: perMonth },
    card: { subtype: 'credit_card', ask: cardAsk },
    person: { subtype: 'payable', ask: null },
  };
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
  /* Three journeys, two corners: the `…` keeps Import CSV and Backup reachable and named in words. */
  const actions: CornerAction[] = [
    { key: 'new', label: 'Add account', to: '/accounts/new', glyph: <Plus size={20} aria-hidden /> },
    { key: 'import', label: 'Import CSV', to: '/import' },
    { key: 'backup', label: 'Backup', to: '/backup' },
  ];
  return (
    <div className={SCREEN}>
      <LargeTitle title="Accounts" actions={actions} />
      {accounts.isSuccess && money.length === 0 && <Empty>No accounts yet. Add one with the + above: money you can spend, or will spend once it matures.</Empty>}
      {/*
       * Free to spend: money that can be moved, less what goals have claimed, less what the debts ask before the
       * month is out. The three lines under it are the working, so the figure can be checked rather than trusted.
       */}
      {accounts.isSuccess && balances.isSuccess && rates.isSuccess && spendable.accounts > 0 &&
        (free.freeMinor !== null ? (
          <Hero
            label="Free to spend"
            minor={free.freeMinor}
            currency={ws.baseCurrency}
            caption={`Spending money ≈ at today's rates · across ${plural(spendable.accounts, 'account')} · ${plural(spendable.currencies, 'currency', 'currencies')}`}
          />
        ) : (
          <Panel header="Free to spend">
            <p className="text-[13px] leading-[17px] text-[var(--ph-ink-2)]">
              No {free.missing.join(', ')} rate yet, so what is left to spend cannot be worked out. Each balance below is exact.
            </p>
          </Panel>
        ))}
      {free.freeMinor !== null && free.spendableMinor !== null && (
        <>
          <InsetGroup>
            <InsetRow title="Spending money" value={<Money minor={free.spendableMinor} currency={ws.baseCurrency} />} valueTone="ink" chevron={false} />
            <InsetRow title="Set aside for goals" value={<Money minor={-(free.setAsideMinor ?? 0)} currency={ws.baseCurrency} />} chevron={false} />
            <InsetRow title="Due before the month is out" value={<Money minor={-(free.dueMinor ?? 0)} currency={ws.baseCurrency} />} chevron={false} />
          </InsetGroup>
          <Panel className="space-y-2">
            <ShareBar
              segments={[
                ...(free.freeMinor > 0 ? [{ key: 'free', label: 'Free', minor: free.freeMinor, className: 'bg-emerald-600' }] : []),
                ...(free.setAsideMinor !== null && free.setAsideMinor > 0 ? [{ key: 'set-aside', label: 'Set aside', minor: free.setAsideMinor, className: 'bg-slate-400' }] : []),
                ...(free.dueMinor !== null && free.dueMinor > 0 ? [{ key: 'due', label: 'Due', minor: free.dueMinor, className: 'bg-rose-500' }] : []),
              ]}
              totalMinor={Math.max(free.spendableMinor, (free.setAsideMinor ?? 0) + (free.dueMinor ?? 0))}
            />
          </Panel>
        </>
      )}
      {/* A pocket is never a row of its own: its account's row adds it up (P1). */}
      {GROUPS.map((group) => {
        const rows = money.filter((account) => account.parentId === null && group.subtypes.includes(account.subtype));
        if (rows.length === 0) return null;
        /*
         * What this group divides into. One drawer is no division at all, and gets no divider: a line naming the
         * only kind of thing in the panel says nothing the panel's own header has not already said.
         */
        const debts = group.key === 'debts';
        const drawers = drawersOf(group, rows).map((drawer) => {
          const asks = debts ? DEBT_ASKS[drawer.key] : undefined;
          return asks ? { ...drawer, figure: debtFigure(asks.subtype), ask: asks.ask ?? undefined } : drawer;
        });
        return (
          <AccountList
            key={group.key}
            groupKey={group.key}
            title={group.label}
            /* Normal case: the header shouts in capitals, and a currency symbol must not. A debt's figure is what it
             * asks within a year, so the long part of a loan is nowhere on this page. */
            trailing={
              <span className="tracking-normal normal-case">
                <Figure tone={debts && sheetMissing.length > 0 ? 'warn' : 'ink'}>
                  {debts ? (sheetMissing.length > 0 ? `No ${sheetMissing.join(', ')} rate yet` : <Money minor={debtsTotal} currency={ws.baseCurrency} />) : groupTotal(rows)}
                </Figure>
              </span>
            }
            accounts={rows}
            drawers={drawers}
            open={openTypes}
            onToggle={toggleType}
            balances={all}
            everything={everything}
            parents={parents}
            rates={held}
          />
        );
      })}
    </div>
  );
}
