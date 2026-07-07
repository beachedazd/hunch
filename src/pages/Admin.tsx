import { useState } from 'react';
import { Navigate } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { EmptyState } from '../components/EmptyState';
import { Skeleton } from '../components/Skeleton';
import { useAuth } from '../hooks/useAuth';
import { useToast } from '../hooks/useToast';
import { listMarketsByStatus, resolveMarket, syncPolymarket } from '../lib/api';
import type { PolymarketSyncResult } from '../lib/api';
import { formatDateTime, formatUsd } from '../lib/format';
import type { Market } from '../types';

export default function Admin() {
  const { profile, profileLoading, session, loading } = useAuth();

  if (loading || (session && profileLoading)) {
    return (
      <div className="mx-auto max-w-5xl px-4 py-8 sm:px-7">
        <Skeleton className="h-64 w-full rounded-2xl" />
      </div>
    );
  }

  if (!session || !profile?.is_admin) {
    return <Navigate to="/" replace />;
  }

  return <AdminMarketsList />;
}

function AdminMarketsList() {
  const queryClient = useQueryClient();
  const { showToast } = useToast();
  const [resolvingId, setResolvingId] = useState<string | null>(null);
  const [rowError, setRowError] = useState<Record<string, string>>({});
  const [syncing, setSyncing] = useState(false);
  const [syncResult, setSyncResult] = useState<PolymarketSyncResult | null>(null);
  const [syncError, setSyncError] = useState<string | null>(null);

  const { data: markets, isLoading } = useQuery({
    queryKey: ['admin-markets', 'open'],
    queryFn: () => listMarketsByStatus('open'),
  });

  async function handleResolve(market: Market, resolution: 'yes' | 'no' | 'void') {
    const label = resolution === 'void' ? 'VOID' : resolution.toUpperCase();
    if (!window.confirm(`Resolve "${market.question}" as ${label}? This cannot be undone.`)) {
      return;
    }
    setResolvingId(market.id);
    setRowError((prev) => ({ ...prev, [market.id]: '' }));
    try {
      await resolveMarket(market.id, resolution);
      showToast(`Resolved as ${label}`, 'success');
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['admin-markets'] }),
        queryClient.invalidateQueries({ queryKey: ['markets'] }),
        queryClient.invalidateQueries({ queryKey: ['market', market.slug] }),
      ]);
    } catch (err) {
      setRowError((prev) => ({
        ...prev,
        [market.id]: err instanceof Error ? err.message : 'Failed to resolve',
      }));
    } finally {
      setResolvingId(null);
    }
  }

  async function handleSync() {
    setSyncing(true);
    setSyncError(null);
    try {
      const result = await syncPolymarket();
      setSyncResult(result);
      showToast(
        `Imported ${result.imported.length} · Resolved ${result.resolved.length}`,
        'success'
      );
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['admin-markets'] }),
        queryClient.invalidateQueries({ queryKey: ['markets'] }),
      ]);
    } catch (err) {
      setSyncResult(null);
      setSyncError(err instanceof Error ? err.message : 'Failed to sync Polymarket');
    } finally {
      setSyncing(false);
    }
  }

  return (
    <div className="mx-auto max-w-5xl px-4 py-8 sm:px-7">
      <h1 className="mb-6 text-2xl font-extrabold tracking-tight text-text-primary">
        Admin · Resolve markets
      </h1>

      <div className="mb-6 rounded-2xl border border-border-c bg-white p-4">
        <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-center">
          <div>
            <p className="font-bold text-text-primary">Sync Polymarket</p>
            <p className="text-xs text-text-muted">
              Import new mirrored markets and resolve any that have settled.
            </p>
          </div>
          <button
            onClick={handleSync}
            disabled={syncing}
            className="shrink-0 rounded-lg bg-teal px-4 py-1.5 text-xs font-bold text-white transition hover:bg-teal-deep disabled:cursor-not-allowed disabled:opacity-50"
          >
            {syncing ? 'Syncing…' : 'Sync Polymarket'}
          </button>
        </div>

        {syncResult && (
          <div className="mt-3">
            <p className="text-xs font-semibold text-text-secondary">
              Imported {syncResult.imported.length} · Resolved {syncResult.resolved.length} ·
              Skipped {syncResult.skipped}
            </p>
            {syncResult.errors.length > 0 && (
              <ul className="mt-1 space-y-0.5">
                {syncResult.errors.map((e, i) => (
                  <li key={i} className="text-[11px] text-text-faint">
                    {e}
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
        {syncError && <p className="mt-2 text-xs font-medium text-no">{syncError}</p>}
      </div>

      {isLoading ? (
        <div className="space-y-2">
          <Skeleton className="h-16 w-full rounded-2xl" />
          <Skeleton className="h-16 w-full rounded-2xl" />
        </div>
      ) : !markets || markets.length === 0 ? (
        <EmptyState title="No open markets" description="Every market has been resolved." />
      ) : (
        <div className="space-y-3">
          {markets.map((m) => (
            <div key={m.id} className="rounded-2xl border border-border-c bg-white p-4">
              <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-center">
                <div>
                  <p className="font-bold text-text-primary">{m.question}</p>
                  <p className="text-xs text-text-muted">
                    {m.category} · {formatUsd(m.volume)} volume · Closes{' '}
                    {formatDateTime(m.close_time)}
                  </p>
                </div>
                <div className="flex shrink-0 gap-2">
                  <button
                    onClick={() => handleResolve(m, 'yes')}
                    disabled={resolvingId === m.id}
                    className="rounded-lg bg-yes-bg px-3 py-1.5 text-xs font-bold text-teal-deep transition hover:brightness-95 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    Resolve YES
                  </button>
                  <button
                    onClick={() => handleResolve(m, 'no')}
                    disabled={resolvingId === m.id}
                    className="rounded-lg bg-no-bg px-3 py-1.5 text-xs font-bold text-no transition hover:brightness-95 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    Resolve NO
                  </button>
                  <button
                    onClick={() => handleResolve(m, 'void')}
                    disabled={resolvingId === m.id}
                    className="rounded-lg border border-[#dfe7ea] px-3 py-1.5 text-xs font-bold text-text-muted transition hover:text-text-primary disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    Void
                  </button>
                </div>
              </div>
              {rowError[m.id] && <p className="mt-2 text-xs font-medium text-no">{rowError[m.id]}</p>}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
