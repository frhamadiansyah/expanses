import { isoDate } from '@expanses/core';
import { finishSharedEvent, ownerScope, planEventCopyDelete, setSharedEventSwitches, type SharedEventView } from '@expanses/db';
import { useNavigate, useParams } from '@tanstack/react-router';
import { useState } from 'react';
import { useApp } from '../../app/context';
import { useInvalidateAll } from '../../lib/queries';
import { cx, ErrorBox } from '../../ui';
import { InsetGroup, PushedTitle, SCREEN, SwitchRow } from '../../ui/native';
import { ALERT_ROW, NoticeAlert } from '../../ui/native/NoticeAlert';
import { useSafetyCopy } from '../workspaces/safety-copy';
import { sayError } from '../sharing/sharing-copy';
import { deleteEventCopyFlow } from './delete-copy';
import { SettingsActionGroup, SettingsPickerRow } from './EventSettingsRows';
import { useSharedEventView } from './shared-queries';
import { askBeforeOnePot, categoriesValue, peopleValue, sharedSettings, stopSplittingText } from './shared-settings';

/**
 * A shared trip's Settings (owner, 14 Nov 2026): what the ⚙ on its page opens, as a private event's gear opens its own.
 * The trip's two switches — Split costs and Plan, the same on every phone — then People and Categories, Mark as done
 * (or Reopen), and Leave last, in red. A copy this person is no longer in keeps People and Delete this copy.
 */
export function SharedEventSettingsPage() {
  const { eventId } = useParams({ from: '/events/$eventId/shared-settings' });
  const shared = useSharedEventView(eventId);
  const view = shared.data ?? null;
  return (
    <div className={SCREEN} data-testid="shared-settings">
      <PushedTitle title="Settings" back={view?.name ?? 'Back'} backTo="/events/$eventId" backParams={{ eventId }} />
      <ErrorBox error={shared.error} />
      {view ? <SettingsBody view={view} /> : null}
    </div>
  );
}

function SettingsBody({ view }: { view: SharedEventView }) {
  const { database, ws, sync } = useApp();
  const invalidate = useInvalidateAll();
  const navigate = useNavigate();
  const safetyCopy = useSafetyCopy('before-delete');
  const [error, setError] = useState<unknown>(null);
  const [asking, setAsking] = useState(false);
  const settings = sharedSettings(view, isoDate());
  const params = { eventId: view.eventId };

  const run = async (work: () => Promise<unknown>) => {
    setError(null);
    try {
      await work();
      await invalidate();
    } catch (failure) {
      setError(sayError(failure));
    }
  };
  const switches = (to: { splitCosts?: boolean; plan?: boolean }) => run(() => setSharedEventSwitches(database, ownerScope(ws), view.eventId, to));

  return (
    <>
      <ErrorBox error={error} />
      {settings.switches.shown ? (
        <InsetGroup footer={settings.switches.footer}>
          <SwitchRow
            label="Split costs"
            checked={view.splitCosts}
            disabled={settings.switches.disabled || settings.switches.splitWaits}
            testId="shared-settings-split"
            // Off with someone owing asks first: the splits are kept, only hidden.
            onChange={(on) => (!on && askBeforeOnePot(view) ? setAsking(true) : void switches({ splitCosts: on }))}
          />
          <SwitchRow label="Plan" checked={!view.planOff} disabled={settings.switches.disabled} testId="shared-settings-plan" onChange={(on) => void switches({ plan: on })} />
        </InsetGroup>
      ) : null}
      <InsetGroup>
        <SettingsPickerRow title="People" value={peopleValue(view)} locked={false} onOpen={() => void navigate({ to: '/events/$eventId/people', params })} testId="shared-settings-people" />
        {settings.categories ? (
          <SettingsPickerRow title="Categories" value={categoriesValue(view)} locked={false} onOpen={() => void navigate({ to: '/events/$eventId/categories', params })} testId="shared-settings-categories" />
        ) : null}
      </InsetGroup>
      {settings.done ? (
        <SettingsActionGroup
          label={settings.done.label}
          footer={settings.done.footer}
          testId="shared-settings-done"
          onClick={() => void run(() => finishSharedEvent(database, ownerScope(ws), view.eventId, !settings.done!.finished))}
        />
      ) : null}
      {settings.leave ? (
        <SettingsActionGroup
          destructive
          label={settings.leave.label}
          disabled={settings.leave.disabled}
          {...(settings.leave.footer ? { footer: settings.leave.footer } : {})}
          testId="shared-settings-leave"
          onClick={() => {
            if (window.confirm(`Leave ${view.name}? What ${view.myName} recorded stays with the others, and ${view.myName}'s own books keep their share.`)) void run(() => sync.leaveEvent(view.bookId));
          }}
        />
      ) : null}
      {settings.deleteCopy ? (
        <SettingsActionGroup
          destructive
          label={settings.deleteCopy.label}
          disabled={settings.deleteCopy.disabled}
          {...(settings.deleteCopy.footer ? { footer: settings.deleteCopy.footer } : {})}
          testId="shared-settings-delete-copy"
          onClick={() =>
            void run(async () => {
              const done = await deleteEventCopyFlow(view, {
                plan: () => planEventCopyDelete(database, ws, view.bookId),
                confirm: (text) => window.confirm(text),
                safetyCopy,
                remove: () => sync.deleteEventCopy(ws, view.bookId),
              });
              if (done === 'deleted') void navigate({ to: '/events', replace: true });
            })
          }
        />
      ) : null}
      {asking ? (
        <NoticeAlert
          title="Stop splitting costs?"
          text={stopSplittingText(view)}
          closeLabel="Cancel"
          onClose={() => setAsking(false)}
          actions={
            <button
              type="button"
              data-testid="stop-splitting"
              onClick={() => {
                setAsking(false);
                void switches({ splitCosts: false });
              }}
              className={cx(ALERT_ROW, 'font-semibold')}
              // The row's own ink is the alert's; this one is the alarm, as a destructive choice is drawn.
              style={{ color: 'var(--ph-alarm)' }}
            >
              Stop splitting
            </button>
          }
        />
      ) : null}
    </>
  );
}
