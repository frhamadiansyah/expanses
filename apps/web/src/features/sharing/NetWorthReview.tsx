import { confirmReview, type ReviewItem, type ShareSetting } from '@expanses/db';
import { useState } from 'react';
import { useApp } from '../../app/context';
import { useInvalidateAll } from '../../lib/queries';
import { SUBTYPE_LABELS } from '../../lib/account-types';
import { ErrorBox } from '../../ui';
import { InsetGroup, InsetRow, SwitchRow } from '../../ui/native';
import { JOINT_LINE, pendingPrompt } from './net-worth-state';

/*
 * Review your items (joint-net-worth spec §8.1): shown once a group is active and some item has no setting yet, and
 * again after a switch to one tax ID while some item is still hidden (D8). Every account, card and asset, grouped by
 * kind as Net worth folds them. One tax ID: no switches, every item is in the joint report. Separate: a switch per item,
 * on unless it was already hidden. Share writes a setting for every item.
 */

/** Items by kind, in the order the kinds first appear: assets before liabilities, as Net worth reads. */
function byKind(items: readonly ReviewItem[]): { key: string; label: string; items: ReviewItem[] }[] {
  const drawers = new Map<string, { key: string; label: string; items: ReviewItem[] }>();
  for (const item of [...items].sort((a, b) => (a.kind === b.kind ? 0 : a.kind === 'asset' ? -1 : 1))) {
    const label = SUBTYPE_LABELS[item.subtype as keyof typeof SUBTYPE_LABELS] ?? 'Other';
    const drawer = drawers.get(item.subtype) ?? { key: item.subtype, label, items: [] };
    drawer.items.push(item);
    drawers.set(item.subtype, drawer);
  }
  return [...drawers.values()];
}

export function NetWorthReview({
  mode,
  items,
  pending,
  others,
}: {
  mode: 'joint' | 'separate';
  items: readonly ReviewItem[];
  /** Items still hidden after a switch to one tax ID (D8). */
  pending: readonly string[];
  /** The other members' names, for the D8 prompt. */
  others: readonly string[];
}) {
  const { database, ws } = useApp();
  const invalidate = useInvalidateAll();
  const [shared, setShared] = useState<Record<string, boolean>>(() => Object.fromEntries(items.map((item) => [item.accountId, item.setting !== 'hidden'])));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);

  async function share() {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const settings: Record<string, ShareSetting> = Object.fromEntries(items.map((item) => [item.accountId, mode === 'joint' || shared[item.accountId] !== false ? 'total' : 'hidden']));
      await confirmReview(database, ws, settings);
      await invalidate();
    } catch (failure) {
      setError(failure);
    } finally {
      setBusy(false);
    }
  }

  const button = (
    <InsetGroup wide>
      <InsetRow testId="net-worth-share" title={busy ? 'Sharing…' : 'Share'} chevron={false} disabled={busy} onClick={() => void share()} />
    </InsetGroup>
  );

  // D8: after a switch to one tax ID, only what is still hidden is asked about.
  if (mode === 'joint' && pending.length > 0) {
    const names = items.filter((item) => pending.includes(item.accountId)).map((item) => item.name);
    return (
      <div data-testid="net-worth-review">
        <ErrorBox error={error} />
        <InsetGroup wide header="Review your items" footer={JOINT_LINE}>
          <InsetRow title={pendingPrompt(names, others)} chevron={false} />
        </InsetGroup>
        {button}
      </div>
    );
  }

  return (
    <div data-testid="net-worth-review">
      <ErrorBox error={error} />
      <InsetGroup wide>
        <InsetRow
          title="Review your items"
          subtitle={mode === 'joint' ? JOINT_LINE : 'Each item shows its balance and one total of other use. Turn off what you keep to yourself.'}
          chevron={false}
        />
      </InsetGroup>
      {byKind(items).map((drawer) => (
        <InsetGroup key={drawer.key} wide header={drawer.label}>
          {drawer.items.map((item) =>
            mode === 'joint' ? (
              <InsetRow key={item.accountId} title={item.name} value="Shared" chevron={false} />
            ) : (
              <SwitchRow
                key={item.accountId}
                label={item.name}
                checked={shared[item.accountId] !== false}
                onChange={(checked) => setShared((was) => ({ ...was, [item.accountId]: checked }))}
              />
            ),
          )}
        </InsetGroup>
      ))}
      {button}
    </div>
  );
}
