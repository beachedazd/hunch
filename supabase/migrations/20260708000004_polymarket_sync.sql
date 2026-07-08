-- PolyForecast: Polymarket sync layer
--
-- Adds the schema needed to mirror external Polymarket markets into our own
-- markets table, plus two service_role-only RPCs that a sync worker calls to
-- import new markets and resolve markets once Polymarket settles them.
--
-- Conventions match supabase/migrations/20260707000003_functions.sql:
-- SECURITY DEFINER, SET search_path = public, FOR UPDATE row locks before
-- mutating, RAISE EXCEPTION for validation failures, explicit revoke/grant
-- block at the end. Written to be safely re-runnable if it half-applies:
-- the ALTER TABLEs use IF NOT EXISTS and CREATE OR REPLACE FUNCTION is
-- already idempotent.

-- ---------------------------------------------------------------------------
-- markets: track provenance and the external Polymarket market id.
-- polymarket_id is unique (gives us the index for free) and nullable, since
-- user-created markets never set it.
-- ---------------------------------------------------------------------------
alter table public.markets
  add column if not exists source text not null default 'user' check (source in ('user', 'polymarket'));

alter table public.markets
  add column if not exists polymarket_id text unique;

-- =============================================================================
-- sync_import_polymarket_market (service_role only)
--
-- Imports (or, if already imported, returns) a Polymarket market as a local
-- market. The system admin user ('00000000-0000-0000-0000-000000000001',
-- 'polyforecast' — see seed.sql) is used as creator_id; since this is
-- house-seeded play money, no balance is deducted and no transactions row is
-- written (unlike create_market's seed deduction for user-created markets).
--
-- CPMM pool seeding: price_yes = no_pool / (yes_pool + no_pool), so given a
-- target price and total liquidity we solve directly for the two pools.
-- =============================================================================
create or replace function public.sync_import_polymarket_market(
  p_polymarket_id text,
  p_question      text,
  p_description   text,
  p_category      text,
  p_image_url     text,
  p_close_time    timestamptz,
  p_price_yes     numeric,
  p_liquidity     numeric
)
returns json
language plpgsql
security definer
set search_path = public
as $$
declare
  v_existing_id uuid;
  v_price       numeric(18, 6);
  v_total       numeric(18, 6);
  v_yes_pool    numeric(18, 6);
  v_no_pool     numeric(18, 6);
  v_slug_base   text;
  v_slug        text;
  v_market_id   uuid;
begin
  if p_polymarket_id is null or length(trim(p_polymarket_id)) = 0 then
    raise exception 'polymarket_id is required';
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

  if p_liquidity is null or p_liquidity < 100 then
    raise exception 'Liquidity must be at least 100';
  end if;

  if p_price_yes is null then
    raise exception 'price_yes is required';
  end if;

  -- Idempotency: if we've already imported this Polymarket market, hand back
  -- its local id instead of erroring or creating a duplicate.
  select id into v_existing_id from public.markets where polymarket_id = p_polymarket_id;
  if found then
    return json_build_object('status', 'exists', 'market_id', v_existing_id);
  end if;

  v_price := least(greatest(p_price_yes, 0.02), 0.98);

  v_total := 2 * p_liquidity;
  v_no_pool := round(v_price * v_total, 6);
  v_yes_pool := v_total - v_no_pool;

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
    yes_pool, no_pool, fee_bps, fee_collected, volume, status, close_time,
    source, polymarket_id
  ) values (
    v_market_id, v_slug, p_question, p_description, p_category, p_image_url,
    '00000000-0000-0000-0000-000000000001'::uuid,
    v_yes_pool, v_no_pool, 200, 0, 0, 'open', p_close_time,
    'polymarket', p_polymarket_id
  );

  return json_build_object('status', 'created', 'market_id', v_market_id);
end;
$$;

-- =============================================================================
-- sync_resolve_market (service_role only)
--
-- Resolves a locally-mirrored Polymarket market by its polymarket_id, using
-- the same status/resolution transition as resolve_market.
-- =============================================================================
create or replace function public.sync_resolve_market(
  p_polymarket_id text,
  p_resolution    text
)
returns json
language plpgsql
security definer
set search_path = public
as $$
declare
  v_market public.markets%rowtype;
  v_status text;
begin
  if p_resolution not in ('yes', 'no', 'void') then
    raise exception 'Invalid resolution: %', p_resolution;
  end if;

  select * into v_market from public.markets where polymarket_id = p_polymarket_id for update;
  if not found then
    return json_build_object('status', 'not_found');
  end if;

  if v_market.status <> 'open' then
    return json_build_object('status', 'already_resolved');
  end if;

  v_status := case when p_resolution = 'void' then 'void' else 'resolved' end;

  update public.markets
  set status = v_status,
      resolution = case when p_resolution = 'void' then null else p_resolution end,
      resolved_at = now()
  where id = v_market.id;

  return json_build_object('status', v_status, 'resolution', p_resolution, 'market_id', v_market.id);
end;
$$;

-- =============================================================================
-- Grants
--
-- Both RPCs are sync-worker-only (no end user or admin-session caller should
-- invoke these directly), so revoke the implicit PUBLIC execute grant and the
-- default anon/authenticated grants Supabase applies to new functions, then
-- grant execute to service_role only.
-- =============================================================================
revoke all on function public.sync_import_polymarket_market(text, text, text, text, text, timestamptz, numeric, numeric) from public, anon, authenticated;
revoke all on function public.sync_resolve_market(text, text) from public, anon, authenticated;

grant execute on function public.sync_import_polymarket_market(text, text, text, text, text, timestamptz, numeric, numeric) to service_role;
grant execute on function public.sync_resolve_market(text, text) to service_role;
