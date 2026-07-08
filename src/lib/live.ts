// Helpers for live, auto-resolving short-horizon crypto markets (see
// ARCHITECTURE.md → auto_series). Parsing the series id, a ticking countdown
// to close_time, and a polled spot price from Coinbase (CORS-friendly, no
// API key needed).

import { useEffect, useMemo, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { priceYes } from './cpmm';
import type { Market } from '../types';

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

// ---- Model-based live odds (see docs/superpowers/specs/2026-07-08-live-crypto-model-odds-design.md) ----
// The auto crypto markets otherwise sit frozen at 50/50 under low volume. We
// price them off a driftless log-normal model of the remaining move, blended
// toward any real traded price by volume. The SAME constants/formula live in
// SQL (migration 20260708000011) — keep them in sync.

const ANNUAL_VOL: Record<LiveAsset, number> = { BTC: 0.5, ETH: 0.65 };
const YEAR_SECONDS = 31_557_600; // 365.25 * 24 * 3600
const PRICE_CLAMP_MIN = 0.02;
const PRICE_CLAMP_MAX = 0.98;
const BLEND_K = 250; // half the 500 window seed

function clampPrice(p: number): number {
  return Math.min(PRICE_CLAMP_MAX, Math.max(PRICE_CLAMP_MIN, p));
}

// Abramowitz-Stegun 7.1.26 erf approximation (max error ~1.5e-7).
function erf(x: number): number {
  const sign = x < 0 ? -1 : 1;
  const ax = Math.abs(x);
  const t = 1 / (1 + 0.3275911 * ax);
  const y =
    1 -
    ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t + 0.254829592) *
      t *
      Math.exp(-ax * ax);
  return sign * y;
}

/** Standard normal CDF. */
export function normCdf(x: number): number {
  return 0.5 * (1 + erf(x / Math.SQRT2));
}

/**
 * Fair YES ("Up") probability for an auto up/down market: the chance the live
 * price ends above the strike by close, modelled as a driftless log-normal
 * walk. Returns 0.5 for any unusable input. Clamped to [0.02, 0.98].
 */
export function modelPriceYes(
  asset: LiveAsset,
  strike: number | null | undefined,
  closeTimeIso: string | null | undefined,
  livePrice: number | null | undefined,
  nowMs: number = Date.now()
): number {
  if (
    strike == null || !(strike > 0) ||
    livePrice == null || !Number.isFinite(livePrice) || !(livePrice > 0) ||
    !closeTimeIso
  ) {
    return 0.5;
  }
  const closeMs = new Date(closeTimeIso).getTime();
  if (!Number.isFinite(closeMs)) return 0.5;

  const tauSeconds = Math.max((closeMs - nowMs) / 1000, 1);
  const sigmaTau = ANNUAL_VOL[asset] * Math.sqrt(tauSeconds / YEAR_SECONDS);
  if (!(sigmaTau > 0)) return 0.5;

  const z = Math.log(livePrice / strike) / sigmaTau;
  return clampPrice(normCdf(z));
}

/**
 * Displayed YES price for a market. For non-auto markets (or when the live
 * price/strike is unavailable) this is exactly the CPMM pool price. For auto
 * markets it blends the model price toward the traded pool price by volume, so
 * low-volume windows show the model and busy ones show real trading.
 */
export function blendedPriceYes(
  market: Market,
  livePrice: number | null | undefined,
  nowMs: number = Date.now()
): number {
  const traded = priceYes(market.yes_pool, market.no_pool);
  const series = parseAutoSeries(market.auto_series);
  if (!series || market.strike_price == null || livePrice == null || !Number.isFinite(livePrice)) {
    return traded;
  }
  const model = modelPriceYes(series.asset, market.strike_price, market.close_time, livePrice, nowMs);
  const volume = Number.isFinite(market.volume) && market.volume > 0 ? market.volume : 0;
  const weight = BLEND_K / (BLEND_K + volume);
  return clampPrice(weight * model + (1 - weight) * traded);
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

// Auto-market questions/descriptions are stored with "HH:MM UTC" wording
// server-side, but the UI must always show the viewer's own local time —
// these helpers derive local, timezone-labeled strings client-side instead.

const LOCAL_TIME_FORMATTER = new Intl.DateTimeFormat(undefined, {
  hour: 'numeric',
  minute: '2-digit',
  timeZoneName: 'short',
});

const LOCAL_TIME_NO_TZ_FORMATTER = new Intl.DateTimeFormat(undefined, {
  hour: 'numeric',
  minute: '2-digit',
});

const LOCAL_DATE_FORMATTER = new Intl.DateTimeFormat(undefined, {
  month: 'short',
  day: 'numeric',
});

/** e.g. "8:10 PM PDT" — the viewer's local time with a timezone abbreviation. */
export function localTime(iso: string | null | undefined): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return LOCAL_TIME_FORMATTER.format(d);
}

