// Small formatting helpers shared across components.

export function formatUsd(amount: number | null | undefined): string {
  const n = Number(amount ?? 0);
  return `$${n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export function formatCents(price: number | null | undefined): string {
  const n = Number(price ?? 0);
  return `${Math.round(n * 100)}¢`;
}

export function formatPercent(price: number | null | undefined): string {
  const n = Number(price ?? 0);
  return `${(n * 100).toFixed(1)}%`;
}

export function formatShares(shares: number | null | undefined): string {
  const n = Number(shares ?? 0);
  return n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export function formatDate(iso: string | null | undefined): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

export function formatDateTime(iso: string | null | undefined): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}
