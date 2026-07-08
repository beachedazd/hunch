import { createClient } from '@supabase/supabase-js';
import type { Config, Context } from '@netlify/functions';
import { decodeBase58, sha256, Wallet, JsonRpcProvider, parseEther, SigningKey } from 'ethers';

// Handles withdrawals for both Sepolia (ETH) and Tron (TRX/USDT).
//
// Contract:
//   POST /api/withdraw
//   Headers: Authorization: Bearer <supabase access token>
//   Body:    { "chain": "sepolia"|"tron", "amountUsdc": number, "destAddress": string }
//
//   200 { status: 'sent', withdrawal_id, tx_hash, chain, amount_usdc, amount_native, explorer_url }
//   400 { error: string } (validation, insufficient balance)
//   401/405/500 { error: string }
//   502 { error: string } (payout failed + refund message)

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

// Convert hex string to ASCII if it looks like hex, else return as-is
function hexToAscii(hex: string): string {
  if (!/^[0-9a-fA-F]*$/.test(hex) || hex.length % 2 !== 0) return hex;
  try {
    return Buffer.from(hex, 'hex').toString('utf-8');
  } catch {
    return hex;
  }
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
  const sepoliaRpcUrl = Netlify.env.get('SEPOLIA_RPC_URL');
  const housePrivateKey = Netlify.env.get('HOUSE_PRIVATE_KEY');
  const tronHost = Netlify.env.get('TRON_FULL_HOST');
  const tronUsdtContract = Netlify.env.get('TRON_USDT_CONTRACT');
  const tronHouseAddress = Netlify.env.get('TRON_HOUSE_ADDRESS');
  const tronHousePrivateKey = Netlify.env.get('TRON_HOUSE_PRIVATE_KEY');

  if (
    !supabaseUrl ||
    !serviceRoleKey ||
    !sepoliaRpcUrl ||
    !housePrivateKey ||
    !tronHost ||
    !tronUsdtContract ||
    !tronHouseAddress ||
    !tronHousePrivateKey
  ) {
    console.error('withdraw: missing one or more required environment variables');
    return jsonResponse({ error: 'Server misconfigured' }, 500);
  }

  // ---- (a) verify the caller via their Supabase access token ----------------
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
    // ---- (b) parse and validate body ------------------------------------------
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

    const chain = typeof bodyObj.chain === 'string' ? bodyObj.chain.trim() : '';
    if (chain !== 'sepolia' && chain !== 'tron') {
      return jsonResponse({ error: 'Invalid chain. Must be "sepolia" or "tron".' }, 400);
    }

    const rawAmount = bodyObj.amountUsdc;
    if (typeof rawAmount !== 'number' || !isFinite(rawAmount)) {
      return jsonResponse({ error: 'amountUsdc must be a finite number.' }, 400);
    }

    let amountUsdc = Math.round(rawAmount * 1e6) / 1e6;
    if (amountUsdc < 1 || amountUsdc > 100000) {
      return jsonResponse({ error: 'amountUsdc must be between 1 and 100000.' }, 400);
    }

    const destAddress = typeof bodyObj.destAddress === 'string' ? bodyObj.destAddress.trim() : '';
    if (!destAddress) {
      return jsonResponse({ error: 'destAddress is required.' }, 400);
    }

    // ---- (c) per-chain validation and native amount calculation ---------------
    let amountNative: number;

    if (chain === 'sepolia') {
      if (!/^0x[0-9a-fA-F]{40}$/.test(destAddress)) {
        return jsonResponse({ error: 'Invalid Ethereum address.' }, 400);
      }
      const RATE_USDC_PER_ETH = 3000;
      amountNative = Math.round((amountUsdc / RATE_USDC_PER_ETH) * 1e6) / 1e6;
    } else {
      // chain === 'tron'
      if (!tronBase58ToHex(destAddress)) {
        return jsonResponse({ error: 'Invalid Tron address.' }, 400);
      }
      amountNative = amountUsdc;
    }

    // ---- (d) debit first (create withdrawal record) ---------------------------
    const { data: withdrawalData, error: withdrawalError } = await supabase.rpc(
      'create_withdrawal',
      {
        p_user_id: userId,
        p_chain: chain,
        p_dest_address: destAddress,
        p_amount_usdc: amountUsdc,
        p_amount_native: amountNative,
      }
    );

    if (withdrawalError) {
      console.error('withdraw: create_withdrawal RPC failed:', withdrawalError.message);
      return jsonResponse({ error: withdrawalError.message || 'Failed to create withdrawal' }, 400);
    }

    const withdrawal = withdrawalData as { withdrawal_id?: string } | null;
    const withdrawalId = withdrawal?.withdrawal_id;
    if (!withdrawalId) {
      console.error('withdraw: create_withdrawal returned no withdrawal_id');
      return jsonResponse({ error: 'Failed to create withdrawal' }, 500);
    }

    // ---- (e) send payout (inside try/catch for error recovery) ----------------
    let txHash: string;
    let explorerUrl: string;

    try {
      if (chain === 'sepolia') {
        // Sepolia withdrawal
        const wallet = new Wallet(housePrivateKey, new JsonRpcProvider(sepoliaRpcUrl));
        const ethAmount = (amountUsdc / 3000).toFixed(12);
        const tx = await wallet.sendTransaction({
          to: destAddress,
          value: parseEther(ethAmount),
        });
        txHash = tx.hash;
        explorerUrl = `https://sepolia.etherscan.io/tx/${txHash}`;
      } else {
        // Tron withdrawal
        const pad64 = (s: string) => s.padStart(64, '0');
        const destHex = tronBase58ToHex(destAddress)!;
        const amountSun = BigInt(Math.round(amountUsdc * 1e6));
        const parameter = pad64(destHex) + pad64(amountSun.toString(16));

        // Step a: Build transaction
        interface TronBuildResponse {
          result?: {
            result?: boolean;
            message?: string;
          };
          transaction?: {
            txID?: string;
          };
        }

        const buildResp = await tronRpcPost<TronBuildResponse>(tronHost, '/wallet/triggersmartcontract', {
          owner_address: tronHouseAddress,
          contract_address: tronUsdtContract,
          function_selector: 'transfer(address,uint256)',
          parameter,
          fee_limit: 100000000,
          call_value: 0,
          visible: true,
        });

        if (!buildResp?.result?.result || !buildResp?.transaction?.txID) {
          const message = buildResp?.result?.message
            ? hexToAscii(buildResp.result.message)
            : 'Failed to build Tron transaction';
          throw new Error(message);
        }

        // Step b: Sign transaction
        const txIdToSign = buildResp.transaction.txID;
        const sig = new SigningKey('0x' + tronHousePrivateKey).sign('0x' + txIdToSign);
        const signatureHex = sig.r.slice(2) + sig.s.slice(2) + (sig.yParity === 1 ? '01' : '00');

        // Step c: Broadcast transaction
        interface TronBroadcastResponse {
          result?: boolean;
          message?: string;
          code?: string;
        }

        const bres = await tronRpcPost<TronBroadcastResponse>(tronHost, '/wallet/broadcasttransaction', {
          ...buildResp.transaction,
          signature: [signatureHex],
        });

        if (!bres?.result) {
          const message = bres?.message
            ? hexToAscii(bres.message)
            : bres?.code || 'Broadcast failed';
          throw new Error(message);
        }

        txHash = txIdToSign;
        explorerUrl = `https://nile.tronscan.org/#/transaction/${txHash}`;
      }
    } catch (payoutErr) {
      // Payout failed; try to refund
      const reason = payoutErr instanceof Error ? payoutErr.message : String(payoutErr);
      const trimmedReason = reason.slice(0, 200);

      const { error: failError } = await supabase.rpc('fail_withdrawal', {
        p_withdrawal_id: withdrawalId,
        p_error: trimmedReason,
      });

      if (failError) {
        console.error('withdraw: fail_withdrawal RPC also failed:', failError.message);
        return jsonResponse({ error: 'Payout failed. Please contact support.' }, 500);
      }

      return jsonResponse(
        { error: `Payout failed and your balance has been refunded. ${trimmedReason}` },
        502
      );
    }

    // ---- (f) finalize withdrawal (if payout succeeded) -------------------------
    const { error: finalizeError } = await supabase.rpc('finalize_withdrawal', {
      p_withdrawal_id: withdrawalId,
      p_tx_hash: txHash,
    });

    if (finalizeError) {
      console.error('withdraw: finalize_withdrawal RPC failed:', finalizeError.message);
      // Payout happened, so still return 200; just log the DB error
    }

    return jsonResponse({
      status: 'sent',
      withdrawal_id: withdrawalId,
      tx_hash: txHash,
      chain,
      amount_usdc: amountUsdc,
      amount_native: amountNative,
      explorer_url: explorerUrl,
    });
  } catch (err) {
    // never leak internals
    console.error('withdraw error:', err instanceof Error ? err.message : String(err));
    return jsonResponse({ error: 'Failed to process withdrawal. Please try again.' }, 500);
  }
};

export const config: Config = { path: '/api/withdraw' };
