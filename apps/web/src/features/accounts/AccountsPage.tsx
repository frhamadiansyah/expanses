import { CASH_ITEMS, displayAmount, sumToBase } from '@expanses/core';
import { type AccountRow, type AccountSubtype, archiveAccount, pocketParentIds, renameAccount } from '@expanses/db';
import { Link, type LinkProps } from '@tanstack/react-router';
import { Plus } from 'lucide-react';
import { type ReactNode } from 'react';
import { useApp } from '../../app/context';
import { SUBTYPE_LABELS } from '../../lib/account-types';
import { isMoneyAccount, useAccounts, useBalances, useInvalidateAll } from '../../lib/queries';
import { depositLine } from '../networth/deposit-terms';
import { PLAN_GROUP_LABELS } from '../networth/labels';
import { useAssetValues, useDepositTerms } from '../networth/queries';
import { Empty, errorMessage, Money } from '../../ui';
import { type CornerAction, ActionLine, Figure, groupedFigure, Hero, LargeTitle, LineAction, Panel, SCREEN } from '../../ui/native';
import { moneySummary, parentTotal, pocketCount, pocketsOf } from './pockets';
import { useHeldRates } from './queries';

/**
 * The kinds of account, gathered the way the Assets page gathers what you own and the Debts page gathers what you
 * owe: cash first, then money that is waiting for a date, then what is invested, what is for use, what is owed to
 * you — and under them the cards, the loans and the people you owe.
 *
 * Four of the words are the plan groups the Assets page already names its groups by, and the last three are the
 * Debts page's own three, so the same account is called the same thing on every page that lists it.
 */
const GROUPS: { key: string; label: string; subtypes: AccountSubtype[] }[] = [
  { key: 'cash', label: PLAN_GROUP_LABELS.liquid, subtypes: ['bank', 'cash', 'savings', 'ewallet', 'fund', 'other_cash'] },
  { key: 'deposit', label: 'Time deposits', subtypes: ['time_deposit'] },
  { key: 'invest', label: PLAN_GROUP_LABELS.invest, subtypes: ['investment'] },
  { key: 'use', label: PLAN_GROUP_LABELS.use, subtypes: ['property', 'vehicle'] },
  { key: 'owed', label: PLAN_GROUP_LABELS.owed, subtypes: ['receivable'] },
  { key: 'cards', label: 'Credit cards', subtypes: ['credit_card'] },
  { key: 'loans', label: 'Loans', subtypes: ['loan'] },
  { key: 'people', label: 'You owe people', subtypes: ['payable'] },
];

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
  title,
  trailing,
  accounts,
  balances,
  everything,
  parents,
  rates,
}: {
  title: string;
  /** The group's own figure, drawn in its header as the Assets page draws its groups'. */
  trailing?: ReactNode;
  accounts: AccountRow[];
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

  return (
    <Panel wide pad={false} header={title} trailing={trailing}>
      <ul>
        {accounts.map((account, index) => (
          <li key={account.id}>
            <ActionLine
              separator={index > 0}
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
        ))}
      </ul>
    </Panel>
  );
}

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

export function AccountsPage() {
  const { ws } = useApp();
  const accounts = useAccounts();
  const balances = useBalances();
  const everything = accounts.data ?? [];
  const money = everything.filter(isMoneyAccount);
  const all = balances.data ?? {};
  const parents = pocketParentIds(everything);
  // Every money account's currency, not only the pockets': the Money tile converts them all.
  const rates = useHeldRates(everything.filter((a) => a.kind === 'asset' && a.archivedAt === null).map((a) => a.currency!));
  const held = rates.data?.rates ?? {};
  const summary = moneySummary(everything, all, ws.baseCurrency, held);
  /**
   * A group's own figure: what its rows add up to at today's rates, or the rate one of them lacks, named instead —
   * never a partial sum. Liabilities are added up as what is owed, so a card reads as the same positive figure its
   * own row shows.
   */
  const groupTotal = (rows: AccountRow[]) => {
    const amounts = rows.flatMap((account) => {
      const its = pocketsOf(account.id, everything);
      return (its.length > 0 ? its : [account]).map((row) => ({ minor: displayAmount(row.kind, all[row.id] ?? 0), currency: row.currency! }));
    });
    return groupedFigure(sumToBase({ amounts, baseCurrency: ws.baseCurrency, ratesToBase: held }), ws.baseCurrency).text;
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
      {/* The Money tile: every money account and pocket at today's rates, or the rate it lacks named — never a partial sum. */}
      {accounts.isSuccess && balances.isSuccess && rates.isSuccess && summary.accounts > 0 &&
        (summary.totalMinor !== null ? (
          <Hero
            minor={summary.totalMinor}
            currency={ws.baseCurrency}
            caption={`Money ≈ at today's rates · across ${plural(summary.accounts, 'account')} · ${plural(summary.currencies, 'currency', 'currencies')}`}
          />
        ) : (
          <Panel header="Money">
            <p className="text-[13px] leading-[17px] text-[var(--ph-ink-2)]">
              No {summary.missing.join(', ')} rate yet, so {plural(summary.accounts, 'account')} in {plural(summary.currencies, 'currency', 'currencies')} cannot be added up. Each balance below is
              exact.
            </p>
          </Panel>
        ))}
      {/* A pocket is never a row of its own: its account's row adds it up (P1). */}
      {GROUPS.map((group) => {
        const rows = money.filter((account) => account.parentId === null && group.subtypes.includes(account.subtype));
        if (rows.length === 0) return null;
        return (
          <AccountList
            key={group.key}
            title={group.label}
            /* Normal case: the header shouts in capitals, and a currency symbol must not. */
            trailing={
              <span className="tracking-normal normal-case">
                <Figure>{groupTotal(rows)}</Figure>
              </span>
            }
            accounts={rows}
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
