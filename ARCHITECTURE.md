# Hunch — Polymarket Clone: Architecture

> **NAMING + DESIGN UPDATE (2026-07-07):** the product is called **Hunch** (lowercase
> "hunch" wordmark). The UI follows the design handoff (light theme, teal `#0fa3b1`,
> Outfit font) — NOT the dark palette in the "Pages / UI" section below, which is
> superseded. Design source of truth: the handoff HTML at
> `scratchpad/design/polymarket-clone-website-design/project/Prediction Market Stills.dc.html`.

A prediction-market web app: browse markets, buy/sell YES/NO shares priced by an
automated market maker, back your account with crypto (MetaMask + Sepolia testnet
deposits), track your portfolio. Frontend on Netlify, backend on Supabase.

## Stack

- **Frontend**: Vite + React 18 + TypeScript, Tailwind CSS, React Router v6,
  TanStack Query v5, Recharts, ethers v6, `@supabase/supabase-js` v2.
- **Backend**: Supabase Postgres. All trading logic lives in `SECURITY DEFINER`
  SQL functions (RPCs). RLS on everything.
- **Serverless**: Netlify Functions (TypeScript) for on-chain deposit verification and
  Polymarket sync (hourly cron + on-demand admin trigger).
- **Layout**: single repo — `src/` (app), `netlify/functions/`, `supabase/migrations/`.

## Trading engine — CPMM (constant-product market maker)

Binary markets (YES/NO), USDC-denominated (play-money ledger, `numeric(18,6)`).

- Market holds share reserves `yes_pool`, `no_pool`. Invariant `k = yes_pool * no_pool`.
- **Price**: `price_yes = no_pool / (yes_pool + no_pool)`; `price_no = 1 - price_yes`.
- **Buy YES with amount `a`** (after fee): mint `a` of each share, swap NO→YES:
  `shares_out = yes_pool + a - (yes_pool * no_pool) / (no_pool + a)`.
  New pools: `yes_pool' = yes_pool + a - shares_out`, `no_pool' = no_pool + a`. Symmetric for NO.
- **Sell `s` YES shares**: solve for USDC `x` returned such that invariant holds after
  burning: `x` satisfies `(yes_pool + s - x) * (no_pool - x) = k` → take the root
  `x = ((yes_pool + no_pool + s) - sqrt((yes_pool + no_pool + s)^2 - 4*s*no_pool)) / 2`
  guarded to `0 < x < no_pool`. Fee applied on proceeds.
- **Fee**: `fee_bps` (default 200 = 2%) added to market `fee_collected`.
- **Resolution**: admin resolves YES/NO/VOID. Winning shares redeem at 1 USDC;
  VOID refunds at last traded price... (keep simple: VOID redeems both sides at 0.5).
- Initial liquidity: market created with `seed` USDC → `yes_pool = no_pool = seed`.

## Schema (tables — all in `public`)

- `profiles` — `id uuid PK → auth.users`, `username text unique`, `wallet_address text`,
  `balance numeric(18,6) default 0`, `is_admin bool default false`, `last_faucet_at timestamptz`, `created_at`.
  Auto-created by trigger on `auth.users` insert.
- `markets` — `id uuid`, `slug text unique`, `question text`, `description text`,
  `category text`, `image_url text`, `creator_id uuid`, `yes_pool numeric`, `no_pool numeric`,
  `fee_bps int default 200`, `fee_collected numeric default 0`, `volume numeric default 0`,
  `status text check in ('open','resolved','void')`, `resolution text null check in ('yes','no')`,
  `close_time timestamptz`, `resolved_at timestamptz`, `created_at`,
  `source text default 'user' check in ('user','polymarket')`, `polymarket_id text null`.
- `positions` — PK `(user_id, market_id)`, `yes_shares numeric default 0`, `no_shares numeric default 0`, `updated_at`.
- `trades` — `id`, `market_id`, `user_id`, `action text ('buy','sell')`, `outcome text ('yes','no')`,
  `amount numeric` (USDC in/out), `shares numeric`, `price numeric` (avg execution price),
  `price_yes_after numeric` (for charts), `fee numeric`, `created_at`.
