-- PolyForecast (Hunch): live model-based odds for auto crypto markets
--
-- The auto BTC/ETH up/down markets otherwise sit frozen at 50/50 under low
-- volume. This adds the *execution-side* half of the model (the display half
-- is computed client-side in src/lib/live.ts — keep the constants in sync):
--
--   * norm_cdf(x): standard normal CDF via the Abramowitz-Stegun 7.1.26 erf
--     approximation (Postgres has no built-in).
--   * sync_auto_market_odds(market_id): fetch the live price, compute the same
--     blended model target as the frontend, and reposition the CPMM pools to
--     that price while preserving k = yes_pool*no_pool. No balance/share
--     changes (payouts are funded from the system buffer, not pool collateral),
--     so this is safe to expose to authenticated users. Throttled to >= 5s and
--     tolerant of price-fetch failure (it just no-ops).
--
-- Called by the trade ticket (TradeWidget) when a user engages an auto market,
-- so a buy executes at ~the odds shown. buy_shares/sell_shares are unchanged.

-- ---------------------------------------------------------------------------
-- markets: throttle marker for the sync RPC.
-- ---------------------------------------------------------------------------
alter table public.markets
  add column if not exists last_odds_sync_at timestamptz;

-- =============================================================================
-- norm_cdf: standard normal CDF. IMMUTABLE (pure function of its input).
-- =============================================================================
create or replace function public.norm_cdf(p_x numeric)
returns numeric
language plpgsql
immutable
as $$
declare
  v_sign numeric;
  v_ax   double precision;
  v_t    double precision;
  v_y    double precision;
begin
  if p_x < 0 then v_sign := -1; else v_sign := 1; end if;
  v_ax := abs(p_x)::double precision / sqrt(2);
  v_t  := 1 / (1 + 0.3275911 * v_ax);
  v_y  := 1 - (((((1.061405429 * v_t - 1.453152027) * v_t + 1.421413741) * v_t
            - 0.284496736) * v_t + 0.254829592) * v_t * exp(-v_ax * v_ax));
  return (0.5 * (1 + v_sign * v_y))::numeric;
end;
$$;

-- =============================================================================
-- sync_auto_market_odds (authenticated)
--
-- Repositions an auto market's CPMM price to the live blended model value.
-- No-op (returns current price) for non-auto/closed markets, when throttled,
-- or when the price fetch fails.
-- =============================================================================
create or replace function public.sync_auto_market_odds(p_market_id uuid)
returns json
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_market      public.markets%rowtype;
  v_asset       text;
  v_sigma_ann   numeric;
  v_price       numeric(18, 6);
  v_tau_seconds numeric;
  v_sigma_tau   numeric;
  v_model       numeric;
  v_traded      numeric;
  v_weight      numeric;
  v_target      numeric;
  v_k           numeric;
  v_new_yes     numeric(18, 6);
  v_new_no      numeric(18, 6);
begin
  select * into v_market from public.markets where id = p_market_id for update;
  if not found
     or v_market.auto_series is null
     or v_market.status <> 'open'
     or now() >= v_market.close_time
     or v_market.strike_price is null
     or v_market.strike_price <= 0 then
    return json_build_object('status', 'noop',
      'price_yes', case when found then v_market.no_pool / nullif(v_market.yes_pool + v_market.no_pool, 0) else null end);
  end if;

  -- Throttle: this RPC does uncontrolled outbound HTTP and is user-callable.
  if v_market.last_odds_sync_at is not null
     and v_market.last_odds_sync_at > now() - interval '5 seconds' then
    return json_build_object('status', 'throttled',
      'price_yes', v_market.no_pool / nullif(v_market.yes_pool + v_market.no_pool, 0));
  end if;

  if v_market.auto_series like 'btc-%' then
    v_asset := 'BTC'; v_sigma_ann := 0.50;
  else
    v_asset := 'ETH'; v_sigma_ann := 0.65;
  end if;

  -- Fetch live price; on failure just no-op (never block/settle here).
  begin
    v_price := public.fetch_crypto_price(v_asset);
  exception when others then
    raise warning 'sync_auto_market_odds: price unavailable for %: %', p_market_id, sqlerrm;
    return json_build_object('status', 'noop',
      'price_yes', v_market.no_pool / nullif(v_market.yes_pool + v_market.no_pool, 0));
  end;

  if v_price is null or v_price <= 0 then
    return json_build_object('status', 'noop',
      'price_yes', v_market.no_pool / nullif(v_market.yes_pool + v_market.no_pool, 0));
  end if;

  v_tau_seconds := greatest(extract(epoch from (v_market.close_time - now())), 1);
  v_sigma_tau   := v_sigma_ann * sqrt(v_tau_seconds / 31557600.0);
  if v_sigma_tau <= 0 then
    return json_build_object('status', 'noop',
      'price_yes', v_market.no_pool / nullif(v_market.yes_pool + v_market.no_pool, 0));
  end if;

  v_model  := public.norm_cdf(ln(v_price / v_market.strike_price) / v_sigma_tau);
  v_model  := least(greatest(v_model, 0.02), 0.98);

  v_traded := v_market.no_pool / (v_market.yes_pool + v_market.no_pool);
  v_weight := 250.0 / (250.0 + greatest(v_market.volume, 0));
  v_target := v_weight * v_model + (1 - v_weight) * v_traded;
  v_target := least(greatest(v_target, 0.02), 0.98);

  -- Reposition price to v_target while preserving k = yes_pool * no_pool.
  v_k       := v_market.yes_pool * v_market.no_pool;
  v_new_yes := round(sqrt(v_k * (1 - v_target) / v_target), 6);
  v_new_no  := round(sqrt(v_k * v_target / (1 - v_target)), 6);

  update public.markets
  set yes_pool = v_new_yes,
      no_pool = v_new_no,
      last_odds_sync_at = now()
  where id = v_market.id;

  return json_build_object('status', 'synced', 'price_yes', v_target,
    'yes_pool', v_new_yes, 'no_pool', v_new_no);
end;
$$;

-- =============================================================================
-- Grants: sync is user-callable (trade ticket); norm_cdf is a helper only.
-- =============================================================================
revoke all on function public.norm_cdf(numeric) from public, anon, authenticated;
revoke all on function public.sync_auto_market_odds(uuid) from public, anon, authenticated;

grant execute on function public.sync_auto_market_odds(uuid) to authenticated;
