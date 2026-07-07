// Category chip color mapping — from the Hunch design handoff.
// DB has 'Business' where the design shows 'Weird'; we reuse the pink swatch.

export interface CategoryStyle {
  bg: string;
  text: string;
}

const CATEGORY_STYLES: Record<string, CategoryStyle> = {
  Politics: { bg: '#e6f0fa', text: '#2b6cb0' },
  Sports: { bg: '#fdf3d8', text: '#b8860b' },
  Crypto: { bg: '#fbeedd', text: '#8a5a0b' },
  'Pop Culture': { bg: '#f3ecfa', text: '#7a4fa3' },
  Science: { bg: '#e4f4ec', text: '#2f7d5c' },
  Business: { bg: '#fbe9f2', text: '#b8548a' },
};

const FALLBACK_STYLE: CategoryStyle = { bg: '#eef3f4', text: '#48606c' };

export function getCategoryStyle(category: string | null | undefined): CategoryStyle {
  if (!category) return FALLBACK_STYLE;
  return CATEGORY_STYLES[category] ?? FALLBACK_STYLE;
}
