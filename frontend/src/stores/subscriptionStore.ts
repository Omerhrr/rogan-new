/**
 * Rogan Live v3 — Subscription Store
 */

import { create } from 'zustand';
import api, { getErrorMessage } from '@/lib/api';
import type { SubscriptionTier, Subscription } from '@/types';

interface SubscriptionState {
  tiers: SubscriptionTier[];
  mySubscriptions: Subscription[];
  mySubscribers: Subscription[];
  isLoading: boolean;
  error: string | null;

  fetchTiers: (creatorId: string) => Promise<void>;
  createTier: (data: { name: string; price_tk: number; perks?: string[] }) => Promise<void>;
  subscribe: (data: { creator_id: string; tier?: string; tier_id?: string }) => Promise<void>;
  fetchMySubscriptions: () => Promise<void>;
  fetchMySubscribers: () => Promise<void>;
  cancelSubscription: (id: string) => Promise<void>;
  clearError: () => void;
}

export const useSubscriptionStore = create<SubscriptionState>()((set) => ({
  tiers: [],
  mySubscriptions: [],
  mySubscribers: [],
  isLoading: false,
  error: null,

  fetchTiers: async (creatorId: string) => {
    set({ isLoading: true, error: null });
    try {
      const res = await api.get(`/subscriptions/tiers/${creatorId}`);
      set({ tiers: res.data.tiers || res.data || [], isLoading: false });
    } catch (err) {
      set({ error: getErrorMessage(err), isLoading: false });
    }
  },

  createTier: async (data) => {
    set({ isLoading: true, error: null });
    try {
      await api.post('/subscriptions/tiers/', data);
      set({ isLoading: false });
    } catch (err) {
      set({ error: getErrorMessage(err), isLoading: false });
      throw err;
    }
  },

  subscribe: async (data) => {
    set({ isLoading: true, error: null });
    try {
      await api.post('/subscriptions/subscribe/', data);
      set({ isLoading: false });
    } catch (err) {
      set({ error: getErrorMessage(err), isLoading: false });
      throw err;
    }
  },

  fetchMySubscriptions: async () => {
    set({ isLoading: true, error: null });
    try {
      const res = await api.get('/subscriptions/me');
      set({ mySubscriptions: res.data.subscriptions || res.data || [], isLoading: false });
    } catch (err) {
      set({ error: getErrorMessage(err), isLoading: false });
    }
  },

  fetchMySubscribers: async () => {
    set({ isLoading: true, error: null });
    try {
      const res = await api.get('/subscriptions/creators/me/subscribers');
      set({ mySubscribers: res.data.subscribers || res.data || [], isLoading: false });
    } catch (err) {
      set({ error: getErrorMessage(err), isLoading: false });
    }
  },

  cancelSubscription: async (id: string) => {
    try {
      await api.delete(`/subscriptions/${id}`);
      set((state) => ({
        mySubscriptions: state.mySubscriptions.map((s) =>
          s.id === id ? { ...s, is_active: false, status: 'cancelled' } : s
        ),
      }));
    } catch (err) {
      set({ error: getErrorMessage(err) });
      throw err;
    }
  },

  clearError: () => set({ error: null }),
}));
