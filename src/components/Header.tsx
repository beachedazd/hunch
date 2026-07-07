import clsx from 'clsx';
import { useEffect, useRef, useState } from 'react';
import { NavLink, useNavigate } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth';
import { useAuthModal } from '../hooks/useAuthModal';
import { useDepositModal } from '../hooks/useDepositModal';
import { useToast } from '../hooks/useToast';
import { useWallet } from '../hooks/useWallet';
import { formatUsd } from '../lib/format';
import { Logo } from './Logo';

function truncateAddress(address: string): string {
  if (address.length <= 12) return address;
  return `${address.slice(0, 6)}…${address.slice(-4)}`;
}

export function Header() {
  const navigate = useNavigate();
  const { session, profile, signOut } = useAuth();
  const { openAuthModal } = useAuthModal();
  const { openDepositModal } = useDepositModal();
  const { address } = useWallet();
  const { showToast } = useToast();
  const [menuOpen, setMenuOpen] = useState(false);
  const [searchValue, setSearchValue] = useState('');
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function onClickOutside(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenuOpen(false);
      }
    }
    document.addEventListener('mousedown', onClickOutside);
    return () => document.removeEventListener('mousedown', onClickOutside);
  }, []);

  function submitSearch(value: string) {
    setSearchValue(value);
    navigate(`/search?q=${encodeURIComponent(value)}`);
  }

  async function handleSignOut() {
    setMenuOpen(false);
    await signOut();
    showToast('Signed out', 'info');
    navigate('/');
  }

  const initial = (profile?.username || session?.user.email || '?').charAt(0).toUpperCase();

  return (
    <header className="sticky top-0 z-40 border-b border-border-c bg-white">
      <div className="mx-auto flex max-w-7xl items-center gap-3 px-4 py-3 sm:gap-5 sm:px-7">
        <Logo />

        <div className="hidden max-w-[460px] flex-1 sm:block">
          <div className="flex items-center gap-2 rounded-xl bg-subtle px-3.5 py-2.5 text-sm text-text-muted">
            <span className="text-[13px]">⌕</span>
            <input
              type="search"
              value={searchValue}
              onChange={(e) => setSearchValue(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') submitSearch(searchValue);
              }}
              onClick={() => navigate('/search')}
              placeholder="Search markets…"
              className="w-full bg-transparent text-sm text-text-primary placeholder-text-muted outline-none"
            />
          </div>
        </div>

        <div className="ml-auto flex items-center gap-5">
          <nav className="hidden items-center gap-6 text-sm font-semibold text-text-secondary sm:flex">
            <NavLink
              to="/"
              end
              className={({ isActive }) => clsx(isActive && 'text-teal')}
            >
              Markets
            </NavLink>
            <NavLink
              to="/leaderboard"
              className={({ isActive }) => clsx(isActive && 'text-teal')}
            >
              Leaderboard
            </NavLink>
          </nav>

          <div className="flex items-center gap-2.5">
            {session && (
              <button
                onClick={openDepositModal}
                title="Add funds"
                className="whitespace-nowrap rounded-[11px] bg-teal-tint px-3.5 py-2 text-sm font-bold text-teal-deep transition hover:bg-[#d7eef0]"
              >
                {formatUsd(profile?.balance ?? 0)}
                <span className="ml-1.5 font-extrabold">+</span>
              </button>
            )}

            {session && address && (
              <button
                onClick={openDepositModal}
                title="Wallet connected"
                className="hidden whitespace-nowrap rounded-[11px] bg-subtle px-3 py-2 font-mono text-xs font-bold text-text-secondary transition hover:bg-[#e4eaec] sm:inline-block"
              >
                {truncateAddress(address)}
              </button>
            )}

            {session ? (
              <div className="relative" ref={menuRef}>
                <button
                  onClick={() => setMenuOpen((v) => !v)}
                  className="flex h-9 w-9 items-center justify-center rounded-full bg-[#f4a261] text-sm font-bold text-white"
                >
                  {initial}
                </button>
                {menuOpen && (
                  <div className="absolute right-0 mt-2 w-48 overflow-hidden rounded-xl border border-border-c bg-white py-1 shadow-xl">
                    <div className="truncate border-b border-border-c px-3.5 py-2.5 text-xs font-semibold text-text-muted">
                      {profile?.username || session.user.email}
                    </div>
                    <NavLink
                      to="/portfolio"
                      onClick={() => setMenuOpen(false)}
                      className="block px-3.5 py-2.5 text-sm font-medium text-text-primary transition hover:bg-subtle"
                    >
                      Portfolio
                    </NavLink>
                    {profile?.is_admin && (
                      <NavLink
                        to="/admin"
                        onClick={() => setMenuOpen(false)}
                        className="block px-3.5 py-2.5 text-sm font-medium text-text-primary transition hover:bg-subtle"
                      >
                        Admin
                      </NavLink>
                    )}
                    <button
                      onClick={handleSignOut}
                      className="block w-full px-3.5 py-2.5 text-left text-sm font-medium text-no transition hover:bg-subtle"
                    >
                      Sign out
                    </button>
                  </div>
                )}
              </div>
            ) : (
              <div className="flex items-center gap-3">
                <button
                  onClick={() => openAuthModal('signin')}
                  className="text-sm font-semibold text-text-secondary transition hover:text-text-primary"
                >
                  Log in
                </button>
                <button
                  onClick={() => openAuthModal('signup')}
                  className="rounded-[11px] bg-teal px-4 py-2 text-sm font-extrabold text-white transition hover:bg-teal-deep"
                >
                  Sign up
                </button>
              </div>
            )}
          </div>
        </div>
      </div>
    </header>
  );
}
