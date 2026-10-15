/** `?month=2026-10`, read only when it is a month; anything else opens on this month. */
export const budgetSearch = (search: Record<string, unknown>): { month?: string } =>
  typeof search.month === 'string' && /^\d{4}-(0[1-9]|1[0-2])$/.test(search.month) ? { month: search.month } : {};
