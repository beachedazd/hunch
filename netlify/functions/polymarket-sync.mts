import { createClient } from '@supabase/supabase-js';
import type { Config, Context } from '@netlify/functions';
import { runPolymarketSync } from './lib/polymarket.ts';

// Manually triggers a Polymarket -> hunch sync run (resolution pass then
// import pass). Intended for ad-hoc/admin use; the hourly cadence is
// handled by polymarket-sync-cron.mts.
//
// Contract:
//   POST /api/polymarket-sync
//   Auth (either):
//     Header:  x-sync-key: <POLYMARKET_SYNC_SECRET>
//     Header:  Authorization: Bearer <supabase access token>  (caller must
//              be a profile with is_admin = true)
//
//   200 SyncSummary
//   401 { error: string }
//   500 { error: string }

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

export default async (req: Request, _context: Context): Promise<Response> => {
  if (req.method !== 'POST') {
    return jsonResponse({ error: 'Method not allowed' }, 405);
  }

  const supabaseUrl = Netlify.env.get('SUPABASE_URL');
  const serviceRoleKey = Netlify.env.get('SUPABASE_SERVICE_ROLE_KEY');
  const syncSecret = Netlify.env.get('POLYMARKET_SYNC_SECRET');

  if (!supabaseUrl || !serviceRoleKey) {
    console.error('polymarket-sync: missing one or more required environment variables');
    return jsonResponse({ error: 'Server misconfigured' }, 500);
  }

  // ---- (a) authenticate the caller ------------------------------------------
  const providedSyncKey = req.headers.get('x-sync-key');
  const hasValidSyncKey = Boolean(syncSecret) && providedSyncKey === syncSecret;

  let isAuthorized = hasValidSyncKey;

  if (!isAuthorized) {
    const authHeader = req.headers.get('authorization') ?? '';
    const bearerMatch = /^Bearer\s+(.+)$/i.exec(authHeader);
    const accessToken = bearerMatch?.[1];

    if (accessToken) {
      const supabase = createClient(supabaseUrl, serviceRoleKey, {
        auth: { autoRefreshToken: false, persistSession: false },
      });

      const { data: userData, error: userError } = await supabase.auth.getUser(accessToken);
      if (!userError && userData?.user) {
        const { data: profile } = await supabase
          .from('profiles')
          .select('is_admin')
          .eq('id', userData.user.id)
          .single();
        isAuthorized = Boolean((profile as { is_admin?: boolean } | null)?.is_admin);
      }
    }
  }

  if (!isAuthorized) {
    return jsonResponse({ error: 'Not authorized' }, 401);
  }

  // ---- (b) run the sync ------------------------------------------------------
  try {
    const summary = await runPolymarketSync();
    return jsonResponse(summary);
  } catch (err) {
    console.error('polymarket-sync error:', err instanceof Error ? err.message : String(err));
    return jsonResponse({ error: 'Failed to run Polymarket sync. Please try again.' }, 500);
  }
};

export const config: Config = { path: '/api/polymarket-sync' };
