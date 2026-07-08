-- PolyForecast (Hunch): auto-created, auto-resolved short-horizon crypto markets
--
-- "Bitcoin/Ethereum Up or Down" markets on rolling 5/10/30-minute windows.
-- A pg_cron job calls public.tick_auto_markets() every 15 seconds. Each tick:
--   1. resolves any due auto market against a live Coinbase/Binance price and
--      instantly settles winning positions (credits balance, zeroes shares) —
--      this is the same ledger shape as redeem_winnings, just run by the
--      system instead of the user, and
--   2. creates the next epoch-aligned window for each of the 6 series if it
--      doesn't already exist, seeding it exactly like create_market does
--      (yes_pool = no_pool = 500, one 'seed' transaction for -500).
--
-- Design notes:
--   * A pg_try_advisory_xact_lock skips overlapping ticks instead of queuing
--     them — if a tick is slow (e.g. a laggy HTTP fetch), the next scheduled
--     tick just no-ops rather than piling up.
--   * Live prices come from the `http` extension (pramsey/pgsql-http, lives
--     in the `extensions` schema on Supabase). Coinbase spot is primary,
--     Binance ticker is the fallback; either failing (timeout, non-200,
--     unparsable body) never aborts the tick — it's caught, logged via
--     RAISE WARNING, and that asset's work is skipped until the next tick.
--   * Each asset's price is fetched at most once per tick and reused for
--     every series/market that needs it (resolution + new-window strike),
--     and only when something in this tick actually needs it — so a tick
--     where nothing is due does zero HTTP calls.
--   * Settlement reuses the existing balance-guard bypass pattern
--     (`set_config('app.bypass_balance_guard', 'on', true)` immediately
--     before the UPDATE, transaction-local) used by every RPC in
--     20260707000003_functions.sql.
--   * Per-market and per-series work is wrapped in its own BEGIN/EXCEPTION
--     block so one bad market/series (bad data, transient lock issue, etc.)
--     never fails the whole tick — cron must keep running forever.

-- =============================================================================
-- Extensions
-- =============================================================================
create extension if not exists http with schema extensions;
create extension if not exists pg_cron;

-- ---------------------------------------------------------------------------
-- markets: columns + indexes for auto series
-- ---------------------------------------------------------------------------
alter table public.markets
  add column if not exists auto_series      text,
  add column if not exists strike_price     numeric(18, 6),
  add column if not exists resolution_price numeric(18, 6);

-- Fast lookup of open auto markets that may be due for resolution.
create index if not exists markets_auto_open_close_time_idx
  on public.markets (close_time)
  where auto_series is not null and status = 'open';

-- Prevents ever creating two markets for the same series' window (belt and
-- braces alongside the existence check inside tick_auto_markets()).
create unique index if not exists markets_auto_series_close_time_uidx
  on public.markets (auto_series, close_time)
  where auto_series is not null;

-- ---------------------------------------------------------------------------
-- System profile top-up: the system/admin profile
-- ('00000000-0000-0000-0000-000000000001') pays for every auto-market seed
-- (500 USDC per window, ~6 windows recreated on a rolling basis). Top it up
-- once with 10,000,000 play-money so it never runs dry. Idempotent: guarded
-- by a marker transaction row so re-running this migration doesn't re-credit.
-- ---------------------------------------------------------------------------
do $$
begin
  if exists (
    select 1 from public.profiles where id = '00000000-0000-0000-0000-000000000001'
  ) and not exists (
    select 1 from public.transactions where ref = 'system-topup'
  ) then
    perform set_config('app.bypass_balance_guard', 'on', true);

    update public.profiles
    set balance = balance + 10000000
    where id = '00000000-0000-0000-0000-000000000001';

    insert into public.transactions (user_id, type, amount, market_id, ref)
    values ('00000000-0000-0000-0000-000000000001', 'deposit', 10000000, null, 'system-topup');
  end if;
end;
$$;

