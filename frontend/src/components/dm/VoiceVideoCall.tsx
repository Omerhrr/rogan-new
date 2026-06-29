'use client';

/**
 * Rogan Live — P2P Video/Voice Call Component
 *
 * Signaling is relayed via the existing DM WebSocket (dm_handler.py).
 * WebRTC peer connection is established directly between browsers.
 * The overlay renders via React Portal (document.body) to avoid any
 * z-index / overflow / CSS-transform stacking-context issues in the parent.
 */

import {
  useState,
  useEffect,
  useRef,
  useCallback,
  forwardRef,
  useImperativeHandle,
} from 'react';
import { createPortal } from 'react-dom';
import { Phone, PhoneOff, Video, VideoOff, Mic, MicOff } from 'lucide-react';
import { cn } from '@/lib/utils';

// ── Types ──────────────────────────────────────────────────────────────────────

type CallState = 'idle' | 'calling' | 'incoming' | 'active';

interface OtherUser {
  username: string;
  display_name: string | null;
  avatar: string | null;
}

export interface CallEventPayload {
  mode: 'video' | 'audio';
  /** true = we initiated the call; false = we received it */
  outgoing: boolean;
  /** seconds — only present for 'ended' events */
  duration?: number;
}

export interface VoiceVideoCallProps {
  userId: string;
  otherUser: OtherUser | null;
  sendSignal: (type: string, payload?: object) => void;
  /** Fired when a call resolves: missed (no answer), rejected, or ended normally. */
  onCallEvent?: (type: 'missed' | 'rejected' | 'ended', payload: CallEventPayload) => void;
}

export interface VoiceVideoCallHandle {
  handleSignal: (event: Record<string, unknown>) => void;
  initiateCall: (mode?: 'video' | 'audio') => void;
}

// ── ICE config ─────────────────────────────────────────────────────────────────

const ICE_CONFIG: RTCConfiguration = {
  iceServers: [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' },
    { urls: 'stun:stun2.l.google.com:19302' },
  ],
};

// ── Component ──────────────────────────────────────────────────────────────────

