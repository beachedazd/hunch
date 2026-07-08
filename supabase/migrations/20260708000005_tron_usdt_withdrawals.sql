-- PolyForecast: Tron USDT deposits + crypto withdrawals
--
-- Adds:
--   * profiles.tron_address — user-supplied Tron address, same pattern as
--     wallet_address (nullable, self-service, not guarded by
--     protect_profile_columns since it's not balance/is_admin/last_faucet_at).
--   * deposits.chain — 'sepolia' (existing ETH deposits) or 'tron' (new USDT
--     TRC20 deposits on Tron Nile testnet); amount_eth becomes nullable since
--     Tron deposits have no ETH leg.
--   * transactions.type — extended with 'withdrawal' / 'withdrawal_refund' so
--     the new withdrawal RPCs below can post ledger entries.
--   * public.withdrawals — one row per crypto withdrawal request, paid out by
--     a Netlify function (service role) from a house wallet on the relevant
--     chain (Sepolia ETH or Tron USDT).
--   * credit_deposit — replaced to accept p_chain (defaults to 'sepolia' so
--     the existing verify-deposit.mts caller, which passes named params
--     without p_chain, keeps working unchanged).
--   * create_withdrawal / finalize_withdrawal / fail_withdrawal — service-role
--     only RPCs backing the withdrawal flow (debit-then-pay, refund on
--     failure).

-- =============================================================================
-- profiles.tron_address
-- =============================================================================
alter table public.profiles add column tron_address text;

-- =============================================================================
-- deposits: make amount_eth optional, add chain
-- =============================================================================
alter table public.deposits alter column amount_eth drop not null;

alter table public.deposits
  add column chain text not null default 'sepolia' check (chain in ('sepolia', 'tron'));

-- =============================================================================
-- transactions.type: allow 'withdrawal' / 'withdrawal_refund'
-- =============================================================================
alter table public.transactions drop constraint transactions_type_check;

alter table public.transactions
  add constraint transactions_type_check
  check (type in ('faucet', 'deposit', 'buy', 'sell', 'redeem', 'seed', 'withdrawal', 'withdrawal_refund'));

-- ---------------------------------------------------------------------------
-- withdrawals
-- ---------------------------------------------------------------------------
create table public.withdrawals (
  id             uuid primary key default gen_random_uuid(),
  user_id        uuid not null references public.profiles (id) on delete cascade,
  chain          text not null check (chain in ('sepolia', 'tron')),
  dest_address   text not null,
  -- amount_usdc is debited from the user's play-USDC balance.
  amount_usdc    numeric(18, 6) not null check (amount_usdc > 0),
  -- amount_native is what's actually paid out on-chain: ETH for sepolia,
  -- USDT for tron.
  amount_native  numeric(18, 6) not null,
  tx_hash        text,
  status         text not null default 'pending' check (status in ('pending', 'sent', 'failed')),
  error          text,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

create index withdrawals_user_id_created_at_idx on public.withdrawals (user_id, created_at);

-- ---------------------------------------------------------------------------
-- withdrawals: RLS + grants (mirrors deposits — SELECT own only, no direct
-- writes; the RPCs below are service_role-only and bypass RLS as definer).
-- ---------------------------------------------------------------------------
alter table public.withdrawals enable row level security;

create policy withdrawals_select_own
  on public.withdrawals for select
  using (user_id = auth.uid());

grant select on public.withdrawals to authenticated;

-- =============================================================================
-- credit_deposit (service_role only) — replaced to add p_chain
-- =============================================================================
drop function public.credit_deposit(uuid, text, numeric, numeric);

create or replace function public.credit_deposit(
  p_user_id     uuid,
  p_tx_hash     text,
  p_amount_eth  numeric,
  p_amount_usdc numeric,
  p_chain       text default 'sepolia'
)
returns json
language plpgsql
security definer
set search_path = public
as $$
declare
  v_profile_id  uuid;
  v_existing_id uuid;
begin
  if p_user_id is null then
    raise exception 'user_id is required';
  end if;

  if p_tx_hash is null or length(trim(p_tx_hash)) = 0 then
    raise exception 'tx_hash is required';
  end if;

  if p_chain not in ('sepolia', 'tron') then
    raise exception 'Invalid chain: %', p_chain;
  end if;

  if p_amount_usdc is null or p_amount_usdc <= 0 then
    raise exception 'amount_usdc must be greater than zero';
  end if;

  select id into v_profile_id from public.profiles where id = p_user_id for update;
  if not found then
    raise exception 'User not found';
  end if;

  select id into v_existing_id from public.deposits where tx_hash = p_tx_hash;
  if found then
    return json_build_object('status', 'duplicate');
  end if;

  insert into public.deposits (user_id, tx_hash, amount_eth, amount_usdc, status, chain)
  values (p_user_id, p_tx_hash, p_amount_eth, p_amount_usdc, 'confirmed', p_chain);

  insert into public.transactions (user_id, type, amount, market_id, ref)
  values (p_user_id, 'deposit', p_amount_usdc, null, p_tx_hash);

  perform set_config('app.bypass_balance_guard', 'on', true);
  update public.profiles set balance = balance + p_amount_usdc where id = p_user_id;

  return json_build_object('status', 'confirmed', 'amount_usdc', p_amount_usdc);
end;
$$;

-- =============================================================================
-- create_withdrawal (service_role only)
--
-- Debits the user's play-USDC balance immediately (pending payout), so the
-- balance reflects committed funds while the Netlify function sends the
-- on-chain payout. fail_withdrawal refunds if the payout doesn't go through.
-- =============================================================================
create or replace function public.create_withdrawal(
  p_user_id        uuid,
  p_chain          text,
  p_dest_address   text,
  p_amount_usdc    numeric,
  p_amount_native  numeric
)
returns json
language plpgsql
security definer
set search_path = public
as $$
declare
  v_profile        public.profiles%rowtype;
  v_withdrawal_id  uuid;
begin
  if p_user_id is null then
    raise exception 'user_id is required';
  end if;

  if p_chain not in ('sepolia', 'tron') then
    raise exception 'Invalid chain: %', p_chain;
  end if;

  if p_dest_address is null or length(trim(p_dest_address)) = 0 then
    raise exception 'Destination address is required';
  end if;

  if p_amount_usdc is null or p_amount_usdc < 1 then
    raise exception 'Minimum withdrawal is 1 USDC';
  end if;

  if p_amount_native is null or p_amount_native <= 0 then
    raise exception 'amount_native must be greater than zero';
  end if;

  select * into v_profile from public.profiles where id = p_user_id for update;
  if not found then
    raise exception 'User not found';
  end if;

  if v_profile.balance < p_amount_usdc then
    raise exception 'Insufficient balance';
  end if;

  insert into public.withdrawals (user_id, chain, dest_address, amount_usdc, amount_native, status)
  values (p_user_id, p_chain, p_dest_address, p_amount_usdc, p_amount_native, 'pending')
  returning id into v_withdrawal_id;

  insert into public.transactions (user_id, type, amount, market_id, ref)
  values (p_user_id, 'withdrawal', p_amount_usdc, null, v_withdrawal_id::text);

  perform set_config('app.bypass_balance_guard', 'on', true);
  update public.profiles set balance = balance - p_amount_usdc where id = p_user_id;

  return json_build_object('withdrawal_id', v_withdrawal_id);
end;
$$;

-- =============================================================================
-- finalize_withdrawal (service_role only)
--
-- Called by the Netlify function once the on-chain payout transaction has
-- been broadcast successfully.
-- =============================================================================
create or replace function public.finalize_withdrawal(
  p_withdrawal_id uuid,
  p_tx_hash       text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.withdrawals
  set status = 'sent',
      tx_hash = p_tx_hash,
      updated_at = now()
  where id = p_withdrawal_id
    and status = 'pending';

  if not found then
    raise exception 'Withdrawal not found or not pending';
  end if;
end;
$$;

-- =============================================================================
-- fail_withdrawal (service_role only)
--
-- Called by the Netlify function when the on-chain payout could not be sent;
-- refunds the debited balance back to the user.
-- =============================================================================
create or replace function public.fail_withdrawal(
  p_withdrawal_id uuid,
  p_error         text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_withdrawal public.withdrawals%rowtype;
begin
  select * into v_withdrawal from public.withdrawals where id = p_withdrawal_id for update;
  if not found or v_withdrawal.status <> 'pending' then
    raise exception 'Withdrawal not found or not pending';
  end if;

  perform 1 from public.profiles where id = v_withdrawal.user_id for update;

  insert into public.transactions (user_id, type, amount, market_id, ref)
  values (v_withdrawal.user_id, 'withdrawal_refund', v_withdrawal.amount_usdc, null, v_withdrawal.id::text);

  perform set_config('app.bypass_balance_guard', 'on', true);
  update public.profiles
  set balance = balance + v_withdrawal.amount_usdc
  where id = v_withdrawal.user_id;

  update public.withdrawals
  set status = 'failed',
      error = p_error,
      updated_at = now()
  where id = p_withdrawal_id;
end;
$$;

-- =============================================================================
-- Grants
--
-- Same pattern as functions.sql: Postgres grants EXECUTE to PUBLIC by default,
-- and Supabase's default privileges additionally grant it to anon/authenticated/
-- service_role directly on new functions — so revoke from all three explicitly,
-- then grant back only to service_role for these house-wallet-backed RPCs.
-- =============================================================================
revoke all on function public.credit_deposit(uuid, text, numeric, numeric, text) from public, anon, authenticated;
revoke all on function public.create_withdrawal(uuid, text, text, numeric, numeric) from public, anon, authenticated;
revoke all on function public.finalize_withdrawal(uuid, text) from public, anon, authenticated;
revoke all on function public.fail_withdrawal(uuid, text) from public, anon, authenticated;

grant execute on function public.credit_deposit(uuid, text, numeric, numeric, text) to service_role;
grant execute on function public.create_withdrawal(uuid, text, text, numeric, numeric) to service_role;
grant execute on function public.finalize_withdrawal(uuid, text) to service_role;
grant execute on function public.fail_withdrawal(uuid, text) to service_role;
