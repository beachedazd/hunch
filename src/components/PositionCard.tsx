import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useToast } from '../hooks/useToast';
import { redeemWinnings } from '../lib/api';
import { priceNo, priceYes } from '../lib/cpmm';
import { formatShares, formatUsd } from '../lib/format';
import type { Market, Position } from '../types';

interface PositionCardProps {
  market: Market;
  position: Position;
}

export function PositionCard({ market, position }: PositionCardProps) {
  const [redeeming, setRedeeming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { showToast } = useToast();
  const queryClient = useQueryClient();

  const hasShares = position.yes_shares > 0 || position.no_shares > 0;
  if (!hasShares) return null;

  const pYes = priceYes(market.yes_pool, market.no_pool);
  const pNo = priceNo(market.yes_pool, market.no_pool);
  const currentValue = position.yes_shares * pYes + position.no_shares * pNo;

  const isResolved = market.status === 'resolved';
  const isVoid = market.status === 'void';
  const canRedeem =
    (isResolved || isVoid) &&
    ((market.resolution === 'yes' && position.yes_shares > 0) ||
      (market.resolution === 'no' && position.no_shares > 0) ||
      (isVoid && hasShares));

  async function handleRedeem() {
    setRedeeming(true);
    setError(null);
    try {
      const payout = await redeemWinnings(market.id);
      showToast(`Redeemed ${formatUsd(payout)}`, 'success');
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['position', market.id] }),
        queryClient.invalidateQueries({ queryKey: ['positions'] }),
        queryClient.invalidateQueries({ queryKey: ['profile'] }),
        queryClient.invalidateQueries({ queryKey: ['transactions'] }),
      ]);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Redeem failed');
    } finally {
      setRedeeming(false);
    }
  }

  return (
    <div className="rounded-2xl border border-border-c bg-white p-5">
      <h3 className="mb-3 text-[15px] font-extrabold text-text-primary">Your position</h3>
      <div className="space-y-1.5 text-sm font-medium">
        {position.yes_shares > 0 && (
          <div className="flex justify-between">
            <span className="text-teal-deep">Yes shares</span>
            <span className="text-text-primary">{formatShares(position.yes_shares)}</span>
          </div>
        )}
        {position.no_shares > 0 && (
          <div className="flex justify-between">
            <span className="text-no">No shares</span>
            <span className="text-text-primary">{formatShares(position.no_shares)}</span>
          </div>
        )}
        <div className="flex justify-between border-t border-border-c pt-1.5">
          <span className="text-text-muted">
            {isResolved || isVoid ? 'Final value' : 'Current value'}
          </span>
          <span className="font-bold text-text-primary">{formatUsd(currentValue)}</span>
        </div>
      </div>

      {error && (
        <p className="mt-3 rounded-lg border border-no/30 bg-no-bg px-3 py-2 text-xs font-medium text-no">
          {error}
        </p>
      )}

      {canRedeem && (
        <button
          onClick={handleRedeem}
          disabled={redeeming}
          className="mt-3 w-full rounded-xl bg-teal py-2.5 text-sm font-bold text-white transition hover:bg-teal-deep disabled:cursor-not-allowed disabled:opacity-60"
        >
          {redeeming ? 'Redeeming…' : 'Redeem winnings'}
        </button>
      )}
    </div>
  );
}
