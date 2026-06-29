'use client';

/**
 * Rogan Live — Private Shows
 * Creators: start a show → publish via WHIP → end show.
 * Viewers:  browse → pay TK to join → watch via HLS player.
 */

import { useState, useEffect, useRef, useCallback } from 'react';
import { Lock, Users, Clock, Coins, Play, Plus, X, Video, Radio, StopCircle, Camera, CameraOff, Mic, MicOff, Eye, MessageSquare, Send, Maximize2, Minimize2 } from 'lucide-react';
import Hls from 'hls.js';
import api, { getErrorMessage } from '@/lib/api';
import { StreamWSClient } from '@/lib/ws';
import { useAuthStore } from '@/stores/authStore';
import { useWalletStore } from '@/stores/walletStore';
import { useIsMobile } from '@/hooks/use-mobile';
import { cn, formatTK } from '@/lib/utils';
import LoadingSpinner from '@/components/shared/LoadingSpinner';
import EmptyState from '@/components/shared/EmptyState';

interface PrivateShow {
  id: string;
  creator_id: string;
  creator?: { id: string; username: string; display_name: string | null; avatar: string | null } | null;
  stream_key: string | null;
  price_tk: number;
  duration_minutes: number;
  max_viewers: number | null;
  status: 'waiting' | 'live' | 'ended';
  viewer_count: number;
  started_at: string | null;
  total_revenue: number;
  created_at: string | null;
}

interface JoinResult {
  show_id: string;
  stream_key: string | null;
  hls_url: string | null;
  whep_url: string | null;
  show_status: string;
}

