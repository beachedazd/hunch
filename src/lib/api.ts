// All Supabase data access lives here: plain queries + RPC wrappers.
// Every function throws a plain Error with a clean message (Postgres
// exception messages are surfaced via `error.message`) so callers/React Query
// can render `error.message` directly.

import { supabase } from './supabase';
import type {
  Comment,
  CommentWithAuthor,
  Deposit,
  Market,
  MarketStatus,
  Outcome,
  Position,
  PositionWithMarket,
  Profile,
  Resolution,
  Trade,
  Transaction,
  Withdrawal,
} from '../types';

function fail(error: { message: string } | null, fallback: string): never {
  throw new Error(error?.message || fallback);
}

// ---------------------------------------------------------------------------
// Markets
// ---------------------------------------------------------------------------

export async function listMarkets(
  category?: string | null,
  search?: string | null,
  opts?: { excludeAuto?: boolean }
): Promise<Market[]> {
  let query = supabase.from('markets').select('*').order('volume', { ascending: false });

  if (category && category !== 'All') {
    query = query.eq('category', category);
  }
  if (search && search.trim()) {
    query = query.ilike('question', `%${search.trim()}%`);
  }
  if (opts?.excludeAuto) {
    query = query.is('auto_series', null);
  }

  const { data, error } = await query;
  if (error) fail(error, 'Failed to load markets');
  return (data ?? []) as Market[];
}

// Live, auto-resolving short-horizon crypto markets (BTC/ETH up-or-down),
// shown in their own rail on Home rather than the normal grid.
export async function fetchLiveMarkets(): Promise<Market[]> {
  const { data, error } = await supabase
    .from('markets')
    .select('*')
    .not('auto_series', 'is', null)
    .eq('status', 'open')
    .order('close_time', { ascending: true });
  if (error) fail(error, 'Failed to load live markets');
  return (data ?? []) as Market[];
}

export async function getMarketBySlug(slug: string): Promise<Market | null> {
  const { data, error } = await supabase
    .from('markets')
    .select('*')
    .eq('slug', slug)
    .maybeSingle();
  if (error) fail(error, 'Failed to load market');
  return (data ?? null) as Market | null;
}

export async function getMarketById(id: string): Promise<Market | null> {
  const { data, error } = await supabase.from('markets').select('*').eq('id', id).maybeSingle();
  if (error) fail(error, 'Failed to load market');
  return (data ?? null) as Market | null;
}

// ---------------------------------------------------------------------------
// Trades (public, for charts)
// ---------------------------------------------------------------------------

export async function getTrades(marketId: string): Promise<Trade[]> {
  const { data, error } = await supabase
    .from('trades')
    .select('*')
    .eq('market_id', marketId)
    .order('created_at', { ascending: true });
  if (error) fail(error, 'Failed to load trade history');
  return (data ?? []) as Trade[];
}

// ---------------------------------------------------------------------------
// Ticker (24h price baselines)
// ---------------------------------------------------------------------------

// Baseline price_yes per market ~24h ago, from one query over the last 48h of
// trades: the last trade before the 24h cutoff wins; a market whose first
// trade falls inside the window uses that trade's price instead (its delta
// then understates the move — fine for a ticker).
export async function getTicker24hBaselines(): Promise<Record<string, number>> {
  const now = Date.now();
  const since = new Date(now - 48 * 3600 * 1000).toISOString();
  const cutoff = now - 24 * 3600 * 1000;

  const { data, error } = await supabase
    .from('trades')
    .select('market_id, price_yes_after, created_at')
    .gte('created_at', since)
    .order('created_at', { ascending: true });
  if (error) fail(error, 'Failed to load recent trades');

  const baselines: Record<string, number> = {};
  for (const t of (data ?? []) as Pick<Trade, 'market_id' | 'price_yes_after' | 'created_at'>[]) {
    const ts = new Date(t.created_at).getTime();
    if (ts <= cutoff) {
      baselines[t.market_id] = t.price_yes_after;
    } else if (!(t.market_id in baselines)) {
      baselines[t.market_id] = t.price_yes_after;
    }
  }
  return baselines;
}

// ---------------------------------------------------------------------------
// Positions
// ---------------------------------------------------------------------------

export async function getMyPosition(marketId: string): Promise<Position | null> {
  const { data: auth } = await supabase.auth.getUser();
  const uid = auth.user?.id;
  if (!uid) return null;

  const { data, error } = await supabase
    .from('positions')
    .select('*')
    .eq('market_id', marketId)
    .eq('user_id', uid)
    .maybeSingle();
  if (error) fail(error, 'Failed to load your position');
  return (data ?? null) as Position | null;
}

