import { linkHolding } from '@expanses/db';
import { useNavigate, useSearch } from '@tanstack/react-router';
import { useCallback, useState } from 'react';
import { Check } from 'lucide-react';
import { useApp } from '../../app/context';
import { useAccounts, useInvalidateAll } from '../../lib/queries';
import { ErrorBox } from '../../ui';
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
  const [step, setStep] = useState<'search' | 'name' | 'form'>('search');
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
      setStep('form');
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

  const leave = () => void navigate(link ? { to: '/net-worth/assets/$accountId', params: { accountId: link } } : { to: '/net-worth/investments' });
  const back = () => (step === 'search' ? leave() : setStep('search'));
  return (
    <div className={SCREEN}>
      <PushedTitle
        title={link ? 'Which ticker is it?' : step === 'name' ? 'Name it' : 'Add a holding'}
        back={step === 'search' ? (link ? 'Asset' : 'Investments') : 'Search'}
        onBack={back}
        actions={
          step !== 'search' && confirm
            ? [{ key: 'save', label: step === 'name' ? 'Continue' : 'Add holding', glyph: <Check size={20} aria-hidden />, disabled: confirm.disabled, run: confirm.run }]
            : []
        }
      />
      <ErrorBox error={error} />
      {step === 'search' && <SecuritySearch query={query} onQuery={setQuery} held={securities} heldUnits={heldUnits} onPick={(p) => void choose(p)} onNameIt={() => setStep('name')} />}
      {step === 'name' && <NameItForm base={ws.baseCurrency} onDone={(p) => void choose(p)} onConfirm={onConfirm} />}
      {step === 'form' && picked && <AddHoldingForm picked={picked} accounts={accounts} brokers={brokerChoices(accounts)} heldAt={heldAt} onConfirm={onConfirm} />}
    </div>
  );
}
