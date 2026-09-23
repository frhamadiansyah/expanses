import { CASH_ITEMS, cashCodeForSubtype, displayAmount, hartaLabel, type MoneyAccountSubtype } from '@expanses/core';
import { type AccountRow, type AccountSubtype, archiveAccount, pocketParentIds, renameAccount } from '@expanses/db';
import { Link } from '@tanstack/react-router';
import { Plus } from 'lucide-react';
import { useApp } from '../../app/context';
import { SUBTYPE_LABELS } from '../../lib/account-types';
import { isMoneyAccount, useAccounts, useBalances, useInvalidateAll } from '../../lib/queries';
import { depositLine } from '../networth/deposit-terms';
import { useAssetProfiles, useAssetValues, useDepositTerms } from '../networth/queries';
import { Empty, errorMessage, Money } from '../../ui';
import { type CornerAction, ActionLine, Figure, groupedFigure, Hero, LargeTitle, LineAction, Panel, SCREEN } from '../../ui/native';
import { moneySummary, parentTotal, pocketCount, pocketsOf } from './pockets';
import { useHeldRates } from './queries';

/** The seven kinds of account that hold money, as the catalogue names them. Their `id` is the ledger's subtype. */
const CASH_SUBTYPES = new Set<string>(CASH_ITEMS.map((item) => item.id));
const isCashSubtype = (subtype: AccountSubtype): subtype is MoneyAccountSubtype => CASH_SUBTYPES.has(subtype);

/**
 * One section of the account list.
 *
 * A native list: one group, a line per account with its balance on the right, and the things that can be done to
 * it — the tax code it files under, the points door, Rename and Archive — wrapped under the name rather than
 * pushed into a fifth and sixth column. The table this replaces scrolled sideways on a phone, and a list of what
 * you own is the one place that must not.
 */
function AccountList({
  title,
  accounts,
  balances,
  everything,
  parents,
  rates,
}: {
  title: string;
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
  const profiles = useAssetProfiles();
  const deposits = useDepositTerms();
  const valued = (id: string) => (values.data ?? []).find((row) => row.accountId === id && row.mode !== 'derived');
  /** A deposit's own two facts, the same short line its page prints: the day it comes back and what it pays. */
  const terms = (id: string) => {
    const row = (deposits.data ?? []).find((entry) => entry.accountId === id);
    return row ? depositLine(row) : null;
  };
  /**
   * The code this account files under in the tax report, and what the form calls it. The owner's own choice when
   * there is a profile; otherwise the default its kind of money account carries, which is what the report uses too.
   * Nothing for a card or a loan: those are a debt's code, which the debt's own page shows.
   */
  const filedAs = (account: AccountRow) => {
    const chosen = (profiles.data ?? []).find((row) => row.accountId === account.id)?.coretaxCode;
    const code = chosen ?? (isCashSubtype(account.subtype) ? cashCodeForSubtype(account.subtype) : null);
    const label = code ? hartaLabel(code) : '';
    return label ? `${code} · ${label}` : null;
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
    <Panel wide pad={false} header={title}>
      <ul>
        {accounts.map((account, index) => (
          <li key={account.id}>
            <ActionLine
              separator={index > 0}
              name={
                parents.has(account.id) ? (
                  /* An account with pockets opens to its pockets; each pocket's history is one tap further. */
                  <Link to="/accounts/$accountId" params={{ accountId: account.id }} className="ph-focus">
                    {account.name}
                  </Link>
                ) : (
                  <Link to="/transactions" search={{ account: account.id }} className="ph-focus">
                    {account.name}
                  </Link>
                )
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
              {parents.has(account.id) ? (
                <span className="shrink-0 text-[12.5px] leading-[20px] text-[var(--ph-ink-3)]">Each pocket files its own row</span>
              ) : filedAs(account) ? (
                /* The code is never shown while choosing; here it is, and this is where it can be changed. */
                <LineAction to="/net-worth/assets/$accountId" params={{ accountId: account.id }} label={`Filed as ${filedAs(account)} — ${account.name}`}>
                  {filedAs(account)}
                </LineAction>
              ) : null}
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
      <AccountList title="Money" accounts={money.filter((a) => a.kind === 'asset' && a.parentId === null)} balances={all} everything={everything} parents={parents} rates={held} />
      <AccountList title="Credit cards & debts" accounts={money.filter((a) => a.kind === 'liability')} balances={all} everything={everything} parents={parents} rates={held} />
    </div>
  );
}
