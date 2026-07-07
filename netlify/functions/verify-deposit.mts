import { createClient } from '@supabase/supabase-js';
import type { Config, Context } from '@netlify/functions';

// Verifies a Sepolia deposit tx on-chain and credits the caller's balance.
//
// Contract:
//   POST /api/verify-deposit
//   Headers: Authorization: Bearer <supabase access token>
//   Body:    { "txHash": "0x..." }
//
//   200 { status: 'confirmed', tx_hash, amount_eth, amount_usdc }
//   409 { status: 'duplicate', error: string }   -- tx already credited
//   400/401/500 { error: string }

const TX_HASH_RE = /^0x[0-9a-fA-F]{64}$/;
const RATE_USDC_PER_ETH = 3000;
const WEI_PER_MICRO_ETH = 1_000_000_000_000n; // 1e12 wei == 1e-6 ETH

interface JsonRpcResponse<T> {
  jsonrpc: '2.0';
  id: number;
  result?: T;
  error?: { code: number; message: string };
}

interface EthTransaction {
  from: string;
  to: string | null;
  value: string; // hex wei
}

interface EthTransactionReceipt {
  status: string; // '0x1' success, '0x0' failure
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

async function rpcCall<T>(rpcUrl: string, method: string, params: unknown[]): Promise<T | null> {
  const res = await fetch(rpcUrl, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
  });

  if (!res.ok) {
    throw new Error(`RPC request failed with HTTP ${res.status}`);
  }

  const payload = (await res.json()) as JsonRpcResponse<T>;
  if (payload.error) {
    throw new Error(payload.error.message || 'RPC error');
  }
  return payload.result ?? null;
}

export default async (req: Request, _context: Context): Promise<Response> => {
  if (req.method !== 'POST') {
    return jsonResponse({ error: 'Method not allowed' }, 405);
  }

  const supabaseUrl = Netlify.env.get('SUPABASE_URL');
  const serviceRoleKey = Netlify.env.get('SUPABASE_SERVICE_ROLE_KEY');
  const rpcUrl = Netlify.env.get('SEPOLIA_RPC_URL');
  const houseAddress = Netlify.env.get('HOUSE_ADDRESS');

  if (!supabaseUrl || !serviceRoleKey || !rpcUrl || !houseAddress) {
    console.error('verify-deposit: missing one or more required environment variables');
    return jsonResponse({ error: 'Server misconfigured' }, 500);
  }

  // ---- (a) validate body / tx hash format ----------------------------------
  let body: { txHash?: unknown };
  try {
    body = await req.json();
  } catch {
    return jsonResponse({ error: 'Invalid JSON body' }, 400);
  }

  const txHash = typeof body.txHash === 'string' ? body.txHash.trim() : '';
  if (!TX_HASH_RE.test(txHash)) {
    return jsonResponse({ error: 'Invalid transaction hash' }, 400);
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
    // ---- (c) fetch tx + receipt from Sepolia via raw JSON-RPC -------------
    const [tx, receipt] = await Promise.all([
      rpcCall<EthTransaction>(rpcUrl, 'eth_getTransactionByHash', [txHash]),
      rpcCall<EthTransactionReceipt>(rpcUrl, 'eth_getTransactionReceipt', [txHash]),
    ]);

    if (!tx) {
      return jsonResponse(
        { error: 'Transaction not found on Sepolia. If you just sent it, wait a few seconds and try again.' },
        400
      );
    }
    if (!receipt) {
      return jsonResponse(
        { error: 'Transaction has not been mined yet. Wait for confirmation and try again.' },
        400
      );
    }

    // ---- (d) validity checks -------------------------------------------
    if (receipt.status !== '0x1') {
      return jsonResponse({ error: 'Transaction failed on-chain.' }, 400);
    }

    const to = typeof tx.to === 'string' ? tx.to.toLowerCase() : '';
    if (to !== houseAddress.toLowerCase()) {
      return jsonResponse({ error: 'Transaction recipient does not match the house address.' }, 400);
    }

    // The tx sender must be the wallet linked to this account, so one user
    // can't claim another user's deposit by pasting its hash first.
    const { data: profile, error: profileError } = await supabase
      .from('profiles')
      .select('wallet_address')
      .eq('id', userId)
      .single();
    if (profileError) {
      console.error('verify-deposit: profile lookup failed:', profileError.message);
      return jsonResponse({ error: 'Failed to verify deposit. Please try again.' }, 500);
    }
    const linkedWallet = (profile?.wallet_address ?? '').toLowerCase();
    if (!linkedWallet) {
      return jsonResponse({ error: 'Connect your wallet before verifying a deposit.' }, 400);
    }
    if ((tx.from ?? '').toLowerCase() !== linkedWallet) {
      return jsonResponse({ error: 'Transaction was not sent from your linked wallet.' }, 400);
    }

    const valueHex = typeof tx.value === 'string' ? tx.value : '0x0';
    const valueWei = BigInt(valueHex);
    if (valueWei <= 0n) {
      return jsonResponse({ error: 'Transaction value must be greater than zero.' }, 400);
    }

    // ---- (e) convert wei -> ETH -> USDC (avoid float precision loss on
    // the wei->ETH step by dividing the BigInt down to micro-ETH first) ----
    const microEth = valueWei / WEI_PER_MICRO_ETH;
    const amountEth = Number(microEth) / 1e6;
    const amountUsdc = Math.round(amountEth * RATE_USDC_PER_ETH * 1e6) / 1e6;

    // ---- (f) credit the deposit (idempotent on tx_hash) -----------------
    const { data: rpcResult, error: rpcError } = await supabase.rpc('credit_deposit', {
      p_user_id: userId,
      p_tx_hash: txHash,
      p_amount_eth: amountEth,
      p_amount_usdc: amountUsdc,
    });

    if (rpcError) {
      console.error('verify-deposit: credit_deposit RPC failed:', rpcError.message);
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
      tx_hash: txHash,
      amount_eth: amountEth,
      amount_usdc: result?.amount_usdc ?? amountUsdc,
    });
  } catch (err) {
    // ---- (g) never leak internals (and never log the service key) -------
    console.error('verify-deposit error:', err instanceof Error ? err.message : String(err));
    return jsonResponse({ error: 'Failed to verify deposit. Please try again.' }, 500);
  }
};

export const config: Config = { path: '/api/verify-deposit' };
