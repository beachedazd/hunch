import { useMemo } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import clsx from 'clsx';
import { getTicker24hBaselines, listMarkets } from '../lib/api';
import { priceYes } from '../lib/cpmm';

const MAX_ITEMS = 20;
const SECONDS_PER_ITEM = 6;

interface TickerItem {
  id: string;
  slug: string;
  question: string;
  cents: number;
  deltaCents: number;
}

export function TickerTape() {
  const { data: markets } = useQuery({
    queryKey: ['ticker-markets'],
    queryFn: () => listMarkets(null, null),
    refetchInterval: 15_000,
  });

  const { data: baselines } = useQuery({
    queryKey: ['ticker-baselines'],
    queryFn: getTicker24hBaselines,
    refetchInterval: 60_000,
  });

  const items = useMemo<TickerItem[]>(() => {
    if (!markets) return [];
    return markets
      .filter((m) => m.status === 'open')
      .slice(0, MAX_ITEMS)
      .map((m) => {
        const cents = Math.round(priceYes(m.yes_pool, m.no_pool) * 100);
        const baseline = baselines?.[m.id];
        const deltaCents = baseline == null ? 0 : cents - Math.round(baseline * 100);
        return { id: m.id, slug: m.slug, question: m.question, cents, deltaCents };
      });
  }, [markets, baselines]);

  // A marquee with a couple of items looks broken — skip until there's enough.
  if (items.length < 3) return null;

  return (
    <div className="ticker-wrap relative flex items-stretch overflow-hidden border-b border-white/10 bg-[#152229] text-white">
      <div className="relative z-10 flex shrink-0 items-center gap-2 bg-[#152229] py-2 pl-4 pr-3 text-[11px] font-extrabold uppercase tracking-[0.14em] text-teal shadow-[10px_0_14px_rgba(21,34,41,.95)] sm:pl-7">
        <span className="relative flex h-2 w-2">
          <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-teal opacity-75" />
          <span className="relative inline-flex h-2 w-2 rounded-full bg-teal" />
        </span>
        Live
      </div>

      <div className="ticker-viewport flex-1 overflow-hidden">
        <div
          className="ticker-track flex w-max items-center"
          style={{ animationDuration: `${items.length * SECONDS_PER_ITEM}s` }}
        >
          {[0, 1].map((copy) => (
            <div key={copy} className="flex items-center" aria-hidden={copy === 1}>
              {items.map((item) => (
                <Link
                  key={`${copy}-${item.id}`}
                  to={`/market/${item.slug}`}
                  tabIndex={copy === 1 ? -1 : 0}
                  className="flex items-center gap-2 whitespace-nowrap border-r border-white/10 px-4 py-2 text-[13px] font-semibold transition hover:bg-white/5"
                >
                  <span className="max-w-[200px] truncate text-white/80 sm:max-w-[260px]">
                    {item.question}
                  </span>
                  <span className="font-extrabold text-white">{item.cents}¢</span>
                  {item.deltaCents !== 0 && (
                    <span
                      className={clsx(
                        'text-xs font-extrabold',
                        item.deltaCents > 0 ? 'text-[#4ade80]' : 'text-[#fb7185]'
                      )}
                    >
                      {item.deltaCents > 0 ? '▲' : '▼'} {Math.abs(item.deltaCents)}
                    </span>
                  )}
                </Link>
              ))}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
