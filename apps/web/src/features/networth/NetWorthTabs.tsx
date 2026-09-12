import { Link } from '@tanstack/react-router';

const TABS = [
  { to: '/net-worth', label: 'Overview' },
  { to: '/net-worth/assets', label: 'Assets' },
  { to: '/net-worth/trades', label: 'Buy & sell' },
  { to: '/net-worth/goals', label: 'Goals' },
] as const;

export function NetWorthTabs() {
  return (
    <nav className="flex gap-1 border-b border-slate-200">
      {TABS.map((tab) => (
        <Link
          key={tab.to}
          to={tab.to}
          className="border-b-2 border-transparent px-3 py-2 text-sm text-slate-600 hover:text-slate-900"
          activeProps={{ className: 'border-slate-900 font-semibold text-slate-900' }}
          activeOptions={{ exact: tab.to === '/net-worth' }}
        >
          {tab.label}
        </Link>
      ))}
    </nav>
  );
}
