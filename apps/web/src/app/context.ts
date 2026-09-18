import { createContext, useContext } from 'react';
import type { AppDb } from '../db/bootstrap';

export interface AppState extends AppDb {
  /** Opens another workspace: remembered on the device, and every cached figure dropped. */
  switchBook: (bookId: string) => Promise<void>;
}

export const AppContext = createContext<AppState | null>(null);

export function useApp(): AppState {
  const value = useContext(AppContext);
  if (!value) throw new Error('AppContext is missing');
  return value;
}
