import type { CategoryNeed } from '@expanses/core';
import {
  type AccountRow,
  addSetCategory,
  archiveAccount,
  clearCategoryMcc,
  clearCategoryNeed,
  createAccount,
  createCategorySet,
  deleteCategorySet,
  renameAccount,
  renameCategorySet,
  saveCategoryMcc,
  saveCategoryNeed,
} from '@expanses/db';
import { useState } from 'react';
import { useApp } from '../../app/context';
import { useInvalidateAll } from '../../lib/queries';

/**
 * Every change the Categories screens make, in one place: the list, a category's own page and the sets page each
 * reach for the same handler rather than a copy of it. Each asks through the browser's prompt or confirm, and each
 * resolves true only when something was written — which is what lets a page leave once its category is archived.
 */
export function useCategoryActions() {
  const { database, ws } = useApp();
  const invalidate = useInvalidateAll();
  const [error, setError] = useState<unknown>(null);

  async function run(action: () => Promise<unknown>): Promise<boolean> {
    setError(null);
    try {
      await action();
      await invalidate();
      return true;
    } catch (e) {
      setError(e);
      return false;
    }
  }

  return {
    error,
    add: (kind: 'expense' | 'income', parent: AccountRow | null) => {
      const name = window.prompt(parent ? `New subcategory under ${parent.name}` : `New ${kind} category`);
      if (name?.trim()) void run(() => createAccount(database, ws, { name, kind, subtype: 'category', currency: null, parentId: parent?.id ?? null }));
    },
    rename: (c: AccountRow) => {
      const name = window.prompt('Rename category', c.name);
      if (name?.trim() && name !== c.name) void run(() => renameAccount(database, ws, c.id, name));
    },
    archive: async (c: AccountRow): Promise<boolean> => {
      if (!window.confirm(`Archive ${c.name}? Past transactions keep it.`)) return false;
      return run(() => archiveAccount(database, ws, c.id));
    },
    changeMcc: (c: AccountRow, current: string | null) => {
      const mcc = window.prompt(`Card MCC for ${c.name} (four digits). Purchases in this category use it when no merchant MCC is known.`, current ?? '');
      if (mcc?.trim() && mcc.trim() !== current) void run(() => saveCategoryMcc(database, ws, c.id, mcc.trim()));
    },
    resetMcc: (c: AccountRow) => void run(() => clearCategoryMcc(database, ws, c.id)),
    markNeed: (c: AccountRow, need: CategoryNeed) => void run(() => saveCategoryNeed(database, ws, c.id, need)),
    clearNeed: (c: AccountRow) => void run(() => clearCategoryNeed(database, ws, c.id)),
    addSet: () => {
      const name = window.prompt('New set of categories, for events that spend on the same things every time');
      if (name?.trim()) void run(() => createCategorySet(database, ws, name));
    },
    renameSet: (id: string, current: string) => {
      const name = window.prompt('Rename set', current);
      if (name?.trim() && name !== current) void run(() => renameCategorySet(database, ws, id, name));
    },
    removeSet: (id: string, name: string) => {
      if (window.confirm(`Remove the ${name} set? Its categories and what was spent on them stay.`)) void run(() => deleteCategorySet(database, ws, id));
    },
    addToSet: (id: string, name: string) => {
      const category = window.prompt(`New category in ${name}`);
      if (category?.trim()) void run(() => addSetCategory(database, ws, id, category));
    },
  };
}