-- =============================================================================
-- fetch_crypto_price: live spot price for BTC or ETH, Coinbase primary /
-- Binance fallback. Raises if both sources fail.
-- =============================================================================
create or replace function public.fetch_crypto_price(p_asset text)
returns numeric
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_resp   extensions.http_response;
  v_price  numeric(18, 6);
begin
  if p_asset not in ('BTC', 'ETH') then
    raise exception 'Unsupported asset: %', p_asset;
  end if;

  perform extensions.http_set_curlopt('CURLOPT_TIMEOUT_MS', '5000');

  -- Primary: Coinbase spot price.
  begin
    select * into v_resp
    from extensions.http_get('https://api.coinbase.com/v2/prices/' || p_asset || '-USD/spot');

    if v_resp.status = 200 then
      v_price := (v_resp.content::json -> 'data' ->> 'amount')::numeric(18, 6);
    end if;
  exception when others then
    v_price := null;
    raise warning 'fetch_crypto_price: Coinbase fetch failed for %: %', p_asset, sqlerrm;
  end;

  if v_price is not null then
    return v_price;
  end if;

  -- Fallback: Binance ticker price.
  begin
    select * into v_resp
    from extensions.http_get('https://api.binance.com/api/v3/ticker/price?symbol=' || p_asset || 'USDT');

    if v_resp.status = 200 then
      v_price := (v_resp.content::json ->> 'price')::numeric(18, 6);
    end if;
  exception when others then
    v_price := null;
    raise warning 'fetch_crypto_price: Binance fetch failed for %: %', p_asset, sqlerrm;
  end;

  if v_price is not null then
    return v_price;
  end if;

  raise exception 'fetch_crypto_price: both Coinbase and Binance failed for %', p_asset;
end;
$$;

-- =============================================================================
-- tick_auto_markets: resolve+settle due auto markets, create the next window
-- for each series. Scheduled every 15s by pg_cron (see bottom of file).
-- =============================================================================
create or replace function public.tick_auto_markets()
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  -- series config: (series_key, asset, window_minutes)
  v_cfg          record;

  -- per-tick price cache — fetched at most once per asset, reused everywhere.
  v_need_btc     boolean := false;
  v_need_eth     boolean := false;
  v_btc_price    numeric(18, 6);
  v_eth_price    numeric(18, 6);
  v_asset_price  numeric(18, 6);

  -- resolution phase
  v_due_id       uuid;
  v_market       public.markets%rowtype;
  v_resolution   text;
  v_position     public.positions%rowtype;
  v_payout       numeric(18, 6);

  -- creation phase
  v_window_end   timestamptz;
  v_market_id    uuid;
  v_label        text;
  v_hhmi         text;
  v_slug         text;
  v_question     text;
  v_description  text;
