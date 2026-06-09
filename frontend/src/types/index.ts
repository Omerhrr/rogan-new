/**
 * Rogan Live v3 — TypeScript Type Definitions
 * Covers all FastAPI backend schemas and frontend-specific types.
 */

// ─── Auth ────────────────────────────────────────────────────

export interface User {
  id: string;
  email: string;
  username: string;
  display_name: string | null;
  avatar: string | null;
  bio: string | null;
  role: 'user' | 'creator' | 'admin';
  is_live: boolean;
  created_at: string | null;
}

export interface AuthResponse {
  user: User;
  token: string;
}

export interface RegisterRequest {
  email: string;
  username: string;
  password: string;
}

export interface LoginRequest {
  email: string;
  password: string;
}

export interface GoogleAuthRequest {
  google_token: string;
}

export interface UpdateProfileRequest {
  display_name?: string | null;
  bio?: string | null;
  avatar?: string | null;
}

// ─── Streams ─────────────────────────────────────────────────

export interface Stream {
  id: string;
  creator_id: string;
  title: string;
  description: string | null;
  thumbnail: string | null;
  is_live: boolean;
  is_private: boolean;
  viewer_count: number;
  category: string | null;
  created_at: string | null;
  ended_at: string | null;
  creator: User | null;
  stream_key: string | null;
}

export interface StreamListResponse {
  streams: Stream[];
  total: number;
  page: number;
  limit: number;
  pages: number;
}

export interface CreateStreamRequest {
  title: string;
  description?: string;
  is_private?: boolean;
  category?: string;
}

// ─── Gifts ───────────────────────────────────────────────────

export type GiftType = 'rose' | 'heart' | 'diamond' | 'rocket' | 'crown';

export interface Gift {
  id: string;
  stream_id: string;
  sender_id: string;
  receiver_id: string;
  gift_type: GiftType;
  amount: number;
  message: string | null;
  created_at: string | null;
}

export interface SendGiftRequest {
  stream_id: string;
  gift_type: GiftType;
  message?: string;
}

export interface SendGiftResponse {
  gift: Gift;
  sender_balance: number;
  receiver_balance: number;
  creator_earnings: number;
}

export const GIFT_CONFIG: Record<GiftType, { price: number; emoji: string; label: string }> = {
  rose:   { price: 1,   emoji: '🌹', label: 'Rose' },
  heart:  { price: 5,   emoji: '❤️', label: 'Heart' },
  diamond:{ price: 10,  emoji: '💎', label: 'Diamond' },
  rocket: { price: 50,  emoji: '🚀', label: 'Rocket' },
  crown:  { price: 100, emoji: '👑', label: 'Crown' },
};

// ─── Wallet ──────────────────────────────────────────────────

export interface Wallet {
  id: string | null;
  user_id: string;
  wallet_address: string | null;
  linked_at: string | null;
  tk_balance: number;
}

export interface Transaction {
  id: string;
  type: string;
  amount: number;
  from_user_id: string;
  to_user_id: string;
  reference_id: string | null;
  metadata: string | null;
  created_at: string | null;
}

export interface LinkWalletRequest {
  wallet_address: string;
}

export interface DepositRequest {
  amount: number;
}

export interface WithdrawRequest {
  tk_amount: number;
}

// ─── DM ──────────────────────────────────────────────────────

export interface DMConversation {
  id: string;
  participant_a_id: string;
  participant_b_id: string;
  dm_price: number;
  created_at: string | null;
  other_user: User | null;
  last_message: DMMessage | null;
  unread_count: number;
}

export interface DMMessage {
  id: string;
  conversation_id: string;
  sender_id: string;
  content: string;
  is_paid: boolean;
  amount_tk: number | null;
  read_at: string | null;
  created_at: string | null;
}

export interface DMPriceUpdate {
  dm_price: number;
}

// ─── Notifications ───────────────────────────────────────────

export interface Notification {
  id: string;
  user_id: string;
  type: string;
  title: string;
  message: string;
  is_read: boolean;
  metadata_json: string | null;
  created_at: string | null;
}

// ─── Creator ─────────────────────────────────────────────────

export interface CreatorProfile {
  id: string;
  username: string;
  display_name: string | null;
  avatar: string | null;
  bio: string | null;
  role: string;
  is_live: boolean;
  total_gifts_received: number;
  total_tk_earned: number;
  breakdown_by_type: Record<string, number>;
}

