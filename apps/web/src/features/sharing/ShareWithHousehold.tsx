import { activeNetWorthGroup, type ShareSetting, setShareSetting } from '@expanses/db';
import { type ReactNode, useState } from 'react';
import { useApp } from '../../app/context';
import { useInvalidateAll } from '../../lib/queries';
import { ErrorBox } from '../../ui';
import { InsetGroup, InsetRow, SelectRow, SwitchRow } from '../../ui/native';
import { useActiveNetWorthGroup, useShareSetting } from './net-worth-queries';
import { JOINT_LINE, sayNetWorthError, settingOnAdd, shareRowOf } from './net-worth-state';

/*
 * Each item's own say in joint net worth (spec §8.1, D7, D9). Nothing at all is drawn while this person is in no active
 * group: a household that never set it up sees no trace of it.
 */

const SETTING_LABEL: Record<ShareSetting, string> = { total: 'Balance and one total', hidden: "Don't share" };

/**
 * An item page's "Share with Household" row: the stored setting as it is (review round 1, finding 3). One tax ID with
 * the item still hidden (D8) reads "Not yet shared" with Share; an item never reviewed reads "Not reviewed" until a
 * setting is chosen; `Don't share` is greyed out while the household files jointly.
 */
export function ShareWithHouseholdRow({ accountId }: { accountId: string }) {
  const { database } = useApp();
  const invalidate = useInvalidateAll();
  const group = useActiveNetWorthGroup();
  const setting = useShareSetting(accountId);
  const [error, setError] = useState<unknown>(null);
  if (!group.data || setting.isPending) return null;
  const joint = group.data.mode === 'joint';
  const row = shareRowOf(group.data.mode, setting.data ?? null);

  async function change(next: ShareSetting) {
    setError(null);
    try {
      await setShareSetting(database, accountId, next);
      await invalidate();
    } catch (failure) {
      setError(sayNetWorthError(failure));
    }
  }

  if (row.kind === 'not-yet-shared') {
    return (
      <>
        <ErrorBox error={error} />
        <InsetGroup footer={JOINT_LINE}>
          <InsetRow testId="share-with-household" title="Share with Household" value={row.label} chevron={false} />
          <InsetRow title="Share" chevron={false} onClick={() => void change('total')} />
        </InsetGroup>
      </>
    );
  }
  return (
    <>
      <ErrorBox error={error} />
      <InsetGroup footer={joint ? JOINT_LINE : 'Balance and one total: the others see its balance and one total of other use, never its lines.'}>
        <SelectRow label="Share with Household" value={row.value ?? ''} onChange={(event) => event.target.value && void change(event.target.value as ShareSetting)}>
          {row.value === null ? (
            <option value="" disabled>
              {row.label}
            </option>
          ) : null}
          <option value="total">{SETTING_LABEL.total}</option>
          <option value="hidden" disabled={!row.hiddenAllowed}>
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
    // The group as it is when the form saves, not as the screen last read it: a joint household's new item is always
    // written `total` (D9), even when the query had not loaded or the mode changed while the form was open.
    const setting = settingOnAdd((await activeNetWorthGroup(database))?.mode ?? null, share);
    if (!setting) return;
    for (const id of accountIds) await setShareSetting(database, id, setting);
  }
  return { element, save };
}
