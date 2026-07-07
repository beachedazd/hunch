import { useQuery } from '@tanstack/react-query';
import { EmptyState } from '../components/EmptyState';
import { Skeleton } from '../components/Skeleton';
import { useAuth } from '../hooks/useAuth';
import { listLeaderboard } from '../lib/api';
import { formatUsd } from '../lib/format';

const AVATAR_COLORS = ['#f4a261', '#8ab17d', '#6d8ac4', '#e76f51', '#b8548a', '#7a4fa3'];

export default function Leaderboard() {
  const { profile } = useAuth();

  const { data: entries, isLoading, isError } = useQuery({
    queryKey: ['leaderboard'],
    queryFn: () => listLeaderboard(100),
  });

  return (
    <div className="mx-auto max-w-3xl px-4 py-6 sm:px-7">
      <h1 className="mb-1 text-[26px] font-extrabold tracking-tight text-text-primary">
        Leaderboard
      </h1>
      <p className="mb-6 text-sm text-text-muted">Ranked by play-money balance.</p>

      {isLoading && (
        <div className="space-y-2">
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} className="h-14 w-full rounded-2xl" />
          ))}
        </div>
      )}

      {isError && <EmptyState title="Couldn't load leaderboard" />}

      {!isLoading && entries && entries.length === 0 && (
        <EmptyState title="No players yet" />
      )}

      {!isLoading && entries && entries.length > 0 && (
        <div className="overflow-hidden rounded-2xl border border-border-c bg-white">
          {entries.map((entry, i) => {
            const isMe = profile?.id === entry.id;
            const initial = (entry.username || '?').charAt(0).toUpperCase();
            return (
              <div
                key={entry.id}
                className={`flex items-center gap-4 border-b border-border-c px-5 py-3.5 last:border-b-0 ${
                  isMe ? 'bg-teal-tint' : ''
                }`}
              >
                <span className="w-6 text-sm font-extrabold text-text-faint">{i + 1}</span>
                <span
                  className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-sm font-bold text-white"
                  style={{ background: AVATAR_COLORS[i % AVATAR_COLORS.length] }}
                >
                  {initial}
                </span>
                <span className="flex-1 truncate text-sm font-bold text-text-primary">
                  {entry.username || 'Anonymous'}
                  {isMe && <span className="ml-2 text-xs font-semibold text-teal-deep">(you)</span>}
                </span>
                <span className="text-sm font-extrabold text-teal-deep">
                  {formatUsd(entry.balance)}
                </span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
