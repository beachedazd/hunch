# hunch — got a hunch? put it on the line.

A full-stack prediction-market app (Polymarket-style) with crypto backing.

- **Frontend**: Vite + React 18 + TypeScript + Tailwind, deployed on Netlify — https://hunch-markets.netlify.app
- **Backend**: Supabase Postgres — all trading runs through atomic `SECURITY DEFINER` RPCs implementing a CPMM (constant-product) automated market maker
- **Crypto**: MetaMask wallet connect + Sepolia testnet ETH deposits, verified on-chain by a Netlify Function (`/api/verify-deposit`) and credited at a demo rate of 1 ETH = 3,000 USDC
- Play-money faucet ($1,000 / 24h), market creation, admin resolution, redemption, portfolio P&L, leaderboard, comments

## Structure
- `src/` — app (pages, components, hooks, CPMM quote math in `src/lib/cpmm.ts`)
- `supabase/migrations/` — schema, RLS, trading-engine functions; `supabase/seed.sql` — 12 seed markets
- `netlify/functions/verify-deposit.mts` — on-chain deposit verification
- `ARCHITECTURE.md` — design + engineering spec

## Local dev
```
npm install
cp .env.example .env   # fill in Supabase URL/anon key etc.
npm run dev
```
