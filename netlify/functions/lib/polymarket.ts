import { createClient, type SupabaseClient } from '@supabase/supabase-js';

// Shared Polymarket <-> hunch sync logic used by both the on-demand HTTP
// trigger (polymarket-sync.mts) and the hourly scheduled function
// (polymarket-sync-cron.mts).
//
// Two passes, run in order:
//   1. RESOLUTION - walk hunch markets imported from Polymarket that are
//      still open, check each against the Gamma API, and resolve the ones
//      whose underlying Polymarket market has finalized (UMA) resolution.
//   2. IMPORT - pull the top markets per category from Gamma, filter down
//      to "importable" candidates, and create the ones hunch doesn't
//      already have.
//
// Every external call (Gamma fetch, Supabase RPC) is wrapped so a single
// failure is recorded in `errors` and the run continues instead of aborting.

const DEFAULT_GAMMA_API_URL = 'https://gamma-api.polymarket.com';
const USER_AGENT = 'hunch-polymarket-sync/1.0 (+https://hunch.markets)';

// hunch category -> Polymarket Gamma tag_slug
const CATEGORY_TAG_SLUGS: Record<string, string> = {
  Politics: 'politics',
  Sports: 'sports',
  Crypto: 'crypto',
  Science: 'science',
  'Pop Culture': 'pop-culture',
  Business: 'business',
};

const EVENTS_LIMIT = 10;
const IMPORT_PER_CATEGORY = 4;
const MIN_VOLUME = 10_000;
const MIN_YES_PRICE = 0.02;
const MAX_YES_PRICE = 0.98;
const MIN_HOURS_TO_CLOSE = 1;
const RESOLUTION_CHUNK_SIZE = 5; // be polite to Gamma - small concurrency, not unbounded Promise.all

export interface SyncSummary {
  imported: Array<{ polymarket_id: string; question: string; category: string; price_yes: number }>;
  resolved: Array<{ polymarket_id: string; question: string; resolution: string }>;
  skipped: number;
  errors: string[];
}

// ---- Gamma API shapes (subset we care about) ------------------------------

interface GammaMarket {
  id: string;
  question?: string;
  description?: string;
  image?: string;
  icon?: string;
  slug?: string;
  endDate?: string;
  closed?: boolean;
  active?: boolean;
  acceptingOrders?: boolean;
  outcomes?: string; // JSON-encoded string array, e.g. '["Yes", "No"]'
  outcomePrices?: string; // JSON-encoded string array, e.g. '["0.0295", "0.9705"]'
  volumeNum?: number;
  volume?: string;
  umaResolutionStatus?: string;
}

interface GammaEvent {
  id: string;
  title?: string;
  image?: string;
  icon?: string;
  tags?: Array<{ slug?: string }>;
  markets?: GammaMarket[];
}

interface OpenMarketRow {
  id: string;
  polymarket_id: string;
  question: string;
}

interface ImportCandidate {
  market: GammaMarket;
  event: GammaEvent;
  priceYes: number;
  volume: number;
}

// ---- small helpers ---------------------------------------------------------

function gammaBaseUrl(): string {
  return Netlify.env.get('GAMMA_API_URL') || DEFAULT_GAMMA_API_URL;
}

async function gammaFetch<T>(path: string): Promise<T> {
  const res = await fetch(`${gammaBaseUrl()}${path}`, {
    headers: { 'User-Agent': USER_AGENT, accept: 'application/json' },
  });
  if (!res.ok) {
    throw new Error(`Gamma API ${path} -> HTTP ${res.status}`);
  }
  return (await res.json()) as T;
}

// Returns null on 404 (caller treats that as "skip"); throws on other failures.
async function gammaFetchMarketById(id: string): Promise<GammaMarket | null> {
  const res = await fetch(`${gammaBaseUrl()}/markets/${encodeURIComponent(id)}`, {
    headers: { 'User-Agent': USER_AGENT, accept: 'application/json' },
  });
  if (res.status === 404) return null;
  if (!res.ok) {
    throw new Error(`Gamma API /markets/${id} -> HTTP ${res.status}`);
  }
  return (await res.json()) as GammaMarket;
}

