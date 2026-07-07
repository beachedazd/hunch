import type { ReactNode } from 'react';
import { createContext, useContext, useState } from 'react';
import { DepositModal } from '../components/DepositModal';

interface DepositModalContextValue {
  openDepositModal: () => void;
}

const DepositModalContext = createContext<DepositModalContextValue | undefined>(undefined);

// Single global "+ Add funds" modal instance, so the Header balance chip,
// Portfolio's Cash card, and any other entry point can all open the same
// modal without prop drilling.
export function DepositModalProvider({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false);

  function openDepositModal() {
    setOpen(true);
  }

  return (
    <DepositModalContext.Provider value={{ openDepositModal }}>
      {children}
      <DepositModal open={open} onClose={() => setOpen(false)} />
    </DepositModalContext.Provider>
  );
}

export function useDepositModal(): DepositModalContextValue {
  const ctx = useContext(DepositModalContext);
  if (!ctx) throw new Error('useDepositModal must be used within a DepositModalProvider');
  return ctx;
}
