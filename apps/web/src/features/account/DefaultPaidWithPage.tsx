import { useQueryClient } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';
import { Check } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useApp } from '../../app/context';
import { ErrorBox } from '../../ui';
import { InsetGroup, InsetRow, LargeTitle, SCREEN } from '../../ui/native';
import { isCardOption, paymentLabel } from '../transactions/PaymentSheet';
import { paymentKey } from '../transactions/quick-row';
import { resolveDefaultPaidWith, usePayableOptions, useStoredDefaultPaidWith, writeDefaultPaidWith } from './default-paid-with';

/**
 * Account → Settings → Default: the Paid with a plain, blank New transaction opens with.
 *
 * Tapping a row only moves the tick. The ✓ in the corner saves it and returns to the Account page; ‹ leaves the
 * page with nothing saved. The lists are the ones Paid with offers (`payableOptions`), named the way it names them.
 */
export function DefaultPaidWithPage() {
  const { database, ws } = useApp();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const stored = useStoredDefaultPaidWith();
  const { options, accounts, ready } = usePayableOptions();
  // The tick as it stands on the page; null until the first reading, then a key or '' for None.
  const [ticked, setTicked] = useState<string | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);

  // What is saved, read the way the form reads it: a choice that stopped being valid is None.
  const current = ready && stored.isSuccess ? paymentKey(...keyParts(resolveDefaultPaidWith(stored.data, options))) : null;
  useEffect(() => {
    if (current !== null) setTicked((now) => now ?? current);
  }, [current]);

  const shown = ticked ?? current;
  const changed = shown !== null && shown !== current;
  const accountOf = (id: string) => accounts.find((account) => account.id === id);
  const money = options.filter((option) => !isCardOption(option, accountOf(option.accountId)));
  const cards = options.filter((option) => isCardOption(option, accountOf(option.accountId)));

  async function save() {
    if (!changed || busy) return;
    setBusy(true);
    setError(null);
    try {
      await writeDefaultPaidWith(database, ws.workspaceId, shown || null);
      await queryClient.invalidateQueries({ queryKey: ['default-paid-with'] });
      await navigate({ to: '/account' });
    } catch (failure) {
      setError(failure);
    } finally {
      setBusy(false);
    }
  }

  const tick = (on: boolean) => (on ? <span data-testid="default-ticked"><Check size={18} aria-label="Chosen" className="text-[var(--ph-ink)]" /></span> : undefined);
  const rowFor = (option: (typeof options)[number]) => {
    const key = paymentKey(option.accountId, option.cardId);
    return <InsetRow key={key} title={paymentLabel(option)} label={paymentLabel(option)} chevron={false} value={tick(shown === key)} onClick={() => setTicked(key)} />;
  };

  return (
    <div className={SCREEN}>
      <LargeTitle
        title="Default"
        back="Account"
        backTo="/account"
        actions={[{ key: 'save', label: 'Save', glyph: <Check size={20} aria-hidden />, disabled: !changed || busy, run: () => void save() }]}
      />
      <ErrorBox error={error ?? stored.error} />
      <InsetGroup footer="Where Paid with starts on a new transaction. Choosing another for one purchase does not change it.">
        <InsetRow title="None" label="None" chevron={false} value={tick(shown === '')} onClick={() => setTicked('')} />
      </InsetGroup>
      {money.length > 0 && <InsetGroup header="Money">{money.map(rowFor)}</InsetGroup>}
      {cards.length > 0 && <InsetGroup header="Cards">{cards.map(rowFor)}</InsetGroup>}
    </div>
  );
}

/** The two halves of a `paymentKey`, or an empty account for None. */
function keyParts(option: { accountId: string; cardId: string | null } | null): [string, string | null] {
  return option ? [option.accountId, option.cardId] : ['', null];
}
