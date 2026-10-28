import { isoDate } from '@expanses/core';
import { catchUpCard, getProgramme, programmeEarners, programmeHistory } from '@expanses/db';
import { useQuery } from '@tanstack/react-query';
import { useNavigate, useParams } from '@tanstack/react-router';
import { useState } from 'react';
import { useApp } from '../../app/context';
import { useInvalidateAll } from '../../lib/queries';
import { Empty, ErrorBox } from '../../ui';
import { InsetGroup, InsetRow, PushedTitle, SCREEN } from '../../ui/native';
import { formatPoints } from './format-points';

const monthYear = (date: string) => new Date(`${date}T00:00:00`).toLocaleDateString('en-GB', { month: 'long', year: 'numeric' });

/** What a catch-up reported, in words: "Added 3 statements", "Added 1 statement", "Nothing to add". */
export const catchUpText = (added: number) => (added <= 0 ? 'Nothing to add' : `Added ${added} ${added === 1 ? 'statement' : 'statements'}`);

/**
 * One card earning into a programme: its statements by cycle, newest first, each with whether its points are
 * estimated or posted, and the Catch up row that works out the cycles before the app was opened on this card (24
 * months back). The result is written on the row itself, and the list refreshes with the new estimated rows.
 */
export function ProgrammeCardPage() {
  const { database, ws } = useApp();
  const { programmeId, programId } = useParams({ strict: false }) as { programmeId: string; programId: string };
  const navigate = useNavigate();
  const invalidate = useInvalidateAll();
  const [working, setWorking] = useState(false);
  const [result, setResult] = useState<string | null>(null);
  const [error, setError] = useState<unknown>(null);
  const data = useQuery({
    queryKey: ['programme-card', ws.workspaceId, programmeId, programId],
    queryFn: async () => {
      const programme = await getProgramme(database, ws, programmeId);
      const earner = ((await programmeEarners(database, ws)).get(programmeId) ?? []).find((e) => e.programId === programId);
      if (!programme || !earner) return null;
      const statements = (await programmeHistory(database, ws, programmeId)).filter((row) => row.kind === 'earn' && row.earnedById === programId);
      return { programme, earner, statements };
    },
  });
  if (data.isSuccess && data.data === null) return <Empty>Card not found.</Empty>;
  if (!data.data) return <p className="text-sm text-slate-500">Loading…</p>;
  const { programme, earner, statements } = data.data;

  const catchUp = async () => {
    setWorking(true);
    setError(null);
    try {
      const { added } = await catchUpCard(database, ws, programId, 24, isoDate());
      await invalidate();
      setResult(catchUpText(added));
    } catch (e) {
      setError(e);
    } finally {
      setWorking(false);
    }
  };

  return (
    <div className={SCREEN}>
      <PushedTitle
        title={earner.cardName}
        back="Settings"
        onBack={() => void navigate({ to: '/cards/points/$programmeId', params: { programmeId }, search: { settings: true } })}
      />
      <ErrorBox error={error} />
      <div data-testid="programme-card-statements">
        <InsetGroup header="Statements">
          {statements.length === 0 ? (
            <InsetRow title={<span className="text-[var(--ph-ink-3)]">Nothing yet</span>} />
          ) : (
            statements.map((row) => (
              <InsetRow
                key={row.key}
                testId="programme-card-statement"
                title={monthYear(row.on)}
                subtitle={row.estimated ? 'Estimated' : 'Posted'}
                value={<span className="tabular">{`${row.quantity > 0 ? '+' : ''}${formatPoints(row.quantity)} ${programme.unit}`}</span>}
              />
            ))
          )}
        </InsetGroup>
      </div>
      <InsetGroup>
        <InsetRow
          plain
          testId="programme-catch-up"
          chevron={false}
          title="Catch up earlier cycles"
          value={working ? 'Working…' : (result ?? undefined)}
          {...(working ? {} : { onClick: () => void catchUp() })}
        />
      </InsetGroup>
    </div>
  );
}
