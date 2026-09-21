import { CASH_ITEMS, cashCodeForSubtype, CURRENCIES, displayAmount, hartaLabel, isoDate, type MoneyAccountSubtype, parseMajor } from '@expanses/core';
import { type AccountRow, type AccountSubtype, archiveAccount, createAccount, createCardAccount, openCashAccount, pocketParentIds, renameAccount } from '@expanses/db';
import { Link } from '@tanstack/react-router';
import { Plus } from 'lucide-react';
import { type FormEvent, useRef, useState } from 'react';
import { useApp } from '../../app/context';
import { ACCOUNT_TYPES, SUBTYPE_LABELS } from '../../lib/account-types';
import { isMoneyAccount, useAccounts, useBalances, useInvalidateAll, useResolveRates } from '../../lib/queries';
import { issuerChoices, useWorkspaceIssuers } from '../cards/card-queries';
import { depositLine } from '../networth/deposit-terms';
import { useAssetProfiles, useAssetValues, useDepositTerms } from '../networth/queries';
import { openingRateFor, ratePreview } from '../../lib/rates';
import { Empty, ErrorBox, errorMessage, Money } from '../../ui';
import { type CornerAction, Figure, groupedFigure, InsetGroup, InsetRow, LargeTitle, RecordTable, SCREEN, SelectRow, TextRow } from '../../ui/native';
import { parentTotal, pocketsOf } from './pockets';
import { useHeldRates } from './queries';

/** Sentinel for a bank the catalogue has never heard of. */
const OTHER = '__other';

/** The seven kinds of account that hold money, as the catalogue names them. Their `id` is the ledger's subtype. */
const CASH_SUBTYPES = new Set<string>(CASH_ITEMS.map((item) => item.id));
const isCashSubtype = (subtype: AccountSubtype): subtype is MoneyAccountSubtype => CASH_SUBTYPES.has(subtype);

