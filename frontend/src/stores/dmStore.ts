/**
 * Rogan Live v3 — DM Store
 * Manages direct message conversations and messages.
 */

import { create } from 'zustand';
import api, { getErrorMessage } from '@/lib/api';
import type { DMConversation, DMMessage } from '@/types';
import { useAuthStore } from './authStore';

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
  sendMessage: (conversationId: string, content: string, replyToId?: string, voiceNote?: { audio_url: string; audio_duration: number }, msgType?: 'text' | 'sticker' | 'photo') => Promise<void>;
  markAsRead: (conversationId: string) => Promise<void>;
  setDmPrice: (price: number) => Promise<void>;
  addMessage: (msg: DMMessage) => void;
  editMessage: (conversationId: string, messageId: string, content: string) => Promise<void>;
  deleteMessage: (conversationId: string, messageId: string) => Promise<void>;
  applyMessageEdit: (messageId: string, content: string, editedAt: string | null) => void;
  applyMessageDelete: (messageId: string) => void;
  clearChat: (conversationId: string, userId: string) => void;
  deleteConversation: (conversationId: string) => Promise<void>;
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
      // Backend returns newest-first; reverse so oldest is at top, newest at bottom
      let msgs = ((res.data.messages || res.data || []) as DMMessage[]).reverse();

      // Apply per-user local clear filter (localStorage key: dm_cleared_{convId}_{userId})
      const userId = useAuthStore.getState().user?.id;
      if (userId) {
        const clearedAt = localStorage.getItem(`dm_cleared_${conversationId}_${userId}`);
        if (clearedAt) {
          // Always parse as UTC — guard against missing Z on either the cutoff or message timestamps
          const parseUTC = (d: string) =>
            new Date(d.endsWith('Z') || d.includes('+') ? d : d + 'Z').getTime();
          const ts = parseUTC(clearedAt);
          msgs = msgs.filter((m) => m.created_at && parseUTC(m.created_at) > ts);
        }
      }

      set((state) => ({
        messages: page === 1 ? msgs : [...msgs, ...state.messages],
        msgPage: page,
        msgHasMore: msgs.length >= 50,
      }));
    } catch (err) {
      set({ error: getErrorMessage(err) });
    }
  },

  sendMessage: async (conversationId: string, content: string, replyToId?: string, voiceNote?: { audio_url: string; audio_duration: number }, msgType?: 'text' | 'sticker' | 'photo') => {
    try {
      const resolvedType = voiceNote ? 'voice' : (msgType ?? 'text');
      const res = await api.post(`/dm/conversations/${conversationId}/messages`, {
        content: voiceNote ? '' : content,
        ...(replyToId ? { reply_to_id: replyToId } : {}),
        message_type: resolvedType,
        ...(voiceNote ? { audio_url: voiceNote.audio_url, audio_duration: voiceNote.audio_duration } : {}),
      });
      let msg = res.data as DMMessage;
      // Backend send response omits reply_to object — hydrate from local state
      if (replyToId && !msg.reply_to) {
        const source = get().messages.find((m) => m.id === replyToId);
        if (source) {
          msg = { ...msg, reply_to: { id: source.id, sender_id: source.sender_id, content: source.content } };
        }
      }
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

  addMessage: (msg: DMMessage) =>
    set((state) => {
      if (state.messages.some((m) => m.id === msg.id)) return state;
      // WS payload omits reply_to object — hydrate from local state
      if (msg.reply_to_id && !msg.reply_to) {
        const source = state.messages.find((m) => m.id === msg.reply_to_id);
        if (source) {
          msg = { ...msg, reply_to: { id: source.id, sender_id: source.sender_id, content: source.content } };
        }
      }
      return { messages: [...state.messages, msg] };
    }),

  editMessage: async (conversationId: string, messageId: string, content: string) => {
    const res = await api.put(`/dm/conversations/${conversationId}/messages/${messageId}`, { content });
    set((state) => ({
      messages: state.messages.map((m) =>
        m.id === messageId ? { ...m, content: res.data.content, edited_at: res.data.edited_at } : m
      ),
    }));
  },

  deleteMessage: async (conversationId: string, messageId: string) => {
    await api.delete(`/dm/conversations/${conversationId}/messages/${messageId}`);
    set((state) => ({
      messages: state.messages.map((m) =>
        m.id === messageId ? { ...m, is_deleted: true, content: 'This message was deleted' } : m
      ),
    }));
  },

  // Called from WS when the other participant edits/deletes
  applyMessageEdit: (messageId: string, content: string, editedAt: string | null) =>
    set((state) => ({
      messages: state.messages.map((m) =>
        m.id === messageId ? { ...m, content, edited_at: editedAt } : m
      ),
    })),

  applyMessageDelete: (messageId: string) =>
    set((state) => ({
      messages: state.messages.map((m) =>
        m.id === messageId ? { ...m, is_deleted: true, content: 'This message was deleted' } : m
      ),
    })),

  // Local-only clear — stores a timestamp in localStorage so messages before it
  // are filtered out on next fetch. The other person's view is unaffected.
  clearChat: (conversationId: string, userId: string) => {
    // Use the last message's server-side created_at as the cutoff, not the
    // client clock — avoids filtering out new messages when the server clock
    // is slightly behind the client (common with Docker).
    const msgs = get().messages;
    const lastServerTime = msgs.length > 0 ? msgs[msgs.length - 1].created_at : null;
    const cutoff = lastServerTime ?? new Date().toISOString();
    localStorage.setItem(`dm_cleared_${conversationId}_${userId}`, cutoff);
    set({ messages: [] });
    set((state) => ({
      conversations: state.conversations.map((c) =>
        c.id === conversationId ? { ...c, last_message: null, unread_count: 0 } : c
      ),
    }));
  },

  deleteConversation: async (conversationId: string) => {
    await api.delete(`/dm/conversations/${conversationId}`);
    set((state) => ({
      conversations: state.conversations.filter((c) => c.id !== conversationId),
      currentConversation: null,
      messages: [],
    }));
  },

  setCurrentConversation: (conv: DMConversation | null) =>
    set({ currentConversation: conv, messages: [], msgPage: 1, msgHasMore: true }),

  clearError: () => set({ error: null }),
}));
