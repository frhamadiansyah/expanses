import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomBytes } from '../../../packages/db/src/sync/crypto';
import { openChangeSet, sealChangeSet, verifyEntry } from '../../../packages/db/src/sync/seal';
import type { ChangeSet, LogEntry } from '../../../packages/db/src/sync/types';
import { makeDevice, signedInvite, startRelay } from './helpers';

/*
 * Two devices, each with its own `RelayTransport` and real keys, meet through the local Worker: one creates a book
 * and invites, the other previews and claims, both append change-sets sealed under one epoch key and signed (§6.6),
 * and each pulls, verifies and opens the other's. Full
 * database convergence (apply) comes with tasks 3–4; this proves the wire between two devices end to end.
 */

let relay: Awaited<ReturnType<typeof startRelay>>;

beforeAll(async () => {
  relay = await startRelay();
});

afterAll(async () => {
  await relay?.close();
});

function changeSet(member: string, hlc: string, name: string): ChangeSet {
  return { v: 1, hlc, member, ops: [{ entity: 'account', id: `acc-${hlc}`, op: 'upsert', fields: { name } }] };
}

describe('two devices through the local relay', () => {
  it('create, invite, claim, append from both sides, and each pulls the other’s entries', async () => {
    const dewi = await makeDevice(relay.url);
    const fandri = await makeDevice(relay.url);
    const epochKey = randomBytes(32); // what the invite would hand on (§8.1)
    const seal = (d: typeof dewi, set: ChangeSet) => sealChangeSet(d.keys, epochKey, bookId, 1, set);

    const { bookId } = await dewi.transport.createBook(dewi.devicePublic);
    const invite = await signedInvite(dewi);
    await dewi.transport.putInvite(bookId, invite);

    await expect(fandri.transport.previewInvite(invite.inviteId)).resolves.toMatchObject({ claimed: false });
    const claim = await fandri.transport.claimInvite(invite.inviteId, fandri.devicePublic);
    expect(claim).toMatchObject({ bookId, epoch: 1 });

    const sent: Array<[LogEntry, ChangeSet]> = [];
    const dewiSet = changeSet('m-dewi', '0001-dewi', 'Groceries');
    const fandriSet = changeSet('m-fandri', '0002-fandri', 'Rent');
    const dewiEntry = await seal(dewi, dewiSet);
    const fandriEntry = await seal(fandri, fandriSet);
    expect(dewiEntry.deviceId).toBe(dewi.deviceId);
    sent.push([dewiEntry, dewiSet], [fandriEntry, fandriSet]);

    await expect(dewi.transport.append(bookId, dewiEntry)).resolves.toEqual({ seq: 1 });
    await expect(fandri.transport.append(bookId, fandriEntry)).resolves.toEqual({ seq: 2 });
    // An outbox retried after a lost response is harmless.
    await expect(fandri.transport.append(bookId, fandriEntry)).resolves.toEqual({ seq: 2 });

    for (const reader of [dewi, fandri]) {
      const { entries, latest } = await reader.transport.pull(bookId, 0);
      expect(latest).toBe(2);
      expect(entries.map((e) => e.deviceId)).toEqual([dewi.deviceId, fandri.deviceId]);
      const opened = await Promise.all(
        entries.map((e) => (e.kind === 'change' ? openChangeSet(epochKey, bookId, e) : Promise.reject(new Error(e.kind)))),
      );
      for (const e of entries) await expect(verifyEntry(e.signJwk, e)).resolves.toBe(true);
      expect(opened).toEqual(sent.map(([, set]) => set));
      expect(entries[0]?.signJwk).toEqual(dewi.devicePublic.signJwk);
      expect(entries[1]?.signJwk).toEqual(fandri.devicePublic.signJwk);
    }

    // Each resumes from its own applied seq.
    await expect(dewi.transport.pull(bookId, 2)).resolves.toEqual({ entries: [], latest: 2 });
  });
});

