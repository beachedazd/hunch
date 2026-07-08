import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useAuth } from '../hooks/useAuth';
import { useAuthModal } from '../hooks/useAuthModal';
import { useToast } from '../hooks/useToast';
import { getMyWithdrawals, requestWithdrawal } from '../lib/api';
import { formatUsd } from '../lib/format';

const RATE_USDC_PER_ETH = 3000;

interface WithdrawModalProps {
  open: boolean;
  onClose: () => void;
}

type WithdrawChain = 'sepolia' | 'tron';
type SubmitState = 'idle' | 'submitting' | 'success' | 'error';

function truncateAddress(address: string): string {
  if (address.length <= 12) return address;
  return `${address.slice(0, 6)}…${address.slice(-4)}`;
}

function getExplorerUrl(chain: WithdrawChain, txHash: string): string {
  if (chain === 'sepolia') {
    return `https://sepolia.etherscan.io/tx/${txHash}`;
  }
  return `https://nile.tronscan.org/#/transaction/${txHash}`;
}

export function WithdrawModal({ open, onClose }: WithdrawModalProps) {
  const { session, profile } = useAuth();
  const { openAuthModal } = useAuthModal();
  const { showToast } = useToast();
  const queryClient = useQueryClient();

  const [withdrawChain, setWithdrawChain] = useState<WithdrawChain>('sepolia');
  const [amount, setAmount] = useState('');
  const [destAddress, setDestAddress] = useState('');
  const [submitState, setSubmitState] = useState<SubmitState>('idle');
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [successTxHash, setSuccessTxHash] = useState<string | null>(null);
  const [successExplorerUrl, setSuccessExplorerUrl] = useState<string | null>(null);

  const balance = profile?.balance ?? 0;

  const { data: withdrawals } = useQuery({
    queryKey: ['withdrawals'],
    queryFn: () => getMyWithdrawals(5),
    enabled: !!session && open,
  });

  if (!open) return null;

  function reset() {
    setAmount('');
    setDestAddress('');
    setSubmitState('idle');
    setSubmitError(null);
    setSuccessTxHash(null);
    setSuccessExplorerUrl(null);
  }

  function handleClose() {
    reset();
    onClose();
  }

  async function invalidateAfterWithdraw() {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ['profile'] }),
      queryClient.invalidateQueries({ queryKey: ['transactions'] }),
      queryClient.invalidateQueries({ queryKey: ['withdrawals'] }),
    ]);
  }

  function validateAmount(): string | null {
    const parsedAmount = Number(amount);
    if (!Number.isFinite(parsedAmount)) {
      return 'Enter an amount';
    }
    if (parsedAmount < 1) {
      return 'Enter an amount between $1 and your balance';
    }
    if (parsedAmount > balance) {
      return 'Enter an amount between $1 and your balance';
    }
    return null;
  }

  function validateAddress(): string | null {
    const trimmed = destAddress.trim();
    if (!trimmed) {
      return `Enter a valid ${withdrawChain === 'sepolia' ? 'Ethereum' : 'Tron'} address`;
    }
    if (withdrawChain === 'sepolia') {
      if (!/^0x[0-9a-fA-F]{40}$/.test(trimmed)) {
        return 'Enter a valid Ethereum address';
      }
    } else {
      if (!/^T[1-9A-HJ-NP-Za-km-z]{33}$/.test(trimmed)) {
        return 'Enter a valid Tron address';
      }
    }
    return null;
  }

  async function handleSubmit() {
    setSubmitError(null);

    const amountErr = validateAmount();
    if (amountErr) {
      setSubmitError(amountErr);
      return;
    }

    const addressErr = validateAddress();
    if (addressErr) {
      setSubmitError(addressErr);
      return;
    }

    try {
      setSubmitState('submitting');
      const result = await requestWithdrawal({
        chain: withdrawChain,
        amountUsdc: Number(amount),
        destAddress: destAddress.trim(),
      });

      await invalidateAfterWithdraw();

      setSubmitState('success');
      setSuccessTxHash(result.tx_hash);
      setSuccessExplorerUrl(result.explorer_url);
      showToast('Withdrawal sent', 'success');
      setAmount('');
      setDestAddress('');

      setTimeout(() => {
        handleClose();
      }, 3000);
    } catch (err) {
      setSubmitState('error');
      setSubmitError(err instanceof Error ? err.message : 'Withdrawal failed');
    }
  }

  const amountNum = Number(amount) || 0;
  const ethPreview = withdrawChain === 'sepolia' ? amountNum / RATE_USDC_PER_ETH : amountNum;
  const ethFormatted =
    withdrawChain === 'sepolia' ? ethPreview.toFixed(6) : ethPreview.toFixed(2);
  const ethLabel = withdrawChain === 'sepolia' ? 'ETH' : 'USDT';

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      onClick={handleClose}
    >
      <div
        className="relative max-h-[85vh] w-full max-w-md overflow-y-auto rounded-2xl border border-border-c bg-white p-6 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="mb-5 text-lg font-extrabold text-text-primary">Withdraw funds</h2>

        {!session ? (
          <div className="mt-3">
            <p className="text-[13px] font-medium text-text-muted">
              Sign in to withdraw funds to your wallet.
            </p>
            <button
              onClick={() => {
                handleClose();
                openAuthModal('signin');
              }}
              className="mt-3 rounded-xl bg-teal px-4 py-2 text-sm font-bold text-white transition hover:bg-teal-deep"
            >
              Sign in
            </button>
          </div>
        ) : (
          <>
            {/* Available balance */}
            <div className="mb-4 rounded-lg bg-subtle px-3 py-2.5 text-sm font-semibold text-text-secondary">
              <span className="text-text-muted">Available:</span>{' '}
              <span className="text-text-primary">{formatUsd(balance)}</span>
            </div>

            {/* Chain tabs */}
            <div className="mb-4 flex gap-2">
              <button
                onClick={() => setWithdrawChain('sepolia')}
                className={`flex-1 rounded-xl py-2 text-sm font-bold transition ${
                  withdrawChain === 'sepolia'
                    ? 'bg-teal text-white'
                    : 'bg-subtle text-text-secondary hover:bg-[#e4eaec]'
                }`}
              >
                ETH · Sepolia
              </button>
              <button
                onClick={() => setWithdrawChain('tron')}
                className={`flex-1 rounded-xl py-2 text-sm font-bold transition ${
                  withdrawChain === 'tron'
                    ? 'bg-teal text-white'
                    : 'bg-subtle text-text-secondary hover:bg-[#e4eaec]'
                }`}
              >
                USDT · Tron
              </button>
            </div>

            {/* Amount input */}
            <label className="text-xs font-bold text-text-muted">
              Amount (USD)
              <div className="mt-1 flex gap-2">
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                  disabled={submitState === 'submitting'}
                  className="flex-1 rounded-xl border border-[#dfe7ea] bg-white px-3.5 py-2.5 text-sm text-text-primary outline-none focus:border-teal disabled:opacity-60"
                  placeholder="0.00"
                />
                <button
                  onClick={() => setAmount(String(Math.floor(balance * 100) / 100))}
                  disabled={submitState === 'submitting'}
                  className="rounded-xl bg-subtle px-3 py-2.5 text-xs font-bold text-text-secondary transition hover:bg-[#e4eaec] disabled:opacity-60"
                >
                  Max
                </button>
              </div>
            </label>

            {/* Destination address */}
            <label className="mt-3 block text-xs font-bold text-text-muted">
              {withdrawChain === 'sepolia' ? 'Ethereum' : 'Tron'} address
              <input
                type="text"
                value={destAddress}
                onChange={(e) => setDestAddress(e.target.value)}
                disabled={submitState === 'submitting'}
                placeholder={
                  withdrawChain === 'sepolia' ? '0x…' : 'T…'
                }
                className="mt-1 w-full rounded-xl border border-[#dfe7ea] bg-white px-3.5 py-2.5 font-mono text-sm text-text-primary outline-none focus:border-teal disabled:opacity-60"
              />
            </label>

            {/* Live preview */}
            {amountNum > 0 && !validateAmount() && (
              <p className="mt-3 text-xs font-medium text-text-faint">
                You'll receive ≈{' '}
                <span className="font-bold text-text-primary">
                  {ethFormatted} {ethLabel}
                </span>
                {withdrawChain === 'sepolia'
                  ? ' (1 ETH = 3,000 USDC)'
                  : ' (1:1)'}
              </p>
            )}

            {/* Submit button */}
            <button
              onClick={() => void handleSubmit()}
              disabled={submitState === 'submitting'}
              className="mt-4 w-full rounded-xl bg-teal py-2.5 text-sm font-bold text-white transition hover:bg-teal-deep disabled:cursor-not-allowed disabled:opacity-60"
            >
              {submitState === 'submitting' ? 'Processing…' : 'Withdraw'}
            </button>

            {/* Errors */}
            {submitError && (
              <p className="mt-2 text-xs font-medium text-no">{submitError}</p>
            )}

            {/* Success state */}
            {submitState === 'success' && successTxHash && successExplorerUrl && (
              <div className="mt-3 rounded-lg bg-yes-bg/50 px-3 py-2.5">
                <p className="text-xs font-medium text-yes">
                  Withdrawal sent!{' '}
                  <a
                    href={successExplorerUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="font-bold text-teal-deep hover:underline"
                  >
                    {truncateAddress(successTxHash)}
                  </a>
                </p>
              </div>
            )}

            {/* Recent withdrawals */}
            {session && withdrawals && withdrawals.length > 0 && (
              <div className="mt-5 border-t border-border-c pt-3">
                <h4 className="text-xs font-bold uppercase tracking-wide text-text-faint">
                  Recent withdrawals
                </h4>
                <ul className="mt-2 flex flex-col gap-1.5">
                  {withdrawals.map((w) => (
                    <li
                      key={w.id}
                      className="flex items-center justify-between text-[13px] font-semibold text-text-secondary"
                    >
                      <div className="flex items-center gap-2">
                        <span>{formatUsd(w.amount_usdc)}</span>
                        <span className="text-xs text-text-muted">
                          {w.chain === 'sepolia' ? 'ETH' : 'USDT'}
                        </span>
                        <span
                          className={`rounded-full px-2 py-0.5 text-xs font-bold ${
                            w.status === 'sent'
                              ? 'bg-yes-bg text-yes'
                              : w.status === 'pending'
                                ? 'bg-[#fef3c7] text-[#b45309]'
                                : 'bg-no-bg text-no'
                          }`}
                        >
                          {w.status}
                        </span>
                      </div>
                      {w.tx_hash && (
                        <a
                          href={getExplorerUrl(w.chain, w.tx_hash)}
                          target="_blank"
                          rel="noreferrer"
                          className="text-xs font-mono text-teal-deep hover:underline"
                        >
                          {truncateAddress(w.tx_hash)}
                        </a>
                      )}
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </>
        )}

        <button
          onClick={handleClose}
          className="absolute right-4 top-4 text-text-muted transition hover:text-text-primary"
          aria-label="Close"
        >
          ✕
        </button>
      </div>
    </div>
  );
}
