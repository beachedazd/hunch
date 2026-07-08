// Real-time asset price chart for auto-resolving crypto markets (BTC/ETH).
// Unlike PriceChart (which plots the YES-probability from trade history),
// this plots the underlying asset price streamed live via useLiveTicker, so
// the line visibly advances toward close_time as the countdown runs.

import { format } from 'date-fns';
import { useEffect, useMemo, useState } from 'react';
import {
  Area,
  AreaChart,
  CartesianGrid,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import clsx from 'clsx';
import { parseAutoSeries, useLiveTicker, type LiveAsset } from '../lib/live';
import { formatUsd } from '../lib/format';
import type { Market } from '../types';

interface LivePriceChartProps {
  market: Market;
}

interface PricePoint {
  time: number;
  price: number;
}

type CoinbaseCandle = [number, number, number, number, number, number];

async function fetchCandlesInWindow(
  asset: LiveAsset,
  openMs: number,
  closeMs: number
): Promise<PricePoint[]> {
  const res = await fetch(
    `https://api.exchange.coinbase.com/products/${asset}-USD/candles?granularity=60`
  );
  if (!res.ok) throw new Error('Failed to load candles');
  const raw = (await res.json()) as unknown;
  if (!Array.isArray(raw)) return [];

  return raw
    .filter((c): c is CoinbaseCandle => Array.isArray(c) && typeof c[0] === 'number')
    .map((c) => ({ time: c[0] * 1000, price: c[4] }))
    .filter((p) => Number.isFinite(p.price) && p.time >= openMs && p.time <= closeMs);
}

export function LivePriceChart({ market }: LivePriceChartProps) {
  const series = parseAutoSeries(market.auto_series);
  const isOpen = market.status === 'open';
  const asset = series?.asset ?? null;

  // Hooks must run unconditionally — they no-op internally until `asset` is
  // set and the market is open.
  const { price: livePrice, points } = useLiveTicker(asset, isOpen);

  const closeMs = market.close_time ? new Date(market.close_time).getTime() : Date.now();
  const openMs = series ? closeMs - series.minutes * 60000 : closeMs;
  const strike = Number(market.strike_price);

  const [backfill, setBackfill] = useState<PricePoint[]>([]);

  useEffect(() => {
    setBackfill([]);
    if (!asset) return;
    let cancelled = false;

    fetchCandlesInWindow(asset, openMs, closeMs)
      .then((mapped) => {
        if (!cancelled) setBackfill(mapped);
      })
      .catch(() => {
        // Best-effort only — candles can fail from the browser (CORS/network
        // hiccups). The chart still renders from the seed point + live ticks.
      });

    return () => {
      cancelled = true;
    };
  }, [asset, openMs, closeMs]);

  const data = useMemo<PricePoint[]>(() => {
    if (!series || !Number.isFinite(strike)) return [];

    const merged = new Map<number, number>();
    merged.set(openMs, strike);
    for (const p of backfill) merged.set(p.time, p.price);
    for (const p of points) merged.set(p.time, p.price);

    const cap = isOpen ? Date.now() : closeMs;
    const list = Array.from(merged.entries())
      .map(([time, price]) => ({ time, price }))
      .filter((p) => p.time <= cap)
      .sort((a, b) => a.time - b.time);

    if (!isOpen && market.resolution_price != null) {
      list.push({ time: closeMs, price: Number(market.resolution_price) });
    }

    return list;
  }, [series, strike, openMs, closeMs, backfill, points, isOpen, market.resolution_price]);

  if (!series || !Number.isFinite(strike)) {
    return (
      <div className="rounded-2xl border border-border-c bg-white p-5">
        <div className="flex h-64 items-center justify-center text-sm text-text-muted">
          Live price chart unavailable for this market.
        </div>
      </div>
    );
  }

  const lastPrice = data.length > 0 ? data[data.length - 1].price : strike;
  const resolvedClosePrice = market.resolution_price != null ? Number(market.resolution_price) : null;
  const headerPrice = isOpen ? (livePrice ?? lastPrice) : (resolvedClosePrice ?? lastPrice);
  const colorRefPrice = livePrice ?? lastPrice;
  // App's yes/no tokens (tailwind.config.js) — reused here since Recharts
  // strokes need a literal hex, not a Tailwind class.
  const isUp = colorRefPrice >= strike;
  const lineColor = isUp ? '#2f7d5c' : '#c0504f';
  const gradientId = isUp ? 'livePriceFillUp' : 'livePriceFillDown';
  const delta = headerPrice - strike;

  const yDomain: [number, number] = (() => {
    const prices = data.map((p) => p.price);
    const withStrike = prices.length > 0 ? [...prices, strike] : [strike];
    const min = Math.min(...withStrike);
    const max = Math.max(...withStrike);
    const pad = Math.max((max - min) * 0.15, max * 0.0015, 1);
    return [min - pad, max + pad];
  })();

  return (
    <div className="rounded-2xl border border-border-c bg-white p-5">
      <div className="flex items-center justify-between">
        <div className="flex items-baseline gap-2.5">
          <span className={clsx('text-[32px] font-extrabold', isUp ? 'text-yes' : 'text-no')}>
            {formatUsd(headerPrice)}
          </span>
          <span className={clsx('text-sm font-bold', isUp ? 'text-yes' : 'text-no')}>
            {isUp ? '▲' : '▼'} {formatUsd(Math.abs(delta))} vs strike
          </span>
        </div>
        {isOpen ? (
          <span className="inline-flex items-center gap-1.5 text-[11px] font-extrabold uppercase tracking-wide text-text-muted">
            <span className="relative flex h-1.5 w-1.5">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-teal opacity-75" />
              <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-teal" />
            </span>
            Live
          </span>
        ) : (
          <span className={clsx('text-[13px] font-extrabold', isUp ? 'text-yes' : 'text-no')}>
            {isUp ? '▲ Up' : '▼ Down'}
          </span>
        )}
      </div>

      <ResponsiveContainer width="100%" height={240}>
        <AreaChart data={data} margin={{ top: 8, right: 8, left: -16, bottom: 0 }}>
          <defs>
            <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={lineColor} stopOpacity={0.25} />
              <stop offset="100%" stopColor={lineColor} stopOpacity={0} />
            </linearGradient>
          </defs>
          <CartesianGrid stroke="#eef3f4" strokeDasharray="3 3" vertical={false} />
          <XAxis
            dataKey="time"
            type="number"
            domain={[openMs, closeMs]}
            tickFormatter={(t) => format(new Date(t), 'HH:mm:ss')}
            stroke="#93a5ad"
            tick={{ fontSize: 11 }}
            minTickGap={40}
          />
          <YAxis
            domain={yDomain}
            tickFormatter={(v) => `$${Math.round(Number(v)).toLocaleString()}`}
            stroke="#93a5ad"
            tick={{ fontSize: 11 }}
            width={56}
          />
          <Tooltip
            contentStyle={{
              background: '#ffffff',
              border: '1px solid #e4eaec',
              borderRadius: 10,
              fontSize: 12,
            }}
            labelFormatter={(t) => format(new Date(Number(t)), 'HH:mm:ss')}
            formatter={(value) => [formatUsd(Number(value)), series.asset]}
          />
          <ReferenceLine
            y={strike}
            stroke="#93a5ad"
            strokeDasharray="4 4"
            label={{
              value: `Strike $${Math.round(strike).toLocaleString()}`,
              position: 'insideTopRight',
              fontSize: 11,
              fill: '#93a5ad',
            }}
          />
          <Area
            type="monotone"
            dataKey="price"
            stroke={lineColor}
            strokeWidth={3}
            fill={`url(#${gradientId})`}
            isAnimationActive={false}
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}
