import { linkHolding } from '@expanses/db';
import { useNavigate, useSearch } from '@tanstack/react-router';
import { useState } from 'react';
import { useApp } from '../../app/context';
import { useAccounts, useInvalidateAll } from '../../lib/queries';
import { ErrorBox } from '../../ui';
import { LargeTitle, SCREEN } from '../../ui/native';
import { usePositions } from '../networth/queries';
import { brokerChoices, type Picked, securityOf } from './add-holding';
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

  const heldUnits: Record<string, number> = {};
  for (const l of links) if (l.securityId) heldUnits[l.securityId] = (heldUnits[l.securityId] ?? 0) + (positions[l.accountId]?.unitsMicro ?? 0);
  const heldAt: Record<string, number> = {};
  if (picked?.kind === 'held') for (const l of links) if (l.securityId === picked.security.id && l.brokerAccountId) heldAt[l.brokerAccountId] = positions[l.accountId]?.unitsMicro ?? 0;

  async function choose(next: Picked) {
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
      <LargeTitle title={link ? 'Which ticker is it?' : 'Add a holding'} back={step === 'search' ? (link ? 'Asset' : 'Investments') : 'Search'} onBack={back} />
      <ErrorBox error={error} />
      {step === 'search' && <SecuritySearch query={query} onQuery={setQuery} held={securities} heldUnits={heldUnits} onPick={(p) => void choose(p)} onNameIt={() => setStep('name')} />}
      {step === 'name' && <NameItForm base={ws.baseCurrency} onDone={(p) => void choose(p)} onCancel={back} />}
      {step === 'form' && picked && <AddHoldingForm picked={picked} accounts={accounts} brokers={brokerChoices(accounts)} heldAt={heldAt} onCancel={back} />}
    </div>
  );
}
