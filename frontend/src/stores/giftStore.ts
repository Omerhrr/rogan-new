/**
 * Rogan Live v3 — Gift Store
 */

import { create } from 'zustand';
import api, { getErrorMessage } from '@/lib/api';
import type { GiftType, SendGiftResponse } from '@/types';
import { GIFT_CONFIG } from '@/types';

interface GiftState {
  giftStats: { total_received: number; total_tk: number; by_type: Record<string, number> } | null;
  streamGifts: { id: string; gift_type: GiftType; amount: number; sender_id: string; created_at: string }[];
  isSending: boolean;
  error: string | null;

  sendGift: (data: { stream_id: string; gift_type: GiftType; message?: string }) => Promise<SendGiftResponse | null>;
  fetchGiftStats: (creatorId: string) => Promise<void>;
  fetchStreamGifts: (streamId: string) => Promise<void>;
  clearError: () => void;
}

export const useGiftStore = create<GiftState>()((set) => ({
  giftStats: null,
  streamGifts: [],
  isSending: false,
  error: null,

  sendGift: async (data) => {
    set({ isSending: true, error: null });
    try {
      const res = await api.post<SendGiftResponse>('/gifts/send', data);
      set({ isSending: false });
      return res.data;
    } catch (err) {
      set({ error: getErrorMessage(err), isSending: false });
      return null;
    }
  },

  fetchGiftStats: async (creatorId: string) => {
    try {
      const res = await api.get(`/gifts/stats/${creatorId}`);
      set({ giftStats: res.data });
    } catch (err) {
      set({ error: getErrorMessage(err) });
    }
  },

  fetchStreamGifts: async (streamId: string) => {
    try {
      const res = await api.get(`/gifts/stream/${streamId}`);
      set({ streamGifts: res.data.gifts || res.data || [] });
    } catch (err) {
      set({ error: getErrorMessage(err) });
    }
  },

  clearError: () => set({ error: null }),
}));

export { GIFT_CONFIG };
