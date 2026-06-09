/**
 * Rogan Live v3 — Marketplace Store
 */

import { create } from 'zustand';
import api, { getErrorMessage } from '@/lib/api';
import type { MarketplaceProduct, ProductPurchase } from '@/types';

interface MarketplaceState {
  products: MarketplaceProduct[];
  myProducts: MarketplaceProduct[];
  myPurchases: ProductPurchase[];
  currentProduct: MarketplaceProduct | null;
  isLoading: boolean;
  error: string | null;

  fetchProducts: (page?: number) => Promise<void>;
  fetchMyProducts: () => Promise<void>;
  fetchMyPurchases: () => Promise<void>;
  createProduct: (data: FormData) => Promise<void>;
  purchaseProduct: (id: string) => Promise<void>;
  setCurrentProduct: (product: MarketplaceProduct | null) => void;
  clearError: () => void;
}

export const useMarketplaceStore = create<MarketplaceState>()((set) => ({
  products: [],
  myProducts: [],
  myPurchases: [],
  currentProduct: null,
  isLoading: false,
  error: null,

  fetchProducts: async (page = 1) => {
    set({ isLoading: true, error: null });
    try {
      const res = await api.get('/marketplace/products/', { params: { page, limit: 20 } });
      const data = res.data;
      set((state) => ({
        products: page === 1 ? (data.products || data || []) : [...state.products, ...(data.products || [])],
        isLoading: false,
      }));
    } catch (err) {
      set({ error: getErrorMessage(err), isLoading: false });
    }
  },

  fetchMyProducts: async () => {
    try {
      const res = await api.get('/marketplace/products/me');
      set({ myProducts: res.data.products || res.data || [] });
    } catch (err) {
      set({ error: getErrorMessage(err) });
    }
  },

  fetchMyPurchases: async () => {
    try {
      const res = await api.get('/marketplace/purchases/me');
      set({ myPurchases: res.data.purchases || res.data || [] });
    } catch (err) {
      set({ error: getErrorMessage(err) });
    }
  },

  createProduct: async (data) => {
    set({ isLoading: true, error: null });
    try {
      await api.post('/marketplace/products/', data);
      set({ isLoading: false });
    } catch (err) {
      set({ error: getErrorMessage(err), isLoading: false });
      throw err;
    }
  },

  purchaseProduct: async (id: string) => {
    set({ isLoading: true, error: null });
    try {
      await api.post(`/marketplace/products/${id}/purchase`);
      set({ isLoading: false });
    } catch (err) {
      set({ error: getErrorMessage(err), isLoading: false });
      throw err;
    }
  },

  setCurrentProduct: (product) => set({ currentProduct: product }),
  clearError: () => set({ error: null }),
}));
