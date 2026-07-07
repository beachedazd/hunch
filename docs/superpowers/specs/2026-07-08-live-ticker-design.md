# Live ticker tape — design

**Date:** 2026-07-08 · **Status:** implemented (autonomous session — decisions made with sensible defaults)

## Goal

A stock-exchange-style live ticker strip showing market prices across the whole site,
giving hunch a "live trading floor" feel.

## Design

- **Component:** `src/components/TickerTape.tsx`, rendered globally in `App.tsx`
  directly below the sticky `<Header />` (normal flow, scrolls away with the page).
- **Content:** top 20 *open* markets by volume (reuses `listMarkets()`, already
  volume-sorted). Each item: truncated question · live Yes price in ¢ · 24h delta
  (▲ green / ▼ red, in cents; hidden when flat). Items link to `/market/:slug`.
- **Liveness:** React Query polling — markets every 15s, deltas every 60s. A pulsing
  teal "LIVE" pill anchors the left edge.
- **24h delta:** one public query over `trades` for the last 48h
  (`getTicker24hBaselines` in `lib/api.ts`). Baseline per market = `price_yes_after`
  of the last trade *before* the 24h cutoff; falls back to the first in-window trade
  for markets with no older trade (slightly conservative, acceptable for a ticker).
- **Marquee:** CSS-only — track holds two copies of the item row, `translateX(0 → -50%)`
  keyframes, duration scaled to item count (~6s per item) so speed is constant.
  Pauses on hover. `prefers-reduced-motion`: animation off, strip becomes
  horizontally scrollable.
- **Hide rule:** renders nothing while loading or when fewer than 3 open markets
  (a sparse marquee looks broken).

## Alternatives considered

- **Supabase realtime subscription** on `trades`/`markets` — true push, but realtime
  publication isn't enabled for these tables and polling at 15s is indistinguishable
  for a play-money site. Rejected for now.
- **Per-market baseline queries** — N queries; rejected in favor of one 48h window query.
- **Sticky ticker** — steals vertical space on mobile under the sticky header; rejected.
