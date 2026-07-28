import path from "node:path";
import { pathToFileURL } from "node:url";
import { describe, expect, it, vi } from "vitest";
import { CUA_TOOL_FILTER } from "../src/lib/openclaw-config-compiler.js";

// The Computer Use surface is declared in two places that cannot import each
// other: the compiled MCP `toolFilter.include` list (openclaw-config-compiler)
// and the independent `before_tool_call` allowlist inside the
// nexu-toolcall-guard runtime plugin. Drift between them is silent — a tool
// exposed by the filter but missing from the plugin allowlist is dead on
// arrival, and a tool allowed by the plugin but absent from the filter is an
// unreviewed capability waiting for someone to widen the filter.
//
// These tests drive the plugin through its real hook so the assertion tracks
// behaviour rather than a copied constant.

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
  const beforeToolCall = handlers.get("before_tool_call");
  if (!beforeToolCall)
    throw new Error("before_tool_call hook is not registered");
  return beforeToolCall;
}

// A desktop main session — the only origin permitted to reach these tools at
// all. Using it isolates the allowlist decision from the session-origin gate.
const DESKTOP_MAIN_CONTEXT = {
  sessionKey: "agent:bot-parity:main",
  runId: "run-parity",
};

async function isBlocked(
  beforeToolCall: HookHandler,
  toolName: string,
): Promise<boolean> {
  const result = await beforeToolCall(
    { toolName, params: { app: "Finder" } },
    { ...DESKTOP_MAIN_CONTEXT, toolName },
  );
  return (
    typeof result === "object" &&
    result !== null &&
    Reflect.get(result, "block") === true
  );
}

// Full tool inventory reported by `tools/list` against the pinned Peekaboo
// 3.9.8 MCP server. Anything here that is not in PEEKABOO_TOOL_FILTER is
// deliberately unreviewed and must stay blocked — `agent` is a nested agent
// loop, `browser` is remote-debugging based browser control that bypasses the
// extension pairing flow, and `clipboard`/`paste` read and write user data.
const PEEKABOO_3_9_8_SERVER_TOOLS = [
  "agent",
  "analyze",
  "app",
  "browser",
  "capture",
  "click",
  "clipboard",
  "dialog",
  "dock",
  "drag",
  "hotkey",
  "image",
  "inspect_ui",
  "list",
  "menu",
  "move",
  "paste",
  "perform_action",
  "permissions",
  "scroll",
  "see",
  "set_value",
  "sleep",
  "space",
  "swipe",
  "type",
  "window",
];

describe("local automation allowlist parity", () => {
  it("lets every compiled CUA filter entry through the plugin gate", async () => {
    const beforeToolCall = await loadBeforeToolCall();
    for (const tool of CUA_TOOL_FILTER) {
      expect(
        await isBlocked(beforeToolCall, `cua-driver__${tool}`),
        `cua-driver__${tool} is exposed by the MCP tool filter but blocked by nexu-toolcall-guard`,
      ).toBe(false);
    }
  });

  it("blocks the entire Peekaboo surface now that cua-driver is the only backend", async () => {
    const beforeToolCall = await loadBeforeToolCall();
    for (const tool of PEEKABOO_3_9_8_SERVER_TOOLS) {
      expect(
        await isBlocked(beforeToolCall, `peekaboo__${tool}`),
        `peekaboo__${tool} is no longer a reviewed surface but nexu-toolcall-guard allows it`,
      ).toBe(true);
    }
  });

  it("blocks an unknown cua-driver tool outside the compiled filter", async () => {
    const beforeToolCall = await loadBeforeToolCall();
    // Guards the guard: a filter that grew to cover everything would make the
    // negative assertions above vacuous.
    expect(CUA_TOOL_FILTER).not.toContain("run_shell");
    expect(await isBlocked(beforeToolCall, "cua-driver__run_shell")).toBe(true);
    expect(await isBlocked(beforeToolCall, "cua-driver__page")).toBe(true);
  });

  it("keeps the compiled filter free of duplicates", () => {
    expect(new Set(CUA_TOOL_FILTER).size).toBe(CUA_TOOL_FILTER.length);
  });
});
