import { describe, expect, it, vi } from 'vitest';
import { describeError, ENGINE_START, engineStartError, guardPoolFolders, isEngineStart, isHeld, probeSlots, retryable, withRetries } from './engine-start';
import { fatalKind } from './fatal';

const noWait = async () => undefined;

describe('starting the engine again after a failed start', () => {
  it('tries again with growing waits, and gives the last failure back when every try fails', async () => {
    const waits: number[] = [];
    const attempt = vi.fn(async () => {
      throw new Error(`held ${attempt.mock.calls.length}`);
    });
    await expect(withRetries(attempt, [250, 500, 1000, 2000], async (ms) => void waits.push(ms))).rejects.toThrow('held 5');
    expect(attempt).toHaveBeenCalledTimes(5);
    expect(waits).toEqual([250, 500, 1000, 2000]);
  });

  it('stops trying the moment one try works', async () => {
    let calls = 0;
    const value = await withRetries(
      async () => {
        calls += 1;
        if (calls < 3) throw new Error('NoModificationAllowedError');
        return 'engine';
      },
      [1, 1, 1, 1],
      noWait,
    );
    expect(value).toBe('engine');
    expect(calls).toBe(3);
  });

  it('does not try again over a file SQLite has already called damaged', async () => {
    const attempt = vi.fn(async () => {
      throw new Error('file is not a database');
    });
    await expect(withRetries(attempt, [1, 1], noWait)).rejects.toThrow('file is not a database');
    expect(attempt).toHaveBeenCalledTimes(1);
  });

  it('keeps a start that worked, and forgets one that failed so the next request starts again', async () => {
    let calls = 0;
    const start = retryable(async () => {
      calls += 1;
      if (calls === 1) throw new Error('first start failed');
      return { started: calls };
    });
    await expect(start()).rejects.toThrow('first start failed');
    await expect(start()).resolves.toEqual({ started: 2 });
    await expect(start()).resolves.toEqual({ started: 2 });
    expect(calls).toBe(2);
  });

  it('shares one start between requests that arrive while it runs', async () => {
    let calls = 0;
    const start = retryable(async () => {
      calls += 1;
      await new Promise((resolve) => setTimeout(resolve, 5));
      return calls;
    });
    const [a, b] = await Promise.all([start(), start()]);
    expect([a, b]).toEqual([1, 1]);
    expect(calls).toBe(1);
  });
});

describe('what a failed start is called', () => {
  it('carries a stable prefix and the browser error name, so the main thread can tell it from damage', () => {
    const held = new Error("Failed to execute 'createSyncAccessHandle': Access Handles cannot be created if there is another open Access Handle");
    held.name = 'NoModificationAllowedError';
    const error = engineStartError(held);
    expect(error.message.startsWith(ENGINE_START)).toBe(true);
    expect(isEngineStart(`Failed query: x\n${error.message}`)).toBe(true);
    expect(error.message).toContain('NoModificationAllowedError');
    expect(isHeld(error.message)).toBe(true);
    // A failed start is never read as a damaged file, mid-session or not.
    expect(fatalKind(error)).toBe('unreadable');
  });

  it('names DOMException-like errors whose message leaves the name out', () => {
    expect(describeError({ name: 'InvalidStateError', message: 'The object is in an invalid state.' })).toBe('InvalidStateError: The object is in an invalid state.');
    expect(describeError(new Error('plain'))).toBe('plain');
    expect(describeError('a string')).toBe('a string');
  });

  it('knows which failures mean another process still holds the files', () => {
    expect(isHeld('NoModificationAllowedError: x')).toBe(true);
    expect(isHeld('InvalidStateError: x')).toBe(true);
    expect(isHeld('Access Handles cannot be created if there is another open Access Handle')).toBe(true);
    expect(isHeld('database disk image is malformed')).toBe(false);
    expect(isHeld('Missing required OPFS APIs.')).toBe(false);
  });
});

/** A directory tree shaped like OPFS's, enough for the probe. */
function tree(files: Record<string, { held?: boolean }>, log: string[]) {
  const file = (name: string, spec: { held?: boolean }) => ({
    kind: 'file' as const,
    name,
    createSyncAccessHandle: async () => {
      if (spec.held) {
        const error = new Error('Access Handles cannot be created');
        error.name = 'NoModificationAllowedError';
        throw error;
      }
      log.push(`open ${name}`);
      return { close: () => void log.push(`close ${name}`) };
    },
  });
  const opaque = {
    kind: 'directory' as const,
    name: '.opaque',
    async *values() {
      for (const [name, spec] of Object.entries(files)) yield file(name, spec);
    },
  };
  const pool = {
    kind: 'directory' as const,
    name: '.expanses',
    async *values() {
      yield opaque;
    },
  };
  return {
    getDirectoryHandle: async (name: string) => {
      if (name === '.expanses') return pool;
      throw new Error('NotFoundError');
    },
  };
}

describe('looking before the pool is installed', () => {
  it('opens and closes a handle on every slot, so the install only runs over files nobody holds', async () => {
    const log: string[] = [];
    await probeSlots(tree({ a: {}, b: {} }, log) as never);
    expect(log).toEqual(['open a', 'close a', 'open b', 'close b']);
  });

  it('fails on a held slot without leaving any handle of its own open', async () => {
    const log: string[] = [];
    await expect(probeSlots(tree({ a: {}, b: { held: true }, c: {} }, log) as never)).rejects.toThrow(/Access Handles/);
    expect(log).toEqual(['open a', 'close a']);
  });

  it('has nothing to look at on a device that has never run the app', async () => {
    await expect(probeSlots({ getDirectoryHandle: async () => Promise.reject(new Error('NotFoundError')) } as never)).resolves.toBeUndefined();
  });
});

describe('the folders the pool must never remove', () => {
  /*
   * sqlite-wasm's install, on a failed handle, calls its own removeVfs(), which removes `.opaque` and the
   * pool folder recursively: the database. Retrying a start would only make that likelier.
   */
  it('refuses to remove the pool folder or its slot folder, and passes everything else through', async () => {
    const removed: string[] = [];
    class Dir {
      async removeEntry(name: string, _options?: { recursive?: boolean }) {
        removed.push(name);
      }
    }
    guardPoolFolders(Dir.prototype);
    guardPoolFolders(Dir.prototype); // twice is once
    const dir = new Dir();
    await expect(dir.removeEntry('.opaque', { recursive: true })).rejects.toThrow(/\.opaque/);
    await expect(dir.removeEntry('.expanses', { recursive: true })).rejects.toThrow(/\.expanses/);
    await dir.removeEntry('.opfs-sahpool-sync-check-x');
    await dir.removeEntry('slot-1');
    expect(removed).toEqual(['.opfs-sahpool-sync-check-x', 'slot-1']);
  });
});
