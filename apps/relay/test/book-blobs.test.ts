import { describe, expect, it } from 'vitest';
import { generateDevice } from '../../../packages/db/src/sync/keys';
import { bytesToBase64Url, sha256Hex } from '../../../packages/db/src/sync/relay-signing';
import { MAX_BOOK_BLOBS } from '../../../packages/db/src/self/transport';
import { Book, type BookStore } from '../src/book';

/*
 * Link my devices, review fix: a blob put works from a small index of the book's blobs (size, expiry), never by
 * listing every blob with its data. The Book class over a store in memory, the listings it asks for recorded.
 */

function memoryStore() {
  const data = new Map<string, unknown>();
  const listed: string[] = [];
  const store: BookStore = {
    get: async <T>(key: string) => structuredClone(data.get(key)) as T | undefined,
    put: async (entries) => {
      for (const [key, value] of Object.entries(entries)) data.set(key, structuredClone(value));
    },
    list: async <T>({ prefix }: { prefix: string }) => {
      listed.push(prefix);
      return new Map([...data].filter(([key]) => key.startsWith(prefix)) as [string, T][]);
    },
    delete: async (keys) => keys.filter((key) => data.delete(key)).length,
  };
  return { store, data, listed };
}

async function blob(n: number) {
  const bytes = new TextEncoder().encode(`test blob ${n}`);
  return { hash: await sha256Hex(bytes), data: bytesToBase64Url(bytes) };
}

describe('a self book’s blobs', () => {
  it('are counted from the index: no blob listing, expired ones go, a delete frees its place, and the count is capped', async () => {
    let now = Date.parse('2026-11-21T08:00:00Z');
    const { store, data, listed } = memoryStore();
    const book = new Book(store, async () => true, () => new Date(now));
    const device = await generateDevice();
    await book.create('book-1', device.public, device.deviceId, { self: true });
    const soon = new Date(now + 60 * 60 * 1000).toISOString();
    const later = new Date(now + 3 * 24 * 60 * 60 * 1000).toISOString();

    const first = await blob(1);
    await book.putBlob(first.hash, first.data, soon, device.deviceId);
    const second = await blob(2);
    await book.putBlob(second.hash, second.data, later, device.deviceId);
    expect(Object.keys(data.get('blobs') as object).sort()).toEqual([first.hash, second.hash].sort());

    // Two hours on, the first has run out: the next put drops it, data and index both.
    now += 2 * 60 * 60 * 1000;
    const third = await blob(3);
    await book.putBlob(third.hash, third.data, later, device.deviceId);
    expect(data.has(`blob:${first.hash}`)).toBe(false);
    expect(Object.keys(data.get('blobs') as object).sort()).toEqual([second.hash, third.hash].sort());
    await book.deleteBlob(second.hash, device.deviceId);
    expect(Object.keys(data.get('blobs') as object)).toEqual([third.hash]);
    expect((data.get('meta') as { blobBytes: number }).blobBytes).toBe(new TextEncoder().encode('test blob 3').length);

    // Filled to the cap, one more is refused until one goes.
    for (let n = 4; Object.keys(data.get('blobs') as object).length < MAX_BOOK_BLOBS; n += 1) {
      const b = await blob(n);
      await book.putBlob(b.hash, b.data, later, device.deviceId);
    }
    const over = await blob(99_999);
    await expect(book.putBlob(over.hash, over.data, later, device.deviceId)).rejects.toMatchObject({ status: 413 });
    await book.deleteBlob(third.hash, device.deviceId);
    await book.putBlob(over.hash, over.data, later, device.deviceId);
    // The whole index, a thousand blobs, stays one small value (a Durable Object value holds 128 KiB).
    expect(JSON.stringify(data.get('blobs')).length).toBeLessThan(110 * 1024);
    expect(listed.filter((prefix) => prefix.startsWith('blob'))).toEqual([]);
  });

  it('are not kept for a household book', async () => {
    const { store } = memoryStore();
    const book = new Book(store, async () => true);
    const device = await generateDevice();
    await book.create('book-2', device.public, device.deviceId);
    const b = await blob(1);
    await expect(book.putBlob(b.hash, b.data, new Date(Date.now() + 60_000).toISOString(), device.deviceId)).rejects.toMatchObject({ status: 400 });
    await expect(book.getBlob(b.hash, device.deviceId)).rejects.toMatchObject({ status: 400 });
  });
});
