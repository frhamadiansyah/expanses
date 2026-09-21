import { CURRENCIES, isoDate, parseMajor } from '@expanses/core';
import { addPocket } from '@expanses/db';
import { useNavigate, useParams } from '@tanstack/react-router';
import { type FormEvent, useRef, useState } from 'react';
import { useApp } from '../../app/context';
import { useAccounts, useInvalidateAll, useResolveRates } from '../../lib/queries';
import { openingRateFor, ratePreview } from '../../lib/rates';
import { ErrorBox } from '../../ui';
import { InsetGroup, InsetRow, LargeTitle, SCREEN, SelectRow, TextRow } from '../../ui/native';
import { pocketsOf } from './pockets';

export function AddPocketPage() {
  const { database, ws } = useApp();
  const navigate = useNavigate();
  const invalidate = useInvalidateAll();
  const resolveRates = useResolveRates();
  const { accountId = '' } = useParams({ strict: false }) as { accountId?: string };
  const accounts = useAccounts().data ?? [];
  const parent = accounts.find((a) => a.id === accountId);
  const taken = new Set(pocketsOf(accountId, accounts).map((p) => p.currency));
  const offered = CURRENCIES.filter((c) => !taken.has(c.code));
  const [currency, setCurrency] = useState('');
  const [balance, setBalance] = useState('');
  const [openedOn, setOpenedOn] = useState(isoDate());
  const [rate, setRate] = useState('');
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const form = useRef<HTMLFormElement>(null);
  const code = currency || offered[0]?.code || '';

  async function submit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const openingBalanceMinor = balance.trim() ? parseMajor(balance, code) : 0;
      const openingRateToBase = await openingRateFor({ database, ws, currency: code, openedOn, openingBalanceMinor, typed: rate, resolveRates });
      await addPocket(database, ws, { parentId: accountId, currency: code, openingBalanceMinor, openedOn, openingRateToBase });
      await invalidate();
      await navigate({ to: '/accounts/$accountId', params: { accountId } });
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className={SCREEN}>
      <LargeTitle title="Add a pocket" back={parent?.name ?? 'Account'} backTo="/accounts/$accountId" backParams={{ accountId }} />
      <form ref={form} onSubmit={submit}>
        <ErrorBox error={error} />
        <InsetGroup footer="Leave the rate blank and the rate for the opening date is used.">
          <SelectRow label="Currency" value={code} onChange={(e) => { setCurrency(e.target.value); setRate(''); }}>
            {offered.map((c) => (
              <option key={c.code} value={c.code}>
                {c.code} — {c.name}
              </option>
            ))}
          </SelectRow>
          <TextRow label={`Opening ${code}`} value={balance} onChange={(e) => setBalance(e.target.value)} inputMode="decimal" placeholder="0" />
          <TextRow label="Balance as of" type="date" value={openedOn} onChange={(e) => setOpenedOn(e.target.value)} />
          {code !== ws.baseCurrency && (
            <TextRow
              label={`Rate: ${ws.baseCurrency} per 1 ${code}`}
              hint={ratePreview(rate, code, ws.baseCurrency) ?? 'Optional.'}
              value={rate}
              onChange={(e) => setRate(e.target.value)}
              inputMode="decimal"
            />
          )}
        </InsetGroup>
        <InsetGroup>
          <InsetRow title="Add pocket" chevron={false} onClick={() => !busy && form.current?.requestSubmit()} className={busy ? 'opacity-40' : undefined} />
        </InsetGroup>
      </form>
    </div>
  );
}
