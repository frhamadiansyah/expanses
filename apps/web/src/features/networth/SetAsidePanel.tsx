import { formatMinor } from '@expanses/core';
import { Money } from '../../ui';
import { InsetGroup, InsetRow, Panel } from '../../ui/native';
import { useSetAsideView } from '../goals/queries';
import { ShareBar, ShareLegend } from './ShareBar';

const GOAL_COLOURS = ['bg-cyan-600', 'bg-emerald-600', 'bg-indigo-500', 'bg-slate-400'];

/** B3: in the account, set aside, free to spend, and which goals claim it. Nothing for an account with nothing promised. */
export function SetAsidePanel({ accountId }: { accountId: string }) {
  const view = useSetAsideView(accountId).data;
  if (!view || view.state === 'none') return null;
  const { currency } = view;
  const segments = [
    ...view.goals.map((goal, index) => ({ key: goal.goalId, label: goal.name, minor: goal.coveredMinor, className: GOAL_COLOURS[index % GOAL_COLOURS.length]! })),
    ...(view.shortMinor > 0 ? [{ key: 'short', label: 'Short', minor: view.shortMinor, className: 'bg-rose-500' }] : []),
  ];
  const total = Math.max(view.balanceMinor, view.setAsideMinor);
  return (
    <>
      <InsetGroup
        footer={
          view.state === 'short' ? (
            <span className="text-[var(--ph-warn)]">
              You have promised more than this account holds. {formatMinor(view.setAsideMinor, currency)} is set aside but only{' '}
              {formatMinor(Math.max(0, view.balanceMinor), currency)} is here. Move money back, or lower what is set aside.
            </span>
          ) : undefined
        }
      >
        <InsetRow title="Set aside" value={<Money minor={view.setAsideMinor} currency={currency} />} valueTone="ink" chevron={false} />
        <InsetRow title="Free to spend" value={<Money minor={view.freeMinor} currency={currency} />} valueTone={view.freeMinor < 0 ? 'alarm' : 'ink'} chevron={false} />
      </InsetGroup>
      <Panel className="space-y-2">
        <ShareBar segments={segments} totalMinor={total} />
        <ShareLegend segments={[...segments, ...(view.freeMinor > 0 ? [{ key: 'free', label: 'Free', minor: view.freeMinor, className: 'bg-slate-100' }] : [])]} totalMinor={total} />
      </Panel>
      <InsetGroup header="Promised to">
        {view.goals.map((goal) => (
          <InsetRow
            key={goal.goalId}
            to="/goals"
            title={goal.name}
            subtitle={goal.shortMinor > 0 ? <span className="text-[var(--ph-warn)]">Short by {formatMinor(goal.shortMinor, currency)}</span> : 'Covered'}
            value={<Money minor={goal.promisedMinor} currency={currency} />}
            valueTone="ink"
          />
        ))}
      </InsetGroup>
    </>
  );
}
