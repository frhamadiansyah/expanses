import { isoDate } from '@expanses/core';
import type { GoalHistoryEntry } from '@expanses/db';
import { useParams } from '@tanstack/react-router';
import { Money } from '../../ui';
import { InsetGroup, InsetRow, PushedTitle, SCREEN } from '../../ui/native';
import { historyDay } from './goal-cards';
import { useGoalHistory } from './queries';

const HISTORY_TITLES: Record<GoalHistoryEntry['kind'], string> = {
  'set-aside': 'Set aside',
  'taken-back': 'Taken back',
  borrowed: 'Borrowed',
  spent: 'Spent',
  moved: 'Moved',
  reached: 'Reached the target',
};

export function GoalHistoryRoute() {
  const { goalId } = useParams({ from: '/goals/$goalId/history' });
  return <GoalHistoryPage goalId={goalId} />;
}

/** Everything that has happened to a goal, in the ledger's order: the goal page keeps only a row that opens this. */
export function GoalHistoryPage({ goalId }: { goalId: string }) {
  const entries = useGoalHistory().data?.[goalId] ?? [];
  const today = isoDate();
  return (
    <div className={SCREEN}>
      <PushedTitle title="History" back="Goal" backTo={`/goals/${goalId}`} />
      <InsetGroup wide>
        {entries.map((entry) => (
          <InsetRow
            key={entry.key}
            testId="goal-history"
            title={HISTORY_TITLES[entry.kind]}
            subtitle={entry.text ? `${historyDay(entry.occurredOn, today)} · ${entry.text}` : historyDay(entry.occurredOn, today)}
            value={entry.amountMinor === null ? undefined : <Money minor={entry.amountMinor} currency={entry.currency} />}
            valueTone="ink"
            chevron={false}
          />
        ))}
      </InsetGroup>
    </div>
  );
}
