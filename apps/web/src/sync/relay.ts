import { DEFAULT_RELAY_URL, RelayTransport, type RequestSigner } from '@expanses/db';

/*
 * The relay the app talks to (spec §9): `VITE_RELAY_URL` when the build sets it, else the local relay that
 * `npm run relay` starts. Task 7 builds the transport from the device's `KeyStore` signer (task 5) and hands it
 * to the sync engine that `SyncScheduler` runs.
 */
export const RELAY_URL: string = import.meta.env.VITE_RELAY_URL || DEFAULT_RELAY_URL;

export function createRelayTransport(signer: RequestSigner, baseUrl: string = RELAY_URL): RelayTransport {
  return new RelayTransport({ baseUrl, signer });
}
