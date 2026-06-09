'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { ArrowLeft, Send, Users, Gift, X, ChevronRight } from 'lucide-react';
import Hls from 'hls.js';
import { useAuthStore } from '@/stores/authStore';
import { useStreamStore } from '@/stores/streamStore';
import { useChatStore } from '@/stores/chatStore';
import { useGiftStore } from '@/stores/giftStore';
import { StreamWSClient } from '@/lib/ws';
import { useIsMobile } from '@/hooks/use-mobile';
import { formatTK, cn } from '@/lib/utils';
import LiveBadge from '@/components/shared/LiveBadge';
import { GIFT_CONFIG } from '@/types';
import type { GiftType, ChatMessage } from '@/types';

interface LiveRoomProps {
  streamId: string;
  onBack: () => void;
}

export default function LiveRoom({ streamId, onBack }: LiveRoomProps) {
  const { user, token } = useAuthStore();
  const { fetchStream, setViewerCount, viewerCount } = useStreamStore();
  const { messages, addMessage, addSystemMessage, addGiftAnimation, giftAnimations, isOpen: chatOpen, toggleChat } = useChatStore();
  const { sendGift } = useGiftStore();
  const isMobile = useIsMobile(960);

  const videoRef = useRef<HTMLVideoElement>(null);
  const wsRef = useRef<StreamWSClient | null>(null);
  const chatEndRef = useRef<HTMLDivElement>(null);
  const [chatInput, setChatInput] = useState('');
  const [showGiftPicker, setShowGiftPicker] = useState(false);
  const [stream, setStream] = useState<any>(null);
  const [isConnecting, setIsConnecting] = useState(true);

  // Fetch stream details
  useEffect(() => {
    fetchStream(streamId).then(setStream).catch(() => {
      addSystemMessage('Failed to load stream');
    }).finally(() => setIsConnecting(false));
  }, [streamId, fetchStream, addSystemMessage]);

  // Setup HLS player
  useEffect(() => {
    if (!stream?.stream_key || !videoRef.current) return;

    const hlsUrl = `/live/${stream.stream_key}/index.m3u8`;
    const video = videoRef.current;

    if (Hls.isSupported()) {
      const hls = new Hls({
        enableWorker: true,
        lowLatencyMode: true,
        backBufferLength: 90,
      });
      hls.loadSource(hlsUrl);
      hls.attachMedia(video);
      hls.on(Hls.Events.MANIFEST_PARSED, () => {
        video.play().catch(() => {});
      });
      hls.on(Hls.Events.ERROR, (_event, data) => {
        if (data.fatal) {
          if (data.type === Hls.ErrorTypes.NETWORK_ERROR) {
            hls.startLoad();
          } else if (data.type === Hls.ErrorTypes.MEDIA_ERROR) {
            hls.recoverMediaError();
          }
        }
      });
      return () => { hls.destroy(); };
    } else if (video.canPlayType('application/vnd.apple.mpegurl')) {
      video.src = hlsUrl;
      video.play().catch(() => {});
    }
  }, [stream?.stream_key]);

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
    if (!chatInput.trim()) return;
    wsRef.current?.sendChat(chatInput.trim());
    setChatInput('');
  };

  const handleSendGift = async (giftType: GiftType) => {
    const result = await sendGift({ stream_id: streamId, gift_type: giftType });
    if (result) {
      addGiftAnimation(giftType, user?.username || 'You');
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
      <div className={cn('relative', isMobile ? 'flex-1' : chatOpen ? 'flex-1' : 'flex-1')}>
        {/* Video Player */}
        <video
          ref={videoRef}
          className="w-full h-full object-contain"
          autoPlay
          playsInline
          muted
        />

        {/* Stream offline overlay */}
        {stream && !stream.is_live && (
          <div className="absolute inset-0 bg-black/80 flex flex-col items-center justify-center">
            <p className="text-white/60 text-lg mb-2">Stream has ended</p>
            <button onClick={onBack} className="px-4 py-2 bg-rogan-600 text-white rounded-lg text-sm">
              Go Back
            </button>
          </div>
        )}

        {/* Back button */}
        <button
          onClick={onBack}
          className="absolute top-4 left-4 w-9 h-9 rounded-full bg-black/50 backdrop-blur-sm flex items-center justify-center text-white hover:bg-black/70 transition-colors"
        >
          <ArrowLeft className="w-5 h-5" />
        </button>

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

        {/* Mobile: Chat overlay (bottom) */}
        {isMobile && (
          <div className="absolute bottom-0 left-0 right-0">
            {/* Mini chat messages */}
            <div className="max-h-32 overflow-y-auto no-scrollbar px-3 pb-2">
              {messages.slice(-5).map((msg) => (
                <div key={msg.id} className="text-xs mb-0.5">
                  <span className="text-rogan-400 font-medium">{msg.username}: </span>
                  <span className="text-white/80">{msg.message}</span>
                </div>
              ))}
            </div>
            {/* Chat input + Gift button */}
            <div className="flex items-center gap-2 p-2 bg-gradient-to-t from-black/80 to-transparent">
              <button
                onClick={() => setShowGiftPicker(!showGiftPicker)}
                className="w-9 h-9 rounded-full bg-tk/20 flex items-center justify-center flex-shrink-0"
              >
                <Gift className="w-4 h-4 text-tk" />
              </button>
              <input
                type="text"
                value={chatInput}
                onChange={(e) => setChatInput(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleSendChat()}
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

        {/* Mobile Gift Picker */}
        {isMobile && showGiftPicker && (
          <div className="absolute bottom-20 left-2 right-2 bg-surface rounded-xl border border-white/10 p-3 shadow-xl">
            <div className="flex items-center justify-between mb-2">
              <span className="text-white text-sm font-medium">Send a Gift</span>
              <button onClick={() => setShowGiftPicker(false)}>
                <X className="w-4 h-4 text-white/40" />
              </button>
            </div>
            <div className="grid grid-cols-5 gap-2">
              {(Object.entries(GIFT_CONFIG) as [GiftType, typeof GIFT_CONFIG[GiftType]][]).map(([type, config]) => (
                <button
                  key={type}
                  onClick={() => handleSendGift(type)}
                  className="flex flex-col items-center gap-1 p-2 rounded-lg hover:bg-white/5 transition-colors"
                >
                  <span className="text-xl">{config.emoji}</span>
                  <span className="text-[10px] text-tk font-medium">{config.price} TK</span>
                </button>
              ))}
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
            {messages.map((msg) => (
              <div key={msg.id} className={cn('text-sm', msg.type === 'system' && 'text-center')}>
                {msg.type === 'system' ? (
                  <span className="text-white/30 text-xs italic">{msg.message}</span>
                ) : (
                  <>
                    <span className="text-rogan-400 font-medium">{msg.username}</span>
                    <span className="text-white/40">: </span>
                    <span className="text-white/80">{msg.message}</span>
                  </>
                )}
              </div>
            ))}
            <div ref={chatEndRef} />
          </div>

          {/* Gift Picker */}
          {showGiftPicker && (
            <div className="border-t border-white/5 p-3">
              <div className="flex items-center justify-between mb-2">
                <span className="text-white text-xs font-medium">Send a Gift</span>
                <button onClick={() => setShowGiftPicker(false)}>
                  <X className="w-3 h-3 text-white/40" />
                </button>
              </div>
              <div className="flex gap-2">
                {(Object.entries(GIFT_CONFIG) as [GiftType, typeof GIFT_CONFIG[GiftType]][]).map(([type, config]) => (
                  <button
                    key={type}
                    onClick={() => handleSendGift(type)}
                    className="flex-1 flex flex-col items-center gap-0.5 p-2 rounded-lg hover:bg-white/5 transition-colors"
                  >
                    <span className="text-lg">{config.emoji}</span>
                    <span className="text-[9px] text-tk font-medium">{config.price}</span>
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Input */}
          <div className="p-3 border-t border-white/5">
            <div className="flex items-center gap-2">
              <button
                onClick={() => setShowGiftPicker(!showGiftPicker)}
                className="w-9 h-9 rounded-full bg-tk/20 flex items-center justify-center flex-shrink-0 hover:bg-tk/30 transition-colors"
              >
                <Gift className="w-4 h-4 text-tk" />
              </button>
              <input
                type="text"
                value={chatInput}
                onChange={(e) => setChatInput(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleSendChat()}
                placeholder="Send a message..."
                className="flex-1 bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm text-white placeholder:text-white/30 focus:outline-none focus:border-rogan-500/50"
              />
              <button
                onClick={handleSendChat}
                className="w-9 h-9 rounded-full bg-rogan-600 flex items-center justify-center flex-shrink-0 hover:bg-rogan-700 transition-colors"
              >
                <Send className="w-4 h-4 text-white" />
              </button>
            </div>
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
