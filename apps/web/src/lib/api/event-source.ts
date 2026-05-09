/**
 * SSE client for real-time chat message streaming.
 *
 * Connects to the controller's /api/v1/chat/stream endpoint and emits
 * new messages as they arrive. Falls back gracefully on connection errors.
 */

export interface SSEMessage {
  id: string;
  role: "user" | "assistant";
  content: unknown;
  timestamp: number | null;
  createdAt: string | null;
}

export type SSEEventHandler = (msg: SSEMessage) => void;

export interface SSEClientOptions {
  botId: string;
  sessionKey: string;
  baseUrl?: string;
  onMessage?: SSEEventHandler;
  onConnected?: () => void;
  onError?: (err: Event) => void;
}

export function createSSEClient(opts: SSEClientOptions) {
  const baseUrl = opts.baseUrl ?? "";
  const url = `${baseUrl}/api/v1/chat/stream?botId=${encodeURIComponent(opts.botId)}&sessionKey=${encodeURIComponent(opts.sessionKey)}`;
  let es: EventSource | null = null;

  function connect(): void {
    disconnect();
    es = new EventSource(url);

    es.onopen = () => {
      opts.onConnected?.();
    };

    es.addEventListener("connected", () => {
      opts.onConnected?.();
    });

    es.addEventListener("message", (event) => {
      try {
        const msg = JSON.parse(event.data) as SSEMessage;
        if (msg.role === "user" || msg.role === "assistant") {
          opts.onMessage?.(msg);
        }
      } catch {
        // Skip malformed data
      }
    });

    es.addEventListener("ping", () => {
      // Keep-alive, no action needed
    });

    es.onerror = (err) => {
      opts.onError?.(err);
    };
  }

  function disconnect(): void {
    if (es) {
      es.close();
      es = null;
    }
  }

  return { connect, disconnect };
}
