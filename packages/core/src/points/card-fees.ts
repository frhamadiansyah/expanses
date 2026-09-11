import { containsKeyword } from '../text/keywords';

/**
 * Description phrases of charges the card issuer adds itself. Always phrases, never single words: "bunga" alone would
 * match a florist.
 */
export const CARD_FEE_PHRASES: readonly string[] = [
  'biaya notifikasi',
  'notification fee',
  'biaya materai',
  'bea materai',
  'biaya meterai',
  'bea meterai',
  'stamp duty',
  'biaya administrasi',
  'biaya admin',
  'administration fee',
  'admin fee',
  'biaya cetak tagihan',
  'biaya lembar tagihan',
  'statement fee',
  'iuran tahunan',
  'annual fee',
  'biaya keterlambatan',
  'late fee',
  'late charge',
  'late payment fee',
  'biaya tarik tunai',
  'cash advance fee',
  'biaya overlimit',
  'biaya over limit',
  'overlimit fee',
  'biaya bunga',
  'interest charge',
  'finance charge',
];

/** Ids of the default Fees & Charges category and every category under it. */
export function cardFeeCategoryIds(categories: readonly { id: string; parentId: string | null; systemKey: string | null }[]): Set<string> {
  const byId = new Map(categories.map((category) => [category.id, category]));
  const ids = new Set<string>();
  for (const category of categories) {
    const seen = new Set<string>();
    for (let current: (typeof categories)[number] | undefined = category; current && !seen.has(current.id); current = current.parentId ? byId.get(current.parentId) : undefined) {
      seen.add(current.id);
      if (current.systemKey === 'fees') {
        ids.add(category.id);
        break;
      }
    }
  }
  return ids;
}

/** Issuer charges never earn points on any card: purchases in Fees & Charges, or described with a card fee phrase. */
export function isCardFee(description: string, categoryId: string, feeCategoryIds: ReadonlySet<string>): boolean {
  return feeCategoryIds.has(categoryId) || CARD_FEE_PHRASES.some((phrase) => containsKeyword(description, phrase));
}
