import { cashCodeForSubtype, CASH_ITEMS, hartaLabel, isoDate, lastNMonths, monthOf } from '@expanses/core';
import { type AccountRow, pocketParentIds, renameAccount, SPENDABLE_SUBTYPES } from '@expanses/db';
import { useParams, useNavigate } from '@tanstack/react-router';
import { Pencil, Settings } from 'lucide-react';
import { useApp } from '../../app/context';
import { SUBTYPE_LABELS } from '../../lib/account-types';
import { useAccounts, useBalances, useInvalidateAll } from '../../lib/queries';
import { Empty, ErrorBox, Money } from '../../ui';
import { ApproxFigure, approxLine, type CornerAction, Hero, InsetGroup, InsetRow, LargeTitle, Panel, rateLine, SCREEN } from '../../ui/native';
import { DepositProposalCard } from '../networth/DepositProposalCard';
import { DepositTermsCard } from '../networth/DepositTermsCard';
import { MaturitySettings } from '../networth/MaturitySettings';
import { RecordedByHand } from '../networth/RecordedByHand';
import { SetAsidePanel } from '../networth/SetAsidePanel';
import { ValueChart } from '../networth/ValueChart';
import { useAssetProfiles, useMonthEndValues } from '../networth/queries';
import { currencyName, parentTotal, pocketCount, pocketsOf } from './pockets';
import { useHeldRates, useOpenings } from './queries';

/** The kinds of money account, so an account's own page can say what it is and which code it files under. */
const CASH_SUBTYPES = new Set<string>(CASH_ITEMS.map((item) => item.id));

const MONTH_LABEL = (month: string) => new Date(`${month}-01T00:00:00`).toLocaleDateString('en-GB', { month: 'short' });

/**
 * The page's corners: what the account files under, and its name.
 *
 * The gear is the asset settings the account already had — the tax section, the plan group, the reportable flag —
 * kept here as well as on the row that names the code, because an account page is where someone looks for it.
 */
function usePageActions(account: AccountRow): CornerAction[] {
  const { database, ws } = useApp();
  const invalidate = useInvalidateAll();
  return [
    {
      key: 'settings',
      label: 'Settings',
      glyph: <Settings size={22} aria-hidden />,
      to: '/net-worth/assets/$accountId/settings',
      params: { accountId: account.id },
    },
    {
      key: 'edit',
      label: 'Edit',
      glyph: <Pencil size={20} aria-hidden />,
      run: () => {
        const next = window.prompt('Rename account', account.name);
        if (!next || next.trim() === '' || next === account.name) return;
        void (async () => {
          await renameAccount(database, ws, account.id, next);
          await invalidate();
        })();
      },
    },
  ];
}

/**
 * What the account's own money says in a currency that is not the workspace's: what it comes to here, the rate
 * that was used, and what it was opened at. The asset page said it for a derived value; the account page says it
 * for the account.
 */
function ForeignLine({ account, minor }: { account: AccountRow; minor: number }) {
  const { ws } = useApp();
  const foreign = account.currency !== ws.baseCurrency;
  const held = useHeldRates(foreign ? [account.currency!] : []);
  const openings = useOpenings(foreign ? [account.id] : []);
  if (!foreign) return null;
  const rate = held.data?.rates[account.currency!];
  const opened = openings.data?.[account.id];
  return (
    <>
      <span className="block">
        {approxLine(minor, account.currency!, ws.baseCurrency, held.data?.rates ?? {})}
        {rate !== undefined && ` · at ${rateLine(rate, account.currency!, ws.baseCurrency)}`}
        {rate !== undefined && held.data?.stale.includes(account.currency!) && ' (known last)'}
      </span>
      {opened && <span className="block">Opened at {rateLine(opened.fxRateToBase, account.currency!, ws.baseCurrency)}</span>}
    </>
  );
}

/** The balance over the year, on the account's own page: the same chart the asset page drew for a derived value. */
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

