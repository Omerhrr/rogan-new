/**
 * Rogan Live v3 — PK Battle Store
 */

import { create } from 'zustand';
import api, { getErrorMessage } from '@/lib/api';
import type { PKBattle } from '@/types';

interface PKState {
  activeBattles: PKBattle[];
  currentBattle: PKBattle | null;
  isLoading: boolean;
  error: string | null;

  createBattle: (data: { creator_b_id: string; duration_minutes: number }) => Promise<PKBattle>;
  acceptBattle: (battleId: string) => Promise<void>;
  sendBattleGift: (battleId: string, data: { amount_tk: number; side: 'a' | 'b' }) => Promise<void>;
  endBattle: (battleId: string) => Promise<void>;
  fetchActiveBattles: () => Promise<void>;
  fetchBattle: (id: string) => Promise<void>;
  clearError: () => void;
}

export const usePKStore = create<PKState>()((set) => ({
  activeBattles: [],
  currentBattle: null,
  isLoading: false,
  error: null,

  createBattle: async (data) => {
    set({ isLoading: true, error: null });
    try {
      const res = await api.post<PKBattle>('/pk-battles/', data);
      set({ currentBattle: res.data, isLoading: false });
      return res.data;
    } catch (err) {
      set({ error: getErrorMessage(err), isLoading: false });
      throw err;
    }
  },

  acceptBattle: async (battleId: string) => {
    try {
      const res = await api.post(`/pk-battles/${battleId}/accept`);
      set({ currentBattle: res.data });
    } catch (err) {
      set({ error: getErrorMessage(err) });
      throw err;
    }
  },

  sendBattleGift: async (battleId: string, data) => {
    try {
      await api.post(`/pk-battles/${battleId}/gift`, data);
    } catch (err) {
      set({ error: getErrorMessage(err) });
      throw err;
    }
  },

  endBattle: async (battleId: string) => {
    try {
      const res = await api.post(`/pk-battles/${battleId}/end`);
      set({ currentBattle: res.data });
    } catch (err) {
      set({ error: getErrorMessage(err) });
      throw err;
    }
  },

  fetchActiveBattles: async () => {
    set({ isLoading: true, error: null });
    try {
      const res = await api.get('/pk-battles/active');
      set({ activeBattles: res.data.battles || res.data || [], isLoading: false });
    } catch (err) {
      set({ error: getErrorMessage(err), isLoading: false });
    }
  },

  fetchBattle: async (id: string) => {
    try {
      const res = await api.get(`/pk-battles/${id}`);
      set({ currentBattle: res.data });
    } catch (err) {
      set({ error: getErrorMessage(err) });
    }
  },

  clearError: () => set({ error: null }),
}));
