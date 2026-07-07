import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { EmptyState } from '../components/EmptyState';
import { Skeleton } from '../components/Skeleton';
import { useAuth } from '../hooks/useAuth';
import { useAuthModal } from '../hooks/useAuthModal';
import { useDepositModal } from '../hooks/useDepositModal';
import { useFaucet } from '../hooks/useFaucet';
import { useToast } from '../hooks/useToast';
import {
  getMyPositions,
  getMyTradesForMarket,
  getMyTransactions,
  redeemWinnings,
} from '../lib/api';
import { priceNo, priceYes } from '../lib/cpmm';
import { formatDate, formatDateTime, formatShares, formatUsd } from '../lib/format';
import type { PositionWithMarket, Trade } from '../types';

export default function Portfolio() {
  const { session, profile } = useAuth();
  const { openAuthModal } = useAuthModal();
  const { openDepositModal } = useDepositModal();
  const { showToast } = useToast();
  const faucet = useFaucet();

  const { data: positions, isLoading: positionsLoading } = useQuery({
    queryKey: ['positions'],
    queryFn: getMyPositions,
    enabled: !!session,
  });

  const { data: transactions, isLoading: txLoading } = useQuery({
    queryKey: ['transactions'],
    queryFn: getMyTransactions,
    enabled: !!session,
  });

  async function handleFaucet() {
    const ok = await faucet.claim();
    if (ok) showToast('+$1,000 credited', 'success');
  }

  const openPositions = useMemo(
    () =>
      (positions ?? []).filter(
        (p) => p.market.status === 'open' && (p.yes_shares > 0 || p.no_shares > 0)
      ),
    [positions]
  );

  const resolvedPositions = useMemo(
    () => (positions ?? []).filter((p) => p.market.status !== 'open'),
    [positions]
  );

  const positionsValue = openPositions.reduce((sum, p) => {
    const pYes = priceYes(p.market.yes_pool, p.market.no_pool);
    const pNo = priceNo(p.market.yes_pool, p.market.no_pool);
    return sum + p.yes_shares * pYes + p.no_shares * pNo;
  }, 0);
  const cash = profile?.balance ?? 0;
  const portfolioValue = cash + positionsValue;

  if (!session) {
    return (
      <div className="mx-auto max-w-3xl px-4 py-16 sm:px-7">
        <EmptyState
          title="Sign in to view your portfolio"
          description="Track your positions, balance, and transaction history."
          action={
            <button
              onClick={() => openAuthModal('signin')}
              className="rounded-xl bg-teal px-4 py-2 text-sm font-bold text-white transition hover:bg-teal-deep"
            >
              Sign in
            </button>
          }
        />
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-6xl px-4 py-6 sm:px-7">
      <h1 className="mb-5 text-[26px] font-extrabold tracking-tight text-text-primary">
        Your portfolio
      </h1>

      <div className="mb-6 grid grid-cols-1 gap-4 sm:grid-cols-3">
        <div className="rounded-2xl border border-border-c bg-white p-[18px]">
          <div className="text-xs font-bold text-text-muted">Portfolio value</div>
          <div className="mt-1 text-[28px] font-extrabold text-text-primary">
            {formatUsd(portfolioValue)}
          </div>
          <div className="mt-0.5 text-[13px] font-bold text-yes">
            {formatUsd(positionsValue)} in open positions
          </div>
        </div>
        <div className="rounded-2xl border border-border-c bg-white p-[18px]">
          <div className="text-xs font-bold text-text-muted">Cash</div>
          <div className="mt-1 text-[28px] font-extrabold text-text-primary">
            {formatUsd(cash)}
          </div>
          <button
            onClick={openDepositModal}
            className="mt-0.5 text-[13px] font-bold text-teal-deep hover:underline"
          >
            + Add funds
          </button>
        </div>
        <div className="rounded-2xl border border-border-c bg-white p-[18px]">
          <div className="text-xs font-bold text-text-muted">Open positions</div>
          <div className="mt-1 text-[28px] font-extrabold text-text-primary">
            {openPositions.length}
          </div>
          <button
            onClick={handleFaucet}
            disabled={faucet.claiming}
            className="mt-0.5 text-[13px] font-bold text-teal-deep hover:underline disabled:opacity-60"
          >
            {faucet.claiming ? 'Claiming…' : 'Claim 1000 faucet'}
          </button>
          {faucet.error && <p className="mt-1 text-xs font-medium text-no">{faucet.error}</p>}
        </div>
      </div>

      <section className="mb-6">
        <h2 className="mb-3 text-[15px] font-extrabold text-text-primary">Open positions</h2>
        {positionsLoading ? (
          <div className="space-y-2">
            <Skeleton className="h-14 w-full rounded-2xl" />
            <Skeleton className="h-14 w-full rounded-2xl" />
          </div>
        ) : openPositions.length === 0 ? (
          <EmptyState
            title="No open positions"
            description="Buy Yes or No shares on a market to see it here."
            action={
              <Link to="/" className="text-sm font-bold text-teal hover:underline">
                Browse markets
              </Link>
            }
          />
        ) : (
          <div className="overflow-x-auto rounded-2xl border border-border-c bg-white">
            <table className="w-full min-w-[720px] text-left text-sm">
              <thead>
                <tr className="border-b border-border-c text-xs font-bold uppercase tracking-wide text-text-faint">
                  <th className="px-4 py-3">Market</th>
                  <th className="px-4 py-3">Side</th>
                  <th className="px-4 py-3">Shares</th>
                  <th className="px-4 py-3">Avg</th>
                  <th className="px-4 py-3">P&amp;L</th>
                  <th className="px-4 py-3"></th>
                </tr>
              </thead>
              <tbody>
                {openPositions.map((p) => (
                  <PositionRow key={p.market_id} position={p} />
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {resolvedPositions.length > 0 && (
        <section className="mb-6">
          <h2 className="mb-3 text-[15px] font-extrabold text-text-primary">Recently resolved</h2>
          <div className="flex flex-col gap-3 rounded-2xl border border-border-c bg-white p-5">
            {resolvedPositions.map((p) => (
              <ResolvedRow
                key={p.market_id}
                position={p}
                redeemTx={transactions?.find(
                  (t) => t.type === 'redeem' && t.market_id === p.market_id
                )}
              />
            ))}
          </div>
        </section>
      )}

      <section>
        <h2 className="mb-3 text-[15px] font-extrabold text-text-primary">Transaction history</h2>
        {txLoading ? (
          <Skeleton className="h-40 w-full rounded-2xl" />
        ) : !transactions || transactions.length === 0 ? (
          <EmptyState title="No transactions yet" />
        ) : (
          <div className="overflow-x-auto rounded-2xl border border-border-c bg-white">
            <table className="w-full min-w-[560px] text-left text-sm">
              <thead>
                <tr className="border-b border-border-c text-xs font-bold uppercase tracking-wide text-text-faint">
                  <th className="px-4 py-3">Type</th>
                  <th className="px-4 py-3">Amount</th>
                  <th className="px-4 py-3">Reference</th>
                  <th className="px-4 py-3">Date</th>
                </tr>
              </thead>
              <tbody>
                {transactions.map((t) => (
                  <tr key={t.id} className="border-b border-border-c last:border-b-0">
                    <td className="px-4 py-3 font-semibold capitalize">{t.type}</td>
                    <td
                      className={`px-4 py-3 font-bold ${t.amount >= 0 ? 'text-yes' : 'text-no'}`}
                    >
                      {t.amount >= 0 ? '+' : ''}
                      {formatUsd(t.amount)}
                    </td>
                    <td className="px-4 py-3 text-text-muted">{t.ref || '—'}</td>
                    <td className="px-4 py-3 text-text-muted">{formatDateTime(t.created_at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}

function avgCostFor(trades: Trade[], outcome: 'yes' | 'no'): number | null {
  const buys = trades.filter((t) => t.outcome === outcome && t.action === 'buy');
  const totalShares = buys.reduce((sum, t) => sum + Number(t.shares), 0);
  const totalCost = buys.reduce((sum, t) => sum + Number(t.amount), 0);
  if (totalShares <= 0) return null;
  return totalCost / totalShares;
}

function PositionRow({ position }: { position: PositionWithMarket }) {
  const { market } = position;

  const { data: trades } = useQuery({
    queryKey: ['myTrades', market.id],
    queryFn: () => getMyTradesForMarket(market.id),
  });

  const pYes = priceYes(market.yes_pool, market.no_pool);
  const pNo = priceNo(market.yes_pool, market.no_pool);
  const value = position.yes_shares * pYes + position.no_shares * pNo;

  const avgCostYes = trades ? avgCostFor(trades, 'yes') : null;
  const avgCostNo = trades ? avgCostFor(trades, 'no') : null;
  const costBasis =
    position.yes_shares * (avgCostYes ?? pYes) + position.no_shares * (avgCostNo ?? pNo);
  const pnl = value - costBasis;

  return (
    <tr className="border-b border-border-c last:border-b-0">
      <td className="max-w-[240px] px-4 py-3">
        <Link
          to={`/market/${market.slug}`}
          className="line-clamp-2 font-bold text-text-primary hover:text-teal-deep"
        >
          {market.question}
        </Link>
        <div className="mt-0.5 text-xs font-medium text-text-faint">
          {market.category || 'Other'} · resolves {formatDate(market.close_time)}
        </div>
      </td>
      <td className="px-4 py-3">
        {position.yes_shares > 0 && (
          <span className="rounded-full bg-teal-tint px-3 py-1 text-xs font-extrabold text-teal-deep">
            Yes
          </span>
        )}
        {position.no_shares > 0 && (
          <span className="rounded-full bg-no-bg px-3 py-1 text-xs font-extrabold text-no">
            No
          </span>
        )}
      </td>
      <td className="px-4 py-3 font-semibold text-text-secondary">
        {position.yes_shares > 0 && <div>{formatShares(position.yes_shares)}</div>}
        {position.no_shares > 0 && <div>{formatShares(position.no_shares)}</div>}
      </td>
      <td className="px-4 py-3 font-semibold text-text-secondary">
        {position.yes_shares > 0 && (
          <div>{avgCostYes !== null ? `${(avgCostYes * 100).toFixed(1)}¢` : '—'}</div>
        )}
        {position.no_shares > 0 && (
          <div>{avgCostNo !== null ? `${(avgCostNo * 100).toFixed(1)}¢` : '—'}</div>
        )}
      </td>
      <td className={`px-4 py-3 font-extrabold ${pnl >= 0 ? 'text-yes' : 'text-no'}`}>
        {pnl >= 0 ? '+' : ''}
        {formatUsd(pnl)}
      </td>
      <td className="px-4 py-3">
        <Link
          to={`/market/${market.slug}`}
          className="inline-block rounded-lg bg-subtle px-3 py-1.5 text-xs font-bold text-text-secondary transition hover:bg-[#e4eaec]"
        >
          Sell
        </Link>
      </td>
    </tr>
  );
}

function ResolvedRow({
  position,
  redeemTx,
}: {
  position: PositionWithMarket;
  redeemTx?: { amount: number };
}) {
  const { market } = position;
  const queryClient = useQueryClient();
  const [redeeming, setRedeeming] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const { data: trades } = useQuery({
    queryKey: ['myTrades', market.id],
    queryFn: () => getMyTradesForMarket(market.id),
  });

  const netYes = (trades ?? []).reduce(
    (sum, t) => sum + (t.outcome === 'yes' ? (t.action === 'buy' ? t.shares : -t.shares) : 0),
    0
  );
  const netNo = (trades ?? []).reduce(
    (sum, t) => sum + (t.outcome === 'no' ? (t.action === 'buy' ? t.shares : -t.shares) : 0),
    0
  );
  const heldSide: 'yes' | 'no' | null =
    position.yes_shares > 0
      ? 'yes'
      : position.no_shares > 0
        ? 'no'
        : netYes > netNo
          ? 'yes'
          : netNo > 0
            ? 'no'
            : null;

  const isVoid = market.status === 'void';
  const correct = !isVoid && heldSide !== null && market.resolution === heldSide;
  const hasUnredeemedShares = position.yes_shares > 0 || position.no_shares > 0;
  const canRedeem =
    hasUnredeemedShares &&
    ((market.resolution === 'yes' && position.yes_shares > 0) ||
      (market.resolution === 'no' && position.no_shares > 0) ||
      isVoid);

  async function handleRedeem() {
    setRedeeming(true);
    setError(null);
    try {
      await redeemWinnings(market.id);
      await Promise.all([
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
    <div className="flex items-center gap-3 text-[13.5px] font-semibold">
      <span
        className={`flex h-[26px] w-[26px] shrink-0 items-center justify-center rounded-full font-extrabold ${
          isVoid
            ? 'bg-subtle text-text-muted'
            : correct
              ? 'bg-yes-bg text-yes'
              : 'bg-no-bg text-no'
        }`}
      >
        {isVoid ? '·' : correct ? '✓' : '✕'}
      </span>
      <span className="flex-1">
        <Link to={`/market/${market.slug}`} className="hover:text-teal-deep">
          {market.question}
        </Link>
        {heldSide && !isVoid && (
          <>
            {' '}
            — you called{' '}
            <span className={heldSide === 'yes' ? 'font-bold text-teal-deep' : 'font-bold text-no'}>
              {heldSide === 'yes' ? 'Yes' : 'No'}
            </span>
            {correct ? ', correct' : ', missed'}
          </>
        )}
        {isVoid && ' — voided, refunded'}
      </span>
      {redeemTx ? (
        <span className={`font-extrabold ${redeemTx.amount >= 0 ? 'text-yes' : 'text-no'}`}>
          {redeemTx.amount >= 0 ? '+' : ''}
          {formatUsd(redeemTx.amount)}
        </span>
      ) : canRedeem ? (
        <button
          onClick={handleRedeem}
          disabled={redeeming}
          className="rounded-lg bg-teal px-3 py-1.5 text-xs font-bold text-white transition hover:bg-teal-deep disabled:opacity-60"
        >
          {redeeming ? 'Redeeming…' : 'Redeem'}
        </button>
      ) : null}
      {error && <p className="text-xs font-medium text-no">{error}</p>}
    </div>
  );
}
