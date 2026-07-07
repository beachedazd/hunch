import clsx from 'clsx';

export function Skeleton({ className }: { className?: string }) {
  return <div className={clsx('skeleton', className)} />;
}

export function MarketCardSkeleton() {
  return (
    <div className="flex flex-col gap-3 rounded-2xl border border-border-c bg-white p-[18px]">
      <div className="flex items-center justify-between">
        <Skeleton className="h-5 w-20 rounded-full" />
        <Skeleton className="h-3.5 w-10" />
      </div>
      <Skeleton className="h-4 w-full" />
      <Skeleton className="h-4 w-2/3" />
      <div className="flex gap-2">
        <Skeleton className="h-10 flex-1 rounded-xl" />
        <Skeleton className="h-10 flex-1 rounded-xl" />
      </div>
      <Skeleton className="h-3 w-24" />
    </div>
  );
}
