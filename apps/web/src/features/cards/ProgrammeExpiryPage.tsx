import { type ExpiryPolicy, isoDate } from '@expanses/core';
import { getProgramme, programmeExpiry, refreshProgramme, setProgramExpiry } from '@expanses/db';
import { useQuery } from '@tanstack/react-query';
import { useParams } from '@tanstack/react-router';
import { Check } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useBack } from '../../app/BackHeader';
import { useApp } from '../../app/context';
import { useInvalidateAll } from '../../lib/queries';
import { Empty, ErrorBox } from '../../ui';
import { InsetGroup, InsetRow, PushedTitle, SCREEN } from '../../ui/native';
import { formatPoints } from './format-points';
import { ExpiryFields, monthsOf } from './ProgrammeSheets';

const dayMonth = (date: string) => new Date(`${date}T00:00:00`).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
const dayMonthYear = (date: string) => new Date(`${date}T00:00:00`).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });

/**
 * How a programme's points die, and what of its balance dies when. The policy is the one every card earning into the
 * programme, and every conversion into it, follows; the ✓ saves it. Once points can expire the page adds how much
 * goes within 30 and within 90 days, the next date, and what is left to expire on each date after everything spent or
 * converted has been drawn from the batches that die soonest.
 */
export function ProgrammeExpiryPage() {
  const { database, ws } = useApp();
  const { programmeId } = useParams({ strict: false }) as { programmeId: string };
  const goBack = useBack('/cards/points');
  const invalidate = useInvalidateAll();
  const today = isoDate();
  const [policy, setPolicy] = useState<ExpiryPolicy | null>(null);
  const [months, setMonths] = useState('24');
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const data = useQuery({
    queryKey: ['programme-expiry', ws.workspaceId, programmeId, today],
    queryFn: async () => {
      const programme = await getProgramme(database, ws, programmeId);
      if (!programme) return null;
      await refreshProgramme(database, ws, programmeId, today);
      return { programme, expiry: await programmeExpiry(database, ws, programmeId, today) };
    },
  });
  const programme = data.data?.programme;
  // The fields start at what is saved, once it is read.
  useEffect(() => {
    if (programme && policy === null) {
      setPolicy(programme.expiryPolicy);
      setMonths(String(programme.expiryMonths ?? 24));
    }
  }, [programme, policy]);
  if (data.isSuccess && data.data === null) return <Empty>Programme not found.</Empty>;
  if (!data.data || !programme || policy === null) return <p className="text-sm text-slate-500">Loading…</p>;
  const { expiry } = data.data;
  const unit = programme.unit;

  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      await setProgramExpiry(database, ws, programmeId, policy, monthsOf(policy, months));
      await invalidate();
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className={SCREEN}>
      <PushedTitle
        title="Expiry"
        back={programme.name}
        onBack={goBack}
        actions={[{ key: 'save', label: 'Save expiry', glyph: <Check size={20} aria-hidden />, disabled: busy, run: () => void save() }]}
      />
      <ErrorBox error={error} />
      <ExpiryFields policy={policy} setPolicy={setPolicy} months={months} setMonths={setMonths} />
      {programme.expiryPolicy !== 'none' && (
        <>
          <div data-testid="programme-expiry-summary">
            <InsetGroup>
              <InsetRow title="Expiring in 30 days" value={<span className="tabular">{formatPoints(expiry.in30)}</span>} />
              <InsetRow title="Expiring in 90 days" value={<span className="tabular">{formatPoints(expiry.in90)}</span>} />
              <InsetRow title="Next to expire" value={<span className="tabular">{expiry.nextExpiryOn ? dayMonth(expiry.nextExpiryOn) : 'None'}</span>} />
            </InsetGroup>
          </div>
          {expiry.lots.length > 0 && (
            <div data-testid="programme-expiry-lots">
              <InsetGroup header="By date">
                {expiry.lots.map((lot) => (
                  <InsetRow key={lot.expiresOn} testId="programme-expiry-lot" title={dayMonthYear(lot.expiresOn)} value={<span className="tabular">{`${formatPoints(lot.remaining)} ${unit}`}</span>} />
                ))}
              </InsetGroup>
            </div>
          )}
        </>
      )}
    </div>
  );
}
