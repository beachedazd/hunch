import { describe, expect, it } from 'vitest';
import { normCdf, modelPriceYes, blendedPriceYes } from './live';
import type { Market } from '../types';

const NOW = 1_800_000_000_000; // fixed clock for determinism

// A minimal auto market: strike 100, closes 5 min after `now`, no volume.
function autoMarket(overrides: Partial<Market> = {}): Market {
  return {
    id: 'm1', slug: 's1', question: 'q', description: null, category: 'Crypto',
    image_url: null, creator_id: null, yes_pool: 500, no_pool: 500, fee_bps: 200,
    fee_collected: 0, volume: 0, status: 'open', resolution: null,
    close_time: new Date(NOW + 5 * 60_000).toISOString(), resolved_at: null,
    created_at: new Date(NOW).toISOString(), auto_series: 'btc-5m',
    strike_price: 100, resolution_price: null, source: 'user', polymarket_id: null,
    ...overrides,
  };
}

describe('normCdf', () => {
  it('is 0.5 at 0', () => {
    expect(normCdf(0)).toBeCloseTo(0.5, 5);
  });
  it('approximates the standard normal CDF at 1.96', () => {
    expect(normCdf(1.96)).toBeCloseTo(0.975, 3);
  });
  it('is symmetric', () => {
    expect(normCdf(-1)).toBeCloseTo(1 - normCdf(1), 5);
  });
});

describe('modelPriceYes', () => {
  it('is 0.5 when price sits on the strike', () => {
    expect(modelPriceYes('BTC', 100, new Date(NOW + 300_000).toISOString(), 100, NOW)).toBeCloseTo(0.5, 6);
  });
  it('is above 0.5 when price is above the strike', () => {
    expect(modelPriceYes('BTC', 100, new Date(NOW + 300_000).toISOString(), 100.2, NOW)).toBeGreaterThan(0.6);
  });
  it('is below 0.5 when price is below the strike', () => {
    expect(modelPriceYes('BTC', 100, new Date(NOW + 300_000).toISOString(), 99.8, NOW)).toBeLessThan(0.4);
  });
  it('clamps toward 0.98 as the window nears close with price above strike', () => {
    expect(modelPriceYes('BTC', 100, new Date(NOW + 1_000).toISOString(), 100.5, NOW)).toBeCloseTo(0.98, 6);
  });
  it('returns 0.5 for unusable inputs', () => {
    expect(modelPriceYes('BTC', null, new Date(NOW + 300_000).toISOString(), 100, NOW)).toBe(0.5);
    expect(modelPriceYes('BTC', 100, new Date(NOW + 300_000).toISOString(), null, NOW)).toBe(0.5);
  });
});

describe('blendedPriceYes', () => {
  it('returns the pool price for non-auto markets', () => {
    const m = autoMarket({ auto_series: null, yes_pool: 300, no_pool: 700 });
    expect(blendedPriceYes(m, 100.5)).toBeCloseTo(0.7, 6); // no_pool/(yes+no)
  });
  it('returns the pool price when live price is null', () => {
    const m = autoMarket({ yes_pool: 400, no_pool: 600 });
    expect(blendedPriceYes(m, null)).toBeCloseTo(0.6, 6);
  });
  it('at zero volume returns the model price (above 0.5 when up)', () => {
    const m = autoMarket({ volume: 0 });
    // strike 100, price 100.2, 5m to close => model > 0.6, pools are 50/50
    expect(blendedPriceYes(m, 100.2, NOW)).toBeGreaterThan(0.6);
  });
  it('at high volume tugs toward the traded pool price', () => {
    const m = autoMarket({ volume: 100_000, yes_pool: 800, no_pool: 200 });
    // traded = 0.2; weight = 250/100250 ~= 0.0025 => blended ~= traded
    expect(blendedPriceYes(m, 100.2, NOW)).toBeLessThan(0.25);
  });
});
