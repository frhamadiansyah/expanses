import { type CoretaxInputs, priceMicroFrom } from '@expanses/core';
import { eq } from 'drizzle-orm';
import type { WorkspaceContext } from '../context';
import type { Database } from '../database';
import { accounts } from '../schema';
import { assetValuesAt } from './asset-values';
import { listAssetProfiles } from './assets';
import { listDebtProfiles } from './debts';
import { nativeBalances } from './ledger';
import { listLoans } from './loans';
import { positionsFor } from './trades';

/** The report reads the year as it stood at the end of it. */
const endOf = (taxYear: number) => `${taxYear}-12-31`;

/** Codes for debts the owner did not give one: a card is its own code, a bank loan another. */
const DEBT_CODE_BY_SUBTYPE: Record<string, string> = { credit_card: '102', loan: '101', payable: '109' };

/**
 * Everything the harta and utang rows need, read from the ledger on 31 December of the tax year.
 * Nothing here decides what to report — that is the rows' work; this only gathers the figures.
 */
export async function coretaxInputsFor(database: Database, ws: WorkspaceContext, taxYear: number): Promise<CoretaxInputs> {
  const onDate = endOf(taxYear);
  const values = await assetValuesAt(database, ws, onDate);
  const profiles = await listAssetProfiles(database, ws);
  const profileOf = new Map(profiles.map((profile) => [profile.accountId, profile]));
  const balances = await nativeBalances(database, ws, onDate);
  const positions = await positionsFor(database, ws, onDate);
  const debtProfiles = await listDebtProfiles(database, ws);
  const debtProfileOf = new Map(debtProfiles.map((profile) => [profile.accountId, profile]));
  const loans = await listLoans(database, ws);
  const loanOf = new Map(loans.map((loan) => [loan.accountId, loan]));

  const liabilities = await database.db
    .select({ id: accounts.id, name: accounts.name, subtype: accounts.subtype, currency: accounts.currency })
    .from(accounts)
    .where(eq(accounts.workspaceId, ws.workspaceId));

  const inputs: CoretaxInputs = { cash: [], holdings: [], estimated: [], receivables: [], debts: [] };

  for (const value of values) {
    const profile = profileOf.get(value.accountId);
    const code = profile?.coretaxCode ?? null;
    const fields = profile?.coretaxFields ?? {};
    const balanceMinor = balances[value.accountId] ?? 0;

    if (value.planGroup === 'owed') {
      // A receivable's name is what the piutang table asks for.
      const person = debtProfileOf.get(value.accountId);
      if (balanceMinor <= 0) continue;
      inputs.receivables.push({
        accountId: value.accountId,
        name: value.name,
        code: person?.coretaxCode ?? '0201',
        balanceMinor,
        currency: value.currency,
        fields: { name: person?.personName ?? value.name, ...fields },
      });
      continue;
    }

    if (value.mode === 'derived') {
      if (balanceMinor <= 0) continue;
      inputs.cash.push({ accountId: value.accountId, name: value.name, code: code ?? '0102', balanceMinor, currency: value.currency, fields });
      continue;
    }

    if (value.mode === 'market') {
      const position = positions[value.accountId];
      if (!position || position.unitsMicro <= 0) continue;
      // assetValuesAt already picked the last price on or before the date; the price per unit
      // follows from the value it worked out, so no second price lookup can disagree with it.
      const priceMicro = priceMicroFrom(value.valueMinor, position.unitsMicro);
      inputs.holdings.push({ accountId: value.accountId, name: value.name, code: code ?? '0399', currency: value.currency, priceMicro, byYear: position.byYear, fields });
      continue;
    }

    // Property, vehicles and anything else the owner estimates.
    if (value.valueMinor <= 0 && value.costMinor <= 0) continue;
    inputs.estimated.push({
      accountId: value.accountId,
      name: value.name,
      code: code ?? '0509',
      currency: value.currency,
      costMinor: value.costMinor,
      valueMinor: value.valueMinor,
      fields,
    });
  }

  for (const account of liabilities) {
    const code = DEBT_CODE_BY_SUBTYPE[account.subtype];
    if (!code) continue;
    // A liability is carried as a credit, so what is owed is the balance turned around.
    const balanceMinor = -(balances[account.id] ?? 0);
    if (balanceMinor <= 0) continue;
    const person = debtProfileOf.get(account.id);
    const loan = loanOf.get(account.id);
    inputs.debts.push({
      accountId: account.id,
      name: account.name,
      code: person?.coretaxCode ?? loan?.coretaxCode ?? code,
      balanceMinor,
      currency: account.currency ?? ws.baseCurrency,
      note: loan?.lenderName ?? person?.personName ?? null,
    });
  }

  return inputs;
}
