-- PolyForecast: seed data
--
-- Intended for a fresh local/dev database. Markets and the system user are
-- inserted idempotently (ON CONFLICT DO NOTHING keyed on id/slug), but the
-- historical flavor trades below are NOT idempotency-guarded — re-running
-- this script against a database that already has seed trades will insert
-- duplicate trade rows. Run once against a clean database.
--
-- IMPORTANT: the trades inserted below are historical chart flavor only.
-- They do NOT create positions or transactions rows (per spec) — only the
-- trades ledger is backfilled so the price chart has something to render.

-- ---------------------------------------------------------------------------
-- System user (market creator / admin) — id fixed so markets.creator_id and
-- trades.user_id below can reference it directly.
-- The handle_new_user trigger auto-creates a profiles row with a random
-- username derived from the email local-part; we then promote it to admin
-- and rename it. This UPDATE runs with no PostgREST JWT claims (migrations
-- run as the postgres superuser), so protect_profile_columns's "no JWT claim
-- at all" branch allows the is_admin change through.
-- ---------------------------------------------------------------------------
insert into auth.users (
  instance_id, id, aud, role, email, email_confirmed_at, created_at, updated_at
) values (
  '00000000-0000-0000-0000-000000000000',
  '00000000-0000-0000-0000-000000000001',
  'authenticated',
  'authenticated',
  'markets@polyforecast.app',
  now(),
  now(),
  now()
)
on conflict (id) do nothing;

update public.profiles
set is_admin = true,
    username = 'polyforecast'
where id = '00000000-0000-0000-0000-000000000001';

