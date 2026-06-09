/**
 * Rogan Live v3 — Chat Store
 * Manages stream chat messages and gift animations.
 */

import { create } from 'zustand';
import type { ChatMessage, GiftAnimation, GiftType } from '@/types';

interface ChatState {
  messages: ChatMessage[];
  giftAnimations: GiftAnimation[];
  isOpen: boolean;

  addMessage: (msg: ChatMessage) => void;
  addSystemMessage: (message: string) => void;
  addGiftAnimation: (giftType: GiftType, senderName: string) => void;
  removeGiftAnimation: (id: string) => void;
  clearMessages: () => void;
  toggleChat: () => void;
  setOpen: (open: boolean) => void;
}

export const useChatStore = create<ChatState>()((set) => ({
  messages: [],
  giftAnimations: [],
  isOpen: true,

  addMessage: (msg: ChatMessage) =>
    set((state) => ({
      messages: [...state.messages.slice(-200), msg], // Keep last 200 messages
    })),

  addSystemMessage: (message: string) =>
    set((state) => ({
      messages: [
        ...state.messages.slice(-200),
        {
          id: `sys-${Date.now()}`,
          stream_id: '',
          user_id: 'system',
          username: 'System',
          avatar: null,
          message,
          type: 'system' as const,
          created_at: new Date().toISOString(),
        },
      ],
    })),

  addGiftAnimation: (giftType: GiftType, senderName: string) => {
    const id = `gift-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const animation: GiftAnimation = {
      id,
      gift_type: giftType,
      sender_name: senderName,
      x_position: 20 + Math.random() * 60, // 20-80% random X
      created_at: Date.now(),
    };
    set((state) => ({
      giftAnimations: [...state.giftAnimations, animation],
    }));
    // Auto-remove after 3 seconds
    setTimeout(() => {
      useChatStore.getState().removeGiftAnimation(id);
    }, 3000);
  },

  removeGiftAnimation: (id: string) =>
    set((state) => ({
      giftAnimations: state.giftAnimations.filter((g) => g.id !== id),
    })),

  clearMessages: () => set({ messages: [], giftAnimations: [] }),
  toggleChat: () => set((state) => ({ isOpen: !state.isOpen })),
  setOpen: (open: boolean) => set({ isOpen: open }),
}));
