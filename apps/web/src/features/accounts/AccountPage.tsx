import { cashCodeForSubtype, CASH_ITEMS, hartaLabel, isoDate, lastNMonths, monthOf } from '@expanses/core';
import { type AccountRow, archiveAccount, pocketParentIds, renameAccount } from '@expanses/db';
import { Link, useNavigate, useParams } from '@tanstack/react-router';
import {
  Archive,
  ArrowDownLeft,
  ArrowDownToLine,
  ArrowLeftRight,
  ArrowUpFromLine,
  ArrowUpRight,
  ChevronRight,
  FileText,
  MoreHorizontal,
  Pencil,
  Plus,
  Settings,
} from 'lucide-react';
import { type ReactElement, useState } from 'react';
import { useApp } from '../../app/context';
import { SPENDABLE_SUBTYPES, SUBTYPE_LABELS } from '../../lib/account-types';
import { useAccounts, useBalances, useInvalidateAll } from '../../lib/queries';
import { Empty, ErrorBox, Money } from '../../ui';
import {
  ActionButtons,
  ApproxFigure,
  approxLine,
  type CornerAction,
  Hero,
  InsetGroup,
  InsetRow,
  LargeTitle,
  Panel,
  PushedTitle,
  rateLine,
  type RoundAction,
  SCREEN,
} from '../../ui/native';
import { DepositMoneyOut } from '../networth/DepositMoneyOut';
import { DepositProposalCard } from '../networth/DepositProposalCard';
import { DepositTermsCard } from '../networth/DepositTermsCard';
import { MaturitySettings } from '../networth/MaturitySettings';
import { RecordedByHand } from '../networth/RecordedByHand';
import { SetAsidePanel } from '../networth/SetAsidePanel';
import { ValueChart } from '../networth/ValueChart';
import { useAssetProfiles, useMonthEndValues } from '../networth/queries';
import { buildRows } from '../transactions/list-model';
import { TransactionRow } from '../transactions/TransactionRow';
import { currencyFlag } from '../transactions/tx-form';
import { currencyName, parentTotal, pocketsOf } from './pockets';
import { useHeldRates, useOpenings, useRecentTransactions } from './queries';

/** The kinds of money account, so an account's own page can say what it is and which code it files under. */
const CASH_SUBTYPES = new Set<string>(CASH_ITEMS.map((item) => item.id));

const MONTH_LABEL = (month: string) => new Date(`${month}-01T00:00:00`).toLocaleDateString('en-GB', { month: 'short' });

/**
 * `/accounts/$accountId` — one page for every money account.
 *
 * Cash, a wallet, a current or saving account, an RDN, a deposit, an account with pockets and each of its pockets
 * all draw the same page, top to bottom: the name and its ⋯, the balance, what can be done with it, what is set
 * aside, what only this kind has, the last few rows behind the balance, and the plain facts. Only the actions and
 * the one slot in the middle change with the kind. Pockets used to open the older asset page, which said the same
 * things in another order; a pocket is an account, so it has an account's page, with its parent as the way back.
 */
export function AccountPage() {
  const { accountId = '' } = useParams({ strict: false }) as { accountId?: string };
  const accounts = useAccounts();
  const all = accounts.data ?? [];
  const account = all.find((a) => a.id === accountId);
  if (accounts.isSuccess && !account) {
    return (
      <div className={SCREEN}>
        <PushedTitle title="Account" back="Accounts" backTo="/accounts" />
        <Empty>That account is not in this workspace.</Empty>
      </div>
    );
  }
  if (!account) return <div className={SCREEN}>Loading…</div>;
  const parent = account.parentId ? all.find((a) => a.id === account.parentId) : undefined;
  // Keyed, so moving from a pocket to its parent starts the page's own state (an error, an open sheet) afresh.
  return <AccountBody key={account.id} account={account} parent={parent} pockets={pocketParentIds(all).has(account.id) ? pocketsOf(account.id, all) : null} />;
}

