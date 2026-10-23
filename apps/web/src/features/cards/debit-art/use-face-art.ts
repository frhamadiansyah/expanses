import { useEffect, useSyncExternalStore } from 'react';
import type { FaceArt } from './face-art';

/**
 * The drawn art, fetched once and kept: a hundred and fifty kilobytes of paths the app's first screen has no use for,
 * so it is a chunk of its own that the first face asked for brings in. Until it lands a face draws its plain colour and
 * then its art, within a frame on a device.
 */
let faces: Readonly<Record<string, FaceArt>> | null = null;
let fetching: Promise<void> | null = null;
const listeners = new Set<() => void>();

function fetchFaces(): Promise<void> {
  fetching ??= import('./faces.generated').then((module) => {
    faces = module.FACES;
    for (const listen of listeners) listen();
  });
  return fetching;
}

function subscribe(listen: () => void): () => void {
  listeners.add(listen);
  return () => listeners.delete(listen);
}

/** The art for a face key, or null while it is still on its way — or for a key no drawing was made for. */
export function useFaceArt(key: string | undefined): FaceArt | null {
  const loaded = useSyncExternalStore(subscribe, () => faces, () => null);
  useEffect(() => {
    if (key !== undefined && loaded === null) void fetchFaces();
  }, [key, loaded]);
  return key !== undefined ? (loaded?.[key] ?? null) : null;
}
