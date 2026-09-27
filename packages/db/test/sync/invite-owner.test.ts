import { describe, expect, it } from 'vitest';
import { Household } from './household';

/*
 * Invites are an owner's (spec §8.1, §8.3, task 7 fix round 1): the relay refuses a non-owner's putInvite with 403, so
 * the engine refuses first, with a typed error the screens can word, and asks the authority view — never this
 * device's own rows — who is an owner.
 */

describe('who may invite', () => {
  it('an owner invites and links a device, including straight after sharing', async () => {
    const home = new Household();
    const fandri = await home.device('Fandri');
    const bookId = await home.share(fandri);
    await expect(fandri.engine.createInvite(bookId, { inviterName: 'Fandri' })).resolves.toMatchObject({ code: expect.any(String) });
    await expect(fandri.engine.linkDevice(bookId, { inviterName: 'Fandri' })).resolves.toMatchObject({ code: expect.any(String) });
  });

  it('a member is refused before anything reaches the relay, for a new person and for their own device alike', async () => {
    const home = new Household();
    const fandri = await home.device('Fandri');
    const dewi = await home.device('Dewi');
    const bookId = await home.share(fandri);
    await home.join(dewi, fandri);
    await home.settle();
    const invitesBefore = home.relay.peek(home.relayBookId)!.invites.size;
    await expect(dewi.engine.linkDevice(bookId, { inviterName: 'Dewi' })).rejects.toMatchObject({ name: 'SharingError', code: 'NOT_OWNER' });
    await expect(dewi.engine.createInvite(bookId, { inviterName: 'Dewi' })).rejects.toMatchObject({ code: 'NOT_OWNER' });
    expect(home.relay.peek(home.relayBookId)!.invites.size).toBe(invitesBefore);
  });
});
