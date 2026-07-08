import { createClient } from '@supabase/supabase-js';
import type { Config, Context } from '@netlify/functions';
import { decodeBase58, sha256 } from 'ethers';

// Verifies a Tron Nile deposit tx on-chain and credits the caller's balance.
//
// Contract:
//   POST /api/verify-tron-deposit
//   Headers: Authorization: Bearer <supabase access token>
//   Body:    { "txId": "0x..." }
//
//   200 { status: 'confirmed', tx_hash, amount_usdt, amount_usdc }
//   409 { status: 'duplicate', error: string }   -- tx already credited
//   400/401/500 { error: string }

const TX_ID_RE = /^[0-9a-f]{64}$/;

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

// Returns lowercase hex like '418b59...' or null if invalid.
function tronBase58ToHex(addr: string): string | null {
  if (!/^T[1-9A-HJ-NP-Za-km-z]{33}$/.test(addr)) return null;
  let hex: string;
  try {
    hex = decodeBase58(addr).toString(16).padStart(50, '0');
  } catch {
    return null;
  }
  const payload = '0x' + hex.slice(0, 42);
  const checksum = hex.slice(42);
  const expected = sha256(sha256(payload)).slice(2, 10);
  if (checksum !== expected) return null;
  if (!payload.startsWith('0x41')) return null;
  return payload.slice(2).toLowerCase();
}