/**
 * e.g. "Jul 7, 8:05 – 8:10 PM PDT" — the local open→close window for an auto
 * market, given its close time and duration in minutes. The open time omits
 * am/pm and the timezone (shown once, at the end) to read as a single range.
 */
export function localWindow(closeIso: string | null | undefined, minutes: number): string {
  if (!closeIso) return '—';
  const close = new Date(closeIso);
  if (Number.isNaN(close.getTime())) return '—';
  const open = new Date(close.getTime() - minutes * 60000);

  const date = LOCAL_DATE_FORMATTER.format(close);
  const openText = LOCAL_TIME_NO_TZ_FORMATTER.format(open).replace(/\s?[AP]M$/i, '');
  const closeText = LOCAL_TIME_FORMATTER.format(close);

  return `${date}, ${openText} – ${closeText}`;
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

// Keep the chart's point buffer bounded — this is a live 250ms stream that
// could otherwise grow unbounded for a market left open in a background tab.
const LIVE_TICKER_MAX_POINTS = 1800;
// After this many consecutive failed WebSocket opens, stop retrying the
// socket and fall back to polling — avoids a tight reconnect loop when the
// feed is unreachable (e.g. blocked by a network/proxy).
const MAX_WS_OPEN_ATTEMPTS = 2;

/**
 * Real-time streaming price for an auto-market's underlying asset. Opens a
 * Coinbase Exchange WebSocket ticker feed and updates `price` on every tick
 * (sub-second cadence), while `points` is throttled to ~4/sec (250ms buckets)
 * so charts stay light while still feeling live. Falls back to 1s REST
 * polling if the socket can't be opened at all.
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
      // Dedupe the buffered-points stream to at most one entry per 250ms by
      // flooring to that bucket — the `price` state above still updates on
      // every tick regardless.
      const bucket = Math.floor(Date.now() / 250) * 250;
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

function easeOutCubic(t: number): number {
  return 1 - Math.pow(1 - t, 3);
}

/**
 * Smoothly tweens a displayed number toward `target` whenever it changes,
 * so a fast-ticking live price (sub-second WS updates) reads as a rolling
 * "odometer" cycling through intermediate values instead of jumping between
 * ticks. Uses requestAnimationFrame with an ease-out curve; if `target`
 * changes mid-tween, the animation retargets smoothly from whatever value is
 * currently displayed (never snaps), so overlapping updates blend into
 * continuous motion.
 *
 * The very first non-null target is shown instantly (no count-up from
 * nothing/zero) — animation only kicks in between subsequent targets, which
 * keeps the roll limited to the small tick-to-tick deltas.
 */
export function useAnimatedNumber(target: number | null, durationMs = 300): number | null {
  const [display, setDisplay] = useState<number | null>(null);
  const displayRef = useRef<number | null>(null);
  const rafRef = useRef<number | null>(null);
  const cancelledRef = useRef(false);

  useEffect(() => {
    return () => {
      cancelledRef.current = true;
      if (rafRef.current != null) cancelAnimationFrame(rafRef.current);
    };
  }, []);

  useEffect(() => {
    if (target == null) {
      if (rafRef.current != null) {
        cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
      }
      displayRef.current = null;
      setDisplay(null);
      return;
    }

    // First value ever shown — set instantly, no roll from nothing.
    if (displayRef.current == null) {
      displayRef.current = target;
      setDisplay(target);
      return;
    }

    const from = displayRef.current;
    const to = target;
    if (from === to) return;

    if (rafRef.current != null) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }

    const start = performance.now();

    function step(now: number) {
      if (cancelledRef.current) return;
      const elapsed = now - start;
      const t = durationMs <= 0 ? 1 : Math.min(1, elapsed / durationMs);
      const eased = easeOutCubic(t);
      const next = from + (to - from) * eased;

      displayRef.current = next;
      setDisplay(next);

      if (t < 1) {
        rafRef.current = requestAnimationFrame(step);
      } else {
        rafRef.current = null;
      }
    }

    rafRef.current = requestAnimationFrame(step);

    return () => {
      if (rafRef.current != null) {
        cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [target, durationMs]);

  return display;
}
