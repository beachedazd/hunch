// Ambient type declarations for the browser's injected wallet provider
// (MetaMask et al., per EIP-1193). Kept minimal — just enough to satisfy
// ethers' `Eip1193Provider` shape and our own event subscriptions.
export {};

interface Eip1193RequestArgs {
  method: string;
  params?: unknown[] | Record<string, unknown>;
}

interface Eip1193EventProvider {
  isMetaMask?: boolean;
  request: (args: Eip1193RequestArgs) => Promise<unknown>;
  on?: (event: string, handler: (...args: unknown[]) => void) => void;
  removeListener?: (event: string, handler: (...args: unknown[]) => void) => void;
}

declare global {
  interface Window {
    ethereum?: Eip1193EventProvider;
  }
}
