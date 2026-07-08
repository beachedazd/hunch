# Live Bet Activity — Popups + Comment Stamps

**Date:** 2026-07-08
**Status:** Approved design

## Goal

Make the app feel *alive* when trading happens:

1. **Live popups** — a site-wide toast fires whenever anyone places a bet, showing who bet
   how much on which market. Reinforces that the platform is active.
2. **Comment stamps** — every bet is stamped into the corresponding market's comment thread
   as a visually distinct entry (not confused with human comments).

Both are driven from a single denormalized source so there is no realtime-payload enrichment
and no schema change to `comments`.

## Architecture

### Single source of truth: `public.bet_activity`

A new, denormalized, append-only table. One row is written per bet inside the trading RPCs.
Denormalized on purpose: the Supabase realtime `postgres_changes` payload only carries the
inserted row's own columns (no joins), so every field the UI needs is stored on the row.

Columns:

| column        | type            | notes                                        |
|---------------|-----------------|----------------------------------------------|
| `id`          | uuid pk         | `gen_random_uuid()`                          |
| `market_id`   | uuid            | FK → markets (on delete cascade)             |
| `market_slug` | text            | denormalized, for click-through link         |
| `market_title`| text            | denormalized, for popup text                 |
| `user_id`     | uuid            | FK → profiles (on delete cascade)            |
| `username`    | text            | denormalized author name (nullable)          |
| `action`      | text            | `'buy'` | `'sell'`                            |
| `outcome`     | text            | `'yes'` | `'no'` — drives accent color        |
| `amount`      | numeric(18,6)   | USDC notional (buy) / proceeds (sell)        |
| `shares`      | numeric(18,6)   | shares bought/sold                           |
| `price`       | numeric(18,6)   | executed price                               |
| `created_at`  | timestamptz     | `default now()`                              |

Index: `(market_id, created_at)` for the per-market thread query.

### Write path: `stamp_bet_activity` helper

A `SECURITY DEFINER` helper `public.stamp_bet_activity(p_market_id, p_user_id, p_action,
p_outcome, p_amount, p_shares, p_price)` that:

- looks up `market.slug`, `market.title`, `profile.username`,
- inserts one `bet_activity` row.

Called from **both** `buy_shares` and `sell_shares`, right after their existing
`insert into public.trades ...`. Keeps formatting/lookup in one place; buy passes
`p_amount = amount` and sell passes `p_amount = proceeds`.

Writes remain RPC-only — no direct INSERT is granted, matching how `trades` already works.

### RLS + realtime

- `alter table public.bet_activity enable row level security;`
- `create policy bet_activity_select_all ... using (true);` (anon + authenticated can read).
- `grant select on public.bet_activity to anon, authenticated;`
- `alter publication supabase_realtime add table public.bet_activity;`

## Frontend

### API (`src/lib/api.ts`)

- `getBetActivity(marketId): Promise<BetActivity[]>` — recent rows for a market, newest first.
- `subscribeToBetActivity(onInsert: (a: BetActivity) => void): () => void` — opens a
  `supabase.channel` on `postgres_changes` INSERT for `bet_activity`; returns an unsubscribe fn.
- `BetActivity` type added to `src/types.ts`.

### Popups — extend `useToast`

The existing `ToastProvider` (`src/hooks/useToast.tsx`) renders a bottom-right stack of plain
string toasts. Extend it minimally, backward-compatibly:

- `showToast` gains an options object: `{ accent?: 'yes' | 'no'; href?: string }`.
- Toast renders an optional left accent bar (green for `yes`, red for `no`) and, when `href`
  is set, wraps the toast so a click navigates to the market.
- Cap the on-screen stack (drop oldest beyond ~3) so a burst doesn't flood the screen.

A `BetActivityListener` component is mounted once inside `App` (below the providers). It calls
`subscribeToBetActivity` and, per event:

- **skips events from the current user** (they already get a trade confirmation), and
- calls `showToast(\`\${username} \${action} $\${amount} \${OUTCOME} · \${market_title}\`,
  { kind: 'info', accent: outcome, href: \`/market/\${slug}\` })`.

### Comment thread — merge stamps in (`src/pages/MarketDetail.tsx`)

- Add a `bet_activity` query for the market (keyed `['bet-activity', marketId]`).
- Merge the human `comments` and the `bet_activity` rows into a single time-sorted list.
- Real comments render as today. Trade stamps render as a distinct pill/badge row:
  colored by outcome, e.g. `🟢 aztec bought 42.0 YES @ 55¢ ($23.10)` — no author bubble,
  clearly a system line.
- The comment count badge continues to count human comments only.

The `comments` table is **not** modified.

## Non-goals (YAGNI)

- No separate "Activity" tab/page — stamps merge into the existing comment thread.
- No editing/deleting of stamps.
- No aggregation/dedup of rapid bets — one row per bet.
- No historical backfill of activity for bets placed before this ships.

## Verification

Realtime + stamping require the migration applied to the live Supabase project:

1. Apply the migration (Supabase MCP / CLI).
2. Run the app, place a bet as user A.
3. Confirm: (a) an outcome-colored popup appears (in a second session / as user B), and
   (b) a distinct stamp row appears in that market's comment thread, time-ordered with any
   real comments.
4. Confirm your *own* bet does **not** produce a duplicate "someone bet" popup.
