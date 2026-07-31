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

// ---------------------------------------------------------------------------
// Local-stream SSE client — /api/v1/chat/local/stream
// Receives WS-event-driven delta/final/aborted/error/side_result events
// ---------------------------------------------------------------------------

export interface LocalStreamDelta {
  runId: string;
  seq: number;
  deltaText: string;
  replace: boolean;
}

export interface LocalStreamFinal {
  runId: string;
  seq: number;
  message: unknown;
  stopReason: string;
  /**
   * Set when the run completed but some actions could not be verified by any
   * provider (click/hotkey/scroll/drag and friends have no read-back). The run
   * succeeded — this is a caveat on the result, not a failure.
   */
  noticeKind?: string;
  noticeMessage?: string;
}

export interface LocalStreamError {
  runId: string;
  seq: number;
  errorMessage: string;
  errorKind: string;
}

export interface LocalStreamAborted {
  runId: string;
  seq: number;
}

export interface LocalStreamSideResult {
  kind: "btw";
  runId: string;
  sessionKey: string;
  question: string;
  text: string;
  isError: boolean;
  ts: number;
  seq?: number;
}

export interface LocalStreamClientOptions {
  botId: string;
  sessionKey: string;
  runId?: string;
  baseUrl?: string;
  onDelta?: (delta: LocalStreamDelta) => void;
  onFinal?: (final: LocalStreamFinal) => void;
  onAborted?: (aborted: LocalStreamAborted) => void;
  onError?: (error: LocalStreamError) => void;
  onSideResult?: (sideResult: LocalStreamSideResult) => void;
  onConnected?: () => void;
}

export function createLocalStreamSSEClient(opts: LocalStreamClientOptions) {
  const baseUrl = opts.baseUrl ?? "";
  let url = `${baseUrl}/api/v1/chat/local/stream?botId=${encodeURIComponent(opts.botId)}&sessionKey=${encodeURIComponent(opts.sessionKey)}`;
  if (opts.runId) {
    url += `&runId=${encodeURIComponent(opts.runId)}`;
  }
  let es: EventSource | null = null;

  function connect(): void {
    disconnect();
    es = new EventSource(url);

    es.addEventListener("connected", () => {
      opts.onConnected?.();
    });

    es.addEventListener("delta", (event) => {
      try {
        const data = JSON.parse(event.data) as LocalStreamDelta;
        opts.onDelta?.(data);
      } catch {
        // Skip malformed data
      }
    });

    es.addEventListener("final", (event) => {
      try {
        const data = JSON.parse(event.data) as LocalStreamFinal;
        opts.onFinal?.(data);
      } catch {
        // Skip malformed data
      }
    });

    es.addEventListener("aborted", (event) => {
      try {
        const data = JSON.parse(event.data) as LocalStreamAborted;
        opts.onAborted?.(data);
      } catch {
        // Skip malformed data
      }
    });

    es.addEventListener("error", (event) => {
      // SSE "error" event from EventSource is an ErrorEvent, not our custom
      // "error" typed event. Check if it carries our JSON payload.
      if (event instanceof MessageEvent) {
        try {
          const data = JSON.parse(event.data) as LocalStreamError;
          opts.onError?.(data);
        } catch {
          // Skip malformed data
        }
      }
    });

    es.addEventListener("side_result", (event) => {
      try {
        const data = JSON.parse(event.data) as LocalStreamSideResult;
        opts.onSideResult?.(data);
      } catch {
        // Skip malformed data
      }
    });

    es.addEventListener("ping", () => {
      // Keep-alive, no action needed
    });

    es.onerror = () => {
      // EventSource will auto-reconnect; no custom action needed
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
