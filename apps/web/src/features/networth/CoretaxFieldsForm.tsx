import { CORETAX_SECTIONS, type CoretaxSection, missingCoretaxFields, validateCoretaxFields } from '@expanses/core';
import { type AssetProfileRow, saveAssetProfile } from '@expanses/db';
import { type FormEvent, useState } from 'react';
import { useApp } from '../../app/context';
import { useInvalidateAll } from '../../lib/queries';
import { Button, ErrorBox, Field, Input } from '../../ui';

export function CoretaxFieldsForm({ profile, section }: { profile: AssetProfileRow; section: CoretaxSection }) {
  const { database, ws } = useApp();
  const invalidate = useInvalidateAll();
  const [fields, setFields] = useState<Record<string, string>>(profile.coretaxFields);
  const [error, setError] = useState<unknown>(null);
  const [saved, setSaved] = useState(false);
  const [busy, setBusy] = useState(false);

  const problems = validateCoretaxFields(section, fields);
  const missing = missingCoretaxFields(section, fields);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    setSaved(false);
    setBusy(true);
    try {
      if (problems.length > 0) throw new Error(problems[0]!.message);
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
        coretaxFields: fields,
      });
      setSaved(true);
      await invalidate();
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="space-y-3">
      <div className="flex items-baseline justify-between gap-3">
        <h2 className="text-sm font-semibold">For the tax report: {CORETAX_SECTIONS[section].label}</h2>
        <span className="text-xs text-slate-500">{missing.length === 0 ? 'Nothing missing' : `${missing.length} still missing`}</span>
      </div>
      <div className="grid gap-3 md:grid-cols-2">
        {CORETAX_SECTIONS[section].fields.map((field) => {
          const problem = problems.find((item) => item.key === field.key);
          const isMissing = missing.includes(field.key);
          return (
            <Field key={field.key} label={field.label} hint={problem ? problem.message : isMissing ? 'Missing' : undefined}>
              <Input value={fields[field.key] ?? ''} onChange={(e) => setFields({ ...fields, [field.key]: e.target.value })} />
            </Field>
          );
        })}
      </div>
      <p className="text-xs text-slate-500">Filled in once, reused by every yearly report. Nothing here stops you saving.</p>
      <div className="flex items-center gap-3">
        <Button type="submit" disabled={busy}>
          Save tax-report details
        </Button>
        {saved && <span className="text-sm text-emerald-700">Saved</span>}
      </div>
      <ErrorBox error={error} />
    </form>
  );
}
