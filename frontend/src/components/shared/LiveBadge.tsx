import { cn } from '@/lib/utils';

interface LiveBadgeProps {
  className?: string;
  size?: 'sm' | 'md' | 'lg';
}

export default function LiveBadge({ className, size = 'sm' }: LiveBadgeProps) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 bg-rogan-600 text-white font-bold rounded-md live-pulse',
        size === 'sm' && 'text-[10px] px-1.5 py-0.5',
        size === 'md' && 'text-xs px-2 py-1',
        size === 'lg' && 'text-sm px-3 py-1.5',
        className
      )}
    >
      <span className="w-1.5 h-1.5 rounded-full bg-white" />
      LIVE
    </span>
  );
}