function parseStringArray(raw: string | undefined): string[] | null {
  if (!raw) return null;
  try {
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as string[]) : null;
  } catch {
    return null;
  }
}

function parseYesPrice(outcomePrices: string | undefined): number | null {
  const prices = parseStringArray(outcomePrices);
  if (!prices || prices.length === 0) return null;
  const p = Number(prices[0]);
  return Number.isFinite(p) ? p : null;
}

function deriveResolution(priceYes: number): 'yes' | 'no' | 'void' {
  if (priceYes > 0.99) return 'yes';
  if (priceYes < 0.01) return 'no';
  return 'void'; // 50/50 or partial resolutions map to void
}

// Runs `fn` over `items` with a small fixed concurrency instead of an
// unbounded Promise.all, so we don't hammer the Gamma API.
async function chunked<T, R>(items: T[], size: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const results: R[] = [];
  for (let i = 0; i < items.length; i += size) {
    const chunk = items.slice(i, i + size);
    const chunkResults = await Promise.all(chunk.map((item) => fn(item)));
    results.push(...chunkResults);
  }
  return results;
}

// ---- (1) resolution pass ---------------------------------------------------

async function runResolutionPass(supabase: SupabaseClient, summary: SyncSummary): Promise<void> {
  const { data: openMarkets, error } = await supabase
    .from('markets')
    .select('id, polymarket_id, question')
    .eq('source', 'polymarket')
    .eq('status', 'open');

  if (error) {
    summary.errors.push(`Failed to load open markets: ${error.message}`);
    return;
  }

  const rows = (openMarkets ?? []) as OpenMarketRow[];

  await chunked(rows, RESOLUTION_CHUNK_SIZE, async (row) => {
    try {
      const market = await gammaFetchMarketById(row.polymarket_id);
      if (!market) {
        summary.errors.push(`Market ${row.polymarket_id} not found on Polymarket (404), skipped`);
        return;
      }

      const isResolved = market.closed === true && market.umaResolutionStatus === 'resolved';
      if (!isResolved) return;

      const priceYes = parseYesPrice(market.outcomePrices);
      if (priceYes === null) {
        summary.errors.push(`Market ${row.polymarket_id} resolved but outcomePrices unparseable`);
        return;
      }

      const resolution = deriveResolution(priceYes);

      const { data: rpcResult, error: rpcError } = await supabase.rpc('sync_resolve_market', {
        p_polymarket_id: row.polymarket_id,
        p_resolution: resolution,
      });

      if (rpcError) {
        summary.errors.push(`sync_resolve_market failed for ${row.polymarket_id}: ${rpcError.message}`);
        return;
      }

      const result = rpcResult as { status?: string } | null;
      if (result?.status === 'resolved' || result?.status === 'void') {
        summary.resolved.push({ polymarket_id: row.polymarket_id, question: row.question, resolution });
      }
    } catch (err) {
      summary.errors.push(
        `Resolution check failed for ${row.polymarket_id}: ${err instanceof Error ? err.message : String(err)}`
      );
    }
  });
}

// ---- (2) import pass --------------------------------------------------------

