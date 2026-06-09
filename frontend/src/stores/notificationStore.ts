/**
 * Rogan Live v3 — Notification Store
 */

import { create } from 'zustand';
import api, { getErrorMessage } from '@/lib/api';
import type { Notification } from '@/types';

interface NotificationState {
  notifications: Notification[];
  unreadCount: number;
  isLoading: boolean;
  error: string | null;

  fetchNotifications: () => Promise<void>;
  fetchUnreadCount: () => Promise<void>;
  markAsRead: (id: string) => Promise<void>;
  clearError: () => void;
}

export const useNotificationStore = create<NotificationState>()((set) => ({
  notifications: [],
  unreadCount: 0,
  isLoading: false,
  error: null,

  fetchNotifications: async () => {
    set({ isLoading: true, error: null });
    try {
      const res = await api.get('/notifications/');
      const notifs = (res.data.notifications || res.data || []) as Notification[];
      set({ notifications: notifs, isLoading: false });
    } catch (err) {
      set({ error: getErrorMessage(err), isLoading: false });
    }
  },

  fetchUnreadCount: async () => {
    try {
      const res = await api.get('/notifications/unread-count');
      set({ unreadCount: res.data.count || 0 });
    } catch {
      // Silent
    }
  },

  markAsRead: async (id: string) => {
    try {
      await api.post(`/notifications/${id}/read`);
      set((state) => ({
        notifications: state.notifications.map((n) =>
          n.id === id ? { ...n, is_read: true } : n
        ),
        unreadCount: Math.max(0, state.unreadCount - 1),
      }));
    } catch {
      // Silent
    }
  },

  clearError: () => set({ error: null }),
}));