-- ---------------------------------------------------------------------------
-- Markets — 12 markets, 2 per category, pools varied so YES prices range
-- from ~15c to ~85c. price_yes = no_pool / (yes_pool + no_pool).
-- ---------------------------------------------------------------------------
insert into public.markets (
  id, slug, question, description, category, image_url, creator_id,
  yes_pool, no_pool, fee_bps, fee_collected, volume, status, close_time
) values
  -- Politics (price_yes ~16.7%)
  ('00000000-0000-0000-0000-000000000101',
   'us-2026-midterm-senate-gop-majority',
   'Will Republicans retain control of the U.S. Senate after the 2026 midterm elections?',
   'Resolves YES if the Republican Party holds a majority of Senate seats (51+, or 50 with the Vice President as tiebreaker) immediately following the November 3, 2026 midterm elections, based on official certified state results. Resolves NO if Democrats (or an independent coalition caucusing with Democrats) hold the majority instead.',
   'Politics',
   'https://picsum.photos/seed/us-2026-midterm-senate-gop-majority/400/240',
   '00000000-0000-0000-0000-000000000001',
   5000, 1000, 200, 0, 8500, 'open', '2026-11-10 12:00:00+00'),

  -- Politics (price_yes ~84.6%)
  ('00000000-0000-0000-0000-000000000102',
   'uk-snap-election-before-2027',
   'Will the UK hold a snap general election before July 2027?',
   'Resolves YES if a UK general election is officially called by the Prime Minister and held before July 1, 2027, per UK Parliament / Cabinet Office announcement. Resolves NO if no general election takes place in that window.',
   'Politics',
   'https://picsum.photos/seed/uk-snap-election-before-2027/400/240',
   '00000000-0000-0000-0000-000000000001',
   1000, 5500, 200, 0, 250000, 'open', '2027-06-01 12:00:00+00'),

  -- Sports (price_yes ~25%)
  ('00000000-0000-0000-0000-000000000103',
   'nba-finals-2027-lakers-champions',
   'Will the Los Angeles Lakers win the 2027 NBA Finals?',
   'Resolves YES if the Los Angeles Lakers are crowned champions of the 2027 NBA Finals. Resolves NO if any other team wins, or if the 2026-27 season does not conclude with a champion crowned.',
   'Sports',
   'https://picsum.photos/seed/nba-finals-2027-lakers-champions/400/240',
   '00000000-0000-0000-0000-000000000001',
   3000, 1000, 200, 0, 15000, 'open', '2027-06-20 12:00:00+00'),

  -- Sports (price_yes ~75%)
  ('00000000-0000-0000-0000-000000000104',
   'super-bowl-lxi-chiefs-champions',
   'Will the Kansas City Chiefs win Super Bowl LXI?',
   'Resolves YES if the Kansas City Chiefs win Super Bowl LXI, scheduled for February 2027. Resolves NO if any other team wins, or the game is not played as scheduled.',
   'Sports',
   'https://picsum.photos/seed/super-bowl-lxi-chiefs-champions/400/240',
   '00000000-0000-0000-0000-000000000001',
   1000, 3000, 200, 0, 62000, 'open', '2027-02-10 12:00:00+00'),

  -- Crypto (price_yes ~38.5%)
  ('00000000-0000-0000-0000-000000000105',
   'bitcoin-150k-before-june-2027',
   'Will Bitcoin (BTC) trade above $150,000 on a major exchange before June 2027?',
   'Resolves YES if BTC/USD trades above $150,000 on Coinbase or Binance at any point before June 1, 2027, per CoinGecko historical price data. Resolves NO otherwise.',
   'Crypto',
   'https://picsum.photos/seed/bitcoin-150k-before-june-2027/400/240',
   '00000000-0000-0000-0000-000000000001',
   4000, 2500, 200, 0, 120000, 'open', '2027-05-20 12:00:00+00'),

  -- Crypto (price_yes ~61.5%)
  ('00000000-0000-0000-0000-000000000106',
   'ethereum-flips-bitcoin-market-cap',
   'Will Ethereum''s market cap exceed Bitcoin''s market cap before 2027?',
   'Resolves YES if ETH''s total market capitalization exceeds BTC''s total market capitalization at any point before January 1, 2027, per CoinMarketCap data. Resolves NO otherwise.',
   'Crypto',
   'https://picsum.photos/seed/ethereum-flips-bitcoin-market-cap/400/240',
   '00000000-0000-0000-0000-000000000001',
   2500, 4000, 200, 0, 45000, 'open', '2026-12-31 12:00:00+00'),

  -- Science (price_yes ~23.1%)
  ('00000000-0000-0000-0000-000000000107',
   'nasa-artemis-3-moon-landing-before-2027',
   'Will NASA''s Artemis III mission land astronauts on the Moon before June 2027?',
   'Resolves YES if NASA successfully lands crewed astronauts on the lunar surface as part of the Artemis III mission before June 1, 2027, per official NASA mission confirmation. Resolves NO if the mission is delayed past that date or does not achieve a crewed landing.',
   'Science',
   'https://picsum.photos/seed/nasa-artemis-3-moon-landing-before-2027/400/240',
   '00000000-0000-0000-0000-000000000001',
   6000, 1800, 200, 0, 9800, 'open', '2027-05-15 12:00:00+00'),

  -- Science (price_yes ~77.5%)
  ('00000000-0000-0000-0000-000000000108',
   'fda-new-alzheimers-drug-approval-2026',
   'Will the FDA approve a new disease-modifying Alzheimer''s drug by the end of 2026?',
   'Resolves YES if the U.S. FDA grants full or accelerated approval to a new disease-modifying Alzheimer''s treatment (one not already approved as of July 2026) by December 31, 2026, per FDA.gov announcements. Resolves NO otherwise.',
   'Science',
   'https://picsum.photos/seed/fda-new-alzheimers-drug-approval-2026/400/240',
   '00000000-0000-0000-0000-000000000001',
   1800, 6200, 200, 0, 175000, 'open', '2026-11-30 12:00:00+00'),

  -- Pop Culture (price_yes ~30%)
  ('00000000-0000-0000-0000-000000000109',
   'taylor-swift-new-studio-album-2026',
   'Will Taylor Swift release a new studio album in 2026?',
   'Resolves YES if Taylor Swift releases a new full-length studio album (an original release, not a re-recording) between January 1, 2026 and December 31, 2026, per official announcement. Resolves NO otherwise.',
   'Pop Culture',
   'https://picsum.photos/seed/taylor-swift-new-studio-album-2026/400/240',
   '00000000-0000-0000-0000-000000000001',
   3500, 1500, 200, 0, 33000, 'open', '2026-12-15 12:00:00+00'),

  -- Pop Culture (price_yes ~47.6%)
  ('00000000-0000-0000-0000-000000000110',
   'oscars-2027-streaming-only-best-picture',
   'Will a streaming-only release win Best Picture at the 2027 Oscars?',
   'Resolves YES if the Academy Award for Best Picture at the 2027 ceremony is awarded to a film with no wide theatrical release (a streaming-exclusive or festival-only title prior to its streaming debut). Resolves NO otherwise.',
   'Pop Culture',
   'https://picsum.photos/seed/oscars-2027-streaming-only-best-picture/400/240',
   '00000000-0000-0000-0000-000000000001',
   2200, 2000, 200, 0, 71000, 'open', '2027-03-15 12:00:00+00'),

  -- Business (price_yes ~14.75%)
  ('00000000-0000-0000-0000-000000000111',
   'apple-market-cap-below-2-5-trillion-2026',
   'Will Apple''s market cap fall below $2.5 trillion before 2027?',
   'Resolves YES if Apple Inc. (AAPL) market capitalization closes below $2.5 trillion on any trading day before January 1, 2027, per NASDAQ closing price data. Resolves NO otherwise.',
   'Business',
   'https://picsum.photos/seed/apple-market-cap-below-2-5-trillion-2026/400/240',
   '00000000-0000-0000-0000-000000000001',
   5200, 900, 200, 0, 5200, 'open', '2026-10-31 12:00:00+00'),

  -- Business (price_yes ~72%)
  ('00000000-0000-0000-0000-000000000112',
   'openai-ipo-announcement-before-july-2027',
   'Will OpenAI announce plans for an IPO before July 2027?',
   'Resolves YES if OpenAI publicly announces its intent to pursue an initial public offering before July 1, 2027, per an official company statement or SEC filing. Resolves NO otherwise.',
   'Business',
   'https://picsum.photos/seed/openai-ipo-announcement-before-july-2027/400/240',
   '00000000-0000-0000-0000-000000000001',
   1400, 3600, 200, 0, 98000, 'open', '2027-06-30 12:00:00+00')
