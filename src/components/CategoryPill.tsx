import { getCategoryStyle } from '../lib/categoryStyle';

interface CategoryPillProps {
  category: string | null | undefined;
  className?: string;
}

export function CategoryPill({ category, className }: CategoryPillProps) {
  const style = getCategoryStyle(category);
  return (
    <span
      className={`inline-block rounded-full px-2.5 py-1 text-[11.5px] font-bold uppercase tracking-wide ${className ?? ''}`}
      style={{ background: style.bg, color: style.text }}
    >
      {category || 'Other'}
    </span>
  );
}
