import type { SqlExecutor } from '@expanses/db';

interface Reply {
  id: number;
  result?: unknown;
  error?: string;
}

export function createWorkerExecutor(worker: Worker): SqlExecutor {
  let nextId = 0;
  const pending = new Map<number, { resolve: (value: unknown) => void; reject: (error: Error) => void }>();

  worker.onmessage = (event: MessageEvent<Reply>) => {
    const waiter = pending.get(event.data.id);
    if (!waiter) return;
    pending.delete(event.data.id);
    if (event.data.error !== undefined) waiter.reject(new Error(event.data.error));
    else waiter.resolve(event.data.result);
  };
  worker.onerror = (event) => {
    for (const waiter of pending.values()) waiter.reject(new Error(event.message || 'SQLite worker failed'));
    pending.clear();
  };

  const call = (message: Record<string, unknown>, transfer: Transferable[] = []) =>
    new Promise<unknown>((resolve, reject) => {
      const id = ++nextId;
      pending.set(id, { resolve, reject });
      worker.postMessage({ ...message, id }, transfer);
    });

  return {
    query: (sql, params, method) => call({ op: 'query', sql, params, method }),
    execScript: async (sql) => {
      await call({ op: 'script', sql });
    },
    exportBytes: async () => (await call({ op: 'export' })) as Uint8Array,
    importBytes: async (bytes) => {
      const copy = bytes.slice();
      await call({ op: 'import', bytes: copy }, [copy.buffer]);
    },
  };
}