function AddAccountForm() {
  const { database, ws } = useApp();
  const invalidate = useInvalidateAll();
  const resolveRates = useResolveRates();
  const [name, setName] = useState('');
  const [issuer, setIssuer] = useState('');
  const [otherIssuer, setOtherIssuer] = useState('');
  const [last4, setLast4] = useState('');
  const [subtype, setSubtype] = useState<AccountSubtype>('bank');
  const [currency, setCurrency] = useState(ws.baseCurrency);
  const [balance, setBalance] = useState('');
  const [maturesOn, setMaturesOn] = useState('');
  const [openedOn, setOpenedOn] = useState(isoDate());
  const [manualRate, setManualRate] = useState('');
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const form = useRef<HTMLFormElement>(null);

  const kind = ACCOUNT_TYPES.find((t) => t.subtype === subtype)!.kind;
  const foreign = currency !== ws.baseCurrency;
  // A card is the one account that comes from a bank as a named product. Cash and property do not.
  const isCard = subtype === 'credit_card';
  // A deposit is the one kind of money account with terms of its own, and the day it comes back is not guessable.
  const isDeposit = subtype === 'time_deposit';
  const banks = issuerChoices(useWorkspaceIssuers().data ?? []);
  const chosenIssuer = issuer === OTHER ? otherIssuer : issuer;

  async function submit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const openingBalanceMinor = balance.trim() ? parseMajor(balance, currency) : 0;
      const openingRateToBase = await openingRateFor({ database, ws, currency, openedOn, openingBalanceMinor, typed: manualRate, resolveRates });
      if (isCard) {
        await createCardAccount(database, ws, { name, subtype: 'credit_card', currency, issuer: chosenIssuer, last4, openingBalanceMinor, openedOn, openingRateToBase });
      } else if (isCashSubtype(subtype)) {
        // Money opened here files under the same code the picker would have given it, and a deposit keeps its terms.
        await openCashAccount(database, ws, { item: subtype, name, currency, openingBalanceMinor, openedOn, openingRateToBase, maturesOn: maturesOn || undefined });
      } else {
        await createAccount(database, ws, { name, kind, subtype, currency, openingBalanceMinor, openedOn, openingRateToBase });
      }
      setName('');
      setIssuer('');
      setOtherIssuer('');
      setLast4('');
      setBalance('');
      setMaturesOn('');
      setManualRate('');
      await invalidate();
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  }

  return (
    <form ref={form} onSubmit={submit}>
      <InsetGroup header="Add an account here" footer="The picker at Add account asks the same questions one at a time, and files it under the right tax code.">
        <TextRow label="Name" value={name} onChange={(e) => setName(e.target.value)} placeholder="BCA Visa Platinum" required />
        {/* The money accounts first, named as the catalogue names them, then everything else this form can open. */}
        <SelectRow label="Type" value={subtype} onChange={(e) => setSubtype(e.target.value as AccountSubtype)}>
          {CASH_ITEMS.map((item) => (
            <option key={item.id} value={item.id}>
              {item.label}
            </option>
          ))}
          {ACCOUNT_TYPES.filter((t) => !isCashSubtype(t.subtype)).map((t) => (
            <option key={t.subtype} value={t.subtype}>
              {SUBTYPE_LABELS[t.subtype]}
            </option>
          ))}
        </SelectRow>
        {isCard && (
          <SelectRow label="Bank" hint="Optional. Applying a catalogue entry fills this in." value={issuer} onChange={(e) => setIssuer(e.target.value)}>
            <option value="">Not saying</option>
            {banks.map((bank) => (
              <option key={bank} value={bank}>
                {bank}
              </option>
            ))}
            <option value={OTHER}>Other…</option>
          </SelectRow>
        )}
        {isCard && issuer === OTHER && <TextRow label="Bank name" value={otherIssuer} onChange={(e) => setOtherIssuer(e.target.value)} placeholder="Bank Mega" />}
        {isCard && (
          <TextRow
            label="Last 4 digits"
            hint="Optional. Tells two cards on one statement apart."
            value={last4}
            onChange={(e) => setLast4(e.target.value)}
            inputMode="numeric"
            maxLength={4}
            placeholder="1467"
          />
        )}
        <SelectRow label="Currency" value={currency} onChange={(e) => setCurrency(e.target.value)}>
          {CURRENCIES.map((c) => (
            <option key={c.code} value={c.code}>
              {c.code} — {c.name}
            </option>
          ))}
        </SelectRow>
        <TextRow
          label={kind === 'liability' ? 'Amount owed now' : 'Current balance'}
          hint="Optional. Posted as an opening balance."
          value={balance}
          onChange={(e) => setBalance(e.target.value)}
          inputMode="decimal"
          placeholder="0"
        />
        {isDeposit && (
          <TextRow
            label="Matures on"
            hint="The day the money comes back. Move it out with a transfer when it does."
            type="date"
            value={maturesOn}
            onChange={(e) => setMaturesOn(e.target.value)}
            required
          />
        )}
        <TextRow label="Balance as of" type="date" value={openedOn} onChange={(e) => setOpenedOn(e.target.value)} />
        {foreign && (
          <TextRow
            label={`Rate: ${ws.baseCurrency} per 1 ${currency}`}
            hint={ratePreview(manualRate, currency, ws.baseCurrency) ?? 'Leave empty to fetch the daily rate.'}
            value={manualRate}
            onChange={(e) => setManualRate(e.target.value)}
            inputMode="decimal"
          />
        )}
      </InsetGroup>
      <ErrorBox error={error} />
      <InsetGroup>
        {/* `requestSubmit` rather than calling `submit` straight: the browser still checks `required` first. */}
        <InsetRow title="Add account" chevron={false} onClick={() => !busy && form.current?.requestSubmit()} className={busy ? 'opacity-40' : undefined} />
      </InsetGroup>
    </form>
  );
}

