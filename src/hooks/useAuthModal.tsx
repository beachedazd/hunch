import type { ReactNode } from 'react';
import { createContext, useContext, useState } from 'react';
import { AuthModal } from '../components/AuthModal';

interface AuthModalContextValue {
  openAuthModal: (tab?: 'signin' | 'signup') => void;
}

const AuthModalContext = createContext<AuthModalContextValue | undefined>(undefined);

// Single global auth modal instance so any component (Header, TradeWidget's
// "Sign in to trade" prompt, etc.) can trigger it without prop drilling.
export function AuthModalProvider({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState<'signin' | 'signup'>('signin');

  function openAuthModal(nextTab: 'signin' | 'signup' = 'signin') {
    setTab(nextTab);
    setOpen(true);
  }

  return (
    <AuthModalContext.Provider value={{ openAuthModal }}>
      {children}
      <AuthModal open={open} onClose={() => setOpen(false)} initialTab={tab} />
    </AuthModalContext.Provider>
  );
}

export function useAuthModal(): AuthModalContextValue {
  const ctx = useContext(AuthModalContext);
  if (!ctx) throw new Error('useAuthModal must be used within an AuthModalProvider');
  return ctx;
}
