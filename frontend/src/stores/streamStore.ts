/**
 * Rogan Live v3 — Stream Store
 * Manages live streams: feed, creation, viewer counts.
 */

import { create } from 'zustand';
import api, { getErrorMessage } from '@/lib/api';
import type { Stream, CreateStreamRequest, StreamListResponse } from '@/types';

interface StreamState {
  streams: Stream[];
  currentStream: Stream | null;
  viewerCount: number;
  isLoading: boolean;
  error: string | null;
  page: number;
  hasMore: boolean;
  totalPages: number;

  fetchLiveStreams: (page?: number, limit?: number) => Promise<void>;
  fetchStream: (id: string) => Promise<Stream>;
  createStream: (data: CreateStreamRequest) => Promise<Stream>;
  goLive: (streamId: string) => Promise<void>;
  endStream: (streamId: string) => Promise<void>;
  setViewerCount: (count: number) => void;
  setCurrentStream: (stream: Stream | null) => void;
  clearStreams: () => void;
}

export const useStreamStore = create<StreamState>()((set, get) => ({
  streams: [],
  currentStream: null,
  viewerCount: 0,
  isLoading: false,
  error: null,
  page: 1,
  hasMore: true,
  totalPages: 1,

  fetchLiveStreams: async (page = 1, limit = 12) => {
    set({ isLoading: true, error: null });
    try {
      const res = await api.get<StreamListResponse>('/streams/live', { params: { page, limit } });
      const data = res.data;
      set((state) => ({
        streams: page === 1 ? data.streams : [...state.streams, ...data.streams],
        page,
        hasMore: page < data.pages,
        totalPages: data.pages,
        isLoading: false,
      }));
    } catch (err) {
      set({ error: getErrorMessage(err), isLoading: false });
    }
  },

  fetchStream: async (id: string) => {
    try {
      const res = await api.get<Stream>(`/streams/${id}`);
      return res.data;
    } catch (err) {
      throw new Error(getErrorMessage(err));
    }
  },

  createStream: async (data: CreateStreamRequest) => {
    set({ isLoading: true, error: null });
    try {
      const res = await api.post<Stream>('/streams/', data);
      set({ currentStream: res.data, isLoading: false });
      return res.data;
    } catch (err) {
      set({ error: getErrorMessage(err), isLoading: false });
      throw err;
    }
  },

  goLive: async (streamId: string) => {
    try {
      const res = await api.post(`/streams/${streamId}/go-live`);
      set((state) => ({
        currentStream: state.currentStream
          ? { ...state.currentStream, is_live: true }
          : null,
      }));
    } catch (err) {
      throw new Error(getErrorMessage(err));
    }
  },

  endStream: async (streamId: string) => {
    try {
      await api.post(`/streams/${streamId}/end`);
      set((state) => ({
        currentStream: state.currentStream
          ? { ...state.currentStream, is_live: false }
          : null,
      }));
    } catch (err) {
      throw new Error(getErrorMessage(err));
    }
  },

  setViewerCount: (count: number) => set({ viewerCount: count }),
  setCurrentStream: (stream: Stream | null) => set({ currentStream: stream }),
  clearStreams: () => set({ streams: [], page: 1, hasMore: true }),
}));