on conflict (id) do nothing;

-- ---------------------------------------------------------------------------
-- Historical flavor trades — 7 per market, spread over the past ~28 days,
-- price_yes_after wandering toward each market's current (seeded) price so
-- the price chart has a believable line. All trades are attributed to the
-- system user and deliberately do NOT touch positions/transactions.
-- ---------------------------------------------------------------------------
insert into public.trades (market_id, user_id, action, outcome, amount, shares, price, price_yes_after, fee, created_at) values
  -- Market 101 — us-2026-midterm-senate-gop-majority (settles ~0.1667)
  ('00000000-0000-0000-0000-000000000101', '00000000-0000-0000-0000-000000000001', 'buy',  'yes', 120, 450, 0.2667, 0.2667, 2.40, now() - interval '28 days'),
  ('00000000-0000-0000-0000-000000000101', '00000000-0000-0000-0000-000000000001', 'sell', 'no',  85,  94,  0.9033, 0.0967, 1.70, now() - interval '24 days'),
  ('00000000-0000-0000-0000-000000000101', '00000000-0000-0000-0000-000000000001', 'buy',  'yes', 200, 923, 0.2167, 0.2167, 4.00, now() - interval '19 days'),
  ('00000000-0000-0000-0000-000000000101', '00000000-0000-0000-0000-000000000001', 'sell', 'no',  150, 173, 0.8683, 0.1317, 3.00, now() - interval '14 days'),
  ('00000000-0000-0000-0000-000000000101', '00000000-0000-0000-0000-000000000001', 'buy',  'yes', 95,  509, 0.1867, 0.1867, 1.90, now() - interval '9 days'),
  ('00000000-0000-0000-0000-000000000101', '00000000-0000-0000-0000-000000000001', 'sell', 'no',  260, 308, 0.8433, 0.1567, 5.20, now() - interval '5 days'),
  ('00000000-0000-0000-0000-000000000101', '00000000-0000-0000-0000-000000000001', 'buy',  'yes', 140, 840, 0.1667, 0.1667, 2.80, now() - interval '2 days'),

  -- Market 102 — uk-snap-election-before-2027 (settles ~0.8462)
  ('00000000-0000-0000-0000-000000000102', '00000000-0000-0000-0000-000000000001', 'buy',  'yes', 120, 126,  0.9500, 0.9500, 2.40, now() - interval '28 days'),
  ('00000000-0000-0000-0000-000000000102', '00000000-0000-0000-0000-000000000001', 'sell', 'no',  85,  380,  0.2238, 0.7762, 1.70, now() - interval '24 days'),
  ('00000000-0000-0000-0000-000000000102', '00000000-0000-0000-0000-000000000001', 'buy',  'yes', 200, 223,  0.8962, 0.8962, 4.00, now() - interval '19 days'),
  ('00000000-0000-0000-0000-000000000102', '00000000-0000-0000-0000-000000000001', 'sell', 'no',  150, 795,  0.1888, 0.8112, 3.00, now() - interval '14 days'),
  ('00000000-0000-0000-0000-000000000102', '00000000-0000-0000-0000-000000000001', 'buy',  'yes', 95,  110,  0.8662, 0.8662, 1.90, now() - interval '9 days'),
  ('00000000-0000-0000-0000-000000000102', '00000000-0000-0000-0000-000000000001', 'sell', 'no',  260, 1587, 0.1638, 0.8362, 5.20, now() - interval '5 days'),
  ('00000000-0000-0000-0000-000000000102', '00000000-0000-0000-0000-000000000001', 'buy',  'yes', 140, 165,  0.8462, 0.8462, 2.80, now() - interval '2 days'),

  -- Market 103 — nba-finals-2027-lakers-champions (settles ~0.25)
  ('00000000-0000-0000-0000-000000000103', '00000000-0000-0000-0000-000000000001', 'buy',  'yes', 120, 343, 0.3500, 0.3500, 2.40, now() - interval '28 days'),
  ('00000000-0000-0000-0000-000000000103', '00000000-0000-0000-0000-000000000001', 'sell', 'no',  85,  104, 0.8200, 0.1800, 1.70, now() - interval '24 days'),
  ('00000000-0000-0000-0000-000000000103', '00000000-0000-0000-0000-000000000001', 'buy',  'yes', 200, 667, 0.3000, 0.3000, 4.00, now() - interval '19 days'),
  ('00000000-0000-0000-0000-000000000103', '00000000-0000-0000-0000-000000000001', 'sell', 'no',  150, 191, 0.7850, 0.2150, 3.00, now() - interval '14 days'),
  ('00000000-0000-0000-0000-000000000103', '00000000-0000-0000-0000-000000000001', 'buy',  'yes', 95,  352, 0.2700, 0.2700, 1.90, now() - interval '9 days'),
  ('00000000-0000-0000-0000-000000000103', '00000000-0000-0000-0000-000000000001', 'sell', 'no',  260, 342, 0.7600, 0.2400, 5.20, now() - interval '5 days'),
  ('00000000-0000-0000-0000-000000000103', '00000000-0000-0000-0000-000000000001', 'buy',  'yes', 140, 560, 0.2500, 0.2500, 2.80, now() - interval '2 days'),

  -- Market 104 — super-bowl-lxi-chiefs-champions (settles ~0.75)
  ('00000000-0000-0000-0000-000000000104', '00000000-0000-0000-0000-000000000001', 'buy',  'yes', 120, 141,  0.8500, 0.8500, 2.40, now() - interval '28 days'),
  ('00000000-0000-0000-0000-000000000104', '00000000-0000-0000-0000-000000000001', 'sell', 'no',  85,  266,  0.3200, 0.6800, 1.70, now() - interval '24 days'),
  ('00000000-0000-0000-0000-000000000104', '00000000-0000-0000-0000-000000000001', 'buy',  'yes', 200, 250,  0.8000, 0.8000, 4.00, now() - interval '19 days'),
  ('00000000-0000-0000-0000-000000000104', '00000000-0000-0000-0000-000000000001', 'sell', 'no',  150, 526,  0.2850, 0.7150, 3.00, now() - interval '14 days'),
  ('00000000-0000-0000-0000-000000000104', '00000000-0000-0000-0000-000000000001', 'buy',  'yes', 95,  123,  0.7700, 0.7700, 1.90, now() - interval '9 days'),
  ('00000000-0000-0000-0000-000000000104', '00000000-0000-0000-0000-000000000001', 'sell', 'no',  260, 1000, 0.2600, 0.7400, 5.20, now() - interval '5 days'),
  ('00000000-0000-0000-0000-000000000104', '00000000-0000-0000-0000-000000000001', 'buy',  'yes', 140, 187,  0.7500, 0.7500, 2.80, now() - interval '2 days'),

  -- Market 105 — bitcoin-150k-before-june-2027 (settles ~0.3846)
  ('00000000-0000-0000-0000-000000000105', '00000000-0000-0000-0000-000000000001', 'buy',  'yes', 120, 248, 0.4846, 0.4846, 2.40, now() - interval '28 days'),
  ('00000000-0000-0000-0000-000000000105', '00000000-0000-0000-0000-000000000001', 'sell', 'no',  85,  124, 0.6854, 0.3146, 1.70, now() - interval '24 days'),
  ('00000000-0000-0000-0000-000000000105', '00000000-0000-0000-0000-000000000001', 'buy',  'yes', 200, 460, 0.4346, 0.4346, 4.00, now() - interval '19 days'),
  ('00000000-0000-0000-0000-000000000105', '00000000-0000-0000-0000-000000000001', 'sell', 'no',  150, 231, 0.6504, 0.3496, 3.00, now() - interval '14 days'),
  ('00000000-0000-0000-0000-000000000105', '00000000-0000-0000-0000-000000000001', 'buy',  'yes', 95,  235, 0.4046, 0.4046, 1.90, now() - interval '9 days'),
  ('00000000-0000-0000-0000-000000000105', '00000000-0000-0000-0000-000000000001', 'sell', 'no',  260, 416, 0.6254, 0.3746, 5.20, now() - interval '5 days'),
  ('00000000-0000-0000-0000-000000000105', '00000000-0000-0000-0000-000000000001', 'buy',  'yes', 140, 364, 0.3846, 0.3846, 2.80, now() - interval '2 days'),

  -- Market 106 — ethereum-flips-bitcoin-market-cap (settles ~0.6154)
  ('00000000-0000-0000-0000-000000000106', '00000000-0000-0000-0000-000000000001', 'buy',  'yes', 120, 168, 0.7154, 0.7154, 2.40, now() - interval '28 days'),
  ('00000000-0000-0000-0000-000000000106', '00000000-0000-0000-0000-000000000001', 'sell', 'no',  85,  187, 0.4546, 0.5454, 1.70, now() - interval '24 days'),
  ('00000000-0000-0000-0000-000000000106', '00000000-0000-0000-0000-000000000001', 'buy',  'yes', 200, 301, 0.6654, 0.6654, 4.00, now() - interval '19 days'),
  ('00000000-0000-0000-0000-000000000106', '00000000-0000-0000-0000-000000000001', 'sell', 'no',  150, 357, 0.4196, 0.5804, 3.00, now() - interval '14 days'),
  ('00000000-0000-0000-0000-000000000106', '00000000-0000-0000-0000-000000000001', 'buy',  'yes', 95,  150, 0.6354, 0.6354, 1.90, now() - interval '9 days'),
  ('00000000-0000-0000-0000-000000000106', '00000000-0000-0000-0000-000000000001', 'sell', 'no',  260, 659, 0.3946, 0.6054, 5.20, now() - interval '5 days'),
  ('00000000-0000-0000-0000-000000000106', '00000000-0000-0000-0000-000000000001', 'buy',  'yes', 140, 228, 0.6154, 0.6154, 2.80, now() - interval '2 days'),

  -- Market 107 — nasa-artemis-3-moon-landing-before-2027 (settles ~0.2308)
  ('00000000-0000-0000-0000-000000000107', '00000000-0000-0000-0000-000000000001', 'buy',  'yes', 120, 363, 0.3308, 0.3308, 2.40, now() - interval '28 days'),
  ('00000000-0000-0000-0000-000000000107', '00000000-0000-0000-0000-000000000001', 'sell', 'no',  85,  101, 0.8392, 0.1608, 1.70, now() - interval '24 days'),
  ('00000000-0000-0000-0000-000000000107', '00000000-0000-0000-0000-000000000001', 'buy',  'yes', 200, 712, 0.2808, 0.2808, 4.00, now() - interval '19 days'),
  ('00000000-0000-0000-0000-000000000107', '00000000-0000-0000-0000-000000000001', 'sell', 'no',  150, 187, 0.8042, 0.1958, 3.00, now() - interval '14 days'),
  ('00000000-0000-0000-0000-000000000107', '00000000-0000-0000-0000-000000000001', 'buy',  'yes', 95,  379, 0.2508, 0.2508, 1.90, now() - interval '9 days'),
  ('00000000-0000-0000-0000-000000000107', '00000000-0000-0000-0000-000000000001', 'sell', 'no',  260, 334, 0.7792, 0.2208, 5.20, now() - interval '5 days'),
  ('00000000-0000-0000-0000-000000000107', '00000000-0000-0000-0000-000000000001', 'buy',  'yes', 140, 607, 0.2308, 0.2308, 2.80, now() - interval '2 days'),

  -- Market 108 — fda-new-alzheimers-drug-approval-2026 (settles ~0.775)
  ('00000000-0000-0000-0000-000000000108', '00000000-0000-0000-0000-000000000001', 'buy',  'yes', 120, 137,  0.8750, 0.8750, 2.40, now() - interval '28 days'),
  ('00000000-0000-0000-0000-000000000108', '00000000-0000-0000-0000-000000000001', 'sell', 'no',  85,  288,  0.2950, 0.7050, 1.70, now() - interval '24 days'),
  ('00000000-0000-0000-0000-000000000108', '00000000-0000-0000-0000-000000000001', 'buy',  'yes', 200, 242,  0.8250, 0.8250, 4.00, now() - interval '19 days'),
  ('00000000-0000-0000-0000-000000000108', '00000000-0000-0000-0000-000000000001', 'sell', 'no',  150, 577,  0.2600, 0.7400, 3.00, now() - interval '14 days'),
  ('00000000-0000-0000-0000-000000000108', '00000000-0000-0000-0000-000000000001', 'buy',  'yes', 95,  120,  0.7950, 0.7950, 1.90, now() - interval '9 days'),
  ('00000000-0000-0000-0000-000000000108', '00000000-0000-0000-0000-000000000001', 'sell', 'no',  260, 1106, 0.2350, 0.7650, 5.20, now() - interval '5 days'),
  ('00000000-0000-0000-0000-000000000108', '00000000-0000-0000-0000-000000000001', 'buy',  'yes', 140, 181,  0.7750, 0.7750, 2.80, now() - interval '2 days'),

  -- Market 109 — taylor-swift-new-studio-album-2026 (settles ~0.30)
  ('00000000-0000-0000-0000-000000000109', '00000000-0000-0000-0000-000000000001', 'buy',  'yes', 120, 300, 0.4000, 0.4000, 2.40, now() - interval '28 days'),
  ('00000000-0000-0000-0000-000000000109', '00000000-0000-0000-0000-000000000001', 'sell', 'no',  85,  110, 0.7700, 0.2300, 1.70, now() - interval '24 days'),
  ('00000000-0000-0000-0000-000000000109', '00000000-0000-0000-0000-000000000001', 'buy',  'yes', 200, 571, 0.3500, 0.3500, 4.00, now() - interval '19 days'),
  ('00000000-0000-0000-0000-000000000109', '00000000-0000-0000-0000-000000000001', 'sell', 'no',  150, 204, 0.7350, 0.2650, 3.00, now() - interval '14 days'),
  ('00000000-0000-0000-0000-000000000109', '00000000-0000-0000-0000-000000000001', 'buy',  'yes', 95,  297, 0.3200, 0.3200, 1.90, now() - interval '9 days'),
  ('00000000-0000-0000-0000-000000000109', '00000000-0000-0000-0000-000000000001', 'sell', 'no',  260, 366, 0.7100, 0.2900, 5.20, now() - interval '5 days'),
  ('00000000-0000-0000-0000-000000000109', '00000000-0000-0000-0000-000000000001', 'buy',  'yes', 140, 467, 0.3000, 0.3000, 2.80, now() - interval '2 days'),

  -- Market 110 — oscars-2027-streaming-only-best-picture (settles ~0.4762)
  ('00000000-0000-0000-0000-000000000110', '00000000-0000-0000-0000-000000000001', 'buy',  'yes', 120, 208, 0.5762, 0.5762, 2.40, now() - interval '28 days'),
  ('00000000-0000-0000-0000-000000000110', '00000000-0000-0000-0000-000000000001', 'sell', 'no',  85,  143, 0.5938, 0.4062, 1.70, now() - interval '24 days'),
  ('00000000-0000-0000-0000-000000000110', '00000000-0000-0000-0000-000000000001', 'buy',  'yes', 200, 380, 0.5262, 0.5262, 4.00, now() - interval '19 days'),
  ('00000000-0000-0000-0000-000000000110', '00000000-0000-0000-0000-000000000001', 'sell', 'no',  150, 268, 0.5588, 0.4412, 3.00, now() - interval '14 days'),
  ('00000000-0000-0000-0000-000000000110', '00000000-0000-0000-0000-000000000001', 'buy',  'yes', 95,  191, 0.4962, 0.4962, 1.90, now() - interval '9 days'),
  ('00000000-0000-0000-0000-000000000110', '00000000-0000-0000-0000-000000000001', 'sell', 'no',  260, 487, 0.5338, 0.4662, 5.20, now() - interval '5 days'),
  ('00000000-0000-0000-0000-000000000110', '00000000-0000-0000-0000-000000000001', 'buy',  'yes', 140, 294, 0.4762, 0.4762, 2.80, now() - interval '2 days'),

  -- Market 111 — apple-market-cap-below-2-5-trillion-2026 (settles ~0.1475)
  ('00000000-0000-0000-0000-000000000111', '00000000-0000-0000-0000-000000000001', 'buy',  'yes', 120, 485,  0.2475, 0.2475, 2.40, now() - interval '28 days'),
  ('00000000-0000-0000-0000-000000000111', '00000000-0000-0000-0000-000000000001', 'sell', 'no',  85,  92,   0.9225, 0.0775, 1.70, now() - interval '24 days'),
  ('00000000-0000-0000-0000-000000000111', '00000000-0000-0000-0000-000000000001', 'buy',  'yes', 200, 1013, 0.1975, 0.1975, 4.00, now() - interval '19 days'),
  ('00000000-0000-0000-0000-000000000111', '00000000-0000-0000-0000-000000000001', 'sell', 'no',  150, 169,  0.8875, 0.1125, 3.00, now() - interval '14 days'),
  ('00000000-0000-0000-0000-000000000111', '00000000-0000-0000-0000-000000000001', 'buy',  'yes', 95,  567,  0.1675, 0.1675, 1.90, now() - interval '9 days'),
  ('00000000-0000-0000-0000-000000000111', '00000000-0000-0000-0000-000000000001', 'sell', 'no',  260, 301,  0.8625, 0.1375, 5.20, now() - interval '5 days'),
  ('00000000-0000-0000-0000-000000000111', '00000000-0000-0000-0000-000000000001', 'buy',  'yes', 140, 949,  0.1475, 0.1475, 2.80, now() - interval '2 days'),

  -- Market 112 — openai-ipo-announcement-before-july-2027 (settles ~0.72)
  ('00000000-0000-0000-0000-000000000112', '00000000-0000-0000-0000-000000000001', 'buy',  'yes', 120, 146, 0.8200, 0.8200, 2.40, now() - interval '28 days'),
  ('00000000-0000-0000-0000-000000000112', '00000000-0000-0000-0000-000000000001', 'sell', 'no',  85,  243, 0.3500, 0.6500, 1.70, now() - interval '24 days'),
  ('00000000-0000-0000-0000-000000000112', '00000000-0000-0000-0000-000000000001', 'buy',  'yes', 200, 260, 0.7700, 0.7700, 4.00, now() - interval '19 days'),
  ('00000000-0000-0000-0000-000000000112', '00000000-0000-0000-0000-000000000001', 'sell', 'no',  150, 476, 0.3150, 0.6850, 3.00, now() - interval '14 days'),
  ('00000000-0000-0000-0000-000000000112', '00000000-0000-0000-0000-000000000001', 'buy',  'yes', 95,  128, 0.7400, 0.7400, 1.90, now() - interval '9 days'),
  ('00000000-0000-0000-0000-000000000112', '00000000-0000-0000-0000-000000000001', 'sell', 'no',  260, 897, 0.2900, 0.7100, 5.20, now() - interval '5 days'),
  ('00000000-0000-0000-0000-000000000112', '00000000-0000-0000-0000-000000000001', 'buy',  'yes', 140, 194, 0.7200, 0.7200, 2.80, now() - interval '2 days');
