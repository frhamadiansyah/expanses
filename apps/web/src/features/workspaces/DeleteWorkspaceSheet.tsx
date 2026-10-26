import { type BookDeletePlan, type BookRow, deleteBook } from '@expanses/db';
import { useState } from 'react';
import { Sheet } from '../../app/Sheet';
import { useApp } from '../../app/context';
import { useInvalidateAll } from '../../lib/queries';
import { ErrorBox } from '../../ui';
import { DestructiveRow, InsetGroup, TextRow } from '../../ui/native';
import { ReadRow } from '../networth/listed-trade-parts';

/** Whether what was typed is the workspace's name: case and the spaces around it do not count. */
export function nameMatches(typed: string, name: string): boolean {
  return typed.trim().toLowerCase() === name.trim().toLowerCase() && name.trim() !== '';
}

/**
 * The way out of a workspace that holds transactions: what will go (counted), the name typed to agree, and one
 * centred row in alarm that stays grey until the name matches. A safety copy of the whole database is kept first,
 * where the platform keeps them; if that cannot be done nothing is deleted. Then `deleteBook` voids everything filed
 * in the workspace and removes its budgets, categories and the workspace itself, all or nothing.
 */
export function DeleteWorkspaceSheet({
  book,
  plan,
  onClose,
  onDeleted,
}: {
  book: BookRow;
  plan: BookDeletePlan;
  onClose: () => void;
  onDeleted: () => Promise<void>;
}) {
  const { database, ws, safety } = useApp();
  const invalidate = useInvalidateAll();
  const [typed, setTyped] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const ready = nameMatches(typed, book.name) && !busy;

  const remove = async () => {
    if (!ready) return;
    setBusy(true);
    setError(null);
    try {
      if (safety) {
        try {
          await safety.snapshots.write(await safety.bytes(), 'before-delete', safety.schemaVersion);
        } catch (failure) {
          console.warn('No safety copy could be taken before deleting a workspace', failure);
          throw new Error('A safety copy could not be kept first, so nothing was deleted.');
        }
      }
      await deleteBook(database, ws, book.id);
      await invalidate();
      await onDeleted();
    } catch (failure) {
      setError(failure);
      setBusy(false);
    }
  };

  return (
    <Sheet grouped tall closeOnly title="Delete workspace" onClose={onClose}>
      <InsetGroup>
        <ReadRow label="Workspace" value={book.name} />
        <ReadRow label="Transactions" value={String(plan.transactions)} />
        <ReadRow label="Categories" value={String(plan.categories)} />
        <ReadRow label="Budgets" value={String(plan.budgets)} />
      </InsetGroup>
      <InsetGroup>
        <TextRow
          label="Name"
          value={typed}
          onChange={(event) => setTyped(event.target.value)}
          placeholder="Type the workspace’s name"
          autoCapitalize="off"
          autoCorrect="off"
          enterKeyHint="done"
        />
      </InsetGroup>
      <ErrorBox error={error} />
      <InsetGroup>
        <DestructiveRow testId="delete-everything" label="Delete everything" disabled={!ready} onClick={() => void remove()} />
      </InsetGroup>
    </Sheet>
  );
}
