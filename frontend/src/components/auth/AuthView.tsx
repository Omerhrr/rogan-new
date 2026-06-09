'use client';

import { useState, useEffect, useCallback } from 'react';
import { Radio, Mail, Lock, User, Eye, EyeOff, AlertCircle } from 'lucide-react';
import { useAuthStore } from '@/stores/authStore';
import { cn } from '@/lib/utils';

export default function AuthView() {
  const { login, register, googleLogin, getGoogleClientId, isLoading, error, clearError } = useAuthStore();
  const [mode, setMode] = useState<'login' | 'register'>('login');
  const [email, setEmail] = useState('');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [googleClientId, setGoogleClientId] = useState<string | null>(null);

  useEffect(() => {
    getGoogleClientId().then((id) => setGoogleClientId(id));
  }, [getGoogleClientId]);

  useEffect(() => {
    // Load Google Identity Services script
    if (googleClientId && !document.getElementById('google-identity-script')) {
      const script = document.createElement('script');
      script.id = 'google-identity-script';
      script.src = 'https://accounts.google.com/gsi/client';
      script.async = true;
      document.head.appendChild(script);
    }
  }, [googleClientId]);

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
    if (!googleClientId || !(window as any).google) return;

    try {
      (window as any).google.accounts.id.initialize({
        client_id: googleClientId,
        callback: (response: { credential: string }) => {
          if (response.credential) {
            googleLogin(response.credential);
          }
        },
      });
      (window as any).google.accounts.id.prompt();
    } catch {
      // Fallback: show Google OAuth URL
      window.location.href = `/api/v1/oauth/google/authorize`;
    }
  }, [googleClientId, googleLogin]);

  const switchMode = () => {
    clearError();
    setMode(mode === 'login' ? 'register' : 'login');
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
          {/* Tabs */}
          <div className="flex mb-6 bg-white/5 rounded-lg p-1">
            <button
              onClick={() => { clearError(); setMode('login'); }}
              className={cn(
                'flex-1 py-2 text-sm font-medium rounded-md transition-colors',
                mode === 'login' ? 'bg-rogan-600 text-white' : 'text-white/50 hover:text-white'
              )}
            >
              Sign In
            </button>
            <button
              onClick={() => { clearError(); setMode('register'); }}
              className={cn(
                'flex-1 py-2 text-sm font-medium rounded-md transition-colors',
                mode === 'register' ? 'bg-rogan-600 text-white' : 'text-white/50 hover:text-white'
              )}
            >
              Sign Up
            </button>
          </div>

          {/* Error */}
          {error && (
            <div className="flex items-center gap-2 bg-red-500/10 border border-red-500/20 rounded-lg px-4 py-3 mb-4">
              <AlertCircle className="w-4 h-4 text-red-400 flex-shrink-0" />
              <p className="text-red-400 text-sm">{error}</p>
            </div>
          )}

          {/* Form */}
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
                minLength={6}
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

          {/* Divider */}
          <div className="flex items-center gap-3 my-5">
            <div className="flex-1 h-px bg-white/10" />
            <span className="text-white/30 text-xs">or</span>
            <div className="flex-1 h-px bg-white/10" />
          </div>

          {/* Google Sign In */}
          <button
            onClick={handleGoogleSignIn}
            disabled={!googleClientId || isLoading}
            className="w-full py-3 bg-white hover:bg-white/90 disabled:bg-white/50 text-gray-900 font-medium rounded-lg transition-colors flex items-center justify-center gap-2 text-sm"
          >
            <svg className="w-5 h-5" viewBox="0 0 24 24">
              <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z" />
              <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" />
              <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" />
              <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" />
            </svg>
            {googleClientId ? 'Sign in with Google' : 'Google OAuth not configured'}
          </button>
        </div>

        {/* Footer */}
        <p className="text-center text-white/20 text-xs mt-6">
          By continuing, you agree to the Rogan Live Terms of Service
        </p>
      </div>
    </div>
  );
}