const VoiceVideoCall = forwardRef<VoiceVideoCallHandle, VoiceVideoCallProps>(
  ({ userId: _userId, otherUser, sendSignal, onCallEvent }, ref) => {
    const [callState, setCallState] = useState<CallState>('idle');
    const [callMode, setCallMode] = useState<'video' | 'audio'>('video');
    const [muted, setMuted] = useState(false);
    const [videoOff, setVideoOff] = useState(false);
    const [remoteVideoOff, setRemoteVideoOff] = useState(false);
    const [callSeconds, setCallSeconds] = useState(0);

    const localVideoRef = useRef<HTMLVideoElement>(null);
    const remoteVideoRef = useRef<HTMLVideoElement>(null);
    const pcRef = useRef<RTCPeerConnection | null>(null);
    const localStreamRef = useRef<MediaStream | null>(null);
    const pendingOfferRef = useRef<RTCSessionDescriptionInit | null>(null);
    const pendingModeRef = useRef<'video' | 'audio'>('video');
    const callTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
    const ringTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const audioCtxRef = useRef<AudioContext | null>(null);
    // Ref mirrors — avoid stale closures in timer callbacks
    const callStateRef = useRef<CallState>('idle');
    const callModeRef = useRef<'video' | 'audio'>('video');
    const callSecondsRef = useRef(0);
    const isOutgoingRef = useRef(false);

    const setCallStateSynced = useCallback((state: CallState) => {
      callStateRef.current = state;
      setCallState(state);
    }, []);

    const setCallModeSynced = useCallback((mode: 'video' | 'audio') => {
      callModeRef.current = mode;
      setCallMode(mode);
    }, []);

    // ── Ringtone / dial tone via Web Audio API ────────────────────────────────
    useEffect(() => {
      if (callState === 'idle' || callState === 'active') {
        audioCtxRef.current?.close().catch(() => {});
        audioCtxRef.current = null;
        return;
      }

      let ctx: AudioContext;
      try {
        ctx = new (window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext)();
      } catch { return; }
      audioCtxRef.current = ctx;

      if (callState === 'incoming') {
        // Classic ring: 440 Hz + 480 Hz mixed, 2 s on / 4 s off
        const scheduleRing = (start: number) => {
          [440, 480].forEach((freq) => {
            const osc = ctx.createOscillator();
            const g = ctx.createGain();
            osc.connect(g);
            g.connect(ctx.destination);
            osc.type = 'sine';
            osc.frequency.value = freq;
            g.gain.setValueAtTime(0, start);
            g.gain.linearRampToValueAtTime(0.2, start + 0.05);
            g.gain.setValueAtTime(0.2, start + 1.8);
            g.gain.linearRampToValueAtTime(0, start + 2.0);
            osc.start(start);
            osc.stop(start + 2.0);
          });
        };
        const now = ctx.currentTime;
        for (let i = 0; i < 10; i++) scheduleRing(now + i * 6);
      } else if (callState === 'calling') {
        // Pulsing dial tone (425 Hz — international standard)
        const osc = ctx.createOscillator();
        const lfo = ctx.createOscillator();
        const gain = ctx.createGain();
        const lfoGain = ctx.createGain();
        osc.type = 'sine';
        osc.frequency.value = 425;
        lfo.type = 'sine';
        lfo.frequency.value = 0.8;
        lfoGain.gain.value = 0.06;
        gain.gain.value = 0.06;
        lfo.connect(lfoGain);
        lfoGain.connect(gain.gain);
        osc.connect(gain);
        gain.connect(ctx.destination);
        lfo.start();
        osc.start();
      }

      return () => {
        ctx.close().catch(() => {});
        audioCtxRef.current = null;
      };
    }, [callState]);

    // Sync local stream → video element after each render
    useEffect(() => {
      if (callState !== 'idle' && callState !== 'incoming') {
        if (localVideoRef.current && localStreamRef.current) {
          localVideoRef.current.srcObject = localStreamRef.current;
        }
      }
    }, [callState]);

    // ── Helpers ──────────────────────────────────────────────────────────────

    const cleanup = useCallback(() => {
      if (callTimerRef.current) { clearInterval(callTimerRef.current); callTimerRef.current = null; }
      if (ringTimerRef.current) { clearTimeout(ringTimerRef.current); ringTimerRef.current = null; }
      audioCtxRef.current?.close().catch(() => {});
      audioCtxRef.current = null;
      localStreamRef.current?.getTracks().forEach((t) => t.stop());
      localStreamRef.current = null;
      if (localVideoRef.current) localVideoRef.current.srcObject = null;
      if (remoteVideoRef.current) remoteVideoRef.current.srcObject = null;
      pcRef.current?.close();
      pcRef.current = null;
      pendingOfferRef.current = null;
      callSecondsRef.current = 0;
      setCallSeconds(0);
      setMuted(false);
      setVideoOff(false);
      setRemoteVideoOff(false);
    }, []);

    const createPC = useCallback((): RTCPeerConnection => {
      const pc = new RTCPeerConnection(ICE_CONFIG);

      pc.onicecandidate = (e) => {
        if (e.candidate) {
          sendSignal('call_ice_candidate', { candidate: e.candidate.toJSON() });
        }
      };

      pc.ontrack = (e) => {
        if (remoteVideoRef.current && e.streams[0]) {
          remoteVideoRef.current.srcObject = e.streams[0];
        }
      };

      pc.onconnectionstatechange = () => {
        const state = pc.connectionState;
        if (state === 'disconnected' || state === 'failed') {
          const wasActive = callStateRef.current === 'active';
          const dur = callSecondsRef.current;
          const mode = callModeRef.current;
          const outgoing = isOutgoingRef.current;
          cleanup();
          setCallStateSynced('idle');
          if (wasActive) onCallEvent?.('ended', { mode, outgoing, duration: dur });
        }
      };

      pcRef.current = pc;
      return pc;
    }, [sendSignal, cleanup, setCallStateSynced, onCallEvent]);

    const getMedia = useCallback(async (mode: 'video' | 'audio'): Promise<MediaStream> => {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: true,
        video: mode === 'video',
      });
      localStreamRef.current = stream;
      if (localVideoRef.current) localVideoRef.current.srcObject = stream;
      return stream;
    }, []);

    // ── Call actions ─────────────────────────────────────────────────────────

    const initiateCall = useCallback(async (mode: 'video' | 'audio' = 'video') => {
      if (callStateRef.current !== 'idle') return;
      try {
        isOutgoingRef.current = true;
        setCallModeSynced(mode);
        setCallStateSynced('calling');
        const stream = await getMedia(mode);
        const pc = createPC();
        stream.getTracks().forEach((t) => pc.addTrack(t, stream));
        const offer = await pc.createOffer();
        await pc.setLocalDescription(offer);
        sendSignal('call_initiated', { offer, mode });
        // Auto-cancel if no answer within 30 s
        ringTimerRef.current = setTimeout(() => {
          if (callStateRef.current === 'calling') {
            sendSignal('call_ended', {});
            onCallEvent?.('missed', { mode: callModeRef.current, outgoing: true });
            cleanup();
            setCallStateSynced('idle');
          }
        }, 30_000);
      } catch {
        cleanup();
        setCallStateSynced('idle');
      }
    }, [getMedia, createPC, sendSignal, cleanup, setCallStateSynced, setCallModeSynced, onCallEvent]);

    const acceptCall = useCallback(async () => {
      if (!pendingOfferRef.current) return;
      if (ringTimerRef.current) { clearTimeout(ringTimerRef.current); ringTimerRef.current = null; }
      const mode = pendingModeRef.current;
      setCallModeSynced(mode);
      try {
        const stream = await getMedia(mode);
        const pc = createPC();
        stream.getTracks().forEach((t) => pc.addTrack(t, stream));
        await pc.setRemoteDescription(new RTCSessionDescription(pendingOfferRef.current));
        const answer = await pc.createAnswer();
        await pc.setLocalDescription(answer);
        sendSignal('call_accepted', { answer });
        setCallStateSynced('active');
        callTimerRef.current = setInterval(() => {
          setCallSeconds((s) => { callSecondsRef.current = s + 1; return s + 1; });
        }, 1000);
      } catch {
        sendSignal('call_rejected', {});
        onCallEvent?.('rejected', { mode: pendingModeRef.current, outgoing: false });
        cleanup();
        setCallStateSynced('idle');
      }
    }, [getMedia, createPC, sendSignal, cleanup, setCallStateSynced, setCallModeSynced, onCallEvent]);

    const rejectCall = useCallback(() => {
      sendSignal('call_rejected', {});
      onCallEvent?.('rejected', { mode: callModeRef.current, outgoing: false });
      cleanup();
      setCallStateSynced('idle');
    }, [sendSignal, cleanup, setCallStateSynced, onCallEvent]);

    const endCall = useCallback(() => {
      const wasActive = callStateRef.current === 'active';
      const dur = callSecondsRef.current;
      const mode = callModeRef.current;
      const outgoing = isOutgoingRef.current;
      sendSignal('call_ended', {});
      cleanup();
      setCallStateSynced('idle');
      if (wasActive) onCallEvent?.('ended', { mode, outgoing, duration: dur });
    }, [sendSignal, cleanup, setCallStateSynced, onCallEvent]);

    // ── Incoming signal handler ───────────────────────────────────────────────

    const handleSignal = useCallback(
      async (event: Record<string, unknown>) => {
        const type = event.type as string;

        if (type === 'call_initiated') {
          isOutgoingRef.current = false;
          pendingOfferRef.current = event.offer as RTCSessionDescriptionInit;
          pendingModeRef.current = (event.mode as 'video' | 'audio') ?? 'video';
          setCallModeSynced(pendingModeRef.current);
          setCallStateSynced('incoming');
          // Auto-reject if not answered in 30 s
          ringTimerRef.current = setTimeout(() => {
            if (callStateRef.current === 'incoming') {
              sendSignal('call_rejected', {});
              onCallEvent?.('missed', { mode: pendingModeRef.current, outgoing: false });
              cleanup();
              setCallStateSynced('idle');
            }
          }, 30_000);
        } else if (type === 'call_accepted') {
          if (ringTimerRef.current) { clearTimeout(ringTimerRef.current); ringTimerRef.current = null; }
          try {
            await pcRef.current?.setRemoteDescription(
              new RTCSessionDescription(event.answer as RTCSessionDescriptionInit)
            );
          } catch {}
          setCallStateSynced('active');
          callTimerRef.current = setInterval(() => {
            setCallSeconds((s) => { callSecondsRef.current = s + 1; return s + 1; });
          }, 1000);
        } else if (type === 'call_rejected') {
          onCallEvent?.('rejected', { mode: callModeRef.current, outgoing: true });
          cleanup();
          setCallStateSynced('idle');
        } else if (type === 'call_ended') {
          const wasActive = callStateRef.current === 'active';
          const dur = callSecondsRef.current;
          const mode = callModeRef.current;
          const outgoing = isOutgoingRef.current;
          cleanup();
          setCallStateSynced('idle');
          if (wasActive) onCallEvent?.('ended', { mode, outgoing, duration: dur });
        } else if (type === 'call_camera_off') {
          setRemoteVideoOff(true);
        } else if (type === 'call_camera_on') {
          setRemoteVideoOff(false);
        } else if (type === 'call_ice_candidate') {
          try {
            await pcRef.current?.addIceCandidate(
              new RTCIceCandidate(event.candidate as RTCIceCandidateInit)
            );
          } catch {}
        }
      },
      [sendSignal, cleanup, setCallStateSynced, setCallModeSynced, onCallEvent]
    );

    useImperativeHandle(ref, () => ({ handleSignal, initiateCall }), [handleSignal, initiateCall]);

    // ── Controls ─────────────────────────────────────────────────────────────

    const toggleMute = () => {
      localStreamRef.current?.getAudioTracks().forEach((t) => { t.enabled = !t.enabled; });
      setMuted((m) => !m);
    };

    const toggleVideo = () => {
      setVideoOff((prev) => {
        const next = !prev;
        localStreamRef.current?.getVideoTracks().forEach((t) => { t.enabled = !next; });
        sendSignal(next ? 'call_camera_off' : 'call_camera_on');
        return next;
      });
    };

    const fmtTime = (s: number) =>
      `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;

    // ── Render ────────────────────────────────────────────────────────────────

    if (callState === 'idle') return null;
    // SSR guard — document not available on server
    if (typeof document === 'undefined') return null;

    const otherName = otherUser?.display_name || otherUser?.username || 'Unknown';
    const otherInitial = (otherUser?.username || 'U').charAt(0).toUpperCase();

    return createPortal(
      <div className="fixed inset-0 z-[9999] flex flex-col overflow-hidden bg-zinc-950">
        {/* ── Remote video fills screen during active video call ── */}
        <video
          ref={remoteVideoRef}
          autoPlay
          playsInline
          className={cn(
            'absolute inset-0 w-full h-full object-cover',
            (callState !== 'active' || callMode === 'audio' || remoteVideoOff) && 'hidden'
          )}
        />

        {/* ── Remote camera-off placeholder ── */}
        {callState === 'active' && callMode === 'video' && remoteVideoOff && (
          <div className="absolute inset-0 flex flex-col items-center justify-center bg-zinc-900 gap-3">
            <div className="w-24 h-24 rounded-full bg-gradient-to-br from-rogan-500 to-amber-500 flex items-center justify-center text-white text-4xl font-bold shadow-2xl">
              {otherUser?.avatar
                ? <img src={otherUser.avatar} alt={otherName} className="w-full h-full rounded-full object-cover" />
                : otherInitial}
            </div>
            <p className="text-white/50 text-sm flex items-center gap-1.5">
              <VideoOff className="w-4 h-4" />
              Camera off
            </p>
          </div>
        )}

        {/* ── Gradient background for non-active states ── */}
        {callState !== 'active' && (
          <div className="absolute inset-0 bg-gradient-to-b from-zinc-900 via-zinc-800 to-zinc-950" />
        )}

        {/* ── Dark scrim over remote video ── */}
        {callState === 'active' && (
          <div className="absolute inset-0 bg-black/20 pointer-events-none" />
        )}

        {/* ── Caller / Callee info (non-active) ── */}
        {callState !== 'active' && (
          <div className="relative flex-1 flex flex-col items-center justify-center gap-6 px-8 text-center">
            <div className="w-28 h-28 rounded-full bg-gradient-to-br from-rogan-500 to-amber-500 flex items-center justify-center text-white text-4xl font-bold shadow-2xl ring-4 ring-white/10">
              {otherUser?.avatar ? (
                <img
                  src={otherUser.avatar}
                  alt={otherName}
                  className="w-full h-full rounded-full object-cover"
                />
              ) : (
                otherInitial
              )}
            </div>
            <div>
              <p className="text-white text-2xl font-semibold">{otherName}</p>
              <p className={cn(
                'text-white/50 text-sm mt-2',
                callState === 'incoming' && 'animate-pulse'
              )}>
                {callState === 'calling'
                  ? 'Calling…'
                  : callMode === 'audio' ? 'Incoming voice call…' : 'Incoming video call…'
                }
              </p>
            </div>
          </div>
        )}

        {/* ── Active call: name + timer overlay ── */}
        {callState === 'active' && (
          <div className="relative z-10 text-center pt-12">
            <p className="text-white font-semibold drop-shadow">{otherName}</p>
            <p className="text-white/60 text-sm tabular-nums mt-0.5">{fmtTime(callSeconds)}</p>
          </div>
        )}

        {/* ── Local video PiP (calling / active, video mode only) ── */}
        {(callState === 'calling' || callState === 'active') && callMode === 'video' && (
          <div
            className={cn(
              'absolute z-20 rounded-2xl overflow-hidden border-2 border-white/20 shadow-2xl bg-black',
              callState === 'active'
                ? 'bottom-32 right-4 w-28 h-44'
                : 'bottom-32 right-4 w-28 h-44 opacity-60'
            )}
          >
            <video
              ref={localVideoRef}
              autoPlay
              playsInline
              muted
              className={cn('w-full h-full object-cover', videoOff && 'invisible')}
            />
            {videoOff && (
              <div className="absolute inset-0 bg-zinc-800 flex items-center justify-center">
                <div className="w-10 h-10 rounded-full bg-gradient-to-br from-rogan-500 to-amber-500 flex items-center justify-center text-white text-sm font-bold">
                  {otherInitial}
                </div>
              </div>
            )}
          </div>
        )}

        {/* ── Control buttons ── */}
        <div className="relative z-20 pb-16 flex items-center justify-center mt-auto">
          {/* Outgoing — only end/cancel */}
          {callState === 'calling' && (
            <button
              onClick={endCall}
              className="w-16 h-16 rounded-full bg-red-500 hover:bg-red-600 active:scale-95 flex items-center justify-center shadow-2xl transition-all"
              aria-label="Cancel call"
            >
              <PhoneOff className="w-6 h-6 text-white" />
            </button>
          )}

          {/* Incoming — reject + accept */}
          {callState === 'incoming' && (
            <div className="flex flex-col items-center gap-6">
              {/* Labels */}
              <div className="flex items-center gap-20 text-xs text-white/60">
                <span>Decline</span>
                <span>Accept</span>
              </div>
              <div className="flex items-center gap-20">
                <button
                  onClick={rejectCall}
                  className="w-16 h-16 rounded-full bg-red-500 hover:bg-red-600 active:scale-95 flex items-center justify-center shadow-2xl transition-all"
                  aria-label="Reject call"
                >
                  <PhoneOff className="w-6 h-6 text-white" />
                </button>
                <button
                  onClick={acceptCall}
                  className="w-16 h-16 rounded-full bg-green-500 hover:bg-green-600 active:scale-95 flex items-center justify-center shadow-2xl transition-all animate-bounce"
                  aria-label="Accept call"
                >
                  <Phone className="w-6 h-6 text-white" />
                </button>
              </div>
            </div>
          )}

          {/* Active — mute / end / camera */}
          {callState === 'active' && (
            <div className="flex items-center gap-6">
              <button
                onClick={toggleMute}
                className={cn(
                  'w-14 h-14 rounded-full flex items-center justify-center shadow-lg transition-all active:scale-95',
                  muted ? 'bg-red-500 hover:bg-red-600' : 'bg-white/20 hover:bg-white/30'
                )}
                aria-label={muted ? 'Unmute' : 'Mute'}
              >
                {muted
                  ? <MicOff className="w-5 h-5 text-white" />
                  : <Mic className="w-5 h-5 text-white" />
                }
              </button>

              <button
                onClick={endCall}
                className="w-16 h-16 rounded-full bg-red-500 hover:bg-red-600 active:scale-95 flex items-center justify-center shadow-2xl transition-all"
                aria-label="End call"
              >
                <PhoneOff className="w-6 h-6 text-white" />
              </button>

              {callMode === 'video' && (
                <button
                  onClick={toggleVideo}
                  className={cn(
                    'w-14 h-14 rounded-full flex items-center justify-center shadow-lg transition-all active:scale-95',
                    videoOff ? 'bg-red-500 hover:bg-red-600' : 'bg-white/20 hover:bg-white/30'
                  )}
                  aria-label={videoOff ? 'Turn on camera' : 'Turn off camera'}
                >
                  {videoOff
                    ? <VideoOff className="w-5 h-5 text-white" />
                    : <Video className="w-5 h-5 text-white" />
                  }
                </button>
              )}
            </div>
          )}
        </div>
      </div>,
      document.body
    );
  }
);

VoiceVideoCall.displayName = 'VoiceVideoCall';
export default VoiceVideoCall;
