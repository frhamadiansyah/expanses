import { formatMinor, isoDate } from '@expanses/core';
import { Link, type LinkProps, useNavigate } from '@tanstack/react-router';
import { Car, CreditCard, House, Landmark, Plus } from 'lucide-react';
import { type ReactNode, useState } from 'react';
import { useApp } from '../../app/context';
import { usePhone } from '../../app/use-phone';
import { useAccounts, useBalances } from '../../lib/queries';
import { cx, Empty, ErrorBox, Money } from '../../ui';
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

/** The phone's trailing figure: in the base currency bare, as the header names it; otherwise its own, with ≈ beneath. */
function RowFigure({ row, baseCurrency, rates }: { row: DebtRow; baseCurrency: string; rates: Record<string, number> }) {
  if (row.currency === baseCurrency) return <Figure>{bareFigure(row.minor, row.currency)}</Figure>;
  return <ApproxFigure figure={formatMinor(row.minor, row.currency)} beneath={approxLine(row.minor, row.currency, baseCurrency, rates)} />;
}

function subtitleOf(row: DebtRow): string {
  return [row.last4 ? `···· ${row.last4}` : null, row.detail || null].filter(Boolean).join(' · ');
}

function PhoneGroup({ group, baseCurrency, rates, footer }: { group: DebtGroup; baseCurrency: string; rates: Record<string, number>; footer?: ReactNode }) {
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

/** The desktop's table: the balance in the debt's own currency next to its value in the base currency. */
function DebtTable({ groups, baseCurrency }: { groups: DebtGroup[]; baseCurrency: string }) {
  const navigate = useNavigate();
  const cell = 'border-t-[0.5px] border-[var(--ph-hair)] px-[14px] py-[10px] align-middle';
  const head = 'border-b-[0.5px] border-[var(--ph-hair)] px-[14px] py-[10px] text-[11.5px] font-semibold tracking-[0.06em] text-[var(--ph-ink-3)] uppercase';
  return (
    <div className="overflow-hidden bg-[var(--ph-surface)]" style={{ borderRadius: 11 }}>
      <table className="w-full border-collapse text-[14px]" data-testid="debts-table">
        <thead>
          <tr>
            <th scope="col" className={cx(head, 'text-left')}>Debt</th>
            <th scope="col" className={cx(head, 'text-left')}>Details</th>
            <th scope="col" className={cx(head, 'text-right')}>Balance</th>
            <th scope="col" className={cx(head, 'text-right')}>In {currencyWord(baseCurrency)}</th>
          </tr>
        </thead>
        {groups.map((group) => (
          <tbody key={group.kind}>
            <tr>
              <th colSpan={4} scope="colgroup" className="bg-[var(--ph-ground)] px-[14px] pt-[14px] pb-[6px] text-left text-[11.5px] font-semibold tracking-[0.06em] text-[var(--ph-ink-3)] uppercase">
                <span className="flex items-baseline justify-between gap-3">
                  <span>{group.label}</span>
                  <HeaderFigure group={group} baseCurrency={baseCurrency} />
                </span>
              </th>
            </tr>
            {group.rows.map((row) => {
              const to = destination(row);
              return (
                <tr
                  key={row.key}
                  data-testid={`debt-row-${row.key}`}
                  className="cursor-pointer hover:bg-[var(--ph-fill)]"
                  onClick={(event) => {
                    // The name is a real link; a click anywhere else on the row goes to the same place.
                    if ((event.target as HTMLElement).closest('a')) return;
                    void navigate(to);
                  }}
                >
                  <td className={cx(cell, 'text-[var(--ph-ink)]')}>
                    <Link {...to} className="ph-focus font-medium text-[var(--ph-ink)]">
                      {row.name}
                    </Link>
                    {row.last4 && <span className="text-[var(--ph-ink-3)]"> ···· {row.last4}</span>}
                  </td>
                  <td className={cx(cell, 'text-[var(--ph-ink-3)]')}>{row.detail}</td>
                  <td className={cx(cell, 'tabular text-right whitespace-nowrap text-[var(--ph-ink)]')}>{formatMinor(row.minor, row.currency)}</td>
                  <td className={cx(cell, 'tabular text-right whitespace-nowrap')}>
                    {row.baseMinor === null ? (
                      <Figure tone="warn">{`No ${row.missing} rate yet`}</Figure>
                    ) : (
                      <>
                        <Figure>{bareFigure(row.baseMinor, baseCurrency)}</Figure>
                        {row.rate !== null && (
                          <span className="ml-[6px] rounded-full bg-[var(--ph-track)] px-[8px] py-[2px] text-[11px] font-semibold text-[var(--ph-ink-2)]">
                            at {row.rate.toLocaleString('id-ID', { maximumFractionDigits: 4 })}
                          </span>
                        )}
                      </>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        ))}
      </table>
    </div>
  );
}

/** The figure the page is for, or — when a rate is missing — the rate named instead of a wrong figure. */
function Total({ debts, baseCurrency, today, left }: { debts: DebtSheet; baseCurrency: string; today: string; left: boolean }) {
  const caption = `You owe, in ${currencyWord(baseCurrency)} · ${longDate(today)}`;
  if (debts.total.totalMinor !== null)
    return (
      <div data-testid="debts-total">
        <Hero minor={debts.total.totalMinor} currency={baseCurrency} direction="out" caption={caption} align={left ? 'start' : 'center'} />
      </div>
    );
  return (
    <div data-testid="debts-total" className={cx('flex flex-col', left ? 'items-start text-left' : 'items-center text-center')} style={{ marginBottom: 18 }}>
      <p className="text-[22px] leading-[28px] font-extrabold tracking-[-0.03em] text-[var(--ph-warn)]">No {debts.total.missing.join(', ')} rate yet</p>
      <p className="mt-[4px] text-[13px] leading-[17px] text-[var(--ph-ink-3)]">so the total can't be added up</p>
    </div>
  );
}

/** The row figure in a totals group on the desktop: bare, as the hero above names the currency. */
const sideFigure = (minor: number | null, missing: readonly string[], baseCurrency: string) =>
  minor === null ? <Figure tone="warn">{missing.length ? `No ${missing.join(', ')} rate yet` : '—'}</Figure> : <Figure>{bareFigure(minor, baseCurrency)}</Figure>;

export function DebtsPage() {
  const { ws } = useApp();
  const phone = usePhone();
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

      {debts && phone && (
        <>
          {!nothing && <Total debts={debts} baseCurrency={baseCurrency} today={today} left={false} />}
          {debts.groups.map((group) => (
            <div key={group.kind}>
              <PhoneGroup group={group} baseCurrency={baseCurrency} rates={rates} footer={group.kind === 'loan' ? instalmentLine : undefined} />
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

      {debts && !phone && (
        <div className="grid items-start gap-[28px] md:grid-cols-[260px_minmax(0,1fr)]">
          <div>
            {!nothing && <Total debts={debts} baseCurrency={baseCurrency} today={today} left />}
            {!nothing && (
              <InsetGroup>
                {debts.groups.map((group) => (
                  <InsetRow key={group.kind} title={group.label} value={sideFigure(group.totalMinor, group.missing, baseCurrency)} valueTone="ink" testId={`debts-side-${group.kind}`} />
                ))}
              </InsetGroup>
            )}
            {!nothing && due && sheet.isSuccess && (
              <InsetGroup>
                <InsetRow title="Due within a year" value={sideFigure(due.withinYearMinor, due.missing, baseCurrency)} valueTone="ink" testId="debts-side-within-year" />
                <InsetRow title="Long term" value={sideFigure(due.longTermMinor, due.missing, baseCurrency)} valueTone="ink" testId="debts-side-long-term" />
              </InsetGroup>
            )}
            {instalmentLine && <p className="px-[4px] text-[12.5px] leading-[16px] text-[var(--ph-ink-3)]">{instalmentLine}</p>}
          </div>
          <div className="min-w-0">
            {!nothing && <DebtTable groups={debts.groups} baseCurrency={baseCurrency} />}
            <div className={nothing ? undefined : 'mt-[18px]'}>{loanTools}</div>
          </div>
        </div>
      )}
    </div>
  );
}