export async function getMyPositions(): Promise<PositionWithMarket[]> {
  const { data: auth } = await supabase.auth.getUser();
  const uid = auth.user?.id;
  if (!uid) return [];

  const { data, error } = await supabase
    .from('positions')
    .select('*, market:markets(*)')
    .eq('user_id', uid)
    .order('updated_at', { ascending: false });
  if (error) fail(error, 'Failed to load your positions');
  return ((data ?? []) as unknown as PositionWithMarket[]).filter((p) => p.market);
}

// Used by Portfolio to derive avg cost per market from the user's own trades.
export async function getMyTradesForMarket(marketId: string): Promise<Trade[]> {
  const { data: auth } = await supabase.auth.getUser();
  const uid = auth.user?.id;
  if (!uid) return [];

  const { data, error } = await supabase
    .from('trades')
    .select('*')
    .eq('market_id', marketId)
    .eq('user_id', uid)
    .order('created_at', { ascending: true });
  if (error) fail(error, 'Failed to load your trades');
  return (data ?? []) as Trade[];
}

// ---------------------------------------------------------------------------
// Transactions
// ---------------------------------------------------------------------------

export async function getMyTransactions(): Promise<Transaction[]> {
  const { data: auth } = await supabase.auth.getUser();
  const uid = auth.user?.id;
  if (!uid) return [];

  const { data, error } = await supabase
    .from('transactions')
    .select('*')
    .eq('user_id', uid)
    .order('created_at', { ascending: false });
  if (error) fail(error, 'Failed to load transaction history');
  return (data ?? []) as Transaction[];
}

// ---------------------------------------------------------------------------
// Profile
// ---------------------------------------------------------------------------

export async function getProfile(): Promise<Profile | null> {
  const { data: auth } = await supabase.auth.getUser();
  const uid = auth.user?.id;
  if (!uid) return null;

  const { data, error } = await supabase
    .from('profiles')
    .select('*')
    .eq('id', uid)
    .maybeSingle();
  if (error) fail(error, 'Failed to load profile');
  return (data ?? null) as Profile | null;
}

export async function updateUsername(username: string): Promise<void> {
  const { data: auth } = await supabase.auth.getUser();
  const uid = auth.user?.id;
  if (!uid) throw new Error('Not signed in');

  const { error } = await supabase.from('profiles').update({ username }).eq('id', uid);
  if (error) fail(error, 'Failed to update username');
}

export async function updateWalletAddress(address: string): Promise<void> {
  const { data: auth } = await supabase.auth.getUser();
  const uid = auth.user?.id;
  if (!uid) throw new Error('Not signed in');

  const { error } = await supabase
    .from('profiles')
    .update({ wallet_address: address })
    .eq('id', uid);
  if (error) fail(error, 'Failed to save wallet address');
}

export async function updateTronAddress(address: string): Promise<void> {
  const { data: auth } = await supabase.auth.getUser();
  const uid = auth.user?.id;
  if (!uid) throw new Error('Not signed in');

  const { error } = await supabase
    .from('profiles')
    .update({ tron_address: address })
    .eq('id', uid);
  if (error) fail(error, 'Failed to save Tron address');
}

// ---------------------------------------------------------------------------
// Deposits (crypto backing)
// ---------------------------------------------------------------------------

export async function getMyDeposits(limit = 5): Promise<Deposit[]> {
  const { data: auth } = await supabase.auth.getUser();
  const uid = auth.user?.id;
  if (!uid) return [];

  const { data, error } = await supabase
    .from('deposits')
    .select('*')
    .eq('user_id', uid)
    .order('created_at', { ascending: false })
    .limit(limit);
  if (error) fail(error, 'Failed to load deposits');
  return (data ?? []) as Deposit[];
}

export interface VerifyDepositResult {
  status: 'confirmed' | 'duplicate';
  tx_hash?: string;
  amount_eth?: number;
  amount_usdc?: number;
  error?: string;
}

