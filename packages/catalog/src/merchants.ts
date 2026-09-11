import { isMcc } from '@expanses/core';
import list from '../merchants/merchants.json';

export interface BundledMerchant {
  /** Lowercase whole-word pattern matched in purchase descriptions. */
  pattern: string;
  mcc: string;
  name: string;
  /** Why this code is expected, e.g. "Typical for fast food restaurants". */
  basis: string;
}

export interface MerchantList {
  version: number;
  verifiedOn: string;
  merchants: BundledMerchant[];
}

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v);
const isText = (v: unknown): v is string => typeof v === 'string' && v.trim().length > 0;

/** Returns problems with a bundled merchant list; an empty array means it is valid. */
export function validateMerchants(value: unknown): string[] {
  if (!isObj(value)) return ['merchant list: must be an object'];
  const errors: string[] = [];
  if (!Number.isSafeInteger(value.version) || (value.version as number) < 1) errors.push('version: must be a positive integer');
  if (typeof value.verifiedOn !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value.verifiedOn)) errors.push('verifiedOn: must be a YYYY-MM-DD date');
  if (!Array.isArray(value.merchants) || value.merchants.length === 0) return [...errors, 'merchants: at least one merchant is required'];
  const seen = new Set<string>();
  value.merchants.forEach((merchant, i) => {
    const path = `merchants[${i}]`;
    if (!isObj(merchant)) return errors.push(`${path}: must be an object`);
    const pattern = merchant.pattern;
    if (!isText(pattern)) errors.push(`${path}.pattern: is required`);
    else if (pattern !== pattern.trim().toLowerCase()) errors.push(`${path}.pattern: must be lowercase and trimmed`);
    else if (seen.has(pattern)) errors.push(`${path}.pattern: duplicate pattern "${pattern}"`);
    else seen.add(pattern);
    if (typeof merchant.mcc !== 'string' || !isMcc(merchant.mcc)) errors.push(`${path}.mcc: must be four digits`);
    if (!isText(merchant.name)) errors.push(`${path}.name: is required`);
    if (!isText(merchant.basis)) errors.push(`${path}.basis: is required`);
  });
  return errors;
}

/** Common merchants and their typical MCCs, from our own research. Validated in tests. */
export const MERCHANTS: MerchantList = list;
