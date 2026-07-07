import { format } from 'date-fns';
import { useMemo, useState } from 'react';
import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import clsx from 'clsx';
import { priceYes } from '../lib/cpmm';
import type { Market, Trade } from '../types';

type Range = '1D' | '1W' | '1M' | 'ALL';

const RANGES: Range[] = ['1D', '1W', '1M', 'ALL'];
const RANGE_LABELS: Record<Range, string> = { '1D': '1D', '1W': '1W', '1M': '1M', ALL: 'All' };
const RANGE_MS: Record<Exclude<Range, 'ALL'>, number> = {
  '1D': 24 * 60 * 60 * 1000,
  '1W': 7 * 24 * 60 * 60 * 1000,
  '1M': 30 * 24 * 60 * 60 * 1000,
};

interface PriceChartProps {
  trades: Trade[];
  market: Market;
}

export function PriceChart({ trades, market }: PriceChartProps) {
  const [range, setRange] = useState<Range>('1W');

  const data = useMemo(() => {
    const points = trades.map((t) => ({
      time: new Date(t.created_at).getTime(),
      price: Number(t.price_yes_after) * 100,
    }));

    // Seed with the market's initial 50/50 price so the chart has a starting
    // point even before the first trade lands.
    const seedPrice = points.length > 0 ? undefined : priceYes(market.yes_pool, market.no_pool) * 100;
    const seeded =
      seedPrice !== undefined
        ? [{ time: new Date(market.created_at).getTime(), price: seedPrice }]
        : points;

    if (range === 'ALL') return seeded;
    const cutoff = Date.now() - RANGE_MS[range];
    const filtered = seeded.filter((p) => p.time >= cutoff);
    // If the range filter drops everything, fall back to full history so the
    // chart never renders truly empty when trades do exist.
    return filtered.length > 0 ? filtered : seeded;
  }, [trades, market, range]);

  const tickFormatter = (t: number) => {
    if (range === '1D') return format(new Date(t), 'HH:mm');
    if (range === '1W' || range === '1M') return format(new Date(t), 'MMM d');
    return format(new Date(t), 'MMM yyyy');
  };

  const lastPrice = data.length > 0 ? data[data.length - 1].price : null;
  const firstPrice = data.length > 0 ? data[0].price : null;
  const change = lastPrice !== null && firstPrice !== null ? lastPrice - firstPrice : null;

  return (
    <div className="rounded-2xl border border-border-c bg-white p-5">
      <div className="flex items-baseline gap-2.5">
        <span className="text-[32px] font-extrabold text-teal-deep">
          {lastPrice !== null ? `${Math.round(lastPrice)}¢` : '—'}
        </span>
        {change !== null && (
          <span
            className={clsx(
              'text-sm font-bold',
              change >= 0 ? 'text-yes' : 'text-no'
            )}
          >
            {change >= 0 ? '▲' : '▼'} {Math.abs(Math.round(change))}¢
          </span>
        )}
      </div>

      {trades.length === 0 ? (
        <div className="flex h-64 items-center justify-center text-sm text-text-muted">
          No trades yet — be the first to trade this market.
        </div>
      ) : (
        <ResponsiveContainer width="100%" height={220}>
          <AreaChart data={data} margin={{ top: 8, right: 8, left: -16, bottom: 0 }}>
            <defs>
              <linearGradient id="priceFill" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#0fa3b1" stopOpacity={0.25} />
                <stop offset="100%" stopColor="#0fa3b1" stopOpacity={0} />
              </linearGradient>
            </defs>
            <CartesianGrid stroke="#eef3f4" strokeDasharray="3 3" vertical={false} />
            <XAxis
              dataKey="time"
              type="number"
              domain={['dataMin', 'dataMax']}
              tickFormatter={tickFormatter}
              stroke="#93a5ad"
              tick={{ fontSize: 11 }}
              minTickGap={40}
            />
            <YAxis
              domain={[0, 100]}
              tickFormatter={(v) => `${v}¢`}
              stroke="#93a5ad"
              tick={{ fontSize: 11 }}
              width={40}
            />
            <Tooltip
              contentStyle={{
                background: '#ffffff',
                border: '1px solid #e4eaec',
                borderRadius: 10,
                fontSize: 12,
              }}
              labelFormatter={(t) => format(new Date(Number(t)), 'MMM d, yyyy HH:mm')}
              formatter={(value) => [`${Math.round(Number(value))}¢`, 'Yes price']}
            />
            <Area
              type="monotone"
              dataKey="price"
              stroke="#0fa3b1"
              strokeWidth={3}
              fill="url(#priceFill)"
            />
          </AreaChart>
        </ResponsiveContainer>
      )}

      <div className="mt-2.5 flex gap-2 text-xs font-bold text-text-muted">
        {RANGES.map((r) => (
          <button
            key={r}
            onClick={() => setRange(r)}
            className={clsx(
              'rounded-lg px-3 py-1.5',
              range === r ? 'bg-[#152229] text-white' : 'bg-subtle text-text-muted'
            )}
          >
            {RANGE_LABELS[r]}
          </button>
        ))}
      </div>
    </div>
  );
}
