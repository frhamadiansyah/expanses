import { CURRENCIES, isoDate } from '@expanses/core';
import { addPocket, makeMultiCurrency, pocketParentIds } from '@expanses/db';
import { useNavigate, useParams } from '@tanstack/react-router';
import { type FormEvent, type RefObject, useEffect, useRef, useState } from 'react';
import { useApp } from '../../app/context';
import { useAccounts, useInvalidateAll, useResolveRates } from '../../lib/queries';
import { openingRateFor, ratePreview } from '../../lib/rates';
import { Empty, ErrorBox } from '../../ui';
import { InsetGroup, InsetRow, LargeTitle, SCREEN, SelectRow, TextRow } from '../../ui/native';
import { pocketsOf, readPockets } from './pockets';

export function AddPocketPage() {
  const navigate = useNavigate();
  const { accountId = '' } = useParams({ strict: false }) as { accountId?: string };
  const loaded = useAccounts();
  const parent = (loaded.data ?? []).find((a) => a.id === accountId);
  const form = useRef<HTMLFormElement>(null);
  return (
    <div className={SCREEN}>
      <LargeTitle title="Add a currency" back={parent?.name ?? 'Account'} backTo="/accounts/$accountId" backParams={{ accountId }} />
      <AddCurrencyForm
        accountId={accountId}
        formRef={form}
        onAdded={(landing) => void navigate({ to: '/accounts/$accountId', params: { accountId: landing } })}
      />
      <InsetGroup>
        <InsetRow title="Add pocket" chevron={false} onClick={() => form.current?.requestSubmit()} />
      </InsetGroup>
    </div>
  );
}

/**
 * A second (or next) currency for an account: on its own page, or as a sheet over the account where the header's ✓
 * submits it by `formId`. `onAdded` is handed the account to land on — this one, or the parent a plain current or
 * saving account now sits under.
 */
export function AddCurrencyForm({
  accountId,
  formId,
  formRef,
  onCanSave,
  onAdded,
}: {
  accountId: string;
  formId?: string;
  formRef?: RefObject<HTMLFormElement | null>;
  onCanSave?: (canSave: boolean) => void;
  onAdded: (landingAccountId: string) => void;
}) {
  const { database, ws } = useApp();
  const invalidate = useInvalidateAll();
  const resolveRates = useResolveRates();
  const loaded = useAccounts();
  const accounts = loaded.data ?? [];
  const parent = accounts.find((a) => a.id === accountId);
  const hasPockets = pocketParentIds(accounts).has(accountId);
  // A plain current or saving account takes a second currency too: it becomes an account with pockets, the
  // currency it already holds being the first of them.
  const plain = Boolean(parent && !hasPockets && !parent.parentId && (parent.subtype === 'bank' || parent.subtype === 'savings'));
  const taken = new Set(plain ? [parent!.currency] : pocketsOf(accountId, accounts).map((p) => p.currency));
  const offered = CURRENCIES.filter((c) => !taken.has(c.code));
  const [currency, setCurrency] = useState('');
  const [balance, setBalance] = useState('');
  const [openedOn, setOpenedOn] = useState(isoDate());
  const [rate, setRate] = useState('');
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const code = currency || offered[0]?.code || '';
  const usable = loaded.isSuccess && Boolean(parent) && (hasPockets || plain) && offered.length > 0;
  useEffect(() => onCanSave?.(usable && !busy), [onCanSave, usable, busy]);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (busy) return;
    setError(null);
    setBusy(true);
    try {
      // The one pocket reader: the balance is read at this pocket's exponent, never the account's or the base's.
      const [pocket] = readPockets([{ currency: code, balance, rate }]);
      const { openingBalanceMinor } = pocket!;
      const openingRateToBase = await openingRateFor({ database, ws, currency: code, openedOn, openingBalanceMinor, typed: pocket!.typedRate, resolveRates });
      const input = { currency: code, openingBalanceMinor, openedOn, openingRateToBase };
      let landing = accountId;
      if (plain) landing = (await makeMultiCurrency(database, ws, { accountId, ...input })).parent.id;
      else await addPocket(database, ws, { parentId: accountId, ...input });
      await invalidate();
      onAdded(landing);
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  }

  if (loaded.isSuccess && parent && !hasPockets && !plain) return <Empty>This account does not hold more than one currency, so it has no pockets.</Empty>;
  // Every currency taken: nothing to offer, so no form that would submit a pocket with no currency.
  if (offered.length === 0) return <Empty>This account already holds every currency.</Empty>;

  return (
    <form ref={formRef} id={formId} onSubmit={submit}>
      <ErrorBox error={error} />
      <InsetGroup className="!mb-0">
        <SelectRow label="Currency" value={code} onChange={(e) => { setCurrency(e.target.value); setRate(''); }}>
          {offered.map((c) => (
            <option key={c.code} value={c.code}>
              {`${c.code} · ${c.name}`}
            </option>
          ))}
        </SelectRow>
        <TextRow label="Balance as of" type="date" value={openedOn} onChange={(e) => setOpenedOn(e.target.value)} />
        <TextRow label={`Opening ${code}`} value={balance} onChange={(e) => setBalance(e.target.value)} inputMode="decimal" placeholder="Amount" />
        {code !== ws.baseCurrency && (
          <TextRow
            label={`Rate: ${ws.baseCurrency} per 1 ${code}`}
            info="Leave it blank and the rate for the opening date is used."
            hint={ratePreview(rate, code, ws.baseCurrency) ?? undefined}
            value={rate}
            onChange={(e) => setRate(e.target.value)}
            inputMode="decimal"
            placeholder="Auto"
          />
        )}
      </InsetGroup>
    </form>
  );
}
