// Helpers for live, auto-resolving short-horizon crypto markets (see
// ARCHITECTURE.md → auto_series). Parsing the series id, a ticking countdown
// to close_time, and a polled spot price from Coinbase (CORS-friendly, no
// API key needed).

import { useEffect, useMemo, useRef, useState } from 'react';
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

export interface LiveTickerPoint {
  time: number;
  price: number;
}

export interface LiveTickerState {
  price: number | null;
  points: LiveTickerPoint[];
  connected: boolean;
}

interface CoinbaseTickerMessage {
  type?: string;
  price?: string;
}

// Keep the chart's point buffer bounded — this is a live 1s stream that could
// otherwise grow unbounded for a market left open in a background tab.
const LIVE_TICKER_MAX_POINTS = 1200;
// After this many consecutive failed WebSocket opens, stop retrying the
// socket and fall back to polling — avoids a tight reconnect loop when the
// feed is unreachable (e.g. blocked by a network/proxy).
const MAX_WS_OPEN_ATTEMPTS = 2;

/**
 * Real-time streaming price for an auto-market's underlying asset. Opens a
 * Coinbase Exchange WebSocket ticker feed and updates `price` on every tick
 * (sub-second cadence), while `points` is throttled to ~1/sec so charts stay
 * light. Falls back to 1s REST polling if the socket can't be opened at all.
 *
 * Hooks must run unconditionally, so this is safe to call with `asset: null`
 * or `enabled: false` — it simply stays idle until both are truthy.
 */
export function useLiveTicker(asset: LiveAsset | null, enabled: boolean): LiveTickerState {
  const [price, setPrice] = useState<number | null>(null);
  const [points, setPoints] = useState<LiveTickerPoint[]>([]);
  const [connected, setConnected] = useState(false);
  const lastBucketRef = useRef<number | null>(null);

  useEffect(() => {
    // Reset stream state on every asset/enabled change so switching markets
    // (or navigating away and back) never shows stale data.
    setPrice(null);
    setPoints([]);
    setConnected(false);
    lastBucketRef.current = null;

    if (!enabled || !asset) return;

    let cancelled = false;
    let ws: WebSocket | null = null;
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
    let pollTimer: ReturnType<typeof setInterval> | null = null;
    let hasOpened = false;
    let openAttempts = 0;

    function pushPrice(next: number) {
      if (cancelled) return;
      setPrice(next);
      // Dedupe the buffered-points stream to at most one entry per second by
      // flooring to the second — the `price` state above still updates on
      // every tick regardless.
      const bucket = Math.floor(Date.now() / 1000) * 1000;
      if (lastBucketRef.current === bucket) return;
      lastBucketRef.current = bucket;
      setPoints((prev) => {
        const appended = [...prev, { time: bucket, price: next }];
        return appended.length > LIVE_TICKER_MAX_POINTS
          ? appended.slice(appended.length - LIVE_TICKER_MAX_POINTS)
          : appended;
      });
    }

    function startPolling() {
      if (cancelled || pollTimer) return;
      pollTimer = setInterval(() => {
        fetchSpotPrice(asset as LiveAsset)
          .then((amount) => {
            if (cancelled) return;
            setConnected(true);
            pushPrice(amount);
          })
          .catch(() => {
            // Transient network hiccup — just try again on the next tick.
          });
      }, 1000);
    }

    function connect() {
      if (cancelled) return;
      try {
        ws = new WebSocket('wss://ws-feed.exchange.coinbase.com');
      } catch {
        startPolling();
        return;
      }

      ws.onopen = () => {
        if (cancelled) return;
        hasOpened = true;
        openAttempts = 0;
        setConnected(true);
        ws?.send(
          JSON.stringify({
            type: 'subscribe',
            product_ids: [`${asset}-USD`],
            channels: ['ticker'],
          })
        );
      };

      ws.onmessage = (event) => {
        if (cancelled) return;
        try {
          const msg = JSON.parse(event.data as string) as CoinbaseTickerMessage;
          if (msg.type === 'ticker') {
            const next = Number(msg.price);
            if (Number.isFinite(next)) pushPrice(next);
          }
        } catch {
          // Ignore malformed/unrelated feed messages.
        }
      };

      ws.onclose = () => {
        if (cancelled) return;
        setConnected(false);
        ws = null;
        if (!enabled) return;

        if (!hasOpened) {
          openAttempts += 1;
          if (openAttempts >= MAX_WS_OPEN_ATTEMPTS) {
            startPolling();
            return;
          }
        } else {
          // Reset so a later drop after a successful connection gets the
          // same number of retries before falling back to polling.
          hasOpened = false;
          openAttempts = 0;
        }

        reconnectTimer = setTimeout(() => {
          if (!cancelled) connect();
        }, 2000);
      };
    }

    connect();

    return () => {
      cancelled = true;
      if (reconnectTimer) clearTimeout(reconnectTimer);
      if (pollTimer) clearInterval(pollTimer);
      if (ws) {
        ws.onopen = null;
        ws.onmessage = null;
        ws.onerror = null;
        ws.onclose = null;
        ws.close();
        ws = null;
      }
    };
  }, [asset, enabled]);

  return { price, points, connected };
}
