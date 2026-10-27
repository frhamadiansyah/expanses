import { useParams } from '@tanstack/react-router';
import { useState } from 'react';
import { ErrorBox } from '../../ui';
import { InsetGroup, InsetRow, LargeTitle, ReadOnlyRow, SCREEN } from '../../ui/native';
import { stateWords, whenText } from './group';
import { useActivityLine, useUndoActivity } from './queries';

/** One line of the Activity list opened: when, by whom, what changed, and the ways on. */
export function ActivityDetailPage() {
  const { id } = useParams({ from: '/settings/activity/$id' });
  const [error, setError] = useState<unknown>(null);
  const found = useActivityLine(id);
  const undo = useUndoActivity(setError);
  const line = found.data ?? null;

  if (!line) {
    return (
      <div className={SCREEN}>
        <LargeTitle title="Activity" back="Activity" backTo="/settings/activity" />
        <ErrorBox error={error ?? found.error} />
        {found.isSuccess && (
          <InsetGroup>
            <InsetRow title="That line is not in the list" chevron={false} />
          </InsetGroup>
        )}
      </div>
    );
  }

  const words = stateWords(line.state);
  return (
    <div className={SCREEN}>
      <LargeTitle title={line.title} back="Activity" backTo="/settings/activity" />
      <ErrorBox error={error ?? found.error} />
      <InsetGroup>
        <ReadOnlyRow label="When" value={whenText(line.at)} testId="activity-when" />
        {line.who && <ReadOnlyRow label="By" value={line.who} testId="activity-by" />}
      </InsetGroup>
      {line.changes.length > 0 && (
        <InsetGroup header="What changed">
          {line.changes.map((change, index) => (
            <ReadOnlyRow key={`${change.field}-${index}`} label={change.field} value={`${change.from || 'None'} → ${change.to || 'None'}`} testId="activity-change" />
          ))}
        </InsetGroup>
      )}
      {line.state === 'open' && line.undo ? (
        <InsetGroup>
          <InsetRow
            testId="activity-undo-this"
            title={undo.busy ? 'Undoing…' : 'Undo this change'}
            action
            disabled={undo.busy}
            onClick={() => void undo.run(line.id)}
          />
        </InsetGroup>
      ) : (
        words && (
          <InsetGroup>
            <InsetRow testId="activity-state" title={<span className="text-[var(--ph-ink-3)]">{words}</span>} action disabled />
          </InsetGroup>
        )
      )}
      {line.transactionId && (
        <InsetGroup>
          <InsetRow
            testId="activity-open"
            title={<span className="text-[var(--ph-ink-3)]">Open the transaction</span>}
            action
            to="/transactions/$transactionId"
            params={{ transactionId: line.transactionId }}
          />
        </InsetGroup>
      )}
    </div>
  );
}
