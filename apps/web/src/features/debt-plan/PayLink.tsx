import { Link, type LinkProps } from '@tanstack/react-router';
import type { ReactNode } from 'react';
import type { PayTarget } from './pay-target';

/** A link to a debt's own page with the param that opens its pay sheet; the sheet goes back here after. */
export function PayLink({ target, children, className, label, testId }: { target: PayTarget; children: ReactNode; className?: string; label?: string; testId?: string }) {
  return (
    <Link to={target.to as LinkProps['to']} params={target.params as LinkProps['params']} search={target.search as LinkProps['search']} className={className} aria-label={label} data-testid={testId}>
      {children}
    </Link>
  );
}
