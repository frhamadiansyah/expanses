import { createContext, useContext } from 'react';
import type { AppDb } from '../db/bootstrap';
import type { SyncService } from '../sync/sync-service';

export interface AppState extends AppDb {
  /** Opens another workspace: remembered on the device, and every cached figure dropped. */
  switchBook: (bookId: string) => Promise<void>;
  /** Household sharing: the one sync service (spec §9.4). It makes nothing and sends nothing until a book is shared. */
  sync: SyncService;
}

export const AppContext = createContext<AppState | null>(null);

export function useApp(): AppState {
  const value = useContext(AppContext);
  if (!value) throw new Error('AppContext is missing');
  return value;
}
