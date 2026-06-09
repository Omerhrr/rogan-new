/**
 * Rogan Live v3 — DM Store
 * Manages direct message conversations and messages.
 */

import { create } from 'zustand';
import api, { getErrorMessage } from '@/lib/api';
import type { DMConversation, DMMessage } from '@/types';

interface DMState {
  conversations: DMConversation[];
  currentConversation: DMConversation | null;
  messages: DMMessage[];
  isLoading: boolean;
  error: string | null;
  msgPage: number;
  msgHasMore: boolean;

  fetchConversations: () => Promise<void>;
  fetchMessages: (conversationId: string, page?: number) => Promise<void>;
  sendMessage: (conversationId: string, content: string) => Promise<void>;
  markAsRead: (conversationId: string) => Promise<void>;
  setDmPrice: (price: number) => Promise<void>;
  setCurrentConversation: (conv: DMConversation | null) => void;
  clearError: () => void;
}

export const useDMStore = create<DMState>()((set, get) => ({
  conversations: [],
  currentConversation: null,
  messages: [],
  isLoading: false,
  error: null,
  msgPage: 1,
  msgHasMore: true,

  fetchConversations: async () => {
    set({ isLoading: true, error: null });
    try {
      const res = await api.get('/dm/conversations');
      const convs = (res.data.conversations || res.data || []) as DMConversation[];
      set({ conversations: convs, isLoading: false });
    } catch (err) {
      set({ error: getErrorMessage(err), isLoading: false });
    }
  },

  fetchMessages: async (conversationId: string, page = 1) => {
    try {
      const res = await api.get(`/dm/conversations/${conversationId}`, { params: { page, limit: 50 } });
      const msgs = (res.data.messages || res.data || []) as DMMessage[];
      set((state) => ({
        messages: page === 1 ? msgs : [...state.messages, ...msgs],
        msgPage: page,
        msgHasMore: msgs.length >= 50,
      }));
    } catch (err) {
      set({ error: getErrorMessage(err) });
    }
  },

  sendMessage: async (conversationId: string, content: string) => {
    try {
      const res = await api.post(`/dm/conversations/${conversationId}/messages`, { content });
      const msg = res.data as DMMessage;
      set((state) => ({
        messages: [...state.messages, msg],
      }));
      // Update conversation's last_message
      const convs = get().conversations.map((c) =>
        c.id === conversationId ? { ...c, last_message: msg } : c
      );
      set({ conversations: convs });
    } catch (err) {
      set({ error: getErrorMessage(err) });
      throw err;
    }
  },

  markAsRead: async (conversationId: string) => {
    try {
      await api.post(`/dm/conversations/${conversationId}/read`);
      set((state) => ({
        conversations: state.conversations.map((c) =>
          c.id === conversationId ? { ...c, unread_count: 0 } : c
        ),
      }));
    } catch {
      // Silent fail for read receipts
    }
  },

  setDmPrice: async (price: number) => {
    try {
      await api.put('/dm/price', { dm_price: price });
    } catch (err) {
      set({ error: getErrorMessage(err) });
      throw err;
    }
  },

  setCurrentConversation: (conv: DMConversation | null) =>
    set({ currentConversation: conv, messages: [], msgPage: 1, msgHasMore: true }),

  clearError: () => set({ error: null }),
}));
