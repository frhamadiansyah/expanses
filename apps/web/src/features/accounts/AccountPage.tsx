import { isoDate } from '@expanses/core';
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
  MoreHorizontal,
  Pencil,
  Plus,
  Repeat,
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
import { DepositMaturityBlock, DepositTermRow } from '../networth/DepositTerms';
import { dayLabel, quantityLabel } from '../networth/asset-page';
import { MaturitySettings } from '../networth/MaturitySettings';
import { RecordedByHand } from '../networth/RecordedByHand';
import { SetAsidePanel } from '../networth/SetAsidePanel';
import { useAssetProfiles, useAssetValues, useDepositAutomation, usePositions } from '../networth/queries';
import { useHoldingLinks, useSecurities } from '../investments/queries';
import { buildRows } from '../transactions/list-model';
import { TransactionRow } from '../transactions/TransactionRow';
import { currencyFlag } from '../transactions/tx-form';
import { BalanceCard } from './BalanceCard';
import { balanceSeries, type DayBalance, pocketsSeries } from './balance-series';
import { currencyName, parentTotal, pocketsOf } from './pockets';
import { LINE_DAYS, useAccountFlows, useHeldRates, useOpenings, useRecentTransactions } from './queries';
import { ShareWithHouseholdRow } from '../sharing/ShareWithHousehold';

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
  const flows = useAccountFlows(pockets || account.subtype === 'time_deposit' ? [] : [account.id]);
  const held = rates.data?.rates ?? {};
  const minor = balances.data?.[account.id] ?? 0;

  const profileOf = (id: string | undefined) => (profiles.data ?? []).find((row) => row.accountId === id);
  // The bank is kept as the tax report's "institution"; an account with pockets keeps it on each pocket.
  const inst = (profileOf(account.id) ?? profileOf(pockets?.[0]?.id))?.coretaxFields.inst?.trim() || null;
  const typeLabel = SUBTYPE_LABELS[account.subtype];
  const foreign = !pockets && account.currency !== ws.baseCurrency;
  const opened = openings.data?.[account.id];
  const deposit = account.subtype === 'time_deposit' && !pockets;
  const automation = useDepositAutomation(deposit ? account.id : '');
  // When the money went in: the current term's start, or the balance's own first day.
  const placedOn = automation.data?.termStartedOn ?? opened?.occurredOn ?? null;
  // The month behind the balance, ending on it: walked back from today through what moved.
  const series = flows.data && balances.isSuccess ? balanceSeries({ todayMinor: minor, today: isoDate(), days: LINE_DAYS, flows: flows.data }) : null;

  const title = parent ? `${parent.name} · ${account.currency}` : account.name;
  const menu = usePageMenu(account, { parent, empty: minor === 0, onError: setActionError });
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

      {deposit ? (
        <>
          {/* A deposit's card has no month's line — its balance only moves on the day it pays — but its maturity. */}
          <BalanceCard
            label="Balance"
            minor={minor}
            currency={account.currency!}
            series={null}
            testId="deposit-card"
            caption={
              <>
                <span className="block">{[inst, typeLabel, account.currency].filter(Boolean).join(' · ')}</span>
                {foreign && <ForeignLine currency={account.currency!} minor={minor} rates={rates.data} />}
              </>
            }
          >
            <DepositMaturityBlock accountId={account.id} balanceMinor={minor} currency={account.currency!} />
          </BalanceCard>
          {/* A due event of an automated deposit, directly under what it is about. */}
          <DepositProposalCard accountId={account.id} onClosed={(archived) => archived && closedTo()} />
        </>
      ) : pockets ? (
        <ParentCard pockets={pockets} typeLabel={typeLabel} inst={inst} held={held} />
      ) : (
        <BalanceCard
          label="Balance"
          minor={minor}
          currency={account.currency!}
          series={series}
          testId="balance-card"
          caption={
            <>
              <span className="block">
                {/* A broker's cash is read by the bank it sits at: the broker is already the page's name. */}
                {account.subtype === 'fund' && inst ? `RDN at ${inst} · ${account.currency}` : [inst, typeLabel, account.currency].filter(Boolean).join(' · ')}
              </span>
              {foreign && <ForeignLine currency={account.currency!} minor={minor} rates={rates.data} />}
            </>
          }
        />
      )}

      {deposit ? (
        <DepositMoneyOut look="action" accountId={account.id} currency={account.currency!} balanceMinor={minor} onClosed={(archived) => archived && closedTo()} />
      ) : (
        <ActionButtons actions={actionsFor(account, pockets, ws.baseCurrency)} />
      )}

      {/* What is promised out of this account, what is free, and which goals claim it (B3). */}
      <SetAsidePanel accountId={account.id} />

      {pockets ? (
        <PocketList parentId={account.id} pockets={pockets} held={held} />
      ) : deposit ? (
        <MaturitySettings accountId={account.id} currency={account.currency!} />
      ) : account.subtype === 'fund' ? (
        <HeldAtBroker brokerAccountId={account.id} />
      ) : null}

      <Recent accountId={account.id} accountIds={pockets ? pocketIds : [account.id]} />

      <Details
        rows={[
          account.subtype === 'fund' ? <InsetRow key="broker" title="Broker" value={account.name} chevron={false} /> : null,
          inst ? <InsetRow key="bank" title={account.subtype === 'fund' ? 'RDN bank' : 'Bank'} value={inst} chevron={false} /> : null,
          deposit ? <DepositTermRow key="term" accountId={account.id} /> : null,
          deposit && placedOn ? <InsetRow key="placed" title="Placed on" value={dayLabel(placedOn)} chevron={false} /> : null,
          !pockets ? <InsetRow key="currency" title="Currency" value={`${account.currency} · ${currencyName(account.currency!)}`} chevron={false} /> : null,
          foreign && opened ? <InsetRow key="opened" title="Opened at" value={rateLine(opened.fxRateToBase, account.currency!, ws.baseCurrency)} chevron={false} /> : null,
          // Another currency makes a current or saving account one with pockets; a pocket cannot hold a pocket, and an
          // account that already has them takes one more through the same door, drawn among its actions.
          !parent && !pockets && (account.subtype === 'bank' || account.subtype === 'savings') ? (
            <InsetRow key="pocket" title="Add a currency" to="/accounts/$accountId/pocket" params={{ accountId: account.id }} />
          ) : null,
        ]}
      />
      {/* Joint net worth (§8.1): what the household sees of it, under the facts. Nothing while this person is in no group. */}
      <ShareWithHouseholdRow accountId={account.id} />
      {/* An interest payment recorded by hand can be put back as a proposal: rare, so after everything else. */}
      {deposit && <RecordedByHand accountId={account.id} currency={account.currency!} />}
    </div>
  );
}

