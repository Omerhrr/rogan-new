'use client';

/**
 * CreatorOnboardingModal
 *
 * Shows automatically the first time a user's role is "creator".
 * Guides them through 4 steps:
 *   1. Welcome — role confirmed
 *   2. Generate stream key
 *   3. OBS setup guide
 *   4. Done
 *
 * localStorage key: rogan_onboarding_done_{userId}
 * Once they dismiss on the final step the key is set and the modal won't show again.
 */

import { useState, useEffect, useCallback } from 'react';
import { CheckCircle2, Key, Radio, Tv2, Copy, Check, X, ChevronRight } from 'lucide-react';
import { useAuthStore } from '@/stores/authStore';
import api from '@/lib/api';
import { cn } from '@/lib/utils';

interface Props {
  open: boolean;
  onClose: () => void;
}

const STEPS = ['welcome', 'stream-key', 'obs-guide', 'done'] as const;
type Step = typeof STEPS[number];

export default function CreatorOnboardingModal({ open, onClose }: Props) {
  const { user } = useAuthStore();
  const [step, setStep] = useState<Step>('welcome');
  const [streamKey, setStreamKey] = useState<string | null>(null);
  const [streamKeyLoading, setStreamKeyLoading] = useState(false);
  const [copied, setCopied] = useState<'key' | 'server' | null>(null);

  const RTMP_SERVER = 'rtmp://localhost:1935';

  const fetchOrCreateStreamKey = useCallback(async () => {
    if (streamKey) return;
    setStreamKeyLoading(true);
    try {
      // GET /stream-keys/me — list existing keys for the current user
      const res = await api.get('/stream-keys/me');
      const keys: any[] = res.data.keys || [];
      const active = keys.find((k) => k.is_active);
      if (active) {
        setStreamKey(active.key);
      } else {
        // POST /stream-keys — generate a new one
        const created = await api.post('/stream-keys', { label: 'My Stream' });
        setStreamKey(created.data.key);
      }
    } catch {
      // Fallback: just try to generate one
      try {
        const created = await api.post('/stream-keys', { label: 'My Stream' });
        setStreamKey(created.data.key);
      } catch {
        setStreamKey('(could not generate — open Creator Dashboard)');
      }
    } finally {
      setStreamKeyLoading(false);
    }
  }, [streamKey]);

  // Auto-fetch stream key when the user reaches step 2
  useEffect(() => {
    if (step === 'stream-key') {
      fetchOrCreateStreamKey();
    }
  }, [step, fetchOrCreateStreamKey]);

  const copyToClipboard = async (text: string, which: 'key' | 'server') => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(which);
      setTimeout(() => setCopied(null), 2000);
    } catch {
      // ignore
    }
  };

  const next = () => {
    const idx = STEPS.indexOf(step);
    if (idx < STEPS.length - 1) setStep(STEPS[idx + 1]);
  };

  const handleClose = () => {
    if (user?.id) {
      localStorage.setItem(`rogan_onboarding_done_${user.id}`, '1');
    }
    onClose();
  };

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm">
      <div className="w-full max-w-lg bg-surface rounded-2xl border border-white/10 shadow-2xl overflow-hidden">
        {/* Header */}
        <div className="bg-gradient-to-r from-rogan-600/30 to-amber-600/20 px-6 py-5 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-rogan-600 flex items-center justify-center">
              <Radio className="w-5 h-5 text-white" />
            </div>
            <div>
              <h2 className="text-white font-bold text-lg">Creator Setup</h2>
              <p className="text-white/50 text-xs">Step {STEPS.indexOf(step) + 1} of {STEPS.length}</p>
            </div>
          </div>
          <button onClick={handleClose} className="text-white/30 hover:text-white/70 transition-colors">
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Progress dots */}
        <div className="flex gap-1.5 px-6 py-3 bg-white/[0.02]">
          {STEPS.map((s) => (
            <div
              key={s}
              className={cn(
                'h-1 flex-1 rounded-full transition-colors duration-300',
                STEPS.indexOf(s) <= STEPS.indexOf(step) ? 'bg-rogan-500' : 'bg-white/10'
              )}
            />
          ))}
        </div>

        {/* Content */}
        <div className="px-6 py-6 min-h-[280px]">
          {/* ── Step 1: Welcome ── */}
          {step === 'welcome' && (
            <div className="flex flex-col items-center text-center gap-4">
              <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-rogan-500 to-amber-500 flex items-center justify-center shadow-lg shadow-rogan-500/30">
                <CheckCircle2 className="w-8 h-8 text-white" />
              </div>
              <h3 className="text-white text-xl font-bold">You&apos;re a Creator!</h3>
              <p className="text-white/60 text-sm leading-relaxed max-w-sm">
                Your account has been upgraded. You can now go live, earn TK from gifts, and accept paid DMs.
                Let&apos;s get you set up in 3 quick steps.
              </p>
              <ul className="text-left w-full bg-white/[0.03] rounded-xl p-4 space-y-2.5 border border-white/5">
                {[
                  ['Get your stream key', 'Used to authenticate with OBS'],
                  ['Configure OBS', 'Point OBS at Rogan Live\'s RTMP server'],
                  ['Go live', 'Hit "Start Streaming" in OBS — you\'re live!'],
                ].map(([title, desc], i) => (
                  <li key={i} className="flex items-start gap-3">
                    <span className="w-5 h-5 rounded-full bg-rogan-600/20 text-rogan-400 text-xs flex items-center justify-center flex-shrink-0 mt-0.5 font-bold">
                      {i + 1}
                    </span>
                    <div>
                      <p className="text-white/80 text-sm font-medium">{title}</p>
                      <p className="text-white/40 text-xs">{desc}</p>
                    </div>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* ── Step 2: Stream Key ── */}
          {step === 'stream-key' && (
            <div className="flex flex-col gap-5">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-amber-500/20 flex items-center justify-center">
                  <Key className="w-5 h-5 text-amber-400" />
                </div>
                <div>
                  <h3 className="text-white font-bold">Your Stream Key</h3>
                  <p className="text-white/50 text-xs">Paste this into OBS as the &quot;Stream Key&quot;</p>
                </div>
              </div>

              <div className="bg-white/[0.03] border border-white/10 rounded-xl p-4 space-y-3">
                <div>
                  <label className="text-white/40 text-xs uppercase tracking-wider mb-1.5 block">RTMP Server</label>
                  <div className="flex items-center gap-2">
                    <code className="flex-1 bg-black/30 text-green-400 text-xs px-3 py-2 rounded-lg font-mono overflow-hidden text-ellipsis whitespace-nowrap">
                      {RTMP_SERVER}
                    </code>
                    <button
                      onClick={() => copyToClipboard(RTMP_SERVER, 'server')}
                      className="p-2 rounded-lg bg-white/5 hover:bg-white/10 text-white/40 hover:text-white transition-colors"
                    >
                      {copied === 'server' ? <Check className="w-4 h-4 text-green-400" /> : <Copy className="w-4 h-4" />}
                    </button>
                  </div>
                </div>
                <div>
                  <label className="text-white/40 text-xs uppercase tracking-wider mb-1.5 block">Stream Key</label>
                  {streamKeyLoading ? (
                    <div className="flex items-center gap-2 px-3 py-2">
                      <div className="w-4 h-4 border-2 border-rogan-500 border-t-transparent rounded-full animate-spin" />
                      <span className="text-white/30 text-xs">Generating...</span>
                    </div>
                  ) : (
                    <div className="flex items-center gap-2">
                      <code className="flex-1 bg-black/30 text-rogan-300 text-xs px-3 py-2 rounded-lg font-mono overflow-hidden text-ellipsis whitespace-nowrap">
                        {streamKey || '—'}
                      </code>
                      {streamKey && (
                        <button
                          onClick={() => copyToClipboard(streamKey, 'key')}
                          className="p-2 rounded-lg bg-white/5 hover:bg-white/10 text-white/40 hover:text-white transition-colors"
                        >
                          {copied === 'key' ? <Check className="w-4 h-4 text-green-400" /> : <Copy className="w-4 h-4" />}
                        </button>
                      )}
                    </div>
                  )}
                </div>
              </div>

              <p className="text-white/30 text-xs flex items-start gap-1.5">
                <span className="text-amber-400">⚠</span>
                Keep your stream key private. Anyone with this key can stream on your account.
                You can regenerate it anytime from the Creator Dashboard.
              </p>
            </div>
          )}

          {/* ── Step 3: OBS Guide ── */}
          {step === 'obs-guide' && (
            <div className="flex flex-col gap-4">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-purple-500/20 flex items-center justify-center">
                  <Tv2 className="w-5 h-5 text-purple-400" />
                </div>
                <div>
                  <h3 className="text-white font-bold">Configure OBS</h3>
                  <p className="text-white/50 text-xs">Takes less than 2 minutes</p>
                </div>
              </div>

              <ol className="space-y-3">
                {[
                  { n: 1, text: 'Open OBS Studio → Settings → Stream' },
                  { n: 2, text: 'Set Service to Custom...' },
                  { n: 3, text: `Set Server to ${RTMP_SERVER}` },
                  { n: 4, text: 'Paste your Stream Key from the previous step' },
                  { n: 5, text: 'Click Apply → OK' },
                  { n: 6, text: 'Click Start Streaming — you\'re live on Rogan!' },
                ].map(({ n, text }) => (
                  <li key={n} className="flex items-start gap-3 text-sm">
                    <span className="w-6 h-6 rounded-full bg-rogan-600/20 border border-rogan-600/30 text-rogan-400 text-xs flex items-center justify-center flex-shrink-0 mt-0.5 font-bold">
                      {n}
                    </span>
                    <span className="text-white/70 leading-relaxed">{text}</span>
                  </li>
                ))}
              </ol>

              <div className="bg-rogan-600/10 border border-rogan-600/20 rounded-xl p-3">
                <p className="text-rogan-300 text-xs">
                  Alternatively, use the browser webcam option in the Go Live view — no OBS required.
                </p>
              </div>
            </div>
          )}

          {/* ── Step 4: Done ── */}
          {step === 'done' && (
            <div className="flex flex-col items-center text-center gap-5">
              <div className="relative">
                <div className="w-20 h-20 rounded-full bg-gradient-to-br from-green-500 to-emerald-400 flex items-center justify-center shadow-lg shadow-green-500/30">
                  <CheckCircle2 className="w-10 h-10 text-white" />
                </div>
                <div className="absolute -top-1 -right-1 w-8 h-8 rounded-full bg-rogan-600 flex items-center justify-center">
                  <Radio className="w-4 h-4 text-white" />
                </div>
              </div>
              <div>
                <h3 className="text-white text-2xl font-bold mb-2">You&apos;re all set!</h3>
                <p className="text-white/50 text-sm leading-relaxed max-w-sm">
                  Start OBS and hit Start Streaming whenever you&apos;re ready. Your stream will
                  appear live on Rogan automatically.
                </p>
              </div>
              <div className="w-full bg-white/[0.03] border border-white/5 rounded-xl p-4 space-y-2 text-left">
                <p className="text-white/50 text-xs font-semibold uppercase tracking-wider">What&apos;s next</p>
                <p className="text-white/70 text-sm">• Open <strong className="text-white">Creator Dashboard</strong> to track earnings &amp; analytics</p>
                <p className="text-white/70 text-sm">• Set up <strong className="text-white">paid DMs &amp; subscriptions</strong> in Settings</p>
                <p className="text-white/70 text-sm">• Browse the <strong className="text-white">Task Marketplace</strong> for paid requests</p>
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-6 pb-6 flex items-center justify-between gap-3">
          <button
            onClick={handleClose}
            className="text-white/30 text-sm hover:text-white/60 transition-colors"
          >
            {step === 'done' ? 'Close' : 'Skip setup'}
          </button>

          {step !== 'done' ? (
            <button
              onClick={next}
              className="flex items-center gap-2 px-5 py-2.5 bg-rogan-600 hover:bg-rogan-700 text-white text-sm font-semibold rounded-xl transition-colors"
            >
              {step === 'obs-guide' ? "I'm ready" : 'Next'}
              <ChevronRight className="w-4 h-4" />
            </button>
          ) : (
            <button
              onClick={handleClose}
              className="flex items-center gap-2 px-5 py-2.5 bg-gradient-to-r from-rogan-600 to-amber-600 hover:opacity-90 text-white text-sm font-bold rounded-xl transition-opacity"
            >
              <Radio className="w-4 h-4" />
              Go Live Now
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
