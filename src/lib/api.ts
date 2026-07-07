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
} from '../types';

function fail(error: { message: string } | null, fallback: string): never {
  throw new Error(error?.message || fallback);
}

// ---------------------------------------------------------------------------
// Markets
// ---------------------------------------------------------------------------

export async function listMarkets(
  category?: string | null,
  search?: string | null
): Promise<Market[]> {
  let query = supabase.from('markets').select('*').order('volume', { ascending: false });

  if (category && category !== 'All') {
    query = query.eq('category', category);
  }
  if (search && search.trim()) {
    query = query.ilike('question', `%${search.trim()}%`);
  }

  const { data, error } = await query;
  if (error) fail(error, 'Failed to load markets');
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
