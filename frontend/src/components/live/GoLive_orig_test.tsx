'use client';

import { useState, useEffect, useRef } from 'react';
import { Video, Copy, RefreshCw, Key, Monitor, Smartphone, Info, Radio, StopCircle } from 'lucide-react';
import { useAuthStore } from '@/stores/authStore';
import { useStreamStore } from '@/stores/streamStore';
import api from '@/lib/api';
import { cn } from '@/lib/utils';
import type { StreamKey } from '@/types';

export default function GoLive() {
  const { user, updateProfile } = useAuthStore();
  const { createStream, goLive, endStream, currentStream } = useStreamStore();
  const videoRef = useRef<HTMLVideoElement>(null);
  const [title, setTitle] = useState('');
  const [category, setCategory] = useState('');
  const [description, setDescription] = useState('');
  const [streamKeys, setStreamKeys] = useState<StreamKey[]>([]);
  const [isLive, setIsLive] = useState(false);
  const [cameraOn, setCameraOn] = useState(false);
  const [showOBSGuide, setShowOBSGuide] = useState(false);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState('');
  const [activeStreamId, setActiveStreamId] = useState<string | null>(null);

  // Fetch stream keys
  useEffect(() => {
    api.get('/stream-keys/me').then((res) => {
      setStreamKeys(res.data.keys || res.data || []);
    }).catch(() => {});
  }, []);

  // Start camera preview
  const startCamera = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        setCameraOn(true);
      }
    } catch {
      setMessage('Camera access denied. You can still stream via OBS.');
    }
  };

  const stopCamera = () => {
    if (videoRef.current?.srcObject) {
      (videoRef.current.srcObject as MediaStream).getTracks().forEach((t) => t.stop());
      videoRef.current.srcObject = null;
      setCameraOn(false);
    }
  };

  // Generate stream key
  const generateKey = async (label: string = 'OBS') => {
    try {
      const res = await api.post('/stream-keys/', { label });
      setStreamKeys((prev) => [...prev, res.data]);
      setMessage('Stream key generated!');
    } catch {
      setMessage('Failed to generate stream key');
    }
  };

  // Rotate stream key
  const rotateKey = async (keyId: string) => {
    try {
      const res = await api.post(`/stream-keys/${keyId}/rotate`);
      setStreamKeys((prev) => prev.map((k) => k.id === keyId ? res.data : k));
      setMessage('Stream key rotated!');
    } catch {
      setMessage('Failed to rotate key');
    }
  };

  // Go live
  const handleGoLive = async () => {
    if (!title.trim()) {
      setMessage('Please enter a stream title');
      return;
    }
    if (user?.role === 'user') {
      setMessage('You need to be a creator to go live. Upgrade your account in settings.');
      return;
    }

    setLoading(true);
    try {
      const stream = await createStream({ title, description: description || undefined, category: category || undefined });
      await goLive(stream.id);
      setActiveStreamId(stream.id);
      setIsLive(true);
      setMessage('You are now LIVE! Start streaming via OBS or your camera.');
    } catch (err: any) {
      setMessage(err?.response?.data?.detail || 'Failed to go live');
    } finally {
      setLoading(false);
    }
  };

  // End stream
  const handleEndStream = async () => {
    if (!activeStreamId) return;
    setLoading(true);
    try {
      await endStream(activeStreamId);
      setIsLive(false);
      setActiveStreamId(null);
      setMessage('Stream ended');
      stopCamera();
    } catch {
      setMessage('Failed to end stream');
    } finally {
      setLoading(false);
    }
  };

  // Copy to clipboard
  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text);
    setMessage('Copied to clipboard!');
  };

  const mediamtxHost = typeof window !== 'undefined' && window.location.hostname !== 'localhost'
    ? window.location.hostname
    : 'localhost';

  return (
    <div className="h-full overflow-y-auto scrollbar-thin p-6 max-w-4xl mx-auto">
      <h1 className="text-2xl font-bold text-white mb-6 flex items-center gap-2">
        <Video className="w-6 h-6 text-rogan-500" />
        Go Live
      </h1>

      {/* Message */}
      {message && (
        <div className="bg-white/5 border border-white/10 rounded-lg px-4 py-3 mb-4 text-sm text-white/80">
          {message}
          <button onClick={() => setMessage('')} className="float-right text-white/40 hover:text-white">×</button>
        </div>
      )}

      {isLive ? (
        /* Currently Live */
        <div className="space-y-6">
          <div className="bg-rogan-600/10 border border-rogan-500/20 rounded-xl p-6 flex items-center gap-4">
            <div className="w-12 h-12 rounded-full bg-rogan-600 flex items-center justify-center live-pulse">
              <Radio className="w-6 h-6 text-white" />
            </div>
            <div>
              <h2 className="text-white font-bold text-lg">You are LIVE!</h2>
              <p className="text-white/50 text-sm">Your stream is being broadcast to viewers</p>
            </div>
            <button
              onClick={handleEndStream}
              disabled={loading}
              className="ml-auto px-6 py-2.5 bg-red-600 hover:bg-red-700 text-white rounded-lg font-medium flex items-center gap-2 transition-colors"
            >
              <StopCircle className="w-5 h-5" />
              End Stream
            </button>
          </div>

          {/* Camera Preview */}
          <div className="bg-surface rounded-xl overflow-hidden border border-white/5">
            <video ref={videoRef} autoPlay playsInline muted className="w-full aspect-video bg-black object-cover" />
          </div>
        </div>
      ) : (
        /* Setup Stream */
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Left: Stream Setup */}
          <div className="space-y-4">
            <div className="bg-surface rounded-xl p-5 border border-white/5 space-y-4">
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
                placeholder="Category (e.g. Gaming, Music)"
                value={category}
                onChange={(e) => setCategory(e.target.value)}
                className="w-full bg-white/5 border border-white/10 rounded-lg px-4 py-3 text-sm text-white placeholder:text-white/30 focus:outline-none focus:border-rogan-500/50"
              />
              <textarea
                placeholder="Description (optional)"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                rows={3}
                className="w-full bg-white/5 border border-white/10 rounded-lg px-4 py-3 text-sm text-white placeholder:text-white/30 focus:outline-none focus:border-rogan-500/50 resize-none"
              />
              <div className="flex gap-3">
                <button
                  onClick={handleGoLive}
                  disabled={loading || !title.trim()}
                  className="flex-1 py-3 bg-rogan-600 hover:bg-rogan-700 disabled:bg-rogan-600/30 text-white font-semibold rounded-lg flex items-center justify-center gap-2 transition-colors"
                >
                  <Radio className="w-5 h-5" />
                  {loading ? 'Starting...' : 'Go Live'}
                </button>
                <button
                  onClick={cameraOn ? stopCamera : startCamera}
                  className="px-4 py-3 bg-white/5 hover:bg-white/10 text-white rounded-lg flex items-center gap-2 transition-colors"
                >
                  {cameraOn ? <StopCircle className="w-5 h-5" /> : <Video className="w-5 h-5" />}
                  {cameraOn ? 'Stop Camera' : 'Camera'}
                </button>
              </div>
            </div>

            {/* Camera Preview */}
            {(cameraOn || videoRef.current?.srcObject) && (
              <div className="bg-surface rounded-xl overflow-hidden border border-white/5">
                <video ref={videoRef} autoPlay playsInline muted className="w-full aspect-video bg-black object-cover" />
              </div>
            )}
          </div>

          {/* Right: Stream Keys & OBS Setup */}
          <div className="space-y-4">
            {/* Stream Keys */}
            <div className="bg-surface rounded-xl p-5 border border-white/5 space-y-4">
              <div className="flex items-center justify-between">
                <h3 className="text-white font-semibold flex items-center gap-2">
                  <Key className="w-4 h-4 text-tk" />
                  Stream Keys
                </h3>
                <div className="flex gap-2">
                  <button onClick={() => generateKey('OBS')} className="px-3 py-1.5 bg-white/5 hover:bg-white/10 text-white/70 text-xs rounded-lg flex items-center gap-1 transition-colors">
                    <Monitor className="w-3 h-3" /> OBS
                  </button>
                  <button onClick={() => generateKey('Phone')} className="px-3 py-1.5 bg-white/5 hover:bg-white/10 text-white/70 text-xs rounded-lg flex items-center gap-1 transition-colors">
                    <Smartphone className="w-3 h-3" /> Phone
                  </button>
                </div>
              </div>

              {streamKeys.length === 0 ? (
                <p className="text-white/30 text-sm text-center py-4">No stream keys yet. Generate one above.</p>
              ) : (
                <div className="space-y-2">
                  {streamKeys.map((key) => (
                    <div key={key.id} className="bg-white/5 rounded-lg p-3 flex items-center gap-3">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="text-white/60 text-xs">{key.label || 'Stream Key'}</span>
                          {key.is_active && <span className="text-green-400 text-[10px]">ACTIVE</span>}
                        </div>
                        <p className="text-white font-mono text-xs truncate">{key.key}</p>
                      </div>
                      <button onClick={() => copyToClipboard(key.key)} className="p-1.5 hover:bg-white/5 rounded text-white/40 hover:text-white transition-colors">
                        <Copy className="w-4 h-4" />
                      </button>
                      <button onClick={() => rotateKey(key.id)} className="p-1.5 hover:bg-white/5 rounded text-white/40 hover:text-white transition-colors">
                        <RefreshCw className="w-4 h-4" />
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* OBS Setup Guide */}
            <div className="bg-surface rounded-xl p-5 border border-white/5 space-y-3">
              <button
                onClick={() => setShowOBSGuide(!showOBSGuide)}
                className="w-full flex items-center justify-between text-white font-semibold"
              >
                <span className="flex items-center gap-2">
                  <Info className="w-4 h-4 text-blue-400" />
                  OBS Setup Guide
                </span>
                <span className="text-white/40">{showOBSGuide ? '▲' : '▼'}</span>
              </button>
              {showOBSGuide && (
                <div className="space-y-3 text-sm text-white/70">
                  <div className="bg-white/5 rounded-lg p-3">
                    <p className="text-white/90 font-medium mb-1">1. Open OBS Studio</p>
                    <p>Go to Settings → Stream</p>
                  </div>
                  <div className="bg-white/5 rounded-lg p-3">
                    <p className="text-white/90 font-medium mb-1">2. Set Server</p>
                    <code className="text-tk text-xs bg-black/30 px-2 py-1 rounded">rtmp://{mediamtxHost}:1935/live</code>
                  </div>
                  <div className="bg-white/5 rounded-lg p-3">
                    <p className="text-white/90 font-medium mb-1">3. Set Stream Key</p>
                    <p>Copy your stream key from above and paste it here</p>
                  </div>
                  <div className="bg-white/5 rounded-lg p-3">
                    <p className="text-white/90 font-medium mb-1">4. Start Streaming</p>
                    <p>Click &quot;Start Streaming&quot; in OBS — your stream will appear on Rogan Live!</p>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