- `transactions` — ledger: `id`, `user_id`, `type text ('faucet','deposit','buy','sell','redeem')`,
  `amount numeric` (signed), `market_id uuid null`, `ref text null` (tx hash etc), `created_at`.
- `deposits` — `id`, `user_id`, `tx_hash text unique`, `amount_eth numeric`, `amount_usdc numeric`,
  `status text ('confirmed','rejected')`, `created_at`.
- `comments` — `id`, `market_id`, `user_id`, `body text`, `created_at`.

## RPCs (SECURITY DEFINER, `auth.uid()` inside; GRANT EXECUTE to authenticated)

- `buy_shares(p_market_id uuid, p_outcome text, p_amount numeric)` → json {shares, price, new_price_yes}
- `sell_shares(p_market_id uuid, p_outcome text, p_shares numeric)` → json {proceeds, price, new_price_yes}
- `claim_faucet()` → credits 1000 USDC, max once per 24h
- `create_market(question, description, category, image_url, close_time, seed)` → uuid (any authed user; seed deducted from balance, min 100)
- `resolve_market(p_market_id, p_resolution)` — admin only ('yes'|'no'|'void')
- `redeem_winnings(p_market_id)` → pays out winning shares, zeroes position
- `credit_deposit(p_user_id, p_tx_hash, p_amount_eth, p_amount_usdc)` — **service_role only** (revoke from authenticated), idempotent on tx_hash
- `sync_import_polymarket_market(...)` — **service_role only**, upserts a mirrored market (`source='polymarket'`) keyed on `polymarket_id`
- `sync_resolve_market(p_polymarket_id, p_resolution)` — **service_role only**, resolves a mirrored market ('yes'|'no'|'void') by `polymarket_id`

All RPCs: row-lock market and profile (`FOR UPDATE`), validate balance/shares/status/close_time, write trades + transactions + positions atomically.

## RLS

- `markets`, `trades`, `comments`: SELECT for everyone (incl. anon). No direct INSERT/UPDATE/DELETE (comments: INSERT own).
- `profiles`: SELECT all (public leaderboard-ish), UPDATE own (username, wallet_address only — via column check trigger or separate RPC; simplest: allow update own row, balance guarded because updates go through RPCs — NO: balance must not be user-writable. Use a trigger rejecting balance/is_admin/last_faucet_at changes by non-service role).
- `positions`, `transactions`, `deposits`: SELECT own only.

## Live auto-resolving crypto markets

Short-horizon "Bitcoin/Ethereum Up or Down" markets on rolling 5/10/30-minute
windows — created and resolved entirely by the database, no admin action.
Migration: `supabase/migrations/20260708000010_live_crypto_markets.sql`.

- `markets` gains `auto_series` (`btc-5m`|`btc-10m`|`btc-30m`|`eth-5m`|`eth-10m`|`eth-30m`, null for normal markets), `strike_price`, `resolution_price`.
- `fetch_crypto_price(asset)` — Coinbase spot primary, Binance fallback, via the
  `http` extension (5s curl timeout). `tick_auto_markets()` — advisory-locked,
  scheduled by **pg_cron every 15s**. Each tick: fetches each needed asset price
  at most once (zero HTTP when nothing is due), resolves due windows
  (close price **strictly above** strike ⇒ YES/Up; ties/below ⇒ NO/Down),
  instantly settles winners (credits balance + zeroes shares, no user redeem),
  and seeds the next epoch-aligned window per series (yes_pool=no_pool=500, paid
  from the system profile `00000000-…-000000000001`, topped up +10M by the migration).
- Frontend: `src/lib/live.ts` (`parseAutoSeries`, `useCountdown`, `useSpotPrice`),
  Live rail on Home, Up/Down trade labels, strike-vs-live-spot strip on detail.
  Home grid excludes auto markets (`listMarkets(..., { excludeAuto: true })`).

## Crypto backing

- MetaMask connect (ethers v6 BrowserProvider); store address on profile.
- Deposit: user sends Sepolia ETH to house address `VITE_HOUSE_ADDRESS`; app submits tx hash
  to Netlify function `verify-deposit` which checks via `SEPOLIA_RPC_URL`
  (to: house address, status success, ≥1 confirmation), converts at **1 ETH = 3000 USDC**,
  calls `credit_deposit` with service role. Chain: Sepolia (chainId 11155111).
