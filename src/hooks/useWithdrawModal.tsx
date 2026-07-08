import type { ReactNode } from 'react';
import { createContext, useContext, useState } from 'react';
import { WithdrawModal } from '../components/WithdrawModal';

interface WithdrawModalContextValue {
  openWithdrawModal: () => void;
}

const WithdrawModalContext = createContext<WithdrawModalContextValue | undefined>(undefined);

// Single global withdraw modal instance, so the Header balance chip,
// Portfolio's Cash card, and any other entry point can all open the same
// modal without prop drilling.
export function WithdrawModalProvider({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false);

  function openWithdrawModal() {
    setOpen(true);
  }

  return (
    <WithdrawModalContext.Provider value={{ openWithdrawModal }}>
      {children}
      <WithdrawModal open={open} onClose={() => setOpen(false)} />
    </WithdrawModalContext.Provider>
  );
}

export function useWithdrawModal(): WithdrawModalContextValue {
  const ctx = useContext(WithdrawModalContext);
  if (!ctx) throw new Error('useWithdrawModal must be used within a WithdrawModalProvider');
  return ctx;
}
