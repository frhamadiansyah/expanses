/**
 * Where an expense or an income saved with "Choose later" is filed until a category is chosen for it.
 *
 * Not a default category: each is made the first time something is saved without a category, at the top of its
 * kind's tree, so a cap on a parent never counts it and a report shows it as a slice of its own. Pickers never
 * offer it — a category is chosen *instead of* it, never as it.
 */
export const UNCATEGORISED = {
  expense: { key: 'miscellaneous.uncategorised', name: 'Uncategorised', kind: 'expense' },
  income: { key: 'income.uncategorised', name: 'Uncategorised', kind: 'income' },
} as const;

/** Whether a category's key is one of the two Uncategorised ones. */
export function isUncategorisedKey(key: string | null | undefined): boolean {
  return key === UNCATEGORISED.expense.key || key === UNCATEGORISED.income.key;
}
