-- PolyForecast: Row Level Security
-- RLS is enabled on every table. RPCs are SECURITY DEFINER and run as the
-- function owner, which bypasses RLS, so no INSERT/UPDATE/DELETE policies are
-- defined for markets/trades/positions/transactions/deposits — all writes to
-- those tables happen exclusively through the RPCs in functions.sql.

alter table public.profiles enable row level security;
alter table public.markets enable row level security;
alter table public.positions enable row level security;
alter table public.trades enable row level security;
alter table public.transactions enable row level security;
alter table public.deposits enable row level security;
alter table public.comments enable row level security;

-- ---------------------------------------------------------------------------
-- profiles: SELECT for everyone, UPDATE own row only.
-- (balance / is_admin / last_faucet_at are further guarded by the
-- protect_profile_columns trigger from schema.sql, since RLS policies can't
-- restrict individual columns.)
-- ---------------------------------------------------------------------------
create policy profiles_select_all
  on public.profiles for select
  using (true);

create policy profiles_update_own
  on public.profiles for update
  using (id = auth.uid())
  with check (id = auth.uid());

-- ---------------------------------------------------------------------------
-- markets: SELECT for everyone (incl. anon). No direct writes.
-- ---------------------------------------------------------------------------
create policy markets_select_all
  on public.markets for select
  using (true);

-- ---------------------------------------------------------------------------
-- trades: SELECT for everyone (incl. anon). No direct writes.
-- ---------------------------------------------------------------------------
create policy trades_select_all
  on public.trades for select
  using (true);

-- ---------------------------------------------------------------------------
-- comments: SELECT for everyone, INSERT own only. No update/delete policies
-- (spec is silent on editing/deleting comments, so conservatively omitted).
-- ---------------------------------------------------------------------------
create policy comments_select_all
  on public.comments for select
  using (true);

create policy comments_insert_own
  on public.comments for insert
  with check (user_id = auth.uid());

-- ---------------------------------------------------------------------------
-- positions: SELECT own only. No direct writes.
-- ---------------------------------------------------------------------------
create policy positions_select_own
  on public.positions for select
  using (user_id = auth.uid());

-- ---------------------------------------------------------------------------
-- transactions: SELECT own only. No direct writes.
-- ---------------------------------------------------------------------------
create policy transactions_select_own
  on public.transactions for select
  using (user_id = auth.uid());

-- ---------------------------------------------------------------------------
-- deposits: SELECT own only. No direct writes (credit_deposit is
-- service_role-only and bypasses RLS as definer).
-- ---------------------------------------------------------------------------
create policy deposits_select_own
  on public.deposits for select
  using (user_id = auth.uid());

-- ---------------------------------------------------------------------------
-- Table-level grants.
--
-- The spec (RLS section) only specifies policies, not table-level GRANTs.
-- Supabase-provisioned projects normally carry baseline SELECT/INSERT/UPDATE/
-- DELETE default privileges for anon/authenticated on public schema tables,
-- so this block is technically redundant on this project — but conservatively
-- made explicit here so these migrations are self-contained and don't rely on
-- privileges configured outside of version control. RLS policies above are
-- what actually restrict access; these grants only lift Postgres's table-
-- level permission floor to what RLS is designed to allow.
-- ---------------------------------------------------------------------------
grant usage on schema public to anon, authenticated;

grant select on public.markets to anon, authenticated;
grant select on public.trades to anon, authenticated;
grant select on public.comments to anon, authenticated;
grant insert on public.comments to authenticated;
grant select on public.profiles to anon, authenticated;
grant update on public.profiles to authenticated;
grant select on public.positions to authenticated;
grant select on public.transactions to authenticated;
grant select on public.deposits to authenticated;
