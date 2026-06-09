/**
 * Rogan Live v3 — API Client
 * Axios-based HTTP client for the FastAPI backend.
 * All endpoints are relative to /api/v1/ (proxied via Next.js rewrites).
 */

import axios, { AxiosError, InternalAxiosRequestConfig } from 'axios';

const API_BASE = '/api/v1';

const api = axios.create({
  baseURL: API_BASE,
  timeout: 15000,
  headers: {
    'Content-Type': 'application/json',
  },
});

// ─── Request interceptor: attach JWT ─────────────────────────
api.interceptors.request.use(
  (config: InternalAxiosRequestConfig) => {
    if (typeof window !== 'undefined') {
      const token = localStorage.getItem('rogan_token');
      if (token && config.headers) {
        config.headers.Authorization = `Bearer ${token}`;
      }
    }
    return config;
  },
  (error) => Promise.reject(error)
);

// ─── Response interceptor: handle 401 ────────────────────────
api.interceptors.response.use(
  (response) => response,
  (error: AxiosError) => {
    if (error.response?.status === 401) {
      // Token expired or invalid — clear and redirect to login
      if (typeof window !== 'undefined') {
        localStorage.removeItem('rogan_token');
        localStorage.removeItem('rogan_user');
        // Dispatch custom event so auth store can react
        window.dispatchEvent(new CustomEvent('auth:unauthorized'));
      }
    }
    return Promise.reject(error);
  }
);

// ─── Helper: Extract error message ───────────────────────────
export function getErrorMessage(error: unknown): string {
  if (axios.isAxiosError(error)) {
    const data = error.response?.data as { detail?: string; message?: string } | undefined;
    return data?.detail || data?.message || error.message || 'An error occurred';
  }
  if (error instanceof Error) return error.message;
  return 'An unexpected error occurred';
}

export default api;
