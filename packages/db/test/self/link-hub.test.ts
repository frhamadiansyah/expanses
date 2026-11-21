import { describe, expect, it } from 'vitest';
import { generateDevice } from '../../src/sync/keys';
import { LINK_MAX_SESSIONS, LINK_MAX_STARTS_PER_PLACE, LINK_MAX_WRONG_PER_PLACE, LINK_TTL_MS, LinkHub, type LinkStore, placeOf } from '../../src/self/link-hub';

/*
 * Link my devices, review fix: the link meeting place's limits. A stranger making fresh device keys is stopped by its
 * network address; a wrong guess never ends the owner's session; sessions and tries stay bounded and are forgotten.
 * Invented addresses (documentation ranges).
 */

function store() {
  const map = new Map<string, unknown>();
  const s: LinkStore = {
    get: async <T>(key: string) => structuredClone(map.get(key)) as T | undefined,
    put: async (entries) => {
      for (const [key, value] of Object.entries(entries)) map.set(key, structuredClone(value));
    },
    delete: async (key) => map.delete(key),
  };
  return { s, map };
}

const COMMIT = 'ab'.repeat(32);

describe('the link meeting place', () => {
  it('stops an address after twenty wrong codes however many fresh devices it makes; the owner still links', async () => {
    let now = Date.parse('2026-11-21T08:00:00Z');
    const { s } = store();
    const hub = new LinkHub(s, () => now);
    const owner = await generateDevice();
    const started = await hub.start('owner-phone', owner.public, '198.51.100.7');
    const wrong = String((Number(started.code) + 1) % 1_000_000).padStart(6, '0');
    for (let i = 0; i < LINK_MAX_WRONG_PER_PLACE; i += 1) {
      await expect(hub.claim(`stranger-${i}`, wrong, owner.public, COMMIT, '203.0.113.9')).rejects.toMatchObject({ status: 404 });
    }
    await expect(hub.claim('stranger-fresh', started.code!, owner.public, COMMIT, '203.0.113.9')).rejects.toMatchObject({ status: 429 });
    expect((await hub.read('owner-phone', started.sessionId)).status).toBe('waiting');
    expect((await hub.claim('owner-mac', started.code!, owner.public, COMMIT, '198.51.100.7')).status).toBe('claimed');
    // Ten minutes on, the stranger's window has passed.
    now += LINK_TTL_MS;
    await expect(hub.claim('stranger-later', wrong, owner.public, COMMIT, '203.0.113.9')).rejects.toMatchObject({ status: 404 });
  });

  it('counts an IPv6 address by its /64', () => {
    expect(placeOf('2001:db8:1:2:aaaa::1')).toBe('2001:db8:1:2::/64');
    expect(placeOf('2001:db8:1:2:bbbb:cccc:dddd:eeee')).toBe('2001:db8:1:2::/64');
    expect(placeOf('192.0.2.1')).toBe('192.0.2.1');
    expect(placeOf(null)).toBeUndefined();
  });

  it('keeps one waiting session a device, ten new codes an address in ten minutes, and a bounded number in all', async () => {
    let now = Date.parse('2026-11-21T08:00:00Z');
    const { s, map } = store();
    const hub = new LinkHub(s, () => now);
    const phone = await generateDevice();
    const first = await hub.start('phone', phone.public, '198.51.100.7');
    const second = await hub.start('phone', phone.public, '198.51.100.7');
    expect((await hub.read('phone', first.sessionId)).status).toBe('declined');
    expect((await hub.read('phone', second.sessionId)).status).toBe('waiting');
    for (let i = 2; i < LINK_MAX_STARTS_PER_PLACE; i += 1) await hub.start(`device-${i}`, phone.public, '198.51.100.7');
    await expect(hub.start('device-over', phone.public, '198.51.100.7')).rejects.toMatchObject({ status: 429 });

    // From many addresses, the hub holds at most its cap at once.
    for (let i = 0; (map.get('sessions') as string[]).length < LINK_MAX_SESSIONS; i += 1) await hub.start(`many-${i}`, phone.public, `192.0.2.${i % 250}-${i}`);
    await expect(hub.start('one-too-many', phone.public, '198.51.100.99')).rejects.toMatchObject({ status: 503 });

    // Seventy minutes on, every session and window is past: the next code forgets them, and the tries are pruned.
    now += LINK_TTL_MS + 60 * 60 * 1000;
    await hub.start('phone', phone.public, '198.51.100.7');
    expect((map.get('sessions') as string[]).length).toBe(1);
    expect([...map.keys()].filter((k) => k.startsWith('session:') || k.startsWith('code:'))).toHaveLength(2);
    expect(Object.keys(map.get('tries') as object)).toEqual(['start:198.51.100.7']);
    expect([...map.keys()].filter((k) => k.startsWith('tries:'))).toEqual([]);
  });
});
