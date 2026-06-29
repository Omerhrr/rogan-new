/**
 * Rogan Live v3 -- WebSocket Client
 * Connects to FastAPI WebSocket handler for real-time stream events.
 */

import type { ChatMessage, GiftAnimation, GiftType } from '@/types';

type MessageHandler = (data: unknown) => void;

interface WSClientOptions {
  streamId: string;
  userId: string;
  token: string;
  onChat?: (msg: ChatMessage) => void;
  onGift?: (gift: { sender_id: string; sender_name: string; gift_type: GiftType; amount: number }) => void;
  onViewerCount?: (count: number) => void;
  onSystem?: (msg: string) => void;
  onError?: (err: Event) => void;
  onConnect?: () => void;
  onDisconnect?: () => void;
  onRawMessage?: (data: Record<string, unknown>) => void;
}

export class StreamWSClient {
  private ws: WebSocket | null = null;
  private options: WSClientOptions;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private intentionalClose = false;
  private reconnectAttempts = 0;
  private maxReconnectAttempts = 10;

  constructor(options: WSClientOptions) {
    this.options = options;
  }

  connect(): void {
    this.intentionalClose = false;
    this.reconnectAttempts = 0;
    this._connect();
  }

  private _connect(): void {
    if (this.intentionalClose) return;
    if (this.reconnectAttempts >= this.maxReconnectAttempts) return;

    const wsBase = process.env.NEXT_PUBLIC_WS_URL || 'ws://localhost:8000';
    const url = `${wsBase}/ws/${this.options.streamId}/${this.options.userId}?token=${this.options.token}`;

    try {
      this.ws = new WebSocket(url);

      this.ws.onopen = () => {
        this.reconnectAttempts = 0;
        this.options.onConnect?.();
      };

      this.ws.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          this._handleMessage(data);
        } catch {
          // Non-JSON message, ignore
        }
      };

      this.ws.onerror = (err) => {
        this.options.onError?.(err);
      };

      this.ws.onclose = () => {
        this.options.onDisconnect?.();
        if (!this.intentionalClose) {
          this._scheduleReconnect();
        }
      };
    } catch {
      this._scheduleReconnect();
    }
  }

  private _handleMessage(data: Record<string, unknown>): void {
    switch (data.type as string) {
      case 'chat_message':
        if (data.user_id !== this.options.userId) {
          this.options.onChat?.({
            id: (data.id as string) || `ws-${data.user_id}-${data.timestamp}-${Math.random().toString(36).slice(2)}`,
            stream_id: data.stream_id as string,
            user_id: data.user_id as string,
            username: data.username as string,
            role: data.role as string | undefined,
            avatar: null,
            message: data.content as string,
            type: 'chat',
            created_at: data.timestamp as string,
          });
        }
        break;

      case 'gift_sent':
        this.options.onGift?.({
          sender_id: data.user_id as string,
          sender_name: data.username as string,
          gift_type: data.gift_type as GiftType,
          amount: data.amount as number,
        });
        break;

      case 'viewer_join':
      case 'viewer_leave':
        this.options.onViewerCount?.(data.viewer_count as number);
        break;

      case 'connected':
        if (data.viewer_count !== undefined) {
          this.options.onViewerCount?.(data.viewer_count as number);
        }
        break;

      case 'typing':
        break;

      case 'error':
        this.options.onSystem?.(`Server error: ${data.message as string}`);
        break;

      default:
        // Pass unrecognised messages to the generic handler (e.g. private show events)
        this.options.onRawMessage?.(data);
        break;
    }
  }

  private _scheduleReconnect(): void {
    this.reconnectAttempts++;
    const delay = Math.min(1000 * Math.pow(2, this.reconnectAttempts), 30000);
    this.reconnectTimer = setTimeout(() => {
      this._connect();
    }, delay);
  }

  sendChat(message: string, username?: string, role?: string): void {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({ type: 'chat_message', content: message, username, role }));
    }
  }

  sendGift(giftType: GiftType, streamId: string, username?: string, amount?: number): void {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({
        type: 'gift_sent',
        gift_type: giftType,
        stream_id: streamId,
        username,
        amount: amount ?? 0,
      }));
    }
  }

  sendTyping(username?: string): void {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({ type: 'typing', username }));
    }
  }

  disconnect(): void {
    this.intentionalClose = true;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    const ws = this.ws;
    this.ws = null;
    if (ws) {
      if (ws.readyState === WebSocket.CONNECTING) {
        ws.onerror = () => {};
        ws.onclose = () => {};
      } else {
        ws.close();
      }
    }
  }

  get isConnected(): boolean {
    return this.ws?.readyState === WebSocket.OPEN;
  }
}