async function runImportPass(supabase: SupabaseClient, summary: SyncSummary): Promise<void> {
  const { data: existingRows, error } = await supabase.from('markets').select('polymarket_id').eq('source', 'polymarket');

  if (error) {
    summary.errors.push(`Failed to load existing imported markets: ${error.message}`);
    return;
  }

  const existingIds = new Set(
    (existingRows ?? [])
      .map((r) => (r as { polymarket_id: string | null }).polymarket_id)
      .filter((id): id is string => Boolean(id))
  );

  // A given market can appear under multiple tags/categories via its event;
  // dedupe by market id across categories so we don't consider it twice.
  const seenMarketIds = new Set<string>();
  const minCloseTimeMs = Date.now() + MIN_HOURS_TO_CLOSE * 60 * 60 * 1000;

  for (const [category, tagSlug] of Object.entries(CATEGORY_TAG_SLUGS)) {
    try {
      const events = await gammaFetch<GammaEvent[]>(
        `/events?closed=false&limit=${EVENTS_LIMIT}&tag_slug=${encodeURIComponent(tagSlug)}&order=volume24hr&ascending=false`
      );

      const candidates: ImportCandidate[] = [];

      for (const event of events) {
        for (const market of event.markets ?? []) {
          if (!market.id || seenMarketIds.has(market.id)) continue;

          const outcomes = parseStringArray(market.outcomes);
          const isYesNo = outcomes !== null && outcomes.length === 2 && outcomes[0] === 'Yes' && outcomes[1] === 'No';
          if (!isYesNo) continue;

          if (market.closed !== false) continue;
          if (market.active !== true) continue;
          if (market.acceptingOrders === false) continue;

          const endDateMs = market.endDate ? Date.parse(market.endDate) : NaN;
          if (!Number.isFinite(endDateMs) || endDateMs <= minCloseTimeMs) continue;

          const question = (market.question ?? '').trim();
          if (!question) continue;

          const priceYes = parseYesPrice(market.outcomePrices);
          if (priceYes === null || priceYes < MIN_YES_PRICE || priceYes > MAX_YES_PRICE) continue;

          const volume = market.volumeNum ?? Number(market.volume) ?? 0;
          if (!Number.isFinite(volume) || volume < MIN_VOLUME) continue;

          seenMarketIds.add(market.id);
          candidates.push({ market, event, priceYes, volume });
        }
      }

      candidates.sort((a, b) => b.volume - a.volume);

      let importedForCategory = 0;
      for (const candidate of candidates) {
        if (importedForCategory >= IMPORT_PER_CATEGORY) break;
        if (existingIds.has(candidate.market.id)) continue;

        try {
          const { data: rpcResult, error: rpcError } = await supabase.rpc('sync_import_polymarket_market', {
            p_polymarket_id: candidate.market.id,
            p_question: candidate.market.question ?? '',
            p_description: (candidate.market.description ?? '').slice(0, 4000) || null,
            p_category: category,
            p_image_url: candidate.market.image || candidate.market.icon || candidate.event.image || null,
            p_close_time: candidate.market.endDate,
            p_price_yes: candidate.priceYes,
            p_liquidity: 1000,
          });

          if (rpcError) {
            summary.errors.push(`sync_import_polymarket_market failed for ${candidate.market.id}: ${rpcError.message}`);
            continue;
          }

          const result = rpcResult as { status?: string; market_id?: string } | null;
          if (result?.status === 'created') {
            summary.imported.push({
              polymarket_id: candidate.market.id,
              question: candidate.market.question ?? '',
              category,
              price_yes: candidate.priceYes,
            });
            existingIds.add(candidate.market.id);
            importedForCategory += 1;
          } else if (result?.status === 'exists') {
            summary.skipped += 1;
            existingIds.add(candidate.market.id);
          }
        } catch (err) {
          summary.errors.push(
            `Import failed for ${candidate.market.id}: ${err instanceof Error ? err.message : String(err)}`
          );
        }
      }
    } catch (err) {
      summary.errors.push(
        `Failed to fetch events for category ${category} (${tagSlug}): ${err instanceof Error ? err.message : String(err)}`
      );
    }
  }
}

// ---- entry point ------------------------------------------------------------

export async function runPolymarketSync(): Promise<SyncSummary> {
  const summary: SyncSummary = { imported: [], resolved: [], skipped: 0, errors: [] };

  const supabaseUrl = Netlify.env.get('SUPABASE_URL');
  const serviceRoleKey = Netlify.env.get('SUPABASE_SERVICE_ROLE_KEY');

  if (!supabaseUrl || !serviceRoleKey) {
    summary.errors.push('Server misconfigured: missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
    return summary;
  }

  const supabase = createClient(supabaseUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  await runResolutionPass(supabase, summary);
  await runImportPass(supabase, summary);

  return summary;
}
