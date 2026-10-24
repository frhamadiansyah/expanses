import { lazyArt } from '../debit-art/use-face-art';
import type { ProgrammeArt } from './programme-art';

/**
 * The membership drawings (`faces.generated.ts`, about six hundred kilobytes before gzip), by face key: a chunk of their
 * own, apart from debit-art's, fetched by the first programme face that asks.
 */
export const useProgrammeArt = lazyArt<ProgrammeArt>(() => import('./faces.generated').then((module) => module.FACES));