export interface CreatorDashboard {
  user: User;
  wallet: Wallet;
  gift_stats: {
    total_received: number;
    total_tk: number;
    by_type: Record<string, number>;
  };
  recent_streams: Stream[];
  tk_balance: number;
}

// ─── Stream Keys ─────────────────────────────────────────────

export interface StreamKey {
  id: string;
  user_id: string;
  key: string;
  label: string | null;
  is_active: boolean;
  created_at: string | null;
  last_used_at: string | null;
}

export interface StreamKeyCreate {
  label?: string;
}

// ─── Private Shows ───────────────────────────────────────────

export interface PrivateShow {
  id: string;
  creator_id: string;
  stream_key: string | null;
  price_tk: number;
  duration_minutes: number;
  max_viewers: number | null;
  status: string;
  started_at: string | null;
  ended_at: string | null;
  total_revenue: number;
  viewer_count: number;
  created_at: string | null;
}

// ─── Subscriptions ───────────────────────────────────────────

export interface SubscriptionTier {
  id: string;
  creator_id: string;
  name: string;
  price_tk: number;
  perks: string[] | null;
  max_subscribers: number | null;
  is_active: boolean;
  created_at: string | null;
}

export interface Subscription {
  id: string;
  subscriber_id: string;
  creator_id: string;
  tier_id: string | null;
  tier: 'basic' | 'premium' | 'vip';
  price: number;
  is_active: boolean;
  status: string;
  auto_renew: boolean;
  started_at: string | null;
  created_at: string | null;
  expires_at: string | null;
}

// ─── Marketplace ─────────────────────────────────────────────

export interface MarketplaceProduct {
  id: string;
  creator_id: string;
  title: string;
  description: string | null;
  price_tk: number;
  product_type: 'digital' | 'payperview' | 'custom';
  file_url: string | null;
  thumbnail_url: string | null;
  status: 'active' | 'draft' | 'archived';
  created_at: string | null;
}

export interface ProductPurchase {
  id: string;
  product_id: string;
  buyer_id: string;
  amount_tk: number;
  created_at: string | null;
}

// ─── Tasks ───────────────────────────────────────────────────

export interface Task {
  id: string;
  creator_id: string;
  title: string;
  description: string | null;
  category: string | null;
  price_tk: number;
  deadline: string | null;
  status: string;
  created_at: string | null;
  updated_at: string | null;
  bid_count: number;
}

export interface TaskBid {
  id: string;
  task_id: string;
  bidder_id: string;
  amount_tk: number;
  message: string | null;
  status: string;
  created_at: string | null;
}

// ─── PK Battles ──────────────────────────────────────────────

export interface PKBattle {
  id: string;
  creator_a_id: string;
  creator_b_id: string;
  duration_minutes: number;
  entry_gift_requirements: number;
  status: string;
  started_at: string | null;
  ended_at: string | null;
  creator_a_score: number;
  creator_b_score: number;
  winner_id: string | null;
  created_at: string | null;
}

// ─── Moderation ──────────────────────────────────────────────

export interface ModerationReport {
  id: string;
  reporter_id: string;
  target_type: string;
  target_id: string;
  reason: string;
  evidence_url: string | null;
  status: string;
  priority: number;
  created_at: string | null;
  resolved_at: string | null;
  resolver_id: string | null;
}

// ─── Web3 ────────────────────────────────────────────────────

export interface SIWENonce {
  nonce: string;
  message: string;
}

export interface WalletWeb3 {
  id: string | null;
  user_id: string;
  eth_address: string | null;
  wallet_address: string | null;
  tk_balance: number;
}

// ─── Frontend-specific ───────────────────────────────────────

export type ViewType =
  | 'feed'
  | 'golive'
  | 'messages'
  | 'wallet'
  | 'marketplace'
  | 'profile'
  | 'dashboard'
  | 'pk'
  | 'subscriptions'
  | 'moderation'
  | 'web3'
  | 'settings';

export interface ChatMessage {
  id: string;
  stream_id: string;
  user_id: string;
  username: string;
  avatar: string | null;
  message: string;
  type: 'chat' | 'system' | 'gift_alert';
  gift_type?: GiftType;
  gift_amount?: number;
  created_at: string;
}

export interface GiftAnimation {
  id: string;
  gift_type: GiftType;
  sender_name: string;
  x_position: number;
  created_at: number;
}

export type LayoutMode = 'mobile' | 'desktop';

export interface PaginatedResponse<T> {
  items: T[];
  total: number;
  page: number;
  limit: number;
  pages: number;
}
