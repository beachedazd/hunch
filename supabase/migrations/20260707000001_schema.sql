-- PolyForecast: core schema
-- Tables, indexes, and the profile-provisioning / balance-guard triggers.
-- See ARCHITECTURE.md for the source-of-truth spec this migration implements.

-- ---------------------------------------------------------------------------
-- profiles
-- ---------------------------------------------------------------------------
create table public.profiles (
  id              uuid primary key references auth.users (id) on delete cascade,
  username        text not null unique,
  wallet_address  text,
  balance         numeric(18, 6) not null default 0,
  is_admin        boolean not null default false,
  last_faucet_at  timestamptz,
  created_at      timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- markets
-- ---------------------------------------------------------------------------
create table public.markets (
  id             uuid primary key default gen_random_uuid(),
  slug           text not null unique,
  question       text not null,
  description    text,
  category       text not null,
  image_url      text,
  creator_id     uuid references public.profiles (id),
  yes_pool       numeric(18, 6) not null,
  no_pool        numeric(18, 6) not null,
  fee_bps        integer not null default 200,
  fee_collected  numeric(18, 6) not null default 0,
  volume         numeric(18, 6) not null default 0,
  status         text not null default 'open' check (status in ('open', 'resolved', 'void')),
  resolution     text check (resolution in ('yes', 'no')),
  close_time     timestamptz not null,
  resolved_at    timestamptz,
  created_at     timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- positions
-- ---------------------------------------------------------------------------
create table public.positions (
  user_id     uuid not null references public.profiles (id) on delete cascade,
  market_id   uuid not null references public.markets (id) on delete cascade,
  yes_shares  numeric(18, 6) not null default 0,
  no_shares   numeric(18, 6) not null default 0,
  updated_at  timestamptz not null default now(),
  primary key (user_id, market_id)
);

-- ---------------------------------------------------------------------------
-- trades
-- ---------------------------------------------------------------------------
create table public.trades (
  id                uuid primary key default gen_random_uuid(),
  market_id         uuid not null references public.markets (id) on delete cascade,
  user_id           uuid not null references public.profiles (id),
  action            text not null check (action in ('buy', 'sell')),
  outcome           text not null check (outcome in ('yes', 'no')),
  amount            numeric(18, 6) not null,
  shares            numeric(18, 6) not null,
  price             numeric(18, 6) not null,
  price_yes_after   numeric(18, 6) not null,
  fee               numeric(18, 6) not null default 0,
  created_at        timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- transactions (ledger)
-- ---------------------------------------------------------------------------
create table public.transactions (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references public.profiles (id) on delete cascade,
  -- 'seed' added to support create_market's deduction of seed liquidity from
  -- the creator's balance (the doc's RPC section requires a ledger entry for
  -- this that isn't 'buy'/'sell'; see functions.sql create_market).
  type        text not null check (type in ('faucet', 'deposit', 'buy', 'sell', 'redeem', 'seed')),
  amount      numeric(18, 6) not null,
  market_id   uuid references public.markets (id),
  ref         text,
  created_at  timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- deposits
-- ---------------------------------------------------------------------------
create table public.deposits (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references public.profiles (id) on delete cascade,
  tx_hash       text not null unique,
  amount_eth    numeric(18, 6) not null,
  amount_usdc   numeric(18, 6) not null,
  status        text not null default 'confirmed' check (status in ('confirmed', 'rejected')),
  created_at    timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- comments
-- ---------------------------------------------------------------------------
create table public.comments (
  id          uuid primary key default gen_random_uuid(),
  market_id   uuid not null references public.markets (id) on delete cascade,
  user_id     uuid not null references public.profiles (id) on delete cascade,
  body        text not null,
  created_at  timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Indexes (per spec: markets.slug is already indexed via its UNIQUE constraint
-- above, so no separate index is created for it here)
-- ---------------------------------------------------------------------------
create index trades_market_id_created_at_idx on public.trades (market_id, created_at);
create index transactions_user_id_created_at_idx on public.transactions (user_id, created_at);
create index comments_market_id_idx on public.comments (market_id);

-- ---------------------------------------------------------------------------
-- handle_new_user: auto-provision a profiles row whenever a new auth.users
-- row is inserted. Username is derived from the email local-part with a
-- random 4-digit suffix to avoid collisions.
-- ---------------------------------------------------------------------------
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_base      text;
  v_candidate text;
begin
  v_base := lower(regexp_replace(split_part(new.email, '@', 1), '[^a-zA-Z0-9]', '', 'g'));
  if v_base is null or length(v_base) = 0 then
    v_base := 'user';
  end if;

  loop
    v_candidate := v_base || '_' || lpad(floor(random() * 10000)::int::text, 4, '0');
    exit when not exists (select 1 from public.profiles where username = v_candidate);
  end loop;

  insert into public.profiles (id, username)
  values (new.id, v_candidate);

  return new;
end;
$$;

revoke execute on function public.handle_new_user() from public;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ---------------------------------------------------------------------------
-- protect_profile_columns: block non-service-role changes to balance,
-- is_admin, last_faucet_at.
--
-- Allowed when:
--   * there is no JWT claim at all (e.g. migrations/seed.sql running as the
--     postgres superuser with no PostgREST request context), or
--   * the caller's JWT role claim is 'service_role', or
--   * the local flag app.bypass_balance_guard is set to 'on' (RPCs set this
--     before mutating balance/last_faucet_at from within a SECURITY DEFINER
--     function, since SECURITY DEFINER changes the *executing* role but not
--     the JWT claims of the original caller).
-- ---------------------------------------------------------------------------
create or replace function public.protect_profile_columns()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_claims text;
  v_role   text;
  v_bypass text;
begin
  v_claims := current_setting('request.jwt.claims', true);
  v_role := case when v_claims is null or v_claims = '' then null else (v_claims::json ->> 'role') end;
  v_bypass := current_setting('app.bypass_balance_guard', true);

  if v_role is null or v_role = 'service_role' or v_bypass = 'on' then
    return new;
  end if;

  if new.balance is distinct from old.balance
     or new.is_admin is distinct from old.is_admin
     or new.last_faucet_at is distinct from old.last_faucet_at then
    raise exception 'Not allowed to modify balance, is_admin, or last_faucet_at directly';
  end if;

  return new;
end;
$$;

revoke execute on function public.protect_profile_columns() from public;

create trigger protect_profile_columns_trigger
  before update on public.profiles
  for each row execute function public.protect_profile_columns();