export default function PrivateShowsView() {
  const { user } = useAuthStore();
  const { wallet, fetchWallet } = useWalletStore();
  const isMobile = useIsMobile(960);

  const [shows, setShows] = useState<PrivateShow[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [joiningId, setJoiningId] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [viewingShow, setViewingShow] = useState<JoinResult | null>(null);
  const [myShow, setMyShow] = useState<PrivateShow | null>(null);
  const [showCreatorPanel, setShowCreatorPanel] = useState(false);

  // Create form
  const [priceTk, setPriceTk] = useState('10');
  const [durationMin, setDurationMin] = useState('30');
  const [maxViewers, setMaxViewers] = useState('');
  const [creating, setCreating] = useState(false);

  const isCreator = user?.role === 'creator' || user?.role === 'admin';
  const balance = wallet?.tk_balance ?? 0;

  const loadShows = useCallback(async () => {
    try {
      const res = await api.get('/private-shows/active');
      const allShows: PrivateShow[] = res.data.shows || [];
      setShows(allShows);
      const mine = allShows.find((s) => s.creator_id === user?.id) || null;
      setMyShow(mine);
    } catch {
      setShows([]);
    } finally {
      setIsLoading(false);
    }
  }, [user?.id]);

  useEffect(() => {
    loadShows();
    fetchWallet();
    const interval = setInterval(loadShows, 15000);
    return () => clearInterval(interval);
  }, [loadShows, fetchWallet]);

  const handleCreate = async () => {
    if (!priceTk || !durationMin) return;
    setCreating(true);
    setError('');
    try {
      await api.post('/private-shows', {
        price_tk: parseFloat(priceTk),
        duration_minutes: parseInt(durationMin),
        max_viewers: maxViewers ? parseInt(maxViewers) : null,
      });
      setShowCreate(false);
      await loadShows();
      setShowCreatorPanel(true);
    } catch (err) {
      setError(getErrorMessage(err));
    } finally {
      setCreating(false);
    }
  };

  const handleJoin = async (showId: string, price: number) => {
    if (balance < price) {
      setError(`Insufficient TK. Need ${price} TK to join.`);
      return;
    }
    setJoiningId(showId);
    setError('');
    try {
      const res = await api.post(`/private-shows/${showId}/join`, {});
      const result: JoinResult = res.data;
      await fetchWallet();
      setViewingShow(result);
    } catch (err) {
      setError(getErrorMessage(err));
    } finally {
      setJoiningId(null);
    }
  };

  const handleEndShow = async (showId: string) => {
    try {
      await api.post(`/private-shows/${showId}/end`);
      setMyShow(null);
      setShowCreatorPanel(false);
      await loadShows();
    } catch (err) {
      setError(getErrorMessage(err));
    }
  };

  return (
    <div className={cn('h-full overflow-y-auto scrollbar-thin', isMobile ? 'p-4 pb-24' : 'p-6')}>
      <div className="max-w-4xl mx-auto space-y-6">

        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-xl font-bold text-white flex items-center gap-2">
              <Lock className="w-5 h-5 text-rogan-500" />
              Private Shows
            </h2>
            <p className="text-white/40 text-sm mt-0.5">Exclusive live sessions — pay to enter</p>
          </div>
          {isCreator && !myShow && (
            <button
              onClick={() => setShowCreate(true)}
              className="flex items-center gap-2 px-4 py-2 bg-rogan-600 hover:bg-rogan-700 text-white text-sm rounded-lg transition-colors"
            >
              <Plus className="w-4 h-4" /> Start Show
            </button>
          )}
          {isCreator && myShow && (
            <button
              onClick={() => setShowCreatorPanel(true)}
              className="flex items-center gap-2 px-4 py-2 bg-rogan-600/20 hover:bg-rogan-600/30 text-rogan-400 border border-rogan-500/30 text-sm rounded-lg transition-colors"
            >
              <Radio className="w-4 h-4 animate-pulse" /> Manage Show
            </button>
          )}
        </div>

        {/* Balance */}
        <div className="flex items-center gap-2 px-4 py-2.5 bg-surface rounded-xl border border-white/5 w-fit">
          <Coins className="w-4 h-4 text-amber-400" />
          <span className="text-white text-sm">Balance: <span className="text-amber-400 font-bold">{formatTK(balance)}</span></span>
        </div>

        {error && (
          <div className="flex items-center justify-between bg-red-900/30 border border-red-500/30 text-red-400 text-sm rounded-lg px-4 py-3">
            {error}
            <button onClick={() => setError('')}><X className="w-4 h-4" /></button>
          </div>
        )}

        {/* Show list */}
        {isLoading ? <LoadingSpinner /> : shows.length === 0 ? (
          <EmptyState icon={Video} title="No active shows" description={isCreator ? "Start a show to earn from exclusive content" : "Check back soon for exclusive private shows"} />
        ) : (
          <div className={cn('grid gap-4', isMobile ? 'grid-cols-1' : 'grid-cols-2 lg:grid-cols-3')}>
            {shows.map((show) => (
              <ShowCard
                key={show.id}
                show={show}
                currentUserId={user?.id}
                balance={balance}
                joining={joiningId === show.id}
                onJoin={() => handleJoin(show.id, show.price_tk)}
                onManage={() => setShowCreatorPanel(true)}
                onWatch={() => handleJoin(show.id, show.price_tk)}
              />
            ))}
          </div>
        )}
      </div>

      {viewingShow && <ViewerPlayerModal joinResult={viewingShow} onClose={() => setViewingShow(null)} />}
      {showCreatorPanel && myShow && <CreatorShowPanel show={myShow} onEnd={() => handleEndShow(myShow.id)} onClose={() => setShowCreatorPanel(false)} />}

      {/* Create modal */}
      {showCreate && (
        <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center px-4">
          <div className="bg-surface border border-white/10 rounded-2xl w-full max-w-md shadow-2xl">
            <div className="flex items-center justify-between p-5 border-b border-white/5">
              <h3 className="text-white font-semibold flex items-center gap-2">
                <Lock className="w-4 h-4 text-rogan-400" /> Start Private Show
              </h3>
              <button onClick={() => setShowCreate(false)}><X className="w-5 h-5 text-white/40 hover:text-white" /></button>
            </div>
            <div className="p-5 space-y-4">
              <div>
                <label className="text-white/60 text-xs mb-1.5 block">Entry Fee (TK)</label>
                <input type="number" value={priceTk} onChange={(e) => setPriceTk(e.target.value)} min="1" placeholder="10"
                  className="w-full bg-white/5 border border-white/10 rounded-lg px-4 py-2.5 text-white text-sm focus:outline-none focus:border-rogan-500/50" />
              </div>
              <div>
                <label className="text-white/60 text-xs mb-1.5 block">Duration</label>
                <div className="grid grid-cols-4 gap-2">
                  {['15', '30', '60', '120'].map((d) => (
                    <button key={d} onClick={() => setDurationMin(d)}
                      className={cn('py-2 rounded-lg text-sm transition-colors', durationMin === d ? 'bg-rogan-600 text-white' : 'bg-white/5 text-white/60 hover:bg-white/10')}>
                      {d}m
                    </button>
                  ))}
                </div>
              </div>
              <div>
                <label className="text-white/60 text-xs mb-1.5 block">Max Viewers <span className="text-white/30">(optional)</span></label>
                <input type="number" value={maxViewers} onChange={(e) => setMaxViewers(e.target.value)} min="1" placeholder="Unlimited"
                  className="w-full bg-white/5 border border-white/10 rounded-lg px-4 py-2.5 text-white text-sm focus:outline-none focus:border-rogan-500/50" />
              </div>
              {error && <p className="text-red-400 text-xs">{error}</p>}
              <p className="text-white/30 text-xs">After starting, use Manage Show to publish your camera via WHIP and end the show.</p>
              <button onClick={handleCreate} disabled={creating || !priceTk || !durationMin}
                className="w-full py-3 bg-rogan-600 hover:bg-rogan-700 text-white rounded-lg font-medium transition-colors disabled:opacity-50">
                {creating ? 'Starting...' : 'Start Show'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function ShowCard({ show, currentUserId, balance, joining, onJoin, onManage, onWatch }: {
  show: PrivateShow; currentUserId?: string; balance: number;
  joining: boolean; onJoin: () => void; onManage: () => void; onWatch: () => void;
}) {
  const isOwn = show.creator_id === currentUserId;
  const canAfford = balance >= show.price_tk;
  const creator = show.creator;

  return (
    <div className="bg-surface rounded-xl border border-white/5 overflow-hidden hover:border-rogan-500/20 transition-colors">
      <div className="relative aspect-video bg-gradient-to-br from-rogan-600/20 via-purple-600/20 to-blue-600/20 flex items-center justify-center">
        <Lock className="w-8 h-8 text-white/20" />
        <div className="absolute top-2 left-2">
          <span className={cn('text-xs px-2 py-0.5 rounded-full font-medium', show.status === 'live' ? 'bg-rogan-600 text-white' : 'bg-white/10 text-white/60')}>
            {show.status === 'live' ? '● LIVE' : 'Waiting'}
          </span>
        </div>
        <div className="absolute top-2 right-2 flex items-center gap-1 bg-black/40 text-white text-xs px-2 py-0.5 rounded">
          <Users className="w-3 h-3" /> {show.viewer_count}
          {show.max_viewers && <span className="text-white/40">/{show.max_viewers}</span>}
        </div>
      </div>
      <div className="p-4">
        <div className="flex items-center gap-2 mb-3">
          <div className="w-7 h-7 rounded-full bg-gradient-to-br from-rogan-500 to-amber-500 flex items-center justify-center text-white text-xs font-bold flex-shrink-0">
            {(creator?.username || 'C').charAt(0).toUpperCase()}
          </div>
          <p className="text-white text-sm font-medium truncate">{creator?.display_name || creator?.username || 'Creator'}</p>
        </div>
        <div className="flex items-center justify-between text-xs text-white/40 mb-3">
          <span className="flex items-center gap-1"><Clock className="w-3 h-3" /> {show.duration_minutes}m</span>
          <span className="flex items-center gap-1 text-amber-400 font-medium"><Coins className="w-3 h-3" /> {show.price_tk} TK</span>
        </div>
        {isOwn ? (
          <button onClick={onManage} className="w-full py-2 bg-rogan-600/20 hover:bg-rogan-600/30 text-rogan-400 border border-rogan-500/30 text-sm rounded-lg transition-colors flex items-center justify-center gap-2">
            <Radio className="w-4 h-4" /> Manage Your Show
          </button>
        ) : (
          <div className="flex gap-2">
            <button onClick={onJoin} disabled={joining || !canAfford}
              className={cn('flex-1 py-2 rounded-lg text-sm font-medium transition-colors flex items-center justify-center gap-2',
                canAfford ? 'bg-rogan-600 hover:bg-rogan-700 text-white' : 'bg-white/5 text-white/30 cursor-not-allowed')}>
              {joining ? <div className="w-4 h-4 border-2 border-white/40 border-t-white rounded-full animate-spin" /> : (
                <><Play className="w-4 h-4" />{canAfford ? `Join ${show.price_tk} TK` : 'Not enough TK'}</>
              )}
            </button>
            {show.status === 'live' && (
              <button onClick={onWatch} disabled={joining}
                className="px-3 py-2 rounded-lg bg-white/5 hover:bg-white/10 text-white/60 hover:text-white text-sm transition-colors" title="Watch">
                <Eye className="w-4 h-4" />
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function ViewerPlayerModal({ joinResult, onClose }: { joinResult: JoinResult; onClose: () => void }) {
  const { user, token } = useAuthStore();
  const isMobile = useIsMobile();
  const videoRef = useRef<HTMLVideoElement>(null);
  const wsRef = useRef<StreamWSClient | null>(null);
  const chatEndRef = useRef<HTMLDivElement>(null);
  const chatInputRef = useRef<HTMLInputElement>(null);
  const [buffering, setBuffering] = useState(true);
  const [timedOut, setTimedOut] = useState(false);
  const [muted, setMuted] = useState(true);
  const [showChat, setShowChat] = useState(true);
  const [chatMessages, setChatMessages] = useState<Array<{ id: string; user: string; text: string; self: boolean }>>([]);
  const [chatInput, setChatInput] = useState('');

  // HLS player
  useEffect(() => {
    const video = videoRef.current;
    if (!video || !joinResult.hls_url) return;
    setBuffering(true); setTimedOut(false);
    const tid = setTimeout(() => setTimedOut(true), 35_000);
    if (Hls.isSupported()) {
      const hls = new Hls({ enableWorker: true, lowLatencyMode: false, backBufferLength: 30, maxBufferLength: 8, manifestLoadingMaxRetry: 20, manifestLoadingRetryDelay: 2000 });
      hls.loadSource(joinResult.hls_url);
      hls.attachMedia(video);
      hls.on(Hls.Events.MANIFEST_PARSED, () => { clearTimeout(tid); setBuffering(false); video.play().catch(() => {}); });
      hls.on(Hls.Events.ERROR, (_e, d) => {
        if (d.fatal) {
          if (d.type === Hls.ErrorTypes.NETWORK_ERROR) setTimeout(() => hls.startLoad(), 3000);
          else if (d.type === Hls.ErrorTypes.MEDIA_ERROR) hls.recoverMediaError();
        }
      });
      return () => { hls.destroy(); clearTimeout(tid); };
    } else if (video.canPlayType('application/vnd.apple.mpegurl')) {
      video.src = joinResult.hls_url; video.play().catch(() => {});
      return () => clearTimeout(tid);
    }
  }, [joinResult.hls_url]);

  // WebSocket chat — use show_id as the WS room
  useEffect(() => {
    if (!user?.id || !token) return;
    const ws = new StreamWSClient({
      streamId: joinResult.show_id,
      userId: user.id,
      token,
      onChat: (msg) => {
        setChatMessages((prev) => [...prev, { id: msg.id || String(Date.now()), user: msg.username || 'Viewer', text: msg.message, self: msg.user_id === user.id }]);
      },
    });
    ws.connect();
    wsRef.current = ws;
    return () => { ws.disconnect(); wsRef.current = null; };
  }, [joinResult.show_id, user?.id, token]);

  // Load chat history on mount so rejoining viewers see prior messages
  useEffect(() => {
    if (!user?.id) return;
    api.get(`/private-shows/${joinResult.show_id}/chat/history`)
      .then(res => {
        const hist = (res.data.messages || []).map((m: any) => ({
          id: m.id || String(Date.now() + Math.random()),
          user: m.username || 'Viewer',
          text: m.content,
          self: m.user_id === user.id,
        }));
        setChatMessages(hist);
      })
      .catch(() => {});
  }, [joinResult.show_id, user?.id]);

  // Auto-scroll chat
  useEffect(() => { chatEndRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [chatMessages]);

  const sendChat = () => {
    const text = chatInput.trim();
    if (!text || !wsRef.current) return;
    wsRef.current.sendChat(text, user?.username || 'Viewer');
    // Optimistic echo — WS skips self messages to avoid duplicates
    setChatMessages((prev) => [...prev, { id: String(Date.now()), user: user?.username || 'You', text, self: true }]);
    setChatInput('');
  };

  const toggleMute = () => { if (videoRef.current) { videoRef.current.muted = !muted; setMuted((m) => !m); } };

  return (
    <div className="fixed inset-0 bg-black z-50 flex flex-col">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 bg-black/80 backdrop-blur-sm flex-shrink-0">
        <div className="flex items-center gap-2">
          <Lock className="w-4 h-4 text-rogan-400" />
          <span className="text-white font-semibold text-sm">Private Show</span>
          <span className={cn('text-xs px-2 py-0.5 rounded-full', joinResult.show_status === 'live' ? 'bg-rogan-600 text-white' : 'bg-white/10 text-white/60')}>
            {joinResult.show_status === 'live' ? '● LIVE' : 'Waiting for creator...'}
          </span>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={toggleMute} className="p-2 rounded-lg bg-white/10 hover:bg-white/20 text-white transition-colors">
            {muted ? <MicOff className="w-4 h-4" /> : <Mic className="w-4 h-4" />}
          </button>
          <button onClick={() => setShowChat((c) => !c)} className={cn('p-2 rounded-lg transition-colors text-white', showChat ? 'bg-rogan-600/40' : 'bg-white/10 hover:bg-white/20')}>
            <MessageSquare className="w-4 h-4" />
          </button>
          <button onClick={onClose} className="p-2 rounded-lg bg-white/10 hover:bg-white/20 text-white transition-colors">
            <X className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Body: video + optional chat panel
          Desktop: side-by-side (video flex-1, chat w-72)
          Mobile: stacked vertically (video flex-[2], chat flex-[3]) */}
      <div className={cn('flex-1 flex overflow-hidden', isMobile ? 'flex-col' : 'flex-row')}>
        {/* Video */}
        <div className={cn('relative bg-black flex items-center justify-center', isMobile ? 'flex-[2] min-h-0' : 'flex-1')}>
          <video ref={videoRef} className="w-full h-full object-contain" autoPlay playsInline muted={muted} />
          {buffering && !timedOut && (
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-4 bg-black/60">
              <div className="w-10 h-10 border-3 border-white/20 border-t-rogan-500 rounded-full animate-spin" />
              <p className="text-white/60 text-sm">Waiting for stream...</p>
            </div>
          )}
          {timedOut && (
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-4 bg-black/80">
              <Lock className="w-10 h-10 text-white/20" />
              <p className="text-white/60 text-sm">Creator hasn&apos;t started streaming yet.</p>
              <button onClick={() => { setTimedOut(false); setBuffering(true); }}
                className="px-4 py-2 bg-rogan-600 hover:bg-rogan-700 text-white text-sm rounded-lg transition-colors">
                Retry
              </button>
            </div>
          )}
        </div>

        {/* Chat panel */}
        {showChat && (
          <div className={cn('flex flex-col bg-black/90 border-white/5', isMobile ? 'flex-[3] min-h-0 border-t' : 'w-72 border-l flex-shrink-0')}>
            <div className="px-3 py-2 border-b border-white/5 flex items-center gap-2 flex-shrink-0">
              <MessageSquare className="w-3.5 h-3.5 text-white/40" />
              <span className="text-white/40 text-xs font-medium">Live Chat</span>
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-3 space-y-2 scrollbar-thin">
              {chatMessages.length === 0 && (
                <p className="text-white/20 text-xs text-center mt-6">No messages yet. Say something!</p>
              )}
              {chatMessages.map((m) => (
                <div key={m.id} className={cn('text-xs', m.self ? 'text-right' : '')}>
                  <span className="text-rogan-400 font-medium">{m.self ? 'You' : m.user}: </span>
                  <span className="text-white/80">{m.text}</span>
                </div>
              ))}
              <div ref={chatEndRef} />
            </div>
            <div className="p-3 border-t border-white/5 flex gap-2 flex-shrink-0">
              <input
                ref={chatInputRef}
                value={chatInput}
                onChange={(e) => setChatInput(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && sendChat()}
                onFocus={() => setTimeout(() => chatInputRef.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' }), 300)}
                placeholder="Say something..."
                className="flex-1 bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-white text-xs placeholder-white/30 focus:outline-none focus:border-rogan-500/50"
              />
              <button onClick={sendChat} disabled={!chatInput.trim()}
                className="p-2 bg-rogan-600 hover:bg-rogan-700 text-white rounded-lg transition-colors disabled:opacity-40">
                <Send className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>
        )}
      </div>

      <div className="px-4 py-2 bg-black/80 text-white/30 text-xs text-center flex-shrink-0">
        Your entry fee has been paid. Stay in this room — stream will appear when the creator goes live.
      </div>
    </div>
  );
}

function CreatorShowPanel({ show, onEnd, onClose }: { show: PrivateShow; onEnd: () => void; onClose: () => void }) {
  const { user, token } = useAuthStore();
  const isMobile = useIsMobile();
  const videoRef = useRef<HTMLVideoElement>(null);
  const pcRef = useRef<RTCPeerConnection | null>(null);
  const wsRef = useRef<StreamWSClient | null>(null);
  const chatEndRef = useRef<HTMLDivElement>(null);
  const mediaStreamRef = useRef<MediaStream | null>(null);
  const [publishing, setPublishing] = useState(false);
  const [camError, setCamError] = useState('');
  const [camOn, setCamOn] = useState(false);
  const [ending, setEnding] = useState(false);
  const [fullscreen, setFullscreen] = useState(false);
  const [chatMessages, setChatMessages] = useState<Array<{ id: string; user: string; text: string; self: boolean }>>([]);
  const [chatInput, setChatInput] = useState('');

  // WebSocket chat room for this show
  useEffect(() => {
    if (!user?.id || !token) return;
    const ws = new StreamWSClient({
      streamId: show.id,
      userId: user.id,
      token,
      onChat: (msg) => {
        setChatMessages((prev) => [...prev, { id: msg.id || String(Date.now()), user: msg.username || 'Viewer', text: msg.message, self: msg.user_id === user.id }]);
      },
    });
    ws.connect();
    wsRef.current = ws;
    return () => { ws.disconnect(); wsRef.current = null; };
  }, [show.id, user?.id, token]);

  // Load chat history so the creator sees messages sent before they refreshed
  useEffect(() => {
    if (!user?.id) return;
    api.get(`/private-shows/${show.id}/chat/history`)
      .then(res => {
        const hist = (res.data.messages || []).map((m: any) => ({
          id: m.id || String(Date.now() + Math.random()),
          user: m.username || 'Viewer',
          text: m.content,
          self: m.user_id === user.id,
        }));
        setChatMessages(hist);
      })
      .catch(() => {});
  }, [show.id, user?.id]);

  useEffect(() => { chatEndRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [chatMessages]);

  const sendChat = () => {
    const text = chatInput.trim();
    if (!text || !wsRef.current) return;
    wsRef.current.sendChat(text, user?.username || 'Creator');
    // Optimistic echo — WS skips self messages to avoid duplicates
    setChatMessages((prev) => [...prev, { id: String(Date.now()), user: user?.username || 'You', text, self: true }]);
    setChatInput('');
  };

  // Next.js rewrite: /whip/:path* → mediamtx:8889/:path*
  // MediaMTX WHIP endpoint is /{streamKey}/whip, so the full proxied path is /whip/{streamKey}/whip
  const whipUrl = show.stream_key ? `/whip/${show.stream_key}/whip` : null;

  const startPublish = async () => {
    if (!whipUrl || !videoRef.current) return;
    setCamError('');
    setPublishing(true);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
      mediaStreamRef.current = stream;
      videoRef.current.srcObject = stream;
      videoRef.current.play().catch(() => {});
      setCamOn(true);
      const pc = new RTCPeerConnection({ iceServers: [{ urls: 'stun:stun.l.google.com:19302' }] });
      pcRef.current = pc;
      stream.getTracks().forEach((t) => pc.addTrack(t, stream));
      pc.getTransceivers().forEach((t) => {
        if (t.sender.track?.kind === 'video' && t.setCodecPreferences) {
          const caps = RTCRtpSender.getCapabilities('video');
          if (caps) {
            const h264 = caps.codecs.filter((c) => c.mimeType === 'video/H264');
            const rest = caps.codecs.filter((c) => c.mimeType !== 'video/H264');
            if (h264.length) t.setCodecPreferences([...h264, ...rest]);
          }
        }
      });
      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);

      // Wait for ICE gathering before sending offer — same as GoLive.tsx
      await new Promise<void>((resolve) => {
        if (pc.iceGatheringState === 'complete') { resolve(); return; }
        const onState = () => { if (pc.iceGatheringState === 'complete') { pc.removeEventListener('icegatheringstatechange', onState); resolve(); } };
        pc.addEventListener('icegatheringstatechange', onState);
        setTimeout(() => { pc.removeEventListener('icegatheringstatechange', onState); resolve(); }, 8000);
      });

      const resp = await fetch(whipUrl, { method: 'POST', headers: { 'Content-Type': 'application/sdp' }, body: pc.localDescription!.sdp });
      if (!resp.ok) throw new Error(`WHIP ${resp.status}: ${await resp.text()}`);
      const answerSdp = await resp.text();
      await pc.setRemoteDescription({ type: 'answer', sdp: answerSdp });
    } catch (err: unknown) {
      setCamError(err instanceof Error ? err.message : 'Failed to start camera');
      stopPublish();
    } finally {
      setPublishing(false);
    }
  };

  const stopPublish = () => {
    pcRef.current?.close(); pcRef.current = null;
    mediaStreamRef.current?.getTracks().forEach((t) => t.stop());
    mediaStreamRef.current = null;
    if (videoRef.current) videoRef.current.srcObject = null;
    setCamOn(false);
  };

  const handleEnd = async () => {
    setEnding(true);
    stopPublish();
    await onEnd();
    setEnding(false);
  };

  // Auto-enter streaming mode when camera goes live
  useEffect(() => { if (camOn) setFullscreen(true); }, [camOn]);

  // Re-attach stream to new <video> element after layout switch (setup ↔ streaming)
  useEffect(() => {
    if (videoRef.current && mediaStreamRef.current) {
      videoRef.current.srcObject = mediaStreamRef.current;
      videoRef.current.play().catch(() => {});
    }
  }, [camOn, fullscreen]);

  useEffect(() => () => stopPublish(), []);

  // ── Streaming view (camera live + fullscreen) ─────────────────────────────
  if (camOn && fullscreen) {
    return (
      <div className="fixed inset-0 z-50 bg-black flex flex-col">
        {/* Top bar */}
        <div className="flex items-center justify-between px-4 py-3 bg-black/70 backdrop-blur-sm flex-shrink-0">
          <div className="flex items-center gap-3">
            <span className="bg-rogan-600 text-white text-xs px-2 py-0.5 rounded-full font-medium animate-pulse">● LIVE</span>
            <div className="flex items-center gap-3 text-white/60 text-xs">
              <span className="flex items-center gap-1"><Users className="w-3.5 h-3.5" />{show.viewer_count}</span>
              <span className="flex items-center gap-1 text-amber-400"><Coins className="w-3.5 h-3.5" />{show.total_revenue} TK</span>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button onClick={() => setFullscreen(false)} className="p-1.5 rounded-lg bg-white/10 hover:bg-white/20 text-white/60 hover:text-white transition-colors">
              <Minimize2 className="w-4 h-4" />
            </button>
            <button onClick={stopPublish} className="flex items-center gap-1.5 px-3 py-1.5 bg-white/10 hover:bg-white/20 text-white text-xs rounded-lg transition-colors">
              <CameraOff className="w-3.5 h-3.5" /> Stop Camera
            </button>
            <button onClick={handleEnd} disabled={ending} className="flex items-center gap-1.5 px-3 py-1.5 bg-red-600 hover:bg-red-700 text-white text-xs rounded-lg transition-colors disabled:opacity-50">
              <StopCircle className="w-3.5 h-3.5" /> {ending ? 'Ending…' : 'End Show'}
            </button>
            <button onClick={onClose} className="p-1.5 rounded-lg bg-white/10 hover:bg-white/20 text-white/60 hover:text-white transition-colors">
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Body: video + chat
            Desktop: side-by-side (video flex-1, chat w-72)
            Mobile: stacked vertically (video flex-[2], chat flex-[3]) */}
        <div className={cn('flex-1 flex overflow-hidden', isMobile ? 'flex-col' : 'flex-row')}>
          {/* Video */}
          <div className={cn('relative bg-black', isMobile ? 'flex-[2] min-h-0' : 'flex-1')}>
            <video ref={videoRef} className="w-full h-full object-cover" autoPlay playsInline muted />
          </div>

          {/* Chat sidebar */}
          <div className={cn('flex flex-col bg-black/90 border-white/5', isMobile ? 'flex-[3] min-h-0 border-t' : 'w-72 border-l flex-shrink-0')}>
            <div className="px-3 py-2 border-b border-white/5 flex items-center gap-2 flex-shrink-0">
              <MessageSquare className="w-3.5 h-3.5 text-white/40" />
              <span className="text-white/40 text-xs font-medium">Viewer Chat</span>
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-3 space-y-2 scrollbar-thin">
              {chatMessages.length === 0 && (
                <p className="text-white/20 text-xs text-center mt-6">No messages yet</p>
              )}
              {chatMessages.map((m) => (
                <div key={m.id} className="text-xs">
                  <span className={cn('font-medium', m.self ? 'text-amber-400' : 'text-rogan-400')}>{m.self ? 'You' : m.user}: </span>
                  <span className="text-white/80">{m.text}</span>
                </div>
              ))}
              <div ref={chatEndRef} />
            </div>
            <div className="p-3 border-t border-white/5 flex gap-2 flex-shrink-0">
              <input
                value={chatInput}
                onChange={(e) => setChatInput(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && sendChat()}
                placeholder="Say something..."
                className="flex-1 bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-white text-xs placeholder-white/30 focus:outline-none focus:border-rogan-500/50"
              />
              <button onClick={sendChat} disabled={!chatInput.trim()}
                className="p-2 bg-rogan-600 hover:bg-rogan-700 text-white rounded-lg transition-colors disabled:opacity-40">
                <Send className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // ── Setup / management view (camera off or minimised) ────────────────────
  return (
    <div className={cn('fixed inset-0 z-50 flex', fullscreen ? 'bg-black' : 'bg-black/80 items-center justify-center px-4 overflow-y-auto')}>
      <div className={cn('bg-surface border border-white/10 shadow-2xl overflow-hidden', fullscreen ? 'w-full h-full flex flex-col rounded-none' : 'rounded-2xl w-full max-w-lg my-4')}>
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-white/5 flex-shrink-0">
          <h3 className="text-white font-semibold flex items-center gap-2">
            <Radio className="w-4 h-4 text-rogan-400 animate-pulse" /> Your Private Show
          </h3>
          <div className="flex items-center gap-2">
            <button onClick={() => setFullscreen((f) => !f)} className="p-1.5 rounded-lg bg-white/10 hover:bg-white/20 text-white/60 hover:text-white transition-colors" title={fullscreen ? 'Minimise' : 'Expand'}>
              {fullscreen ? <Minimize2 className="w-4 h-4" /> : <Maximize2 className="w-4 h-4" />}
            </button>
            <button onClick={onClose}><X className="w-5 h-5 text-white/40 hover:text-white" /></button>
          </div>
        </div>

        {/* Content */}
        <div className={cn('space-y-4 overflow-y-auto', fullscreen ? 'flex-1 p-5' : 'p-5')}>
          {/* Stats */}
          <div className="grid grid-cols-3 gap-3">
            <div className="bg-white/5 rounded-xl p-3 text-center">
              <p className="text-white/40 text-xs mb-1">Status</p>
              <p className={cn('text-sm font-semibold', show.status === 'live' ? 'text-rogan-400' : 'text-white/60')}>
                {show.status === 'live' ? '● LIVE' : 'Waiting'}
              </p>
            </div>
            <div className="bg-white/5 rounded-xl p-3 text-center">
              <p className="text-white/40 text-xs mb-1">Viewers</p>
              <p className="text-white text-sm font-semibold">{show.viewer_count}</p>
            </div>
            <div className="bg-white/5 rounded-xl p-3 text-center">
              <p className="text-white/40 text-xs mb-1">Revenue</p>
              <p className="text-amber-400 text-sm font-semibold">{show.total_revenue} TK</p>
            </div>
          </div>

          {/* Camera preview */}
          <div className="relative aspect-video bg-black rounded-xl overflow-hidden">
            <video ref={videoRef} className="w-full h-full object-cover" autoPlay playsInline muted />
            {!camOn && <div className="absolute inset-0 flex items-center justify-center"><CameraOff className="w-8 h-8 text-white/20" /></div>}
          </div>
          {camError && <p className="text-red-400 text-xs">{camError}</p>}

          {/* Stream key for OBS */}
          {show.stream_key && (
            <div className="bg-white/5 rounded-lg px-4 py-3">
              <p className="text-white/40 text-xs mb-1">Stream Key (OBS/external)</p>
              <p className="text-white/70 text-xs font-mono break-all">{show.stream_key}</p>
              <p className="text-white/30 text-[10px] mt-1">RTMP: rtmp://localhost:1935/live</p>
            </div>
          )}

          {/* Controls */}
          <div className="flex gap-3">
            <button onClick={startPublish} disabled={publishing || !whipUrl}
              className="flex-1 py-3 bg-rogan-600 hover:bg-rogan-700 text-white rounded-lg font-medium transition-colors disabled:opacity-50 flex items-center justify-center gap-2">
              {publishing ? <div className="w-4 h-4 border-2 border-white/40 border-t-white rounded-full animate-spin" /> : <><Camera className="w-4 h-4" /> Start Camera</>}
            </button>
            <button onClick={handleEnd} disabled={ending}
              className="px-4 py-3 bg-red-900/40 hover:bg-red-900/60 text-red-400 border border-red-500/30 rounded-lg font-medium transition-colors flex items-center justify-center gap-2 disabled:opacity-50">
              <StopCircle className="w-4 h-4" />
              {ending ? 'Ending...' : 'End Show'}
            </button>
          </div>

          {/* Live Chat */}
          <div className="border border-white/5 rounded-xl overflow-hidden">
            <div className="flex items-center gap-2 px-4 py-2.5 bg-white/5 border-b border-white/5">
              <MessageSquare className="w-3.5 h-3.5 text-white/40" />
              <span className="text-white/40 text-xs font-medium">Viewer Chat</span>
            </div>
            <div className="h-36 overflow-y-auto p-3 space-y-1.5 scrollbar-thin bg-black/20">
              {chatMessages.length === 0 && (
                <p className="text-white/20 text-xs text-center mt-4">No messages yet</p>
              )}
              {chatMessages.map((m) => (
                <div key={m.id} className="text-xs">
                  <span className={cn('font-medium', m.self ? 'text-rogan-400' : 'text-white/60')}>{m.user}: </span>
                  <span className="text-white/80">{m.text}</span>
                </div>
              ))}
              <div ref={chatEndRef} />
            </div>
            {/* Chat input */}
            <form onSubmit={(e) => { e.preventDefault(); sendChat(); }} className="flex gap-2 p-3 border-t border-white/5">
              <input
                value={chatInput}
                onChange={(e) => setChatInput(e.target.value)}
                placeholder="Message..."
                className="flex-1 bg-white/5 border border-white/10 rounded-lg px-3 py-1.5 text-xs text-white placeholder:text-white/30 focus:outline-none"
              />
              <button type="submit" disabled={!chatInput.trim()} className="px-3 py-1.5 bg-rogan-600 hover:bg-rogan-700 disabled:opacity-30 text-white rounded-lg text-xs transition-colors">
                <Send className="w-3.5 h-3.5" />
              </button>
            </form>
          </div>
        </div>
      </div>
    </div>
  );
}
