// Real-time asset price chart for auto-resolving crypto markets (BTC/ETH).
// Unlike PriceChart (which plots the YES-probability from trade history),
// this plots the underlying asset price streamed live via useLiveTicker, so
// the line visibly advances toward close_time as the countdown runs.
//
// Visual design intentionally mirrors Polymarket's "Up or Down" live chart:
// asset-branded line color, right-side Y axis, a "Target" reference line
// with a pill label, and a leading dot marking the newest live tick.

import { format } from 'date-fns';
import { useEffect, useMemo, useState } from 'react';
import {
  Area,
  AreaChart,
  CartesianGrid,
  ReferenceDot,
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

// Asset-branded line colors — Polymarket's "Up or Down" chart uses the
// coin's own brand color rather than a generic green/red up/down color.
const ASSET_COLORS: Record<LiveAsset, string> = {
  BTC: '#F7931A',
  ETH: '#627EEA',
};

const TARGET_LINE_COLOR = '#93a5ad';

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

// Custom label for the strike/target ReferenceLine — renders as a small
// rounded pill anchored to the right edge of the plot, reading "Target".
function TargetPillLabel(props: { viewBox?: { x?: number; y?: number; width?: number } }) {
  const { viewBox } = props;
  if (!viewBox || viewBox.x == null || viewBox.y == null || viewBox.width == null) return null;
  const pillWidth = 46;
  const pillHeight = 16;
  const x = viewBox.x + viewBox.width - pillWidth - 4;
  const y = viewBox.y - pillHeight / 2;

  return (
    <g>
      <rect
        x={x}
        y={y}
        width={pillWidth}
        height={pillHeight}
        rx={8}
        fill="#eef3f4"
        stroke="#e4eaec"
      />
      <text
        x={x + pillWidth / 2}
        y={y + pillHeight / 2 + 1}
        textAnchor="middle"
        dominantBaseline="middle"
        fontSize={10.5}
        fontWeight={700}
        fill="#48606c"
      >
        Target
      </text>
    </g>
  );
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

  const lastPoint = data.length > 0 ? data[data.length - 1] : null;
  const lastPrice = lastPoint ? lastPoint.price : strike;
  const resolvedClosePrice = market.resolution_price != null ? Number(market.resolution_price) : null;
  const headerPrice = isOpen ? (livePrice ?? lastPrice) : (resolvedClosePrice ?? lastPrice);
  const colorRefPrice = livePrice ?? lastPrice;
  const isUp = colorRefPrice >= strike;
  const delta = headerPrice - strike;

  const lineColor = ASSET_COLORS[series.asset];
  const gradientId = `livePriceFill-${series.asset}`;

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
        <div className="flex items-center gap-4">
          <div>
            <div className="text-[11px] font-extrabold uppercase tracking-wide text-text-faint">
              Price to beat
            </div>
            <div className="text-[30px] font-extrabold leading-tight text-text-primary">
              {formatUsd(strike)}
            </div>
          </div>

          <div className="h-9 w-px bg-border-c" />

          <div>
            <div className="text-[15px] font-bold text-text-primary">{formatUsd(headerPrice)}</div>
            {isOpen ? (
              <div className={clsx('text-xs font-bold', isUp ? 'text-yes' : 'text-no')}>
                {isUp ? '▲' : '▼'} {formatUsd(Math.abs(delta))} vs target
              </div>
            ) : (
              <div className={clsx('text-xs font-bold', isUp ? 'text-yes' : 'text-no')}>
                {isUp ? '▲ Up' : '▼ Down'}
              </div>
            )}
          </div>
        </div>

        {isOpen && (
          <span className="inline-flex items-center gap-1.5 text-[11px] font-extrabold uppercase tracking-wide text-text-muted">
            <span className="relative flex h-1.5 w-1.5">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-teal opacity-75" />
              <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-teal" />
            </span>
            Live
          </span>
        )}
      </div>

      <ResponsiveContainer width="100%" height={250}>
        <AreaChart data={data} margin={{ top: 12, right: 8, left: -8, bottom: 0 }}>
          <defs>
            <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={lineColor} stopOpacity={0.22} />
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
            orientation="right"
            domain={yDomain}
            tickFormatter={(v) => `$${Math.round(Number(v)).toLocaleString()}`}
            stroke="#93a5ad"
            tick={{ fontSize: 11 }}
            width={64}
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
            stroke={TARGET_LINE_COLOR}
            strokeDasharray="5 5"
            label={<TargetPillLabel />}
          />
          <Area
            type="monotone"
            dataKey="price"
            stroke={lineColor}
            strokeWidth={2.5}
            fill={`url(#${gradientId})`}
            dot={false}
            activeDot={false}
            isAnimationActive={false}
          />
          {lastPoint && (
            <ReferenceDot
              x={lastPoint.time}
              y={lastPoint.price}
              r={4}
              fill={lineColor}
              stroke="#fff"
              strokeWidth={1.5}
            />
          )}
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}