// Calls the Netlify function that verifies a Sepolia tx on-chain and credits
// the user's balance. Sends the current Supabase access token so the
// function can resolve the caller server-side via `auth.getUser(jwt)`.
export async function verifyDeposit(txHash: string): Promise<VerifyDepositResult> {
  const { data: sessionData } = await supabase.auth.getSession();
  const accessToken = sessionData.session?.access_token;
  if (!accessToken) throw new Error('You must be signed in to verify a deposit');

  const res = await fetch('/api/verify-deposit', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${accessToken}`,
    },
    body: JSON.stringify({ txHash }),
  });

  const body = (await res.json().catch(() => ({}))) as VerifyDepositResult;

  if (res.status === 409) {
    throw new Error(body.error || 'This deposit has already been credited.');
  }
  if (!res.ok) {
    throw new Error(body.error || 'Failed to verify deposit');
  }
  return body;
}

export interface VerifyTronDepositResult {
  status: 'confirmed' | 'duplicate';
  tx_hash?: string;
  amount_usdt?: number;
  amount_usdc?: number;
  error?: string;
}

// Calls the Netlify function that verifies a Tron USDT deposit and credits
// the user's balance at 1 USDT = 1 USDC. Sends the current Supabase access
// token so the function can resolve the caller server-side via `auth.getUser(jwt)`.
export async function verifyTronDeposit(txId: string): Promise<VerifyTronDepositResult> {
  const { data: sessionData } = await supabase.auth.getSession();
  const accessToken = sessionData.session?.access_token;
  if (!accessToken) throw new Error('You must be signed in to verify a deposit');

  const res = await fetch('/api/verify-tron-deposit', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${accessToken}`,
    },
    body: JSON.stringify({ txId }),
  });

  const body = (await res.json().catch(() => ({}))) as VerifyTronDepositResult;

  if (res.status === 409) {
    throw new Error(body.error || 'This deposit has already been credited.');
  }
  if (!res.ok) {
    throw new Error(body.error || 'Failed to verify deposit');
  }
  return body;
}

// ---------------------------------------------------------------------------
// Withdrawals (crypto → user)
// ---------------------------------------------------------------------------

export async function getMyWithdrawals(limit = 5): Promise<Withdrawal[]> {
  const { data: auth } = await supabase.auth.getUser();
  const uid = auth.user?.id;
  if (!uid) return [];

  const { data, error } = await supabase
    .from('withdrawals')
    .select('*')
    .eq('user_id', uid)
    .order('created_at', { ascending: false })
    .limit(limit);
  if (error) fail(error, 'Failed to load withdrawals');
  return (data ?? []) as Withdrawal[];
}

export interface WithdrawResult {
  status: 'sent';
  withdrawal_id: string;
  tx_hash: string;
  chain: 'sepolia' | 'tron';
  amount_usdc: number;
  amount_native: number;
  explorer_url: string;
}

