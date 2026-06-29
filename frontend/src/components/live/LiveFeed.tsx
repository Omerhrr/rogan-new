'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import Hls from 'hls.js';
import { Users, ChevronUp, ChevronDown, Play, Radio, Lock } from 'lucide-react';
import { useStreamStore } from '@/stores/streamStore';
import { useAuthStore } from '@/stores/authStore';
import { useIsMobile } from '@/hooks/use-mobile';
import { formatCount } from '@/lib/utils';
import LiveBadge from '@/components/shared/LiveBadge';
import LoadingSpinner from '@/components/shared/LoadingSpinner';
import EmptyState from '@/components/shared/EmptyState';
import { cn } from '@/lib/utils';
import type { Stream } from '@/types';

interface LiveFeedProps {
  onOpenStream: (streamId: string, creatorId?: string) => void;
}

export default function LiveFeed({ onOpenStream }: LiveFeedProps) {
  const { streams, fetchLiveStreams, isLoading, hasMore, page } = useStreamStore();
  const { user } = useAuthStore();
  const isMobile = useIsMobile(960);
  const [currentIndex, setCurrentIndex] = useState(0);
  const feedRef = useRef<HTMLDivElement>(null);
  const touchStartY = useRef<number | null>(null);

  // Initial fetch
  useEffect(() => {
    fetchLiveStreams(1);
  }, [fetchLiveStreams]);

  // Auto-refresh every 20 s so new streams appear without a page reload.
  // Reset to page 1 each time so the list stays current (not just appended).
  useEffect(() => {
    const id = setInterval(() => {
      fetchLiveStreams(1);
    }, 20_000);
    return () => clearInterval(id);
  }, [fetchLiveStreams]);

  // Refresh immediately when the tab regains focus (user switches back to the app)
  useEffect(() => {
    const onFocus = () => fetchLiveStreams(1);
    window.addEventListener('focus', onFocus);
    return () => window.removeEventListener('focus', onFocus);
  }, [fetchLiveStreams]);

  const loadMore = useCallback(() => {
    if (hasMore && !isLoading) {
      fetchLiveStreams(page + 1);
    }
  }, [hasMore, isLoading, page, fetchLiveStreams]);

  // Mobile: Swipe navigation (mouse wheel — desktop trackpad / emulated)
  const handleWheel = useCallback((e: React.WheelEvent) => {
    if (!isMobile) return;
    e.preventDefault();
    if (e.deltaY > 0 && currentIndex < streams.length - 1) {
      setCurrentIndex((i) => i + 1);
    } else if (e.deltaY < 0 && currentIndex > 0) {
      setCurrentIndex((i) => i - 1);
    }
  }, [isMobile, currentIndex, streams.length]);

  // Mobile: Touch swipe — real touchscreen phones
  const handleTouchStart = useCallback((e: React.TouchEvent) => {
    if (!isMobile) return;
    touchStartY.current = e.touches[0].clientY;
  }, [isMobile]);

  const handleTouchEnd = useCallback((e: React.TouchEvent) => {
    if (!isMobile || touchStartY.current === null) return;
    const deltaY = touchStartY.current - e.changedTouches[0].clientY;
    touchStartY.current = null;
    const SWIPE_THRESHOLD = 50; // px
    if (deltaY > SWIPE_THRESHOLD && currentIndex < streams.length - 1) {
      setCurrentIndex((i) => i + 1);
    } else if (deltaY < -SWIPE_THRESHOLD && currentIndex > 0) {
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
      <div
        className="h-full relative"
        onWheel={handleWheel}
        onTouchStart={handleTouchStart}
        onTouchEnd={handleTouchEnd}
        ref={feedRef}
      >
        {currentStream && (
          <StreamCard
            stream={currentStream}
            onClick={() => onOpenStream(currentStream.id, currentStream.creator_id)}
            isOwnStream={currentStream.creator_id === user?.id}
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
          <StreamCard
            key={stream.id}
            stream={stream}
            onClick={() => onOpenStream(stream.id, stream.creator_id)}
            isOwnStream={stream.creator_id === user?.id}
          />
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

function StreamCard({
  stream,
  onClick,
  isFullHeight,
  isOwnStream,
}: {
  stream: Stream;
  onClick: () => void;
  isFullHeight?: boolean;
  isOwnStream?: boolean;
}) {
  // ── Thumbnail ──────────────────────────────────────────────────────────────
  // Always retry every 5 s. Reset thumbError on each tick so a temporary
  // MediaMTX 404 (stream just started / not yet publishing) self-heals.
  // Cache-bust with ?t= so browsers don't serve a cached 404.
  const [thumbKey, setThumbKey] = useState(0);
  const [thumbError, setThumbError] = useState(false);
  useEffect(() => {
    if (!stream.stream_key) return;
    const id = setInterval(() => {
      setThumbKey((k) => k + 1);
      setThumbError(false);
    }, 5000);
    return () => clearInterval(id);
  }, [stream.stream_key]);
  const thumbnailSrc = stream.stream_key && !thumbError
    ? `/thumbnail/${stream.stream_key}?t=${thumbKey}`
    : null;

  // ── HLS live preview ───────────────────────────────────────────────────────
  // On desktop: activates on hover so visitors see the actual live video before
  // deciding to join. On mobile (isFullHeight TikTok card): auto-starts so the
  // card acts like a silent reel — tap to join.
  const [showPreview, setShowPreview] = useState(false);
  const previewVideoRef = useRef<HTMLVideoElement>(null);
  const hlsRef = useRef<Hls | null>(null);

  // Mobile full-height card → preview starts immediately
  useEffect(() => {
    if (isFullHeight) setShowPreview(true);
    return () => setShowPreview(false);
  }, [isFullHeight]);

  // Load / destroy HLS instance when preview visibility changes
  useEffect(() => {
    if (!showPreview || !stream.stream_key) return;
    const video = previewVideoRef.current;
    if (!video) return;

    const hlsUrl = `/live/${stream.stream_key}/index.m3u8`;

    if (Hls.isSupported()) {
      const hls = new Hls({ lowLatencyMode: true, maxBufferLength: 3, liveSyncDurationCount: 2 });
      hls.loadSource(hlsUrl);
      hls.attachMedia(video);
      hls.on(Hls.Events.MANIFEST_PARSED, () => { video.play().catch(() => {}); });
      hlsRef.current = hls;
    } else if (video.canPlayType('application/vnd.apple.mpegurl')) {
      // Safari native HLS
      video.src = hlsUrl;
      video.play().catch(() => {});
    }

    return () => {
      if (hlsRef.current) { hlsRef.current.destroy(); hlsRef.current = null; }
      if (previewVideoRef.current) previewVideoRef.current.src = '';
    };
  }, [showPreview, stream.stream_key]);

  // Always a button — own-stream click routes to GoLive (page.tsx openStream handles this)
  return (
    <button
      onClick={onClick}
      onMouseEnter={!isFullHeight && stream.private_show_status !== 'live' ? () => setShowPreview(true) : undefined}
      onMouseLeave={!isFullHeight && stream.private_show_status !== 'live' ? () => setShowPreview(false) : undefined}
      className={cn(
        'relative group rounded-xl overflow-hidden bg-surface border transition-all text-left',
        isFullHeight ? 'w-full h-full' : 'aspect-[16/10]',
        isOwnStream
          ? 'border-rogan-500/50 hover:border-rogan-500'
          : 'border-white/5 hover:border-rogan-500/30'
      )}
    >
      {/* Thumbnail — shown when HLS preview is not active */}
      {!showPreview && (thumbnailSrc ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          key={thumbKey}
          src={thumbnailSrc}
          alt={stream.title}
          className="absolute inset-0 w-full h-full object-cover"
          onError={() => setThumbError(true)}
        />
      ) : (
        <div className={cn(
          'absolute inset-0 bg-gradient-to-br from-rogan-600/20 via-purple-600/20 to-blue-600/20',
          isFullHeight && 'animate-pulse'
        )} />
      ))}

      {/* HLS live preview video — always mounted so the ref is stable,
          visible only when showPreview is true */}
      <video
        ref={previewVideoRef}
        className={cn(
          'absolute inset-0 w-full h-full object-cover transition-opacity duration-300',
          showPreview ? 'opacity-100' : 'opacity-0 pointer-events-none'
        )}
        muted
        playsInline
        autoPlay
      />

      {/* Overlay */}
      <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-transparent to-transparent" />

      {/* Top badges */}
      <div className="absolute top-3 left-3 flex items-center gap-2">
        <LiveBadge size="sm" />
        {stream.category && stream.private_show_status !== 'live' && (
          <span className="bg-white/10 text-white/80 text-[10px] px-2 py-0.5 rounded-md backdrop-blur-sm">
            {stream.category}
          </span>
        )}
        {stream.private_show_status === 'announced' && (
          <span className="bg-purple-600/40 border border-purple-500/40 text-purple-300 text-[10px] px-2 py-0.5 rounded-md font-medium animate-pulse">
            GOING PRIVATE
          </span>
        )}
      </div>

      {/* Private show live overlay — blurs preview, shows lock + price */}
      {stream.private_show_status === 'live' && (
        <div className="absolute inset-0 z-20 flex flex-col items-center justify-center">
          {/* Blur layer */}
          <div className="absolute inset-0 backdrop-blur-md bg-black/50" />
          {/* Content */}
          <div className="relative z-10 flex flex-col items-center gap-2 text-center px-4">
            <div className="w-10 h-10 rounded-full bg-purple-600/30 border border-purple-500/50 flex items-center justify-center">
              <Lock className="w-5 h-5 text-purple-300" />
            </div>
            <p className="text-white text-xs font-bold leading-tight">Private Show</p>
            {stream.private_show_price != null && stream.private_show_price > 0 && (
              <span className="text-amber-400 text-xs font-semibold">{stream.private_show_price} TK to join</span>
            )}
            <span className="text-white/60 text-[10px]">Tap to enter &amp; pay</span>
          </div>
        </div>
      )}

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

      {/* "You're Live" banner for own stream -- tapping takes them back to GoLive */}
      {isOwnStream && (
        <div className="absolute inset-0 flex items-center justify-center bg-black/40 backdrop-blur-[2px] group-hover:bg-black/50 transition-colors">
          <div className="flex flex-col items-center gap-1">
            <div className="flex items-center gap-2 px-4 py-2 rounded-full bg-rogan-500/90 group-hover:bg-rogan-500 text-white text-sm font-semibold shadow-lg transition-colors">
              <Radio className="w-4 h-4 animate-pulse" />
              You're Live
            </div>
            <span className="text-white/50 text-[11px] group-hover:text-white/80 transition-colors">
              Tap to manage stream
            </span>
          </div>
        </div>
      )}

      {/* Hover play overlay -- only for public streams that aren't your own */}
      {!isOwnStream && stream.private_show_status !== 'live' && (
        <div className="absolute inset-0 bg-rogan-600/10 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
          <Play className="w-10 h-10 text-white/80" />
        </div>
      )}
    </button>
  );
}