function AccountBody({ account, parent, pockets }: { account: AccountRow; parent: AccountRow | undefined; pockets: AccountRow[] | null }) {
  const { ws } = useApp();
  const navigate = useNavigate();
  const balances = useBalances();
  const profiles = useAssetProfiles();
  const [actionError, setActionError] = useState<unknown>(null);
  const pocketIds = pockets?.map((p) => p.id) ?? [];
  const currencies = pockets ? pockets.map((p) => p.currency!) : [account.currency!];
  const rates = useHeldRates(currencies);
  const openings = useOpenings(pockets ? [] : [account.id]);
  const held = rates.data?.rates ?? {};
  const minor = balances.data?.[account.id] ?? 0;

  const profileOf = (id: string | undefined) => (profiles.data ?? []).find((row) => row.accountId === id);
  // The bank is kept as the tax report's "institution"; an account with pockets keeps it on each pocket.
  const inst = (profileOf(account.id) ?? profileOf(pockets?.[0]?.id))?.coretaxFields.inst?.trim() || null;
  const chosen = profileOf(account.id)?.coretaxCode;
  const code = chosen ?? (CASH_SUBTYPES.has(account.subtype) ? cashCodeForSubtype(account.subtype) : null);
  const codeLine = code ? `${code} · ${hartaLabel(code) ?? ''}`.replace(/ · $/, '') : 'Not set yet';
  const typeLabel = SUBTYPE_LABELS[account.subtype];
  const foreign = !pockets && account.currency !== ws.baseCurrency;
  const opened = openings.data?.[account.id];

  const title = parent ? `${parent.name} · ${account.currency}` : account.name;
  const menu = usePageMenu(account, { parent, empty: minor === 0, codeLine, onError: setActionError });
  const closedTo = () => void navigate({ to: '/net-worth/assets' });

  return (
    <div className={SCREEN}>
      {/*
       * A pushed screen's bar, as Add transaction draws its own: the way back in a circle, the name centred, and the
       * one ⋯ on the right. An account is something you came into from a list, not a section of the app.
       */}
      <PushedTitle
        title={title}
        back={parent?.name ?? 'Accounts'}
        backTo={parent ? '/accounts/$accountId' : '/accounts'}
        backParams={parent ? { accountId: parent.id } : undefined}
        actions={menu}
      />
      <ErrorBox error={actionError ?? balances.error ?? profiles.error ?? rates.error} />

      {pockets ? (
        <ParentHero pockets={pockets} typeLabel={typeLabel} inst={inst} held={held} />
      ) : (
        <Hero
          label="Balance"
          minor={minor}
          currency={account.currency!}
          caption={
            <>
              <span className="block">{[inst, typeLabel, account.currency].filter(Boolean).join(' · ')}</span>
              {foreign && <ForeignLine currency={account.currency!} minor={minor} rates={rates.data} />}
            </>
          }
        />
      )}

      {account.subtype === 'time_deposit' && !pockets ? (
        <DepositMoneyOut look="action" accountId={account.id} currency={account.currency!} balanceMinor={minor} onClosed={(archived) => archived && closedTo()} />
      ) : (
        <ActionButtons actions={actionsFor(account, pockets)} />
      )}

      {/* What is promised out of this account, what is free, and which goals claim it (B3). */}
      <SetAsidePanel accountId={account.id} />

      {pockets ? (
        <PocketList pockets={pockets} held={held} />
      ) : account.subtype === 'time_deposit' ? (
        <>
          {/* A due event of an automated deposit, then the term itself: when it comes back and what it pays. */}
          <DepositProposalCard accountId={account.id} onClosed={(archived) => archived && closedTo()} />
          <DepositTermsCard accountId={account.id} balanceMinor={minor} currency={account.currency!} />
          <MaturitySettings accountId={account.id} currency={account.currency!} />
          <RecordedByHand accountId={account.id} currency={account.currency!} />
        </>
      ) : (
        <AccountChart accountId={account.id} currency={account.currency!} />
      )}

      <Recent accountId={account.id} accountIds={pockets ? pocketIds : [account.id]} />

      <Details
        rows={[
          inst ? <InsetRow key="bank" title="Bank" value={inst} chevron={false} /> : null,
          !pockets ? <InsetRow key="currency" title="Currency" value={`${account.currency} · ${currencyName(account.currency!)}`} chevron={false} /> : null,
          foreign && opened ? <InsetRow key="opened" title="Opened at" value={rateLine(opened.fxRateToBase, account.currency!, ws.baseCurrency)} chevron={false} /> : null,
          // Another currency makes a current or saving account one with pockets; a pocket cannot hold a pocket, and an
          // account that already has them takes one more through the same door, drawn among its actions.
          !parent && !pockets && (account.subtype === 'bank' || account.subtype === 'savings') ? (
            <InsetRow key="pocket" title="Add a currency" to="/accounts/$accountId/pocket" params={{ accountId: account.id }} />
          ) : null,
        ]}
      />
    </div>
  );
}

/**
 * The page's ⋯, and nothing else in its corner: the settings the account has always had, the code it files under
 * with that code as its second line, the rename, and the way out.
 *
 * The gear used to sit beside the ⋯. Settings and the tax code are both things looked up now and then, never on
 * the way to spending, so they wait behind the one corner button with the edits rather than taking a second one.
 *
 * Archiving a parent that still has pockets is refused by the database, and its answer — which pockets are left —
 * is shown where the ask was made, which is why it stays enabled. A pocket is refused here instead, while anything
 * is left in it, and says why on the greyed line: the rule its old page printed under the figure.
 */
