export interface BusinessCategory {
  /** Stable identifier, never shown. Income keys sit under `income.` so they take the income colour. */
  key: string;
  name: string;
  kind: 'expense' | 'income';
  /** A name in the bundled icon set (`ICONS` in the web app's CategoryIcon). */
  icon: string;
}

/**
 * The starter list offered once to a Business workspace: a flat, country-neutral set of the headings a small business
 * files its money under. Added to a workspace's book by `applyCategoryStart`; the owner renames, moves and archives
 * them like any other category.
 */
export const BUSINESS_CATEGORIES: readonly BusinessCategory[] = [
  { kind: 'income', key: 'income.biz_sales', name: 'Sales', icon: 'store' },
  { kind: 'income', key: 'income.biz_services', name: 'Services', icon: 'hand-coins' },
  { kind: 'income', key: 'income.biz_interest', name: 'Interest', icon: 'percent' },
  { kind: 'income', key: 'income.biz_other', name: 'Other income', icon: 'circle-plus' },
  { kind: 'expense', key: 'biz.supplies', name: 'Supplies', icon: 'package' },
  { kind: 'expense', key: 'biz.equipment', name: 'Equipment', icon: 'wrench' },
  { kind: 'expense', key: 'biz.software', name: 'Software', icon: 'laptop' },
  { kind: 'expense', key: 'biz.marketing', name: 'Marketing', icon: 'presentation' },
  { kind: 'expense', key: 'biz.rent', name: 'Rent', icon: 'building-2' },
  { kind: 'expense', key: 'biz.utilities', name: 'Utilities', icon: 'zap' },
  { kind: 'expense', key: 'biz.salaries', name: 'Salaries', icon: 'users' },
  { kind: 'expense', key: 'biz.contractors', name: 'Contractors', icon: 'heart-handshake' },
  { kind: 'expense', key: 'biz.travel', name: 'Travel', icon: 'plane' },
  { kind: 'expense', key: 'biz.professional_fees', name: 'Professional fees', icon: 'file-text' },
  { kind: 'expense', key: 'biz.insurance', name: 'Insurance', icon: 'shield-check' },
  { kind: 'expense', key: 'biz.taxes', name: 'Taxes', icon: 'landmark' },
  { kind: 'expense', key: 'biz.bank_charges', name: 'Bank charges', icon: 'badge-percent' },
  { kind: 'expense', key: 'biz.other', name: 'Other', icon: 'circle-ellipsis' },
];
