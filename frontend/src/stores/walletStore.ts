/**
 * Rogan Live v3 — Wallet Store
 * Manages TK balance, deposits, withdrawals, transactions.
 */

import { create } from 'zustand';
import api, { getErrorMessage } from '@/lib/api';
import type { Wallet, Transaction, LinkWalletRequest, DepositRequest, WithdrawRequest } from '@/types';

interface WalletState {
  wallet: Wallet | null;
  transactions: Transaction[];
  isLoading: boolean;
  error: string | null;
  txPage: number;
  txHasMore: boolean;

  fetchWallet: () => Promise<void>;
  linkWallet: (data: LinkWalletRequest) => Promise<void>;
  deposit: (data: DepositRequest) => Promise<void>;
  withdraw: (data: WithdrawRequest) => Promise<void>;
  fetchTransactions: (page?: number) => Promise<void>;
  clearError: () => void;
}

export const useWalletStore = create<WalletState>()((set, get) => ({
  wallet: null,
  transactions: [],
  isLoading: false,
  error: null,
  txPage: 1,
  txHasMore: true,

  fetchWallet: async () => {
    set({ isLoading: true, error: null });
    try {
      const res = await api.get<Wallet>('/wallet/');
      set({ wallet: res.data, isLoading: false });
    } catch (err) {
      set({ error: getErrorMessage(err), isLoading: false });
    }
  },

  linkWallet: async (data: LinkWalletRequest) => {
    set({ isLoading: true, error: null });
    try {
      await api.post('/wallet/link', data);
      await get().fetchWallet();
    } catch (err) {
      set({ error: getErrorMessage(err), isLoading: false });
      throw err;
    }
  },

  deposit: async (data: DepositRequest) => {
    set({ isLoading: true, error: null });
    try {
      await api.post('/wallet/deposit', data);
      await get().fetchWallet();
    } catch (err) {
      set({ error: getErrorMessage(err), isLoading: false });
      throw err;
    }
  },

  withdraw: async (data: WithdrawRequest) => {
    set({ isLoading: true, error: null });
    try {
      await api.post('/wallet/withdraw', data);
      await get().fetchWallet();
    } catch (err) {
      set({ error: getErrorMessage(err), isLoading: false });
      throw err;
    }
  },

  fetchTransactions: async (page = 1) => {
    try {
      const res = await api.get('/wallet/transactions', { params: { page, limit: 20 } });
      const data = res.data;
      set((state) => ({
        transactions: page === 1 ? data.transactions : [...state.transactions, ...data.transactions],
        txPage: page,
        txHasMore: page < data.pages,
      }));
    } catch (err) {
      set({ error: getErrorMessage(err) });
    }
  },

  clearError: () => set({ error: null }),
}));
