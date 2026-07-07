import { useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { EmptyState } from '../components/EmptyState';
import { MarketCardSkeleton } from '../components/Skeleton';
import { getCategoryStyle } from '../lib/categoryStyle';
import { listMarkets } from '../lib/api';
import { priceYes } from '../lib/cpmm';
import { formatUsd } from '../lib/format';
import { MARKET_CATEGORIES, type Market } from '../types';

export default function Search() {
  const [searchParams, setSearchParams] = useSearchParams();
  const navigate = useNavigate();
  const q = searchParams.get('q') ?? '';
  const [input, setInput] = useState(q);

  const { data: allMarkets } = useQuery({
    queryKey: ['markets', 'search-meta'],
    queryFn: () => listMarkets(null, null),
  });

  const {
    data: results,
    isLoading,
    isError,
  } = useQuery({
    queryKey: ['markets', 'search', q],
    queryFn: () => listMarkets(null, q),
    enabled: !!q.trim(),
  });

  const categoryCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const m of allMarkets ?? []) {
      const cat = m.category || 'Other';
      counts[cat] = (counts[cat] ?? 0) + 1;
    }
    return counts;
  }, [allMarkets]);

  const trending = useMemo(() => {
    return (allMarkets ?? [])
      .filter((m) => m.status === 'open')
      .slice()
      .sort((a, b) => b.volume - a.volume)
      .slice(0, 5);
  }, [allMarkets]);

  function submitSearch(value: string) {
    const params = new URLSearchParams(searchParams);
    if (value.trim()) params.set('q', value.trim());
    else params.delete('q');
    setSearchParams(params);
  }

  return (
    <div className="mx-auto max-w-6xl px-4 py-6 pb-24 sm:px-7 sm:pb-6">
      <h1 className="mb-4 text-xl font-extrabold tracking-tight text-text-primary sm:hidden">
        Search
      </h1>

      <div className="mb-6 flex items-center gap-2 rounded-xl border-2 border-teal bg-white px-3.5 py-2.5 text-sm font-medium sm:max-w-[460px]">
        <span className="text-[13px] text-teal">⌕</span>
        <input
          autoFocus
          type="search"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') submitSearch(input);
          }}
          placeholder="Search markets, topics…"
          className="w-full bg-transparent text-text-primary placeholder-text-faint outline-none"
        />
      </div>

      {q.trim() ? (
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-[1fr_320px]">
          <div>
            <div className="mb-3 text-[13.5px] font-semibold text-text-muted">
              {results?.length ?? 0} results for{' '}
              <span className="font-extrabold text-text-primary">"{q}"</span>
            </div>

            {isLoading && (
              <div className="space-y-3">
                {Array.from({ length: 3 }).map((_, i) => (
                  <MarketCardSkeleton key={i} />
                ))}
              </div>
            )}

            {isError && <EmptyState title="Couldn't search markets" />}

            {!isLoading && results && results.length === 0 && (
              <EmptyState title="No markets match your search" description="Try a different term." />
            )}

            {!isLoading && results && results.length > 0 && (
              <div className="flex flex-col gap-3">
                {results.map((m) => {
                  const pYes = priceYes(m.yes_pool, m.no_pool);
                  return (
                    <div
                      key={m.id}
                      role="link"
                      tabIndex={0}
                      onClick={() => navigate(`/market/${m.slug}`)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') navigate(`/market/${m.slug}`);
                      }}
                      className="flex cursor-pointer items-center gap-4 rounded-2xl border border-border-c bg-white p-4 transition hover:border-text-faint"
                    >
                      <div className="flex-1">
                        <div className="text-base font-bold text-text-primary">{m.question}</div>
                        <div className="mt-1 text-xs font-semibold text-text-faint">
                          {m.category || 'Other'} · {formatUsd(m.volume)} volume
                        </div>
                      </div>
                      <div className="flex shrink-0 gap-2">
                        <span className="rounded-[10px] bg-teal-tint px-4 py-2 text-[13.5px] font-extrabold text-teal-deep">
                          Yes {Math.round(pYes * 100)}¢
                        </span>
                        <span className="rounded-[10px] bg-no-bg px-4 py-2 text-[13.5px] font-extrabold text-no">
                          No {Math.round((1 - pYes) * 100)}¢
                        </span>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          <CategoryAndTrending categoryCounts={categoryCounts} trending={trending} />
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-[1fr_320px]">
          <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3">
            {MARKET_CATEGORIES.map((cat) => {
              const style = getCategoryStyle(cat);
              return (
                <button
                  key={cat}
                  onClick={() => navigate(`/?category=${encodeURIComponent(cat)}`)}
                  className="rounded-2xl p-4 text-left"
                  style={{ background: style.bg }}
                >
                  <div className="text-[15px] font-extrabold" style={{ color: style.text }}>
                    {cat}
                  </div>
                  <div className="mt-0.5 text-[11.5px] font-semibold opacity-70" style={{ color: style.text }}>
                    {categoryCounts[cat] ?? 0} markets
                  </div>
                </button>
              );
            })}
          </div>

          <div className="hidden lg:block">
            <TrendingList trending={trending} />
          </div>
        </div>
      )}
    </div>
  );
}

function CategoryAndTrending({
  categoryCounts,
  trending,
}: {
  categoryCounts: Record<string, number>;
  trending: Market[];
}) {
  const navigate = useNavigate();
  return (
    <div className="flex flex-col gap-4">
      <div className="rounded-2xl border border-border-c bg-white p-[18px]">
        <div className="mb-2.5 text-sm font-extrabold text-text-primary">Browse categories</div>
        <div className="flex flex-wrap gap-2 text-xs font-bold">
          {MARKET_CATEGORIES.map((cat) => {
            const style = getCategoryStyle(cat);
            return (
              <button
                key={cat}
                onClick={() => navigate(`/?category=${encodeURIComponent(cat)}`)}
                className="rounded-full px-3.5 py-1.5"
                style={{ background: style.bg, color: style.text }}
              >
                {cat} · {categoryCounts[cat] ?? 0}
              </button>
            );
          })}
        </div>
      </div>
      <TrendingList trending={trending} />
    </div>
  );
}

function TrendingList({ trending }: { trending: Market[] }) {
  const navigate = useNavigate();
  if (!trending || trending.length === 0) return null;
  return (
    <div className="rounded-2xl border border-border-c bg-white p-[18px]">
      <div className="mb-2.5 text-sm font-extrabold text-text-primary">Trending now</div>
      <div className="flex flex-col gap-2 text-[13.5px] font-semibold text-text-secondary">
        {trending.map((m) => (
          <button
            key={m.id}
            onClick={() => navigate(`/market/${m.slug}`)}
            className="flex items-center justify-between rounded-xl border border-border-c px-3.5 py-3 text-left transition hover:border-text-faint"
          >
            <span className="line-clamp-1">🔥 {m.question}</span>
            <span className="ml-2 shrink-0 font-extrabold text-teal-deep">
              {Math.round(priceYes(m.yes_pool, m.no_pool) * 100)}¢
            </span>
          </button>
        ))}
      </div>
    </div>
  );
}