// Calls the Netlify function that processes a withdrawal. Sends the current
// Supabase access token so the function can resolve the caller server-side.
export async function requestWithdrawal(input: {
  chain: 'sepolia' | 'tron';
  amountUsdc: number;
  destAddress: string;
}): Promise<WithdrawResult> {
  const { data: sessionData } = await supabase.auth.getSession();
  const accessToken = sessionData.session?.access_token;
  if (!accessToken) throw new Error('You must be signed in to withdraw');

  const res = await fetch('/api/withdraw', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${accessToken}`,
    },
    body: JSON.stringify({
      chain: input.chain,
      amountUsdc: input.amountUsdc,
      destAddress: input.destAddress,
    }),
  });

  const body = (await res.json().catch(() => ({}))) as WithdrawResult & { error?: string };

  if (!res.ok) {
    throw new Error(body.error || 'Withdrawal failed');
  }
  return body as WithdrawResult;
}

// ---------------------------------------------------------------------------
// Comments
// ---------------------------------------------------------------------------

export async function getComments(marketId: string): Promise<CommentWithAuthor[]> {
  const { data, error } = await supabase
    .from('comments')
    .select('*, profile:profiles(id, username)')
    .eq('market_id', marketId)
    .order('created_at', { ascending: false });
  if (error) fail(error, 'Failed to load comments');
  return (data ?? []) as unknown as CommentWithAuthor[];
}

export async function addComment(marketId: string, body: string): Promise<Comment> {
  const { data: auth } = await supabase.auth.getUser();
  const uid = auth.user?.id;
  if (!uid) throw new Error('You must be signed in to comment');

  const { data, error } = await supabase
    .from('comments')
    .insert({ market_id: marketId, user_id: uid, body })
    .select('*')
    .single();
  if (error) fail(error, 'Failed to post comment');
  return data as Comment;
}

// ---------------------------------------------------------------------------
// RPCs
// ---------------------------------------------------------------------------

export interface BuySharesResult {
  shares: number;
  price: number;
  new_price_yes: number;
}

export async function buyShares(
  marketId: string,
  outcome: Outcome,
  amount: number
): Promise<BuySharesResult> {
  const { data, error } = await supabase.rpc('buy_shares', {
    p_market_id: marketId,
    p_outcome: outcome,
    p_amount: amount,
  });
  if (error) fail(error, 'Buy failed');
  return data as BuySharesResult;
}

export interface SellSharesResult {
  proceeds: number;
  price: number;
  new_price_yes: number;
}

export async function sellShares(
  marketId: string,
  outcome: Outcome,
  shares: number
): Promise<SellSharesResult> {
  const { data, error } = await supabase.rpc('sell_shares', {
    p_market_id: marketId,
    p_outcome: outcome,
    p_shares: shares,
  });
  if (error) fail(error, 'Sell failed');
  return data as SellSharesResult;
}

// Best-effort: repositions an auto crypto market's CPMM pool to the live model
// price before the user trades, so a buy executes at ~the odds shown. Throttled
// server-side (>=5s) and a no-op for non-auto/closed markets. A failure here
// must never block trading — callers swallow it.
export async function syncAutoMarketOdds(marketId: string): Promise<void> {
  const { error } = await supabase.rpc('sync_auto_market_odds', { p_market_id: marketId });
  if (error) throw new Error(error.message);
}

export async function claimFaucet(): Promise<void> {
  const { error } = await supabase.rpc('claim_faucet');
  if (error) fail(error, 'Faucet claim failed');
}

export async function createMarket(input: {
  question: string;
  description: string;
  category: string;
  image_url: string;
  close_time: string;
  seed: number;
}): Promise<string> {
  const { data, error } = await supabase.rpc('create_market', {
    question: input.question,
    description: input.description,
    category: input.category,
    image_url: input.image_url,
    close_time: input.close_time,
    seed: input.seed,
  });
  if (error) fail(error, 'Failed to create market');
  return data as string;
}

export async function resolveMarket(
  marketId: string,
  resolution: Exclude<Resolution, null> | 'void'
): Promise<void> {
  const { error } = await supabase.rpc('resolve_market', {
    p_market_id: marketId,
    p_resolution: resolution,
  });
  if (error) fail(error, 'Failed to resolve market');
}

export async function redeemWinnings(marketId: string): Promise<number> {
  const { data, error } = await supabase.rpc('redeem_winnings', {
    p_market_id: marketId,
  });
  if (error) fail(error, 'Failed to redeem winnings');
  return (data as number) ?? 0;
}

// ---------------------------------------------------------------------------
// Admin helpers
// ---------------------------------------------------------------------------

export async function listMarketsByStatus(status: MarketStatus): Promise<Market[]> {
  const { data, error } = await supabase
    .from('markets')
    .select('*')
    .eq('status', status)
    .order('close_time', { ascending: true });
  if (error) fail(error, 'Failed to load markets');
  return (data ?? []) as Market[];
}

export interface PolymarketSyncResult {
  imported: Array<{ polymarket_id: string; question: string; category: string; price_yes: number }>;
  resolved: Array<{ polymarket_id: string; question: string; resolution: string }>;
  skipped: number;
  errors: string[];
}

// Calls the Netlify function that triggers an on-demand Polymarket sync run.
// Sends the current Supabase access token; the function checks the caller's
// `profiles.is_admin` before importing/resolving mirrored markets.
export async function syncPolymarket(): Promise<PolymarketSyncResult> {
  const { data: sessionData } = await supabase.auth.getSession();
  const accessToken = sessionData.session?.access_token;
  if (!accessToken) throw new Error('You must be signed in to sync Polymarket');

  const res = await fetch('/api/polymarket-sync', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
    },
  });

  const body = (await res.json().catch(() => ({}))) as PolymarketSyncResult & { error?: string };

  if (res.status === 401) {
    throw new Error(body.error || 'You must be an admin to sync Polymarket');
  }
  if (!res.ok) {
    throw new Error(body.error || 'Failed to sync Polymarket');
  }
  return body;
}

// ---------------------------------------------------------------------------
// Leaderboard
// ---------------------------------------------------------------------------

export interface LeaderboardEntry {
  id: string;
  username: string | null;
  balance: number;
}

export async function listLeaderboard(limit = 100): Promise<LeaderboardEntry[]> {
  const { data, error } = await supabase
    .from('profiles')
    .select('id, username, balance')
    .order('balance', { ascending: false })
    .limit(limit);
  if (error) fail(error, 'Failed to load leaderboard');
  return (data ?? []) as LeaderboardEntry[];
}
