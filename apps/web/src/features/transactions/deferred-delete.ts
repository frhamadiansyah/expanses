import { useEffect, useReducer, useRef } from 'react';

/**
 * A swipe's Delete, held back while its Undo toast is up.
 *
 * Deleting a transaction is not a flag that can simply be flipped back: a void takes a tagged transfer's arrival back
 * out of its goal, undoes a set-aside answer, voids a paid-off settlement with it, reopens a deposit event, marks a
 * foreign account's later outflows for recalculation and tells a household partner's phone. Putting all of that back
 * exactly is not something the ledger offers, and a half-restore would leave money where it should not be. So the
 * swipe deletes nothing at first: the row leaves the list (`pending`), the toast says "Deleted …" with Undo, and only
 * when the toast goes (`expire`) — or the list is left, or another delete takes the toast (`flush`) — is the delete
 * written. Undo before then is exact because nothing was ever written.
 */
export interface DeferredDeletes {
  /** The transactions waiting out their toast: drawn as gone. */
  pending: () => ReadonlySet<string>;
  /** The one the toast is about, and what it says. */
  shown: () => { id: string; text: string } | null;
  /** The swipe: hide it and offer Undo. A delete already waiting is written first, so only one toast is ever up. */
  begin: (id: string, text: string) => Promise<void>;
  /** Undo: the transaction is back, and nothing was written. */
  undo: () => void;
  /** The toast went by itself: now it is deleted. */
  expire: () => Promise<void>;
  /** Write every delete still waiting — the list is being left. */
  flush: () => Promise<void>;
}

export function createDeferredDeletes(opts: {
  /** Writes one delete. */
  commit: (id: string) => Promise<void>;
  /** After a delete is written: the list is read again, so the row stays gone without being drawn from `pending`. */
  settled: () => Promise<unknown>;
  /** A delete the ledger refused: said on the screen, and the row comes back. */
  failed: (error: unknown) => void;
  /** Something above changed: the screen draws again. */
  changed: () => void;
}): DeferredDeletes {
  const pending = new Set<string>();
  let shown: { id: string; text: string } | null = null;

  async function write(id: string) {
    try {
      await opts.commit(id);
      await opts.settled();
    } catch (error) {
      opts.failed(error);
    } finally {
      pending.delete(id);
      opts.changed();
    }
  }

  return {
    pending: () => pending,
    shown: () => shown,
    begin(id, text) {
      const earlier = shown;
      pending.add(id);
      shown = { id, text };
      opts.changed();
      return earlier && earlier.id !== id ? write(earlier.id) : Promise.resolve();
    },
    undo() {
      if (!shown) return;
      pending.delete(shown.id);
      shown = null;
      opts.changed();
    },
    expire() {
      if (!shown) return Promise.resolve();
      const { id } = shown;
      shown = null;
      opts.changed();
      return write(id);
    },
    async flush() {
      shown = null;
      await Promise.all([...pending].map(write));
    },
  };
}

/** `createDeferredDeletes` for a screen: one for its life, and whatever is still waiting is written as it is left. */
export function useDeferredDeletes(commit: (id: string) => Promise<void>, settled: () => Promise<unknown>, failed: (error: unknown) => void): DeferredDeletes {
  const [, redraw] = useReducer((n: number) => n + 1, 0);
  const latest = useRef({ commit, settled, failed });
  latest.current = { commit, settled, failed };
  const deletes = useRef<DeferredDeletes | null>(null);
  deletes.current ??= createDeferredDeletes({
    commit: (id) => latest.current.commit(id),
    settled: () => latest.current.settled(),
    failed: (error) => latest.current.failed(error),
    changed: redraw,
  });
  useEffect(() => {
    const own = deletes.current!;
    return () => void own.flush();
  }, []);
  return deletes.current;
}
