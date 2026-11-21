import { afterAll, beforeAll, describe, it } from 'vitest';
import { blobs, copyHold, linkDeclined, linkMeeting, linkWrongCodes, pruning, type MakeParty } from '../../../packages/db/test/self/relay-scenarios';
import { makeDevice, startRelay } from './helpers';

/*
 * Link my devices, Drop 2: the same scenarios `MemoryTransport` passes (packages/db/test/self/relay-memory.test.ts),
 * here against the real Worker through `RelayTransport` — the link meeting place, blobs and a self book's pruning
 * answer alike on both relays.
 */
let relay: Awaited<ReturnType<typeof startRelay>>;

beforeAll(async () => {
  relay = await startRelay();
});

afterAll(async () => {
  await relay?.close();
});

const parties: MakeParty = async () => {
  const device = await makeDevice(relay.url);
  return { keys: device.keys, transport: device.transport };
};

describe('the relay Worker', () => {
  it('meets two devices over a code, nonce by nonce, and hands the welcome to the new one only', () => linkMeeting(parties));
  it('stops a device after five wrong codes, never ending the owner’s session', () => linkWrongCodes(parties));
  it('ends a declined link and its code', () => linkDeclined(parties));
  it('keeps blobs by their hash, 700 KB at most, for the book’s own devices', () => blobs(parties));
  it('holds the log after a copy for the device still to claim it', () => copyHold(parties));
  it('prunes a self book below every device’s ack, never a household book', () => pruning(parties));
});
