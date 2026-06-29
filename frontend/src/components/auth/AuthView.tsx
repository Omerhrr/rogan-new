'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { Radio, Mail, Lock, User, Eye, EyeOff, AlertCircle, CheckCircle2 } from 'lucide-react';
import { useAuthStore } from '@/stores/authStore';
import api from '@/lib/api';
import { cn } from '@/lib/utils';

type AuthMode = 'login' | 'register' | 'forgot' | 'reset';

export default function AuthView() {
  const { login, register, googleLogin, getGoogleClientId, isLoading, error, clearError } = useAuthStore();
  const [mode, setMode] = useState<AuthMode>('login');
  const [email, setEmail] = useState('');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [googleClientId, setGoogleClientId] = useState<string | null>(null);
  const googleInitialized = useRef(false);
  // Password reset state
  const [resetToken, setResetToken] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [resetMsg, setResetMsg] = useState<string | null>(null);
  const [resetError, setResetError] = useState<string | null>(null);
  const [resetLoading, setResetLoading] = useState(false);

  useEffect(() => {
    getGoogleClientId().then((id) => setGoogleClientId(id));
  }, [getGoogleClientId]);

  useEffect(() => {
    if (!googleClientId) return;

    const initGoogle = () => {
      if (googleInitialized.current) return;
      const g = (window as any).google;
      if (!g?.accounts?.id) return;
      g.accounts.id.initialize({
        client_id: googleClientId,
        callback: (response: { credential: string }) => {
          if (response.credential) googleLogin(response.credential);
        },
        // Disable automatic One Tap prompt — we control it manually
        auto_select: false,
        cancel_on_tap_outside: true,
      });
      googleInitialized.current = true;
    };

    // Script may already be loaded (hot-reload) or needs to be injected
    if ((window as any).google?.accounts?.id) {
      initGoogle();
    } else if (!document.getElementById('google-identity-script')) {
      const script = document.createElement('script');
      script.id = 'google-identity-script';
      script.src = 'https://accounts.google.com/gsi/client';
      script.async = true;
      script.onload = initGoogle;
      document.head.appendChild(script);
    } else {
      // Script tag exists but not loaded yet — wait for it
      const existing = document.getElementById('google-identity-script') as HTMLScriptElement;
      existing.addEventListener('load', initGoogle);
    }
  }, [googleClientId, googleLogin]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      if (mode === 'login') {
        await login({ email, password });
      } else {
        await register({ email, username, password });
      }
    } catch {
      // Error is handled by store
    }
  };

  const handleGoogleSignIn = useCallback(() => {
    if (!googleClientId) return;
    const g = (window as any).google;
    if (!g?.accounts?.id) return;
    // Cancel any in-flight request before starting a new one
    try { g.accounts.id.cancel(); } catch {}
    const fallbackToRedirect = async () => {
      try {
        const res = await api.get('/oauth/google/authorize');
        window.location.href = res.data.authorize_url;
      } catch {
        // If backend is unreachable, nothing we can do
      }
    };

    try {
      g.accounts.id.prompt((notification: any) => {
        if (notification.isNotDisplayed() || notification.isSkippedMoment()) {
          fallbackToRedirect();
        }
      });
    } catch {
      fallbackToRedirect();
    }
  }, [googleClientId]);

  const switchMode = (next: AuthMode) => {
    clearError();
    setResetMsg(null);
    setResetError(null);
    setMode(next);
  };

  const handleForgotPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    setResetLoading(true);
    setResetError(null);
    setResetMsg(null);
    try {
      const res = await api.post('/auth/forgot-password', { email });
      // In dev the token is returned; populate the token field automatically
      if (res.data.reset_token) setResetToken(res.data.reset_token);
      setResetMsg('Reset token sent. Enter it below with your new password.');
      setMode('reset');
    } catch (err: any) {
      const d = err?.response?.data?.detail;
      setResetError((Array.isArray(d) ? d.map((e: any) => e.msg).join('; ') : d) || 'Failed to send reset token');
    } finally {
      setResetLoading(false);
    }
  };

  const handleResetPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    setResetLoading(true);
    setResetError(null);
    try {
      await api.post('/auth/reset-password', { token: resetToken, new_password: newPassword });
      setResetMsg('Password updated! You can now sign in.');
      setMode('login');
    } catch (err: any) {
      const d = err?.response?.data?.detail;
      setResetError((Array.isArray(d) ? d.map((e: any) => e.msg).join('; ') : d) || 'Reset failed — token may have expired');
    } finally {
      setResetLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-surface-dark flex items-center justify-center p-4">
      <div className="w-full max-w-md">
        {/* Logo */}
        <div className="flex flex-col items-center mb-8">
          <div className="w-16 h-16 rounded-2xl bg-rogan-600 flex items-center justify-center mb-4 shadow-lg shadow-rogan-600/30">
            <Radio className="w-8 h-8 text-white" />
          </div>
          <h1 className="text-3xl font-bold text-white">Rogan Live</h1>
          <p className="text-white/40 text-sm mt-1">Stream. Earn. Connect.</p>
        </div>

        {/* Card */}
        <div className="bg-surface rounded-2xl p-6 border border-white/5 shadow-xl">
          {/* Tabs — hide on reset/forgot screens */}
          {(mode === 'login' || mode === 'register') && (
            <div className="flex mb-6 bg-white/5 rounded-lg p-1">
              <button
                onClick={() => switchMode('login')}
                className={cn(
                  'flex-1 py-2 text-sm font-medium rounded-md transition-colors',
                  mode === 'login' ? 'bg-rogan-600 text-white' : 'text-white/50 hover:text-white'
                )}
              >
                Sign In
              </button>
              <button
                onClick={() => switchMode('register')}
                className={cn(
                  'flex-1 py-2 text-sm font-medium rounded-md transition-colors',
                  mode === 'register' ? 'bg-rogan-600 text-white' : 'text-white/50 hover:text-white'
                )}
              >
                Sign Up
              </button>
            </div>
          )}

          {/* Reset success message */}
          {resetMsg && mode === 'login' && (
            <div className="flex items-center gap-2 bg-green-500/10 border border-green-500/20 rounded-lg px-4 py-3 mb-4">
              <CheckCircle2 className="w-4 h-4 text-green-400 flex-shrink-0" />
              <p className="text-green-400 text-sm">{resetMsg}</p>
            </div>
          )}

          {/* Error (auth store) */}
          {error && (
            <div className="flex items-center gap-2 bg-red-500/10 border border-red-500/20 rounded-lg px-4 py-3 mb-4">
              <AlertCircle className="w-4 h-4 text-red-400 flex-shrink-0" />
              <p className="text-red-400 text-sm">{error}</p>
            </div>
          )}

          {/* ── Forgot Password form ───────────────────────── */}
          {mode === 'forgot' && (
            <form onSubmit={handleForgotPassword} className="space-y-4">
              <div>
                <h2 className="text-white font-semibold text-lg mb-1">Reset your password</h2>
                <p className="text-white/40 text-sm">Enter your email and we'll send you a reset token.</p>
              </div>
              {resetError && (
                <div className="flex items-center gap-2 bg-red-500/10 border border-red-500/20 rounded-lg px-4 py-3">
                  <AlertCircle className="w-4 h-4 text-red-400 flex-shrink-0" />
                  <p className="text-red-400 text-sm">{resetError}</p>
                </div>
              )}
              <div className="relative">
                <Mail className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-white/30" />
                <input
                  type="email"
                  placeholder="Email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                  className="w-full bg-white/5 border border-white/10 rounded-lg pl-10 pr-4 py-3 text-sm text-white placeholder:text-white/30 focus:outline-none focus:border-rogan-500/50 focus:ring-1 focus:ring-rogan-500/25 transition-colors"
                />
              </div>
              <button
                type="submit"
                disabled={resetLoading}
                className="w-full py-3 bg-rogan-600 hover:bg-rogan-700 disabled:bg-rogan-600/50 text-white font-semibold rounded-lg transition-colors flex items-center justify-center gap-2"
              >
                {resetLoading ? <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" /> : 'Send Reset Token'}
              </button>
              <button type="button" onClick={() => switchMode('login')} className="w-full text-white/40 text-sm hover:text-white/70 transition-colors">
                Back to Sign In
              </button>
            </form>
          )}

          {/* ── Reset Password form ────────────────────────── */}
          {mode === 'reset' && (
            <form onSubmit={handleResetPassword} className="space-y-4">
              <div>
                <h2 className="text-white font-semibold text-lg mb-1">Enter new password</h2>
                {resetMsg && <p className="text-green-400 text-sm">{resetMsg}</p>}
              </div>
              {resetError && (
                <div className="flex items-center gap-2 bg-red-500/10 border border-red-500/20 rounded-lg px-4 py-3">
                  <AlertCircle className="w-4 h-4 text-red-400 flex-shrink-0" />
                  <p className="text-red-400 text-sm">{resetError}</p>
                </div>
              )}
              <div className="relative">
                <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-white/30" />
                <input
                  type="text"
                  placeholder="Reset token"
                  value={resetToken}
                  onChange={(e) => setResetToken(e.target.value)}
                  required
                  className="w-full bg-white/5 border border-white/10 rounded-lg pl-10 pr-4 py-3 text-sm text-white placeholder:text-white/30 focus:outline-none focus:border-rogan-500/50 focus:ring-1 focus:ring-rogan-500/25 transition-colors font-mono text-xs"
                />
              </div>
              <div className="relative">
                <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-white/30" />
                <input
                  type={showPassword ? 'text' : 'password'}
                  placeholder="New password (min 8 chars)"
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  required
                  minLength={8}
                  className="w-full bg-white/5 border border-white/10 rounded-lg pl-10 pr-10 py-3 text-sm text-white placeholder:text-white/30 focus:outline-none focus:border-rogan-500/50 focus:ring-1 focus:ring-rogan-500/25 transition-colors"
                />
                <button type="button" onClick={() => setShowPassword(!showPassword)} className="absolute right-3 top-1/2 -translate-y-1/2 text-white/30 hover:text-white/60 transition-colors">
                  {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
              <button
                type="submit"
                disabled={resetLoading}
                className="w-full py-3 bg-rogan-600 hover:bg-rogan-700 disabled:bg-rogan-600/50 text-white font-semibold rounded-lg transition-colors flex items-center justify-center gap-2"
              >
                {resetLoading ? <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" /> : 'Set New Password'}
              </button>
              <button type="button" onClick={() => switchMode('login')} className="w-full text-white/40 text-sm hover:text-white/70 transition-colors">
                Back to Sign In
              </button>
            </form>
          )}

          {/* ── Login / Register form ──────────────────────── */}
          {(mode === 'login' || mode === 'register') && (
            <>
              <form onSubmit={handleSubmit} className="space-y-4">
                {mode === 'register' && (
                  <div className="relative">
                    <User className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-white/30" />
                    <input
                      type="text"
                      placeholder="Username"
                      value={username}
                      onChange={(e) => setUsername(e.target.value)}
                      required
                      minLength={3}
                      className="w-full bg-white/5 border border-white/10 rounded-lg pl-10 pr-4 py-3 text-sm text-white placeholder:text-white/30 focus:outline-none focus:border-rogan-500/50 focus:ring-1 focus:ring-rogan-500/25 transition-colors"
                    />
                  </div>
                )}

                <div className="relative">
                  <Mail className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-white/30" />
                  <input
                    type="email"
                    placeholder="Email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    required
                    className="w-full bg-white/5 border border-white/10 rounded-lg pl-10 pr-4 py-3 text-sm text-white placeholder:text-white/30 focus:outline-none focus:border-rogan-500/50 focus:ring-1 focus:ring-rogan-500/25 transition-colors"
                  />
                </div>

                <div className="relative">
                  <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-white/30" />
                  <input
                    type={showPassword ? 'text' : 'password'}
                    placeholder="Password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    required
                    minLength={8}
                    className="w-full bg-white/5 border border-white/10 rounded-lg pl-10 pr-10 py-3 text-sm text-white placeholder:text-white/30 focus:outline-none focus:border-rogan-500/50 focus:ring-1 focus:ring-rogan-500/25 transition-colors"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword(!showPassword)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-white/30 hover:text-white/60 transition-colors"
                  >
                    {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>

                {mode === 'login' && (
                  <button
                    type="button"
                    onClick={() => switchMode('forgot')}
                    className="text-rogan-400 text-xs hover:text-rogan-300 transition-colors w-full text-right"
                  >
                    Forgot password?
                  </button>
                )}

                <button
                  type="submit"
                  disabled={isLoading}
                  className="w-full py-3 bg-rogan-600 hover:bg-rogan-700 disabled:bg-rogan-600/50 text-white font-semibold rounded-lg transition-colors flex items-center justify-center gap-2"
                >
                  {isLoading ? (
                    <>
                      <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                      {mode === 'login' ? 'Signing in...' : 'Creating account...'}
                    </>
                  ) : (
                    mode === 'login' ? 'Sign In' : 'Create Account'
                  )}
                </button>
              </form>

              {/* Google Sign In — only shown when GOOGLE_CLIENT_ID is configured */}
              {googleClientId && (
                <>
                  <div className="flex items-center gap-3 my-5">
                    <div className="flex-1 h-px bg-white/10" />
                    <span className="text-white/30 text-xs">or</span>
                    <div className="flex-1 h-px bg-white/10" />
                  </div>
                  <button
                    onClick={handleGoogleSignIn}
                    disabled={isLoading}
                    className="w-full py-3 bg-white hover:bg-white/90 disabled:opacity-60 text-gray-900 font-medium rounded-lg transition-colors flex items-center justify-center gap-2 text-sm"
                  >
                    <svg className="w-5 h-5" viewBox="0 0 24 24">
                      <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z" />
                      <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" />
                      <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" />
                      <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" />
                    </svg>
                    Sign in with Google
                  </button>
                </>
              )}
            </>
          )}
        </div>

        {/* Footer */}
        <p className="text-white/30 text-xs text-center mt-4">
          By continuing you agree to our Terms of Service and Privacy Policy.
        </p>
      </div>
    </div>
  );
}
