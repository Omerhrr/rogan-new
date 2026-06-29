'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import {
  Video, Copy, RefreshCw, Key, Monitor, Smartphone,
  Info, Radio, StopCircle, Camera, Mic, MicOff, VideoOff,
  Wifi, Users, MessageSquare, Gift, Maximize, Minimize, Trash2, Swords, Search, X,
  Lock, Clock,
} from 'lucide-react';
import axios from 'axios';
import { useAuthStore } from '@/stores/authStore';
import { useStreamStore } from '@/stores/streamStore';
import { StreamWSClient } from '@/lib/ws';
import { usePKStore } from '@/stores/pkStore';
import api from '@/lib/api';
import { cn } from '@/lib/utils';
import { useIsMobile } from '@/hooks/use-mobile';
import { GIFT_CONFIG } from '@/types';
import type { StreamKey, GiftType } from '@/types';

interface LiveMsg {
  id: string;
  type: 'chat' | 'gift' | 'system';
  username: string;
  userId?: string;
  text: string;
  giftEmoji?: string;
}

type StreamMode = 'obs' | 'webcam';

/**
 * Reorder H.264 payload types to the top of the video m-line in an SDP blob.
 * MediaMTX needs H.264 video to transcode a WebRTC stream into HLS segments;
 * without this Chrome often offers VP8/VP9 first and MediaMTX picks VP8,
 * which it cannot package into HLS → viewers see nothing.
 */
