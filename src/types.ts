// Domain types matching the Supabase schema exactly (see ARCHITECTURE.md → Schema).

export type MarketStatus = 'open' | 'resolved' | 'void';
export type Resolution = 'yes' | 'no' | null;
export type Outcome = 'yes' | 'no';
export type MarketSource = 'user' | 'polymarket';
export type TradeAction = 'buy' | 'sell';
export type TransactionType = 'faucet' | 'deposit' | 'buy' | 'sell' | 'redeem';
export type DepositStatus = 'confirmed' | 'rejected';

export interface Profile {
  id: string;
  username: string | null;
  wallet_address: string | null;
  balance: number;
  is_admin: boolean;
  last_faucet_at: string | null;
  created_at: string;
}

export interface Market {
  id: string;
  slug: string;
  question: string;
  description: string | null;
  category: string | null;
  image_url: string | null;
  creator_id: string | null;
  yes_pool: number;
  no_pool: number;
  fee_bps: number;
  fee_collected: number;
  volume: number;
  status: MarketStatus;
  resolution: Resolution;
  close_time: string | null;
  resolved_at: string | null;
  created_at: string;
  auto_series: string | null;
  strike_price: number | null;
  resolution_price: number | null;
  source: MarketSource;
  polymarket_id: string | null;
}

export interface Position {
  user_id: string;
  market_id: string;
  yes_shares: number;
  no_shares: number;
  updated_at: string;
}

// Position joined with its market — used on the Portfolio page.
export interface PositionWithMarket extends Position {
  market: Market;
}

export interface Trade {
  id: string;
  market_id: string;
  user_id: string;
  action: TradeAction;
  outcome: Outcome;
  amount: number;
  shares: number;
  price: number;
  price_yes_after: number;
  fee: number;
  created_at: string;
}

export interface Transaction {
  id: string;
  user_id: string;
  type: TransactionType;
  amount: number;
  market_id: string | null;
  ref: string | null;
  created_at: string;
}

export interface Deposit {
  id: string;
  user_id: string;
  tx_hash: string;
  amount_eth: number;
  amount_usdc: number;
  status: DepositStatus;
  created_at: string;
}

export interface Comment {
  id: string;
  market_id: string;
  user_id: string;
  body: string;
  created_at: string;
}

// Comment joined with a lightweight author profile — used in the comment list.
export interface CommentWithAuthor extends Comment {
  profile: Pick<Profile, 'id' | 'username'> | null;
}

export const MARKET_CATEGORIES = [
  'Politics',
  'Sports',
  'Crypto',
  'Science',
  'Pop Culture',
  'Business',
] as const;

export type MarketCategory = (typeof MARKET_CATEGORIES)[number];
