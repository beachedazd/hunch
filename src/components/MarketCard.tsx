import { useNavigate } from 'react-router-dom';
import { CategoryPill } from './CategoryPill';
import { formatDate, formatUsd } from '../lib/format';
import { blendedPriceYes, parseAutoSeries, useCountdown, useSpotPrice } from '../lib/live';
import type { Market } from '../types';

interface MarketCardProps {
  market: Market;
  commentCount?: number;
}

export function MarketCard({ market, commentCount }: MarketCardProps) {
  const navigate = useNavigate();
  const isClosed = market.status !== 'open';
  const series = parseAutoSeries(market.auto_series);
  // Auto markets show live model odds from the (shared, per-asset) spot poll;
  // non-auto markets keep the exact pool price (blendedPriceYes falls back to
  // it when series/live price is absent).
  const { data: spot } = useSpotPrice(series?.asset ?? null, !!series);
  const pYes = blendedPriceYes(market, spot ?? null);
  const pNo = 1 - pYes;
  // Hook is always called (rules of hooks); its output is only rendered
  // below when this card happens to represent an auto market.
  const { msLeft, text: countdownText } = useCountdown(market.close_time ?? '');

  function goToTrade(e: React.MouseEvent, outcome: 'yes' | 'no') {
    e.preventDefault();
    e.stopPropagation();
    navigate(`/market/${market.slug}?outcome=${outcome}`);
  }

  return (
    <div
      role="link"
      tabIndex={0}
      onClick={() => navigate(`/market/${market.slug}`)}
      onKeyDown={(e) => {
        if (e.key === 'Enter') navigate(`/market/${market.slug}`);
      }}
      className="flex cursor-pointer flex-col gap-3 rounded-2xl border border-border-c bg-white p-[18px] transition hover:border-text-faint"
    >
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-1.5">
          <CategoryPill category={market.category} />
          {market.source === 'polymarket' && (
            <span
              title="Mirrored from Polymarket — resolves automatically with the real market"
              className="inline-block rounded-full bg-teal-tint px-2 py-1 text-[10px] font-bold uppercase tracking-wide text-teal-deep"
            >
              PM
            </span>
          )}
        </div>
        <span className="text-xs font-semibold text-text-faint">{formatUsd(market.volume)}</span>
      </div>

      <h3 className="line-clamp-2 text-[16.5px] font-bold leading-tight text-text-primary">
        {market.question}
      </h3>

      <div className="flex gap-2">
        <button
          onClick={(e) => goToTrade(e, 'yes')}
          disabled={isClosed}
          className="flex-1 rounded-xl bg-yes-bg py-2.5 text-center text-[14.5px] font-extrabold text-teal-deep transition hover:brightness-95 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {series ? 'Up' : 'Yes'} {Math.round(pYes * 100)}¢
        </button>
        <button
          onClick={(e) => goToTrade(e, 'no')}
          disabled={isClosed}
          className="flex-1 rounded-xl bg-no-bg py-2.5 text-center text-[14.5px] font-extrabold text-no transition hover:brightness-95 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {series ? 'Down' : 'No'} {Math.round(pNo * 100)}¢
        </button>
      </div>

      <div className="flex items-center gap-1.5 text-xs font-semibold text-text-muted">
        {commentCount && commentCount > 0
          ? `💬 ${commentCount} comments`
          : market.status === 'open'
            ? series
              ? `Closes in ${msLeft > 0 ? countdownText : '0:00'}`
              : `Closes ${formatDate(market.close_time)}`
            : market.status === 'resolved'
              ? `Resolved ${market.resolution?.toUpperCase()}`
              : 'Void'}
      </div>
    </div>
  );
}
