import { CORETAX_SECTIONS, type CoretaxSection, missingCoretaxFields, validateCoretaxFields } from '@expanses/core';
import { type AssetProfileRow, getAssetProfile, saveAssetProfile } from '@expanses/db';
import { type ReactElement, useState } from 'react';
import { useApp } from '../../app/context';
import { useInvalidateAll } from '../../lib/queries';
import { InsetGroup, TextRow } from '../../ui/native';
import { errorHint } from './AssetSettings';
import { fieldsToSave } from './settings-model';

/**
 * The tax report's questions as Settings asks them, in English like the rest of the screen; the report itself keeps
 * the form's own Indonesian words. Keyed by section and field.
 */
const ENGLISH: Record<CoretaxSection, Record<string, string>> = {
  kas: { acct: 'Account number', owner: 'Account holder', inst: 'Bank or institution', loc: 'Country' },
  piutang: { loc: 'Country', idno: 'Borrower’s ID number', name: 'Borrower’s name' },
  investasi: { loc: 'Country', npwp: 'Institution’s tax ID', inst: 'Institution', sid: 'Account number' },
  bergerak: { model: 'Make and model', plate: 'Registration number', own: 'Ownership', ownerNpwp: 'Owner’s tax ID', ownerName: 'Owner’s name' },
  tidak_bergerak: { loc: 'Location', land: 'Land area (m²)', bldg: 'Building area (m²)', source: 'How it was acquired', cert: 'Certificate number' },
  lainnya: { cert: 'Account number', info: 'More information' },
};

/** What a field says about itself beyond its fallback: an institution's NPWP is shared by every holding there. */
const NOTES: Partial<Record<CoretaxSection, Record<string, string>>> = {
  investasi: { npwp: 'Typed once per institution: every holding at the same institution takes it.' },
};

/**
 * What the tax report's table for this thing asks of it, one row per question, each saved when it is left. A field
 * that does not read well (an NPWP with a digit short) says so under itself and is not saved; the rest still are.
 * Nothing here is required to save: the report is what says what is still missing.
 */
export function CoretaxFieldsGroup({
  profile,
  section,
  fallbacks = {},
  lead = [],
}: {
  profile: AssetProfileRow;
  section: CoretaxSection;
  /**
   * What the report puts in a field left empty, by field key — a holding's Nama institusi is the place it is held at.
   * Shown in the empty field, so nobody types it twice; what is typed still stands.
   */
  fallbacks?: Record<string, { value: string; from: string }>;
  /** Rows that open the box before the fields: the asset's own Tax report rows, so the whole report is one box. */
  lead?: ReactElement[];
}) {
  const { database, ws } = useApp();
  const invalidate = useInvalidateAll();
  const [fields, setFields] = useState<Record<string, string>>(profile.coretaxFields);
  const [error, setError] = useState<unknown>(null);

  const problems = validateCoretaxFields(section, fields);
  // What the report will find missing: counted from what is saved, so it changes when a row has been kept.
  const missing = missingCoretaxFields(section, { ...Object.fromEntries(Object.entries(fallbacks).map(([key, f]) => [key, f.value])), ...profile.coretaxFields });

  async function save() {
    const wrong = new Set(problems.map((problem) => problem.key));
    setError(null);
    try {
      // Written over what is saved now, not what this screen was drawn from: another row saved a moment ago (when it
      // was acquired, a field just left) would otherwise be put back.
      const saved = (await getAssetProfile(database, ws, profile.accountId)) ?? profile;
      const next = fieldsToSave(saved.coretaxFields, fields, wrong);
      if (JSON.stringify(next) === JSON.stringify(saved.coretaxFields)) return;
      await saveAssetProfile(database, ws, {
        accountId: saved.accountId,
        assetKind: saved.assetKind,
        planGroup: saved.planGroup,
        unitKind: saved.unitKind,
        lotSize: saved.lotSize,
        risk: saved.risk,
        coretaxSection: saved.coretaxSection,
        coretaxCode: saved.coretaxCode,
        acquiredYear: saved.acquiredYear,
        // Written whole, so what was set elsewhere is carried rather than put back to the kind's defaults.
        reportable: saved.reportable,
        taxTreatment: saved.taxTreatment,
        coretaxFields: next,
      });
      await invalidate();
    } catch (e) {
      setError(e);
    }
  }

  return (
    <InsetGroup header={lead.length > 0 ? 'Tax report' : 'Tax report details'} trailing={missing.length === 0 ? 'Nothing missing' : `${missing.length} still missing`}>
      {lead}
      {CORETAX_SECTIONS[section].fields.map((field, i, all) => {
        const problem = problems.find((item) => item.key === field.key);
        return (
          <TextRow
            key={field.key}
            label={ENGLISH[section][field.key] ?? field.label}
            value={fields[field.key] ?? ''}
            onChange={(e) => setFields({ ...fields, [field.key]: e.target.value })}
            onBlur={() => void save()}
            onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()}
            inputMode={field.kind === 'number' || field.kind === 'npwp' ? 'numeric' : undefined}
            placeholder={fallbacks[field.key]?.value ?? (field.kind === 'country' ? 'Country code' : 'Not set')}
            info={
              fallbacks[field.key] && !(fields[field.key] ?? '').trim()
                ? `Left empty, the report uses ${fallbacks[field.key]!.from}: ${fallbacks[field.key]!.value}.`
                : NOTES[section]?.[field.key]
            }
            hint={problem ? errorHint(problem.message) : i === all.length - 1 ? errorHint(error) : undefined}
          />
        );
      })}
    </InsetGroup>
  );
}
