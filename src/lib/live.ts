// Helpers for live, auto-resolving short-horizon crypto markets (see
// ARCHITECTURE.md → auto_series). Parsing the series id, a ticking countdown
// to close_time, and a polled spot price from Coinbase (CORS-friendly, no
// API key needed).

import { useEffect, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';

export type LiveAsset = 'BTC' | 'ETH';

export interface ParsedAutoSeries {
  asset: LiveAsset;
  symbol: string;
  label: string;
  minutes: number;
}

const AUTO_SERIES_RE = /^(btc|eth)-(\d+)m$/;

const ASSET_SYMBOLS: Record<LiveAsset, string> = {
  BTC: '₿',
  ETH: 'Ξ',
};

export function parseAutoSeries(series: string | null | undefined): ParsedAutoSeries | null {
  if (!series) return null;
  const match = AUTO_SERIES_RE.exec(series);
  if (!match) return null;

  const asset: LiveAsset = match[1] === 'btc' ? 'BTC' : 'ETH';
  const minutes = Number(match[2]);

  return {
    asset,
    symbol: ASSET_SYMBOLS[asset],
    label: `${minutes}m`,
    minutes,
  };
}

function formatCountdown(msLeft: number): string {
  const totalSeconds = Math.max(0, Math.floor(msLeft / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  if (hours >= 1) {
    return `${hours}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
  }
  return `${minutes}:${String(seconds).padStart(2, '0')}`;
}

function targetTime(closeTime: string): number {
  const parsed = new Date(closeTime).getTime();
  return Number.isFinite(parsed) ? parsed : Date.now();
}

export function useCountdown(closeTime: string): { msLeft: number; text: string } {
  const target = useMemo(() => targetTime(closeTime), [closeTime]);
  const [msLeft, setMsLeft] = useState(() => Math.max(0, target - Date.now()));

  useEffect(() => {
    setMsLeft(Math.max(0, target - Date.now()));
    const id = setInterval(() => {
      setMsLeft(Math.max(0, target - Date.now()));
    }, 1000);
    return () => clearInterval(id);
  }, [target]);

  return { msLeft, text: formatCountdown(msLeft) };
}

interface CoinbaseSpotResponse {
  data?: { amount?: string };
}

async function fetchSpotPrice(asset: LiveAsset): Promise<number> {
  const res = await fetch(`https://api.coinbase.com/v2/prices/${asset}-USD/spot`);
  if (!res.ok) throw new Error('Failed to load spot price');
  const json = (await res.json()) as CoinbaseSpotResponse;
  const amount = Number(json.data?.amount);
  if (!Number.isFinite(amount)) throw new Error('Invalid spot price response');
  return amount;
}

export function useSpotPrice(asset: LiveAsset | null, enabled: boolean) {
  return useQuery({
    queryKey: ['spot', asset],
    queryFn: () => fetchSpotPrice(asset as LiveAsset),
    enabled: enabled && !!asset,
    staleTime: 0,
    refetchInterval: 5000,
  });
}
