import { describe, expect, it } from 'vitest';
import { MemoryShareRecordStore, parseShareRecord, type ShareRecord } from '../../src/index';

/*
 * Spec §6.1 (D-B1): a share record per shared book, kept beside the device keys and outside the database. The memory
 * store is the reference the web and native stores match; `parseShareRecord` is the one gate every stored record
 * passes on the way back in.
 */

const record = (bookId: string, over: Partial<ShareRecord> = {}): ShareRecord => ({
  v: 1, bookId, relayBookId: `relay-${bookId}`, memberId: 'member-a', deviceId: 'device-a', role: 'owner',
  bookName: 'Home', bookKind: 'family', workspaceId: 'ws-1', baseCurrency: 'IDR',
  epochKeys: [{ epoch: 1, sealed: '{"x":1}' }], appliedSeq: 0, updatedAt: '2026-11-11T00:00:00.000Z', ...over,
});

describe('MemoryShareRecordStore', () => {
  it('puts, replaces, lists and removes by book id', async () => {
    const store = new MemoryShareRecordStore();
    await store.put(record('b1'));
    await store.put(record('b2'));
    await store.put(record('b1', { appliedSeq: 7 }));
    expect((await store.list()).map((r) => [r.bookId, r.appliedSeq]).sort()).toEqual([['b1', 7], ['b2', 0]]);
    await store.remove('b1');
    expect(await store.get('b1')).toBeNull();
    expect((await store.list()).map((r) => r.bookId)).toEqual(['b2']);
  });
  it('hands out copies, never its own objects', async () => {
    const store = new MemoryShareRecordStore();
    await store.put(record('b1'));
    const got = (await store.get('b1'))!;
    got.epochKeys.push({ epoch: 2, sealed: 'tampered' });
    expect((await store.get('b1'))!.epochKeys).toHaveLength(1);
  });
  it('keeps a copy of what it was given, so a later change by the caller does not reach it', async () => {
    const store = new MemoryShareRecordStore();
    const given = record('b1');
    await store.put(given);
    given.epochKeys[0]!.sealed = 'changed';
    (await store.list())[0]!.epochKeys.length = 0;
    expect((await store.get('b1'))!.epochKeys).toEqual([{ epoch: 1, sealed: '{"x":1}' }]);
  });
  it('removing a book it does not hold is a no-op', async () => {
    const store = new MemoryShareRecordStore();
    await store.put(record('b1'));
    await store.remove('nope');
    expect((await store.list()).map((r) => r.bookId)).toEqual(['b1']);
  });
});

describe('parseShareRecord', () => {
  it('reads a v1 record and refuses anything else', () => {
    expect(parseShareRecord(record('b1'))).toEqual(record('b1'));
    expect(parseShareRecord({ ...record('b1'), v: 2 })).toBeNull();
    expect(parseShareRecord({ ...record('b1'), epochKeys: [{ epoch: '1', sealed: 'x' }] })).toBeNull();
    expect(parseShareRecord('nonsense')).toBeNull();
  });
  it('refuses a record with any field missing or mistyped', () => {
    const fields = Object.keys(record('b1')) as (keyof ShareRecord)[];
    for (const field of fields) {
      const { [field]: _dropped, ...rest } = record('b1');
      expect(parseShareRecord(rest), `without ${field}`).toBeNull();
    }
    expect(parseShareRecord({ ...record('b1'), role: 'admin' })).toBeNull();
    expect(parseShareRecord({ ...record('b1'), bookId: '' })).toBeNull();
    expect(parseShareRecord({ ...record('b1'), appliedSeq: -1 })).toBeNull();
    expect(parseShareRecord({ ...record('b1'), appliedSeq: 1.5 })).toBeNull();
    expect(parseShareRecord({ ...record('b1'), epochKeys: 'x' })).toBeNull();
    expect(parseShareRecord({ ...record('b1'), epochKeys: [null] })).toBeNull();
    expect(parseShareRecord({ ...record('b1'), epochKeys: [{ epoch: 1 }] })).toBeNull();
    expect(parseShareRecord(null)).toBeNull();
    expect(parseShareRecord([record('b1')])).toBeNull();
  });
  it('keeps the sealed keys byte for byte and drops fields it does not know', () => {
    const sealed = '{"deviceId":"d","iv":"AAEC","ct":"/+==","epk":{"kty":"EC"}}';
    const parsed = parseShareRecord({ ...record('b1', { epochKeys: [{ epoch: 3, sealed }] }), extra: 'x' });
    expect(parsed).toEqual(record('b1', { epochKeys: [{ epoch: 3, sealed }] }));
    expect(parsed!.epochKeys[0]!.sealed).toBe(sealed);
  });
  it('reads a member record with no epoch keys yet', () => {
    expect(parseShareRecord(record('b1', { role: 'member', epochKeys: [] }))).toEqual(record('b1', { role: 'member', epochKeys: [] }));
  });
});
