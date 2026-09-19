import { describe, expect, it } from 'vitest';
import { NEWER_DATABASE, newerDatabaseVersion, refusedCopy, refusedCopyMessage } from './newer-database';

describe('newerDatabaseVersion', () => {
  it('reads the version out of the engine’s marker, and nothing else', () => {
    expect(newerDatabaseVersion(new Error(`${NEWER_DATABASE}999`))).toBe(999);
    expect(newerDatabaseVersion(`${NEWER_DATABASE}48`)).toBe(48);
    expect(newerDatabaseVersion(new Error('That file is not an Expanses backup.'))).toBeNull();
    expect(newerDatabaseVersion(new Error('That copy did not check out: *** in database main ***'))).toBeNull();
    // A marker with nothing usable in it is not this failure: better the raw message than "update NaN".
    expect(newerDatabaseVersion(new Error(`${NEWER_DATABASE}soon`))).toBeNull();
  });
});

describe('refusedCopy', () => {
  it('says the device was not touched, names both versions, and never suggests deleting anything', () => {
    const message = refusedCopyMessage(999, 47);
    expect(message).toContain('This data was made by a newer version of Expanses');
    expect(message).toContain('Nothing on this device was changed');
    expect(message).toContain('update 999');
    expect(message).toContain('update 47');
    expect(message).toMatch(/Update Expanses/);
    expect(message).not.toMatch(/delete|remove|start fresh|reinstall/i);
    // "Try it again" is the one instruction that cannot work: the app is what is behind, and on the
    // Backup page the restore that was waiting has already been dropped by the time this is read.
    expect(message).not.toMatch(/try (it )?again/i);
    expect(message).toContain('put that copy back');
  });

  it('leaves every other failure exactly as it was', () => {
    expect(refusedCopy(new Error(`${NEWER_DATABASE}999`), 47)?.message).toBe(refusedCopyMessage(999, 47));
    expect(refusedCopy(new Error('That file is not an Expanses backup.'), 47)).toBeNull();
  });
});
