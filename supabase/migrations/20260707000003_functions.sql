-- PolyForecast: RPCs (SECURITY DEFINER trading engine)
--
-- CPMM math (see ARCHITECTURE.md "Trading engine" section):
--   price_yes = no_pool / (yes_pool + no_pool)
--   buy:  fee is taken off the input amount first; the *net* amount is what
--         moves through the constant-product swap.
--   sell: the constant-product swap determines gross proceeds first; the fee
--         is taken off those gross proceeds before crediting the user.
--
-- All functions: SECURITY DEFINER, SET search_path = public, row-lock the
-- market/profile/position with FOR UPDATE before mutating, and validate
-- balance/shares/status/close_time with clear RAISE EXCEPTION messages that
-- surface to the UI.
--
-- Balance guard bypass: profiles.balance/is_admin/last_faucet_at are
-- protected by a trigger (schema.sql). Every RPC that touches those columns
-- calls set_config('app.bypass_balance_guard', 'on', true) (transaction-local)
-- immediately before the UPDATE that needs it.

-- =============================================================================
-- buy_shares
-- =============================================================================
create or replace function public.buy_shares(
  p_market_id uuid,
  p_outcome   text,
  p_amount    numeric
)
returns json
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid            uuid;
  v_market         public.markets%rowtype;
  v_profile        public.profiles%rowtype;
  v_fee            numeric(18, 6);
  v_net            numeric(18, 6);
  v_shares_out     numeric(18, 6);
  v_new_yes_pool   numeric(18, 6);
  v_new_no_pool    numeric(18, 6);
  v_price          numeric(18, 6);
  v_new_price_yes  numeric(18, 6);
begin
  v_uid := auth.uid();
  if v_uid is null then
    raise exception 'Not authenticated';
  end if;

  if p_outcome not in ('yes', 'no') then
    raise exception 'Invalid outcome: %', p_outcome;
  end if;

  if p_amount is null or p_amount <= 0 then
    raise exception 'Amount must be greater than zero';
  end if;

  select * into v_market from public.markets where id = p_market_id for update;
  if not found then
    raise exception 'Market not found';
  end if;

  if v_market.status <> 'open' then
    raise exception 'Market is not open for trading';
  end if;

  if now() >= v_market.close_time then
    raise exception 'Market has closed for trading';
  end if;

  select * into v_profile from public.profiles where id = v_uid for update;
  if not found then
    raise exception 'Profile not found';
  end if;

  if v_profile.balance < p_amount then
    raise exception 'Insufficient balance';
  end if;

  v_fee := round(p_amount * v_market.fee_bps / 10000.0, 6);
  v_net := p_amount - v_fee;

  if v_net <= 0 then
    raise exception 'Amount too small after fee';
  end if;

  if p_outcome = 'yes' then
    v_shares_out := v_market.yes_pool + v_net - (v_market.yes_pool * v_market.no_pool) / (v_market.no_pool + v_net);
    v_new_yes_pool := v_market.yes_pool + v_net - v_shares_out;
    v_new_no_pool := v_market.no_pool + v_net;
  else
    v_shares_out := v_market.no_pool + v_net - (v_market.yes_pool * v_market.no_pool) / (v_market.yes_pool + v_net);
    v_new_no_pool := v_market.no_pool + v_net - v_shares_out;
    v_new_yes_pool := v_market.yes_pool + v_net;
  end if;

  if v_shares_out <= 0 then
    raise exception 'Trade would produce zero or negative shares';
  end if;

  v_price := v_net / v_shares_out;
  v_new_price_yes := v_new_no_pool / (v_new_yes_pool + v_new_no_pool);

  update public.markets
  set yes_pool = v_new_yes_pool,
      no_pool = v_new_no_pool,
      fee_collected = fee_collected + v_fee,
      volume = volume + p_amount
  where id = p_market_id;

  insert into public.positions (user_id, market_id, yes_shares, no_shares, updated_at)
  values (
    v_uid,
    p_market_id,
    case when p_outcome = 'yes' then v_shares_out else 0 end,
    case when p_outcome = 'no' then v_shares_out else 0 end,
    now()
  )
  on conflict (user_id, market_id) do update
  set yes_shares = public.positions.yes_shares + excluded.yes_shares,
      no_shares = public.positions.no_shares + excluded.no_shares,
      updated_at = now();

  insert into public.trades (market_id, user_id, action, outcome, amount, shares, price, price_yes_after, fee)
  values (p_market_id, v_uid, 'buy', p_outcome, p_amount, v_shares_out, v_price, v_new_price_yes, v_fee);

  insert into public.transactions (user_id, type, amount, market_id, ref)
  values (v_uid, 'buy', -p_amount, p_market_id, null);

  perform set_config('app.bypass_balance_guard', 'on', true);
  update public.profiles set balance = balance - p_amount where id = v_uid;

  return json_build_object(
    'shares', v_shares_out,
    'price', v_price,
    'new_price_yes', v_new_price_yes
  );
