'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { Users, ChevronUp, ChevronDown, Play } from 'lucide-react';
import { useStreamStore } from '@/stores/streamStore';
import { useIsMobile } from '@/hooks/use-mobile';
import { formatCount } from '@/lib/utils';
import LiveBadge from '@/components/shared/LiveBadge';
import LoadingSpinner from '@/components/shared/LoadingSpinner';
import EmptyState from '@/components/shared/EmptyState';
import { cn } from '@/lib/utils';
import type { Stream } from '@/types';

interface LiveFeedProps {
  onOpenStream: (streamId: string) => void;
}

export default function LiveFeed({ onOpenStream }: LiveFeedProps) {
  const { streams, fetchLiveStreams, isLoading, hasMore, page } = useStreamStore();
  const isMobile = useIsMobile(960);
  const [currentIndex, setCurrentIndex] = useState(0);
  const feedRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    fetchLiveStreams(1);
  }, [fetchLiveStreams]);

  const loadMore = useCallback(() => {
    if (hasMore && !isLoading) {
      fetchLiveStreams(page + 1);
    }
  }, [hasMore, isLoading, page, fetchLiveStreams]);

  // Mobile: Swipe navigation
  const handleWheel = useCallback((e: React.WheelEvent) => {
    if (!isMobile) return;
    e.preventDefault();
    if (e.deltaY > 0 && currentIndex < streams.length - 1) {
      setCurrentIndex((i) => i + 1);
    } else if (e.deltaY < 0 && currentIndex > 0) {
      setCurrentIndex((i) => i - 1);
    }
  }, [isMobile, currentIndex, streams.length]);

  const handleKeyDown = useCallback((e: KeyboardEvent) => {
    if (!isMobile) return;
    if (e.key === 'ArrowDown' || e.key === 'j') {
      setCurrentIndex((i) => Math.min(i + 1, streams.length - 1));
    } else if (e.key === 'ArrowUp' || e.key === 'k') {
      setCurrentIndex((i) => Math.max(i - 1, 0));
    }
  }, [isMobile, streams.length]);

  useEffect(() => {
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [handleKeyDown]);

  // Auto-load more when near the end
  useEffect(() => {
    if (isMobile && currentIndex >= streams.length - 2) {
      loadMore();
    }
  }, [currentIndex, streams.length, isMobile, loadMore]);

  if (isLoading && streams.length === 0) {
    return <LoadingSpinner className="h-full" />;
  }

  if (streams.length === 0) {
    return (
      <EmptyState
        icon={Play}
        title="No Live Streams"
        description="Nobody is streaming right now. Be the first to go live!"
      />
    );
  }

  // Mobile: TikTok-style vertical feed
  if (isMobile) {
    const currentStream = streams[currentIndex];
    return (
      <div className="h-full relative" onWheel={handleWheel} ref={feedRef}>
        {currentStream && (
          <StreamCard
            stream={currentStream}
            onClick={() => onOpenStream(currentStream.id)}
            isFullHeight
          />
        )}
        {/* Navigation indicators */}
        <div className="absolute right-3 top-1/2 -translate-y-1/2 flex flex-col gap-2">
          <button
            onClick={() => setCurrentIndex((i) => Math.max(i - 1, 0))}
            disabled={currentIndex === 0}
            className="w-8 h-8 rounded-full bg-black/50 flex items-center justify-center text-white/60 disabled:opacity-30"
          >
            <ChevronUp className="w-5 h-5" />
          </button>
          <span className="text-white/40 text-xs text-center">{currentIndex + 1}/{streams.length}</span>
          <button
            onClick={() => setCurrentIndex((i) => Math.min(i + 1, streams.length - 1))}
            disabled={currentIndex >= streams.length - 1}
            className="w-8 h-8 rounded-full bg-black/50 flex items-center justify-center text-white/60 disabled:opacity-30"
          >
            <ChevronDown className="w-5 h-5" />
          </button>
        </div>
      </div>
    );
  }

  // Desktop: Twitch-style grid
  return (
    <div className="h-full overflow-y-auto scrollbar-thin p-6">
      <div className="flex items-center justify-between mb-6">
        <h2 className="text-xl font-bold text-white">Live Now</h2>
        <span className="text-white/40 text-sm">{streams.length} streams</span>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
        {streams.map((stream) => (
          <StreamCard key={stream.id} stream={stream} onClick={() => onOpenStream(stream.id)} />
        ))}
      </div>
      {hasMore && (
        <div className="flex justify-center mt-6">
          <button
            onClick={loadMore}
            disabled={isLoading}
            className="px-6 py-2 bg-white/5 hover:bg-white/10 text-white/60 hover:text-white rounded-lg text-sm transition-colors"
          >
            {isLoading ? 'Loading...' : 'Load More'}
          </button>
        </div>
      )}
    </div>
  );
}

function StreamCard({ stream, onClick, isFullHeight }: { stream: Stream; onClick: () => void; isFullHeight?: boolean }) {
  return (
    <button
      onClick={onClick}
      className={cn(
        'relative group rounded-xl overflow-hidden bg-surface border border-white/5 hover:border-rogan-500/30 transition-all',
        isFullHeight ? 'w-full h-full' : 'aspect-[16/10]'
      )}
    >
      {/* Gradient Background (placeholder for video thumbnail) */}
      <div className={cn(
        'absolute inset-0 bg-gradient-to-br from-rogan-600/20 via-purple-600/20 to-blue-600/20',
        isFullHeight && 'animate-pulse'
      )} />

      {/* Overlay */}
      <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-transparent to-transparent" />

      {/* Top badges */}
      <div className="absolute top-3 left-3 flex items-center gap-2">
        <LiveBadge size="sm" />
        {stream.category && (
          <span className="bg-white/10 text-white/80 text-[10px] px-2 py-0.5 rounded-md backdrop-blur-sm">
            {stream.category}
          </span>
        )}
      </div>

      {/* Viewer count */}
      <div className="absolute top-3 right-3 flex items-center gap-1 bg-black/40 backdrop-blur-sm text-white text-xs px-2 py-1 rounded-md">
        <Users className="w-3 h-3" />
        {formatCount(stream.viewer_count)}
      </div>

      {/* Bottom info */}
      <div className="absolute bottom-0 left-0 right-0 p-3">
        <div className="flex items-center gap-2 mb-1">
          <div className="w-7 h-7 rounded-full bg-gradient-to-br from-rogan-500 to-amber-500 flex items-center justify-center text-white text-xs font-bold flex-shrink-0">
            {(stream.creator?.username || 'U').charAt(0).toUpperCase()}
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-white text-sm font-semibold truncate">{stream.title}</p>
            <p className="text-white/50 text-xs truncate">{stream.creator?.username || 'Unknown'}</p>
          </div>
        </div>
      </div>

      {/* Hover overlay */}
      <div className="absolute inset-0 bg-rogan-600/10 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
        <Play className="w-10 h-10 text-white/80" />
      </div>
    </button>
  );
}
