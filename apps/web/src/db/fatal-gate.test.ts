import { describe, expect, it } from 'vitest';
import { guardMount } from './fatal-gate';
import type { RecoveryReason } from './open';
import { createWorkerExecutor } from './worker-executor';

const reason: RecoveryReason = { kind: 'corrupt', headline: 'log line', detail: 'database disk image is malformed', exportable: true, midSession: true };

describe('what may be mounted once a fatal has been listened for', () => {
  it('refuses the app when the fatal was already recorded before anyone listened', () => {
    // `executor.onFatal` hands a recorded fatal over synchronously, so the handler runs inside `guardMount`.
    const shown: RecoveryReason[] = [];
    const gate = guardMount((handler) => handler(reason), (r) => shown.push(r));

    expect(shown).toEqual([reason]);
    expect(gate.mountable()).toBe(false);
  });

  it('lets the app mount until the failure actually happens, and never again after', () => {
    let fire: ((reason: RecoveryReason) => void) | undefined;
    const shown: RecoveryReason[] = [];
    const gate = guardMount((handler) => (fire = handler), (r) => shown.push(r));

    expect(gate.mountable()).toBe(true);
    expect(shown).toEqual([]);
    // A fatal that lands during the `await import(…)` between the registration and the render: the answer
    // has to change underneath it, which is why this is a question asked again and not an ordering.
    fire!(reason);
    expect(shown).toEqual([reason]);
    expect(gate.mountable()).toBe(false);
  });

  it('mounts a database that has no engine to lose', () => {
    // `AppDb.onFatal` is absent for the Node-backed opens; nothing can die underneath them.
    expect(guardMount(undefined, () => undefined).mountable()).toBe(true);
  });

  /**
   * The production chain the review found, from the engine outwards rather than from a stub: a corrupt page
   * under the card-programs tables answers an ordinary query, `openAppDb` swallows the catalogue sync by
   * design, the open returns `ok` — and the app must still never be painted over the recovery screen.
   */
  it('never paints the app over a recovery screen the same tick drew', async () => {
    const worker = {
      onmessage: null as ((event: MessageEvent<unknown>) => void) | null,
      onerror: null as ((event: ErrorEvent) => void) | null,
      postMessage(message: { id: number }) {
        queueMicrotask(() =>
          worker.onmessage?.({ data: { id: message.id, error: 'database disk image is malformed', fatal: 'corrupt' } } as MessageEvent<unknown>),
        );
      },
    };
    const executor = createWorkerExecutor(worker as unknown as Worker);
    await expect(executor.query('select 1 from card_programs', [], 'all')).rejects.toThrow(/malformed/);

    // Exactly what `main.tsx` does, in the same order.
    const painted: string[] = [];
    const gate = guardMount(executor.onFatal, () => painted.push('recovery'));
    if (gate.mountable()) painted.push('app');

    expect(painted).toEqual(['recovery']);
  });
});