end;
$$;

-- =============================================================================
-- sell_shares
-- =============================================================================
create or replace function public.sell_shares(
  p_market_id uuid,
  p_outcome   text,
  p_shares    numeric
)
returns json
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid            uuid;
  v_market         public.markets%rowtype;
  v_position       public.positions%rowtype;
  v_sum            numeric(38, 6);
  v_disc           numeric(38, 6);
  v_gross          numeric(18, 6);
  v_fee            numeric(18, 6);
  v_net            numeric(18, 6);
  v_new_yes_pool   numeric(18, 6);
  v_new_no_pool    numeric(18, 6);
  v_price          numeric(18, 6);
  v_new_price_yes  numeric(18, 6);
begin
  v_uid := auth.uid();
  if v_uid is null then
    raise exception 'Not authenticated';
  end if;

  if p_outcome not in ('yes', 'no') then
    raise exception 'Invalid outcome: %', p_outcome;
  end if;

  if p_shares is null or p_shares <= 0 then
    raise exception 'Shares must be greater than zero';
  end if;

  select * into v_market from public.markets where id = p_market_id for update;
  if not found then
    raise exception 'Market not found';
  end if;

  if v_market.status <> 'open' then
    raise exception 'Market is not open for trading';
  end if;

  if now() >= v_market.close_time then
    raise exception 'Market has closed for trading';
  end if;

  select * into v_position from public.positions where user_id = v_uid and market_id = p_market_id for update;
  if not found then
    raise exception 'No position in this market';
  end if;

  -- x = ((yes_pool + no_pool + s) - sqrt((yes_pool + no_pool + s)^2 - 4*s*opposite_pool)) / 2
  if p_outcome = 'yes' then
    if v_position.yes_shares < p_shares then
      raise exception 'Insufficient shares';
    end if;

    v_sum := v_market.yes_pool + v_market.no_pool + p_shares;
    v_disc := v_sum * v_sum - 4 * p_shares * v_market.no_pool;
    if v_disc < 0 then
      raise exception 'Sell proceeds calculation out of range';
    end if;

    v_gross := (v_sum - sqrt(v_disc)) / 2;
    if v_gross <= 0 or v_gross >= v_market.no_pool then
      raise exception 'Sell proceeds calculation out of range';
    end if;

    v_new_yes_pool := v_market.yes_pool + p_shares - v_gross;
    v_new_no_pool := v_market.no_pool - v_gross;
  else
    if v_position.no_shares < p_shares then
      raise exception 'Insufficient shares';
    end if;

    v_sum := v_market.yes_pool + v_market.no_pool + p_shares;
    v_disc := v_sum * v_sum - 4 * p_shares * v_market.yes_pool;
    if v_disc < 0 then
      raise exception 'Sell proceeds calculation out of range';
    end if;

    v_gross := (v_sum - sqrt(v_disc)) / 2;
    if v_gross <= 0 or v_gross >= v_market.yes_pool then
      raise exception 'Sell proceeds calculation out of range';
    end if;

    v_new_no_pool := v_market.no_pool + p_shares - v_gross;
    v_new_yes_pool := v_market.yes_pool - v_gross;
  end if;

  v_fee := round(v_gross * v_market.fee_bps / 10000.0, 6);
  v_net := v_gross - v_fee;

  if v_net <= 0 then
    raise exception 'Proceeds too small after fee';
  end if;

  v_price := v_net / p_shares;
  v_new_price_yes := v_new_no_pool / (v_new_yes_pool + v_new_no_pool);

  update public.markets
  set yes_pool = v_new_yes_pool,
      no_pool = v_new_no_pool,
      fee_collected = fee_collected + v_fee,
      volume = volume + v_gross
  where id = p_market_id;

  update public.positions
  set yes_shares = case when p_outcome = 'yes' then yes_shares - p_shares else yes_shares end,
      no_shares = case when p_outcome = 'no' then no_shares - p_shares else no_shares end,
      updated_at = now()
  where user_id = v_uid and market_id = p_market_id;

  insert into public.trades (market_id, user_id, action, outcome, amount, shares, price, price_yes_after, fee)
  values (p_market_id, v_uid, 'sell', p_outcome, v_net, p_shares, v_price, v_new_price_yes, v_fee);

  insert into public.transactions (user_id, type, amount, market_id, ref)
  values (v_uid, 'sell', v_net, p_market_id, null);

  perform set_config('app.bypass_balance_guard', 'on', true);
  update public.profiles set balance = balance + v_net where id = v_uid;

  return json_build_object(
    'proceeds', v_net,
    'price', v_price,
    'new_price_yes', v_new_price_yes
  );