/**
 * One section of the account list.
 *
 * It is `RecordTable` with `detail` saying `none`, and deliberately so. An account row carries four targets — its name,
 * the tax code it files under, Rename and Archive — and there is no account detail screen for the last two to
 * move to. Collapsing to one line would take Rename and Archive off the phone altogether, so the ruling applies:
 * losing a column is worse than scrolling one. Desktop keeps all five columns; a phone scrolls the table
 * sideways inside its own container, which is what stops the name from wrapping into the balance the way it did.
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
    parents.has(account.id) ? `${SUBTYPE_LABELS[account.subtype]} · ${pocketsOf(account.id, everything).length} pockets` : `${SUBTYPE_LABELS[account.subtype]} · ${account.currency}`;
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

  const action = 'ph-focus rounded px-[6px] py-[4px] text-[13px] leading-[17px] text-[var(--ph-tint)]';

  return (
    <RecordTable
      header={title}
      records={accounts}
      detail={{ kind: 'none' }}
      shape={{
        key: (account) => account.id,
        title: (account) => account.name,
        subtitle: (account) => kindLine(account),
        value: (account) =>
          parents.has(account.id) ? (
            parentFigure(account)
          ) : (
          <Figure>
            <Money minor={displayAmount(account.kind, balances[account.id] ?? 0)} currency={account.currency!} />
          </Figure>
          ),
      }}
      columns={[
        {
          key: 'name',
          heading: 'Account',
          cell: (account) => (
            <span className="block min-w-[10rem]">
              {parents.has(account.id) ? (
                /* An account with pockets opens to its pockets; each pocket's history is one tap further. */
                <Link to="/accounts/$accountId" params={{ accountId: account.id }} className="ph-focus block text-[15px] leading-[20px] font-medium text-[var(--ph-ink)]">
                  {account.name}
                </Link>
              ) : (
                <Link to="/transactions" search={{ account: account.id }} className="ph-focus block text-[15px] leading-[20px] font-medium text-[var(--ph-ink)]">
                  {account.name}
                </Link>
              )}
              <span className="block text-[12.5px] leading-[16px] text-[var(--ph-ink-3)]">
                {kindLine(account)}
                {!parents.has(account.id) && terms(account.id) && ` · ${terms(account.id)}`}
              </span>
            </span>
          ),
        },
        {
          key: 'filed',
          heading: 'Filed as',
          cell: (account) =>
            parents.has(account.id) ? (
              <span className="text-[12.5px] leading-[16px] text-[var(--ph-ink-3)]">Each pocket files its own row</span>
            ) : filedAs(account) ? (
              /* The code is never shown while choosing; here it is, and this is where it can be changed. */
              <Link to="/net-worth/assets/$accountId" params={{ accountId: account.id }} className="ph-focus text-[12.5px] leading-[16px] text-[var(--ph-tint)]">
                {filedAs(account)}
              </Link>
            ) : (
              <span className="text-[var(--ph-ink-3)]">—</span>
            ),
        },
        {
          key: 'balance',
          heading: 'Balance',
          numeric: true,
          cell: (account) =>
            parents.has(account.id) ? (
              parentFigure(account)
            ) : valued(account.id) ? (
              <Link to="/net-worth/assets/$accountId" params={{ accountId: account.id }} className="ph-focus block text-right">
                <Money minor={valued(account.id)!.valueMinor} currency={account.currency!} className="tabular block font-medium text-[var(--ph-ink)]" />
                <span className="text-[12.5px] leading-[16px] text-[var(--ph-ink-3)]">
                  cost <Money minor={valued(account.id)!.costMinor} currency={account.currency!} />
                </span>
              </Link>
            ) : (
              <Figure>
                <Money minor={displayAmount(account.kind, balances[account.id] ?? 0)} currency={account.currency!} />
              </Figure>
            ),
        },
        {
          key: 'points',
          heading: '',
          cell: (account) =>
            account.subtype === 'credit_card' ? (
              <Link to="/cards/$cardId" params={{ cardId: account.id }} className={`${action} whitespace-nowrap`}>
                Set up points
              </Link>
            ) : null,
        },
        {
          key: 'actions',
          heading: '',
          cell: (account) => (
            <span className="flex items-center justify-end gap-[2px] whitespace-nowrap">
              <button type="button" className={action} onClick={() => void rename(account)} aria-label={`Rename ${account.name}`}>
                Rename
              </button>
              <button type="button" className={action} onClick={() => void archive(account)} aria-label={`Archive ${account.name}`}>
                Archive
              </button>
            </span>
          ),
        },
      ]}
    />
  );
}

export function AccountsPage() {
  const accounts = useAccounts();
  const balances = useBalances();
  const everything = accounts.data ?? [];
  const money = everything.filter(isMoneyAccount);
  const all = balances.data ?? {};
  const parents = pocketParentIds(everything);
  const pocketCurrencies = everything.filter((a) => a.parentId && a.kind === 'asset' && a.archivedAt === null).map((a) => a.currency!);
  const rates = useHeldRates(pocketCurrencies);
  const held = rates.data?.rates ?? {};
  /* Three journeys, two corners: the `…` keeps Import CSV and Backup reachable and named in words. */
  const actions: CornerAction[] = [
    { key: 'new', label: 'Add account', to: '/accounts/new', glyph: <Plus size={20} aria-hidden /> },
    { key: 'import', label: 'Import CSV', to: '/import' },
    { key: 'backup', label: 'Backup', to: '/backup' },
  ];
  return (
    <div className={SCREEN}>
      <LargeTitle title="Accounts" actions={actions} />
      {accounts.isSuccess && money.length === 0 && <Empty>No accounts yet. Add a bank account or credit card below.</Empty>}
      {/* A pocket is never a row of its own: its account's row adds it up (P1). */}
      <AccountList title="Money" accounts={money.filter((a) => a.kind === 'asset' && a.parentId === null)} balances={all} everything={everything} parents={parents} rates={held} />
      <AccountList title="Credit cards & debts" accounts={money.filter((a) => a.kind === 'liability')} balances={all} everything={everything} parents={parents} rates={held} />
      {/* Below the list it belongs to, not above it: the page is what you have, then the way to add to it. */}
      <AddAccountForm />
    </div>
  );
}
