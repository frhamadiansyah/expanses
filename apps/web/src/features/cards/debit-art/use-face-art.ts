import { useEffect, useSyncExternalStore } from 'react';
import type { FaceArt } from './face-art';

/**
 * A hook that hands out drawn art by key from a chunk of its own, fetched once and kept: the drawings are kilobytes of
 * paths the app's first screen has no use for, so the first face that asks brings them in. Until they land a face draws
 * its plain colour and then its art, within a frame on a device. Each set of drawings (debit-art, programme-art) makes
 * its own hook from its own `import()`, so each is its own chunk.
 */
export function lazyArt<T>(load: () => Promise<Readonly<Record<string, T>>>): (key: string | undefined) => T | null {
  let faces: Readonly<Record<string, T>> | null = null;
  let fetching: Promise<void> | null = null;
  const listeners = new Set<() => void>();

  function fetchFaces(): Promise<void> {
    fetching ??= load().then((loaded) => {
      faces = loaded;
      for (const listen of listeners) listen();
    });
    return fetching;
  }

  function subscribe(listen: () => void): () => void {
    listeners.add(listen);
    return () => listeners.delete(listen);
  }

  /** The art for a key, or null while it is still on its way — or for a key no drawing was made for. */
  return function useArt(key: string | undefined): T | null {
    const loaded = useSyncExternalStore(subscribe, () => faces, () => null);
    useEffect(() => {
      if (key !== undefined && loaded === null) void fetchFaces();
    }, [key, loaded]);
    return key !== undefined ? (loaded?.[key] ?? null) : null;
  };
}

/** The debit-art drawings (`faces.generated.ts`, about a hundred and fifty kilobytes), by face key. */
export const useFaceArt = lazyArt<FaceArt>(() => import('./faces.generated').then((module) => module.FACES));
