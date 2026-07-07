import { useQuery, useQueryClient } from '@tanstack/react-query';
import { BrowserProvider, parseEther } from 'ethers';
import { useState } from 'react';
import { useAuth } from '../hooks/useAuth';
import { useAuthModal } from '../hooks/useAuthModal';
import { useFaucet } from '../hooks/useFaucet';
import { useToast } from '../hooks/useToast';
import { useWallet } from '../hooks/useWallet';
import { getMyDeposits, verifyDeposit } from '../lib/api';
import { formatDateTime, formatUsd } from '../lib/format';

const HOUSE_ADDRESS = (import.meta.env.VITE_HOUSE_ADDRESS as string) || '';
const RATE_USDC_PER_ETH = 3000;
const DEFAULT_AMOUNT = '0.01';

interface DepositModalProps {
  open: boolean;
  onClose: () => void;
}

function truncateAddress(address: string): string {
  if (address.length <= 12) return address;
  return `${address.slice(0, 6)}…${address.slice(-4)}`;
}

type SendState = 'idle' | 'sending' | 'confirming' | 'verifying' | 'error';

export function DepositModal({ open, onClose }: DepositModalProps) {
  const { session } = useAuth();
  const { openAuthModal } = useAuthModal();
  const { showToast } = useToast();
  const queryClient = useQueryClient();
  const {
    hasMetaMask,
    address,
    isCorrectChain,
    connecting,
    switching,
    connect,
    switchToSepolia,
  } = useWallet();
  const faucet = useFaucet();

  const [amount, setAmount] = useState(DEFAULT_AMOUNT);
  const [sendState, setSendState] = useState<SendState>('idle');
  const [sendError, setSendError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const [pasteOpen, setPasteOpen] = useState(false);
  const [pastedHash, setPastedHash] = useState('');
  const [pasteState, setPasteState] = useState<'idle' | 'verifying' | 'error'>('idle');
  const [pasteError, setPasteError] = useState<string | null>(null);

  const { data: deposits } = useQuery({
    queryKey: ['deposits'],
    queryFn: () => getMyDeposits(5),
    enabled: !!session && open,
  });

  if (!open) return null;

  function reset() {
    setAmount(DEFAULT_AMOUNT);
    setSendState('idle');
    setSendError(null);
    setCopied(false);
    setPasteOpen(false);
    setPastedHash('');
    setPasteState('idle');
    setPasteError(null);
  }

  function handleClose() {
    reset();
    onClose();
  }

  async function invalidateAfterCredit() {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ['profile'] }),
      queryClient.invalidateQueries({ queryKey: ['transactions'] }),
      queryClient.invalidateQueries({ queryKey: ['deposits'] }),
    ]);
  }

  async function handleFaucetClaim() {
    const ok = await faucet.claim();
    if (ok) showToast('+$1,000 credited', 'success');
  }

  async function handleCopyAddress() {
    try {
      await navigator.clipboard.writeText(HOUSE_ADDRESS);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard API may be unavailable (e.g. insecure context) — non-fatal.
    }
  }

  async function handleSendDeposit() {
    setSendError(null);

    const parsedAmount = Number(amount);
    if (!Number.isFinite(parsedAmount) || parsedAmount <= 0) {
      setSendState('error');
      setSendError('Enter a valid amount greater than 0.');
      return;
    }
    if (!HOUSE_ADDRESS) {
      setSendState('error');
      setSendError('House address is not configured.');
      return;
    }
    if (!window.ethereum) {
      setSendState('error');
      setSendError('MetaMask is not available.');
      return;
    }

    try {
      setSendState('sending');
      const provider = new BrowserProvider(window.ethereum);
      const signer = await provider.getSigner();
      const tx = await signer.sendTransaction({
        to: HOUSE_ADDRESS,
        value: parseEther(amount),
      });

      setSendState('confirming');
      await tx.wait(1);

      setSendState('verifying');
      const result = await verifyDeposit(tx.hash);
      await invalidateAfterCredit();

      if (result.status === 'duplicate') {
        showToast('This deposit was already credited.', 'info');
      } else {
        showToast(`+${formatUsd(result.amount_usdc ?? 0)} credited`, 'success');
      }
      setSendState('idle');
      setAmount(DEFAULT_AMOUNT);
    } catch (err) {
      setSendState('error');
      setSendError(describeError(err));
    }
  }

  async function handlePasteSubmit() {
    setPasteError(null);
    const trimmed = pastedHash.trim();
    if (!/^0x[0-9a-fA-F]{64}$/.test(trimmed)) {
      setPasteState('error');
      setPasteError('That does not look like a valid transaction hash.');
      return;
    }

    try {
      setPasteState('verifying');
      const result = await verifyDeposit(trimmed);
      await invalidateAfterCredit();

      if (result.status === 'duplicate') {
        showToast('This deposit was already credited.', 'info');
      } else {
        showToast(`+${formatUsd(result.amount_usdc ?? 0)} credited`, 'success');
      }
      setPasteState('idle');
      setPastedHash('');
      setPasteOpen(false);
    } catch (err) {
      setPasteState('error');
      setPasteError(describeError(err));
    }
  }

  const previewUsdc = (Number(amount) || 0) * RATE_USDC_PER_ETH;
  const sending = sendState === 'sending' || sendState === 'confirming' || sendState === 'verifying';

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      onClick={handleClose}
    >
      <div
        className="relative max-h-[85vh] w-full max-w-md overflow-y-auto rounded-2xl border border-border-c bg-white p-6 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="mb-5 text-lg font-extrabold text-text-primary">Add funds</h2>

        {/* Section A: Demo funds */}
        <section className="mb-4 rounded-xl border border-border-c p-4">
          <h3 className="text-sm font-extrabold text-text-primary">Demo funds</h3>
          <p className="mt-1 text-[13px] font-medium text-text-muted">
            Claim $1,000 in free play money once every 24 hours — no wallet needed.
          </p>
          <button
            onClick={handleFaucetClaim}
            disabled={faucet.claiming}
            className="mt-3 rounded-xl bg-teal px-4 py-2 text-sm font-bold text-white transition hover:bg-teal-deep disabled:cursor-not-allowed disabled:opacity-60"
          >
            {faucet.claiming ? 'Claiming…' : 'Claim 1,000 faucet'}
          </button>
          {faucet.error && <p className="mt-2 text-xs font-medium text-no">{faucet.error}</p>}
        </section>

        {/* Section B: Deposit crypto */}
        <section className="rounded-xl border border-border-c p-4">
          <h3 className="text-sm font-extrabold text-text-primary">Deposit crypto (Sepolia testnet)</h3>

          {!session ? (
            <div className="mt-3">
              <p className="text-[13px] font-medium text-text-muted">
                Sign in to deposit Sepolia ETH and back your account.
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
          ) : !hasMetaMask ? (
            <div className="mt-3">
              <p className="text-[13px] font-medium text-text-muted">
                MetaMask is required to deposit crypto.
              </p>
              <a
                href="https://metamask.io"
                target="_blank"
                rel="noreferrer"
                className="mt-3 inline-block rounded-xl bg-teal px-4 py-2 text-sm font-bold text-white transition hover:bg-teal-deep"
              >
                Install MetaMask
              </a>
            </div>
          ) : !address ? (
            <div className="mt-3">
              <p className="text-[13px] font-medium text-text-muted">
                Connect your wallet to deposit Sepolia ETH.
              </p>
              <button
                onClick={() => void connect()}
                disabled={connecting}
                className="mt-3 rounded-xl bg-teal px-4 py-2 text-sm font-bold text-white transition hover:bg-teal-deep disabled:cursor-not-allowed disabled:opacity-60"
              >
                {connecting ? 'Connecting…' : 'Connect MetaMask'}
              </button>
            </div>
          ) : !isCorrectChain ? (
            <div className="mt-3">
              <p className="text-[13px] font-medium text-text-muted">
                Your wallet is on the wrong network. Switch to Sepolia to continue.
              </p>
              <button
                onClick={() => void switchToSepolia()}
                disabled={switching}
                className="mt-3 rounded-xl bg-teal px-4 py-2 text-sm font-bold text-white transition hover:bg-teal-deep disabled:cursor-not-allowed disabled:opacity-60"
              >
                {switching ? 'Switching…' : 'Switch to Sepolia'}
              </button>
            </div>
          ) : (
            <div className="mt-3 flex flex-col gap-3">
              <div className="flex items-center justify-between rounded-lg bg-subtle px-3 py-2 text-[13px] font-semibold text-text-secondary">
                <span>House address</span>
                <span className="flex items-center gap-2">
                  <span className="font-mono">{truncateAddress(HOUSE_ADDRESS)}</span>
                  <button
                    onClick={() => void handleCopyAddress()}
                    className="rounded-md bg-white px-2 py-0.5 text-xs font-bold text-teal-deep transition hover:bg-teal-tint"
                  >
                    {copied ? 'Copied' : 'Copy'}
                  </button>
                </span>
              </div>

              <label className="text-xs font-bold text-text-muted">
                Amount (ETH)
                <input
                  type="number"
                  min="0"
                  step="0.001"
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                  disabled={sending}
                  className="mt-1 w-full rounded-xl border border-[#dfe7ea] bg-white px-3.5 py-2.5 text-sm text-text-primary outline-none focus:border-teal disabled:opacity-60"
                />
              </label>

              <p className="text-xs font-medium text-text-faint">
                1 ETH = {RATE_USDC_PER_ETH.toLocaleString()} USDC (testnet demo rate) — you'll
                receive ≈ {formatUsd(previewUsdc)}
              </p>

              <button
                onClick={() => void handleSendDeposit()}
                disabled={sending}
                className="rounded-xl bg-teal py-2.5 text-sm font-bold text-white transition hover:bg-teal-deep disabled:cursor-not-allowed disabled:opacity-60"
              >
                {sendState === 'sending'
                  ? 'Confirm in wallet…'
                  : sendState === 'confirming'
                    ? 'Waiting for confirmation…'
                    : sendState === 'verifying'
                      ? 'Verifying…'
                      : 'Send deposit'}
              </button>

              {sendState === 'error' && sendError && (
                <p className="text-xs font-medium text-no">{sendError}</p>
              )}

              <div>
                <button
                  onClick={() => setPasteOpen((v) => !v)}
                  className="text-xs font-bold text-teal-deep hover:underline"
                >
                  {pasteOpen ? 'Hide' : 'Already sent? Paste tx hash'}
                </button>
                {pasteOpen && (
                  <div className="mt-2 flex flex-col gap-2">
                    <input
                      type="text"
                      placeholder="0x…"
                      value={pastedHash}
                      onChange={(e) => setPastedHash(e.target.value)}
                      disabled={pasteState === 'verifying'}
                      className="w-full rounded-xl border border-[#dfe7ea] bg-white px-3.5 py-2.5 font-mono text-xs text-text-primary outline-none focus:border-teal disabled:opacity-60"
                    />
                    <button
                      onClick={() => void handlePasteSubmit()}
                      disabled={pasteState === 'verifying' || !pastedHash.trim()}
                      className="rounded-xl bg-subtle py-2 text-xs font-bold text-text-secondary transition hover:bg-[#e4eaec] disabled:cursor-not-allowed disabled:opacity-60"
                    >
                      {pasteState === 'verifying' ? 'Verifying…' : 'Verify transaction'}
                    </button>
                    {pasteState === 'error' && pasteError && (
                      <p className="text-xs font-medium text-no">{pasteError}</p>
                    )}
                  </div>
                )}
              </div>
            </div>
          )}

          {session && deposits && deposits.length > 0 && (
            <div className="mt-4 border-t border-border-c pt-3">
              <h4 className="text-xs font-bold uppercase tracking-wide text-text-faint">
                Recent deposits
              </h4>
              <ul className="mt-2 flex flex-col gap-1.5">
                {deposits.map((d) => (
                  <li
                    key={d.id}
                    className="flex items-center justify-between text-[13px] font-semibold text-text-secondary"
                  >
                    <span className="font-mono text-xs text-text-muted">
                      {truncateAddress(d.tx_hash)}
                    </span>
                    <span className="text-yes">{formatUsd(d.amount_usdc)}</span>
                    <span className="text-xs text-text-faint">
                      {formatDateTime(d.created_at)}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </section>

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

function describeError(err: unknown): string {
  if (err && typeof err === 'object') {
    const code = (err as { code?: number | string }).code;
    if (code === 'ACTION_REJECTED' || code === 4001) {
      return 'Transaction rejected in wallet.';
    }
  }
  if (err instanceof Error) return err.message;
  return 'Something went wrong. Please try again.';
}