function usePageMenu(
  account: AccountRow,
  o: { parent: AccountRow | undefined; empty: boolean; codeLine: string; onError: (error: unknown) => void },
): CornerAction[] {
  const { database, ws } = useApp();
  const invalidate = useInvalidateAll();
  const navigate = useNavigate();
  const blocked = Boolean(o.parent) && !o.empty;
  const items: CornerAction[] = [
    {
      key: 'settings',
      label: 'Settings',
      glyph: <Settings size={18} aria-hidden />,
      to: '/net-worth/assets/$accountId/settings',
      params: { accountId: account.id },
    },
    {
      key: 'tax',
      label: 'Tax report code',
      detail: o.codeLine,
      glyph: <FileText size={18} aria-hidden />,
      to: '/net-worth/assets/$accountId/settings',
      params: { accountId: account.id },
    },
    {
      key: 'edit',
      label: 'Edit',
      glyph: <Pencil size={18} aria-hidden />,
      run: () => {
        const next = window.prompt('Rename account', account.name);
        if (!next || next.trim() === '' || next === account.name) return;
        void (async () => {
          await renameAccount(database, ws, account.id, next);
          await invalidate();
        })();
      },
    },
    {
      key: 'archive',
      label: 'Archive',
      glyph: <Archive size={18} aria-hidden />,
      disabled: blocked,
      detail: blocked ? 'Archiving is available once nothing is left in this account.' : undefined,
      run: () => {
        if (!window.confirm(`Archive ${account.name}? It leaves the list; its history stays in reports.`)) return;
        void (async () => {
          try {
            await archiveAccount(database, ws, account.id);
            await invalidate();
            await navigate(o.parent ? { to: '/accounts/$accountId', params: { accountId: o.parent.id } } : { to: '/accounts' });
          } catch (e) {
            o.onError(e);
          }
        })();
      },
    },
  ];
  return [{ key: 'more', label: 'More', glyph: <MoreHorizontal size={20} aria-hidden />, menu: items }];
}

/**
 * What the account does, by kind. Money that can be spent is spent, received into and moved; an RDN is only topped
 * up from a current account and withdrawn to one, so both open a transfer with the RDN on the side the words say —
 * the pairing rule keeps the other side to current accounts. A deposit's one action is its own (`DepositMoneyOut`).
 *
 * An account with pockets is not itself somewhere money is paid from — each pocket is — so it offers what only the
 * parent can do: move between its pockets, and add another. Spend and Receive live on each pocket's page.
 */
function actionsFor(account: AccountRow, pockets: AccountRow[] | null): RoundAction[] {
  const id = account.id;
  const newTx = (key: string, label: string, glyph: RoundAction['glyph'], search: { mode: 'expense' | 'income' | 'transfer'; account?: string; to?: string }): RoundAction => ({
    key,
    label,
    glyph,
    to: '/transactions/new',
    search,
  });
  if (pockets) {
    return [
      ...(pockets.length >= 2 ? [{ key: 'move', label: 'Move', glyph: <ArrowLeftRight size={20} aria-hidden />, to: '/accounts/$accountId/move' as const, params: { accountId: id } }] : []),
      { key: 'pocket', label: 'Add a currency', glyph: <Plus size={20} aria-hidden />, to: '/accounts/$accountId/pocket', params: { accountId: id } },
    ];
  }
  if (account.subtype === 'fund') {
    return [
      newTx('top-up', 'Top up', <ArrowDownToLine size={20} aria-hidden />, { mode: 'transfer', to: id }),
      newTx('withdraw', 'Withdraw', <ArrowUpFromLine size={20} aria-hidden />, { mode: 'transfer', account: id }),
    ];
  }
  if (!SPENDABLE_SUBTYPES.includes(account.subtype)) return [];
  return [
    newTx('spend', 'Spend', <ArrowUpRight size={20} aria-hidden />, { mode: 'expense', account: id }),
    newTx('receive', 'Receive', <ArrowDownLeft size={20} aria-hidden />, { mode: 'income', account: id }),
    newTx('transfer', 'Transfer', <ArrowLeftRight size={20} aria-hidden />, { mode: 'transfer', account: id }),
  ];
}

/** What a foreign balance comes to here, and the rate that says so: "≈ Rp 39.000.000 at 16.250 IDR per 1 USD". */
function ForeignLine({ currency, minor, rates }: { currency: string; minor: number; rates: { rates: Record<string, number>; stale: string[] } | undefined }) {
  const { ws } = useApp();
  const rate = rates?.rates[currency];
  return (
    <span className="block">
      {approxLine(minor, currency, ws.baseCurrency, rates?.rates ?? {})}
      {rate !== undefined && ` at ${rateLine(rate, currency, ws.baseCurrency)}`}
      {rate !== undefined && rates?.stale.includes(currency) && ' (last known)'}
    </span>
  );
}

