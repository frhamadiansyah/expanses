import { Link, Outlet } from '@tanstack/react-router';
import { BackupBanner } from '../features/backup/BackupBanner';
import { InstallHint } from '../features/pwa/InstallHint';
import { useApp } from './context';

const NAV = [
  { to: '/', label: 'Dashboard' },
  { to: '/transactions', label: 'Transactions' },
  { to: '/cards', label: 'Cards' },
  { to: '/spending', label: 'Spending' },
  { to: '/budget', label: 'Budget' },
  { to: '/events', label: 'Occasions' },
  { to: '/goals', label: 'Goals' },
  { to: '/accounts', label: 'Accounts' },
  { to: '/categories', label: 'Categories' },
  { to: '/net-worth', label: 'Net worth' },
] as const;

const MORE = [
  { to: '/calculators', label: 'Calculators' },
  { to: '/tax-report', label: 'Tax report' },
  { to: '/recommend', label: 'Which card?' },
  { to: '/import', label: 'Import CSV' },
  { to: '/backup', label: 'Backup' },
] as const;

export function Layout() {
  const { workspaceName, ws } = useApp();
  return (
    <div className="min-h-dvh md:flex">
      <aside className="hidden w-56 shrink-0 border-r border-slate-200 bg-white p-4 md:block">
        <div className="mb-6 px-3">
          <div className="text-lg font-semibold">Expanses</div>
          <div className="text-xs text-slate-500">
            {workspaceName} · {ws.baseCurrency} · on this device
          </div>
        </div>
        <nav className="space-y-1">
          {NAV.map((item) => (
            <Link
              key={item.to}
              to={item.to}
              className="block rounded-lg px-3 py-2 text-sm text-slate-700 hover:bg-slate-100"
              activeProps={{ className: 'bg-slate-100 font-medium text-slate-900' }}
              activeOptions={{ exact: item.to === '/' }}
            >
              {item.label}
            </Link>
          ))}
        </nav>
        <div className="mt-6 space-y-1 border-t border-slate-200 pt-4">
          {MORE.map((item) => (
            <Link key={item.to} to={item.to} className="block rounded-lg px-3 py-2 text-sm text-slate-600 hover:bg-slate-100" activeProps={{ className: 'bg-slate-100 font-medium text-slate-900' }}>
              {item.label}
            </Link>
          ))}
        </div>
      </aside>
      <main className="flex-1 pb-24 md:pb-8">
        <div className="mx-auto max-w-4xl p-4 md:p-8">
          <InstallHint />
          <BackupBanner />
          <Outlet />
        </div>
      </main>
      <nav
        className="fixed inset-x-0 bottom-0 z-10 flex border-t border-slate-200 bg-white md:hidden"
        style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}
      >
        {NAV.map((item) => (
          <Link
            key={item.to}
            to={item.to}
            className="flex-1 py-3 text-center text-[11px] text-slate-600"
            activeProps={{ className: 'font-semibold text-slate-900' }}
            activeOptions={{ exact: item.to === '/' }}
          >
            {item.label}
          </Link>
        ))}
      </nav>
    </div>
  );
}
