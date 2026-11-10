import { isoDate } from '@expanses/core';
import { useParams } from '@tanstack/react-router';
import { Money } from '../../ui';
import { InsetGroup, InsetRow, PushedTitle, SCREEN } from '../../ui/native';
import { historySubtitle, historyTitle } from './history-lines';
import { useGoalHistory, useGoalShare } from './queries';

export function GoalHistoryRoute() {
  const { goalId } = useParams({ from: '/goals/$goalId/history' });
  return <GoalHistoryPage goalId={goalId} />;
}

/** Everything that has happened to a goal, in the ledger's order: the goal page keeps only a row that opens this. */
export function GoalHistoryPage({ goalId }: { goalId: string }) {
  const entries = useGoalHistory().data?.[goalId] ?? [];
  const share = useGoalShare(goalId).data ?? null;
  const today = isoDate();
  const nameOf = (memberId: string) => share?.members.find((member) => member.memberId === memberId)?.name ?? 'Member';
  return (
    <div className={SCREEN}>
      <PushedTitle title="History" back="Goal" backTo={`/goals/${goalId}`} />
      <InsetGroup wide>
        {entries.map((entry) => (
          <InsetRow
            key={entry.key}
            testId="goal-history"
            title={historyTitle(entry)}
            subtitle={historySubtitle(entry, today, nameOf, share !== null)}
            value={entry.amountMinor === null ? undefined : <Money minor={entry.amountMinor} currency={entry.currency} />}
            valueTone="ink"
            chevron={false}
          />
        ))}
      </InsetGroup>
    </div>
  );
}
