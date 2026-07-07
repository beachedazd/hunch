import { BrowserProvider } from 'ethers';
import type { ReactNode } from 'react';
import { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { updateWalletAddress } from '../lib/api';
import { useAuth } from './useAuth';

// Sepolia testnet (chainId 11155111 / 0xaa36a7). Falls back to the Sepolia
// chain id if VITE_CHAIN_ID isn't set, so the app still behaves sensibly in
// a misconfigured environment rather than throwing at import time.
export const TARGET_CHAIN_ID = Number(import.meta.env.VITE_CHAIN_ID ?? 11155111);
const TARGET_CHAIN_ID_HEX = `0x${TARGET_CHAIN_ID.toString(16)}`;

interface WalletContextValue {
  hasMetaMask: boolean;
  address: string | null;
  chainId: number | null;
  isCorrectChain: boolean;
  connecting: boolean;
  switching: boolean;
  connect: () => Promise<void>;
  switchToSepolia: () => Promise<void>;
  disconnect: () => void;
}

const WalletContext = createContext<WalletContextValue | undefined>(undefined);

export function WalletProvider({ children }: { children: ReactNode }) {
  const { session, refetchProfile } = useAuth();
  const [address, setAddress] = useState<string | null>(null);
  const [chainId, setChainId] = useState<number | null>(null);
  const [connecting, setConnecting] = useState(false);
  const [switching, setSwitching] = useState(false);

  const hasMetaMask = typeof window !== 'undefined' && !!window.ethereum;

  // Subscribe to wallet-driven changes (account switch, network switch) and
  // bootstrap current state on mount without prompting the user.
  useEffect(() => {
    const eth = window.ethereum;
    if (!eth) return;

    let cancelled = false;

    eth
      .request({ method: 'eth_accounts' })
      .then((accounts) => {
        if (!cancelled) setAddress(((accounts as string[]) ?? [])[0] ?? null);
      })
      .catch(() => {});

    eth
      .request({ method: 'eth_chainId' })
      .then((cid) => {
        if (!cancelled) setChainId(parseInt(cid as string, 16));
      })
      .catch(() => {});

    function handleAccountsChanged(...args: unknown[]) {
      const accounts = (args[0] as string[]) ?? [];
      setAddress(accounts[0] ?? null);
    }

    function handleChainChanged(...args: unknown[]) {
      const cid = args[0] as string;
      setChainId(parseInt(cid, 16));
    }

    eth.on?.('accountsChanged', handleAccountsChanged);
    eth.on?.('chainChanged', handleChainChanged);

    return () => {
      cancelled = true;
      eth.removeListener?.('accountsChanged', handleAccountsChanged);
      eth.removeListener?.('chainChanged', handleChainChanged);
    };
  }, []);

  const connect = useCallback(async () => {
    const eth = window.ethereum;
    if (!eth) return;

    setConnecting(true);
    try {
      const provider = new BrowserProvider(eth);
      const accounts = (await provider.send('eth_requestAccounts', [])) as string[];
      const acct = accounts[0] ?? null;
      setAddress(acct);

      const network = await provider.getNetwork();
      setChainId(Number(network.chainId));

      if (acct && session) {
        try {
          await updateWalletAddress(acct);
          await refetchProfile();
        } catch {
          // Non-fatal: wallet is connected client-side even if persisting
          // the address to the profile row fails (e.g. transient network).
        }
      }
    } finally {
      setConnecting(false);
    }
  }, [session, refetchProfile]);

  const switchToSepolia = useCallback(async () => {
    const eth = window.ethereum;
    if (!eth) return;

    setSwitching(true);
    try {
      try {
        await eth.request({
          method: 'wallet_switchEthereumChain',
          params: [{ chainId: TARGET_CHAIN_ID_HEX }],
        });
      } catch (err) {
        // 4902: chain not added to the wallet yet — add it, then switch.
        const code = (err as { code?: number })?.code;
        if (code === 4902) {
          await eth.request({
            method: 'wallet_addEthereumChain',
            params: [
              {
                chainId: TARGET_CHAIN_ID_HEX,
                chainName: 'Sepolia',
                nativeCurrency: { name: 'Sepolia ETH', symbol: 'ETH', decimals: 18 },
                rpcUrls: ['https://rpc.sepolia.org'],
                blockExplorerUrls: ['https://sepolia.etherscan.io'],
              },
            ],
          });
        } else {
          throw err;
        }
      }

      const provider = new BrowserProvider(eth);
      const network = await provider.getNetwork();
      setChainId(Number(network.chainId));
    } finally {
      setSwitching(false);
    }
  }, []);

  const disconnect = useCallback(() => {
    // MetaMask has no programmatic "disconnect" — this just clears local
    // state so the app stops treating the wallet as connected.
    setAddress(null);
  }, []);

  const isCorrectChain = chainId !== null && chainId === TARGET_CHAIN_ID;

  const value: WalletContextValue = {
    hasMetaMask,
    address,
    chainId,
    isCorrectChain,
    connecting,
    switching,
    connect,
    switchToSepolia,
    disconnect,
  };

  return <WalletContext.Provider value={value}>{children}</WalletContext.Provider>;
}

export function useWallet(): WalletContextValue {
  const ctx = useContext(WalletContext);
  if (!ctx) throw new Error('useWallet must be used within a WalletProvider');
  return ctx;
}