- Faucet button for demo play money (no wallet needed).

## Env vars

Frontend (Vite): `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`, `VITE_HOUSE_ADDRESS`, `VITE_CHAIN_ID=11155111`
Functions: `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `SEPOLIA_RPC_URL`, `HOUSE_ADDRESS`, `POLYMARKET_SYNC_SECRET`

## Polymarket sync

Markets can be mirrored from the real Polymarket instead of user-created. `markets.source`
('user' | 'polymarket', default 'user') flags these; `markets.polymarket_id` stores the
upstream market id and is the upsert key.

- **Import**: `sync_import_polymarket_market` (service-role RPC) upserts a mirrored market
  from Polymarket's Gamma API data (question, category, image, `price_yes` seeding the pools).
  The sync tops each category up to a steady-state target of open mirrored markets
  (`TARGET_OPEN_PER_CATEGORY`, default 4) rather than importing a fresh batch each run, so the
  hourly cron converges; freed budget from resolved markets backfills over time.
- **Resolve**: `sync_resolve_market` (service-role RPC) resolves a mirrored market once the
  real one settles. Mapping from Gamma's market fields: `umaResolutionStatus === 'resolved'`
  and `closed === true` → outcome from `outcomePrices`: `[1, 0]` → yes, `[0, 1]` → no, anything
  else → void.
- **Netlify functions**:
  - Hourly cron function runs the full sync (import new + resolve settled) using the service
    role directly — no auth needed, triggered by Netlify's scheduled functions.
  - `POST /api/polymarket-sync` runs the same sync on demand. Auth: either header
    `x-sync-key: <POLYMARKET_SYNC_SECRET>` (for external/cron callers) or
    `Authorization: Bearer <supabase access token>` for a signed-in user whose
    `profiles.is_admin` is true (used by the Admin page's "Sync Polymarket" button).
    Responds 200 with `{ imported, resolved, skipped, errors }`, 401 if unauthorized, 500
    `{ error }` on failure.

## Pages / UI (dark theme, Polymarket-inspired)

Colors: bg `#0E1420`, surface `#1A2332`, border `#2C3A4F`, text `#E6EDF7`/`#8FA3BF`,
primary blue `#2D6BFF`, YES green `#27AE60`, NO red `#E64800`-ish red `#DE4A4A`. Font: Inter.

- **Header**: logo "PolyForecast", search, category pills (Politics, Sports, Crypto, Science, Pop Culture, Business), balance chip, wallet/auth buttons.
- **Home `/`**: featured market hero + responsive grid of market cards (image, question, YES¢/NO¢ buttons, volume, close date).
- **Market `/market/:slug`**: price chart (from `trades.price_yes_after` over time), Buy/Sell tab widget (outcome toggle, amount input, quote: shares, avg price, potential payout, fee), your position, market rules/description, comments.
- **Portfolio `/portfolio`**: balance, positions table (market, side, shares, avg cost→current value, P&L, redeem button when resolved), transaction history.
- **Create `/create`**: create-market form.
- **Admin `/admin`**: resolve markets (visible only to `is_admin`).
- Auth modal: email+password sign up / sign in. Wallet modal: connect, deposit ETH, faucet.

## Supabase project (already provisioned)

- ref: `nhxjpczaeouoxbqlaexf`, URL: `https://nhxjpczaeouoxbqlaexf.supabase.co`
- anon key: `eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im5oeGpwY3phZW91b3hicWxhZXhmIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODM0MDI2MDYsImV4cCI6MjA5ODk3ODYwNn0.2ZPg2QEYRdaJDUna8zpe3GnU6t30P-w2jxqLlgZsd7Q`

## Conventions

- TypeScript strict. Prettier defaults. No class components. TanStack Query for all server state.
- `src/types.ts` — shared domain types matching schema exactly (Market, Trade, Position, Profile, Transaction, Comment).
- `src/lib/supabase.ts` — client singleton. `src/lib/api.ts` — all data access (query fns + RPC wrappers).
- Prices displayed as cents (e.g. 62¢) and percent; USDC amounts with `$`.
- Seed data: 12 realistic markets across categories with staggered pools so prices vary.
