/** Big digit boxes: the 6-digit code, the 4 check digits (mockups 2026-11-19, 2026-11-21). */
export function Digits({ value, testId, gapAfter }: { value: string; testId?: string; gapAfter?: number }) {
  return (
    <div data-testid={testId} aria-label={value.split('').join(' ')} className="flex justify-center" style={{ gap: 7, margin: '18px 0 8px' }}>
      {value.split('').map((digit, i) => (
        <span key={i} className="flex items-center" style={{ gap: 7 }}>
          <span
            aria-hidden
            className="tabular flex items-center justify-center rounded-[10px] bg-[var(--ph-fill)] font-semibold text-[var(--ph-ink)]"
            style={{ width: value.length > 4 ? 38 : 44, height: value.length > 4 ? 48 : 56, fontSize: value.length > 4 ? 24 : 30 }}
          >
            {digit}
          </span>
          {gapAfter !== undefined && i === gapAfter - 1 && <span aria-hidden style={{ width: 6 }} />}
        </span>
      ))}
    </div>
  );
}
