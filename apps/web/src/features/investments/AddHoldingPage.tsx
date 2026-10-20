import { linkHolding } from '@expanses/db';
import { useNavigate, useSearch } from '@tanstack/react-router';
import { useCallback, useState } from 'react';
import { Check } from 'lucide-react';
import { useApp } from '../../app/context';
import { useAccounts, useInvalidateAll } from '../../lib/queries';
import { ErrorBox } from '../../ui';
import { Sheet } from '../../app/Sheet';
import { useBack } from '../../app/BackHeader';
import { PushedTitle, SCREEN } from '../../ui/native';
import type { FormConfirm } from '../networth/AddAssetForm';
import { usePositions } from '../networth/queries';
import { asHeld, brokerChoices, type Picked, securityOf } from './add-holding';
import { AddHoldingForm } from './AddHoldingForm';
import { NameItForm } from './NameItForm';
import { useHoldingLinks, useSecurities } from './queries';
import { SecuritySearch } from './SecuritySearch';

export function AddHoldingPage() {
  const { database, ws } = useApp();
  const invalidate = useInvalidateAll();
  const navigate = useNavigate();
  const { link } = useSearch({ strict: false }) as { link?: string };
  const accounts = useAccounts().data ?? [];
  const securities = useSecurities().data ?? [];
  const links = useHoldingLinks().data ?? [];
  const positions = usePositions().data ?? {};
  const [query, setQuery] = useState('');
  /* The form first, as every other asset opens: its first row is the ticker, which opens the search. Linking a holding
     recorded before a ticker (spec §7.6) asks only for the ticker, so it starts at the search. */
  const [step, setStep] = useState<'search' | 'name' | 'form'>(link ? 'search' : 'form');
  /* Adding (not linking): the ticker is chosen in a sheet over the form — the search, and Name it myself as its second
     step — so the page never changes under what was typed. */
  const [sheet, setSheet] = useState<'search' | 'name' | null>(null);
  const [nameConfirm, setNameConfirm] = useState<FormConfirm | null>(null);
  const onNameConfirm = useCallback((next: FormConfirm | null) => setNameConfirm(next), []);
  const [picked, setPicked] = useState<Picked | null>(null);
  const [error, setError] = useState<unknown>(null);
  // The step's ✓, drawn in the bar as Add asset draws its own.
  const [confirm, setConfirm] = useState<FormConfirm | null>(null);
  const onConfirm = useCallback((next: FormConfirm | null) => setConfirm(next), []);

  const heldUnits: Record<string, number> = {};
  for (const l of links) if (l.securityId) heldUnits[l.securityId] = (heldUnits[l.securityId] ?? 0) + (positions[l.accountId]?.unitsMicro ?? 0);
  const heldAt: Record<string, number> = {};
  if (picked?.kind === 'held') for (const l of links) if (l.securityId === picked.security.id && l.brokerAccountId) heldAt[l.brokerAccountId] = positions[l.accountId]?.unitsMicro ?? 0;

  async function choose(pick: Picked) {
    // A stock already held is that security, whether it was searched for or named by hand (m7).
    const next = asHeld(pick, securities);
    if (!link) {
      setPicked(next);
      setSheet(null);
      setQuery('');
      return;
    }
    // Linking a holding recorded before this build (spec §7.6): the same search, a different last step.
    try {
      await linkHolding(database, ws, { accountId: link, security: next.kind === 'held' ? { id: next.security.id } : securityOf(next) });
      await invalidate();
      await navigate({ to: '/net-worth/assets/$accountId', params: { accountId: link } });
    } catch (e) {
      setError(e);
    }
  }

  // Opened from New asset or from Investments, Back returns to whichever it was; opened cold, to Investments.
  const goBack = useBack('/net-worth/investments');
  const leave = () => (link ? void navigate({ to: '/net-worth/assets/$accountId', params: { accountId: link } }) : goBack());
  const back = () => (link && step === 'name' ? setStep('search') : leave());
  const backLabel = link ? (step === 'name' ? 'Search' : 'Asset') : 'Back';
  return (
    <div className={SCREEN}>
      <PushedTitle
        title={link ? (step === 'name' ? 'Name it' : 'Which ticker is it?') : 'Add a holding'}
        back={backLabel}
        onBack={back}
        actions={
          (!link || step === 'name') && confirm
            ? [{ key: 'save', label: step === 'name' ? 'Continue' : 'Add holding', glyph: <Check size={20} aria-hidden />, disabled: confirm.disabled, run: confirm.run }]
            : []
        }
      />
      <ErrorBox error={error} />
      {/* Linking a holding to its ticker: the search is the page, and so is naming one by hand. */}
      {link && step === 'search' && <SecuritySearch query={query} onQuery={setQuery} held={securities} heldUnits={heldUnits} onPick={(p) => void choose(p)} onNameIt={() => setStep('name')} />}
      {link && step === 'name' && <NameItForm base={ws.baseCurrency} onDone={(p) => void choose(p)} onConfirm={onConfirm} />}
      {/* Adding: the whole form, Ticker its first row, which opens the sheet below. */}
      {!link && (
        <AddHoldingForm picked={picked} brokers={brokerChoices(accounts)} heldAt={heldAt} onConfirm={onConfirm} onTicker={() => setSheet('search')} />
      )}
      {!link && sheet === 'search' && (
        <Sheet title="Choose a ticker" grouped tall onClose={() => setSheet(null)}>
          <SecuritySearch query={query} onQuery={setQuery} held={securities} heldUnits={heldUnits} onPick={(p) => void choose(p)} onNameIt={() => setSheet('name')} />
        </Sheet>
      )}
      {!link && sheet === 'name' && (
        <Sheet
          title="Name it"
          grouped
          tall
          back={{ label: 'Choose a ticker', run: () => setSheet('search') }}
          onClose={() => setSheet(null)}
          confirm={nameConfirm ? { label: 'Continue', ...nameConfirm } : undefined}
        >
          <NameItForm base={ws.baseCurrency} onDone={(p) => void choose(p)} onConfirm={onNameConfirm} />
        </Sheet>
      )}
    </div>
  );
}