/** An account with pockets: what it adds up to, each pocket in its own currency, and the ways to move or add one. */
export function PocketsPage() {
  const { ws } = useApp();
  const { accountId = '' } = useParams({ strict: false }) as { accountId?: string };
  const accounts = useAccounts();
  const balances = useBalances();
  const all = accounts.data ?? [];
  const parent = all.find((a) => a.id === accountId);
  const pockets = pocketsOf(accountId, all);
  const rates = useHeldRates(pockets.map((p) => p.currency!));
  const openings = useOpenings(pockets.map((p) => p.id));
  const held = rates.data?.rates ?? {};
  const stale = new Set(rates.data?.stale ?? []);

  if (accounts.isSuccess && !parent) return <div className={SCREEN}><LargeTitle title="Account" back="Accounts" backTo="/accounts" /><Empty>That account is not in this workspace.</Empty></div>;
  if (!parent) return <div className={SCREEN}>Loading…</div>;
  // Any account id reaches this route; an account with pockets shows them, one without gets its own page.
  if (!pocketParentIds(all).has(parent.id)) return <AccountPage account={parent} />;

  const total = parentTotal(pockets, balances.data ?? {}, ws.baseCurrency, held);
  const foreign = pockets.filter((p) => p.currency !== ws.baseCurrency && held[p.currency!] !== undefined);
  const spendable = SPENDABLE_SUBTYPES.includes(parent.subtype);
  const actions = usePageActions(parent);

  return (
    <div className={SCREEN}>
      <LargeTitle title={parent.name} back="Accounts" backTo="/accounts" actions={actions} />
      <ErrorBox error={accounts.error ?? balances.error ?? rates.error} />
      {total.totalMinor !== null ? (
        <Hero
          label="In the account"
          minor={total.totalMinor}
          currency={ws.baseCurrency}
          caption={
            <>
              {foreign.length > 0 && `≈ at ${foreign.map((p) => `${rateLine(held[p.currency!]!, p.currency!, ws.baseCurrency)}${stale.has(p.currency!) ? ' (last known)' : ''}`).join(' · ')}`}
              <span className="mt-[2px] block">
                {pocketCount(pockets.length)} · {spendable ? 'can be spent from' : 'cannot be spent from directly'}
              </span>
            </>
          }
        />
      ) : (
        <Empty>No {total.missing.join(', ')} rate yet, so the pockets cannot be added up. Each balance below is exact.</Empty>
      )}
      {/* What is promised out of this account, what is free, and which goals claim it (B3). */}
      <SetAsidePanel accountId={parent.id} />
      <AccountChart accountId={parent.id} currency={ws.baseCurrency} />
      <InsetGroup header="Pockets" footer="Each pocket keeps its own balance in its own currency. The account only adds them up.">
        {pockets.map((pocket) => {
          const minor = balances.data?.[pocket.id] ?? 0;
          const beneath = approxLine(minor, pocket.currency!, ws.baseCurrency, held);
          const opened = openings.data?.[pocket.id];
          return (
            <InsetRow
              key={pocket.id}
              testId={`pocket-${pocket.currency}`}
              title={currencyName(pocket.currency!)}
              subtitle={opened ? `Opened ${opened.occurredOn}` : undefined}
              value={<ApproxFigure figure={<Money minor={minor} currency={pocket.currency!} />} beneath={beneath} />}
              valueTone="ink"
              to="/net-worth/assets/$accountId"
              params={{ accountId: pocket.id }}
            />
          );
        })}
      </InsetGroup>
      <InsetGroup>
        {pockets.length >= 2 && <InsetRow title="Move between pockets" subtitle="At the bank's rate" to="/accounts/$accountId/move" params={{ accountId }} />}
        <InsetRow title="Add a pocket" subtitle="Another currency this account holds" to="/accounts/$accountId/pocket" params={{ accountId }} />
        <InsetRow title="See their transactions" to="/transactions" search={{ account: accountId }} />
      </InsetGroup>
    </div>
  );
}

/**
 * An account that holds one currency: what is in it, what is set aside and free, what is promised to, the rows
 * behind the balance, and the code it files under.
 *
 * It used to say only that the account has no pockets, which is true and useless. The whole story of a money
 * account belongs on the account's own page — the balance, the promises against it and the way to its ledger —
 * and the tax code, taken off the Accounts list, lives here too, one tap from the figure it belongs to.
 */
function AccountPage({ account }: { account: AccountRow }) {
  const navigate = useNavigate();
  const balances = useBalances();
  const profiles = useAssetProfiles();
  const actions = usePageActions(account);
  const minor = balances.data?.[account.id] ?? 0;
  const chosen = (profiles.data ?? []).find((row) => row.accountId === account.id)?.coretaxCode;
  const code = chosen ?? (CASH_SUBTYPES.has(account.subtype) ? cashCodeForSubtype(account.subtype) : null);
  const label = code ? hartaLabel(code) : null;

  return (
    <div className={SCREEN}>
      <LargeTitle title={account.name} back="Accounts" backTo="/accounts" actions={actions} />
      <ErrorBox error={balances.error ?? profiles.error} />
      <Hero
        label="In the account"
        minor={minor}
        currency={account.currency!}
        caption={
          <>
            <ForeignLine account={account} minor={minor} />
            <span className="mt-[2px] block">
              {SUBTYPE_LABELS[account.subtype]} · {account.currency}
            </span>
          </>
        }
      />
      {/* What is promised out of this account, what is free, and which goals claim it (B3). */}
      <SetAsidePanel accountId={account.id} />
      {/* A deposit's own facts, for a deposit: the day it comes back, what it pays, and what it does then. */}
      {account.subtype === 'time_deposit' && (
        <>
          {/* A deposit that has matured and been filed away goes back to the list its row lives in, as the asset
           * page did before it: the account it was is gone, so there is nothing left to stay on. */}
          <DepositProposalCard accountId={account.id} onClosed={(archived) => archived && void navigate({ to: '/net-worth/assets' })} />
          <MaturitySettings accountId={account.id} currency={account.currency!} />
          <DepositTermsCard accountId={account.id} />
          <RecordedByHand accountId={account.id} currency={account.currency!} />
        </>
      )}
      <AccountChart accountId={account.id} currency={account.currency!} />
      <InsetGroup>
        <InsetRow title="Its transactions" subtitle="The rows behind this balance, in the ledger." to="/transactions" search={{ account: account.id }} />
        <InsetRow title="Add a pocket" subtitle="Another currency this account holds" to="/accounts/$accountId/pocket" params={{ accountId: account.id }} />
      </InsetGroup>
      <InsetGroup header="For the tax report" footer="What this account files under, and where to change it.">
        <InsetRow
          title="Tax report code"
          subtitle={label ? `${code} · ${label}` : 'Not set yet'}
          to="/net-worth/assets/$accountId/settings"
          params={{ accountId: account.id }}
        />
      </InsetGroup>
    </div>
  );
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