// --- PK Battle WebSocket Client ---

interface PKScoreUpdate {
  creator_a_score: number;
  creator_b_score: number;
  sender_username?: string;
  amount_tk?: number;
  side?: 'a' | 'b';
}

interface PKBattleStarted {
  creator_a_username: string;
  creator_b_username: string;
  duration_minutes: number;
  started_at: string;
}

interface PKBattleEnded {
  winner_id: string | null;
  creator_a_score: number;
  creator_b_score: number;
}

interface PKBattleWSOptions {
  battleId: string;
  userId: string;
  token: string;
  onScoreUpdate?: (data: PKScoreUpdate) => void;
  onBattleStarted?: (data: PKBattleStarted) => void;
  onBattleEnded?: (data: PKBattleEnded) => void;
  onConnect?: () => void;
  onDisconnect?: () => void;
}

export class PKBattleWSClient {
  private ws: WebSocket | null = null;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private reconnectAttempts = 0;
  private intentionalClose = false;
  private options: PKBattleWSOptions;

  constructor(options: PKBattleWSOptions) {
    this.options = options;
  }

  connect(): void {
    this.intentionalClose = false;
    this._connect();
  }

  private _connect(): void {
    const { battleId, userId, token } = this.options;
    const baseUrl = (process.env.NEXT_PUBLIC_WS_URL || 'ws://localhost:8000').replace(/\/$/, '');
    const url = `${baseUrl}/ws/pk/${battleId}/${userId}?token=${encodeURIComponent(token)}`;

    const ws = new WebSocket(url);
    this.ws = ws;

    ws.onopen = () => {
      this.reconnectAttempts = 0;
      this.options.onConnect?.();
    };

    ws.onmessage = (event: MessageEvent) => {
      try {
        const data = JSON.parse(event.data as string);
        this._handleMessage(data);
      } catch {
        // ignore malformed frames
      }
    };

    ws.onclose = () => {
      this.options.onDisconnect?.();
      if (!this.intentionalClose && this.reconnectAttempts < 10) {
        this._scheduleReconnect();
      }
    };

    ws.onerror = () => {
      ws.close();
    };
  }

  private _handleMessage(data: Record<string, unknown>): void {
    switch (data.type) {
      case 'pk_score_update':
        this.options.onScoreUpdate?.({
          creator_a_score: (data.creator_a_score as number) ?? 0,
          creator_b_score: (data.creator_b_score as number) ?? 0,
          sender_username: data.sender_username as string | undefined,
          amount_tk: data.amount_tk as number | undefined,
          side: data.side as 'a' | 'b' | undefined,
        });
        break;
      case 'pk_battle_started':
        this.options.onBattleStarted?.(data as unknown as PKBattleStarted);
        break;
      case 'pk_battle_ended':
        this.options.onBattleEnded?.(data as unknown as PKBattleEnded);
        break;
    }
  }

  private _scheduleReconnect(): void {
    this.reconnectAttempts++;
    const delay = Math.min(1000 * Math.pow(2, this.reconnectAttempts), 30000);
    this.reconnectTimer = setTimeout(() => this._connect(), delay);
  }

  disconnect(): void {
    this.intentionalClose = true;
    if (this.reconnectTimer) { clearTimeout(this.reconnectTimer); this.reconnectTimer = null; }
    const ws = this.ws;
    this.ws = null;
    if (ws && ws.readyState !== WebSocket.CLOSING && ws.readyState !== WebSocket.CLOSED) {
      ws.close();
    }
  }

  get isConnected(): boolean {
    return this.ws?.readyState === WebSocket.OPEN;
  }
}
