import clsx from 'clsx';
import { NavLink } from 'react-router-dom';

const TABS = [
  { to: '/', label: 'Markets', icon: '◉', end: true },
  { to: '/search', label: 'Search', icon: '⌕', end: false },
  { to: '/portfolio', label: 'Portfolio', icon: '▤', end: false },
];

export function BottomNav() {
  return (
    <nav className="fixed inset-x-0 bottom-0 z-40 flex justify-around border-t border-border-c bg-white pb-[max(env(safe-area-inset-bottom),12px)] pt-2 sm:hidden">
      {TABS.map((tab) => (
        <NavLink
          key={tab.to}
          to={tab.to}
          end={tab.end}
          className={({ isActive }) =>
            clsx(
              'flex min-w-[56px] flex-col items-center gap-0.5 text-[10.5px] font-bold',
              isActive ? 'text-teal' : 'text-text-faint'
            )
          }
        >
          <span className="text-[19px] leading-none">{tab.icon}</span>
          {tab.label}
        </NavLink>
      ))}
    </nav>
  );
}