/** An account with pockets: what they come to in the base currency, or which rate is missing to add them up. */
function ParentHero({ pockets, typeLabel, inst, held }: { pockets: AccountRow[]; typeLabel: string; inst: string | null; held: Record<string, number> }) {
  const { ws } = useApp();
  const balances = useBalances();
  const total = parentTotal(pockets, balances.data ?? {}, ws.baseCurrency, held);
  const count = new Set(pockets.map((p) => p.currency)).size;
  if (total.totalMinor === null) {
    return <Empty>No {total.missing.join(', ')} rate yet, so the pockets cannot be added up. Each balance below is exact.</Empty>;
  }
  return (
    <Hero
      label="Balance, all pockets"
      minor={total.totalMinor}
      currency={ws.baseCurrency}
      approximate={pockets.some((p) => p.currency !== ws.baseCurrency)}
      caption={[inst, typeLabel, `${count} ${count === 1 ? 'currency' : 'currencies'}`].filter(Boolean).join(' · ')}
    />
  );
}

/** Each pocket in its own currency, with what a foreign one comes to here, opening to the pocket's own page. */
function PocketList({ pockets, held }: { pockets: AccountRow[]; held: Record<string, number> }) {
  const { ws } = useApp();
  const balances = useBalances();
  return (
    <InsetGroup header="Pockets">
      {pockets.map((pocket) => {
        const minor = balances.data?.[pocket.id] ?? 0;
        return (
          <InsetRow
            key={pocket.id}
            testId={`pocket-${pocket.currency}`}
            icon={<span className="text-[17px] leading-none">{currencyFlag(pocket.currency!)}</span>}
            title={pocket.currency}
            subtitle={currencyName(pocket.currency!)}
            value={<ApproxFigure figure={<Money minor={minor} currency={pocket.currency!} />} beneath={approxLine(minor, pocket.currency!, ws.baseCurrency, held)} />}
            valueTone="ink"
            to="/accounts/$accountId"
            params={{ accountId: pocket.id }}
          />
        );
      })}
    </InsetGroup>
  );
}

/** The balance over the year: the chart the asset page drew for a derived value. */
function AccountChart({ accountId, currency }: { accountId: string; currency: string }) {
  const months = lastNMonths(monthOf(isoDate()), 12);
  const history = useMonthEndValues(accountId, months);
  if (!history.data || !history.data.some((point) => point !== 0)) return null;
  return (
    <Panel header="Last 12 months">
      <ValueChart values={history.data} labels={months.map(MONTH_LABEL)} currency={currency} />
    </Panel>
  );
}

/**
 * The last few rows behind the balance, drawn with the list's own row, and the way to the rest of them. A tap opens
 * the receipt, as a tap on the list does on a phone; editing, deleting and re-filing stay on the list and the
 * receipt, which know which workspace a row is filed in.
 */
function Recent({ accountId, accountIds }: { accountId: string; accountIds: string[] }) {
  const navigate = useNavigate();
  const accounts = useAccounts();
  const recent = useRecentTransactions(accountIds);
  const rows = buildRows(recent.data ?? [], [], accounts.data ?? [], []);
  return (
    <Panel
      header="Recent"
      trailing={
        <Link
          to="/transactions"
          search={{ account: accountId }}
          className="ph-focus inline-flex items-center gap-[2px] rounded text-[13px] font-medium tracking-normal text-[var(--ph-tint)] normal-case"
        >
          See all
          <ChevronRight size={14} aria-hidden />
        </Link>
      }
      testId="account-recent"
    >
      <ErrorBox error={recent.error} />
      {recent.isSuccess && rows.length === 0 ? (
        <p className="py-1 text-[15px] leading-[20px] text-[var(--ph-ink-3)]">No transactions yet.</p>
      ) : (
        <ul className="[&>*+*]:border-t-[0.5px] [&>*+*]:border-[var(--ph-hair)]">
          {rows.map((row) => (
            <TransactionRow
              key={row.id}
              row={row}
              accounts={accounts.data ?? []}
              testId="account-recent-row"
              title="Open the receipt"
              onOpen={() => void navigate({ to: '/transactions/$transactionId', params: { transactionId: row.id } })}
            />
          ))}
        </ul>
      )}
    </Panel>
  );
}

/** The plain facts, one to a row. Nothing is drawn when the account has none to say. */
function Details({ rows }: { rows: (ReactElement | null)[] }) {
  const present = rows.filter((row): row is ReactElement => row !== null);
  if (present.length === 0) return null;
  return <InsetGroup header="Details">{present}</InsetGroup>;
}

/** Reached with an account that has no pockets and is not money: say so rather than draw an empty page. */
export function NoPockets({ name }: { name: string }) {
  return (
    <div className={SCREEN}>
      <LargeTitle title={name} back="Accounts" backTo="/accounts" />
      <Empty>This account does not hold more than one currency, so it has no pockets.</Empty>
    </div>
  );
}
