import { CORETAX_SECTIONS, type CoretaxSection, missingCoretaxFields, validateCoretaxFields } from '@expanses/core';
import { type AssetProfileRow, saveAssetProfile } from '@expanses/db';
import { useState } from 'react';
import { useApp } from '../../app/context';
import { useInvalidateAll } from '../../lib/queries';
import { InsetGroup, TextRow } from '../../ui/native';
import { errorHint } from './AssetSettings';
import { fieldsToSave } from './settings-model';

/**
 * What the tax report's table for this thing asks of it, one row per question, each saved when it is left. A field
 * that does not read well (an NPWP with a digit short) says so under itself and is not saved; the rest still are.
 * Nothing here is required to save: the report is what says what is still missing.
 */
export function CoretaxFieldsGroup({ profile, section }: { profile: AssetProfileRow; section: CoretaxSection }) {
  const { database, ws } = useApp();
  const invalidate = useInvalidateAll();
  const [fields, setFields] = useState<Record<string, string>>(profile.coretaxFields);
  const [error, setError] = useState<unknown>(null);

  const problems = validateCoretaxFields(section, fields);
  // What the report will find missing: counted from what is saved, so it changes when a row has been kept.
  const missing = missingCoretaxFields(section, profile.coretaxFields);

  async function save() {
    const wrong = new Set(problems.map((problem) => problem.key));
    const next = fieldsToSave(profile.coretaxFields, fields, wrong);
    if (JSON.stringify(next) === JSON.stringify(profile.coretaxFields)) return;
    setError(null);
    try {
      await saveAssetProfile(database, ws, {
        accountId: profile.accountId,
        assetKind: profile.assetKind,
        planGroup: profile.planGroup,
        unitKind: profile.unitKind,
        lotSize: profile.lotSize,
        risk: profile.risk,
        coretaxSection: profile.coretaxSection,
        coretaxCode: profile.coretaxCode,
        acquiredYear: profile.acquiredYear,
        coretaxFields: next,
      });
      await invalidate();
    } catch (e) {
      setError(e);
    }
  }

  return (
    <InsetGroup header={CORETAX_SECTIONS[section].label} trailing={missing.length === 0 ? 'Nothing missing' : `${missing.length} still missing`}>
      {CORETAX_SECTIONS[section].fields.map((field, i, all) => {
        const problem = problems.find((item) => item.key === field.key);
        return (
          <TextRow
            key={field.key}
            label={field.label}
            value={fields[field.key] ?? ''}
            onChange={(e) => setFields({ ...fields, [field.key]: e.target.value })}
            onBlur={() => void save()}
            onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()}
            inputMode={field.kind === 'number' || field.kind === 'npwp' ? 'numeric' : undefined}
            placeholder={field.kind === 'country' ? 'Country code' : 'Not set'}
            hint={problem ? errorHint(problem.message) : i === all.length - 1 ? errorHint(error) : undefined}
          />
        );
      })}
    </InsetGroup>
  );
}