/**
 * The page's ⋯, and nothing else in its corner: the settings the account has always had, the rename, and the way out.
 *
 * The gear used to sit beside the ⋯. Settings are looked up now and then, never on the way to spending, so they wait
 * behind the one corner button with the edits rather than taking a second one. The code the account files under is
 * one of those settings, and is shown and changed there only — it once had an item of its own here as well.
 *
 * Archiving a parent that still has pockets is refused by the database, and its answer — which pockets are left —
 * is shown where the ask was made, which is why it stays enabled. A pocket is refused here instead, while anything
 * is left in it, and says why on the greyed line: the rule its old page printed under the figure.
 */
function usePageMenu(
  account: AccountRow,
  o: { parent: AccountRow | undefined; empty: boolean; onError: (error: unknown) => void },
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
 * An account with pockets is not itself somewhere money is paid from — each pocket is — so its Spend, Receive and
 * Transfer open with one of its pockets chosen, and it adds what only the parent can do: move between its pockets.
 * Adding another currency is the last row of its Pockets list.
 */
function actionsFor(account: AccountRow, pockets: AccountRow[] | null, baseCurrency: string): RoundAction[] {
  const id = account.id;
  const newTx = (key: string, label: string, glyph: RoundAction['glyph'], search: { mode: 'expense' | 'income' | 'transfer'; account?: string; to?: string }): RoundAction => ({
    key,
    label,
    glyph,
    to: '/transactions/new',
    search,
  });
  if (pockets) {
    // Spent, received and moved from a pocket: the one in the workspace's own currency, or the first — the form's
    // Paid with, Received into and From still switch to any other.
    const pocket = (pockets.find((p) => p.currency === baseCurrency) ?? pockets[0])?.id;
    return [
      ...(pocket
        ? [
            newTx('spend', 'Spend', <ArrowUpRight size={20} aria-hidden />, { mode: 'expense', account: pocket }),
            newTx('receive', 'Receive', <ArrowDownLeft size={20} aria-hidden />, { mode: 'income', account: pocket }),
            newTx('transfer', 'Transfer', <ArrowLeftRight size={20} aria-hidden />, { mode: 'transfer', account: pocket }),
          ]
        : []),
      ...(pockets.length >= 2 ? [{ key: 'move', label: 'Move', glyph: <Repeat size={20} aria-hidden />, to: '/accounts/$accountId/move' as const, params: { accountId: id } }] : []),
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

/**
 * An account with pockets: what they come to in the base currency with the month behind it, or which rate is missing
 * to add them up. The line is each pocket's own balance, added up at today's rates, as the figure is.
 */
function ParentCard({ pockets, typeLabel, inst, held }: { pockets: AccountRow[]; typeLabel: string; inst: string | null; held: Record<string, number> }) {
  const { ws } = useApp();
  const balances = useBalances();
  const flows = useAccountFlows(pockets.map((p) => p.id));
  const total = parentTotal(pockets, balances.data ?? {}, ws.baseCurrency, held);
  const count = new Set(pockets.map((p) => p.currency)).size;
  if (total.totalMinor === null) {
    return <Empty>No {total.missing.join(', ')} rate yet, so the pockets cannot be added up. Each balance below is exact.</Empty>;
  }
  const series: DayBalance[] | null =
    flows.data && balances.isSuccess
      ? pocketsSeries(
          pockets.map((pocket) => ({
            currency: pocket.currency!,
            series: balanceSeries({
              todayMinor: balances.data?.[pocket.id] ?? 0,
              today: isoDate(),
              days: LINE_DAYS,
              flows: flows.data.filter((flow) => flow.accountId === pocket.id),
            }),
          })),
          ws.baseCurrency,
          held,
        )
      : null;
  return (
    <BalanceCard
      label="Balance, all pockets"
      minor={total.totalMinor}
      currency={ws.baseCurrency}
      approximate={pockets.some((p) => p.currency !== ws.baseCurrency)}
      series={series}
      testId="balance-card"
      caption={[inst, typeLabel, `${count} ${count === 1 ? 'currency' : 'currencies'}`].filter(Boolean).join(' · ')}
    />
  );
}

/**
 * Each pocket in its own currency, with what a foreign one comes to here, opening to the pocket's own page: its flag,
 * its code, and the amount. The currency's name is not repeated under the code the flag already says.
 */
function PocketList({ parentId, pockets, held }: { parentId: string; pockets: AccountRow[]; held: Record<string, number> }) {
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
            value={<ApproxFigure figure={<Money minor={minor} currency={pocket.currency!} />} beneath={approxLine(minor, pocket.currency!, ws.baseCurrency, held)} />}
            valueTone="ink"
            to="/accounts/$accountId"
            params={{ accountId: pocket.id }}
          />
        );
      })}
      <InsetRow
        key="add"
        testId="pocket-add"
        icon={<Plus size={16} aria-hidden />}
        title="Add a currency"
        to="/accounts/$accountId/pocket"
        params={{ accountId: parentId }}
      />
    </InsetGroup>
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

/**
 * What this broker keeps: every holding whose Kept at names this fund account, with how much of it and what it is
 * worth, each opening its own page. Nothing is drawn while it keeps nothing.
 */
function HeldAtBroker({ brokerAccountId }: { brokerAccountId: string }) {
  const links = useHoldingLinks();
  const securities = useSecurities();
  const values = useAssetValues();
  const profiles = useAssetProfiles();
  const positions = usePositions();
  const held = (links.data ?? []).filter((link) => link.brokerAccountId === brokerAccountId);
  const rows = held.flatMap((link) => {
    const value = (values.data ?? []).find((row) => row.accountId === link.accountId);
    if (!value) return [];
    const security = (securities.data ?? []).find((row) => row.id === link.securityId);
    const profile = (profiles.data ?? []).find((row) => row.accountId === link.accountId);
    const units = positions.data?.[link.accountId]?.unitsMicro ?? 0;
    return [{ id: link.accountId, title: security?.ticker || security?.name || value.name, units, unitKind: profile?.unitKind ?? null, lotSize: security?.lotSize ?? profile?.lotSize ?? null, value }];
  });
  if (rows.length === 0) return null;
  return (
    <InsetGroup header="Held at this broker">
      {rows.map((row) => (
        <InsetRow
          key={row.id}
          testId="broker-holding"
          title={row.title}
          subtitle={row.units > 0 ? quantityLabel(row.units, row.unitKind, row.lotSize) : 'Sold'}
          value={<Money minor={row.value.valueMinor} currency={row.value.currency} />}
          valueTone="ink"
          to="/net-worth/assets/$accountId"
          params={{ accountId: row.id }}
        />
      ))}
    </InsetGroup>
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
