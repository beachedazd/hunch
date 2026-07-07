import clsx from 'clsx';
import { useMemo } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { EmptyState } from '../components/EmptyState';
import { MarketCard } from '../components/MarketCard';
import { MarketCardSkeleton } from '../components/Skeleton';
import { useAuth } from '../hooks/useAuth';
import { useAuthModal } from '../hooks/useAuthModal';
import { listMarkets } from '../lib/api';
import { priceYes } from '../lib/cpmm';
import { formatUsd } from '../lib/format';
import { MARKET_CATEGORIES } from '../types';

const CATEGORIES = ['Trending', ...MARKET_CATEGORIES];

const HOW_IT_WORKS = [
  {
    icon: '①',
    title: 'Pick a question',
    body: 'Hundreds of real-world markets, from elections to award shows.',
  },
  {
    icon: '②',
    title: 'Back your hunch',
    body: 'Buy Yes or No from 1¢ to 99¢. Prices move with the crowd.',
  },
  {
    icon: '③',
    title: "Brag (or don't)",
    body: 'Compare hit rates and climb the leaderboard.',
  },
];

export default function Home() {
  const [searchParams, setSearchParams] = useSearchParams();
  const navigate = useNavigate();
  const { session } = useAuth();
  const { openAuthModal } = useAuthModal();
  const category = searchParams.get('category') ?? '';
  const activeCategory = category || 'Trending';

  const {
    data: markets,
    isLoading,
    isError,
    error,
  } = useQuery({
    queryKey: ['markets', category],
    queryFn: () => listMarkets(category || null, null),
  });

  const hero = useMemo(() => {
    if (!markets) return null;
    const open = markets.filter((m) => m.status === 'open');
    if (open.length === 0) return null;
    return open.reduce((max, m) => (m.volume > max.volume ? m : max), open[0]);
  }, [markets]);

  const gridMarkets = useMemo(() => {
    if (!markets) return [];
    return markets.filter((m) => m.id !== hero?.id);
  }, [markets, hero]);

  function handleCategoryClick(cat: string) {
    const params = new URLSearchParams(searchParams);
    if (cat === 'Trending') params.delete('category');
    else params.set('category', cat);
    setSearchParams(params);
  }

  function scrollToGrid() {
    document.getElementById('market-grid')?.scrollIntoView({ behavior: 'smooth' });
  }

  return (
    <div>
      {!session && (
        <section className="border-b border-border-c bg-white">
          <div className="mx-auto grid max-w-7xl grid-cols-1 items-center gap-10 px-4 py-10 sm:px-7 lg:grid-cols-[1.1fr_1fr] lg:gap-10 lg:py-14">
            <div>
              <span className="inline-block rounded-full bg-teal-tint px-3.5 py-1.5 text-[13px] font-extrabold text-teal-deep">
                Play-money to start · real markets
              </span>
              <h1 className="mt-4 text-4xl font-extrabold leading-[1.05] tracking-tight text-text-primary sm:text-[52px]">
                Got a hunch?
                <br />
                Put it on the line.
              </h1>
              <p className="mt-3.5 max-w-md text-[17px] font-medium leading-relaxed text-text-secondary">
                Trade on real-world questions — politics, sports, crypto, pop culture — and see
                how your calls stack up.
              </p>
              <div className="mt-6 flex flex-wrap gap-3">
                <button
                  onClick={() => openAuthModal('signup')}
                  className="rounded-[13px] bg-teal px-6 py-3.5 text-base font-extrabold text-white transition hover:bg-teal-deep"
                >
                  Get started free
                </button>
                <button
                  onClick={scrollToGrid}
                  className="rounded-[13px] border-[1.5px] border-[#dfe7ea] bg-white px-6 py-3.5 text-base font-extrabold text-text-primary transition hover:border-text-faint"
                >
                  Browse markets
                </button>
              </div>
            </div>

            <div className="flex flex-col gap-3 lg:rotate-1">
              <div className="rounded-2xl border border-border-c bg-white p-[18px] shadow-[0_10px_28px_rgba(15,163,177,.12)]">
                <span className="inline-block rounded-full bg-[#fbeedd] px-2.5 py-1 text-[11px] font-bold uppercase text-[#8a5a0b]">
                  Crypto
                </span>
                <div className="mt-2 text-base font-bold text-text-primary">
                  Bitcoin above $150K by Dec 31?
                </div>
                <div className="mt-2.5 flex gap-2">
                  <div className="flex-1 rounded-[10px] bg-teal-tint py-2 text-center text-[13.5px] font-extrabold text-teal-deep">
                    Yes 41¢
                  </div>
                  <div className="flex-1 rounded-[10px] bg-no-bg py-2 text-center text-[13.5px] font-extrabold text-no">
                    No 59¢
                  </div>
                </div>
              </div>
              <div className="rounded-2xl border border-border-c bg-white p-[18px] shadow-[0_10px_28px_rgba(15,163,177,.12)] lg:-rotate-2">
                <span className="inline-block rounded-full bg-[#f3ecfa] px-2.5 py-1 text-[11px] font-bold uppercase text-[#7a4fa3]">
                  Pop culture
                </span>
                <div className="mt-2 text-base font-bold text-text-primary">
                  New Taylor Swift tour announced in 2026?
                </div>
                <div className="mt-2.5 flex gap-2">
                  <div className="flex-1 rounded-[10px] bg-teal-tint py-2 text-center text-[13.5px] font-extrabold text-teal-deep">
                    Yes 73¢
                  </div>
                  <div className="flex-1 rounded-[10px] bg-no-bg py-2 text-center text-[13.5px] font-extrabold text-no">
                    No 27¢
                  </div>
                </div>
              </div>
            </div>
          </div>

          <div className="mx-auto grid max-w-7xl grid-cols-1 gap-4 px-4 pb-10 sm:grid-cols-3 sm:px-7 sm:pb-14">
            {HOW_IT_WORKS.map((step) => (
              <div key={step.title} className="rounded-2xl border border-border-c bg-white p-5">
                <div className="text-2xl">{step.icon}</div>
                <div className="mt-2 text-[15.5px] font-extrabold text-text-primary">
                  {step.title}
                </div>
                <div className="mt-1 text-[13.5px] font-medium leading-relaxed text-text-secondary">
                  {step.body}
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      <div id="market-grid" className="mx-auto max-w-7xl scroll-mt-20 px-4 py-6 sm:px-7">
        {isError && (
          <EmptyState
            title="Couldn't load markets"
            description={error instanceof Error ? error.message : 'Please try again shortly.'}
          />
        )}

        {!isError && (
          <>
            <div className="mb-4 flex gap-2 overflow-x-auto pb-1 text-[13.5px] font-semibold [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
              {CATEGORIES.map((cat) => (
                <button
                  key={cat}
                  onClick={() => handleCategoryClick(cat)}
                  className={clsx(
                    'shrink-0 whitespace-nowrap rounded-full px-4 py-[7px] transition',
                    activeCategory === cat
                      ? 'bg-[#152229] text-white'
                      : 'border border-[#dfe7ea] bg-white text-text-secondary hover:border-text-faint'
                  )}
                >
                  {cat === 'Trending' ? '🔥 Trending' : cat}
                </button>
              ))}
            </div>

            {isLoading && (
              <>
                <div className="mb-5 h-40 animate-pulse rounded-2xl bg-white" />
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
                  {Array.from({ length: 6 }).map((_, i) => (
                    <MarketCardSkeleton key={i} />
                  ))}
                </div>
              </>
            )}

            {!isLoading && markets && markets.length === 0 && (
              <EmptyState
                title={category ? 'No markets in this category' : 'No markets yet'}
                description={
                  category
                    ? 'Try a different category.'
                    : 'Once markets are created, they will show up here.'
                }
              />
            )}

            {!isLoading && hero && (
              <button
                onClick={() => navigate(`/market/${hero.slug}`)}
                className="mb-5 flex w-full flex-col gap-5 rounded-2xl p-6 text-left text-white transition hover:brightness-[1.03] sm:flex-row sm:items-center"
                style={{ background: 'linear-gradient(100deg,#0fa3b1,#0b7f8a)' }}
              >
                <div className="flex-1">
                  <div className="text-xs font-bold uppercase tracking-wide opacity-75">
                    This week's big one
                  </div>
                  <div className="mt-1 text-2xl font-extrabold tracking-tight">
                    {hero.question}
                  </div>
                  <div className="mt-2.5 text-[13px] font-semibold opacity-90">
                    {formatUsd(hero.volume)} pool
                  </div>
                </div>
                <div className="flex gap-2.5">
                  <span className="rounded-[13px] bg-white px-5 py-3 text-center text-base font-extrabold text-teal-deep">
                    Yes {Math.round(priceYes(hero.yes_pool, hero.no_pool) * 100)}¢
                  </span>
                  <span className="rounded-[13px] border-[1.5px] border-white/50 bg-white/[.18] px-5 py-3 text-center text-base font-extrabold text-white">
                    No {Math.round((1 - priceYes(hero.yes_pool, hero.no_pool)) * 100)}¢
                  </span>
                </div>
              </button>
            )}

            {!isLoading && gridMarkets.length > 0 && (
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
                {gridMarkets.map((m) => (
                  <MarketCard key={m.id} market={m} />
                ))}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
