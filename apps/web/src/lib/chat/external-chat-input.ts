export type ExternalChatAttachment = {
  type: "image" | "file";
  previewUrl: string;
  content: string;
  mimeType: string;
  filename?: string;
  size?: number;
};

export type ExternalChatInput = {
  text?: string;
  attachment?: ExternalChatAttachment;
};

type ExternalChatInputListener = (input: ExternalChatInput) => void;

const listeners = new Map<string, Set<ExternalChatInputListener>>();

export function publishExternalChatInput(
  sessionKey: string,
  input: ExternalChatInput,
): void {
  for (const listener of listeners.get(sessionKey) ?? []) {
    listener(input);
  }
}

export function subscribeExternalChatInput(
  sessionKey: string,
  listener: ExternalChatInputListener,
): () => void {
  const sessionListeners = listeners.get(sessionKey) ?? new Set();
  sessionListeners.add(listener);
  listeners.set(sessionKey, sessionListeners);

  return () => {
    sessionListeners.delete(listener);
    if (sessionListeners.size === 0) listeners.delete(sessionKey);
  };
}
