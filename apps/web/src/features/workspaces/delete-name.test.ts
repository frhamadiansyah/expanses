import { describe, expect, it } from 'vitest';
import { nameMatches } from './DeleteWorkspaceSheet';
import { copyReasonWords } from '../backup/backupState';

describe('the name typed to delete a workspace', () => {
  it('matches the name exactly, ignoring case and the spaces around it', () => {
    expect(nameMatches('corner shop', 'Corner Shop')).toBe(true);
    expect(nameMatches('  CORNER SHOP ', 'Corner Shop')).toBe(true);
  });
  it('does not match a part of it, a longer one, or nothing', () => {
    expect(nameMatches('Corner', 'Corner Shop')).toBe(false);
    expect(nameMatches('Corner Shop 2', 'Corner Shop')).toBe(false);
    expect(nameMatches('', 'Corner Shop')).toBe(false);
  });
  it('words the safety copy taken before a delete', () => {
    expect(copyReasonWords('before-delete')).toBe('Taken before deleting a workspace');
  });
});
