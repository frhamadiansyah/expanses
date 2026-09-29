import { type ShareSetting, setShareSetting } from '@expanses/db';
import { type ReactNode, useState } from 'react';
import { useApp } from '../../app/context';
import { useInvalidateAll } from '../../lib/queries';
import { ErrorBox } from '../../ui';
import { InsetGroup, InsetRow, SelectRow, SwitchRow } from '../../ui/native';
import { useActiveNetWorthGroup, useShareSetting } from './net-worth-queries';
import { JOINT_LINE, sayNetWorthError } from './net-worth-state';

/*
 * Each item's own say in joint net worth (spec §8.1, D7, D9). Nothing at all is drawn while this person is in no active
 * group: a household that never set it up sees no trace of it.
 */

const SETTING_LABEL: Record<ShareSetting, string> = { total: 'Balance and one total', hidden: "Don't share" };

/** An item page's "Share with Household" row: the two settings, `Don't share` greyed out while the household files jointly. */
export function ShareWithHouseholdRow({ accountId }: { accountId: string }) {
  const { database } = useApp();
  const invalidate = useInvalidateAll();
  const group = useActiveNetWorthGroup();
  const setting = useShareSetting(accountId);
  const [error, setError] = useState<unknown>(null);
  if (!group.data) return null;
  const joint = group.data.mode === 'joint';
  // Not reviewed yet reads as shared: the review's own default (D9).
  const value: ShareSetting = joint ? 'total' : (setting.data ?? 'total');

  async function change(next: ShareSetting) {
    setError(null);
    try {
      await setShareSetting(database, accountId, next);
      await invalidate();
    } catch (failure) {
      setError(sayNetWorthError(failure));
    }
  }

  return (
    <>
      <ErrorBox error={error} />
      <InsetGroup footer={joint ? JOINT_LINE : 'Balance and one total: the others see its balance and one total of other use, never its lines.'}>
        <SelectRow label="Share with Household" value={value} onChange={(event) => void change(event.target.value as ShareSetting)}>
          <option value="total">{SETTING_LABEL.total}</option>
          <option value="hidden" disabled={joint}>
            {SETTING_LABEL.hidden}
          </option>
        </SelectRow>
      </InsetGroup>
    </>
  );
}

/**
 * The add forms' part (D9): with one tax ID a note that it is shared, separately a **Share with Household** switch, on.
 * `save` writes the setting for what the form just opened; `element` is null when this person is in no active group.
 */
export function useShareOnAdd(): { element: ReactNode; save: (accountIds: readonly string[]) => Promise<void> } {
  const { database } = useApp();
  const group = useActiveNetWorthGroup();
  const [share, setShare] = useState(true);
  const mode = group.data?.mode ?? null;
  const element =
    mode === 'joint' ? (
      <InsetGroup>
        <InsetRow title="Shared with Household (one tax ID)" chevron={false} />
      </InsetGroup>
    ) : mode === 'separate' ? (
      <InsetGroup footer="The others see its balance and one total of other use, never its lines.">
        <SwitchRow label="Share with Household" checked={share} onChange={setShare} />
      </InsetGroup>
    ) : null;
  async function save(accountIds: readonly string[]) {
    if (!mode) return;
    for (const id of accountIds) await setShareSetting(database, id, mode === 'joint' || share ? 'total' : 'hidden');
  }
  return { element, save };
}
