/**
 * Rogan Live — Wallet Store
 * Handles: wallet info, ROGAN crypto deposit, Stripe deposit, withdrawals, history.
 */

import { create } from 'zustand';
import api, { getErrorMessage } from '@/lib/api';
import type {
  WalletInfo,
  Wallet,
  Transaction,
  CryptoDepositResult,
  StripeIntentResult,
  WithdrawalRequest,
  DepositHistoryItem,
  SendHistoryItem,
} from '@/types';

interface WalletState {
  walletInfo: WalletInfo | null;
  // Legacy compat for components that use wallet.tk_balance / wallet.wallet_address
  wallet: Wallet | null;
  transactions: Transaction[];
  withdrawals: WithdrawalRequest[];
  depositHistory: DepositHistoryItem[];
  sendHistory: SendHistoryItem[];
  isLoading: boolean;
  error: string | null;

  fetchWallet: () => Promise<void>;
  linkWalletAddress: (address: string) => Promise<void>;

  // ROGAN on-chain
  depositCrypto: (txHash: string) => Promise<CryptoDepositResult>;

  // Stripe
  createStripeIntent: (amountUsd: number) => Promise<StripeIntentResult>;
  getStripeConfig: () => Promise<{ publishable_key: string | null; enabled: boolean }>;

  // Withdrawals
  requestWithdrawal: (amountTk: number) => Promise<void>;
  fetchWithdrawals: () => Promise<void>;

  // History
  fetchDepositHistory: () => Promise<void>;
  fetchSendHistory: () => Promise<void>;
  fetchTransactions: (page?: number) => Promise<void>;

  clearError: () => void;

  sendTK: (recipientUsername: string, amountTk: number) => Promise<{ recipient_username: string; amount_tk: number; new_balance: number }>;

  // Legacy aliases kept for backward compat
  deposit: (data: { amount: number }) => Promise<void>;
  withdraw: (data: { tk_amount: number }) => Promise<void>;
  linkWallet: (data: { wallet_address: string }) => Promise<void>;
}

export const useWalletStore = create<WalletState>()((set, get) => ({
  walletInfo: null,
  wallet: null,
  transactions: [],
  withdrawals: [],
  depositHistory: [],
  sendHistory: [],
  isLoading: false,
  error: null,

  fetchWallet: async () => {
    set({ isLoading: true, error: null });
    try {
      const res = await api.get<WalletInfo>('/wallet/me');
      const info = res.data;
      set({
        walletInfo: info,
        // Populate legacy wallet shape so old components keep working
        wallet: {
          id: null,
          user_id: '',
          wallet_address: info.wallet_address,
          linked_at: null,
          tk_balance: info.tk_balance,
        },
        isLoading: false,
      });
    } catch (err) {
      set({ error: getErrorMessage(err), isLoading: false });
    }
  },

  linkWalletAddress: async (address: string) => {
    set({ isLoading: true, error: null });
    try {
      await api.post('/wallet/link-address', { wallet_address: address });
      await get().fetchWallet();
    } catch (err) {
      set({ error: getErrorMessage(err), isLoading: false });
      throw err;
    }
  },

  depositCrypto: async (txHash: string) => {
    set({ isLoading: true, error: null });
    try {
      const res = await api.post<CryptoDepositResult>('/wallet/deposit/crypto', { tx_hash: txHash });
      await get().fetchWallet();
      set({ isLoading: false });
      return res.data;
    } catch (err) {
      set({ error: getErrorMessage(err), isLoading: false });
      throw err;
    }
  },

  createStripeIntent: async (amountUsd: number) => {
    set({ isLoading: true, error: null });
    try {
      const res = await api.post<StripeIntentResult>('/wallet/deposit/stripe/create-intent', { amount_usd: amountUsd });
      set({ isLoading: false });
      return res.data;
    } catch (err) {
      set({ error: getErrorMessage(err), isLoading: false });
      throw err;
    }
  },

  getStripeConfig: async () => {
    const res = await api.get<{ publishable_key: string | null; enabled: boolean }>('/wallet/stripe/config');
    return res.data;
  },

  requestWithdrawal: async (amountTk: number) => {
    set({ isLoading: true, error: null });
    try {
      await api.post('/wallet/withdraw', { amount_tk: amountTk });
      await get().fetchWallet();
      await get().fetchWithdrawals();
    } catch (err) {
      set({ error: getErrorMessage(err), isLoading: false });
      throw err;
    } finally {
      set({ isLoading: false });
    }
  },

  fetchWithdrawals: async () => {
    try {
      const res = await api.get<{ total: number; items: WithdrawalRequest[] }>('/wallet/withdrawals');
      set({ withdrawals: res.data.items });
    } catch (err) {
      set({ error: getErrorMessage(err) });
    }
  },

  fetchDepositHistory: async () => {
    try {
      const res = await api.get<{ items: DepositHistoryItem[] }>('/wallet/deposits');
      set({ depositHistory: res.data.items });
    } catch (err) {
      set({ error: getErrorMessage(err) });
    }
  },

  fetchTransactions: async (page = 1) => {
    try {
      const res = await api.get('/wallet/transactions', { params: { page, limit: 20 } });
      const data = res.data;
      set((state) => ({
        transactions: page === 1 ? (data.transactions ?? []) : [...state.transactions, ...(data.transactions ?? [])],
      }));
    } catch {
      // non-fatal
    }
  },

  sendTK: async (recipientUsername: string, amountTk: number) => {
    set({ isLoading: true, error: null });
    try {
      const res = await api.post('/wallet/send', { recipient_username: recipientUsername, amount_tk: amountTk });
      await get().fetchWallet();
      set({ isLoading: false });
      return res.data;
    } catch (err) {
      set({ error: getErrorMessage(err), isLoading: false });
      throw err;
    }
  },

  fetchSendHistory: async () => {
    try {
      const res = await api.get<{ items: SendHistoryItem[] }>('/wallet/sends');
      set({ sendHistory: res.data.items });
    } catch (err) {
      set({ error: getErrorMessage(err) });
    }
  },

  clearError: () => set({ error: null }),

  // Legacy aliases
  deposit: async ({ amount }) => {
    // Legacy callers mapped to crypto deposit; UI should use depositCrypto instead
    set({ error: 'Use the Deposit tab to add funds' });
  },
  withdraw: async ({ tk_amount }) => {
    await get().requestWithdrawal(tk_amount);
  },
  linkWallet: async ({ wallet_address }) => {
    await get().linkWalletAddress(wallet_address);
  },
}));
