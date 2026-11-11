import { forgetSharedBookRowForTest } from '@expanses/db';
import { useState } from 'react';
import { useApp } from '../../app/context';
import { Sheet } from '../../app/Sheet';
import { useInvalidateAll } from '../../lib/queries';
import { ErrorBox } from '../../ui';
import { InsetGroup, InsetRow, LargeTitle, SCREEN, SwitchRow } from '../../ui/native';
import { setPreviewEntitlement, useEntitlement } from '../../lib/entitlements';
import { useSharedBooks } from '../sharing/queries';
import { useBooks } from './queries';

/**
 * Developer settings — linked from nowhere on purpose, reached by its address (`/settings/developer`). It holds what
 * the owner switches on before the app can sell it: today, the US ticker list (the owner's ruling, 2026-09-21).
 * When store purchases exist, the switch goes and the purchase grants the same entitlement.
 *
 * A diagnostic build (CICIS_INSPECTABLE=1) adds the sharing test below; any other build has none of it.
 */
export function DeveloperSettingsPage() {
  const foreign = useEntitlement('foreign_securities');
  return (
    <div className={SCREEN}>
      <LargeTitle title="Developer" back="Account" backTo="/account" />
      <InsetGroup
        header="Previews"
        footer="On this device only. Turning it off keeps every holding already added from the list; search just stops finding new US tickers."
      >
        <SwitchRow label="US ticker list" hint="The paid list, before purchases exist." checked={foreign} onChange={(on) => setPreviewEntitlement('foreign_securities', on)} />
      </InsetGroup>
      {import.meta.env.VITE_INSPECTABLE === '1' ? <ForgetSharingRows /> : null}
    </div>
  );
}

/**
 * The device checklist's lost share (sharing resilience plan, Task A10): a workspace's `shared_books` row is deleted
 * and nothing else — its share record outside the database stays — so the next open finds the share `lost`. Asked first.
 */
function ForgetSharingRows() {
  const { database } = useApp();
  const invalidate = useInvalidateAll();
  const shared = useSharedBooks();
  const books = useBooks();
  const [asking, setAsking] = useState<{ bookId: string; name: string } | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const [error, setError] = useState<unknown>(null);
  const nameOf = (bookId: string) => (books.data ?? []).find((book) => book.id === bookId)?.name ?? bookId.slice(0, 8);
  const rows = (shared.data ?? []).map((book) => ({ bookId: book.bookId, name: nameOf(book.bookId) }));

  async function forget(bookId: string) {
    setError(null);
    try {
      await forgetSharedBookRowForTest(database, bookId);
      await invalidate();
      setDone('Sharing row deleted. Close and open the app to see what the open finds.');
    } catch (failure) {
      setError(failure);
    }
  }

  return (
    <>
      <ErrorBox error={error} />
      <InsetGroup
        header="Sharing test (diagnostic build)"
        footer={done ?? 'Deletes one workspace’s sharing row on this device and nothing else, so the next open finds its share lost. For the device checklist only.'}
      >
        {rows.length === 0 ? <InsetRow title="No shared workspace here" chevron={false} /> : null}
        {rows.map((row) => (
          <InsetRow key={row.bookId} testId="dev-forget-sharing-row" title={`Forget sharing rows: ${row.name}`} chevron={false} onClick={() => setAsking(row)} />
        ))}
      </InsetGroup>
      {asking ? (
        <Sheet
          title="Forget sharing rows?"
          onClose={() => setAsking(null)}
          confirm={{
            label: 'Forget',
            run: () => {
              const target = asking;
              setAsking(null);
              void forget(target.bookId);
            },
          }}
        >
          <p className="text-[15px] leading-[20px]">{`The sharing row of ${asking.name} is deleted on this device. Its rows and its share record stay. A test of what the next open finds.`}</p>
        </Sheet>
      ) : null}
    </>
  );
}