function preferH264Sdp(sdp: string): string {
  const sep = sdp.includes('\r\n') ? '\r\n' : '\n';
  const lines = sdp.split(sep);
  const h264Payloads: string[] = [];

  for (const line of lines) {
    const m = line.match(/^a=rtpmap:(\d+)\s+H264\//i);
    if (m) h264Payloads.push(m[1]);
  }
  if (h264Payloads.length === 0) return sdp; // H.264 not offered — return as-is

  return lines
    .map((line) => {
      if (!line.startsWith('m=video')) return line;
      const parts = line.split(' ');
      const header = parts.slice(0, 3); // "m=video <port> <proto>"
      const payloads = parts.slice(3);
      const h264First = h264Payloads.filter((p) => payloads.includes(p));
      const rest = payloads.filter((p) => !h264First.includes(p));
      return [...header, ...h264First, ...rest].join(' ');
    })
    .join(sep);
}

export default function GoLive() {
  const { user, token } = useAuthStore();
  const { createStream, goLive, endStream } = useStreamStore();
  const isMobile = useIsMobile(960);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const pcRef = useRef<RTCPeerConnection | null>(null);
  const localStreamRef = useRef<MediaStream | null>(null);
  // Ref-based guard: prevents double-click race on "Go Live" button.
  const isGoingLiveRef = useRef(false);
  // Cancellable ICE gathering timeout — cancelled on unmount or early completion.
  const iceTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Callback ref: runs synchronously when a <video> element mounts or unmounts.
  // This guarantees srcObject is set immediately — no useEffect timing dependency.
  const videoCallbackRef = useCallback((node: HTMLVideoElement | null) => {
    videoRef.current = node;
    if (node && localStreamRef.current) {
      node.srcObject = localStreamRef.current;
      node.play().catch(() => {});
    }
  }, []); // stable — localStreamRef is a ref, not state

  const [title, setTitle] = useState('');
  const [category, setCategory] = useState('');
  const [description, setDescription] = useState('');
  const [streamKeys, setStreamKeys] = useState<StreamKey[]>([]);
  const [isLive, setIsLive] = useState(false);
  const [mode, setMode] = useState<StreamMode>('obs');
  const [cameraOn, setCameraOn] = useState(false);
  const [micOn, setMicOn] = useState(true);
  const [videoDevices, setVideoDevices] = useState<MediaDeviceInfo[]>([]);
  const [audioDevices, setAudioDevices] = useState<MediaDeviceInfo[]>([]);
  const [selectedVideoId, setSelectedVideoId] = useState('');
  const [selectedAudioId, setSelectedAudioId] = useState('');
  const [showOBSGuide, setShowOBSGuide] = useState(false);
  const [loading, setLoading] = useState(false);
  const [webcamStreaming, setWebcamStreaming] = useState(false);
  const [message, setMessage] = useState('');
  const [messageType, setMessageType] = useState<'info' | 'error' | 'success'>('info');
  const [activeStreamId, setActiveStreamId] = useState<string | null>(null);
  const [activeStreamKey, setActiveStreamKey] = useState<string | null>(null);
  const [viewerCount, setViewerCount] = useState(0);
  const [liveMessages, setLiveMessages] = useState<LiveMsg[]>([]);
  const chatEndRef = useRef<HTMLDivElement>(null);
  const wsRef = useRef<StreamWSClient | null>(null);
  const liveContainerRef = useRef<HTMLDivElement>(null);
  // Stable ref to startCamera — lets the visibilitychange handler call it
  // without depending on declaration order or stale closure issues.
  const startCameraRef = useRef<() => Promise<void>>(() => Promise.resolve());
  const [isMaximized, setIsMaximized] = useState(false);
  const [chatDraft, setChatDraft] = useState('');
  const [banMenu, setBanMenu] = useState<{ userId: string; username: string; x: number; y: number } | null>(null);

  // Private show states
  const [showPrivateModal, setShowPrivateModal] = useState(false);
  const [privatePrice, setPrivatePrice] = useState('50');
  const [privateCountdownOpt, setPrivateCountdownOpt] = useState(60); // seconds
  const [privateDuration, setPrivateDuration] = useState(60); // minutes
  const [privateShowId, setPrivateShowId] = useState<string | null>(null);
  const [privateCountdownSecs, setPrivateCountdownSecs] = useState(0);
  const [isCountingDown, setIsCountingDown] = useState(false);
  const [privateShowActive, setPrivateShowActive] = useState(false);

  // PK Battle
  const { createBattle, currentBattle, isLoading: pkLoading } = usePKStore();
  const [showPKModal, setShowPKModal] = useState(false);
  const [pkQuery, setPkQuery] = useState('');
  const [pkSuggestions, setPkSuggestions] = useState<{ id: string; username: string; avatar: string | null; is_live: boolean }[]>([]);
  const [pkTarget, setPkTarget] = useState<{ id: string; username: string } | null>(null);
  const [pkDuration, setPkDuration] = useState('5');

  const notify = (msg: string, type: 'info' | 'error' | 'success' = 'info') => {
    setMessage(msg); setMessageType(type);
  };

  // Load existing stream keys
  useEffect(() => {
    api.get('/stream-keys/me').then((res) => {
      setStreamKeys(res.data.keys || []);
    }).catch(() => {});
  }, []);

  // On mount: if the creator already has an active live stream (e.g. they
  // navigated away without ending it, or came back from the feed), auto-resume
  // the live state so they can see chat and end the stream.
  const tryResumeExistingStream = useCallback(async (): Promise<boolean> => {
    if (!user?.id) return false;
    try {
      const res = await api.get('/streams/live', { params: { limit: 50 } });
      const myStream = (res.data.streams || []).find(
        (s: any) => s.creator_id === user.id
      );
      if (!myStream) return false;

      // Fetch full stream data as the authenticated creator — this includes stream_key
      const full = await api.get(`/streams/${myStream.id}`);
      setActiveStreamId(full.data.id);
      setActiveStreamKey(full.data.stream_key ?? null);
      setTitle(full.data.title ?? '');
      setIsLive(true);
      notify('Resumed your active stream', 'info');
      return true;
    } catch {
      return false;
    }
  }, [user?.id]);

  useEffect(() => {
    if (!user?.id) return;
    tryResumeExistingStream();
  }, [user?.id, tryResumeExistingStream]);

  // Enumerate camera/mic devices (requires browser permission)
  const refreshDevices = useCallback(async () => {
    try {
      // Request permission first if needed
      await navigator.mediaDevices.getUserMedia({ video: true, audio: true })
        .then(s => s.getTracks().forEach(t => t.stop()))
        .catch(() => {});
      const devices = await navigator.mediaDevices.enumerateDevices();
      setVideoDevices(devices.filter(d => d.kind === 'videoinput'));
      setAudioDevices(devices.filter(d => d.kind === 'audioinput'));
    } catch { /* no devices or permission denied */ }
  }, []);

  useEffect(() => {
    if (mode === 'webcam') refreshDevices();
  }, [mode, refreshDevices]);

  // ── Cleanup on unmount ───────────────────────────────────────────────────
  // Close WebRTC peer connection and stop camera tracks when the component unmounts
  // (e.g. user navigates away while live). Prevents zombie RTCPeerConnections and
  // ensures the browser releases camera/mic hardware.
  useEffect(() => {
    return () => {
      if (iceTimeoutRef.current) clearTimeout(iceTimeoutRef.current);
      if (pcRef.current) { pcRef.current.close(); pcRef.current = null; }
      if (localStreamRef.current) {
        localStreamRef.current.getTracks().forEach((t) => t.stop());
        localStreamRef.current = null;
      }
    };
  }, []);

  // ── Camera preview safety-net ────────────────────────────────────────────
  // videoCallbackRef handles the common case (element mounts after stream is ready).
  // This effect covers the inverse: stream becomes ready after element is already mounted
  // (e.g. user clicks Start Camera while already in live state).
  useEffect(() => {
    if (cameraOn && videoRef.current && localStreamRef.current) {
      if (!videoRef.current.srcObject) {
        videoRef.current.srcObject = localStreamRef.current;
        videoRef.current.play().catch(() => {});
      }
    }
  }, [cameraOn, isLive]);

  // ── Page visibility recovery ─────────────────────────────────────────────
  // Mobile browsers (iOS Safari, Android Chrome) suspend camera tracks when the
  // tab/app is backgrounded. When the user returns, we check if tracks are still
  // live and restart the camera if not. Also re-attach srcObject if the video
  // element lost its source.
  useEffect(() => {
    if (!isLive || mode !== 'webcam') return;

    const handleVisibilityChange = async () => {
      if (document.visibilityState !== 'visible') return;

      // Re-attach srcObject if video lost it (common on iOS after backgrounding)
      if (videoRef.current && localStreamRef.current && !videoRef.current.srcObject) {
        videoRef.current.srcObject = localStreamRef.current;
        videoRef.current.play().catch(() => {});
      }

      // Check if video tracks are still live — mobile browsers may kill them
      const videoTracks = localStreamRef.current?.getVideoTracks() ?? [];
      const cameraDead = videoTracks.length === 0 || videoTracks.some((t) => t.readyState === 'ended');
      if (cameraDead) {
        notify('Camera paused by browser — restarting…', 'info');
        try {
          await startCameraRef.current();
          // Re-attach the new stream to the video element
          if (videoRef.current && localStreamRef.current) {
            videoRef.current.srcObject = localStreamRef.current;
            videoRef.current.play().catch(() => {});
          }
        } catch {
          notify('Camera could not restart — check permissions and reload.', 'error');
        }
      }

      // Warn if WebRTC connection dropped (cannot auto-recover without full renegotiation)
      if (pcRef.current) {
        const state = pcRef.current.connectionState;
        if (state === 'failed' || state === 'disconnected') {
          notify('Stream connection interrupted — you may need to end and restart the stream.', 'error');
        }
      }
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => document.removeEventListener('visibilitychange', handleVisibilityChange);
  }, [isLive, mode]);

  // Connect to stream WS when live so the creator sees chat + gifts in real time
  useEffect(() => {
    if (!isLive || !activeStreamId || !user?.id || !token) return;

    const ws = new StreamWSClient({
      streamId: activeStreamId,
      userId: user.id,
      token,
      onChat: (msg) => {
        setLiveMessages((prev) => [
          ...prev.slice(-199), // keep last 200
          { id: msg.id, type: 'chat', username: msg.username ?? 'Viewer', userId: msg.user_id, text: msg.message },
        ]);
      },
      onGift: (gift) => {
        const cfg = GIFT_CONFIG[gift.gift_type as GiftType];
        setLiveMessages((prev) => [
          ...prev.slice(-199),
          {
            id: `gift_${Date.now()}`,
            type: 'gift',
            username: gift.sender_name,
            text: `sent ${cfg?.label ?? gift.gift_type}`,
            giftEmoji: cfg?.emoji ?? '🎁',
          },
        ]);
      },
      onViewerCount: setViewerCount,
      onConnect: () => setLiveMessages((prev) => [...prev, { id: 'sys_conn', type: 'system', username: '', text: 'Stream chat connected' }]),
      onRawMessage: (msg) => {
        const sysMsg = (text: string) =>
          setLiveMessages((prev) => [...prev.slice(-199), { id: `sys_${Date.now()}`, type: 'system' as const, username: '', text }]);
        switch (msg.type as string) {
          case 'private_show_announced':
            sysMsg(`🔒 Private show announced — ${msg.countdown_seconds}s countdown, ${msg.price_tk} TK`);
            break;
          case 'private_show_started':
            sysMsg('🔒 Private show is now live');
            break;
          case 'private_show_ended':
            sysMsg('✅ Private show ended — back to public');
            break;
          case 'private_show_cancelled':
            sysMsg('❌ Private show cancelled');
            break;
        }
      },
    });
    ws.connect();
    wsRef.current = ws;
    return () => { ws.disconnect(); wsRef.current = null; };
  }, [isLive, activeStreamId, user?.id, token]);

  // PK creator search
  useEffect(() => {
    if (pkQuery.length < 2) { setPkSuggestions([]); return; }
    const id = setTimeout(() => {
      api.get('/creators/search', { params: { q: pkQuery } })
        .then((res) => setPkSuggestions((res.data.creators || []).filter((c: any) => c.id !== user?.id)))
        .catch(() => setPkSuggestions([]));
    }, 300);
    return () => clearTimeout(id);
  }, [pkQuery, user?.id]);

  const handlePKChallenge = async () => {
    if (!pkTarget) return;
    try {
      await createBattle({ creator_b_id: pkTarget.id, duration_minutes: parseInt(pkDuration) });
      setShowPKModal(false);
      setPkTarget(null);
      setPkQuery('');
      notify(`PK challenge sent to @${pkTarget.username}!`, 'success');
    } catch { notify('Failed to send PK challenge', 'error'); }
  };

  // Auto-scroll chat
  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [liveMessages]);

  // Theater mode: expands the live panel to fill the content area
  // without using the browser Fullscreen API (topbar + sidebar stay visible).
  const toggleMaximized = useCallback(() => setIsMaximized((v) => !v), []);

  // Send chat message as the streamer
  const sendStreamerChat = useCallback(() => {
    const text = chatDraft.trim();
    if (!text || !wsRef.current) return;
    wsRef.current.sendChat(text, user?.username ?? 'Streamer');
    // Optimistic local echo
    setLiveMessages((prev) => [
      ...prev.slice(-199),
      { id: `me_${Date.now()}`, type: 'chat', username: user?.username ?? 'You', text },
    ]);
    setChatDraft('');
  }, [chatDraft, user?.username]);

  const startCamera = useCallback(async () => {
    try {
      const constraints: MediaStreamConstraints = {
        video: selectedVideoId ? { deviceId: { exact: selectedVideoId } } : true,
        audio: selectedAudioId ? { deviceId: { exact: selectedAudioId } } : true,
      };
      const stream = await navigator.mediaDevices.getUserMedia(constraints);
      localStreamRef.current = stream;
      // setCameraOn triggers re-render → <video> mounts → useEffect above attaches stream
      setCameraOn(true);
    } catch (err) {
      const name = (err as DOMException)?.name ?? '';
      if (name === 'NotAllowedError' || name === 'PermissionDeniedError') {
        notify('Camera permission denied — allow access in your browser settings and reload.', 'error');
      } else if (name === 'NotFoundError' || name === 'DevicesNotFoundError') {
        notify('No camera found. Plug in a camera or check your device.', 'error');
      } else if (name === 'NotReadableError' || name === 'TrackStartError') {
        notify('Camera is already in use by another app. Close it and try again.', 'error');
      } else if (name === 'OverconstrainedError') {
        notify('Selected camera is unavailable. Try a different device.', 'error');
      } else {
        notify('Camera access failed. Check permissions and try again.', 'error');
      }
    }
  }, [selectedVideoId, selectedAudioId]);

  const stopCamera = useCallback(() => {
    localStreamRef.current?.getTracks().forEach((t) => t.stop());
    localStreamRef.current = null;
    if (videoRef.current) videoRef.current.srcObject = null;
    setCameraOn(false);
  }, []);

  // Keep ref in sync so the visibilitychange handler always has the latest startCamera
  useEffect(() => { startCameraRef.current = startCamera; }, [startCamera]);

  const toggleMic = () => {
    const audioTracks = localStreamRef.current?.getAudioTracks() ?? [];
    audioTracks.forEach((t) => { t.enabled = !micOn; });
    setMicOn((v) => !v);
  };

  // ── WHIP streaming (browser → MediaMTX via WebRTC) ────────────────────────
  const startWhipStream = async (streamKey: string): Promise<void> => {
    if (!localStreamRef.current) throw new Error('No camera stream');

    const pc = new RTCPeerConnection({
      // Two Google STUN servers for redundancy. MediaMTX runs with network_mode: host
      // so its ICE candidates include the server's real public IP — direct UDP/TCP
      // connectivity from the browser without any Docker proxy in the path.
      iceServers: [
        { urls: 'stun:stun.l.google.com:19302' },
        { urls: 'stun:stun1.l.google.com:19302' },
      ],
    });
    pcRef.current = pc;

    // Once this flips true, mid-stream disconnect/failed notifications are shown.
    // It starts false so transient 'disconnected' states during ICE setup don't
    // alarm the streamer before the connection is fully established.
    let streamEstablished = false;

    // Use addTransceiver (not addTrack) so we get the transceiver object back.
    // direction:'sendonly' is the correct WHIP publisher mode — the browser only
    // sends media, never receives. This also produces a cleaner offer SDP.
    for (const track of localStreamRef.current.getTracks()) {
      const transceiver = pc.addTransceiver(track, {
        direction: 'sendonly',
        streams: [localStreamRef.current],
      });

      if (track.kind === 'video') {
        // setCodecPreferences is called BEFORE createOffer() so the offer SDP
        // naturally lists H.264 first — no string manipulation needed.
        // MediaMTX's HLS muxer only supports H.264/H.265 (not VP8/VP9).
        try {
          const caps = RTCRtpSender.getCapabilities?.('video');
          if (caps && typeof transceiver.setCodecPreferences === 'function') {
            const h264 = caps.codecs.filter((c) => /H264/i.test(c.mimeType));
            const rest = caps.codecs.filter((c) => !/H264/i.test(c.mimeType));
            if (h264.length > 0) {
              transceiver.setCodecPreferences([...h264, ...rest]);
              console.log('[WHIP] H.264 codec preference set via setCodecPreferences');
            }
          }
        } catch (e) {
          console.warn('[WHIP] setCodecPreferences not supported, SDP rewrite will handle it:', e);
        }
      }
    }

    // ICE connection state — log ICE-level events; surface fatal errors mid-stream.
    pc.addEventListener('iceconnectionstatechange', () => {
      console.log('[WHIP] ICE state →', pc.iceConnectionState);
      if (pc.iceConnectionState === 'failed' && streamEstablished) {
        notify('Stream connection failed (ICE) — end and restart to recover.', 'error');
      }
    });

    // ICE candidate errors — fired when a STUN/TURN request fails for a candidate.
    // Logged but not surfaced as user errors (individual failures are expected and
    // ICE tries all candidates; only a global timeout means total failure).
    pc.addEventListener('icecandidateerror', (e) => {
      const ev = e as RTCPeerConnectionIceErrorEvent;
      console.warn('[WHIP] ICE candidate error — host:', ev.url, '| code:', ev.errorCode, '| text:', ev.errorText);
    });

    // Peer-connection state — ONLY notify for mid-stream events (after established).
    // Before streamEstablished=true the ICE process produces transient 'disconnected'
    // states that are normal and would be confusing to surface.
    pc.addEventListener('connectionstatechange', () => {
      const s = pc.connectionState;
      console.log('[WHIP] Connection state:', s);
      if ((s === 'failed' || s === 'closed') && streamEstablished) {
        notify('Stream connection failed — end and restart to recover.', 'error');
      } else if (s === 'disconnected' && streamEstablished) {
        notify('Stream connection interrupted — attempting to reconnect…', 'info');
      }
    });

    const offer = await pc.createOffer();

    // Belt-and-suspenders: also reorder H.264 in the SDP string in case
    // setCodecPreferences wasn't supported (older browsers).
    const h264Sdp = preferH264Sdp(offer.sdp ?? '');
    await pc.setLocalDescription({ type: 'offer', sdp: h264Sdp });

    // Wait for ICE gathering to complete so all candidates are in the offer.
    // 8 s timeout (extended from 5 s) — mobile networks need more time.
    // Timeout is stored in a ref so it can be cancelled on unmount.
    await new Promise<void>((resolve) => {
      if (pc.iceGatheringState === 'complete') { resolve(); return; }
      iceTimeoutRef.current = setTimeout(() => {
        iceTimeoutRef.current = null;
        console.warn('[WHIP] ICE gathering timed out — proceeding with partial candidates');
        resolve();
      }, 8000);
      pc.addEventListener('icegatheringstatechange', () => {
        if (pc.iceGatheringState === 'complete') {
          if (iceTimeoutRef.current) { clearTimeout(iceTimeoutRef.current); iceTimeoutRef.current = null; }
          resolve();
        }
      });
    });

    // If the component unmounted or stopWhipStream was called while we were
    // gathering ICE, pcRef will no longer point to this pc — bail out.
    if (pcRef.current !== pc) {
      console.log('[WHIP] Peer connection was replaced or closed — aborting WHIP offer');
      return;
    }

    console.log('[WHIP] ICE gathering done, sending offer to MediaMTX');
    // Log browser ICE candidates — these are what MediaMTX will try to reach.
    // If you only see 127.0.0.1 or XXXX.local (mDNS) candidates and no LAN IP,
    // ICE from the container to the browser will fail unless TCP ICE (port 8190) is used.
    const browserCandidates = pc.localDescription!.sdp.split('\n').filter((l) => l.trimStart().startsWith('a=candidate:'));
    console.log('[WHIP] Browser ICE candidates (in offer):', browserCandidates.length > 0 ? browserCandidates : '⚠ none — ICE gathering may have stalled');
    console.log('[WHIP] Offer SDP codecs:', pc.localDescription!.sdp.split('\n').filter(l => l.startsWith('m=') || l.startsWith('a=rtpmap')).join(' | '));

    // Route through Next.js proxy (/whip/* → mediamtx:8889/*) — same-origin, no CORS
    const whipUrl = `/whip/${streamKey}/whip`;
    const res = await fetch(whipUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/sdp' },
      body: pc.localDescription!.sdp,
    });

    if (!res.ok) {
      const text = await res.text().catch(() => res.statusText);
      console.error('[WHIP] MediaMTX rejected offer:', res.status, text);
      throw new Error(`WHIP error ${res.status}: ${text}`);
    }

    const answerSdp = await res.text();
    console.log('[WHIP] Got answer from MediaMTX, setting remote description');
    // Log ICE candidates from the answer — helps diagnose Docker/NAT connectivity issues.
    // If you only see 172.x.x.x candidates here, set WEBRTC_HOST=<your-server-ip> in .env.
    const iceCandidatesInAnswer = answerSdp.split('\n').filter((l) => l.trimStart().startsWith('a=candidate:'));
    console.log('[WHIP] MediaMTX ICE candidates in answer:', iceCandidatesInAnswer.length > 0 ? iceCandidatesInAnswer : '⚠ none found');
    await pc.setRemoteDescription({ type: 'answer', sdp: answerSdp });

    // Stale-PC check after receiving the answer.
    if (pcRef.current !== pc) {
      console.log('[WHIP] Peer connection was replaced during answer — aborting');
      return;
    }

    // ── Wait for full WebRTC connectivity (ICE + DTLS + SRTP) ─────────────────
    //
    // setRemoteDescription completing = SDP negotiated. That is NOT the same as
    // media flowing. ICE connectivity checks + DTLS handshake + SRTP setup all
    // happen AFTER this and take 200 ms to 3 s on a LAN.
    //
    // We MUST await connectionState === 'connected' before returning because:
    //   1. The caller immediately calls goLive() which marks the DB stream live.
    //   2. Viewers can then load the HLS URL from the DB response.
    //   3. With hlsAlwaysRemux:false MediaMTX only creates the HLS manifest when
    //      it is actively receiving video frames. If we return early, goLive fires
    //      before MediaMTX has a single frame → HLS 404 for the first few seconds.
    //      hls.js handles this via its retry loop, so a short gap is acceptable —
    //      but if ICE never connects (firewall, NAT, Docker UDP proxy issue) the
    //      manifest NEVER appears and the viewer sees nothing forever.
    //
    // By waiting here we surface a clear error to the STREAMER if ICE fails,
    // instead of silently leaving viewers with an endless spinner.
    notify('Connecting stream (establishing WebRTC)…', 'info');
    await new Promise<void>((resolve, reject) => {
      // Fast path — already connected (e.g. same-machine loopback ICE)
      if (pc.connectionState === 'connected') {
        streamEstablished = true;
        resolve();
        return;
      }
      if (pc.connectionState === 'failed' || pc.connectionState === 'closed') {
        reject(new Error('WebRTC connection failed before media could be established.'));
        return;
      }

      // 20 s allows time for TCP ICE fallback (port 8190) which is slower than UDP.
      // If it takes longer than 20 s the network/firewall won't recover.
      const t = setTimeout(() => {
        reject(new Error(
          'WebRTC connection timed out (20 s). ' +
          'Run "docker-compose down && docker-compose up --build" to apply the latest config. ' +
          'Ports required: 8189/udp (ICE UDP) and 8190/tcp (ICE TCP fallback). ' +
          'For a remote server, set WEBRTC_HOST=<server-public-ip> in your .env file.',
        ));
      }, 20_000);

      const onState = () => {
        const s = pc.connectionState;
        console.log('[WHIP] Connection state (setup wait):', s);
        if (s === 'connected') {
          clearTimeout(t);
          pc.removeEventListener('connectionstatechange', onState);
          streamEstablished = true;
          resolve();
        } else if (s === 'failed' || s === 'closed') {
          clearTimeout(t);
          pc.removeEventListener('connectionstatechange', onState);
          reject(new Error(
            `WebRTC connection ${s}. ` +
            'Port 8189/udp may be blocked by a firewall or NAT. ' +
            'Check Docker port mapping and network configuration.',
          ));
        }
      };
      pc.addEventListener('connectionstatechange', onState);
    });

    // Final stale-PC check: component may have unmounted while we were waiting
    // (pc.close() triggers 'closed' which rejects the promise above, so
    // this path only fires if the race is very tight).
    if (pcRef.current !== pc) {
      console.log('[WHIP] Peer connection was replaced while awaiting connection — aborting');
      return;
    }

    console.log('[WHIP] WebRTC connected — DTLS+SRTP established, media is flowing to MediaMTX');
    setWebcamStreaming(true);
  };

  const stopWhipStream = () => {
    if (iceTimeoutRef.current) { clearTimeout(iceTimeoutRef.current); iceTimeoutRef.current = null; }
    pcRef.current?.close();
    pcRef.current = null;
    setWebcamStreaming(false);
  };

  // ── Go live ───────────────────────────────────────────────────────────────
  const handleGoLive = async () => {
    if (!title.trim()) { notify('Please enter a stream title', 'error'); return; }
    if (user?.role === 'user') {
      notify('You need to be a creator — upgrade in Settings.', 'error'); return;
    }
    if (mode === 'webcam' && !cameraOn) {
      notify('Start your camera first', 'error'); return;
    }

    // Ref-based guard prevents duplicate invocations from rapid double-clicks.
    // React batches setState so the `disabled={loading}` UI update isn't guaranteed
    // to fire before a second click event arrives.
    if (isGoingLiveRef.current) return;
    isGoingLiveRef.current = true;
    setLoading(true);

    try {
      const stream = await createStream({
        title,
        description: description || undefined,
        category: category || undefined,
      });

      if (mode === 'webcam' && stream.stream_key) {
        // WHIP FIRST — establish the WebRTC connection to MediaMTX BEFORE marking
        // the stream as live in the DB. This guarantees that by the time viewers
        // can discover the "live" stream, MediaMTX already has real video to serve.
        // If WHIP fails, goLive() is never called so no zombie is_live=true in DB.
        await startWhipStream(stream.stream_key);
        await goLive(stream.id);
        setActiveStreamId(stream.id);
        setActiveStreamKey(stream.stream_key);
        setIsLive(true);
        notify('🔴 You are LIVE via webcam!', 'success');
      } else {
        // OBS mode: mark live immediately (OBS connects independently via RTMP)
        await goLive(stream.id);
        setActiveStreamId(stream.id);
        setActiveStreamKey(stream.stream_key);
        setIsLive(true);
        notify('🔴 You are LIVE! Start streaming in OBS now.', 'success');
      }
    } catch (err: unknown) {
      // 409 Conflict → creator already has a live stream; resume it.
      // Close any partial WHIP connection first — the new stream's WebRTC must
      // not remain open while we're trying to display a different stream.
      if (axios.isAxiosError(err) && err.response?.status === 409) {
        stopWhipStream();
        const resumed = await tryResumeExistingStream();
        if (!resumed) {
          notify('You already have an active stream — refresh and try again.', 'error');
        }
        return;
      }
      const msg = err instanceof Error ? err.message : 'Failed to go live';
      notify(msg, 'error');
      // Close any partial WebRTC connection (WHIP may have opened before goLive threw)
      stopWhipStream();
    } finally {
      setLoading(false);
      isGoingLiveRef.current = false;
    }
  };

  // ── End stream ─────────────────────────────────────────────────────────────
  const handleEndStream = async () => {
    if (!activeStreamId) return;
    setLoading(true);
    try {
      stopWhipStream();
      stopCamera();
      await endStream(activeStreamId);
      setIsLive(false);
      setActiveStreamId(null);
      setActiveStreamKey(null);
      // Clear live-state accumulations so a subsequent stream starts fresh
      setLiveMessages([]);
      setViewerCount(0);
      notify('Stream ended', 'info');
    } catch {
      notify('Failed to end stream', 'error');
    } finally {
      setLoading(false);
    }
  };

  // ── Private show countdown ────────────────────────────────────────────────
  useEffect(() => {
    if (!isCountingDown || privateCountdownSecs <= 0) return;
    const timer = setInterval(() => {
      setPrivateCountdownSecs((s) => {
        if (s <= 1) {
          clearInterval(timer);
          // Trigger private show start
          if (activeStreamId && privateShowId) {
            api.post(`/streams/${activeStreamId}/go-private/start`)
              .then(() => { setIsCountingDown(false); setPrivateShowActive(true); })
              .catch(() => { setIsCountingDown(false); });
          }
          return 0;
        }
        return s - 1;
      });
    }, 1000);
    return () => clearInterval(timer);
  }, [isCountingDown, activeStreamId, privateShowId]);

  const handleAnnouncePrivate = async () => {
    if (!activeStreamId) return;
    try {
      const res = await api.post(
        `/streams/${activeStreamId}/go-private/announce`,
        null,
        { params: { price_tk: parseFloat(privatePrice), countdown_seconds: privateCountdownOpt } }
      );
      setPrivateShowId(res.data.show_id);
      setPrivateCountdownSecs(privateCountdownOpt);
      setIsCountingDown(true);
      setShowPrivateModal(false);
    } catch (e) {
      notify('Failed to announce private show', 'error');
    }
  };

  const handleCancelPrivate = async () => {
    if (!activeStreamId) return;
    try {
      await api.post(`/streams/${activeStreamId}/go-private/cancel`);
      setIsCountingDown(false);
      setPrivateShowId(null);
      setPrivateCountdownSecs(0);
    } catch {}
  };

  const handleEndPrivate = async () => {
    if (!activeStreamId) return;
    try {
      await api.post(`/streams/${activeStreamId}/go-private/end`);
      setPrivateShowActive(false);
      setPrivateShowId(null);
    } catch {}
  };

  const generateKey = async (label = 'OBS') => {
    try {
      const res = await api.post('/stream-keys', { label });
      setStreamKeys((prev) => [...prev, res.data]);
      notify(`Stream key generated (${label})`, 'success');
    } catch {
      notify('Failed to generate stream key', 'error');
    }
  };

  const rotateKey = async (keyId: string) => {
    try {
      const res = await api.post(`/stream-keys/${keyId}/rotate`);
      setStreamKeys((prev) => prev.map((k) => k.id === keyId ? res.data : k));
      notify('Stream key rotated', 'success');
    } catch {
      notify('Failed to rotate key', 'error');
    }
  };

  const deleteKey = async (keyId: string) => {
    try {
      await api.delete(`/stream-keys/${keyId}`);
      setStreamKeys((prev) => prev.filter((k) => k.id !== keyId));
      notify('Stream key revoked', 'success');
    } catch {
      notify('Failed to revoke key', 'error');
    }
  };

  const copy = (text: string) => {
    navigator.clipboard.writeText(text);
    notify('Copied!', 'success');
  };

  // For OBS guide display: show the hostname the user should enter in OBS.
  // RTMP ingest (port 1935) is accessed directly — not proxied.
  const mediamtxHost = typeof window !== 'undefined' ? window.location.hostname : 'localhost';

  // ── Render ─────────────────────────────────────────────────────────────────
  return (
    <div className={cn(
      'h-full',
      // When live: fill the container exactly, no scroll, no title eating into height.
      // Theater mode skips padding too so the panel is truly full-bleed.
      isLive
        ? isMaximized
          ? 'overflow-hidden relative'
          // Mobile: add pb-16 so the chat input clears the fixed BottomNav (h-16 = 64 px)
          : isMobile ? 'overflow-hidden relative pt-3 px-3 pb-16' : 'overflow-hidden relative p-3'
        : 'overflow-y-auto p-4 lg:p-6 max-w-4xl mx-auto space-y-6'
    )}>
      {/* Title — hidden while live (status bar already shows "You are LIVE!") */}
      {!isLive && (
        <h1 className="text-2xl font-bold text-white flex items-center gap-2">
          <Video className="w-6 h-6 text-rogan-500" /> Go Live
        </h1>
      )}

      {/* Toast message — floats over the live panel instead of pushing layout */}
      {message && (
        <div className={cn(
          'flex items-center justify-between rounded-lg px-4 py-3 text-sm border',
          isLive ? 'absolute top-2 inset-x-3 z-20' : '',
          messageType === 'error' ? 'bg-red-900/30 border-red-500/30 text-red-400' :
          messageType === 'success' ? 'bg-green-900/30 border-green-500/30 text-green-400' :
          'bg-white/5 border-white/10 text-white/80'
        )}>
          {message}
          <button onClick={() => setMessage('')} className="ml-4 text-current opacity-60 hover:opacity-100">&times;</button>
        </div>
      )}

      {isLive ? (
        /* ── LIVE STATE ────────────────────────────────────────────────────── */
        <div
          ref={liveContainerRef}
          className={cn(
            'flex gap-4 h-full overflow-hidden',
            isMobile ? 'flex-col' : 'flex-row min-h-[400px]'
          )}
        >
          {/* Camera + controls column
              Desktop: flex-1 (fills left area next to the 300px chat sidebar)
              Mobile: flex-[2] min-h-0 so it takes ~40% of the vertical stack height */}
          <div className={cn('flex flex-col gap-3 min-w-0', isMobile ? 'flex-[2] min-h-0' : 'flex-1')}>
            {/* Status bar */}
            <div className="bg-rogan-600/10 border border-rogan-500/30 rounded-xl p-3 flex items-center gap-3">
              <div className="w-8 h-8 rounded-full bg-rogan-600 flex items-center justify-center live-pulse flex-shrink-0">
                <Radio className="w-4 h-4 text-white" />
              </div>
              <div className="flex-1 min-w-0">
                <h2 className="text-white font-bold text-sm">You are LIVE!</h2>
                <div className="flex items-center gap-3">
                  <p className="text-white/50 text-xs truncate">{title}</p>
                  {webcamStreaming && (
                    <span className="flex items-center gap-1 text-green-400 text-xs">
                      <Wifi className="w-3 h-3" /> WebRTC
                    </span>
                  )}
                  <span className="flex items-center gap-1 text-white/40 text-xs">
                    <Users className="w-3 h-3" /> {viewerCount} watching
                  </span>
                </div>
              </div>
              {/* Theater-mode toggle — expands panel within the page (no browser fullscreen) */}
              <button
                onClick={toggleMaximized}
                className="p-2 bg-white/10 hover:bg-white/20 text-white rounded-lg transition-colors flex-shrink-0"
                title={isMaximized ? 'Restore size' : 'Maximize panel'}
              >
                {isMaximized ? <Minimize className="w-4 h-4" /> : <Maximize className="w-4 h-4" />}
              </button>
              {/* Private show controls */}
              {!isCountingDown && !privateShowActive && (
                <button
                  onClick={() => setShowPrivateModal(true)}
                  className="px-3 py-2 bg-purple-600 hover:bg-purple-700 text-white rounded-lg font-medium flex items-center gap-2 transition-colors text-sm flex-shrink-0"
                >
                  <Lock className="w-4 h-4" /> Private
                </button>
              )}
              {isCountingDown && (
                <div className="px-3 py-2 bg-purple-900/50 border border-purple-500/30 rounded-lg text-purple-300 text-sm flex items-center gap-2">
                  <Clock className="w-4 h-4 animate-pulse" />
                  {Math.floor(privateCountdownSecs / 60)}:{String(privateCountdownSecs % 60).padStart(2, '0')}
                  <button onClick={handleCancelPrivate} className="ml-1 text-purple-400 hover:text-white text-xs underline">Cancel</button>
                </div>
              )}
              {privateShowActive && (
                <button onClick={handleEndPrivate} className="px-3 py-2 bg-purple-600 hover:bg-purple-700 text-white rounded-lg font-medium text-sm flex-shrink-0">
                  End Private
                </button>
              )}
              {/* PK Battle — hidden until post-deployment */}
              <button
                onClick={handleEndStream}
                disabled={loading}
                className="px-3 py-2 bg-red-600 hover:bg-red-700 text-white rounded-lg font-medium flex items-center gap-2 transition-colors disabled:opacity-50 flex-shrink-0 text-sm"
              >
                <StopCircle className="w-4 h-4" /> End
              </button>
            </div>

            {/* Camera preview */}
            {(cameraOn || localStreamRef.current) ? (
              <div className={cn(
                'relative bg-black rounded-xl overflow-hidden border border-white/5',
                isMobile ? 'flex-1 min-h-0' : 'flex-1'
              )}>
                <video ref={videoCallbackRef} autoPlay playsInline muted className="w-full h-full object-cover" />
                <div className="absolute bottom-3 right-3 flex gap-2">
                  <button
                    onClick={toggleMic}
                    className={cn('p-2 rounded-lg text-white transition-colors', micOn ? 'bg-black/50 hover:bg-black/70' : 'bg-red-600/80')}
                  >
                    {micOn ? <Mic className="w-4 h-4" /> : <MicOff className="w-4 h-4" />}
                  </button>
                </div>
              </div>
            ) : (
              /* OBS mode — show connection info */
              mode === 'obs' && activeStreamKey && (
                <div className={cn(
                  'bg-surface rounded-xl p-4 border border-white/5 text-sm',
                  isMobile ? 'flex-1 min-h-0' : 'flex-1'
                )}>
                  <p className="text-white/60 mb-3">Connect OBS to your stream:</p>
                  <div className="space-y-2">
                    <div className="flex items-center gap-2 bg-black/30 rounded px-3 py-2">
                      <span className="text-white/40 text-xs w-16">Server</span>
                      <code className="text-tk text-xs flex-1">rtmp://{mediamtxHost}:1935</code>
                      <button onClick={() => copy(`rtmp://${mediamtxHost}:1935`)}><Copy className="w-3.5 h-3.5 text-white/40 hover:text-white" /></button>
                    </div>
                    <div className="flex items-center gap-2 bg-black/30 rounded px-3 py-2">
                      <span className="text-white/40 text-xs w-16">Key</span>
                      <code className="text-tk text-xs flex-1 truncate">{activeStreamKey}</code>
                      <button onClick={() => copy(activeStreamKey)}><Copy className="w-3.5 h-3.5 text-white/40 hover:text-white" /></button>
                    </div>
                  </div>
                </div>
              )
            )}
          </div>

          {/* Chat & gifts
              Desktop: fixed 300px sidebar
              Mobile: flex-[3] min-h-0 — takes ~60% of the vertical stack, ensuring
              the chat list and the input are always visible */}
          <div className={cn(
            'bg-surface border border-white/5 rounded-xl flex flex-col',
            isMobile ? 'flex-[3] min-h-0' : 'w-[300px] flex-shrink-0'
          )}>
            {/* Header */}
            <div className="h-10 flex items-center gap-2 px-4 border-b border-white/5">
              <MessageSquare className="w-4 h-4 text-white/40" />
              <span className="text-white text-sm font-medium flex-1">Live Chat</span>
              <span className="text-white/30 text-xs">{viewerCount} viewers</span>
            </div>

            {/* Messages */}
            <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain scrollbar-thin p-3 space-y-1.5">
              {liveMessages.length === 0 && (
                <p className="text-white/20 text-xs text-center pt-4">Waiting for comments...</p>
              )}
              {liveMessages.map((msg) => {
                const canBan = msg.type === 'chat' && msg.userId && msg.userId !== user?.id;
                let holdTimer: ReturnType<typeof setTimeout> | null = null;
                const openBanMenu = (e: React.MouseEvent | React.TouchEvent) => {
                  if (!canBan || !msg.userId) return;
                  e.preventDefault();
                  const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
                  setBanMenu({ userId: msg.userId, username: msg.username, x: rect.left, y: rect.top });
                };
                return (
                  <div
                    key={msg.id}
                    className="text-sm leading-snug"
                    onContextMenu={canBan ? openBanMenu : undefined}
                    onTouchStart={canBan ? (e) => { const el = e.currentTarget; holdTimer = setTimeout(() => { if (!msg.userId) return; const rect = el.getBoundingClientRect(); setBanMenu({ userId: msg.userId!, username: msg.username, x: rect.left, y: rect.top }); }, 600); } : undefined}
                    onTouchEnd={() => { if (holdTimer) { clearTimeout(holdTimer); holdTimer = null; } }}
                  >
                    {msg.type === 'system' ? (
                      <span className="text-white/20 text-xs italic">{msg.text}</span>
                    ) : msg.type === 'gift' ? (
                      <div className="flex items-center gap-1.5 bg-tk/10 border border-tk/20 rounded-lg px-2.5 py-1.5">
                        <span className="text-base">{msg.giftEmoji}</span>
                        <span className="text-tk text-xs font-semibold truncate">
                          {msg.username} {msg.text}
                        </span>
                      </div>
                    ) : (
                      <span>
                        <span className="text-rogan-400 font-medium">{msg.username}</span>
                        <span className="text-white/40">: </span>
                        <span className="text-white/80">{msg.text}</span>
                      </span>
                    )}
                  </div>
                );
              })}
              <div ref={chatEndRef} />
            </div>

            {/* Gift ticker + streamer chat input */}
            <div className="px-3 pb-3 pt-2 border-t border-white/5 space-y-2">
              <div className="flex items-center gap-1.5">
                <Gift className="w-3.5 h-3.5 text-tk/60" />
                <span className="text-white/30 text-[11px]">
                  {liveMessages.filter((m) => m.type === 'gift').length} gifts received
                </span>
              </div>
              {/* Streamer chat input */}
              <form
                onSubmit={(e) => { e.preventDefault(); sendStreamerChat(); }}
                className="flex gap-1.5"
              >
                <input
                  type="text"
                  value={chatDraft}
                  onChange={(e) => setChatDraft(e.target.value)}
                  placeholder="Comment..."
                  maxLength={200}
                  className="flex-1 min-w-0 bg-white/5 border border-white/10 rounded-lg px-3 py-1.5 text-xs text-white placeholder:text-white/30 focus:outline-none focus:border-rogan-500/50"
                />
                <button
                  type="submit"
                  disabled={!chatDraft.trim()}
                  className="px-2.5 py-1.5 bg-rogan-600 hover:bg-rogan-700 disabled:opacity-30 text-white rounded-lg text-xs transition-colors"
                >
                  Send
                </button>
              </form>
            </div>
          </div>
        </div>
      ) : (
        /* ── SETUP STATE ───────────────────────────────────────────────────── */
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">

          {/* Left column */}
          <div className="space-y-4">
            {/* Stream details */}
            <div className="bg-surface rounded-xl p-5 border border-white/5 space-y-3">
              <h3 className="text-white font-semibold">Stream Details</h3>
              <input
                type="text"
                placeholder="Stream Title *"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                className="w-full bg-white/5 border border-white/10 rounded-lg px-4 py-3 text-sm text-white placeholder:text-white/30 focus:outline-none focus:border-rogan-500/50"
              />
              <input
                type="text"
                placeholder="Category (e.g. Gaming, Music, Talk)"
                value={category}
                onChange={(e) => setCategory(e.target.value)}
                className="w-full bg-white/5 border border-white/10 rounded-lg px-4 py-3 text-sm text-white placeholder:text-white/30 focus:outline-none focus:border-rogan-500/50"
              />
              <textarea
                placeholder="Description (optional)"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                rows={2}
                className="w-full bg-white/5 border border-white/10 rounded-lg px-4 py-3 text-sm text-white placeholder:text-white/30 focus:outline-none focus:border-rogan-500/50 resize-none"
              />
            </div>

            {/* Mode tabs */}
            <div className="bg-surface rounded-xl p-1 border border-white/5 flex">
              <button
                onClick={() => { setMode('obs'); stopCamera(); }}
                className={cn('flex-1 py-2.5 rounded-lg text-sm font-medium flex items-center justify-center gap-2 transition-colors', mode === 'obs' ? 'bg-rogan-600 text-white' : 'text-white/50 hover:text-white')}
              >
                <Monitor className="w-4 h-4" /> OBS / RTMP
              </button>
              <button
                onClick={() => { setMode('webcam'); }}
                className={cn('flex-1 py-2.5 rounded-lg text-sm font-medium flex items-center justify-center gap-2 transition-colors', mode === 'webcam' ? 'bg-rogan-600 text-white' : 'text-white/50 hover:text-white')}
              >
                <Camera className="w-4 h-4" /> Webcam / Phone
              </button>
            </div>

            {/* Webcam controls */}
            {mode === 'webcam' && (
              <div className="bg-surface rounded-xl p-5 border border-white/5 space-y-3">
                <h3 className="text-white font-semibold flex items-center gap-2">
                  <Camera className="w-4 h-4 text-rogan-400" /> Camera Setup
                </h3>
                <div className="relative bg-black rounded-lg overflow-hidden aspect-video flex items-center justify-center">
                  {cameraOn ? (
                    <video ref={videoCallbackRef} autoPlay playsInline muted className="w-full h-full object-cover" />
                  ) : (
                    <div className="flex flex-col items-center gap-2 text-white/20">
                      <VideoOff className="w-10 h-10" />
                      <span className="text-sm">Camera is off</span>
                    </div>
                  )}
                  {cameraOn && (
                    <div className="absolute bottom-2 right-2 flex gap-1.5">
                      <button
                        onClick={toggleMic}
                        className={cn('p-1.5 rounded-lg text-white text-xs transition-colors', micOn ? 'bg-black/60' : 'bg-red-600')}
                        title={micOn ? 'Mute mic' : 'Unmute mic'}
                      >
                        {micOn ? <Mic className="w-3.5 h-3.5" /> : <MicOff className="w-3.5 h-3.5" />}
                      </button>
                    </div>
                  )}
                </div>
                {/* Device selectors */}
                {!cameraOn && videoDevices.length > 0 && (
                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <label className="text-white/40 text-[10px] uppercase tracking-wider mb-1 block">Camera</label>
                      <select
                        value={selectedVideoId}
                        onChange={(e) => setSelectedVideoId(e.target.value)}
                        className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-white text-xs focus:outline-none focus:border-rogan-500/50"
                      >
                        <option value="">Default</option>
                        {videoDevices.map((d) => (
                          <option key={d.deviceId} value={d.deviceId}>{d.label || `Camera ${videoDevices.indexOf(d) + 1}`}</option>
                        ))}
                      </select>
                    </div>
                    <div>
                      <label className="text-white/40 text-[10px] uppercase tracking-wider mb-1 block">Microphone</label>
                      <select
                        value={selectedAudioId}
                        onChange={(e) => setSelectedAudioId(e.target.value)}
                        className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-white text-xs focus:outline-none focus:border-rogan-500/50"
                      >
                        <option value="">Default</option>
                        {audioDevices.map((d) => (
                          <option key={d.deviceId} value={d.deviceId}>{d.label || `Mic ${audioDevices.indexOf(d) + 1}`}</option>
                        ))}
                      </select>
                    </div>
                  </div>
                )}
                <button
                  onClick={cameraOn ? stopCamera : startCamera}
                  className={cn('w-full py-2.5 rounded-lg text-sm font-medium flex items-center justify-center gap-2 transition-colors', cameraOn ? 'bg-red-900/30 hover:bg-red-900/50 text-red-400 border border-red-900/30' : 'bg-white/5 hover:bg-white/10 text-white/70 border border-white/10')}
                >
                  {cameraOn ? <><StopCircle className="w-4 h-4" /> Stop Camera</> : <><Camera className="w-4 h-4" /> Start Camera</>}
                </button>
                <p className="text-white/30 text-xs text-center">
                  Works with any camera — built-in, USB, capture card, or phone
                </p>
              </div>
            )}

            {/* Go Live button */}
            <button
              onClick={handleGoLive}
              disabled={loading || !title.trim() || (mode === 'webcam' && !cameraOn)}
              className="w-full py-3.5 bg-rogan-600 hover:bg-rogan-700 disabled:opacity-30 text-white font-bold rounded-xl flex items-center justify-center gap-2 transition-colors text-base"
            >
              <Radio className="w-5 h-5" />
              {loading ? 'Starting...' : mode === 'webcam' ? 'Go Live via Webcam' : 'Go Live via OBS'}
            </button>
          </div>

          {/* Right column — Stream keys + OBS guide */}
          <div className="space-y-4">
            <div className="bg-surface rounded-xl p-5 border border-white/5 space-y-4">
              <div className="flex items-center justify-between">
                <h3 className="text-white font-semibold flex items-center gap-2">
                  <Key className="w-4 h-4 text-tk" /> Stream Keys
                </h3>
                <div className="flex gap-2">
                  <button onClick={() => generateKey('OBS')} className="px-3 py-1.5 bg-white/5 hover:bg-white/10 text-white/70 text-xs rounded-lg flex items-center gap-1 transition-colors">
                    <Monitor className="w-3 h-3" /> OBS
                  </button>
                  <button onClick={() => generateKey('Mobile')} className="px-3 py-1.5 bg-white/5 hover:bg-white/10 text-white/70 text-xs rounded-lg flex items-center gap-1 transition-colors">
                    <Smartphone className="w-3 h-3" /> Mobile
                  </button>
                </div>
              </div>
              {streamKeys.length === 0 ? (
                <p className="text-white/30 text-sm text-center py-4">No keys yet -- generate one above</p>
              ) : (
                <div className="space-y-2">
                  {streamKeys.map((key) => (
                    <div key={key.id} className="bg-white/5 rounded-lg p-3 flex items-center gap-2">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-0.5">
                          <span className="text-white/50 text-xs">{key.label || 'Key'}</span>
                          {key.is_active && <span className="text-green-400 text-[10px] font-medium">ACTIVE</span>}
                        </div>
                        <p className="text-white font-mono text-xs truncate">{key.key}</p>
                      </div>
                      <button onClick={() => copy(key.key)} className="p-1.5 hover:bg-white/5 rounded text-white/40 hover:text-white transition-colors" title="Copy key">
                        <Copy className="w-3.5 h-3.5" />
                      </button>
                      <button onClick={() => rotateKey(key.id)} className="p-1.5 hover:bg-white/5 rounded text-white/40 hover:text-white transition-colors" title="Rotate key">
                        <RefreshCw className="w-3.5 h-3.5" />
                      </button>
                      <button onClick={() => deleteKey(key.id)} className="p-1.5 hover:bg-white/5 rounded text-white/40 hover:text-red-400 transition-colors" title="Revoke key">
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* OBS Guide (only show in OBS mode) */}
            {mode === 'obs' && (
              <div className="bg-surface rounded-xl p-5 border border-white/5 space-y-3">
                <button onClick={() => setShowOBSGuide(!showOBSGuide)} className="w-full flex items-center justify-between text-white font-semibold">
                  <span className="flex items-center gap-2">
                    <Info className="w-4 h-4 text-blue-400" /> OBS Setup Guide
                  </span>
                  <span className="text-white/40 text-sm">{showOBSGuide ? '\u25b2' : '\u25bc'}</span>
                </button>
                {showOBSGuide && (
                  <div className="space-y-2 text-xs text-white/50">
                    <p>1. Open OBS - Settings - Stream</p>
                    <p>2. Set <span className="text-white/80">Service</span> to Custom and paste the RTMP server URL</p>
                    <p>3. Paste your stream key</p>
                    <p>4. Click <span className="text-white/80">Start Streaming</span> in OBS</p>
                    <p>5. Click <span className="text-white/80">Go Live</span> here to make your stream public</p>
                  </div>
                )}
              </div>
            )}

            {/* Webcam guide */}
            {mode === 'webcam' && (
              <div className="bg-surface rounded-xl p-5 border border-white/5 space-y-3">
                <h3 className="text-white font-semibold flex items-center gap-2">
                  <Info className="w-4 h-4 text-blue-400" /> How Webcam Streaming Works
                </h3>
                <div className="space-y-2 text-xs text-white/50">
                  <p>1. Click <span className="text-white/80">Start Camera</span> to enable your webcam + mic</p>
                  <p>2. Click <span className="text-white/80">Go Live</span> to start broadcasting</p>
                  <p>3. Your stream is delivered at ultra-low latency via WebRTC</p>
                  <p>4. Click <span className="text-white/80">End Stream</span> when done</p>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Private Show Modal */}
      {showPrivateModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
          <div className="bg-surface border border-white/10 rounded-2xl p-6 w-full max-w-sm mx-4 space-y-4">
            <h3 className="text-white font-bold text-lg flex items-center gap-2">
              <Lock className="w-5 h-5 text-purple-400" /> Switch to Private Show
            </h3>
            <div className="space-y-3">
              <div>
                <label className="text-white/50 text-xs mb-1 block">Entry Price (TK)</label>
                <input
                  type="number"
                  value={privatePrice}
                  onChange={(e) => setPrivatePrice(e.target.value)}
                  min="1"
                  className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:border-purple-500/50"
                />
              </div>
              <div>
                <label className="text-white/50 text-xs mb-1 block">Countdown</label>
                <select
                  value={privateCountdownOpt}
                  onChange={(e) => setPrivateCountdownOpt(Number(e.target.value))}
                  className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:border-purple-500/50"
                >
                  <option value={30}>30 seconds</option>
                  <option value={60}>1 minute</option>
                  <option value={120}>2 minutes</option>
                  <option value={180}>3 minutes</option>
                </select>
              </div>
              <div>
                <label className="text-white/50 text-xs mb-1 block">Duration</label>
                <select
                  value={privateDuration}
                  onChange={(e) => setPrivateDuration(Number(e.target.value))}
                  className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:border-purple-500/50"
                >
                  <option value={30}>30 minutes</option>
                  <option value={60}>1 hour</option>
                  <option value={120}>2 hours</option>
                </select>
              </div>
              <div className="flex gap-2 pt-2">
                <button
                  onClick={() => setShowPrivateModal(false)}
                  className="flex-1 px-4 py-2 bg-white/5 hover:bg-white/10 text-white/60 rounded-lg text-sm transition-colors"
                >
                  Cancel
                </button>
                <button
                  onClick={handleAnnouncePrivate}
                  className="flex-1 px-4 py-2 bg-purple-600 hover:bg-purple-700 text-white rounded-lg text-sm font-medium transition-colors"
                >
                  Announce
                </button>
              </div>
            </div>
          </div>
        </div>
        )}

        {/* PK Modal */}
        {showPKModal && (
          <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4">
            <div className="bg-surface border border-white/10 rounded-2xl p-6 w-full max-w-sm">
              <h3 className="text-white font-bold text-lg mb-4 flex items-center gap-2">
                <Swords className="w-5 h-5 text-rogan-500" /> PK Battle Challenge
              </h3>
              <div className="space-y-4">
                <div>
                  <label className="text-white/50 text-xs mb-1 block">Search Creator</label>
                  <div className="relative">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-white/30" />
                    <input
                      type="text"
                      value={pkQuery}
                      onChange={(e) => setPkQuery(e.target.value)}
                      placeholder="@username"
                      className="w-full bg-white/5 border border-white/10 rounded-lg pl-9 pr-3 py-2 text-white text-sm focus:outline-none focus:border-rogan-500/50"
                    />
                  </div>
                  {pkSuggestions.length > 0 && (
                    <div className="mt-1 bg-surface border border-white/10 rounded-lg overflow-hidden">
                      {pkSuggestions.map((c) => (
                        <button
                          key={c.id}
                          onClick={() => { setPkTarget({ id: c.id, username: c.username }); setPkSuggestions([]); setPkQuery(c.username); }}
                          className="w-full flex items-center gap-2 px-3 py-2 hover:bg-white/5 text-left"
                        >
                          <span className="text-white text-sm">@{c.username}</span>
                          {c.is_live && <span className="text-[10px] text-rogan-400 font-medium">LIVE</span>}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
                <div>
                  <label className="text-white/50 text-xs mb-1 block">Duration (minutes)</label>
                  <input
                    type="number"
                    value={pkDuration}
                    onChange={(e) => setPkDuration(e.target.value)}
                    min={1}
                    max={60}
                    className="w-full bg-white/5 border border-white/10 rounded-lg px-4 py-2 text-white text-sm focus:outline-none focus:border-rogan-500/50"
                  />
                </div>
                <div className="flex gap-2">
                  <button
                    onClick={() => setShowPKModal(false)}
                    className="flex-1 py-2.5 bg-white/5 hover:bg-white/10 text-white/60 rounded-xl text-sm transition-colors"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={handlePKChallenge}
                    disabled={!pkTarget || !isLive}
                    className="flex-1 py-2.5 bg-rogan-600 hover:bg-rogan-700 disabled:opacity-40 text-white rounded-xl text-sm font-semibold transition-colors"
                  >
                    Send Challenge
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Ban context menu */}
        {banMenu && (
          <div
            className="fixed z-[300] bg-surface border border-white/10 rounded-xl shadow-2xl py-1 min-w-[160px]"
            style={{ left: banMenu.x, top: banMenu.y - 44 }}
            onMouseLeave={() => setBanMenu(null)}
          >
            <div className="px-3 py-1.5 text-xs text-white/30 border-b border-white/5">@{banMenu.username}</div>
            <button
              onClick={async () => {
                try {
                  await api.post('/moderation/stream-ban', { viewer_id: banMenu.userId, reason: 'Banned by streamer' });
                  setLiveMessages((prev) => [
                    ...prev,
                    { id: `sys_ban_${Date.now()}`, type: 'system', username: '', text: `@${banMenu.username} banned from this stream` },
                  ]);
                } catch { /* silent */ } finally { setBanMenu(null); }
              }}
              className="w-full text-left px-3 py-2 text-xs text-red-400 hover:bg-white/5 transition-colors"
            >
              Ban from stream
            </button>
          </div>
        )}
      </div>
  );
}
