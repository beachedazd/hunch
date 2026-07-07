import clsx from 'clsx';
import { useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '../hooks/useAuth';
import { useAuthModal } from '../hooks/useAuthModal';
import { useToast } from '../hooks/useToast';
import { buyShares, getMyPosition, sellShares } from '../lib/api';
import { priceYes, quoteBuy, quoteSell } from '../lib/cpmm';
import { formatShares, formatUsd } from '../lib/format';
import type { Market, Outcome } from '../types';

interface TradeWidgetProps {
  market: Market;
}

type Mode = 'buy' | 'sell';

const BUY_QUICK_AMOUNTS = [5, 25, 100];
const SELL_QUICK_FRACTIONS = [0.25, 0.5, 1];

export function TradeWidget({ market }: TradeWidgetProps) {
  const [searchParams] = useSearchParams();
  const initialOutcome = (searchParams.get('outcome') as Outcome) || 'yes';

  const [mode, setMode] = useState<Mode>('buy');
  const [outcome, setOutcome] = useState<Outcome>(initialOutcome === 'no' ? 'no' : 'yes');
  const [input, setInput] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const { session, profile } = useAuth();
  const { openAuthModal } = useAuthModal();
  const { showToast } = useToast();
  const queryClient = useQueryClient();

  const isClosed = market.status !== 'open';

  const { data: position } = useQuery({
    queryKey: ['position', market.id, session?.user.id ?? null],
    queryFn: () => getMyPosition(market.id),
    enabled: !!session,
  });

  const ownedShares = outcome === 'yes' ? (position?.yes_shares ?? 0) : (position?.no_shares ?? 0);
  const balance = profile?.balance ?? 0;
  const amountNum = Number(input);
  const hasValidInput = input.trim() !== '' && Number.isFinite(amountNum) && amountNum > 0;

  const pYes = priceYes(market.yes_pool, market.no_pool);
  const pNo = 1 - pYes;
  const outcomePrice = outcome === 'yes' ? pYes : pNo;

  const buyQuote = useMemo(() => {
    if (mode !== 'buy' || !hasValidInput) return null;
    return quoteBuy(market.yes_pool, market.no_pool, outcome, amountNum, market.fee_bps);
  }, [mode, hasValidInput, amountNum, market, outcome]);

  const sellQuote = useMemo(() => {
    if (mode !== 'sell' || !hasValidInput) return null;
    return quoteSell(market.yes_pool, market.no_pool, outcome, amountNum, market.fee_bps);
  }, [mode, hasValidInput, amountNum, market, outcome]);

  const insufficientBalance = mode === 'buy' && hasValidInput && amountNum > balance;
  const insufficientShares = mode === 'sell' && hasValidInput && amountNum > ownedShares;

  function resetInput() {
    setInput('');
    setError(null);
  }

  function switchMode(next: Mode) {
    setMode(next);
    resetInput();
  }

  function switchOutcome(next: Outcome) {
    setOutcome(next);
    resetInput();
  }

  function addAmount(amt: number) {
    const current = Number.isFinite(amountNum) && amountNum > 0 ? amountNum : 0;
    setInput(String(Math.round((current + amt) * 100) / 100));
  }

  async function invalidateAfterTrade() {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ['market', market.slug] }),
      queryClient.invalidateQueries({ queryKey: ['trades', market.id] }),
      queryClient.invalidateQueries({ queryKey: ['position', market.id] }),
      queryClient.invalidateQueries({ queryKey: ['positions'] }),
      queryClient.invalidateQueries({ queryKey: ['profile'] }),
      queryClient.invalidateQueries({ queryKey: ['transactions'] }),
      queryClient.invalidateQueries({ queryKey: ['markets'] }),
    ]);
  }

  async function handleSubmit() {
    if (!session) {
      openAuthModal('signin');
      return;
    }
    if (!hasValidInput) return;

    setSubmitting(true);
    setError(null);
    try {
      if (mode === 'buy') {
        const result = await buyShares(market.id, outcome, amountNum);
        showToast(`Bought ${formatShares(result.shares)} ${outcome.toUpperCase()} shares`, 'success');
      } else {
        const result = await sellShares(market.id, outcome, amountNum);
        showToast(`Sold for ${formatUsd(result.proceeds)}`, 'success');
      }
      resetInput();
      await invalidateAfterTrade();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Trade failed');
    } finally {
      setSubmitting(false);
    }
  }

  const submitDisabled =
    isClosed || !hasValidInput || insufficientBalance || insufficientShares || submitting;

  let buttonLabel = `${mode === 'buy' ? 'Buy' : 'Sell'} ${outcome === 'yes' ? 'Yes' : 'No'}`;
  if (!session) buttonLabel = 'Sign in to trade';
  else if (isClosed) buttonLabel = 'Market closed';
  else if (submitting) buttonLabel = 'Processing…';
  else if (insufficientBalance) buttonLabel = 'Insufficient balance';
  else if (insufficientShares) buttonLabel = 'Insufficient shares';

  const potentialPayout = buyQuote && amountNum > 0 ? buyQuote.shares : 0;
  const potentialGainPct =
    buyQuote && amountNum > 0 ? ((buyQuote.shares - amountNum) / amountNum) * 100 : 0;

  return (
    <div className="flex flex-col gap-3.5 rounded-2xl border border-border-c bg-white p-5">
      <div className="flex items-center justify-between">
        <span className="text-xs font-bold uppercase tracking-wide text-text-muted">Trade</span>
        <div className="flex gap-0.5 rounded-lg bg-subtle p-0.5 text-xs font-bold">
          <button
            onClick={() => switchMode('buy')}
            className={clsx(
              'rounded-md px-2.5 py-1 transition',
              mode === 'buy' ? 'bg-white text-text-primary shadow-sm' : 'text-text-muted'
            )}
          >
            Buy
          </button>
          <button
            onClick={() => switchMode('sell')}
            className={clsx(
              'rounded-md px-2.5 py-1 transition',
              mode === 'sell' ? 'bg-white text-text-primary shadow-sm' : 'text-text-muted'
            )}
          >
            Sell
          </button>
        </div>
      </div>

      <div className="flex rounded-xl bg-subtle p-1 text-center text-[14.5px] font-extrabold">
        <button
          onClick={() => switchOutcome('yes')}
          className={clsx(
            'flex-1 rounded-[9px] py-2.5 transition',
            outcome === 'yes' ? 'bg-white text-teal-deep shadow-sm' : 'text-text-muted'
          )}
        >
          {mode === 'buy' ? 'Buy' : 'Sell'} Yes {Math.round(pYes * 100)}¢
        </button>
        <button
          onClick={() => switchOutcome('no')}
          className={clsx(
            'flex-1 rounded-[9px] py-2.5 transition',
            outcome === 'no' ? 'bg-white text-no shadow-sm' : 'text-text-muted'
          )}
        >
          {mode === 'buy' ? 'Buy' : 'Sell'} No {Math.round(pNo * 100)}¢
        </button>
      </div>

      <div>
        <div className="mb-1.5 text-xs font-bold text-text-muted">
          {mode === 'buy' ? 'Amount' : 'Shares'}
        </div>
        <div className="flex items-center justify-between rounded-xl border-[1.5px] border-[#dfe7ea] px-3.5 py-3">
          <div className="flex items-baseline gap-0.5 text-xl font-extrabold text-text-primary">
            {mode === 'buy' && <span>$</span>}
            <input
              type="number"
              min="0"
              step="0.01"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="0"
              disabled={isClosed}
              className="w-28 bg-transparent outline-none disabled:opacity-50"
            />
          </div>
          <span className="text-xs font-semibold text-text-faint">
            {mode === 'buy'
              ? `Balance ${formatUsd(balance)}`
              : `Own ${formatShares(ownedShares)}`}
          </span>
        </div>
        <div className="mt-2 flex gap-2 text-xs font-bold text-text-secondary">
          {mode === 'buy'
            ? BUY_QUICK_AMOUNTS.map((amt) => (
                <button
                  key={amt}
                  onClick={() => addAmount(amt)}
                  disabled={isClosed}
                  className="rounded-lg bg-subtle px-3 py-1.5 transition hover:bg-[#e4eaec] disabled:opacity-50"
                >
                  +${amt}
                </button>
              ))
            : null}
          {mode === 'buy' ? (
            <button
              onClick={() => setInput(String(balance))}
              disabled={isClosed}
              className="rounded-lg bg-subtle px-3 py-1.5 transition hover:bg-[#e4eaec] disabled:opacity-50"
            >
              Max
            </button>
          ) : (
            SELL_QUICK_FRACTIONS.map((frac) => (
              <button
                key={frac}
                onClick={() => setInput(String(ownedShares * frac))}
                disabled={isClosed || ownedShares <= 0}
                className="rounded-lg bg-subtle px-3 py-1.5 transition hover:bg-[#e4eaec] disabled:opacity-50"
              >
                {frac === 1 ? 'Max' : `${frac * 100}%`}
              </button>
            ))
          )}
        </div>
      </div>

      {mode === 'buy' && hasValidInput && (
        <div className="flex flex-col gap-1.5 border-t border-dashed border-[#dfe7ea] pt-3 text-[13.5px] font-semibold text-text-secondary">
          <div className="flex justify-between">
            <span>Shares</span>
            <span className="font-bold text-text-primary">{formatShares(potentialPayout)}</span>
          </div>
          <div className="flex justify-between">
            <span>If {outcome === 'yes' ? 'Yes' : 'No'} wins</span>
            <span className="font-extrabold text-yes">
              {formatUsd(potentialPayout)} ({potentialGainPct >= 0 ? '+' : ''}
              {potentialGainPct.toFixed(0)}%)
            </span>
          </div>
        </div>
      )}

      {mode === 'sell' && sellQuote && hasValidInput && (
        <div className="flex flex-col gap-1.5 border-t border-dashed border-[#dfe7ea] pt-3 text-[13.5px] font-semibold text-text-secondary">
          <div className="flex justify-between">
            <span>Avg price</span>
            <span className="font-bold text-text-primary">{`${(sellQuote.avgPrice * 100).toFixed(1)}¢`}</span>
          </div>
          <div className="flex justify-between">
            <span>Fee</span>
            <span className="font-bold text-text-primary">{formatUsd(sellQuote.fee)}</span>
          </div>
          <div className="flex justify-between">
            <span>You receive</span>
            <span className="font-extrabold text-yes">{formatUsd(sellQuote.proceeds)}</span>
          </div>
        </div>
      )}

      {!hasValidInput && (
        <div className="text-[13.5px] font-semibold text-text-faint">
          Current price: {Math.round(outcomePrice * 100)}¢
        </div>
      )}

      {error && (
        <p className="rounded-lg border border-no/30 bg-no-bg px-3 py-2 text-xs font-medium text-no">
          {error}
        </p>
      )}

      <button
        onClick={handleSubmit}
        disabled={session ? submitDisabled : false}
        className={clsx(
          'w-full rounded-[13px] py-3.5 text-[15px] font-extrabold text-white transition disabled:cursor-not-allowed disabled:opacity-50',
          outcome === 'yes' ? 'bg-teal hover:bg-teal-deep' : 'bg-no hover:brightness-95'
        )}
      >
        {buttonLabel}
      </button>
      <p className="text-center text-xs font-semibold text-text-faint">
        Fees included · Sell anytime
      </p>
    </div>
  );
}
