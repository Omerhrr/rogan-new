/**
 * Rogan Live — DM WebSocket Client
 * Handles real-time typing indicators and message delivery for a DM conversation.
 */

import type { DMMessage } from '@/types';

interface DMWSOptions {
  conversationId: string;
  userId: string;
  token: string;
  onNewMessage?: (msg: DMMessage) => void;
  onTyping?: (userId: string, username: string) => void;
  onStopTyping?: (userId: string) => void;
  onMessageEdited?: (messageId: string, content: string, editedAt: string | null) => void;
  onMessageDeleted?: (messageId: string) => void;
  /** Receives any event whose type starts with "call_" */
  onCallSignal?: (event: Record<string, unknown>) => void;
  /** Receives a P2P photo relayed by the server (never stored in DB) */
  onPhotoData?: (messageId: string, dataUrl: string, senderId: string) => void;
  onConnect?: () => void;
  onDisconnect?: () => void;
}

export class DMWSClient {
  private ws: WebSocket | null = null;
  private options: DMWSOptions;
  private intentionalClose = false;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private reconnectAttempts = 0;
  private readonly maxReconnects = 5;

  // Typing send throttle — don't spam the server
  private lastTypingSent = 0;
  private typingTimeout: ReturnType<typeof setTimeout> | null = null;

  constructor(options: DMWSOptions) {
    this.options = options;
  }

  connect(): void {
    this.intentionalClose = false;
    this.reconnectAttempts = 0;
    this._connect();
  }

  private _connect(): void {
    if (this.intentionalClose || this.reconnectAttempts >= this.maxReconnects) return;

    const wsBase = process.env.NEXT_PUBLIC_WS_URL || 'ws://localhost:8000';
    const { conversationId, userId, token } = this.options;
    const url = `${wsBase}/ws/dm/${conversationId}/${userId}?token=${token}`;

    try {
      this.ws = new WebSocket(url);

      this.ws.onopen = () => {
        // disconnect() may have been called while the handshake was in flight.
        // Close cleanly now to avoid the "WS closed before connection" console warning.
        if (this.intentionalClose) {
          this.ws?.close();
          return;
        }
        this.reconnectAttempts = 0;
        this.options.onConnect?.();
      };

      this.ws.onmessage = (e) => {
        try {
          const data = JSON.parse(e.data);
          switch (data.type) {
            case 'new_message':
              this.options.onNewMessage?.(data.message as DMMessage);
              break;
            case 'typing':
              this.options.onTyping?.(data.user_id, data.username);
              break;
            case 'stop_typing':
              this.options.onStopTyping?.(data.user_id);
              break;
            case 'message_edited':
              this.options.onMessageEdited?.(data.message_id, data.content, data.edited_at ?? null);
              break;
            case 'message_deleted':
              this.options.onMessageDeleted?.(data.message_id);
              break;
            case 'photo_data':
              this.options.onPhotoData?.(
                data.message_id as string,
                data.data_url as string,
                data.from_user_id as string,
              );
              break;
            default:
              if (typeof data.type === 'string' && data.type.startsWith('call_')) {
                this.options.onCallSignal?.(data as Record<string, unknown>);
              }
              break;
          }
        } catch {}
      };

      this.ws.onerror = () => {};

      this.ws.onclose = () => {
        this.options.onDisconnect?.();
        if (!this.intentionalClose) {
          this.reconnectAttempts++;
          const delay = Math.min(1000 * Math.pow(2, this.reconnectAttempts), 15000);
          this.reconnectTimer = setTimeout(() => this._connect(), delay);
        }
      };
    } catch {
      this.reconnectAttempts++;
      this.reconnectTimer = setTimeout(() => this._connect(), 2000);
    }
  }

  /**
   * Call this on every keystroke. Sends a typing event at most once per second,
   * and auto-sends stop_typing after 2s of silence.
   */
  sendTyping(): void {
    if (this.ws?.readyState !== WebSocket.OPEN) return;

    const now = Date.now();
    if (now - this.lastTypingSent > 1000) {
      this.ws.send(JSON.stringify({ type: 'typing' }));
      this.lastTypingSent = now;
    }

    // Reset the stop-typing timer
    if (this.typingTimeout) clearTimeout(this.typingTimeout);
    this.typingTimeout = setTimeout(() => {
      if (this.ws?.readyState === WebSocket.OPEN) {
        this.ws.send(JSON.stringify({ type: 'stop_typing' }));
      }
    }, 2000);
  }

  /**
   * Send a WebRTC call signaling event to the other participant.
   * type examples: 'call_initiated', 'call_accepted', 'call_rejected',
   *                'call_ended', 'call_ice_candidate'
   */
  /** Send a photo to the other participant via WS relay. Data never touches the DB. */
  sendPhotoData(messageId: string, dataUrl: string): void {
    if (this.ws?.readyState !== WebSocket.OPEN) return;
    this.ws.send(JSON.stringify({ type: 'photo_data', message_id: messageId, data_url: dataUrl }));
  }

  sendCallSignal(type: string, payload: object = {}): void {
    if (this.ws?.readyState !== WebSocket.OPEN) return;
    this.ws.send(JSON.stringify({ type, ...payload }));
  }

  disconnect(): void {
    this.intentionalClose = true;
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    if (this.typingTimeout) clearTimeout(this.typingTimeout);
    // Skip close() on a still-connecting socket — the onopen guard above
    // will close it cleanly once the handshake finishes. This eliminates the
    // "WebSocket is closed before the connection is established" console error.
    if (this.ws && this.ws.readyState !== WebSocket.CONNECTING) {
      this.ws.close();
    }
    this.ws = null;
  }
}
