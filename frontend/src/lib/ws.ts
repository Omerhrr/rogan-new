/**
 * Rogan Live v3 — WebSocket Client
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

    // Connect directly to the backend WebSocket server.
    // Next.js rewrites cannot proxy WebSocket upgrade requests,
    // so the browser must connect to the backend directly.
    // NEXT_PUBLIC_WS_URL should be set to e.g. "ws://localhost:8000" (Docker)
    // or "wss://yourdomain.com" (production reverse proxy).
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
      case 'chat':
        this.options.onChat?.(data as unknown as ChatMessage);
        break;
      case 'gift':
        this.options.onGift?.(data as { sender_id: string; sender_name: string; gift_type: GiftType; amount: number });
        break;
      case 'viewer_count':
        this.options.onViewerCount?.(data.count as number);
        break;
      case 'system':
        this.options.onSystem?.(data.message as string);
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

  sendChat(message: string): void {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({ type: 'chat', message }));
    }
  }

  sendGift(giftType: GiftType, streamId: string): void {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({ type: 'gift', gift_type: giftType, stream_id: streamId }));
    }
  }

  disconnect(): void {
    this.intentionalClose = true;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
  }

  get isConnected(): boolean {
    return this.ws?.readyState === WebSocket.OPEN;
  }
}
