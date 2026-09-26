import { formatMinor, isoDate } from '@expanses/core';
import { Link, type LinkProps } from '@tanstack/react-router';
import { Plus } from 'lucide-react';
import { useState } from 'react';
import { useApp } from '../../app/context';
import { useAccounts, useBalances } from '../../lib/queries';
import { Empty, ErrorBox, Money } from '../../ui';
import { ApproxFigure, approxLine, type CornerAction, Drawer, Figure, Hero, InsetGroup, InsetRow, Panel, PushedTitle, SCREEN, useDrawers } from '../../ui/native';
import { useHeldRates } from '../accounts/queries';
import { usePeopleDebts } from '../debts/queries';
import { debtKindTile } from '../ownables/catalogue-view';
import { bareFigure, type DebtDrawer, type DebtRow, type DebtSheet, groupDebts } from '../networth/debt-rows';
import { useSheet } from '../networth/queries';
import { ShareBar, ShareLegend } from '../networth/ShareBar';
import { debtSegments } from '../networth/share-segments';
import { monthlyInstalments } from './instalments';
import { useCardFacts, useLoanItems, useLoans, useScheduledPayments } from './queries';

/**
 * Liabilities: everything owed, in one box of drawers — a drawer per kind of debt, with its own total, and the debts
 * themselves inside it. What the Loans page did — terms, the instalments, the loans paid off — lives under them.
 */

/**
 * A kind's drawing, at the size a row draws one: the same mark the add-debt picker gave it, in the kit's neutral
 * circle. Each debt wears its drawer's, so a mortgage looks the same folded, open, and on the screen that added it.
 */
function KindIcon({ kind }: { kind: string }) {
  const Glyph = debtKindTile(kind);
  return <Glyph size={16} aria-hidden />;
}

/** Where a debt opens: a loan its terms and schedule, a card the card, a person Lend & borrow for them. */
function destination(row: DebtRow): { to: LinkProps['to']; params?: LinkProps['params']; search?: LinkProps['search'] } {
  if (row.kind === 'loan') return { to: '/net-worth/loans/$accountId', params: { accountId: row.accountId! } };
  if (row.kind === 'card') return { to: '/cards/$cardId', params: { cardId: row.accountId! } };
  return { to: '/net-worth/lend-borrow', search: row.personName ? { person: row.personName } : {} };
}

/** A drawer's trailing figure: what the kind comes to here, or the rate it is missing rather than a short total. */
function DrawerFigure({ drawer, baseCurrency }: { drawer: DebtDrawer; baseCurrency: string }) {
  return (
    /* The kit's header shouts in capitals; a currency symbol must not. */
    <span className="tracking-normal normal-case" data-testid={`debts-kind-total-${drawer.key}`}>
      {drawer.totalMinor === null ? (
        <Figure tone="warn">{`No ${drawer.missing.join(', ')} rate`}</Figure>
      ) : (
        <Money minor={drawer.totalMinor} currency={baseCurrency} />
      )}
    </span>
  );
}

/**
 * A debt's trailing figure: in the base currency bare, as the group's header names it; otherwise its own, with
 * what that comes to beneath — and the rate it was worked at after that.
 *
 * The rate stays on the row rather than only on the debt's own page: the two figures are a conversion, and a
 * conversion with no rate beside it is a number with nothing to check it against.
 */
function RowFigure({ row, baseCurrency, rates }: { row: DebtRow; baseCurrency: string; rates: Record<string, number> }) {
  if (row.currency === baseCurrency) return <Figure>{bareFigure(row.minor, row.currency)}</Figure>;
  const at = row.rate === null ? null : `at ${row.rate.toLocaleString('id-ID', { maximumFractionDigits: 4 })}`;
  return (
    <ApproxFigure
      figure={formatMinor(row.minor, row.currency)}
      beneath={[approxLine(row.minor, row.currency, baseCurrency, rates), at].filter(Boolean).join(' · ')}
    />
  );
}

function subtitleOf(row: DebtRow): string {
  return [row.last4 ? `···· ${row.last4}` : null, row.detail || null].filter(Boolean).join(' · ');
}

/** A debt's own line: the drawing its kind wears, its name, what it is, and what is owed. */
function DebtItem({ row, kind, baseCurrency, rates }: { row: DebtRow; kind: string; baseCurrency: string; rates: Record<string, number> }) {
  return (
    <InsetRow
      {...destination(row)}
      testId={`debt-row-${row.key}`}
      icon={<KindIcon kind={kind} />}
      title={row.name}
      subtitle={subtitleOf(row) || undefined}
      value={<RowFigure row={row} baseCurrency={baseCurrency} rates={rates} />}
      valueTone="ink"
    />
  );
}

