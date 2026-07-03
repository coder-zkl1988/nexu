import { readFile } from "node:fs/promises";
import path from "node:path";

/**
 * Read a subagent lane's entry from the agent's OpenClaw session index.
 *
 * `chat.send` to a fresh `agent:<botId>:subagent:<lane>` key is an async RPC —
 * it returns `{runId, status:"started"}` immediately; the authoritative
 * completion signal is the session entry's `status` flipping to `done` in
 * `agents/<botId>/sessions/sessions.json` (verified live, design doc §10.3).
 */
export async function readSubagentSessionEntry(
  openclawStateDir: string,
  botId: string,
  sessionKey: string,
): Promise<{ status?: string; sessionFile?: string } | null> {
  const indexPath = path.join(
    openclawStateDir,
    "agents",
    botId,
    "sessions",
    "sessions.json",
  );
  let raw: string;
  try {
    raw = await readFile(indexPath, "utf8");
  } catch {
    return null; // Agent has no session index yet.
  }
  try {
    const parsed = JSON.parse(raw) as Record<
      string,
      { status?: string; sessionFile?: string } | undefined
    >;
    return parsed[sessionKey] ?? null;
  } catch {
    return null; // Torn read while OpenClaw rewrites the index — retry later.
  }
}

/**
 * Extract the last assistant reply text from an OpenClaw session transcript
 * (JSONL). Assistant message content is either a plain string or an array of
 * `{type:"text", text}` parts.
 */
export async function readLastAssistantReply(
  sessionFile: string,
): Promise<string | null> {
  let raw: string;
  try {
    raw = await readFile(sessionFile, "utf8");
  } catch {
    return null;
  }
  let reply: string | null = null;
  for (const line of raw.split("\n")) {
    if (!line.trim()) {
      continue;
    }
    let entry: unknown;
    try {
      entry = JSON.parse(line);
    } catch {
      continue;
    }
    if (
      typeof entry !== "object" ||
      entry === null ||
      (entry as { type?: string }).type !== "message"
    ) {
      continue;
    }
    const message = (
      entry as {
        message?: { role?: string; content?: unknown };
      }
    ).message;
    if (message?.role !== "assistant") {
      continue;
    }
    const content = message.content;
    if (typeof content === "string") {
      reply = content;
    } else if (Array.isArray(content)) {
      const text = content
        .filter(
          (part): part is { type: string; text: string } =>
            typeof part === "object" &&
            part !== null &&
            (part as { type?: string }).type === "text" &&
            typeof (part as { text?: unknown }).text === "string",
        )
        .map((part) => part.text)
        .join("");
      if (text) {
        reply = text;
      }
    }
  }
  return reply;
}
