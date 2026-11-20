import { namespaceOf, uuidv5 } from '../sync/uuidv5';

/**
 * The id of a row the app makes by itself (link my devices §2.1, Drop 0): every linked device that runs the same
 * upkeep over the same rows makes the same row, so the copies hold it once, never twice. `scope` is the id the row
 * belongs under (a workspace, a programme, a transaction); `name` says what the row is for, and never changes once an
 * id has been worked out under it.
 */
export async function stableId(scope: string, name: string): Promise<string> {
  return uuidv5(await namespaceOf(scope), name);
}
