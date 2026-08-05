import path from "node:path";
import { pathToFileURL } from "node:url";
import { describe, expect, it, vi } from "vitest";
import {
  isDesktopSessionKey,
  mintDerivedSessionKey,
} from "../src/lib/desktop-session-key.js";

// The desktop session-key shape is declared twice and the two cannot import
// each other: once in src/lib/desktop-session-key.ts (used when minting keys)
// and once inside the nexu-toolcall-guard runtime plugin (used when deciding
// whether a run may drive browser control and the runtime control plane).
//
// Drift is silent and one-directional in the dangerous way: a key the
// controller considers non-desktop but the guard considers desktop hands a
// channel conversation the desktop-only tool surface. These tests drive the
// plugin's real hook so the assertion tracks behaviour, not a copied constant.

type HookHandler = (
  event: Record<string, unknown>,
  context: Record<string, unknown>,
) => Promise<unknown> | unknown;

async function loadBeforeToolCall(): Promise<HookHandler> {
  const pluginUrl = pathToFileURL(
    path.resolve(
      process.cwd(),
      "static/runtime-plugins/nexu-toolcall-guard/index.js",
    ),
  ).href;
  const imported: unknown = await import(pluginUrl);
  const plugin = Reflect.get(imported as Record<string, unknown>, "default") as
    | {
        register: (api: {
          pluginConfig: Record<string, unknown>;
          logger: {
            info: ReturnType<typeof vi.fn>;
            warn: ReturnType<typeof vi.fn>;
          };
          on: (name: string, handler: HookHandler) => void;
        }) => void;
      }
    | undefined;
  if (!plugin) throw new Error("Tool call guard default export is missing");

  const handlers = new Map<string, HookHandler>();
  plugin.register({
    pluginConfig: {},
    logger: { info: vi.fn(), warn: vi.fn() },
    on: (name, handler) => handlers.set(name, handler),
  });
  const hook = handlers.get("before_tool_call");
  if (!hook) throw new Error("before_tool_call hook was not registered");
  return hook;
}

const DESKTOP_ONLY_TOOL = "browser_click";

describe("desktop session key parity", () => {
  it("agrees with the guard on which keys are desktop-shaped", async () => {
    const beforeToolCall = await loadBeforeToolCall();

    const keys = [
      "agent:bot-1:main",
      "agent:bot-1:0f8fad5b-d9cb-469f-a165-70867728950e",
      "agent:bot-1:fork:0f8fad5b-d9cb-469f-a165-70867728950e",
      "agent:bot-1:branch:0f8fad5b-d9cb-469f-a165-70867728950e",
      "agent:bot-1:slack:channel:C123",
      "agent:bot-1:cron:daily",
      "subagent:bot-1:worker-2",
    ];

    for (const sessionKey of keys) {
      const guardAllows =
        (await beforeToolCall(
          { toolName: DESKTOP_ONLY_TOOL, params: {} },
          { sessionKey },
        )) === undefined;
      expect(
        guardAllows,
        `guard and controller disagree about ${sessionKey}`,
      ).toBe(isDesktopSessionKey(sessionKey));
    }
  });

  it("does not let a channel session be forked into desktop shape", async () => {
    const beforeToolCall = await loadBeforeToolCall();
    const channelParent = "agent:bot-1:slack:channel:C123";

    for (const kind of ["fork", "branch"] as const) {
      const derived = mintDerivedSessionKey("bot-1", channelParent, kind);
      expect(isDesktopSessionKey(derived)).toBe(false);
      await expect(
        beforeToolCall(
          { toolName: DESKTOP_ONLY_TOOL, params: {} },
          { sessionKey: derived },
        ),
      ).resolves.toMatchObject({ block: true });
    }
  });

  it("keeps desktop-parent forks on the desktop surface", async () => {
    const beforeToolCall = await loadBeforeToolCall();

    for (const kind of ["fork", "branch"] as const) {
      const derived = mintDerivedSessionKey("bot-1", "agent:bot-1:main", kind);
      expect(isDesktopSessionKey(derived)).toBe(true);
      await expect(
        beforeToolCall(
          { toolName: DESKTOP_ONLY_TOOL, params: {} },
          { sessionKey: derived },
        ),
      ).resolves.toBeUndefined();
    }
  });
});
