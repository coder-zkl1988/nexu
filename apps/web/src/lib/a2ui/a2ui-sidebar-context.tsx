import { createContext, useCallback, useContext, useRef, useState } from "react";
import type { A2UIMessage } from "./a2ui-types";

// ── Types ──────────────────────────────────────────────────────

export interface A2UISidebarState {
  isOpen: boolean;
  surfaceId: string | null;
  messages: A2UIMessage[];
  onAction: ((actionName: string, context: Record<string, unknown>) => void) | null;
}

export interface A2UISidebarActions {
  /** Open sidebar with given A2UI messages and action handler */
  openWith: (
    surfaceId: string,
    messages: A2UIMessage[],
    onAction: (actionName: string, context: Record<string, unknown>) => void,
  ) => void;
  /** Close sidebar and clear state */
  close: () => void;
}

interface A2UISidebarContextValue extends A2UISidebarState, A2UISidebarActions {}

// ── Context ────────────────────────────────────────────────────

const A2UISidebarContext = createContext<A2UISidebarContextValue | null>(null);

// ── Provider ───────────────────────────────────────────────────

export function A2UISidebarProvider({ children }: { children: React.ReactNode }) {
  const [isOpen, setIsOpen] = useState(false);
  const [surfaceId, setSurfaceId] = useState<string | null>(null);
  const [messages, setMessages] = useState<A2UIMessage[]>([]);
  // Store action handler in a ref to avoid re-renders on callback changes
  const onActionRef = useRef<
    ((actionName: string, context: Record<string, unknown>) => void) | null
  >(null);

  const openWith = useCallback(
    (
      sid: string,
      msgs: A2UIMessage[],
      onAction: (actionName: string, context: Record<string, unknown>) => void,
    ) => {
      setSurfaceId(sid);
      setMessages(msgs);
      onActionRef.current = onAction;
      setIsOpen(true);
    },
    [],
  );

  const close = useCallback(() => {
    setIsOpen(false);
    // Delay clearing so closing animation can complete
    setTimeout(() => {
      setSurfaceId(null);
      setMessages([]);
      onActionRef.current = null;
    }, 200);
  }, []);

  return (
    <A2UISidebarContext.Provider
      value={{
        isOpen,
        surfaceId,
        messages,
        onAction: onActionRef.current,
        openWith,
        close,
      }}
    >
      {children}
    </A2UISidebarContext.Provider>
  );
}

// ── Hook ───────────────────────────────────────────────────────

export function useA2UISidebar() {
  const ctx = useContext(A2UISidebarContext);
  if (!ctx) {
    throw new Error("useA2UISidebar must be used within A2UISidebarProvider");
  }
  return ctx;
}
