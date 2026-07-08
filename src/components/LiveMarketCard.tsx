import { useNavigate } from 'react-router-dom';
import { blendedPriceYes, parseAutoSeries, useCountdown, useSpotPrice, type LiveAsset } from '../lib/live';
import { formatUsd } from '../lib/format';
import type { Market } from '../types';

interface LiveMarketCardProps {
  market: Market;
}

const ASSET_NAMES: Record<LiveAsset, string> = {
  BTC: 'Bitcoin',
  ETH: 'Ethereum',
};

export function LiveMarketCard({ market }: LiveMarketCardProps) {
  const navigate = useNavigate();
  const series = parseAutoSeries(market.auto_series);
  const { msLeft, text } = useCountdown(market.close_time ?? '');
  const isResolving = msLeft <= 0;

  const { data: spot } = useSpotPrice(series?.asset ?? null, !!series);
  const pYes = blendedPriceYes(market, spot ?? null);
  const pNo = 1 - pYes;

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
      className="flex w-[210px] shrink-0 cursor-pointer snap-start flex-col gap-3 rounded-2xl border border-border-c bg-white p-4 transition hover:border-text-faint"
    >
      <div className="flex items-center gap-1.5">
        <span className="text-base leading-none">{series?.symbol ?? '◎'}</span>
        <span className="text-[13px] font-extrabold text-text-primary">
          {series?.asset ?? 'Live'}
        </span>
        <span className="rounded-full bg-subtle px-2 py-0.5 text-[10.5px] font-bold text-text-muted">
          {series?.label ?? ''}
        </span>
        <span className="ml-auto flex items-center gap-1">
          <span className="relative flex h-1.5 w-1.5">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-teal opacity-75" />
            <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-teal" />
          </span>
          <span className="text-[10px] font-extrabold uppercase tracking-wide text-teal-deep">
            Live
          </span>
        </span>
      </div>

      <h3 className="line-clamp-2 text-[13.5px] font-bold leading-tight text-text-primary">
        {series ? `${ASSET_NAMES[series.asset]} Up or Down (${series.label})` : market.question}
      </h3>

      <div className="text-2xl font-extrabold tabular-nums text-text-primary">
        {isResolving ? 'Resolving…' : text}
      </div>

      <div className="flex gap-2">
        <button
          onClick={(e) => goToTrade(e, 'yes')}
          className="flex-1 rounded-xl bg-yes-bg py-2 text-center text-[13px] font-extrabold text-teal-deep transition hover:brightness-95"
        >
          Up {Math.round(pYes * 100)}¢
        </button>
        <button
          onClick={(e) => goToTrade(e, 'no')}
          className="flex-1 rounded-xl bg-no-bg py-2 text-center text-[13px] font-extrabold text-no transition hover:brightness-95"
        >
          Down {Math.round(pNo * 100)}¢
        </button>
      </div>

      <div className="text-[11px] font-semibold text-text-faint">
        Strike {formatUsd(market.strike_price)}
      </div>
    </div>
  );
}
