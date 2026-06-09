/**
 * Rogan Live v3 — Auth Store
 * Manages authentication state: login, register, Google OAuth, profile.
 */

import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import api, { getErrorMessage } from '@/lib/api';
import type { User, LoginRequest, RegisterRequest, UpdateProfileRequest } from '@/types';

interface AuthState {
  user: User | null;
  token: string | null;
  isAuthenticated: boolean;
  isLoading: boolean;
  error: string | null;

  login: (data: LoginRequest) => Promise<void>;
  register: (data: RegisterRequest) => Promise<void>;
  googleLogin: (googleToken: string) => Promise<void>;
  logout: () => void;
  checkAuth: () => Promise<void>;
  updateProfile: (data: UpdateProfileRequest) => Promise<void>;
  getGoogleClientId: () => Promise<string | null>;
  clearError: () => void;
}

export const useAuthStore = create<AuthState>()(
  persist(
    (set, get) => ({
      user: null,
      token: null,
      isAuthenticated: false,
      isLoading: false,
      error: null,

      login: async (data: LoginRequest) => {
        set({ isLoading: true, error: null });
        try {
          const res = await api.post('/auth/login', data);
          const { user, token } = res.data;
          localStorage.setItem('rogan_token', token);
          set({ user, token, isAuthenticated: true, isLoading: false });
        } catch (err) {
          set({ error: getErrorMessage(err), isLoading: false });
          throw err;
        }
      },

      register: async (data: RegisterRequest) => {
        set({ isLoading: true, error: null });
        try {
          const res = await api.post('/auth/register', data);
          const { user, token } = res.data;
          localStorage.setItem('rogan_token', token);
          set({ user, token, isAuthenticated: true, isLoading: false });
        } catch (err) {
          set({ error: getErrorMessage(err), isLoading: false });
          throw err;
        }
      },

      googleLogin: async (googleToken: string) => {
        set({ isLoading: true, error: null });
        try {
          const res = await api.post('/auth/google', { google_token: googleToken });
          const { user, token } = res.data;
          localStorage.setItem('rogan_token', token);
          set({ user, token, isAuthenticated: true, isLoading: false });
        } catch (err) {
          set({ error: getErrorMessage(err), isLoading: false });
          throw err;
        }
      },

      logout: () => {
        localStorage.removeItem('rogan_token');
        localStorage.removeItem('rogan_user');
        set({ user: null, token: null, isAuthenticated: false, error: null });
      },

      checkAuth: async () => {
        const token = get().token || localStorage.getItem('rogan_token');
        if (!token) {
          set({ isAuthenticated: false, user: null, token: null });
          return;
        }
        try {
          const res = await api.get('/auth/me');
          set({ user: res.data, token, isAuthenticated: true });
        } catch {
          localStorage.removeItem('rogan_token');
          set({ user: null, token: null, isAuthenticated: false });
        }
      },

      updateProfile: async (data: UpdateProfileRequest) => {
        set({ isLoading: true, error: null });
        try {
          const res = await api.put('/auth/me', data);
          set({ user: res.data, isLoading: false });
        } catch (err) {
          set({ error: getErrorMessage(err), isLoading: false });
          throw err;
        }
      },

      getGoogleClientId: async () => {
        try {
          const res = await api.get('/auth/google-client-id');
          return res.data.client_id as string;
        } catch {
          return null;
        }
      },

      clearError: () => set({ error: null }),
    }),
    {
      name: 'rogan-auth',
      partialize: (state) => ({
        user: state.user,
        token: state.token,
        isAuthenticated: state.isAuthenticated,
      }),
    }
  )
);

// Listen for unauthorized events from the API interceptor
if (typeof window !== 'undefined') {
  window.addEventListener('auth:unauthorized', () => {
    useAuthStore.getState().logout();
  });
}
