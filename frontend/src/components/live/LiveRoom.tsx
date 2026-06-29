'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { ArrowLeft, Send, Users, Gift, X, ChevronRight, StopCircle, Swords, Lock, Clock, Flag } from 'lucide-react';
import ReportModal from '@/components/moderation/ReportModal';
import Hls from 'hls.js';
import { useAuthStore } from '@/stores/authStore';
import { useStreamStore } from '@/stores/streamStore';
import { useChatStore } from '@/stores/chatStore';
import { useGiftStore } from '@/stores/giftStore';
import { useWalletStore } from '@/stores/walletStore';
import { StreamWSClient, PKBattleWSClient } from '@/lib/ws';
import { useIsMobile } from '@/hooks/use-mobile';
import { formatTK, cn } from '@/lib/utils';
import LiveBadge from '@/components/shared/LiveBadge';
import { GIFT_CONFIG } from '@/types';
import type { GiftType, ChatMessage } from '@/types';
import api from '@/lib/api';

interface LiveRoomProps {
  streamId: string;
  onBack: () => void;
  onOpenProfile?: (userId: string) => void;
}

export default function LiveRoom({ streamId, onBack, onOpenProfile }: LiveRoomProps) {
  const { user, token } = useAuthStore();
  const { fetchStream, setViewerCount, viewerCount, endStream } = useStreamStore();
  const { messages, addMessage, addSystemMessage, addGiftAnimation, giftAnimations, isOpen: chatOpen, toggleChat } = useChatStore();
  const { sendGift, error: giftError, isSending } = useGiftStore();
  const { wallet, fetchWallet } = useWalletStore();
  const isMobile = useIsMobile(960);

  const videoRef = useRef<HTMLVideoElement>(null);
  const wsRef = useRef<StreamWSClient | null>(null);
  const chatEndRef = useRef<HTMLDivElement>(null);
  const mobileChatInputRef = useRef<HTMLInputElement>(null);
  const [chatInput, setChatInput] = useState('');
  const [showGiftPicker, setShowGiftPicker] = useState(false);
  const [showReport, setShowReport] = useState(false);
  const [reportTarget, setReportTarget] = useState<'stream' | 'user'>('stream');
  const [stream, setStream] = useState<any>(null);
  const [isConnecting, setIsConnecting] = useState(true);
  const [giftToast, setGiftToast] = useState<{ msg: string; ok: boolean } | null>(null);
  const [playerMuted, setPlayerMuted] = useState(true); // start muted so autoPlay works; tap to unmute
  const [hlsBuffering, setHlsBuffering] = useState(true); // true until first manifest loads
  const [hlsTimedOut, setHlsTimedOut] = useState(false);  // true after 25s without manifest

  // Private show state
  const [privateShowId, setPrivateShowId] = useState<string | null>(null);
  const [privateShowPrice, setPrivateShowPrice] = useState<number>(0);
  const [privateShowStatus, setPrivateShowStatus] = useState<'announced' | 'live' | null>(null);
  const [privateCountdownSecs, setPrivateCountdownSecs] = useState(0);
  const [hasPrivateAccess, setHasPrivateAccess] = useState(false);
  const [isPaying, setIsPaying] = useState(false);

  // PK Battle state
  const pkWsRef = useRef<PKBattleWSClient | null>(null);
  const [pkBattle, setPkBattle] = useState<any>(null);
  const [pkScores, setPkScores] = useState<{ a: number; b: number } | null>(null);
  const [pkGiftFeed, setPkGiftFeed] = useState<string[]>([]);

  const showGiftToast = (msg: string, ok: boolean) => {
    setGiftToast({ msg, ok });
    setTimeout(() => setGiftToast(null), 3000);
  };

  // Chat history: clear stale messages from a previous stream then hydrate
  // from the Redis ring buffer so rejoining viewers see recent context.
  const { clearMessages } = useChatStore();
  useEffect(() => {
    clearMessages();

    api.get(`/streams/${streamId}/chat?limit=50`)
      .then((res) => {
        const history: Array<{
          type: string;
          stream_id: string;
          user_id: string;
          username: string;
          content: string;
          timestamp: string;
        }> = res.data?.messages ?? [];

        history.forEach((m) => {
          addMessage({
            id: `hist-${m.user_id}-${m.timestamp}`,
            stream_id: m.stream_id,
            user_id: m.user_id,
            username: m.username,
            avatar: null,
            message: m.content,
            type: 'chat',
            created_at: m.timestamp,
          });
        });
      })
      .catch(() => {}); // history is best-effort; never block on failure

    // Do NOT clear on unmount — if the viewer navigates away and comes back
    // the history will reload. Clearing on streamId change (above) is enough
    // to prevent messages bleeding between different streams.
  }, [streamId, clearMessages, addMessage]);

  // Fetch stream details + wallet balance on mount
  useEffect(() => {
    fetchStream(streamId).then((s) => {
      setStream(s);
      // Check if this stream's creator has an active PK battle
      if (s?.creator_id) {
        api.get(`/pk-battles/creator/${s.creator_id}/active`)
          .then((res) => { if (res.data.battle) setPkBattle(res.data.battle); })
          .catch(() => {});
      }
    }).catch(() => {
      addSystemMessage('Failed to load stream');
    }).finally(() => setIsConnecting(false));
    fetchWallet();
  }, [streamId, fetchStream, addSystemMessage, fetchWallet]);

  // Check for active private show on mount (handles viewers who join mid-show)
  useEffect(() => {
    api.get(`/streams/${streamId}/private-show`).then((res) => {
      if (res.data.show_id) {
        setPrivateShowId(res.data.show_id);
        setPrivateShowPrice(res.data.price_tk || 0);
        setPrivateShowStatus(res.data.status);
        // Check access
        api.get(`/private-shows/${res.data.show_id}/access`).then((r) => {
          setHasPrivateAccess(r.data.has_access);
        }).catch(() => {});
        // If announced, compute remaining countdown
        if (res.data.status === 'announced' && res.data.countdown_seconds && res.data.announced_at) {
          const elapsed = (Date.now() - new Date(res.data.announced_at).getTime()) / 1000;
          const remaining = Math.max(0, res.data.countdown_seconds - elapsed);
          setPrivateCountdownSecs(Math.floor(remaining));
        }
      }
    }).catch(() => {});
  }, [streamId]);

  // Countdown tick for announced private show
  useEffect(() => {
    if (privateShowStatus !== 'announced' || privateCountdownSecs <= 0) return;
    const t = setInterval(() => setPrivateCountdownSecs((s) => Math.max(0, s - 1)), 1000);
    return () => clearInterval(t);
  }, [privateShowStatus, privateCountdownSecs]);

  // Connect PK WS when there's an active battle for this stream
  useEffect(() => {
    if (!pkBattle || pkBattle.status !== 'active' || !user?.id || !token) {
      pkWsRef.current?.disconnect();
      pkWsRef.current = null;
      return;
    }
    const ws = new PKBattleWSClient({
      battleId: pkBattle.id,
      userId: user.id,
      token,
      onScoreUpdate: ({ creator_a_score, creator_b_score, sender_username, amount_tk, side }: { creator_a_score: number; creator_b_score: number; sender_username?: string; amount_tk?: number; side?: 'a' | 'b' }) => {
        setPkScores({ a: creator_a_score, b: creator_b_score });
        if (sender_username && amount_tk) {
          setPkGiftFeed((prev) => [
            ...prev.slice(-4),
            `${sender_username} sent ${formatTK(amount_tk)} TK to ${side?.toUpperCase()}`,
          ]);
        }
      },
      onBattleEnded: (data: { winner_id: string | null; creator_a_score: number; creator_b_score: number }) => {
        setPkBattle((prev: any) => ({ ...prev, status: 'ended', winner_id: data.winner_id, creator_a_score: data.creator_a_score, creator_b_score: data.creator_b_score }));
      },
    });
    ws.connect();
    pkWsRef.current = ws;
    return () => { ws.disconnect(); pkWsRef.current = null; };
  }, [pkBattle?.id, pkBattle?.status, user?.id, token]);

  // Setup HLS player.
  // hls_url is a root-relative path (/live/{key}/index.m3u8) so it routes
  // through the Next.js proxy → MediaMTX (same origin, no CORS).
  // For the creator we also have stream_key as a fallback.
  useEffect(() => {
    if (!videoRef.current) return;

    const hlsUrl: string | null =
      stream?.hls_url ??
      (stream?.stream_key ? `/live/${stream.stream_key}/index.m3u8` : null);

    if (!hlsUrl) return;

    setHlsBuffering(true);
    setHlsTimedOut(false);

    const video = videoRef.current;

    // LL-HLS partial segments arrive every ~0.2–0.5s, so first playback is fast.
    // Allow 25s before showing the retry prompt (stream may still be setting up).
    const bufferTimeout = setTimeout(() => setHlsTimedOut(true), 25_000);

    if (Hls.isSupported()) {
      const hls = new Hls({
        enableWorker: true,

        // ── LL-HLS low-latency settings ───────────────────────────────────────
        // lowLatencyMode enables partial segment support (EXT-X-PART).
        // MediaMTX lowLatency variant pushes ~0.2s partial segments; hls.js
        // can start playback from the very first partial segment instead of
        // waiting for a complete 2s segment — this cuts viewer lag from ~6s
        // down to ~1-2s.
        lowLatencyMode: true,

        // Stay 2 segments behind the live edge (2 × 2s = ~4s window, but
        // LL-HLS partial segments mean actual lag is ~1-2s within that window).
        liveSyncDurationCount: 2,

        // If the viewer falls more than 5 segments behind (network stall),
        // hls.js skips ahead to the live edge automatically.
        liveMaxLatencyDurationCount: 5,

        // Buffer at most 4s ahead of playback — keeps us close to live edge.
        maxBufferLength: 4,
        maxMaxBufferLength: 8,

        // Keep 15s of back buffer for seeking slightly back in the stream.
        backBufferLength: 15,

        // ── Retry settings — stay aggressive for stream startup ───────────────
        // LL-HLS uses blocking playlist requests (server holds response until
        // new data), so manifestLoadingRetryDelay matters less here. Still
        // keep retries high for the initial 404 phase while stream is starting.
        manifestLoadingMaxRetry: 20,
        manifestLoadingRetryDelay: 1000,
        levelLoadingMaxRetry: 10,
        levelLoadingRetryDelay: 1000,
      });
      hls.loadSource(hlsUrl);
      hls.attachMedia(video);
      hls.on(Hls.Events.MANIFEST_PARSED, () => {
        clearTimeout(bufferTimeout);
        setHlsBuffering(false);
        setHlsTimedOut(false);
        video.play().catch(() => {});
      });
      hls.on(Hls.Events.ERROR, (_event, data) => {
        if (data.fatal) {
          if (data.type === Hls.ErrorTypes.NETWORK_ERROR) {
            // Stream may not have segments yet — keep retrying
            setTimeout(() => hls.startLoad(), 2000);
          } else if (data.type === Hls.ErrorTypes.MEDIA_ERROR) {
            hls.recoverMediaError();
          }
        }
      });
      return () => { hls.destroy(); clearTimeout(bufferTimeout); };
    } else if (video.canPlayType('application/vnd.apple.mpegurl')) {
      // Safari — native HLS with built-in LL-HLS support (Safari 14+).
      // The native player handles LL-HLS automatically via the EXT-X-PART tags.
      video.src = hlsUrl;
      video.play().catch(() => {});
      return () => clearTimeout(bufferTimeout);
    }
  }, [stream?.hls_url, stream?.stream_key]);

  // Pay handler for private show
  const handlePayPrivateShow = async () => {
    if (!privateShowId || isPaying) return;
    setIsPaying(true);
    try {
      await api.post(`/private-shows/${privateShowId}/join`, {});
      setHasPrivateAccess(true);
    } catch {
      // insufficient TK or other error — silently ignore for now
    } finally {
      setIsPaying(false);
    }
  };

  // Setup WebSocket
  useEffect(() => {
    if (!user?.id || !token) return;

    const ws = new StreamWSClient({
      streamId,
      userId: user.id,
      token,
      onChat: (msg: ChatMessage) => addMessage(msg),
      onGift: (gift) => {
        addSystemMessage(`${gift.sender_name} sent ${GIFT_CONFIG[gift.gift_type].emoji} ${GIFT_CONFIG[gift.gift_type].label}`);
        addGiftAnimation(gift.gift_type, gift.sender_name);
      },
      onViewerCount: (count: number) => setViewerCount(count),
      onSystem: (msg: string) => addSystemMessage(msg),
      onConnect: () => addSystemMessage('Connected to stream'),
      onDisconnect: () => addSystemMessage('Disconnected from stream'),
      onRawMessage: (msg) => {
        switch (msg.type as string) {
          case 'private_show_announced': {
            const price = msg.price_tk as number;
            const secs = msg.countdown_seconds as number;
            setPrivateShowId(msg.show_id as string);
            setPrivateShowPrice(price);
            setPrivateShowStatus('announced');
            setPrivateCountdownSecs(secs);
            addSystemMessage(`🔒 Stream going private in ${secs}s — ${price} TK to join`);
            break;
          }
          case 'private_show_started': {
            const showId = msg.show_id as string;
            setPrivateShowStatus('live');
            setPrivateCountdownSecs(0);
            addSystemMessage(`🔒 Private show started — pay to keep watching`);
            // Check if already paid
            api.get(`/private-shows/${showId}/access`).then((r) => {
              setHasPrivateAccess(r.data.has_access);
            }).catch(() => {});
            break;
          }
          case 'private_show_ended':
            setPrivateShowId(null);
            setPrivateShowStatus(null);
            setPrivateCountdownSecs(0);
            setHasPrivateAccess(false);
            addSystemMessage('✅ Private show ended — stream is public again');
            break;
          case 'private_show_cancelled':
            setPrivateShowId(null);
            setPrivateShowStatus(null);
            setPrivateCountdownSecs(0);
            addSystemMessage('❌ Private show cancelled — stream is public');
            break;
          case 'stream_ended':
            // Streamer ended the stream — update local state immediately
            setStream((s: any) => s ? { ...s, is_live: false } : s);
            addSystemMessage('📡 Stream has ended');
            break;
        }
      },
    });

    ws.connect();
    wsRef.current = ws;

    return () => { ws.disconnect(); };
  }, [streamId, user?.id, token, addMessage, addSystemMessage, addGiftAnimation, setViewerCount]);

  // Auto-scroll chat
  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const handleSendChat = () => {
    const text = chatInput.trim();
    if (!text) return;
    // Optimistic local echo — sender sees their own message immediately
    // without waiting for the WS round-trip.  The broadcast from the backend
    // will also arrive, but addMessage deduplicates by id so it's harmless.
    addMessage({
      id: `local-${user?.id}-${Date.now()}`,
      stream_id: streamId,
      user_id: user?.id ?? '',
      username: user?.username ?? 'You',
      avatar: null,
      message: text,
      type: 'chat',
      created_at: new Date().toISOString(),
    });
    wsRef.current?.sendChat(text, user?.username, user?.role);
    setChatInput('');
  };

  const isCreator = !!user?.id && !!stream?.creator_id && user.id === stream.creator_id;

  const handleEndStream = async () => {
    if (!streamId) return;
    try {
      await endStream(streamId);
    } catch { /* ignore */ }
    onBack();
  };

  const handleSendGift = async (giftType: GiftType) => {
    if (isCreator) {
      showGiftToast("You can't gift your own stream", false);
      setShowGiftPicker(false);
      return;
    }
    const tkCost = GIFT_CONFIG[giftType]?.price ?? 0;
    if ((wallet?.tk_balance ?? 0) < tkCost) {
      showGiftToast(`Not enough TK — need ${tkCost}, have ${wallet?.tk_balance ?? 0}`, false);
      setShowGiftPicker(false);
      return;
    }
    const result = await sendGift({ stream_id: streamId, gift_type: giftType });
    if (result) {
      // Backend broadcasts gift_sent to all WS connections after HTTP — do NOT
      // call wsRef.sendGift here or the gift will appear twice for everyone.
      showGiftToast(`${GIFT_CONFIG[giftType].emoji} Sent!`, true);
      fetchWallet(); // refresh balance
    } else {
      showGiftToast(giftError || 'Gift failed — try again', false);
    }
    setShowGiftPicker(false);
  };

  if (isConnecting) {
    return (
      <div className="h-full flex items-center justify-center bg-black">
        <div className="w-10 h-10 border-3 border-white/20 border-t-rogan-500 rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <div className={cn('h-full flex bg-black', isMobile ? 'flex-col' : 'flex-row')}>
      {/* Video Area */}
      <div
        className={cn('relative', isMobile ? 'flex-1' : chatOpen ? 'flex-1' : 'flex-1')}
        style={
          hlsBuffering && stream?.stream_key
            ? { backgroundImage: `url(/thumbnail/${stream.stream_key})`, backgroundSize: 'cover', backgroundPosition: 'center' }
            : undefined
        }
      >
        {/* Thumbnail dim overlay — shown behind video while buffering for visual polish */}
        {hlsBuffering && stream?.stream_key && (
          <div className="absolute inset-0 bg-black/40 pointer-events-none z-0" />
        )}
        {/* Gift toast */}
        {giftToast && (
          <div className={cn(
            'absolute top-16 left-1/2 -translate-x-1/2 z-50 px-4 py-2 rounded-full text-sm font-medium shadow-lg backdrop-blur-sm transition-all',
            giftToast.ok ? 'bg-green-500/80 text-white' : 'bg-red-500/80 text-white'
          )}>
            {giftToast.msg}
          </div>
        )}

        {/* Video Player */}
        <video
          ref={videoRef}
          className="w-full h-full object-contain"
          autoPlay
          playsInline
          muted={playerMuted}
        />

        {/* Tap-to-unmute overlay — browsers block autoplay with audio, so we
            start muted and let the user tap to unmute */}
        {playerMuted && stream?.is_live && (
          <button
            onClick={() => setPlayerMuted(false)}
            className="absolute bottom-24 left-1/2 -translate-x-1/2 flex items-center gap-2 px-4 py-2 rounded-full bg-black/60 backdrop-blur-sm text-white text-sm font-medium border border-white/20 hover:bg-black/80 transition-colors z-10"
          >
            <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24">
              <path d="M3 9v6h4l5 5V4L7 9H3zm13.5 3c0-1.77-1.02-3.29-2.5-4.03v8.05c1.48-.73 2.5-2.25 2.5-4.02z"/>
            </svg>
            Tap to unmute
          </button>
        )}

        {/* Buffering overlay — shown while HLS manifest hasn't loaded yet.
            Background is semi-transparent so the thumbnail behind shows through. */}
        {hlsBuffering && stream?.is_live && (
          <div className="absolute inset-0 bg-black/50 flex flex-col items-center justify-center gap-3 z-10">
            {hlsTimedOut ? (
              /* Timed out — prompt user to retry */
              <>
                <p className="text-white/60 text-sm text-center px-6">
                  Video is taking a while to load.<br />The streamer may still be setting up.
                </p>
                <button
                  onClick={() => {
                    setHlsTimedOut(false);
                    setHlsBuffering(true);
                    // Re-trigger the HLS effect by faking a stream update
                    setStream((s: any) => s ? { ...s } : s);
                  }}
                  className="px-4 py-2 bg-white/10 hover:bg-white/20 text-white text-sm rounded-lg transition-colors"
                >
                  Retry
                </button>
              </>
            ) : (
              /* Still waiting — show spinner */
              <>
                <div className="w-10 h-10 border-2 border-white/20 border-t-white rounded-full animate-spin" />
                <p className="text-white/60 text-sm">Stream is starting...</p>
              </>
            )}
          </div>
        )}

        {/* Stream offline overlay */}
        {stream && !stream.is_live && (
          <div className="absolute inset-0 bg-black/85 flex flex-col items-center justify-center gap-3">
            <div className="w-16 h-16 rounded-full bg-white/5 flex items-center justify-center mb-2">
              <span className="text-3xl">📡</span>
            </div>
            <p className="text-white text-lg font-semibold">Stream has ended</p>
            <p className="text-white/40 text-sm">{stream.title}</p>
            <button
              onClick={onBack}
              className="mt-2 px-6 py-2.5 bg-rogan-600 hover:bg-rogan-700 text-white rounded-lg text-sm font-medium transition-colors"
            >
              Back to Feed
            </button>
          </div>
        )}

        {/* Private show countdown banner — shown when announced */}
        {privateShowStatus === 'announced' && (
          <div className="absolute top-0 inset-x-0 z-20 bg-purple-900/90 backdrop-blur-sm border-b border-purple-500/30 px-4 py-2.5 flex items-center gap-3">
            <div className="flex items-center gap-2 text-purple-300 text-sm font-medium">
              <Clock className="w-4 h-4 animate-pulse" />
              Going private in {Math.floor(privateCountdownSecs / 60)}:{String(privateCountdownSecs % 60).padStart(2, '0')}
            </div>
            <span className="text-white/40 text-xs">—</span>
            <span className="text-amber-400 text-sm font-bold">{privateShowPrice} TK</span>
            <button
              onClick={handlePayPrivateShow}
              disabled={isPaying || hasPrivateAccess}
              className={cn(
                'ml-auto px-3 py-1 rounded-lg text-xs font-medium transition-colors',
                hasPrivateAccess
                  ? 'bg-green-600/20 text-green-400 border border-green-500/30'
                  : 'bg-amber-400 hover:bg-amber-500 text-black'
              )}
            >
              {hasPrivateAccess ? '✓ Joined' : isPaying ? 'Paying...' : `Pay ${privateShowPrice} TK`}
            </button>
          </div>
        )}

        {/* Private show blur overlay — shown when live and user has not paid */}
        {privateShowStatus === 'live' && !hasPrivateAccess && (
          <div className="absolute inset-0 z-30 flex flex-col items-center justify-center">
            <div className="absolute inset-0 backdrop-blur-xl bg-black/40" />
            <div className="relative z-10 flex flex-col items-center gap-4 text-center px-6">
              <div className="w-14 h-14 rounded-full bg-purple-600/20 border border-purple-500/40 flex items-center justify-center">
                <Lock className="w-7 h-7 text-purple-400" />
              </div>
              <div>
                <p className="text-white font-bold text-lg">Private Show</p>
                <p className="text-white/50 text-sm mt-1">Pay to watch the exclusive stream</p>
              </div>
              <button
                onClick={handlePayPrivateShow}
                disabled={isPaying}
                className="px-6 py-3 bg-amber-400 hover:bg-amber-500 text-black font-bold rounded-xl text-sm transition-colors disabled:opacity-50"
              >
                {isPaying ? 'Processing...' : `Join for ${privateShowPrice} TK`}
              </button>
            </div>
          </div>
        )}

        {/* Back button */}
        <button
          onClick={onBack}
          className="absolute top-4 left-4 w-9 h-9 rounded-full bg-black/50 backdrop-blur-sm flex items-center justify-center text-white hover:bg-black/70 transition-colors"
        >
          <ArrowLeft className="w-5 h-5" />
        </button>

        {/* End Stream button — only visible to the creator */}
        {isCreator && (
          <button
            onClick={handleEndStream}
            className="absolute top-4 right-4 flex items-center gap-1.5 px-3 py-2 rounded-full bg-red-600/80 backdrop-blur-sm text-white text-xs font-semibold hover:bg-red-600 transition-colors"
          >
            <StopCircle className="w-4 h-4" /> End Stream
          </button>
        )}

        {/* Report button — viewers only */}
        {!isCreator && stream && (
          <div className="absolute top-4 right-4 flex items-center gap-2">
            <button
              onClick={() => { setReportTarget('stream'); setShowReport(true); }}
              className="w-9 h-9 rounded-full bg-black/50 backdrop-blur-sm flex items-center justify-center text-white/70 hover:text-red-400 hover:bg-black/70 transition-colors"
              title="Report stream"
            >
              <Flag className="w-4 h-4" />
            </button>
          </div>
        )}

        {/* Report Modal */}
        <ReportModal
          open={showReport}
          onClose={() => setShowReport(false)}
          streamId={reportTarget === 'stream' ? streamId : undefined}
          userId={reportTarget === 'user' ? stream?.creator_id : undefined}
          targetName={reportTarget === 'stream' ? stream?.title : stream?.creator?.username}
        />

        {/* PK Battle overlay — hidden until post-deployment */}

        {/* Stream info overlay */}
        <div className="absolute top-4 left-16 flex items-center gap-2">
          <LiveBadge size="sm" />
          <div className="flex items-center gap-1 bg-black/40 backdrop-blur-sm text-white text-xs px-2 py-1 rounded-md">
            <Users className="w-3 h-3" />
            {viewerCount}
          </div>
          {stream?.title && (
            <span className="bg-black/40 backdrop-blur-sm text-white text-xs px-2 py-1 rounded-md max-w-[200px] truncate">
              {stream.title}
            </span>
          )}
        </div>

        {/* Creator card — tap to open profile (viewers only) */}
        {!isCreator && stream?.creator && onOpenProfile && (
          <div className="absolute bottom-[72px] left-3 flex items-center gap-2 z-10">
          <button
            onClick={() => onOpenProfile(stream.creator_id)}
            className="flex items-center gap-2 bg-black/60 backdrop-blur-sm rounded-full px-3 py-1.5 hover:bg-black/80 transition-colors"
          >
            <div className="w-7 h-7 rounded-full bg-gradient-to-br from-rogan-500 to-amber-500 flex items-center justify-center text-white text-xs font-bold flex-shrink-0">
              {(stream.creator.display_name || stream.creator.username || '?').charAt(0).toUpperCase()}
            </div>
            <div className="text-left">
              <p className="text-white text-xs font-semibold leading-none">
                {stream.creator.display_name || stream.creator.username}
              </p>
              <p className="text-white/50 text-[10px] leading-none mt-0.5">@{stream.creator.username}</p>
            </div>
            <ChevronRight className="w-3.5 h-3.5 text-white/40" />
          </button>
          <button
            onClick={() => { setReportTarget('user'); setShowReport(true); }}
            className="w-7 h-7 rounded-full bg-black/60 backdrop-blur-sm flex items-center justify-center text-white/50 hover:text-red-400 hover:bg-black/80 transition-colors"
            title="Report user"
          >
            <Flag className="w-3 h-3" />
          </button>
          </div>
        )}

        {/* Gift animations overlay */}
        {giftAnimations.map((anim) => (
          <div
            key={anim.id}
            className="absolute bottom-20 gift-flying pointer-events-none"
            style={{ left: `${anim.x_position}%` }}
          >
            <span className="text-3xl">{GIFT_CONFIG[anim.gift_type].emoji}</span>
            <span className="text-xs text-white/80 ml-1">{anim.sender_name}</span>
          </div>
        ))}

        {/* Mobile: Chat overlay (bottom) — z-40 keeps it above the private show blur overlay (z-30).
            Messages are in a scrollable area; input stays pinned at bottom.
            onFocus scrollIntoView ensures keyboard doesn't cover the input on iOS. */}
        {isMobile && (
          <div className="absolute bottom-0 left-0 right-0 z-40 flex flex-col">
            {/* Scrollable chat messages — gradient background so text is readable over video */}
            <div className="max-h-[38vh] overflow-y-auto overscroll-contain no-scrollbar px-3 pt-2 pb-1"
              style={{ background: 'linear-gradient(to top, rgba(0,0,0,0.65) 0%, rgba(0,0,0,0.0) 100%)' }}
            >
              {messages.slice(-30).map((msg) => (
                <div key={msg.id} className="text-xs mb-1 leading-snug">
                  {msg.type === 'system' ? (
                    msg.message.includes('sent') ? (
                      <span className="text-tk font-semibold">{msg.message}</span>
                    ) : (
                      <span className="text-white/40 italic">{msg.message}</span>
                    )
                  ) : (
                    <>
                      {msg.role === 'moderator' ? (
                        <><span className="text-blue-400 font-semibold">System </span><span className="text-[9px] bg-blue-500/30 text-blue-300 px-1 py-0.5 rounded font-bold mr-1">MOD</span></>
                      ) : (
                        <span className="text-rogan-400 font-semibold">{msg.username}: </span>
                      )}
                      <span className="text-white/90">{msg.message}</span>
                    </>
                  )}
                </div>
              ))}
              <div ref={chatEndRef} />
            </div>
            {/* Chat input + Gift button — solid background so input is always readable */}
            <div className="flex items-center gap-2 px-2 py-2 bg-black/70 backdrop-blur-sm">
              <button
                onClick={() => setShowGiftPicker(!showGiftPicker)}
                className="w-9 h-9 rounded-full bg-tk/20 flex items-center justify-center flex-shrink-0"
              >
                <Gift className="w-4 h-4 text-tk" />
              </button>
              <input
                ref={mobileChatInputRef}
                type="text"
                value={chatInput}
                onChange={(e) => setChatInput(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleSendChat()}
                onFocus={() => setTimeout(() => mobileChatInputRef.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' }), 300)}
                placeholder="Say something..."
                className="flex-1 bg-white/10 border border-white/10 rounded-full px-4 py-2 text-sm text-white placeholder:text-white/30 focus:outline-none focus:border-rogan-500/50"
              />
              <button
                onClick={handleSendChat}
                className="w-9 h-9 rounded-full bg-rogan-600 flex items-center justify-center flex-shrink-0"
              >
                <Send className="w-4 h-4 text-white" />
              </button>
            </div>
          </div>
        )}

        {/* Mobile Gift Picker — z-50 so it renders above the chat overlay (z-40) */}
        {isMobile && showGiftPicker && (
          <div className="absolute bottom-20 left-2 right-2 z-50 bg-surface rounded-xl border border-white/10 p-3 shadow-xl">
            <div className="flex items-center justify-between mb-2">
              <span className="text-white text-sm font-medium">Send a Gift</span>
              <div className="flex items-center gap-2">
                <span className="text-tk text-xs font-semibold">{wallet?.tk_balance ?? 0} TK</span>
                <button onClick={() => setShowGiftPicker(false)}>
                  <X className="w-4 h-4 text-white/40" />
                </button>
              </div>
            </div>
            <div className="grid grid-cols-5 gap-2">
              {(Object.entries(GIFT_CONFIG) as [GiftType, typeof GIFT_CONFIG[GiftType]][]).map(([type, config]) => {
                const canAfford = (wallet?.tk_balance ?? 0) >= config.price;
                return (
                  <button
                    key={type}
                    onClick={() => handleSendGift(type)}
                    disabled={isSending}
                    className={cn('flex flex-col items-center gap-1 p-2 rounded-lg transition-colors', canAfford ? 'hover:bg-white/5' : 'opacity-40 cursor-not-allowed')}
                  >
                    <span className="text-xl">{config.emoji}</span>
                    <span className="text-[10px] text-tk font-medium">{config.price} TK</span>
                  </button>
                );
              })}
            </div>
          </div>
        )}
      </div>

      {/* Desktop: Side Chat Panel */}
      {!isMobile && chatOpen && (
        <div className="w-[380px] bg-surface border-l border-white/5 flex flex-col">
          {/* Chat Header */}
          <div className="h-12 flex items-center justify-between px-4 border-b border-white/5">
            <span className="text-white text-sm font-medium">Live Chat</span>
            <button onClick={toggleChat} className="text-white/40 hover:text-white">
              <ChevronRight className="w-5 h-5" />
            </button>
          </div>

          {/* Messages */}
          <div className="flex-1 overflow-y-auto scrollbar-thin p-4 space-y-2">
            {messages.length === 0 && (
              <p className="text-white/30 text-xs text-center pt-4">No messages yet</p>
            )}
            {messages.map((msg) => (
              <div key={msg.id} className="text-sm">
                {msg.type === "system" ? (
                  msg.message.includes("sent") ? (
                    <div className="flex items-center gap-1.5 bg-tk/10 border border-tk/20 rounded-lg px-2.5 py-1.5">
                      <span className="text-tk text-xs font-semibold">{msg.message}</span>
                    </div>
                  ) : (
                    <span className="text-white/20 text-xs italic">{msg.message}</span>
                  )
                ) : (
                  <span>
                    {msg.role === "moderator" ? (
                      <><span className="text-blue-400 font-medium">System</span><span className="text-[9px] bg-blue-500/30 text-blue-300 px-1 py-0.5 rounded font-bold ml-1 mr-1">MOD</span></>
                    ) : (
                      <><span className="text-rogan-400 font-medium">{msg.username}</span><span className="text-white/40">: </span></>
                    )}
                    <span className="text-white/80">{msg.message}</span>
                  </span>
                )}
              </div>
            ))}
            <div ref={chatEndRef} />
          </div>

          {/* Desktop Gift Picker */}
          {showGiftPicker && (
            <div className="border-t border-white/5 p-3 space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-white text-xs font-medium">Send a Gift</span>
                <div className="flex items-center gap-2">
                  <span className="text-tk text-xs font-semibold">{wallet?.tk_balance ?? 0} TK</span>
                  <button onClick={() => setShowGiftPicker(false)}>
                    <X className="w-3.5 h-3.5 text-white/40" />
                  </button>
                </div>
              </div>
              <div className="grid grid-cols-5 gap-1.5">
                {(Object.entries(GIFT_CONFIG) as [GiftType, typeof GIFT_CONFIG[GiftType]][]).map(([type, config]) => {
                  const canAfford = (wallet?.tk_balance ?? 0) >= config.price;
                  return (
                    <button
                      key={type}
                      onClick={() => handleSendGift(type)}
                      disabled={isSending}
                      className={cn('flex flex-col items-center gap-1 p-2 rounded-lg transition-colors', canAfford ? 'hover:bg-white/5' : 'opacity-40 cursor-not-allowed')}
                    >
                      <span className="text-xl">{config.emoji}</span>
                      <span className="text-[10px] text-tk font-medium">{config.price} TK</span>
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          {/* Desktop Chat Input */}
          <div className="p-3 border-t border-white/5 flex items-center gap-2">
            <button
              onClick={() => setShowGiftPicker(!showGiftPicker)}
              className="w-8 h-8 rounded-full bg-tk/20 hover:bg-tk/30 flex items-center justify-center flex-shrink-0 transition-colors"
            >
              <Gift className="w-4 h-4 text-tk" />
            </button>
            <input
              type="text"
              value={chatInput}
              onChange={(e) => setChatInput(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleSendChat()}
              placeholder="Say something..."
              className="flex-1 bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm text-white placeholder:text-white/30 focus:outline-none focus:border-rogan-500/50"
            />
            <button
              onClick={handleSendChat}
              className="w-8 h-8 rounded-full bg-rogan-600 flex items-center justify-center flex-shrink-0 hover:bg-rogan-700 transition-colors"
            >
              <Send className="w-4 h-4 text-white" />
            </button>
          </div>
        </div>
      )}

      {/* Desktop: Open chat button (when closed) */}
      {!isMobile && !chatOpen && (
        <button
          onClick={toggleChat}
          className="absolute right-0 top-1/2 -translate-y-1/2 bg-surface border border-white/10 rounded-l-lg px-2 py-4 text-white/40 hover:text-white transition-colors"
        >
          <ChevronRight className="w-4 h-4 rotate-180" />
        </button>
      )}
    </div>
  );
}
