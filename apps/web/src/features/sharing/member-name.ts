import { MEMBER_NAME_MAX } from '@expanses/db';

/**
 * What the Name sheet of this member's own page (sharing resilience §10.2, D-D2) can do with what is typed: the name
 * trimmed, as the engine keeps it; whether Save is on (not empty, changed, at most `MEMBER_NAME_MAX` characters); and
 * whether the name is too long, which the sheet says.
 */
export function memberNameDraft(draft: string, current: string): { name: string; canSave: boolean; tooLong: boolean } {
  const name = draft.trim();
  const tooLong = [...name].length > MEMBER_NAME_MAX;
  return { name, canSave: name !== '' && name !== current && !tooLong, tooLong };
}

export const NAME_TOO_LONG_LINE = `At most ${MEMBER_NAME_MAX} characters.`;
