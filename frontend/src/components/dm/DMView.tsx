'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { MessageSquare, Send, ArrowLeft, Search, X, UserPlus, Reply, MoreVertical, Trash2, MessageSquareOff, Pencil, Check, Mic, Play, Pause, MicOff, Video, Phone } from 'lucide-react';
import { useDMStore } from '@/stores/dmStore';
import { useAuthStore } from '@/stores/authStore';
import { useIsMobile } from '@/hooks/use-mobile';
import { cn, formatMessageTime } from '@/lib/utils';
import EmptyState from '@/components/shared/EmptyState';
import LoadingSpinner from '@/components/shared/LoadingSpinner';
import api from '@/lib/api';
import { DMWSClient } from '@/lib/dmWs';
import { savePhoto, getPhoto } from '@/lib/dmPhotoStore';
import type { DMConversation, DMMessage } from '@/types';
import VoiceVideoCall, { type VoiceVideoCallHandle, type CallEventPayload } from './VoiceVideoCall';

// ── Call log (ephemeral, session-only) ────────────────────────────────────────
interface CallLog {
  id: string;
  type: 'missed' | 'rejected' | 'ended';
  mode: 'video' | 'audio';
  outgoing: boolean;
  duration?: number;
  timestamp: number;
}

interface SearchUser {
  id: string;
  username: string;
  display_name: string | null;
  avatar: string | null;
  role: string;
  is_live: boolean;
}

// ── Voice Note Player ────────────────────────────────────────────────────────
function VoiceNotePlayer({ audioUrl, duration, isMine }: { audioUrl: string; duration: number; isMine: boolean }) {
  const [playing, setPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const audioRef = useRef<HTMLAudioElement>(null);

  const toggle = () => {
    if (!audioRef.current) return;
    if (playing) audioRef.current.pause();
    else audioRef.current.play().catch(() => {});
  };

  const fmt = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
  const progress = duration > 0 ? Math.min((currentTime / duration) * 100, 100) : 0;
  const displayTime = playing ? fmt(currentTime) : fmt(duration);

  return (
    <div className="flex items-center gap-2.5 min-w-[180px] max-w-[240px]">
      <audio
        ref={audioRef}
        src={audioUrl}
        onPlay={() => setPlaying(true)}
        onPause={() => setPlaying(false)}
        onEnded={() => { setPlaying(false); setCurrentTime(0); }}
        onTimeUpdate={() => setCurrentTime(audioRef.current?.currentTime ?? 0)}
        preload="metadata"
      />
      <button
        onClick={toggle}
        className={cn(
          'w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0 transition-colors',
          isMine ? 'bg-white/20 hover:bg-white/30' : 'bg-rogan-500/40 hover:bg-rogan-500/60'
        )}
      >
        {playing
          ? <Pause className="w-3.5 h-3.5 text-white" />
          : <Play className="w-3.5 h-3.5 text-white ml-0.5" />
        }
      </button>
      <div className="flex-1 min-w-0">
        {/* Progress bar */}
        <div
          className="h-1 rounded-full overflow-hidden bg-white/20 cursor-pointer"
          onClick={(e) => {
            if (!audioRef.current || !duration) return;
            const rect = e.currentTarget.getBoundingClientRect();
            const ratio = (e.clientX - rect.left) / rect.width;
            audioRef.current.currentTime = ratio * duration;
          }}
        >
          <div
            className="h-full bg-white/70 rounded-full transition-all duration-100"
            style={{ width: `${progress}%` }}
          />
        </div>
        <span className="text-[10px] text-white/50 mt-0.5 block">{displayTime}</span>
      </div>
      <Mic className="w-3 h-3 text-white/30 flex-shrink-0" />
    </div>
  );
}

// ── Emoji & Sticker data ─────────────────────────────────────────────────────
const EMOJIS = [
  '😀','😂','🥹','😍','🤩','😎','🥳','😴','🤔','😱','🤗','😡','🥺','😭','😘','🤭',
  '😆','🙃','😏','😒','🥱','😤','🤯','🥸','🤓','😇','🤠','🤡','👻','💀','👽','🤖',
  '❤️','🧡','💛','💚','💙','💜','🖤','🤍','💔','❤️‍🔥','💕','😻','👍','👎','👏','🙌',
  '🤝','🙏','💪','🫶','✌️','🤞','👌','🤙','🫠','💯','🔥','✨','🎉','🎊','🎈','🌟',
  '💫','⚡','🌈','🍕','🍔','🎂','🍦','🧁','🍺','☕','🚀','🌺','🐶','🐱','🦊','🐼',
];

const STICKERS = [
  '😂','😍','🥳','😭','🤩','😎','🤣','🥺','😤','🤯',
  '👑','💎','🔥','❤️‍🔥','💯','🚀','🎉','✨','🙌','🫶',
  '😏','🤭','😇','🤠','👻','💀','🤖','👽','🎭','🌟',
];

// ── Photo Message (loads from IndexedDB on device) ────────────────────────────
function PhotoMessage({ messageId, isMine }: { messageId: string; isMine: boolean }) {
  const [src, setSrc] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    getPhoto(messageId).then((url) => {
      setSrc(url);
      setLoading(false);
    }).catch(() => setLoading(false));
  }, [messageId]);

  if (loading) {
    return (
      <div className="w-40 h-32 rounded-xl bg-white/10 flex items-center justify-center">
        <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
      </div>
    );
  }
  if (!src) {
    return (
      <div className={cn(
        'w-40 h-24 rounded-xl flex flex-col items-center justify-center gap-1 text-white/30',
        isMine ? 'bg-white/10' : 'bg-black/20'
      )}>
        <span className="text-2xl">📷</span>
        <span className="text-[10px]">Photo not available</span>
      </div>
    );
  }
  return (
    <img
      src={src}
      alt="Shared photo"
      className="max-w-[220px] max-h-[280px] rounded-xl object-cover cursor-pointer"
      onClick={() => window.open(src, '_blank')}
    />
  );
}

