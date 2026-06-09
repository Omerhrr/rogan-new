import { cn } from '@/lib/utils';

interface LoadingSpinnerProps {
  className?: string;
  size?: 'sm' | 'md' | 'lg';
}

export default function LoadingSpinner({ className, size = 'md' }: LoadingSpinnerProps) {
  return (
    <div className={cn('flex items-center justify-center', className)}>
      <div
        className={cn(
          'border-2 border-white/10 border-t-rogan-500 rounded-full animate-spin',
          size === 'sm' && 'w-5 h-5',
          size === 'md' && 'w-8 h-8',
          size === 'lg' && 'w-12 h-12'
        )}
      />
    </div>
  );
}
