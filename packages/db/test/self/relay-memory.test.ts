import { describe, it, vi } from 'vitest';
import { generateDevice, requestSignerOf } from '../../src/sync/keys';
import { MemoryTransport } from '../../src/sync/memory-transport';
import { blobs, copyHold, linkDeclined, linkMeeting, linkWrongCodes, pruning, type MakeParty } from './relay-scenarios';

vi.setConfig({ testTimeout: 60_000 });

/* Link my devices, Drop 2: the relay's new rules on `MemoryTransport` (apps/relay runs the same against the Worker). */
function parties(): MakeParty {
  const relay = new MemoryTransport();
  return async () => {
    const keys = await generateDevice();
    return { keys, transport: relay.as(requestSignerOf(keys)) };
  };
}

describe('the relay in memory', () => {
  it('meets two devices over a code, nonce by nonce, and hands the welcome to the new one only', () => linkMeeting(parties()));
  it('burns a code after five wrong ones, and stops the guesser', () => linkWrongCodes(parties()));
  it('ends a declined link and its code', () => linkDeclined(parties()));
  it('keeps blobs by their hash, 700 KB at most, for the book’s own devices', () => blobs(parties()));
  it('holds the log after a copy for the device still to claim it', () => copyHold(parties()));
  it('prunes a self book below every device’s ack, never a household book', () => pruning(parties()));
});
