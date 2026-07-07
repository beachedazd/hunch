import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { EmptyState } from '../components/EmptyState';
import { PositionCard } from '../components/PositionCard';
import { PriceChart } from '../components/PriceChart';
import { Skeleton } from '../components/Skeleton';
import { TradeWidget } from '../components/TradeWidget';
import { useAuth } from '../hooks/useAuth';
import { useAuthModal } from '../hooks/useAuthModal';
import { addComment, getComments, getMarketBySlug, getMyPosition, getTrades } from '../lib/api';
import { priceYes } from '../lib/cpmm';
import { formatDate, formatDateTime, formatUsd } from '../lib/format';

export default function MarketDetail() {
  const { slug = '' } = useParams();
  const { session } = useAuth();
  const { openAuthModal } = useAuthModal();
  const queryClient = useQueryClient();
  const [commentBody, setCommentBody] = useState('');
  const [commentError, setCommentError] = useState<string | null>(null);
  const [postingComment, setPostingComment] = useState(false);

  const {
    data: market,
    isLoading,
    isError,
    error,
  } = useQuery({
    queryKey: ['market', slug],
    queryFn: () => getMarketBySlug(slug),
    enabled: !!slug,
  });

  const { data: trades } = useQuery({
    queryKey: ['trades', market?.id ?? null],
    queryFn: () => getTrades(market!.id),
    enabled: !!market,
  });

  const { data: position } = useQuery({
    queryKey: ['position', market?.id ?? null, session?.user.id ?? null],
    queryFn: () => getMyPosition(market!.id),
    enabled: !!market && !!session,
  });

  const { data: comments } = useQuery({
    queryKey: ['comments', market?.id ?? null],
    queryFn: () => getComments(market!.id),
    enabled: !!market,
  });

  async function handlePostComment(e: React.FormEvent) {
    e.preventDefault();
    if (!market || !commentBody.trim()) return;
    setPostingComment(true);
    setCommentError(null);
    try {
      await addComment(market.id, commentBody.trim());
      setCommentBody('');
      await queryClient.invalidateQueries({ queryKey: ['comments', market.id] });
    } catch (err) {
      setCommentError(err instanceof Error ? err.message : 'Failed to post comment');
    } finally {
      setPostingComment(false);
    }
  }

  if (isLoading) {
    return (
      <div className="mx-auto max-w-6xl px-4 py-6 sm:px-7">
        <Skeleton className="mb-4 h-8 w-2/3" />
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
          <div className="space-y-4 lg:col-span-2">
            <Skeleton className="h-72 w-full rounded-2xl" />
            <Skeleton className="h-40 w-full rounded-2xl" />
          </div>
          <Skeleton className="h-96 w-full rounded-2xl" />
        </div>
      </div>
    );
  }

  if (isError || !market) {
    return (
      <div className="mx-auto max-w-3xl px-4 py-16 sm:px-7">
        <EmptyState
          title="Market not found"
          description={error instanceof Error ? error.message : "This market doesn't exist or was removed."}
          action={
            <Link to="/" className="text-sm font-bold text-teal hover:underline">
              Back to markets
            </Link>
          }
        />
      </div>
    );
  }

  const pYes = priceYes(market.yes_pool, market.no_pool);

  return (
    <div className="mx-auto max-w-6xl px-4 py-6 sm:px-7">
      <div className="mb-5">
        <div className="flex items-center gap-2 text-[12.5px] font-semibold text-text-muted">
          <span>
            {market.category || 'Other'} · Resolves {formatDate(market.close_time)}
          </span>
          {market.source === 'polymarket' && (
            <span
              title="Mirrored from Polymarket — resolves automatically with the real market"
              className="inline-block rounded-full bg-teal-tint px-2.5 py-1 text-[11.5px] font-bold uppercase tracking-wide text-teal-deep"
            >
              via Polymarket
            </span>
          )}
        </div>
        <h1 className="mt-1.5 text-2xl font-extrabold tracking-tight text-text-primary sm:text-[28px]">
          {market.question}
        </h1>
        <div className="mt-2.5 flex flex-wrap items-center gap-3.5 text-[13px] font-semibold text-text-secondary">
          <span className="rounded-full bg-teal-tint px-3 py-1.5 font-extrabold text-teal-deep">
            Yes {Math.round(pYes * 100)}¢
          </span>
          <span>{formatUsd(market.volume)} volume</span>
          <span>💬 {comments?.length ?? 0}</span>
          {market.status !== 'open' && (
            <span className="font-extrabold text-text-primary">
              {market.status === 'resolved' ? `Resolved ${market.resolution?.toUpperCase()}` : 'Void'}
            </span>
          )}
        </div>
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <div className="space-y-5 lg:col-span-2">
          <PriceChart trades={trades ?? []} market={market} />

          <div className="rounded-2xl border border-border-c bg-white p-5">
            <h2 className="mb-2 text-[15px] font-extrabold text-text-primary">
              Description &amp; rules
            </h2>
            <p className="whitespace-pre-wrap text-sm leading-relaxed text-text-secondary">
              {market.description || 'No description provided.'}
            </p>
          </div>

          {session && position && <PositionCard market={market} position={position} />}

          <div className="rounded-2xl border border-border-c bg-white p-5">
            <h2 className="mb-3 text-[15px] font-extrabold text-text-primary">
              Comments · {comments?.length ?? 0}
            </h2>

            {session ? (
              <form onSubmit={handlePostComment} className="mb-4">
                <textarea
                  value={commentBody}
                  onChange={(e) => setCommentBody(e.target.value)}
                  placeholder="Share your take…"
                  rows={2}
                  className="w-full resize-none rounded-xl border border-[#dfe7ea] bg-white px-3.5 py-2.5 text-sm text-text-primary placeholder-text-faint outline-none focus:border-teal"
                />
                {commentError && <p className="mt-1 text-xs font-medium text-no">{commentError}</p>}
                <button
                  type="submit"
                  disabled={postingComment || !commentBody.trim()}
                  className="mt-2 rounded-xl bg-teal px-4 py-1.5 text-xs font-bold text-white transition hover:bg-teal-deep disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {postingComment ? 'Posting…' : 'Post comment'}
                </button>
              </form>
            ) : (
              <button
                onClick={() => openAuthModal('signin')}
                className="mb-4 text-sm font-bold text-teal hover:underline"
              >
                Sign in to comment
              </button>
            )}

            {!comments || comments.length === 0 ? (
              <p className="text-sm text-text-muted">No comments yet.</p>
            ) : (
              <ul className="space-y-4">
                {comments.map((c) => (
                  <li key={c.id} className="flex gap-3">
                    <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-[#6d8ac4] text-[13px] font-bold text-white">
                      {(c.profile?.username || '?').charAt(0).toUpperCase()}
                    </span>
                    <div className="text-[13.5px]">
                      <span className="font-bold text-text-primary">
                        {c.profile?.username || 'Anonymous'}
                      </span>
                      <span className="ml-2 text-text-faint">{formatDateTime(c.created_at)}</span>
                      <p className="mt-0.5 leading-relaxed text-text-secondary">{c.body}</p>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>

        <div className="flex flex-col gap-4 lg:sticky lg:top-20 lg:self-start">
          <TradeWidget market={market} />
          {market.description && (
            <div className="rounded-2xl bg-rules px-[18px] py-4 text-[13px] leading-relaxed text-rules-text">
              <span className="font-extrabold">Rules:</span> {market.description}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
