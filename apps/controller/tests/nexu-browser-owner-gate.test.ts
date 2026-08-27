import path from "node:path";
import { pathToFileURL } from "node:url";
import { afterEach, describe, expect, it, vi } from "vitest";

// The nexu-browser plugin keeps its own fail-closed copy of the browser
// origin gate (channel-shaped sessions are rejected unless whitelisted as the
// paired owner's Feishu DM). These tests drive the real plugin: register with
// a pluginConfig, replay before_tool_call to stash the call context, then
// invoke the tool handler and observe whether the command POST happens.

type Hook = (
  event: Record<string, unknown>,
  ctx: Record<string, unknown>,
) => unknown;

type Tool = {
  name: string;
  execute: (
    toolCallId: string,
    params: Record<string, unknown>,
  ) => Promise<{ content: Array<{ text: string }> }>;
};

async function loadPlugin(pluginConfig: Record<string, unknown>) {
  const pluginUrl = pathToFileURL(
    path.resolve(process.cwd(), "static/runtime-plugins/nexu-browser/index.js"),
  ).href;
  const imported: unknown = await import(pluginUrl);
  const plugin = Reflect.get(imported as Record<string, unknown>, "default") as
    | {
        register: (api: {
          pluginConfig: Record<string, unknown>;
          logger: { info: ReturnType<typeof vi.fn> };
          on: (name: string, hook: Hook) => void;
          registerTool: (
            factory: () => Tool[],
            opts?: Record<string, unknown>,
          ) => void;
        }) => void;
      }
    | undefined;
  if (!plugin) throw new Error("nexu-browser default export is missing");

  const hooks = new Map<string, Hook>();
  const tools: Tool[] = [];
  plugin.register({
    pluginConfig,
    logger: { info: vi.fn() },
    on: (name, hook) => hooks.set(name, hook),
    // The plugin registers a factory returning the tool array (see
    // registerBrowserTools in the plugin); expand it like OpenClaw would.
    registerTool: (factory) => tools.push(...factory()),
  });
  const beforeToolCall = hooks.get("before_tool_call");
  if (!beforeToolCall) throw new Error("before_tool_call was not registered");
  const open = tools.find((tool) => tool.name === "browser_open");
  if (!open) throw new Error("browser_open was not registered");
  return { beforeToolCall, open };
}

const OWNER_KEY = "agent:bot-1:direct:ou_owner";

async function runOpen(
  pluginConfig: Record<string, unknown>,
  ctx: Record<string, unknown>,
): Promise<{ text: string; fetched: boolean }> {
  const { beforeToolCall, open } = await loadPlugin(pluginConfig);
  const fetchMock = vi.fn(async () => ({
    ok: true,
    json: async () => ({ observation: { title: "t", url: "u" } }),
  }));
  vi.stubGlobal("fetch", fetchMock);
  const toolCallId = `call-${Math.random()}`;
  beforeToolCall({ toolName: "browser_open", toolCallId }, ctx);
  const result = await open.execute(toolCallId, { url: "https://example.com" });
  return {
    text: result.content[0]?.text ?? "",
    fetched: fetchMock.mock.calls.length > 0,
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("nexu-browser owner-DM gate", () => {
  it("lets a whitelisted owner DM through to the controller", async () => {
    const { text, fetched } = await runOpen(
      {
        controllerUrl: "http://127.0.0.1:9",
        browserOwnerSessions: [OWNER_KEY],
      },
      { sessionKey: OWNER_KEY, channelId: "feishu" },
    );
    expect(fetched).toBe(true);
    expect(text).not.toContain("desktop main session");
  });

  it("still rejects a channel session that is not whitelisted", async () => {
    const { text, fetched } = await runOpen(
      {
        controllerUrl: "http://127.0.0.1:9",
        browserOwnerSessions: [OWNER_KEY],
      },
      { sessionKey: "agent:bot-1:direct:ou_stranger", channelId: "feishu" },
    );
    expect(fetched).toBe(false);
    expect(text).toContain("desktop main session");
  });

  it("drops non-DM shapes from the whitelist on load", async () => {
    // A mis-compiled group or fork entry must not widen the gate.
    const forkKey = "agent:bot-1:fork:0f8fad5b-d9cb-469f-a165-70867728950e";
    const { text, fetched } = await runOpen(
      {
        controllerUrl: "http://127.0.0.1:9",
        browserOwnerSessions: [forkKey],
      },
      { sessionKey: forkKey, channelId: "feishu" },
    );
    expect(fetched).toBe(false);
    expect(text).toContain("desktop main session");
  });
});