async function tronRpcPost<T>(baseUrl: string, path: string, body: unknown): Promise<T | null> {
  const res = await fetch(`${baseUrl}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    throw new Error(`Tron RPC request failed with HTTP ${res.status}`);
  }

  return (await res.json()) as T;
}

export default async (req: Request, _context: Context): Promise<Response> => {
  if (req.method !== 'POST') {
    return jsonResponse({ error: 'Method not allowed' }, 405);
  }

  const supabaseUrl = Netlify.env.get('SUPABASE_URL');
  const serviceRoleKey = Netlify.env.get('SUPABASE_SERVICE_ROLE_KEY');
  const tronHost = Netlify.env.get('TRON_FULL_HOST');
  const tronUsdtContract = Netlify.env.get('TRON_USDT_CONTRACT');
  const tronHouseAddress = Netlify.env.get('TRON_HOUSE_ADDRESS');

  if (!supabaseUrl || !serviceRoleKey || !tronHost || !tronUsdtContract || !tronHouseAddress) {
    console.error('verify-tron-deposit: missing one or more required environment variables');
    return jsonResponse({ error: 'Server misconfigured' }, 500);
  }

  // ---- (a) validate body / tx id format ------------------------------------
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return jsonResponse({ error: 'Invalid JSON body' }, 400);
  }
  if (typeof body !== 'object' || body === null) {
    return jsonResponse({ error: 'Invalid JSON body' }, 400);
  }
  const bodyObj = body as Record<string, unknown>;

  let txId = typeof bodyObj.txId === 'string' ? bodyObj.txId.trim() : '';
  // strip optional 0x prefix
  if (txId.startsWith('0x') || txId.startsWith('0X')) {
    txId = txId.slice(2);
  }
  txId = txId.toLowerCase();
  if (!TX_ID_RE.test(txId)) {
    return jsonResponse({ error: 'Invalid transaction id' }, 400);
  }

  // ---- (b) verify the caller via their Supabase access token ---------------
  const authHeader = req.headers.get('authorization') ?? '';
  const bearerMatch = /^Bearer\s+(.+)$/i.exec(authHeader);
  const accessToken = bearerMatch?.[1];
  if (!accessToken) {
    return jsonResponse({ error: 'Missing Authorization bearer token' }, 401);
  }

  const supabase = createClient(supabaseUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  const { data: userData, error: userError } = await supabase.auth.getUser(accessToken);
  if (userError || !userData?.user) {
    return jsonResponse({ error: 'Not authenticated' }, 401);
  }
  const userId = userData.user.id;

  try {
    // ---- (c) load the user's tron address from profile -----------------------
    const { data: profile, error: profileError } = await supabase
      .from('profiles')
      .select('tron_address')
      .eq('id', userId)
      .single();

    if (profileError) {
      console.error('verify-tron-deposit: profile lookup failed:', profileError.message);
      return jsonResponse({ error: 'Failed to verify deposit. Please try again.' }, 500);
    }

    const linkedTronAddress = (profile?.tron_address ?? '').trim();
    if (!linkedTronAddress) {
      return jsonResponse({ error: 'Link your Tron address before verifying a deposit.' }, 400);
    }

    // ---- (d) fetch tx from Tron Nile via gettransactionbyid ------------------
    interface TronTransaction {
      raw_data?: {
        contract?: Array<{
          type?: string;
          parameter?: {
            value?: {
              contract_address?: string;
              owner_address?: string;
              data?: string;
            };
          };
        }>;
      };
      ret?: Array<{ contractRet?: string }>;
    }

    const tx = await tronRpcPost<TronTransaction>(tronHost, '/wallet/gettransactionbyid', {
      value: txId,
      visible: true,
    });

    if (!tx || !tx.raw_data) {
      return jsonResponse(
        { error: 'Transaction not found on Nile. If you just sent it, wait a few seconds and try again.' },
        400
      );
    }

    // ---- (e) validity checks ------------------------------------------------
    if (tx.ret?.[0]?.contractRet !== 'SUCCESS') {
      return jsonResponse({ error: 'Transaction failed on-chain.' }, 400);
    }

    const c = tx.raw_data.contract?.[0];
    if (c?.type !== 'TriggerSmartContract') {
      return jsonResponse({ error: 'Not a TRC20 USDT transfer.' }, 400);
    }

    const v = c.parameter?.value;
    if (!v) {
      return jsonResponse({ error: 'Invalid transaction data.' }, 400);
    }

    if (v.contract_address !== tronUsdtContract) {
      return jsonResponse({ error: 'Transaction is not a USDT transfer.' }, 400);
    }

    if (v.owner_address !== linkedTronAddress) {
      return jsonResponse({ error: 'Transaction was not sent from your linked Tron address.' }, 400);
    }

    const data: string = v.data ?? '';
    if (data.slice(0, 8) !== 'a9059cbb') {
      return jsonResponse({ error: 'Not a TRC20 USDT transfer.' }, 400);
    }

    // Recipient check: extract "to" address from data (32-byte word at offset 8-72)
    // Last 40 hex chars of that word should equal tronBase58ToHex(TRON_HOUSE_ADDRESS)
    const recipientWord = data.slice(8, 72);
    const recipientExpected = tronBase58ToHex(tronHouseAddress);
    if (!recipientExpected) {
      console.error('verify-tron-deposit: invalid house address:', tronHouseAddress);
      return jsonResponse({ error: 'Server misconfigured' }, 500);
    }
    const recipientActual = recipientWord.slice(-40).toLowerCase();
    const recipientExpectedLower = recipientExpected.slice(2).toLowerCase();
    if (recipientActual !== recipientExpectedLower) {
      return jsonResponse({ error: 'Transaction recipient does not match the house address.' }, 400);
    }

    // Amount check: extract from data (32-byte word at offset 72-136)
    const amountSun = BigInt('0x' + data.slice(72, 136));
    if (amountSun <= 0n) {
      return jsonResponse({ error: 'Transaction value must be greater than zero.' }, 400);
    }

    // ---- (f) confirmation check via walletsolidity/gettransactioninfobyid ----
    interface TronTransactionInfo {
      id?: string;
      receipt?: {
        result?: string;
      };
    }

    const info = await tronRpcPost<TronTransactionInfo>(tronHost, '/walletsolidity/gettransactioninfobyid', {
      value: txId,
    });

    if (!info || !info.id) {
      return jsonResponse(
        { error: 'Transaction has not been confirmed yet. Wait a minute and try again.' },
        400
      );
    }

    if (info.receipt?.result !== 'SUCCESS') {
      return jsonResponse({ error: 'Transaction failed on-chain.' }, 400);
    }

    // ---- (g) convert sun -> USDT -----------------------------------------------
    const amountUsdt = Number(amountSun) / 1e6;
    if (amountUsdt < 0.01) {
      return jsonResponse({ error: 'Deposit too small.' }, 400);
    }
    const amountUsdc = amountUsdt; // 1 USDT = 1 play-USDC

    // ---- (h) credit the deposit (idempotent on tx_hash) ----------------------
    const { data: rpcResult, error: rpcError } = await supabase.rpc('credit_deposit', {
      p_user_id: userId,
      p_tx_hash: txId,
      p_amount_eth: null,
      p_amount_usdc: amountUsdc,
      p_chain: 'tron',
    });

    if (rpcError) {
      console.error('verify-tron-deposit: credit_deposit RPC failed:', rpcError.message);
      return jsonResponse({ error: rpcError.message || 'Failed to credit deposit' }, 500);
    }

    const result = rpcResult as { status?: string; amount_usdc?: number } | null;
    if (result?.status === 'duplicate') {
      return jsonResponse(
        { status: 'duplicate', error: 'This deposit has already been credited to an account.' },
        409
      );
    }

    return jsonResponse({
      status: 'confirmed',
      tx_hash: txId,
      amount_usdt: amountUsdt,
      amount_usdc: result?.amount_usdc ?? amountUsdc,
    });
  } catch (err) {
    // never leak internals
    console.error('verify-tron-deposit error:', err instanceof Error ? err.message : String(err));
    return jsonResponse({ error: 'Failed to verify deposit. Please try again.' }, 500);
  }
};

export const config: Config = { path: '/api/verify-tron-deposit' };