/** The rate that is missing, named where the figure would be — there is no box to put a figure in. */
function Total({ debts }: { debts: DebtSheet }) {
  return (
    <div data-testid="debts-total" className="flex flex-col items-center text-center" style={{ marginBottom: 18 }}>
      <p className="text-[22px] leading-[28px] font-extrabold tracking-[-0.03em] text-[var(--ph-warn)]">No {debts.total.missing.join(', ')} rate yet</p>
      <p className="mt-[4px] text-[13px] leading-[17px] text-[var(--ph-ink-3)]">so the total can't be added up</p>
    </div>
  );
}

export function DebtsPage() {
  const { ws } = useApp();
  const today = isoDate();
  const baseCurrency = ws.baseCurrency;
  const accounts = useAccounts();
  const balances = useBalances();
  const loans = useLoans();
  const items = useLoanItems();
  const payments = useScheduledPayments();
  const people = usePeopleDebts(today);
  const sheet = useSheet();
  const all = accounts.data ?? [];
  const cardIds = all.filter((a) => a.subtype === 'credit_card' && a.archivedAt === null).map((a) => a.id);
  const cards = useCardFacts(cardIds, today);
  const owedTo = people.data?.youOwe ?? [];
  const held = useHeldRates([...all.filter((a) => a.kind === 'liability').map((a) => a.currency ?? baseCurrency), ...owedTo.map((p) => p.currency)]);
  const [showCleared, setShowCleared] = useState(false);

  const rates = held.data?.rates ?? {};
  const ready = accounts.data && balances.data && loans.data && people.data && cards.data && held.data && items.data;
  const debts = ready
    ? groupDebts(
        {
          accounts: all,
          balances: balances.data!,
          loans: loans.data!,
          cards: cards.data!,
          people: owedTo,
          sheet: sheet.data ?? null,
          baseCurrency,
          ratesToBase: rates,
          items: items.data!,
        },
        today,
      )
    : null;

  // The instalments the banks ask for each month: the Loans page's own figure, and the box's footer under it.
  const open = (loans.data ?? []).filter((loan) => loan.status === 'open');
  const instalments = monthlyInstalments(open, all, payments.data ?? {}, baseCurrency, rates);
  const instalmentLine =
    !payments.isSuccess || open.length === 0 ? null : instalments.total.totalMinor === null ? (
      `No ${instalments.total.missing.join(', ')} rate yet, so the instalments cannot be added up. Each loan is in its own currency.`
    ) : instalments.total.totalMinor > 0 ? (
      <>
        The instalments the banks ask for each month: <Money minor={instalments.total.totalMinor} currency={baseCurrency} />.
      </>
    ) : null;

  const actions: CornerAction[] = [{ key: 'add', label: 'Add a debt', glyph: <Plus size={22} aria-hidden />, to: '/debts/new' }];

  const due = debts?.due;
  const dueLine =
    !due || !sheet.isSuccess ? null : due.withinYearMinor === null ? (
      `No ${due.missing.join(', ')} rate yet, so what falls due within a year cannot be added up.`
    ) : (
      <>
        Due within a year: <Money minor={due.withinYearMinor} currency={baseCurrency} /> · the rest is long term.
      </>
    );

  /**
   * The loans paid off: a row that folds them out, in the box with the debts themselves, and — once it is open —
   * a box of its own under it. A loan's terms are written and corrected on the loan's own page; there is no state
   * in which the list has nothing to offer.
   */
  const paidOff = (debts?.cleared.length ?? 0) > 0 && (
    <InsetGroup header="Paid off">
      {debts!.cleared.map((loan) => (
        <InsetRow key={loan.accountId} title={loan.name} subtitle={loan.clearedOn ? `cleared ${loan.clearedOn}` : 'cleared'} chevron={false} />
      ))}
    </InsetGroup>
  );

    /*
   * Every drawer the box holds, in one list: the kinds of loan first — a mortgage with a mortgage, the way the
   * picker asks them apart — then the cards, then the people.
   *
   * Keyed by group as well as kind, so a drawer's own state belongs to one kind of debt: `loan:other_loans` and
   * `person:payable` cannot collide, and a card and a loan that happened to share a word could not either.
   */
  const drawers = (debts?.groups ?? []).flatMap((group, groupIndex) =>
    group.drawers.map((drawer, index) => ({
      key: `${group.kind}:${drawer.key}`,
      drawer,
      // A hairline above every drawer but the box's first: with the group headers gone, the line is the only thing
      // that tells one kind of debt from the next.
      separator: groupIndex > 0 || index > 0,
    })),
  );

  const nothing = debts !== null && debts.groups.length === 0;
  const drawersState = useDrawers();
  /*
   * What the total is made of: one segment per kind of debt, keyed the way the drawers are so a card and a loan that
   * shared a word could not share a segment. The same fold the list below makes, drawn above it — the bar is this
   * page's subject, and it was read as part of a total while it sat on the Overview.
   */
  const segments = debtSegments(
    (debts?.groups ?? []).flatMap((group) =>
      group.drawers.map((drawer) => ({ key: `${group.kind}:${drawer.key}`, label: drawer.label, totalMinor: drawer.totalMinor, kind: group.kind })),
    ),
  );

  return (
    <div className={SCREEN}>
      <PushedTitle title="Liabilities" back="Net worth" backTo="/net-worth" actions={actions} />
      <ErrorBox error={accounts.error ?? balances.error ?? loans.error ?? payments.error ?? people.error ?? cards.error ?? held.error ?? sheet.error} />

      {nothing && (
        <Empty>
          Nothing owed. Tap ＋ to add a loan, a card, or money you borrowed from someone; a loan already on{' '}
          <Link to="/accounts" className="font-medium underline">
            Accounts
          </Link>{' '}
          takes its terms below.
        </Empty>
      )}

      {debts && (
        <>
          {/*
           * One list at every width, the way Assets draws what is owned: the total as the hero, a group header
           * with its own total, a row per debt — its own currency and, beneath, what that comes to here.
           *
           * It was a two-column desktop page: the same figures twice in a left rail and a four-column table, with
           * a currency column that only ever had dollars in it. The table's balance/≈ pair is what the row already
           * says, so the rail and the table went and the phone's own list became the page.
           */}
          {/*
           * One box, and inside it a drawer for every kind of debt: the kinds of loan the picker asks apart — a home
           * mortgage, a lease, a paylater — then the cards, then the people.
           *
           * Three boxes with a header each read as three lists of three different things, and a debt is read by what
           * it is: a mortgage and a card are both what you owe, and the drawers are where their kinds are told apart.
           * The instalments sit under the box, in its footer, because they are the one figure only the loans have.
           */}
          {/*
           * The page's figure, inside the box it is made of: the bar under it is that total divided, so the number and
           * the drawing of it read as one thing rather than a figure with a chart somewhere below it. The caption went
           * with the move — the page is called Liabilities, and the box sits under that title.
           */}
          {!nothing && debts.total.totalMinor === null && <Total debts={debts} />}
          {!nothing && debts.total.totalMinor !== null && (
            <Panel wide className="mb-[18px] space-y-2">
              <div data-testid="debts-total">
                {/* Owed money is a figure like any other on this page: the box, the drawer and the row all draw it in
                    the page's own ink, and a red hero was the one place the same number wore a warning. */}
                <Hero minor={debts.total.totalMinor} currency={baseCurrency} align="center" />
              </div>
              {segments.length > 0 && (
                <>
                  <ShareBar segments={segments} totalMinor={debts.total.totalMinor} />
                  <ShareLegend segments={segments} totalMinor={debts.total.totalMinor} />
                </>
              )}
            </Panel>
          )}
          {(drawers.length > 0 || debts.cleared.length > 0) && (
            <InsetGroup footer={instalmentLine}>
              {drawers.flatMap(({ key, drawer, separator }) => {
                const shown = drawersState.open.has(key);
                return [
                  <Drawer
                    key={key}
                    icon={<KindIcon kind={drawer.key} />}
                    label={drawer.label}
                    under={`${drawer.rows.length} ${drawer.rows.length === 1 ? 'debt' : 'debts'}`}
                    figure={<DrawerFigure drawer={drawer} baseCurrency={baseCurrency} />}
                    open={shown}
                    separator={separator}
                    testId={`type-drawer-${key}`}
                    onToggle={() => drawersState.toggle(key)}
                  />,
                  ...(shown ? drawer.rows.map((row) => <DebtItem key={row.key} row={row} kind={drawer.key} baseCurrency={baseCurrency} rates={rates} />) : []),
                ];
              })}
              {debts.cleared.length > 0 && (
                <InsetRow title={`${showCleared ? 'Hide' : 'Show'} paid-off loans (${debts.cleared.length})`} onClick={() => setShowCleared((was) => !was)} chevron={false} />
              )}
            </InsetGroup>
          )}
          {showCleared && paidOff}
          {!nothing && dueLine && (
            <p data-testid="debts-due" className="px-[4px] text-[12px] leading-[16px] text-[var(--ph-ink-3)]" style={{ marginTop: -10, marginBottom: 18 }}>
              {dueLine}
            </p>
          )}
        </>
      )}
    </div>
  );
}
