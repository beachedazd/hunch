import { useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { claimFaucet } from '../lib/api';
import { useAuth } from './useAuth';

// Shared faucet-claim mutation — used by Portfolio's "Claim 1000 faucet"
// link and the Deposit modal's "Demo funds" section, so both stay in sync
// with the same balance/transactions invalidation logic.
export function useFaucet() {
  const { refetchProfile } = useAuth();
  const queryClient = useQueryClient();
  const [claiming, setClaiming] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function claim(): Promise<boolean> {
    setClaiming(true);
    setError(null);
    try {
      await claimFaucet();
      await Promise.all([
        refetchProfile(),
        queryClient.invalidateQueries({ queryKey: ['transactions'] }),
      ]);
      return true;
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Faucet claim failed');
      return false;
    } finally {
      setClaiming(false);
    }
  }

  return { claiming, error, claim };
}
