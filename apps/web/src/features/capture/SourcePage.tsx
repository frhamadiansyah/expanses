import { deleteSource, resetSourceTemplate, setSourceAccount } from '@expanses/db';
import { useNavigate, useParams } from '@tanstack/react-router';
import { useState } from 'react';
import { useApp } from '../../app/context';
import { moneyHolders, useAccounts, useInvalidateAll } from '../../lib/queries';
import { ErrorBox } from '../../ui';
import { DestructiveRow, InsetGroup, InsetRow, LargeTitle, SCREEN, SelectRow } from '../../ui/native';
import { useCaptureSources } from '../review/queries';

/**
 * One capture source: what it is, whose it is, and what it has learned.
 *
 * A source is an app, for notifications, or the layout of a screen, for images. The account it files into is the
 * answer to "Which account is this?", editable here; Reset forgets where the fields sat, for a screen whose layout
 * changed under a learned template; Delete forgets the source itself, so its next capture asks the account
 * question again.
 */
export function SourcePage() {
  const { sourceId } = useParams({ from: '/settings/capture/sources/$sourceId' });
  const { database, ws } = useApp();
  const navigate = useNavigate();
  const invalidate = useInvalidateAll();
  const sources = useCaptureSources();
  const accounts = useAccounts().data ?? [];
  const money = moneyHolders(accounts);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);

  const source = (sources.data ?? []).find((row) => row.id === sourceId) ?? null;
  if (!source) {
    return (
      <div className={SCREEN}>
        <LargeTitle title="Capture source" back="Capture" backTo="/settings/capture" />
        <ErrorBox error={sources.error} />
        {sources.isSuccess && (
          <InsetGroup>
            <InsetRow title="That source is not on this phone." chevron={false} />
          </InsetGroup>
        )}
      </div>
    );
  }

  async function run(work: () => Promise<void>) {
    setError(null);
    setBusy(true);
    try {
      await work();
      await invalidate();
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className={SCREEN}>
      <LargeTitle title={source.label} back="Capture" backTo="/settings/capture" />
      <ErrorBox error={error ?? sources.error} />

      <InsetGroup header="Recognised as">
        <InsetRow
          title={source.keyKind === 'app' ? 'An app' : 'A screen layout'}
          subtitle={source.keyKind === 'app' ? source.key : 'The top band of the screen, recognised again by its words'}
          chevron={false}
        />
        <InsetRow title="Captures so far" value={String(source.capturedCount)} chevron={false} />
      </InsetGroup>

      <InsetGroup
        header="Files captures into"
        footer="Answered once here, every capture of this source is filed there — until the account is archived, when it asks again."
      >
        <SelectRow
          label="Account"
          value={source.accountId ?? ''}
          onChange={(event) => {
            const accountId = event.target.value;
            if (!accountId) return;
            void run(() => setSourceAccount(database, source.id, accountId, ws.workspaceId));
          }}
        >
          <option value="">No account yet</option>
          {money.map((account) => (
            <option key={account.id} value={account.id}>{`${account.name} (${account.currency})`}</option>
          ))}
        </SelectRow>
      </InsetGroup>

      <InsetGroup header="What it learned" footer="Resetting forgets where the fields sat — the account stays. The next correction teaches it again.">
        <InsetRow
          title="Reset the layout"
          subtitle={source.template ? 'Forget where the fields sit.' : 'Nothing learned yet.'}
          chevron={false}
          className={busy ? 'opacity-40' : undefined}
          onClick={() => void run(() => resetSourceTemplate(database, source.id))}
        />
      </InsetGroup>

      <InsetGroup>
        <DestructiveRow
          label="Delete this source"
          onClick={() =>
            void run(async () => {
              await deleteSource(database, source.id);
              void navigate({ to: '/settings/capture' });
            })
          }
        />
      </InsetGroup>
    </div>
  );
}
