import { createContext, useContext } from 'react';
import type { AppDb } from '../db/bootstrap';

export const AppContext = createContext<AppDb | null>(null);

export function useApp(): AppDb {
  const value = useContext(AppContext);
  if (!value) throw new Error('AppContext is missing');
  return value;
}