begin
  -- Skip this run entirely if the previous tick is still in flight.
  if not pg_try_advisory_xact_lock(hashtext('tick_auto_markets')) then
    return;
  end if;

  -- ---------------------------------------------------------------------
  -- Phase 1: figure out which assets (if any) this tick actually needs a
  -- live price for, so an idle tick makes zero HTTP calls.
  -- ---------------------------------------------------------------------
  select exists (
    select 1 from public.markets
    where auto_series is not null and status = 'open' and close_time <= now()
      and auto_series like 'btc-%'
  ) into v_need_btc;

  select exists (
    select 1 from public.markets
    where auto_series is not null and status = 'open' and close_time <= now()
      and auto_series like 'eth-%'
  ) into v_need_eth;

  for v_cfg in
    select * from (values
      ('btc-5m',  'BTC', 5),
      ('btc-10m', 'BTC', 10),
      ('btc-30m', 'BTC', 30),
      ('eth-5m',  'ETH', 5),
      ('eth-10m', 'ETH', 10),
      ('eth-30m', 'ETH', 30)
    ) as s(series_key, asset, minutes)
  loop
    v_window_end := to_timestamp(ceil(extract(epoch from now()) / (v_cfg.minutes * 60)) * (v_cfg.minutes * 60));

    -- Too close to (or past) the window boundary: skip creating this window
    -- this tick regardless of price availability.
    if now() >= v_window_end - interval '30 seconds' then
      continue;
    end if;

    if not exists (
      select 1 from public.markets
      where auto_series = v_cfg.series_key and close_time = v_window_end
    ) then
      if v_cfg.asset = 'BTC' then
        v_need_btc := true;
      else
        v_need_eth := true;
      end if;
    end if;
  end loop;

  -- ---------------------------------------------------------------------
  -- Phase 2: fetch each needed asset's price exactly once, tolerating
  -- failure (that asset's work is simply skipped this tick).
  -- ---------------------------------------------------------------------
  if v_need_btc then
    begin
      v_btc_price := public.fetch_crypto_price('BTC');
    exception when others then
      v_btc_price := null;
      raise warning 'tick_auto_markets: BTC price unavailable this tick: %', sqlerrm;
    end;
  end if;

  if v_need_eth then
    begin
      v_eth_price := public.fetch_crypto_price('ETH');
    exception when others then
      v_eth_price := null;
      raise warning 'tick_auto_markets: ETH price unavailable this tick: %', sqlerrm;
    end;
  end if;

  -- ---------------------------------------------------------------------
  -- Phase 3: resolve + settle every due auto market.
  -- ---------------------------------------------------------------------
  for v_due_id in
    select id from public.markets
    where auto_series is not null and status = 'open' and close_time <= now()
    order by close_time
  loop
    begin
      select * into v_market from public.markets where id = v_due_id for update;

      if v_market.status <> 'open' then
        -- Already handled (shouldn't happen under the advisory lock, but
        -- safe to skip defensively).
        continue;
      end if;

      if v_market.auto_series like 'btc-%' then
        v_asset_price := v_btc_price;
      else
        v_asset_price := v_eth_price;
      end if;

      if v_asset_price is null then
        raise warning 'tick_auto_markets: skipping resolution of market % (% price unavailable)', v_market.id, v_market.auto_series;
        continue;
      end if;

      v_resolution := case when v_asset_price > v_market.strike_price then 'yes' else 'no' end;

      update public.markets
      set status = 'resolved',
          resolution = v_resolution,
          resolution_price = v_asset_price,
          resolved_at = now()
      where id = v_market.id;

      -- Settle winners: pay out winning shares 1:1, zero the whole position.
      for v_position in
        select * from public.positions
        where market_id = v_market.id
          and ((v_resolution = 'yes' and yes_shares > 0)
            or (v_resolution = 'no' and no_shares > 0))
        for update
      loop
        v_payout := (case when v_resolution = 'yes' then v_position.yes_shares else v_position.no_shares end) * 1.0;

        update public.positions
        set yes_shares = 0, no_shares = 0, updated_at = now()
        where user_id = v_position.user_id and market_id = v_market.id;

        insert into public.transactions (user_id, type, amount, market_id, ref)
        values (v_position.user_id, 'redeem', v_payout, v_market.id, null);

        perform set_config('app.bypass_balance_guard', 'on', true);
        update public.profiles set balance = balance + v_payout where id = v_position.user_id;
      end loop;

      -- Zero out positions that only ever held the losing side (no payout).
      update public.positions
      set yes_shares = 0, no_shares = 0, updated_at = now()
      where market_id = v_market.id
        and ((v_resolution = 'yes' and yes_shares = 0 and no_shares > 0)
          or (v_resolution = 'no' and no_shares = 0 and yes_shares > 0));
    exception when others then
      raise warning 'tick_auto_markets: error resolving market %: %', v_due_id, sqlerrm;
    end;
  end loop;

  -- ---------------------------------------------------------------------
  -- Phase 4: create the next window for each series if it doesn't exist yet.
  -- ---------------------------------------------------------------------
  for v_cfg in
    select * from (values
      ('btc-5m',  'BTC', 5),
      ('btc-10m', 'BTC', 10),
      ('btc-30m', 'BTC', 30),
      ('eth-5m',  'ETH', 5),
      ('eth-10m', 'ETH', 10),
      ('eth-30m', 'ETH', 30)
    ) as s(series_key, asset, minutes)
  loop
    begin
      v_window_end := to_timestamp(ceil(extract(epoch from now()) / (v_cfg.minutes * 60)) * (v_cfg.minutes * 60));

      if now() >= v_window_end - interval '30 seconds' then
        continue;
      end if;

      if exists (
        select 1 from public.markets
        where auto_series = v_cfg.series_key and close_time = v_window_end
      ) then
        continue;
      end if;

      v_asset_price := case when v_cfg.asset = 'BTC' then v_btc_price else v_eth_price end;
      if v_asset_price is null then
        raise warning 'tick_auto_markets: skipping creation of % window (price unavailable)', v_cfg.series_key;
        continue;
      end if;

      v_label := case when v_cfg.asset = 'BTC' then 'Bitcoin' else 'Ethereum' end;
      v_hhmi := to_char(v_window_end at time zone 'UTC', 'HH24:MI');
      v_market_id := gen_random_uuid();
      v_slug := v_cfg.series_key || '-' || (extract(epoch from v_window_end)::bigint)::text;
      v_question := v_label || ' Up or Down (' || v_cfg.minutes::text || 'm) — ' || v_hhmi || ' UTC?';
      v_description :=
        'Resolves YES (Up) if the Coinbase ' || v_cfg.asset || '-USD spot price at window close ('
        || v_hhmi || ' UTC) is strictly above the strike of $' || to_char(v_asset_price, 'FM999,999,990.00')
        || ' recorded at market open. Ties or lower resolve NO (Down). Strike and close prices come from '
        || 'Coinbase spot (Binance fallback). Auto-resolved and instantly settled — winnings are credited automatically.';

      insert into public.markets (
        id, slug, question, description, category, image_url, creator_id,
        yes_pool, no_pool, fee_bps, fee_collected, volume, status, close_time,
        auto_series, strike_price
      ) values (
        v_market_id, v_slug, v_question, v_description, 'Crypto', null,
        '00000000-0000-0000-0000-000000000001',
        500, 500, 200, 0, 0, 'open', v_window_end,
        v_cfg.series_key, v_asset_price
      );

      insert into public.transactions (user_id, type, amount, market_id, ref)
      values ('00000000-0000-0000-0000-000000000001', 'seed', -500, v_market_id, null);

      perform set_config('app.bypass_balance_guard', 'on', true);
      update public.profiles
      set balance = balance - 500
      where id = '00000000-0000-0000-0000-000000000001';
    exception when others then
      raise warning 'tick_auto_markets: error creating % window: %', v_cfg.series_key, sqlerrm;
    end;
  end loop;
end;
$$;

-- =============================================================================
-- Grants
--
-- Neither function is meant to be called by end users or the API layer —
-- fetch_crypto_price does uncontrolled outbound HTTP and tick_auto_markets
-- moves the system profile's balance. pg_cron's job runs as the functions'
-- owner (postgres), so no role needs EXECUTE granted back.
-- =============================================================================
revoke all on function public.fetch_crypto_price(text) from public, anon, authenticated;
revoke all on function public.tick_auto_markets() from public, anon, authenticated;

-- =============================================================================
-- Cron schedule: tick every 15 seconds. Guarded unschedule so re-running this
-- migration doesn't create a duplicate job.
-- =============================================================================
do $$
begin
  perform cron.unschedule('tick-auto-markets')
  where exists (select 1 from cron.job where jobname = 'tick-auto-markets');
end $$;

select cron.schedule('tick-auto-markets', '15 seconds', 'select public.tick_auto_markets()');
