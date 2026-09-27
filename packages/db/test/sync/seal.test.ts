import { describe, expect, it } from 'vitest';
import { IdentitySealer, stubSign } from '../../src/sync/seal';
import type { ChangeSet } from '../../src/sync/types';

const changeSet: ChangeSet = {
  v: 1,
  hlc: '000001912d59a2ac0000-device-a',
  member: 'member-1',
  ops: [{ entity: 'category', id: 'cat-1', op: 'upsert', fields: { name: 'Belanja 🍜' } }],
};

describe('IdentitySealer', () => {
  it('seals a change-set into a kind:change entry carrying the sealer device id, epoch and the change-set hlc', async () => {
    const sealer = new IdentitySealer('device-a');
    const entry = await sealer.seal('book-1', 3, changeSet);
    expect(entry.kind).toBe('change');
    expect(entry.deviceId).toBe('device-a');
    expect(entry.epoch).toBe(3);
    expect(entry.hlc).toBe(changeSet.hlc);
    expect(entry.sig).toBe(stubSign('device-a'));
  });

  it('opens back to the exact original change-set', async () => {
    const sealer = new IdentitySealer('device-a');
    const entry = await sealer.seal('book-1', 1, changeSet);
    await expect(sealer.open('book-1', entry)).resolves.toEqual(changeSet);
  });

  it('verify accepts its own stub signature and rejects a tampered or foreign one', async () => {
    const sealer = new IdentitySealer('device-a');
    const entry = await sealer.seal('book-1', 1, changeSet);
    await expect(sealer.verify(entry)).resolves.toBe(true);
    await expect(sealer.verify({ ...entry, sig: stubSign('someone-else') })).resolves.toBe(false);
    await expect(sealer.verify({ ...entry, sig: 'garbage' })).resolves.toBe(false);
  });

  it("ct never touches Node's Buffer — it's plain base64url of the JSON", async () => {
    const sealer = new IdentitySealer('device-a');
    const entry = await sealer.seal('book-1', 1, changeSet);
    expect(entry.ct).not.toMatch(/[+/=]/);
  });
});
