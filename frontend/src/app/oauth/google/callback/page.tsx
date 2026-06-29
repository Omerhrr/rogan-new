'use client';

import { Suspense, useEffect, useRef } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useAuthStore } from '@/stores/authStore';
import api from '@/lib/api';

function GoogleCallbackInner() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { setAuth } = useAuthStore();
  const handled = useRef(false);

  useEffect(() => {
    if (handled.current) return;
    handled.current = true;

    const code = searchParams.get('code');
    const state = searchParams.get('state');
    const error = searchParams.get('error');

    if (error || !code || !state) {
      router.replace('/?auth_error=' + (error || 'missing_params'));
      return;
    }

    api.get('/oauth/google/callback', { params: { code, state } })
      .then((res) => {
        const { user, token } = res.data;
        setAuth(user, token);
        router.replace('/');
      })
      .catch(() => {
        router.replace('/?auth_error=callback_failed');
      });
  }, [searchParams, router, setAuth]);

  return (
    <div className="min-h-screen bg-background flex items-center justify-center">
      <div className="flex flex-col items-center gap-4">
        <div className="w-8 h-8 border-2 border-rogan-500 border-t-transparent rounded-full animate-spin" />
        <p className="text-white/50 text-sm">Signing you in with Google…</p>
      </div>
    </div>
  );
}

export default function GoogleCallbackPage() {
  return (
    <Suspense fallback={
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="w-8 h-8 border-2 border-rogan-500 border-t-transparent rounded-full animate-spin" />
      </div>
    }>
      <GoogleCallbackInner />
    </Suspense>
  );
}
