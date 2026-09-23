import { formatMinor, isoDate } from '@expanses/core';
import { Link, type LinkProps } from '@tanstack/react-router';
import { Car, CreditCard, House, Landmark, Plus } from 'lucide-react';
import { type ReactNode, useState } from 'react';
import { useApp } from '../../app/context';
import { useAccounts, useBalances } from '../../lib/queries';
import { Empty, ErrorBox, Money } from '../../ui';
import { ApproxFigure, approxLine, type CornerAction, Figure, Hero, InsetGroup, InsetRow, LargeTitle, SCREEN } from '../../ui/native';
import { useHeldRates } from '../accounts/queries';
import { usePeopleDebts } from '../debts/queries';
import { NetWorthTabs } from '../networth/NetWorthTabs';
import { bareFigure, type DebtGroup, type DebtIcon, type DebtRow, type DebtSheet, groupDebts } from '../networth/debt-rows';
import { useSheet } from '../networth/queries';
import { monthlyInstalments } from './instalments';
import { useCardFacts, useLoans, useScheduledPayments } from './queries';

/**
 * Debts: everything owed, in one list, grouped the way Assets groups what is owned — Loans, Credit cards, and
 * the people you owe. One converted total above, each group's own total in its header, and every debt in its own
 * currency. What the Loans page did — terms, the instalments, the loans paid off — lives under the Loans group.
 */

const ICONS: Record<DebtIcon, { glyph: ReactNode; colour: string }> = {
  home: { glyph: <House size={15} aria-hidden />, colour: '#2F6FEB' },
  car: { glyph: <Car size={15} aria-hidden />, colour: '#4E8A3E' },
  loan: { glyph: <Landmark size={15} aria-hidden />, colour: '#6B5BD2' },
  card: { glyph: <CreditCard size={15} aria-hidden />, colour: '#5A6478' },
  person: { glyph: null, colour: '#C2417A' },
};

/** The currency's everyday name, from the platform rather than a list: "Rupiah", "Dollar", "Euro". */
function currencyWord(code: string): string {
  try {
    const name = new Intl.DisplayNames(['en'], { type: 'currency' }).of(code) ?? code;
    return name.split(' ').at(-1) ?? name;
  } catch {
    return code;
  }
}

const longDate = (iso: string) => {
  const d = new Date(`${iso}T00:00:00`);
  return `${d.getDate()} ${d.toLocaleDateString('en-US', { month: 'short' })} ${d.getFullYear()}`;
};

/** Where a debt opens: a loan its terms and schedule, a card the card, a person Lend & borrow for them. */
function destination(row: DebtRow): { to: LinkProps['to']; params?: LinkProps['params']; search?: LinkProps['search'] } {
  if (row.kind === 'loan') return { to: '/net-worth/loans/$accountId', params: { accountId: row.accountId! } };
  if (row.kind === 'card') return { to: '/cards/$cardId', params: { cardId: row.accountId! } };
  return { to: '/net-worth/lend-borrow', search: row.personName ? { person: row.personName } : {} };
}

/** A header's figure, set as a figure: the kit's header shouts in capitals, a currency symbol must not. */
function HeaderFigure({ group, baseCurrency }: { group: DebtGroup; baseCurrency: string }) {
  return (
    <span className="tracking-normal normal-case" data-testid={`debts-group-total-${group.kind}`}>
      {group.totalMinor === null ? '—' : <Money minor={group.totalMinor} currency={baseCurrency} />}
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

/** A group of debts, as the kit draws a list: a header with the group's own total, and a row per debt. */
function DebtListGroup({ group, baseCurrency, rates, footer }: { group: DebtGroup; baseCurrency: string; rates: Record<string, number>; footer?: ReactNode }) {
  return (
    <InsetGroup header={group.label} trailing={<HeaderFigure group={group} baseCurrency={baseCurrency} />} footer={footer}>
      {group.rows.map((row) => {
        const icon = ICONS[row.icon];
        return (
          <InsetRow
            key={row.key}
            {...destination(row)}
            testId={`debt-row-${row.key}`}
            icon={icon.glyph ?? <span className="text-[13px] font-semibold">{row.name.slice(0, 1).toUpperCase()}</span>}
            iconColour={icon.colour}
            title={row.name}
            subtitle={subtitleOf(row) || undefined}
            value={<RowFigure row={row} baseCurrency={baseCurrency} rates={rates} />}
            valueTone="ink"
          />
        );
      })}
    </InsetGroup>
  );
}

/** The figure the page is for, or — when a rate is missing — the rate named instead of a wrong figure. */
function Total({ debts, baseCurrency, today }: { debts: DebtSheet; baseCurrency: string; today: string }) {
  const caption = `You owe, in ${currencyWord(baseCurrency)} · ${longDate(today)}`;
  if (debts.total.totalMinor !== null)
    return (
      <div data-testid="debts-total">
        <Hero minor={debts.total.totalMinor} currency={baseCurrency} direction="out" caption={caption} />
      </div>
    );
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
  const ready = accounts.data && balances.data && loans.data && people.data && cards.data && held.data;
  const debts = ready
    ? groupDebts(
        { accounts: all, balances: balances.data!, loans: loans.data!, cards: cards.data!, people: owedTo, sheet: sheet.data ?? null, baseCurrency, ratesToBase: rates },
        today,
      )
    : null;

  // The instalments the banks ask for each month: the Loans page's own figure, now the Loans group's footer.
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

  const actions: CornerAction[] = [{ key: 'add', label: 'Add a debt', glyph: <Plus size={20} aria-hidden />, to: '/debts/new' }];

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
   * Under the Loans group: the loans paid off, which the live list cannot show. A loan's terms are written and
   * corrected on the loan's own page — it already knows which loan it is, and there is no state in which the list
   * has nothing to offer.
   */
  const loanTools = (
    <>
      {(debts?.cleared.length ?? 0) > 0 && (
        <InsetGroup>
          <InsetRow title={`${showCleared ? 'Hide' : 'Show'} paid-off loans (${debts!.cleared.length})`} onClick={() => setShowCleared((was) => !was)} chevron={false} />
        </InsetGroup>
      )}
      {showCleared && debts && debts.cleared.length > 0 && (
        <InsetGroup header="Paid off">
          {debts.cleared.map((loan) => (
            <InsetRow key={loan.accountId} title={loan.name} subtitle={loan.clearedOn ? `cleared ${loan.clearedOn}` : 'cleared'} chevron={false} />
          ))}
        </InsetGroup>
      )}
    </>
  );

  const loansGroup = debts?.groups.find((group) => group.kind === 'loan');
  const nothing = debts !== null && debts.groups.length === 0;

  return (
    <div className={SCREEN}>
      <LargeTitle title="Debts" actions={actions} />
      <NetWorthTabs />
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
          {!nothing && <Total debts={debts} baseCurrency={baseCurrency} today={today} />}
          {debts.groups.map((group) => (
            <div key={group.kind}>
              <DebtListGroup group={group} baseCurrency={baseCurrency} rates={rates} footer={group.kind === 'loan' ? instalmentLine : undefined} />
              {group.kind === 'loan' && loanTools}
            </div>
          ))}
          {!nothing && dueLine && (
            <p data-testid="debts-due" className="px-[4px] text-[12px] leading-[16px] text-[var(--ph-ink-3)]" style={{ marginTop: -10, marginBottom: 18 }}>
              {dueLine}
            </p>
          )}
          {!loansGroup && loanTools}
        </>
      )}
    </div>
  );
}