end;
$$;

-- =============================================================================
-- claim_faucet
-- =============================================================================
create or replace function public.claim_faucet()
returns json
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid     uuid;
  v_profile public.profiles%rowtype;
begin
  v_uid := auth.uid();
  if v_uid is null then
    raise exception 'Not authenticated';
  end if;

  select * into v_profile from public.profiles where id = v_uid for update;
  if not found then
    raise exception 'Profile not found';
  end if;

  if v_profile.last_faucet_at is not null and v_profile.last_faucet_at > now() - interval '24 hours' then
    raise exception 'Faucet already claimed in the last 24 hours';
  end if;

  perform set_config('app.bypass_balance_guard', 'on', true);
  update public.profiles
  set balance = balance + 1000,
      last_faucet_at = now()
  where id = v_uid;

  insert into public.transactions (user_id, type, amount, market_id, ref)
  values (v_uid, 'faucet', 1000, null, null);

  return json_build_object('amount', 1000, 'balance', v_profile.balance + 1000);
end;
$$;

-- =============================================================================
-- create_market
-- =============================================================================
create or replace function public.create_market(
  p_question    text,
  p_description text,
  p_category    text,
  p_image_url   text,
  p_close_time  timestamptz,
  p_seed        numeric
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid       uuid;
  v_profile   public.profiles%rowtype;
  v_slug_base text;
  v_slug      text;
  v_market_id uuid;
begin
  v_uid := auth.uid();
  if v_uid is null then
    raise exception 'Not authenticated';
  end if;

  if p_question is null or length(trim(p_question)) = 0 then
    raise exception 'Question is required';
  end if;

  if p_category is null or length(trim(p_category)) = 0 then
    raise exception 'Category is required';
  end if;

  if p_close_time is null or p_close_time <= now() then
    raise exception 'Close time must be in the future';
  end if;

  if p_seed is null or p_seed < 100 then
    raise exception 'Seed must be at least 100';
  end if;

  select * into v_profile from public.profiles where id = v_uid for update;
  if not found then
    raise exception 'Profile not found';
  end if;

  if v_profile.balance < p_seed then
    raise exception 'Insufficient balance to seed market';
  end if;

  v_slug_base := lower(regexp_replace(trim(p_question), '[^a-zA-Z0-9]+', '-', 'g'));
  v_slug_base := trim(both '-' from v_slug_base);
  if v_slug_base is null or length(v_slug_base) = 0 then
    v_slug_base := 'market';
  end if;

  loop
    v_slug := v_slug_base || '-' || lower(substr(md5(random()::text || clock_timestamp()::text), 1, 6));
    exit when not exists (select 1 from public.markets where slug = v_slug);
  end loop;

  v_market_id := gen_random_uuid();

  insert into public.markets (
    id, slug, question, description, category, image_url, creator_id,
    yes_pool, no_pool, fee_bps, fee_collected, volume, status, close_time
  ) values (
    v_market_id, v_slug, p_question, p_description, p_category, p_image_url, v_uid,
    p_seed, p_seed, 200, 0, 0, 'open', p_close_time
  );

  insert into public.transactions (user_id, type, amount, market_id, ref)
  values (v_uid, 'seed', -p_seed, v_market_id, null);

  perform set_config('app.bypass_balance_guard', 'on', true);
  update public.profiles set balance = balance - p_seed where id = v_uid;

  return v_market_id;
end;
$$;

-- =============================================================================
-- resolve_market (admin only)
-- =============================================================================
create or replace function public.resolve_market(
  p_market_id  uuid,
  p_resolution text
)
returns json
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid      uuid;
  v_is_admin boolean;
  v_market   public.markets%rowtype;
  v_status   text;
begin
  v_uid := auth.uid();
  if v_uid is null then
    raise exception 'Not authenticated';
  end if;

  select is_admin into v_is_admin from public.profiles where id = v_uid;
  if v_is_admin is not true then
    raise exception 'Only admins can resolve markets';
  end if;

  if p_resolution not in ('yes', 'no', 'void') then
    raise exception 'Invalid resolution: %', p_resolution;
  end if;

  select * into v_market from public.markets where id = p_market_id for update;
  if not found then
    raise exception 'Market not found';
  end if;

  if v_market.status <> 'open' then
    raise exception 'Market is already resolved';
  end if;

  v_status := case when p_resolution = 'void' then 'void' else 'resolved' end;

  update public.markets
  set status = v_status,
      resolution = case when p_resolution = 'void' then null else p_resolution end,
      resolved_at = now()
  where id = p_market_id;

  return json_build_object('status', v_status, 'resolution', p_resolution);
end;
$$;

-- =============================================================================
-- redeem_winnings
-- =============================================================================
create or replace function public.redeem_winnings(p_market_id uuid)
returns json
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid      uuid;
  v_market   public.markets%rowtype;
  v_position public.positions%rowtype;
  v_payout   numeric(18, 6);
begin
  v_uid := auth.uid();
  if v_uid is null then
    raise exception 'Not authenticated';
  end if;

  select * into v_market from public.markets where id = p_market_id for update;
  if not found then
    raise exception 'Market not found';
  end if;

  if v_market.status not in ('resolved', 'void') then
    raise exception 'Market is not yet resolved';
  end if;

  select * into v_position from public.positions where user_id = v_uid and market_id = p_market_id for update;
  if not found then
    raise exception 'No position in this market';
  end if;

  if v_market.status = 'void' then
    v_payout := (v_position.yes_shares + v_position.no_shares) * 0.5;
  elsif v_market.resolution = 'yes' then
    v_payout := v_position.yes_shares * 1.0;
  else
    v_payout := v_position.no_shares * 1.0;
  end if;

  if v_payout is null or v_payout <= 0 then
    raise exception 'Nothing to redeem';
  end if;

  update public.positions
  set yes_shares = 0, no_shares = 0, updated_at = now()
  where user_id = v_uid and market_id = p_market_id;

  insert into public.transactions (user_id, type, amount, market_id, ref)
  values (v_uid, 'redeem', v_payout, p_market_id, null);

  perform set_config('app.bypass_balance_guard', 'on', true);
  update public.profiles set balance = balance + v_payout where id = v_uid;

  return json_build_object('payout', v_payout);
end;
$$;

-- =============================================================================
-- credit_deposit (service_role only)
-- =============================================================================
create or replace function public.credit_deposit(
  p_user_id     uuid,
  p_tx_hash     text,
  p_amount_eth  numeric,
  p_amount_usdc numeric
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

  insert into public.deposits (user_id, tx_hash, amount_eth, amount_usdc, status)
  values (p_user_id, p_tx_hash, p_amount_eth, p_amount_usdc, 'confirmed');

  insert into public.transactions (user_id, type, amount, market_id, ref)
  values (p_user_id, 'deposit', p_amount_usdc, null, p_tx_hash);

  perform set_config('app.bypass_balance_guard', 'on', true);
  update public.profiles set balance = balance + p_amount_usdc where id = p_user_id;

  return json_build_object('status', 'confirmed', 'amount_usdc', p_amount_usdc);
end;
$$;

-- =============================================================================
-- Grants
--
-- Postgres grants EXECUTE on new functions to PUBLIC by default (unlike
-- tables). Revoke that implicit access from every RPC, then grant back only
-- what's needed: user-facing RPCs to `authenticated` (not `anon`), and
-- credit_deposit to `service_role` only.
-- =============================================================================
-- Supabase sets ALTER DEFAULT PRIVILEGES granting EXECUTE to anon/authenticated/
-- service_role directly on new functions, so revoking from PUBLIC alone is not
-- enough — revoke from those roles explicitly as well.
revoke all on function public.buy_shares(uuid, text, numeric) from public, anon, authenticated;
revoke all on function public.sell_shares(uuid, text, numeric) from public, anon, authenticated;
revoke all on function public.claim_faucet() from public, anon, authenticated;
revoke all on function public.create_market(text, text, text, text, timestamptz, numeric) from public, anon, authenticated;
revoke all on function public.resolve_market(uuid, text) from public, anon, authenticated;
revoke all on function public.redeem_winnings(uuid) from public, anon, authenticated;
revoke all on function public.credit_deposit(uuid, text, numeric, numeric) from public, anon, authenticated;

grant execute on function public.buy_shares(uuid, text, numeric) to authenticated;
grant execute on function public.sell_shares(uuid, text, numeric) to authenticated;
grant execute on function public.claim_faucet() to authenticated;
grant execute on function public.create_market(text, text, text, text, timestamptz, numeric) to authenticated;
grant execute on function public.resolve_market(uuid, text) to authenticated;
grant execute on function public.redeem_winnings(uuid) to authenticated;

grant execute on function public.credit_deposit(uuid, text, numeric, numeric) to service_role;
