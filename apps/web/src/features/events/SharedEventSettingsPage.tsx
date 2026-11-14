import { finishSharedEvent, ownerScope, planEventCopyDelete, setSharedEventSwitches, type SharedEventView } from '@expanses/db';
import { useNavigate, useParams } from '@tanstack/react-router';
import { useState } from 'react';
import { useApp } from '../../app/context';
import { useInvalidateAll } from '../../lib/queries';
import { cx, ErrorBox } from '../../ui';
import { DestructiveRow, InsetGroup, InsetRow, PushedTitle, SCREEN, SwitchRow } from '../../ui/native';
import { ALERT_ROW, NoticeAlert } from '../../ui/native/NoticeAlert';
import { useSafetyCopy } from '../workspaces/safety-copy';
import { sayError } from '../sharing/sharing-copy';
import { deleteEventCopyFlow } from './delete-copy';
import { useSharedEventView } from './shared-queries';
import { askBeforeOnePot, categoriesValue, peopleValue, SPLIT_COSTS_FOOTER, sharedSettings, stopSplittingText } from './shared-settings';

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
  const settings = sharedSettings(view);
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
        <InsetGroup footer={SPLIT_COSTS_FOOTER}>
          <SwitchRow
            label="Split costs"
            checked={view.splitCosts}
            disabled={settings.switches.disabled}
            testId="shared-settings-split"
            // Off with someone owing asks first: the splits are kept, only hidden.
            onChange={(on) => (!on && askBeforeOnePot(view) ? setAsking(true) : void switches({ splitCosts: on }))}
          />
          <SwitchRow label="Plan" checked={!view.planOff} disabled={settings.switches.disabled} testId="shared-settings-plan" onChange={(on) => void switches({ plan: on })} />
        </InsetGroup>
      ) : null}
      <InsetGroup>
        <InsetRow title="People" plain value={peopleValue(view)} to="/events/$eventId/people" params={params} testId="shared-settings-people" />
        {settings.categories ? <InsetRow title="Categories" plain value={categoriesValue(view)} to="/events/$eventId/categories" params={params} testId="shared-settings-categories" /> : null}
      </InsetGroup>
      {settings.done ? (
        <InsetGroup footer={settings.done.footer}>
          <InsetRow title={settings.done.label} action onClick={() => void run(() => finishSharedEvent(database, ownerScope(ws), view.eventId, !settings.done!.finished))} testId="shared-settings-done" />
        </InsetGroup>
      ) : null}
      {settings.leave ? (
        <InsetGroup footer={settings.leave.footer ?? undefined}>
          <DestructiveRow
            label={settings.leave.label}
            disabled={settings.leave.disabled}
            testId="shared-settings-leave"
            onClick={() => {
              if (window.confirm(`Leave ${view.name}? What ${view.myName} recorded stays with the others, and ${view.myName}'s own books keep their share.`)) void run(() => sync.leaveEvent(view.bookId));
            }}
          />
        </InsetGroup>
      ) : null}
      {settings.deleteCopy ? (
        <InsetGroup footer={settings.deleteCopy.footer ?? undefined}>
          <DestructiveRow
            label={settings.deleteCopy.label}
            disabled={settings.deleteCopy.disabled}
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
        </InsetGroup>
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
              className={cx(ALERT_ROW, 'font-semibold text-[var(--ph-alarm)]')}
            >
              Stop splitting
            </button>
          }
        />
      ) : null}
    </>
  );
}
