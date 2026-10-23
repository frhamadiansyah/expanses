import { isoDate } from '@expanses/core';
import { listProgrammes, listProgrammeSummaries, refreshProgramme } from '@expanses/db';
import { useQuery } from '@tanstack/react-query';
import { Plus } from 'lucide-react';
import { useState } from 'react';
import { useApp } from '../../app/context';
import { InsetGroup, InsetRow } from '../../ui/native';
import { balanceText, earnersLine, expiryNote } from './programme-text';
import { AddProgrammeSheet } from './ProgrammeSheets';

/**
 * The points programmes, one row each: a bank's programme two cards earn into, an airline's a co-brand card earns
 * straight into, or one only conversions fill. Its balance in its own unit, and in the warning colour what of it
 * expires soon. ＋ adds a programme no card earns into yet.
 *
 * Each programme's ledger is brought up to date before it is shown, as opening it would, so the figure here is the
 * one its page shows. Drawn under Wallet's cards, as it was under the Cards tab's.
 */
export function PointsSection() {
  const { database, ws } = useApp();
  const today = isoDate();
  const [adding, setAdding] = useState(false);
  const summaries = useQuery({
    queryKey: ['programmes', ws.workspaceId, today],
    queryFn: async () => {
      for (const programme of await listProgrammes(database, ws)) await refreshProgramme(database, ws, programme.id, today);
      return listProgrammeSummaries(database, ws, today);
    },
  });
  const rows = summaries.data ?? [];
  return (
    <div data-testid="points-programmes">
      <InsetGroup
        header="Points"
        trailing={
          <button
            type="button"
            aria-label="New programme"
            onClick={() => setAdding(true)}
            className="ph-focus ph-tap -my-[4px] flex h-[22px] w-[22px] items-center justify-center rounded-full text-[var(--ph-tint)]"
          >
            <Plus size={18} aria-hidden />
          </button>
        }
        footer={rows.length === 0 && summaries.isSuccess ? 'A card set up with rewards earns into a programme of its own. An airline or hotel programme filled by conversions is added with ＋.' : undefined}
      >
        {rows.length === 0 && <InsetRow title={<span className="text-[var(--ph-ink-3)]">No programmes yet</span>} />}
        {rows.map(({ programme, earners, balance }) => {
          const note = expiryNote(balance);
          return (
            <InsetRow
              key={programme.id}
              testId="programme-row"
              title={programme.name}
              subtitle={
                <>
                  {earnersLine(earners)}
                  {note && <span className="text-[var(--ph-warn)]"> · {note}</span>}
                </>
              }
              value={<span className="tabular">{balanceText(balance.total, programme.unit)}</span>}
              valueTone="ink"
              to="/cards/points/$programmeId"
              params={{ programmeId: programme.id }}
            />
          );
        })}
      </InsetGroup>
      {adding && <AddProgrammeSheet onClose={() => setAdding(false)} />}
    </div>
  );
}
