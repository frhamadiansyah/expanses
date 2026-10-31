import { writeWithSyncHandle } from './safety-write';

/** One file written into a folder beside the pool, for a main thread with no `createWritable`. See `safety-write.ts`. */
self.onmessage = async (event: MessageEvent<{ folder: string; file: string; bytes: Uint8Array }>) => {
  const { folder, file, bytes } = event.data;
  try {
    await writeWithSyncHandle(await navigator.storage.getDirectory(), folder, file, bytes);
    postMessage({ ok: true });
  } catch (error) {
    const named = error as { name?: string; message?: string };
    postMessage({ error: named?.message ? `${named.name && named.name !== 'Error' ? `${named.name}: ` : ''}${named.message}` : String(error) });
  }
};
