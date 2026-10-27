import type { BookRow, CreatedInvite } from '@expanses/db';
import { useState, useSyncExternalStore } from 'react';
import { useArchivedBooks, useBooks } from '../workspaces/queries';
import { sayError } from './sharing-copy';

/** The workspace a Share page belongs to, once the lists have loaded: `undefined` while they load, `null` if there is none. */
export function useShareBook(bookId: string): BookRow | null | undefined {
  const books = useBooks();
  const archived = useArchivedBooks();
  const found = [...(books.data ?? []), ...(archived.data ?? [])].find((each) => each.id === bookId);
  if (found) return found;
  return books.isSuccess && archived.isSuccess ? null : undefined;
}

/**
 * One action at a time, with its failure said in words: the shape every button on the Share pages runs through.
 * Returns whether the work finished, so a caller can follow it.
 */
export function useActionRunner() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  async function run(work: () => Promise<void>): Promise<boolean> {
    if (busy) return false;
    setBusy(true);
    setError(null);
    try {
      await work();
      return true;
    } catch (failure) {
      setError(sayError(failure));
      return false;
    } finally {
      setBusy(false);
    }
  }
  return { busy, error, setError, run };
}

/*
 * The invite made when a workspace was shared, kept while this app is open so the Share page still shows it after a
 * visit to a member or to Net worth. It is the person's to read out; once somebody joins the page stops showing it.
 */
const open = new Map<string, CreatedInvite>();
const listeners = new Set<() => void>();

export function keepOpenInvite(bookId: string, invite: CreatedInvite | null): void {
  if (invite) open.set(bookId, invite);
  else open.delete(bookId);
  for (const listener of listeners) listener();
}

export function useOpenInvite(bookId: string): CreatedInvite | null {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => void listeners.delete(listener);
    },
    () => open.get(bookId) ?? null,
  );
}
