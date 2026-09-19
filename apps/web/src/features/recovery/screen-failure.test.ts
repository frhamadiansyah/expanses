import { describe, expect, it, vi } from 'vitest';
import { MID_SESSION_NOTE, recoveryCopy, SCREEN_STOPPED_NOTE } from './recovery-copy';
import { releaseEngine, screenFailureReason } from './screen-failure';

describe('a screen that threw while it was drawing', () => {
  it('is a typed reason, never a blank page, and never claims the data is the problem', () => {
    const reason = screenFailureReason(new TypeError("Cannot read properties of undefined (reading 'map')"));
    expect(reason.kind).toBe('cannot-open');
    expect(reason.midSession).toBe(true);
    // The bytes are untouched and the recovery screen reads them off OPFS without the engine either way.
    expect(reason.exportable).toBe(true);
    expect(reason.detail).toContain("reading 'map'");
  });

  it('says the same thing to SQLite that §3.4 does, when SQLite is what threw', () => {
    // A screen that threw because the query underneath it rejected with a corrupt page is not a screen bug:
    // it is the mid-session fatal, arriving through a component instead of through the executor.
    const reason = screenFailureReason(new Error('database disk image is malformed'));
    expect(reason.kind).toBe('corrupt');
    expect(reason.midSession).toBe(true);
    expect(recoveryCopy(reason, { hasSnapshot: true }).body.startsWith(MID_SESSION_NOTE)).toBe(true);
  });

  it('reaches the user as words about a screen, not about their money', () => {
    const copy = recoveryCopy(screenFailureReason(new Error('undefined is not a function'), { released: true }), { hasSnapshot: true });
    expect(copy.body.startsWith(SCREEN_STOPPED_NOTE)).toBe(true);
    expect(copy.headline).toBe('That screen stopped before it could finish');
    expect(copy.body).toContain('exactly as they were');
    // The three rules every line of this screen holds to.
    expect(copy.body).not.toMatch(/delete|reinstall|lost your data|corrupt/i);
    expect(copy.headline).not.toMatch(/undefined is not a function/);
    // Nothing is a dead end: every tool is on offer, including the way back to a copy.
    expect(copy.actions).toEqual(['export', 'restore', 'retry', 'start-fresh']);
  });

  /**
   * The boundary is reached with the app's own worker alive and idle: nothing struck, so nothing
   * terminated it, and the SAH pool is still holding a sync access handle on every slot file. Restore and
   * Start fresh both write to those files, and both fail on a held handle with "Access Handles cannot be
   * created" — the exact failure the `locked` screen withholds those two buttons to avoid. So the engine
   * is let go of first, and the buttons follow the handles.
   */
  it('offers nothing that would fail on a file the app is still holding open', () => {
    const held = recoveryCopy(screenFailureReason(new Error('undefined is not a function')), { hasSnapshot: true });
    // Export reads straight through a held handle, and Try again is never withheld from any screen.
    expect(held.actions).toEqual(['export', 'retry']);

    const letGo = recoveryCopy(screenFailureReason(new Error('undefined is not a function'), { released: true }), { hasSnapshot: true });
    expect(letGo.actions).toEqual(['export', 'restore', 'retry', 'start-fresh']);
  });

  it('holds the same rule for a screen that threw because SQLite did', () => {
    // The engine's own kind, and the same handles behind it: `corrupt` is where a restore matters most.
    expect(recoveryCopy(screenFailureReason(new Error('database disk image is malformed')), { hasSnapshot: true }).actions).toEqual([
      'export',
      'retry',
    ]);
    expect(
      recoveryCopy(screenFailureReason(new Error('database disk image is malformed'), { released: true }), { hasSnapshot: true }).actions,
    ).toEqual(['export', 'restore', 'retry', 'start-fresh']);
  });

  describe('letting go of the engine', () => {
    it('lets go once, and says it did, so the screen can offer the buttons that write', () => {
      // The ordinary path: the engine has nothing in flight, so it lets go before this returns.
      const release = vi.fn((letGo: () => void) => letGo());
      const failures: unknown[] = [];
      expect(releaseEngine(release, (error) => failures.push(error))).toBe(true);
      expect(release).toHaveBeenCalledTimes(1);
      expect(failures).toEqual([]);
    });

    /*
     * A release the engine defers, because a restore this app started is still rewriting the live slot and
     * terminating the worker there would tear the file and lose the bytes held to undo it. The handles are
     * therefore still held when this screen is drawn, and the screen says so by not offering the two
     * buttons that would fail on them. Try again is never withheld, so this is not a dead end.
     */
    it('says the handles are still held while the engine is waiting for a restore to finish', () => {
      let letGo: (() => void) | undefined;
      const failures: unknown[] = [];
      const released = releaseEngine((done) => {
        letGo = done;
      }, (error) => failures.push(error));

      expect(released).toBe(false);
      expect(failures).toEqual([]);
      expect(recoveryCopy(screenFailureReason(new Error('boom'), { released }), { hasSnapshot: true }).actions).toEqual(['export', 'retry']);
      // And the engine really does let go afterwards — it is deferred, not dropped.
      expect(letGo).toBeTypeOf('function');
    });

    /*
     * And what happens when it does let go, which is the whole reason the deferral is bounded on this path.
     * The engine waits for the restore, or gives it up after `RESTORE_GRACE_MS`, and either way terminates
     * the worker — the handles are then really gone and Restore and Start fresh are true. Nothing re-read
     * that answer before, so a crash that landed during a restore cost the user those two buttons for the
     * life of the tab, and the grace bought the file's safety with a screen that could never come true.
     */
    it('tells the screen when the engine lets go after it was already drawn', () => {
      let letGo: (() => void) | undefined;
      let late = 0;
      const released = releaseEngine(
        (done) => {
          letGo = done;
        },
        () => undefined,
        () => {
          late += 1;
        },
      );

      expect(released).toBe(false);
      expect(late).toBe(0);
      letGo?.();
      expect(late).toBe(1);
      // Which is a screen with the two buttons that write on it, where a moment ago there were none.
      expect(recoveryCopy(screenFailureReason(new Error('boom'), { released: true }), { hasSnapshot: true }).actions).toEqual([
        'export',
        'restore',
        'retry',
        'start-fresh',
      ]);
    });

    it('does not call back on the ordinary path, where the answer it returned is already the right one', () => {
      let late = 0;
      const released = releaseEngine(
        (done) => done(),
        () => undefined,
        () => {
          late += 1;
        },
      );

      expect(released).toBe(true);
      // A redraw here would be a second `setState` saying what the first one already said.
      expect(late).toBe(0);
    });

    it('never throws out of a boundary that is already handling a crash, and says the handles may still be held', () => {
      const failures: unknown[] = [];
      const released = releaseEngine(
        () => {
          throw new Error('terminate failed');
        },
        (error) => failures.push(error),
      );
      // A boundary that crashes while handling a crash is the white page all over again.
      expect(released).toBe(false);
      expect(failures).toHaveLength(1);
      // And the screen is told, so it does not promise a restore onto files that may still be held.
      expect(recoveryCopy(screenFailureReason(new Error('boom'), { released }), { hasSnapshot: true }).actions).toEqual(['export', 'retry']);
    });

    it('answers no when there is no engine to let go of', () => {
      expect(releaseEngine(undefined, () => undefined)).toBe(false);
    });
  });

  it('says nothing about a screen to someone who never got one', () => {
    // The open-time `cannot-open` is a different sentence, and must not pick this one up.
    const copy = recoveryCopy({ kind: 'cannot-open', headline: 'log', detail: 'x', exportable: true }, { hasSnapshot: true });
    expect(copy.headline).toBe('We could not open your data this time');
    expect(copy.body).not.toContain(SCREEN_STOPPED_NOTE);
  });
});