export default function DMView() {
  const {
    conversations, currentConversation, messages,
    fetchConversations, fetchMessages, sendMessage,
    addMessage, editMessage, deleteMessage, applyMessageEdit, applyMessageDelete,
    clearChat, deleteConversation, markAsRead, setCurrentConversation, isLoading,
  } = useDMStore();
  const { user } = useAuthStore();
  const isMobile = useIsMobile(960);

  const [messageInput, setMessageInput] = useState('');
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<SearchUser[]>([]);
  const [searching, setSearching] = useState(false);
  const [startingConv, setStartingConv] = useState(false);
  const [replyTo, setReplyTo] = useState<DMMessage | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [confirmAction, setConfirmAction] = useState<'clear' | 'delete' | null>(null);
  const [actionLoading, setActionLoading] = useState(false);

  // Message action state
  const [activeMsg, setActiveMsg] = useState<DMMessage | null>(null);
  const [editMode, setEditMode] = useState(false);
  const [editContent, setEditContent] = useState('');
  const [deleteConfirm, setDeleteConfirm] = useState(false);
  const [msgActionLoading, setMsgActionLoading] = useState(false);

  const chatEndRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const editInputRef = useRef<HTMLInputElement>(null);
  const longPressTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const touchMoved = useRef(false);

  // Voice recording
  const [recording, setRecording] = useState(false);
  const [recordSecs, setRecordSecs] = useState(0);
  const [uploadingVoice, setUploadingVoice] = useState(false);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const recordTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Call logs (ephemeral, session-only)
  const [callLogs, setCallLogs] = useState<CallLog[]>([]);

  // Emoji picker (photo and sticker sending disabled)
  const [emojiPickerOpen, setEmojiPickerOpen] = useState(false);

  const [isTyping, setIsTyping] = useState(false);
  const typingTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const dmWsRef = useRef<DMWSClient | null>(null);
  /** Tracks which conversation the live WS is connected to (survives list navigation). */
  const wsConvRef = useRef<DMConversation | null>(null);
  const callRef = useRef<VoiceVideoCallHandle | null>(null);

  // Stable callback so VoiceVideoCall can send signaling events at any time
  const sendCallSignal = useCallback((type: string, payload: object = {}) => {
    dmWsRef.current?.sendCallSignal(type, payload);
  }, []);

  // Called by VoiceVideoCall when a call resolves
  const handleCallEvent = useCallback((
    type: 'missed' | 'rejected' | 'ended',
    payload: CallEventPayload
  ) => {
    setCallLogs((prev) => [
      ...prev,
      { id: `call_${Date.now()}_${Math.random()}`, type, ...payload, timestamp: Date.now() },
    ]);
  }, []);

  // Clear call logs when switching conversations
  useEffect(() => { setCallLogs([]); }, [currentConversation?.id]);

  // Per-message swipe tracking
  const touchStartX = useRef(0);
  const mouseStartX = useRef(0);
  const mouseDragging = useRef(false);
  const activeDragId = useRef<string | null>(null);
  const touchStartY = useRef(0);
  const bubbleRefs = useRef<Map<string, HTMLDivElement>>(new Map());

  useEffect(() => { fetchConversations(); }, [fetchConversations]);

  useEffect(() => {
    if (currentConversation) {
      fetchMessages(currentConversation.id);
      markAsRead(currentConversation.id);
    }
  }, [currentConversation, fetchMessages, markAsRead]);

  useEffect(() => { chatEndRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [messages]);

  // DM WebSocket — persistent connection that survives navigation to conversation list.
  // This ensures call_initiated signals arrive even when the user has backed out of the chat.
  useEffect(() => {
    if (!user) return;

    // No conversation open: keep the existing WS alive so incoming calls still ring.
    if (!currentConversation) return;

    // Same conversation still open and WS already live: nothing to do.
    if (wsConvRef.current?.id === currentConversation.id && dmWsRef.current) return;

    // Switching to a different conversation — disconnect the old WS first.
    dmWsRef.current?.disconnect();
    setIsTyping(false);
    wsConvRef.current = currentConversation;

    const token = localStorage.getItem('rogan_token') || '';
    const client = new DMWSClient({
      conversationId: currentConversation.id,
      userId: user.id,
      token,
      onNewMessage: (msg) => { addMessage(msg); },
      onTyping: (_uid, _username) => {
        setIsTyping(true);
        if (typingTimerRef.current) clearTimeout(typingTimerRef.current);
        typingTimerRef.current = setTimeout(() => setIsTyping(false), 3000);
      },
      onStopTyping: () => {
        if (typingTimerRef.current) clearTimeout(typingTimerRef.current);
        setIsTyping(false);
      },
      onMessageEdited: (msgId, content, editedAt) => { applyMessageEdit(msgId, content, editedAt); },
      onMessageDeleted: (msgId) => { applyMessageDelete(msgId); },
      onCallSignal: (e) => { callRef.current?.handleSignal(e); },
      onPhotoData: (msgId, dataUrl) => { savePhoto(msgId, dataUrl).catch(() => {}); },
    });
    dmWsRef.current = client;
    client.connect();
    // No cleanup return here — intentionally keep WS alive when currentConversation → null.
  }, [currentConversation?.id, user?.id]);

  // Disconnect WS only when DMView is fully unmounted.
  useEffect(() => () => {
    dmWsRef.current?.disconnect();
    dmWsRef.current = null;
    wsConvRef.current = null;
  }, []);

  useEffect(() => {
    if (searchOpen) setTimeout(() => searchRef.current?.focus(), 50);
  }, [searchOpen]);

  useEffect(() => {
    if (replyTo) setTimeout(() => inputRef.current?.focus(), 50);
  }, [replyTo]);

  useEffect(() => {
    if (editMode) setTimeout(() => editInputRef.current?.focus(), 50);
  }, [editMode]);

  // Dismiss action menu when clicking outside
  useEffect(() => {
    if (!activeMsg) return;
    const dismiss = (e: MouseEvent | TouchEvent) => {
      const target = e.target as Element;
      if (!target.closest('[data-msg-bubble]')) {
        setActiveMsg(null);
        setEditMode(false);
        setDeleteConfirm(false);
      }
    };
    document.addEventListener('mousedown', dismiss);
    document.addEventListener('touchstart', dismiss, { passive: true });
    return () => {
      document.removeEventListener('mousedown', dismiss);
      document.removeEventListener('touchstart', dismiss);
    };
  }, [activeMsg]);

  // Close emoji picker on outside tap
  useEffect(() => {
    if (!emojiPickerOpen) return;
    const dismiss = (e: MouseEvent | TouchEvent) => {
      const target = e.target as Element;
      if (!target.closest('[data-attach-panel]')) {
        setEmojiPickerOpen(false);
      }
    };
    document.addEventListener('mousedown', dismiss);
    document.addEventListener('touchstart', dismiss, { passive: true });
    return () => {
      document.removeEventListener('mousedown', dismiss);
      document.removeEventListener('touchstart', dismiss);
    };
  }, [emojiPickerOpen]);

  // Debounced user search
  useEffect(() => {
    if (!searchQuery.trim()) { setSearchResults([]); return; }
    const timer = setTimeout(async () => {
      setSearching(true);
      try {
        const res = await api.get('/auth/users/search', { params: { q: searchQuery, limit: 10 } });
        setSearchResults((res.data.users || []).filter((u: SearchUser) => u.id !== user?.id));
      } catch {
        setSearchResults([]);
      } finally {
        setSearching(false);
      }
    }, 300);
    return () => clearTimeout(timer);
  }, [searchQuery, user?.id]);

  const startConversation = async (targetUserId: string) => {
    setStartingConv(true);
    try {
      const res = await api.post('/dm/conversations/new', { user_id: targetUserId });
      await fetchConversations();
      const refreshed = await api.get('/dm/conversations');
      const convs: DMConversation[] = refreshed.data.conversations || [];
      const conv = convs.find((c) => c.id === res.data.id);
      if (conv) setCurrentConversation(conv);
      setSearchOpen(false);
      setSearchQuery('');
      setSearchResults([]);
    } catch {
      // silent
    } finally {
      setStartingConv(false);
    }
  };

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setMessageInput(e.target.value);
    dmWsRef.current?.sendTyping();
  };

  const handleSend = async () => {
    if (!messageInput.trim() || !currentConversation) return;
    const content = messageInput.trim();
    const replyId = replyTo?.id;
    setMessageInput('');
    setReplyTo(null);
    try {
      await sendMessage(currentConversation.id, content, replyId);
    } catch {}
  };

  // ── Voice recording ─────────────────────────────────────────────────────────
  const startRecording = useCallback(async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mimeType = MediaRecorder.isTypeSupported('audio/webm') ? 'audio/webm' : 'audio/ogg';
      const recorder = new MediaRecorder(stream, { mimeType });
      audioChunksRef.current = [];
      recorder.ondataavailable = (e) => { if (e.data.size > 0) audioChunksRef.current.push(e.data); };
      recorder.start(100);
      mediaRecorderRef.current = recorder;
      setRecording(true);
      setRecordSecs(0);
      recordTimerRef.current = setInterval(() => setRecordSecs((s) => s + 1), 1000);
    } catch {
      alert('Microphone access denied');
    }
  }, []);

  const stopRecording = useCallback(() => {
    if (recordTimerRef.current) { clearInterval(recordTimerRef.current); recordTimerRef.current = null; }
    mediaRecorderRef.current?.stop();
    mediaRecorderRef.current?.stream.getTracks().forEach((t) => t.stop());
    setRecording(false);
  }, []);

  const cancelRecording = useCallback(() => {
    stopRecording();
    audioChunksRef.current = [];
    setRecordSecs(0);
  }, [stopRecording]);

  const sendVoiceNote = useCallback(async () => {
    if (!currentConversation) return;
    const duration = recordSecs;
    stopRecording();
    // Wait for recorder to flush final chunks
    await new Promise<void>((res) => setTimeout(res, 150));
    const chunks = audioChunksRef.current;
    if (!chunks.length) return;
    const mimeType = chunks[0].type || 'audio/webm';
    const ext = mimeType.includes('ogg') ? 'ogg' : 'webm';
    const blob = new Blob(chunks, { type: mimeType });
    audioChunksRef.current = [];
    setUploadingVoice(true);
    try {
      const formData = new FormData();
      formData.append('file', blob, `voice.${ext}`);
      const token = localStorage.getItem('rogan_token') || '';
      const apiBase = process.env.NEXT_PUBLIC_API_URL?.replace('http://backend', 'http://localhost') || 'http://localhost:8000';
      const res = await fetch(`${apiBase}/api/v1/dm/voice-upload`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
        body: formData,
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.detail || `Upload failed: ${res.status}`);
      }
      const { audio_url } = await res.json();
      if (!audio_url) throw new Error('No audio_url in response');
      await sendMessage(currentConversation.id, '', undefined, { audio_url, audio_duration: duration });
    } catch {
      // silent — user can retry
    } finally {
      setUploadingVoice(false);
      setRecordSecs(0);
    }
  }, [currentConversation, recordSecs, stopRecording, sendMessage]);

  const fmtRecordTime = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
  const fmtDuration = (s: number) =>
    s >= 3600
      ? `${Math.floor(s / 3600)}:${String(Math.floor((s % 3600) / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`
      : `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;

  // ── Sticker send ─────────────────────────────────────────────────────────────

  // ── Photo send (P2P via WS — never stored server-side) ───────────────────────

  const handleConfirmAction = () => {
    if (!currentConversation || !confirmAction) return;
    if (confirmAction === 'clear') {
      if (user?.id) clearChat(currentConversation.id, user.id);
    } else {
      setActionLoading(true);
      deleteConversation(currentConversation.id).finally(() => {
        setActionLoading(false);
      });
    }
    setConfirmAction(null);
  };

  // ── Message action handlers ──────────────────────────────────────────────────
  const openMessageMenu = useCallback((msg: DMMessage) => {
    if (msg.is_deleted) return; // can't act on deleted messages
    if (msg.sender_id !== user?.id) return; // only own messages
    setActiveMsg(msg);
    setEditMode(false);
    setDeleteConfirm(false);
  }, [user?.id]);

  const handleStartEdit = useCallback(() => {
    if (!activeMsg) return;
    setEditContent(activeMsg.content);
    setEditMode(true);
  }, [activeMsg]);

  const handleSaveEdit = async () => {
    if (!activeMsg || !currentConversation || !editContent.trim()) return;
    setMsgActionLoading(true);
    try {
      await editMessage(currentConversation.id, activeMsg.id, editContent.trim());
      setActiveMsg(null);
      setEditMode(false);
    } catch {}
    setMsgActionLoading(false);
  };

  const handleDeleteMsg = async () => {
    if (!activeMsg || !currentConversation) return;
    setMsgActionLoading(true);
    try {
      await deleteMessage(currentConversation.id, activeMsg.id);
      setActiveMsg(null);
      setDeleteConfirm(false);
    } catch {}
    setMsgActionLoading(false);
  };

  const getOtherUser = (conv: DMConversation | null) => {
    if (!conv) return null;
    return conv.other_user || { username: 'Unknown', display_name: null, avatar: null };
  };

  // ── Swipe-to-reply + long-press touch handlers ───────────────────────────────
  const handleTouchStart = useCallback((e: React.TouchEvent, msg: DMMessage) => {
    touchStartX.current = e.touches[0].clientX;
    touchStartY.current = e.touches[0].clientY;
    touchMoved.current = false;

    // Only own messages get the long-press menu
    if (msg.sender_id === user?.id && !msg.is_deleted) {
      longPressTimer.current = setTimeout(() => {
        if (!touchMoved.current) openMessageMenu(msg);
      }, 600);
    }
  }, [user?.id, openMessageMenu]);

  const handleTouchMove = useCallback((e: React.TouchEvent, msgId: string) => {
    const dx = e.touches[0].clientX - touchStartX.current;
    const dy = Math.abs(e.touches[0].clientY - touchStartY.current);

    // Cancel long press if finger moved
    if (Math.abs(dx) > 10 || dy > 10) {
      touchMoved.current = true;
      if (longPressTimer.current) { clearTimeout(longPressTimer.current); longPressTimer.current = null; }
    }

    if (dy > 20 || dx < 0) return; // vertical scroll or left swipe
    const el = bubbleRefs.current.get(msgId);
    if (el && dx < 90) {
      el.style.transform = `translateX(${dx}px)`;
      el.style.transition = 'none';
    }
  }, []);

  const handleTouchEnd = useCallback((e: React.TouchEvent, msg: DMMessage) => {
    if (longPressTimer.current) { clearTimeout(longPressTimer.current); longPressTimer.current = null; }
    const dx = e.changedTouches[0].clientX - touchStartX.current;
    const el = bubbleRefs.current.get(msg.id);
    if (el) {
      el.style.transition = 'transform 0.2s ease';
      el.style.transform = 'translateX(0)';
    }
    if (!touchMoved.current && Math.abs(dx) < 10) return; // was a tap or long press, not a swipe
    if (dx > 55) setReplyTo(msg);
  }, []);

  const handleMouseDown = useCallback((e: React.MouseEvent, msgId: string) => {
    e.preventDefault();
    mouseStartX.current = e.clientX;
    mouseDragging.current = true;
    activeDragId.current = msgId;
    const el = bubbleRefs.current.get(msgId);
    if (el) { el.style.transition = 'none'; el.style.userSelect = 'none'; }
  }, []);

  // Document-level mouse tracking — avoids losing the drag when cursor
  // leaves the bubble (e.g. slides over the reply icon on the other side).
  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      if (!mouseDragging.current || !activeDragId.current) return;
      const dx = e.clientX - mouseStartX.current;
      if (dx > 0 && dx < 90) {
        const el = bubbleRefs.current.get(activeDragId.current);
        if (el) el.style.transform = `translateX(${dx}px)`;
      }
    };

    const onUp = (e: MouseEvent) => {
      if (!mouseDragging.current || !activeDragId.current) return;
      const msgId = activeDragId.current;
      mouseDragging.current = false;
      activeDragId.current = null;
      const dx = e.clientX - mouseStartX.current;
      const el = bubbleRefs.current.get(msgId);
      if (el) {
        el.style.transition = 'transform 0.2s ease';
        el.style.transform = 'translateX(0)';
        el.style.userSelect = '';
      }
      if (dx > 55) {
        const msg = useDMStore.getState().messages.find((m) => m.id === msgId);
        if (msg) setReplyTo(msg);
      }
    };

    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
    return () => {
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
    };
  }, []);

  // ── Conversation List ────────────────────────────────────────────────────────
  if (!currentConversation) {
    return (
      <>
      <div className={cn('h-full flex flex-col', isMobile ? 'pb-24' : '')}>
        <div className="flex items-center justify-between p-4 border-b border-white/5">
          <h2 className="text-xl font-bold text-white flex items-center gap-2">
            <MessageSquare className="w-5 h-5 text-rogan-500" />
            Messages
          </h2>
          <button
            onClick={() => setSearchOpen(true)}
            className="flex items-center gap-2 px-3 py-1.5 bg-rogan-600 hover:bg-rogan-700 text-white text-sm rounded-lg transition-colors"
            title="Start new conversation"
          >
            <UserPlus className="w-4 h-4" />
            <span className="hidden sm:inline">New Message</span>
          </button>
        </div>

        <div className="flex-1 overflow-y-auto scrollbar-thin">
          {isLoading ? (
            <LoadingSpinner />
          ) : conversations.length === 0 ? (
            <EmptyState
              icon={MessageSquare}
              title="No conversations yet"
              description="Tap 'New Message' to find someone to chat with"
            />
          ) : (
            <div className="divide-y divide-white/5">
              {conversations.map((conv) => {
                const other = conv.other_user;
                return (
                  <button
                    key={conv.id}
                    onClick={() => setCurrentConversation(conv)}
                    className="w-full flex items-center gap-3 px-4 py-3.5 hover:bg-white/5 transition-colors text-left"
                  >
                    <div className="relative flex-shrink-0">
                      <div className="w-11 h-11 rounded-full bg-gradient-to-br from-rogan-500 to-amber-500 flex items-center justify-center text-white text-sm font-bold">
                        {other?.avatar ? (
                          <img src={other.avatar} alt="" className="w-full h-full rounded-full object-cover" />
                        ) : (
                          (other?.username || 'U').charAt(0).toUpperCase()
                        )}
                      </div>
                      {conv.unread_count > 0 && (
                        <span className="absolute -top-0.5 -right-0.5 w-5 h-5 rounded-full bg-rogan-500 flex items-center justify-center text-[10px] text-white font-bold">
                          {conv.unread_count > 9 ? '9+' : conv.unread_count}
                        </span>
                      )}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center justify-between">
                        <p className="text-sm font-medium text-white truncate">
                          {other?.display_name || other?.username || 'Unknown'}
                        </p>
                        {conv.last_message?.created_at && (
                          <span className="text-[10px] text-white/30 ml-2 flex-shrink-0">
                            {formatMessageTime(conv.last_message.created_at)}
                          </span>
                        )}
                      </div>
                      <p className="text-xs text-white/40 truncate mt-0.5">
                        {conv.last_message?.content || 'No messages yet'}
                      </p>
                    </div>
                  </button>
                );
              })}
            </div>
          )}
        </div>

        {/* New message search sheet */}
        {searchOpen && (
          <div className="absolute inset-0 bg-surface z-30 flex flex-col">
            <div className="flex items-center gap-3 p-4 border-b border-white/5">
              <button onClick={() => { setSearchOpen(false); setSearchQuery(''); setSearchResults([]); }} className="text-white/60 hover:text-white">
                <ArrowLeft className="w-5 h-5" />
              </button>
              <div className="flex-1 relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-white/30" />
                <input
                  ref={searchRef}
                  type="text"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="Search users..."
                  className="w-full bg-white/5 border border-white/10 rounded-full pl-9 pr-4 py-2 text-sm text-white placeholder:text-white/30 focus:outline-none focus:border-rogan-500/50"
                />
              </div>
            </div>
            <div className="flex-1 overflow-y-auto">
              {searching ? <LoadingSpinner /> : searchResults.length === 0 && searchQuery ? (
                <p className="text-white/30 text-sm text-center py-8">No users found</p>
              ) : (
                searchResults.map((u) => (
                  <button
                    key={u.id}
                    onClick={() => startConversation(u.id)}
                    disabled={startingConv}
                    className="w-full flex items-center gap-3 px-4 py-3 hover:bg-white/5 transition-colors"
                  >
                    <div className="w-9 h-9 rounded-full bg-gradient-to-br from-rogan-500 to-amber-500 flex items-center justify-center text-white text-xs font-bold flex-shrink-0">
                      {(u.username || 'U').charAt(0).toUpperCase()}
                    </div>
                    <div className="flex-1 min-w-0 text-left">
                      <p className="text-sm font-medium text-white">{u.display_name || u.username}</p>
                      <p className="text-xs text-white/40">@{u.username}</p>
                    </div>
                    {u.is_live && <span className="text-[10px] text-red-400 font-medium">LIVE</span>}
                  </button>
                ))
              )}
            </div>
          </div>
        )}
      </div>
      {/* Incoming call overlay — visible even while browsing the conversation list */}
      {user && wsConvRef.current && (
        <VoiceVideoCall
          ref={callRef}
          userId={user.id}
          otherUser={wsConvRef.current.other_user}
          sendSignal={sendCallSignal}
          onCallEvent={handleCallEvent}
        />
      )}
      </>
    );
  }

  // ── Chat View ────────────────────────────────────────────────────────────────
  const other = getOtherUser(currentConversation);
  return (
    <div className={cn("h-full flex flex-col", isMobile ? "pb-16" : "")}>
      {/* Header */}
      <div className="h-14 flex items-center gap-3 px-4 border-b border-white/5 bg-surface flex-shrink-0 relative">
        <button
          onClick={() => setCurrentConversation(null)}
          className="text-white/60 hover:text-white transition-colors"
        >
          <ArrowLeft className="w-5 h-5" />
        </button>
        <div className="w-8 h-8 rounded-full bg-gradient-to-br from-rogan-500 to-amber-500 flex items-center justify-center text-white text-xs font-bold flex-shrink-0">
          {other?.avatar ? (
            <img src={other.avatar} alt="" className="w-full h-full rounded-full object-cover" />
          ) : (
            (other?.username || 'U').charAt(0).toUpperCase()
          )}
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-white text-sm font-medium">{other?.display_name || other?.username || 'Unknown'}</p>
          {currentConversation.dm_price > 0 && (
            <p className="text-tk text-[10px]">{currentConversation.dm_price} TK per message</p>
          )}
        </div>

        {/* Voice call button */}
        <button
          onClick={() => callRef.current?.initiateCall('audio')}
          className="text-white/40 hover:text-white transition-colors p-1"
          title="Voice call"
        >
          <Phone className="w-5 h-5" />
        </button>

        {/* Video call button */}
        <button
          onClick={() => callRef.current?.initiateCall('video')}
          className="text-white/40 hover:text-white transition-colors p-1 mr-1"
          title="Video call"
        >
          <Video className="w-5 h-5" />
        </button>

        {/* Kebab menu */}
        <div className="relative">
          <button
            onClick={() => setMenuOpen((v) => !v)}
            className="text-white/40 hover:text-white transition-colors p-1"
          >
            <MoreVertical className="w-5 h-5" />
          </button>
          {menuOpen && (
            <>
              <div className="fixed inset-0 z-40" onClick={() => setMenuOpen(false)} />
              <div className="absolute right-0 top-8 z-50 bg-surface border border-white/10 rounded-xl shadow-xl w-48 py-1 overflow-hidden">
                <button
                  onClick={() => { setMenuOpen(false); setConfirmAction('clear'); }}
                  className="w-full flex items-center gap-3 px-4 py-2.5 text-sm text-white/80 hover:bg-white/5 transition-colors"
                >
                  <MessageSquareOff className="w-4 h-4 text-amber-400" />
                  Clear Chat
                </button>
                <button
                  onClick={() => { setMenuOpen(false); setConfirmAction('delete'); }}
                  className="w-full flex items-center gap-3 px-4 py-2.5 text-sm text-red-400 hover:bg-white/5 transition-colors"
                >
                  <Trash2 className="w-4 h-4" />
                  Delete Conversation
                </button>
              </div>
            </>
          )}
        </div>
      </div>

      {/* Confirm conversation action modal */}
      {confirmAction && (
        <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center px-6">
          <div className="bg-surface border border-white/10 rounded-2xl w-full max-w-sm p-6 shadow-2xl">
            <div className={cn(
              "w-12 h-12 rounded-full flex items-center justify-center mx-auto mb-4",
              confirmAction === 'delete' ? "bg-red-500/10" : "bg-amber-500/10"
            )}>
              {confirmAction === 'delete'
                ? <Trash2 className="w-5 h-5 text-red-400" />
                : <MessageSquareOff className="w-5 h-5 text-amber-400" />
              }
            </div>
            <h3 className="text-white font-semibold text-center mb-1">
              {confirmAction === 'delete' ? 'Delete Conversation?' : 'Clear Chat?'}
            </h3>
            <p className="text-white/40 text-sm text-center mb-6">
              {confirmAction === 'delete'
                ? 'This permanently deletes the conversation for both users.'
                : 'This clears the chat on your end only. The other person still sees their messages.'
              }
            </p>
            <div className="flex gap-3">
              <button
                onClick={() => setConfirmAction(null)}
                disabled={actionLoading}
                className="flex-1 py-2.5 rounded-xl border border-white/10 text-white/60 text-sm hover:bg-white/5 transition-colors disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                onClick={handleConfirmAction}
                disabled={actionLoading}
                className={cn(
                  "flex-1 py-2.5 rounded-xl text-white text-sm font-medium transition-colors disabled:opacity-50",
                  confirmAction === 'delete' ? "bg-red-600 hover:bg-red-700" : "bg-amber-600 hover:bg-amber-700"
                )}
              >
                {actionLoading ? '...' : confirmAction === 'delete' ? 'Delete' : 'Clear'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Delete single message confirm modal */}
      {deleteConfirm && activeMsg && (
        <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center px-6">
          <div className="bg-surface border border-white/10 rounded-2xl w-full max-w-sm p-6 shadow-2xl">
            <div className="w-12 h-12 rounded-full bg-red-500/10 flex items-center justify-center mx-auto mb-4">
              <Trash2 className="w-5 h-5 text-red-400" />
            </div>
            <h3 className="text-white font-semibold text-center mb-1">Delete Message?</h3>
            <p className="text-white/40 text-sm text-center mb-6">
              This will show "This message was deleted" to both users.
            </p>
            <div className="flex gap-3">
              <button
                onClick={() => { setDeleteConfirm(false); setActiveMsg(null); }}
                disabled={msgActionLoading}
                className="flex-1 py-2.5 rounded-xl border border-white/10 text-white/60 text-sm hover:bg-white/5 transition-colors disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                onClick={handleDeleteMsg}
                disabled={msgActionLoading}
                className="flex-1 py-2.5 rounded-xl bg-red-600 hover:bg-red-700 text-white text-sm font-medium transition-colors disabled:opacity-50"
              >
                {msgActionLoading ? '...' : 'Delete'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Messages */}
      <div className="flex-1 overflow-y-auto scrollbar-thin p-4 space-y-1">
        {messages.length === 0 && (
          <p className="text-white/20 text-sm text-center py-8">No messages yet — say hello!</p>
        )}
        {messages.map((msg) => {
          const isMine = msg.sender_id === user?.id;
          const isActive = activeMsg?.id === msg.id;
          const isEditing = isActive && editMode;

          return (
            <div key={msg.id} className={cn('flex group items-center', isMine ? 'justify-end' : 'justify-start')}>
              {/* Reply icon hint — pointer-events-none so it never intercepts the drag */}
              <div className={cn(
                'flex items-center px-1.5 opacity-0 group-hover:opacity-40 transition-opacity pointer-events-none',
                isMine ? 'order-first' : 'order-last'
              )}>
                <Reply className="w-3.5 h-3.5 text-white" />
              </div>

              <div
                data-msg-bubble
                ref={(el) => { if (el) bubbleRefs.current.set(msg.id, el); else bubbleRefs.current.delete(msg.id); }}
                style={{ transition: 'transform 0.2s ease' }}
                onTouchStart={(e) => handleTouchStart(e, msg)}
                onTouchMove={(e) => handleTouchMove(e, msg.id)}
                onTouchEnd={(e) => handleTouchEnd(e, msg)}
                onMouseDown={(e) => handleMouseDown(e, msg.id)}
                onDoubleClick={() => { if (isMine && !msg.is_deleted) openMessageMenu(msg); }}
                className={cn(
                  'relative max-w-[75%] rounded-2xl px-4 py-2.5 select-none',
                  isMine ? 'bg-rogan-600 text-white rounded-br-sm' : 'bg-white/10 text-white/90 rounded-bl-sm',
                  isActive && !isEditing ? 'ring-2 ring-white/20' : '',
                  msg.is_deleted ? 'opacity-50' : '',
                )}
              >
                {/* Inline action menu (own messages only, not deleted) */}
                {isActive && !isEditing && !deleteConfirm && isMine && (
                  <div className={cn(
                    'absolute -top-8 flex items-center gap-1 bg-black/80 rounded-full px-2 py-1 shadow-lg z-10',
                    isMine ? 'right-0' : 'left-0'
                  )}>
                    <button
                      onClick={handleStartEdit}
                      className="flex items-center gap-1 px-2 py-0.5 text-white/80 hover:text-white text-xs rounded-full hover:bg-white/10 transition-colors"
                    >
                      <Pencil className="w-3 h-3" />
                      Edit
                    </button>
                    <div className="w-px h-3 bg-white/20" />
                    <button
                      onClick={() => setDeleteConfirm(true)}
                      className="flex items-center gap-1 px-2 py-0.5 text-red-400 hover:text-red-300 text-xs rounded-full hover:bg-white/10 transition-colors"
                    >
                      <Trash2 className="w-3 h-3" />
                      Delete
                    </button>
                  </div>
                )}

                {/* Reply quote bubble */}
                {msg.reply_to && !msg.is_deleted && (
                  <div className={cn(
                    'mb-1.5 px-2 py-1 rounded-lg border-l-2 text-[11px] leading-snug',
                    isMine
                      ? 'bg-white/10 border-white/40 text-white/70'
                      : 'bg-black/20 border-rogan-400/60 text-white/50'
                  )}>
                    <p className="truncate">{msg.reply_to.content}</p>
                  </div>
                )}

                {/* Inline edit input */}
                {isEditing ? (
                  <div className="flex items-center gap-2">
                    <input
                      ref={editInputRef}
                      type="text"
                      value={editContent}
                      onChange={(e) => setEditContent(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') handleSaveEdit();
                        if (e.key === 'Escape') { setActiveMsg(null); setEditMode(false); }
                      }}
                      className="flex-1 bg-white/10 border border-white/20 rounded-lg px-2 py-1 text-sm text-white focus:outline-none focus:border-white/40 min-w-0"
                      style={{ userSelect: 'text' }}
                    />
                    <button
                      onClick={handleSaveEdit}
                      disabled={msgActionLoading || !editContent.trim()}
                      className="flex-shrink-0 w-6 h-6 rounded-full bg-white/20 hover:bg-white/30 flex items-center justify-center disabled:opacity-40"
                    >
                      <Check className="w-3.5 h-3.5 text-white" />
                    </button>
                    <button
                      onClick={() => { setActiveMsg(null); setEditMode(false); }}
                      className="flex-shrink-0 w-6 h-6 rounded-full bg-white/10 hover:bg-white/20 flex items-center justify-center"
                    >
                      <X className="w-3.5 h-3.5 text-white/60" />
                    </button>
                  </div>
                ) : msg.message_type === 'voice' && msg.audio_url && !msg.is_deleted ? (
                  <VoiceNotePlayer
                    audioUrl={msg.audio_url}
                    duration={msg.audio_duration ?? 0}
                    isMine={isMine}
                  />
                ) : msg.message_type === 'sticker' && !msg.is_deleted ? (
                  <span className="text-5xl leading-none select-none" role="img">{msg.content}</span>
                ) : msg.message_type === 'photo' && !msg.is_deleted ? (
                  <PhotoMessage messageId={msg.id} isMine={isMine} />
                ) : (
                  <p className={cn('text-sm leading-relaxed', msg.is_deleted ? 'italic text-white/40' : '')}>
                    {msg.content}
                  </p>
                )}

                <div className="flex items-center gap-1.5 mt-1">
                  {msg.is_paid && !msg.is_deleted && <span className="text-tk text-[10px]">{msg.amount_tk} TK</span>}
                  <span className="text-[10px] text-white/40">{msg.created_at ? formatMessageTime(msg.created_at) : ''}</span>
                  {msg.edited_at && !msg.is_deleted && <span className="text-[10px] text-white/30">edited</span>}
                  {isMine && msg.read_at && !msg.is_deleted && <span className="text-blue-300 text-[10px]">✓✓</span>}
                </div>
              </div>
            </div>
          );
        })}
        {/* Call log entries */}
        {callLogs.map((log) => {
          const isVideo = log.mode === 'video';
          const label = (() => {
            if (log.type === 'ended') return `${isVideo ? 'Video' : 'Voice'} call · ${fmtDuration(log.duration ?? 0)}`;
            if (log.type === 'missed') return log.outgoing ? 'No answer' : `Missed ${isVideo ? 'video' : 'voice'} call`;
            // rejected
            return log.outgoing ? 'Call declined' : 'You declined';
          })();
          const isMissed = log.type === 'missed' && !log.outgoing;
          return (
            <div key={log.id} className="flex justify-center my-1.5">
              <div className={cn(
                'flex items-center gap-2 px-3.5 py-1.5 rounded-full text-xs',
                isMissed ? 'bg-red-500/10 text-red-400' : 'bg-white/5 text-white/50'
              )}>
                {isVideo
                  ? <Video className="w-3 h-3 flex-shrink-0" />
                  : <Phone className="w-3 h-3 flex-shrink-0" />
                }
                <span>{label}</span>
                <span className="text-white/25">·</span>
                <span className="text-white/30 tabular-nums">
                  {new Date(log.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                </span>
              </div>
            </div>
          );
        })}

        {/* Typing indicator */}
        {isTyping && (
          <div className="flex justify-start">
            <div className="bg-white/10 rounded-2xl rounded-bl-sm px-4 py-2.5">
              <div className="flex items-center gap-1">
                <span className="w-1.5 h-1.5 bg-white/50 rounded-full animate-bounce [animation-delay:0ms]" />
                <span className="w-1.5 h-1.5 bg-white/50 rounded-full animate-bounce [animation-delay:150ms]" />
                <span className="w-1.5 h-1.5 bg-white/50 rounded-full animate-bounce [animation-delay:300ms]" />
              </div>
            </div>
          </div>
        )}
        <div ref={chatEndRef} />
      </div>

      {/* Reply preview bar */}
      {replyTo && (
        <div className="flex items-center gap-2 px-4 py-2 bg-white/5 border-t border-white/5">
          <Reply className="w-4 h-4 text-rogan-400 flex-shrink-0" />
          <p className="flex-1 text-xs text-white/50 truncate">{replyTo.content}</p>
          <button
            onClick={() => setReplyTo(null)}
            className="text-white/30 hover:text-white transition-colors flex-shrink-0"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {/* Voice/Video call overlay — renders on top of everything when active */}
      {user && (wsConvRef.current ?? currentConversation) && (
        <VoiceVideoCall
          ref={callRef}
          userId={user.id}
          otherUser={(wsConvRef.current ?? currentConversation)?.other_user ?? other}
          sendSignal={sendCallSignal}
          onCallEvent={handleCallEvent}
        />
      )}

      {/* Emoji picker panel */}
      {emojiPickerOpen && (
        <div data-attach-panel className="border-t border-white/5 bg-surface flex-shrink-0 px-2 py-2">
          <div className="grid grid-cols-8 gap-1 max-h-44 overflow-y-auto scrollbar-thin px-1">
            {EMOJIS.map((emoji, i) => (
              <button
                key={i}
                onClick={() => {
                  setMessageInput((prev) => prev + emoji);
                  setEmojiPickerOpen(false);
                  setTimeout(() => inputRef.current?.focus(), 50);
                }}
                className="text-2xl h-9 w-9 flex items-center justify-center rounded-lg hover:bg-white/10 transition-colors"
              >
                {emoji}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Input / Recording */}
      <div className="p-3 border-t border-white/5 bg-surface flex-shrink-0">
        {recording ? (
          /* ── Recording mode ── */
          <div className="flex items-center gap-3">
            {/* Cancel */}
            <button
              onClick={cancelRecording}
              className="w-10 h-10 rounded-full bg-white/10 flex items-center justify-center text-white/60 hover:text-white hover:bg-white/20 transition-colors"
            >
              <X className="w-4 h-4" />
            </button>
            {/* Animated waveform + timer */}
            <div className="flex-1 flex items-center gap-3 bg-white/5 border border-red-500/30 rounded-full px-4 py-2">
              <div className="flex items-end gap-0.5 h-5">
                {[4, 7, 3, 9, 5, 7, 3, 6, 8, 4].map((h, i) => (
                  <div
                    key={i}
                    className="w-0.5 bg-red-400 rounded-full animate-pulse"
                    style={{ height: `${h}px`, animationDelay: `${i * 80}ms` }}
                  />
                ))}
              </div>
              <span className="text-sm text-white/70 tabular-nums">{fmtRecordTime(recordSecs)}</span>
              <span className="text-[10px] text-red-400 animate-pulse ml-auto">● REC</span>
            </div>
            {/* Send */}
            <button
              onClick={sendVoiceNote}
              disabled={uploadingVoice || recordSecs < 1}
              className="w-10 h-10 rounded-full bg-rogan-600 flex items-center justify-center text-white disabled:opacity-40 hover:bg-rogan-700 transition-colors"
            >
              {uploadingVoice
                ? <span className="w-3 h-3 border-2 border-white/40 border-t-white rounded-full animate-spin" />
                : <Send className="w-4 h-4" />
              }
            </button>
          </div>
        ) : (
          /* ── Normal input mode ── */
          <div className="flex items-center gap-2">
            {/* Emoji picker trigger */}
            <button
              data-attach-panel
              onClick={() => setEmojiPickerOpen(!emojiPickerOpen)}
              className={cn(
                'w-9 h-9 rounded-full flex items-center justify-center flex-shrink-0 transition-colors text-lg',
                emojiPickerOpen
                  ? 'bg-rogan-600 text-white'
                  : 'bg-white/10 text-white/60 hover:bg-white/20 hover:text-white'
              )}
              title="Emoji"
            >
              <span className="leading-none">😊</span>
            </button>
            <input
              ref={inputRef}
              type="text"
              value={messageInput}
              onChange={handleInputChange}
              onKeyDown={(e) => e.key === 'Enter' && !e.shiftKey && handleSend()}
              placeholder={currentConversation.dm_price > 0 ? `${currentConversation.dm_price} TK to send` : 'Type a message...'}
              className="flex-1 bg-white/5 border border-white/10 rounded-full px-4 py-2.5 text-sm text-white placeholder:text-white/30 focus:outline-none focus:border-rogan-500/50"
            />
            {messageInput.trim() ? (
              <button
                onClick={handleSend}
                className="w-10 h-10 rounded-full bg-rogan-600 flex items-center justify-center text-white hover:bg-rogan-700 transition-colors"
              >
                <Send className="w-4 h-4" />
              </button>
            ) : (
              <button
                onClick={startRecording}
                className="w-10 h-10 rounded-full bg-white/10 flex items-center justify-center text-white/60 hover:text-white hover:bg-white/20 transition-colors"
                title="Record voice note"
              >
                <Mic className="w-4 h-4" />
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
