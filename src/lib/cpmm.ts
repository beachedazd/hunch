// Pure CPMM (constant-product market maker) math, mirroring the SQL logic
// described in ARCHITECTURE.md. Used client-side to render live trade quotes;
// the authoritative calculation happens in the `buy_shares` / `sell_shares`
// Postgres RPCs — this is a mirror for UX only.

import type { Outcome } from '../types';

export interface BuyQuote {
  shares: number;
  avgPrice: number; // execution price per share (0..1), pre-fee, from the AMM curve
  newPriceYes: number; // resulting price_yes after the trade
  fee: number; // USDC fee taken from the input amount
}

export interface SellQuote {
  proceeds: number; // USDC paid out, net of fee
  avgPrice: number; // execution price per share (0..1), pre-fee, from the AMM curve
  newPriceYes: number; // resulting price_yes after the trade
  fee: number; // USDC fee taken from the gross proceeds
}

/** price_yes = no_pool / (yes_pool + no_pool) */
export function priceYes(yesPool: number, noPool: number): number {
  const total = yesPool + noPool;
  if (total <= 0) return 0.5;
  return noPool / total;
}

/** price_no = 1 - price_yes */
export function priceNo(yesPool: number, noPool: number): number {
  return 1 - priceYes(yesPool, noPool);
}

/**
 * Quote a buy of `amount` USDC of `outcome` shares.
 * Fee is deducted from `amount` before it hits the AMM curve.
 */
export function quoteBuy(
  yesPool: number,
  noPool: number,
  outcome: Outcome,
  amount: number,
  feeBps: number
): BuyQuote {
  if (
    !(amount > 0) ||
    !(yesPool > 0) ||
    !(noPool > 0) ||
    !Number.isFinite(amount)
  ) {
    return { shares: 0, avgPrice: priceYes(yesPool, noPool), newPriceYes: priceYes(yesPool, noPool), fee: 0 };
  }

  const fee = (amount * feeBps) / 10000;
  const a = amount - fee;
  if (a <= 0) {
    return { shares: 0, avgPrice: priceYes(yesPool, noPool), newPriceYes: priceYes(yesPool, noPool), fee };
  }

  let shares: number;
  let newYesPool: number;
  let newNoPool: number;

  if (outcome === 'yes') {
    shares = yesPool + a - (yesPool * noPool) / (noPool + a);
    newYesPool = yesPool + a - shares;
    newNoPool = noPool + a;
  } else {
    shares = noPool + a - (yesPool * noPool) / (yesPool + a);
    newNoPool = noPool + a - shares;
    newYesPool = yesPool + a;
  }

  shares = Math.max(0, shares);
  const avgPrice = shares > 0 ? a / shares : priceYes(yesPool, noPool);
  const newPriceYes = priceYes(newYesPool, newNoPool);

  return { shares, avgPrice, newPriceYes, fee };
}

/**
 * Quote a sell of `shares` of `outcome` shares, returning USDC proceeds
 * (net of fee). Solves the quadratic root for `x` from the doc, guarded so
 * `x` stays within `(0, opposingPool)`.
 */
export function quoteSell(
  yesPool: number,
  noPool: number,
  outcome: Outcome,
  shares: number,
  feeBps: number
): SellQuote {
  const currentPriceYes = priceYes(yesPool, noPool);
  if (
    !(shares > 0) ||
    !(yesPool > 0) ||
    !(noPool > 0) ||
    !Number.isFinite(shares)
  ) {
    return { proceeds: 0, avgPrice: currentPriceYes, newPriceYes: currentPriceYes, fee: 0 };
  }

  // Symmetric: selling YES burns against no_pool; selling NO burns against yes_pool.
  const opposingPool = outcome === 'yes' ? noPool : yesPool;
  const total = yesPool + noPool + shares;
  const discriminant = total * total - 4 * shares * opposingPool;

  if (discriminant < 0) {
    // No valid root — pool can't support this sell size.
    return { proceeds: 0, avgPrice: currentPriceYes, newPriceYes: currentPriceYes, fee: 0 };
  }

  let x = (total - Math.sqrt(discriminant)) / 2;
  // Guard: 0 < x < opposingPool
  x = Math.max(0, Math.min(x, opposingPool - Number.EPSILON));

  const fee = (x * feeBps) / 10000;
  const proceeds = Math.max(0, x - fee);
  const avgPrice = x > 0 ? x / shares : currentPriceYes;

  let newYesPool: number;
  let newNoPool: number;
  if (outcome === 'yes') {
    newYesPool = yesPool + shares - x;
    newNoPool = noPool - x;
  } else {
    newNoPool = noPool + shares - x;
    newYesPool = yesPool - x;
  }

  const newPriceYes = priceYes(Math.max(newYesPool, 0), Math.max(newNoPool, 0));

  return { proceeds, avgPrice, newPriceYes, fee };
}
