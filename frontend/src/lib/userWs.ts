/**
 * Rogan Live — User-Level WebSocket Client
 * Stays connected for the whole authenticated session.
 * Receives real-time events: new DM toasts, stream_live notifications, etc.
 */

interface UserWSOptions {
  userId: string;
  token: string;
  onNewDM?: (payload: { from_username: string; preview: string; conversation_id: string }) => void;
  onStreamLive?: (payload: { stream_id: string; creator_username: string; title: string }) => void;
  onConnect?: () => void;
  onDisconnect?: () => void;
}

export class UserWSClient {
  private ws: WebSocket | null = null;
  private options: UserWSOptions;
  private intentionalClose = false;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private pingTimer: ReturnType<typeof setInterval> | null = null;
  private reconnectAttempts = 0;
  private readonly maxReconnects = 10;

  constructor(options: UserWSOptions) {
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
    const { userId, token } = this.options;
    const url = `${wsBase}/ws/user/${userId}?token=${token}`;

    try {
      this.ws = new WebSocket(url);

      this.ws.onopen = () => {
        if (this.intentionalClose) {
          this.ws?.close();
          return;
        }
        this.reconnectAttempts = 0;
        this.options.onConnect?.();
        this.pingTimer = setInterval(() => {
          if (this.ws?.readyState === WebSocket.OPEN) {
            this.ws.send(JSON.stringify({ type: 'ping' }));
          }
        }, 25000);
      };

      this.ws.onmessage = (e) => {
        try {
          const data = JSON.parse(e.data);
          switch (data.type) {
            case 'new_dm':
              this.options.onNewDM?.(data);
              break;
            case 'stream_live':
              this.options.onStreamLive?.(data);
              break;
          }
        } catch {}
      };

      this.ws.onerror = () => {};

      this.ws.onclose = () => {
        if (this.pingTimer) { clearInterval(this.pingTimer); this.pingTimer = null; }
        this.options.onDisconnect?.();
        if (!this.intentionalClose) {
          this.reconnectAttempts++;
          const delay = Math.min(1000 * Math.pow(2, this.reconnectAttempts), 30000);
          this.reconnectTimer = setTimeout(() => this._connect(), delay);
        }
      };
    } catch {
      this.reconnectAttempts++;
      this.reconnectTimer = setTimeout(() => this._connect(), 3000);
    }
  }

  disconnect(): void {
    this.intentionalClose = true;
    if (this.reconnectTimer) { clearTimeout(this.reconnectTimer); this.reconnectTimer = null; }
    if (this.pingTimer) { clearInterval(this.pingTimer); this.pingTimer = null; }
    if (this.ws && this.ws.readyState !== WebSocket.CONNECTING) {
      this.ws.close();
    }
    this.ws = null;
  }
}
