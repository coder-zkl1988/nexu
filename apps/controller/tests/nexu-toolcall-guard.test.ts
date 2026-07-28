import path from "node:path";
import { pathToFileURL } from "node:url";
import { describe, expect, it, vi } from "vitest";

type HookHandler = (
  event: Record<string, unknown>,
  context: Record<string, unknown>,
) => Promise<unknown> | unknown;

type RuntimePlugin = {
  register: (api: {
    pluginConfig: Record<string, unknown>;
    logger: { info: ReturnType<typeof vi.fn>; warn: ReturnType<typeof vi.fn> };
    on: (name: string, handler: HookHandler) => void;
  }) => void;
};

async function loadHooks(
  pluginConfig: Record<string, unknown> = {},
): Promise<Map<string, HookHandler>> {
  const pluginUrl = pathToFileURL(
    path.resolve(
      process.cwd(),
      "static/runtime-plugins/nexu-toolcall-guard/index.js",
    ),
  ).href;
  const imported: unknown = await import(pluginUrl);
  if (typeof imported !== "object" || imported === null) {
    throw new Error("Tool call guard module did not load");
  }
  const plugin = Reflect.get(imported, "default") as RuntimePlugin | undefined;
  if (!plugin) {
    throw new Error("Tool call guard default export is missing");
  }

  const handlers = new Map<string, HookHandler>();
  plugin.register({
    pluginConfig,
    logger: { info: vi.fn(), warn: vi.fn() },
    on: (name, handler) => handlers.set(name, handler),
  });
  return handlers;
}

async function loadBeforeToolCallHook(
  pluginConfig: Record<string, unknown> = {},
): Promise<HookHandler> {
  const beforeToolCall = (await loadHooks(pluginConfig)).get(
    "before_tool_call",
  );
  if (!beforeToolCall)
    throw new Error("before_tool_call hook was not registered");
  return beforeToolCall;
}

describe("nexu-toolcall-guard local automation policy", () => {
  it("allows browser control from desktop main and local UUID sessions", async () => {
    const beforeToolCall = await loadBeforeToolCallHook();

    await expect(
      beforeToolCall(
        { toolName: "browser", params: {} },
        { sessionKey: "agent:bot-1:main", runId: "run-1" },
      ),
    ).resolves.toBeUndefined();
    await expect(
      beforeToolCall(
        { toolName: "peekaboo__click", params: {} },
        {
          sessionKey: "agent:bot-1:123e4567-e89b-12d3-a456-426614174000",
          runId: "run-2",
        },
      ),
    ).resolves.toBeUndefined();
  });

  it("blocks browser and platform MCP tools from external channels", async () => {
    const beforeToolCall = await loadBeforeToolCallHook();

    const browserResult = await beforeToolCall(
      { toolName: "browser", params: {} },
      {
        sessionKey: "agent:bot-1:slack:channel:C123",
        channelId: "C123",
      },
    );
    const cuaResult = await beforeToolCall(
      { toolName: "cua-driver__click", params: {} },
      {},
    );

    expect(browserResult).toMatchObject({ block: true });
    expect(cuaResult).toMatchObject({ block: true });
  });

  it("does not affect unrelated tools", async () => {
    const beforeToolCall = await loadBeforeToolCallHook();

    await expect(
      beforeToolCall(
        { toolName: "message", params: {} },
        { channelId: "C123" },
      ),
    ).resolves.toBeUndefined();
  });

  it("blocks backend tools outside the reviewed local automation surface", async () => {
    const beforeToolCall = await loadBeforeToolCallHook();

    for (const toolName of [
      "peekaboo__agent",
      "peekaboo__browser",
      "peekaboo__paste",
      "cua-driver__run_shell",
    ]) {
      await expect(
        beforeToolCall(
          { toolName, params: {} },
          { sessionKey: "agent:bot-1:main" },
        ),
      ).resolves.toMatchObject({ block: true });
    }

    await expect(
      beforeToolCall(
        {
          toolName: "peekaboo__list",
          params: { item_type: "running_applications" },
        },
        { sessionKey: "agent:bot-1:main" },
      ),
    ).resolves.toBeUndefined();
  });

  it("blocks external host control and defers desktop policy to config", async () => {
    const beforeToolCall = await loadBeforeToolCallHook();

    for (const toolName of ["exec", "process", "gateway", "nodes", "cron"]) {
      await expect(
        beforeToolCall(
          { toolName, params: { action: "status" } },
          {
            sessionKey: "agent:bot-1:slack:channel:C123",
            channelId: "C123",
          },
        ),
      ).resolves.toMatchObject({ block: true });

      await expect(
        beforeToolCall(
          { toolName, params: { action: "status" } },
          { sessionKey: "agent:bot-1:main" },
        ),
      ).resolves.toBeUndefined();
    }
  });
});

describe("nexu-toolcall-guard computer-use completion evidence", () => {
  it("rewrites a completion claim when the same-target observation fails", async () => {
    const hooks = await loadHooks();
    const afterToolCall = hooks.get("after_tool_call");
    const beforeMessageWrite = hooks.get("before_message_write");
    expect(afterToolCall).toBeDefined();
    expect(beforeMessageWrite).toBeDefined();

    const context = {
      runId: "run-unverified",
      sessionKey: "agent:bot-1:main",
    };
    await afterToolCall?.(
      {
        toolName: "peekaboo__type",
        params: {
          app: "PID:18609",
          element_id: "search-field",
          text: "锦鲤",
        },
        result: '[ok] Typed "锦鲤"',
      },
      context,
    );
    await afterToolCall?.(
      {
        toolName: "peekaboo__see",
        params: { app_target: "PID:18609" },
        error: "Operation timed out",
      },
      context,
    );

    const result = await beforeMessageWrite?.(
      {
        message: {
          role: "assistant",
          content: [{ type: "text", text: "已完成搜索。" }],
          stopReason: "stop",
        },
      },
      { sessionKey: context.sessionKey },
    );

    expect(result).toMatchObject({
      message: {
        role: "assistant",
        content: [
          {
            type: "text",
            text: expect.stringContaining("未确认完成"),
          },
        ],
      },
    });
  });

  it("appends a caveat instead of replacing the reply when only a click is unverified", async () => {
    const hooks = await loadHooks();
    const afterToolCall = hooks.get("after_tool_call");
    const beforeMessageWrite = hooks.get("before_message_write");
    const context = {
      runId: "run-click-advisory",
      sessionKey: "agent:bot-advisory:main",
    };

    // Real cua-driver 0.12.6 macOS click output: explicitly unverifiable.
    await afterToolCall?.(
      {
        toolName: "cua-driver__click",
        params: { pid: 61227, x: 600, y: 400 },
        result: {
          content: [{ type: "text", text: "\u2705 Posted click to pid 61227" }],
          structuredContent: {
            effect: "unverifiable",
            path: "cgevent",
            verified: false,
          },
        },
      },
      context,
    );

    const result = await beforeMessageWrite?.(
      {
        message: {
          role: "assistant",
          content: [
            {
              type: "text",
              text: "\u5df2\u70b9\u51fb\u63d0\u4ea4\u6309\u94ae\u3002",
            },
          ],
          stopReason: "stop",
        },
      },
      { sessionKey: context.sessionKey },
    );

    const content = (
      result as { message: { content: Array<{ text: string }> } }
    ).message.content;
    // The original answer survives; the caveat is added after it.
    expect(content).toHaveLength(2);
    expect(content[0]?.text).toBe(
      "\u5df2\u70b9\u51fb\u63d0\u4ea4\u6309\u94ae\u3002",
    );
    expect(content[1]?.text).toContain(
      "\u65e0\u6cd5\u88ab\u7cfb\u7edf\u9a8c\u8bc1",
    );
    expect(content[1]?.text).not.toContain("\u672a\u786e\u8ba4\u5b8c\u6210");
  });

  it("preserves the final answer after fresh same-target state evidence", async () => {
    const hooks = await loadHooks();
    const afterToolCall = hooks.get("after_tool_call");
    const beforeMessageWrite = hooks.get("before_message_write");
    const context = {
      runId: "run-verified",
      sessionKey: "agent:bot-1:main",
    };

    await afterToolCall?.(
      {
        toolName: "peekaboo__type",
        params: {
          app: "PID:18609",
          element_id: "search-field",
          text: "锦鲤",
        },
        result: '[ok] Typed "锦鲤"',
      },
      context,
    );
    await afterToolCall?.(
      {
        toolName: "peekaboo__see",
        params: { app_target: "PID:18609" },
        result: {
          elements: [{ element_id: "search-field", value: "锦鲤" }],
        },
      },
      context,
    );

    expect(
      beforeMessageWrite?.(
        {
          message: {
            role: "assistant",
            content: [{ type: "text", text: "已完成搜索。" }],
            stopReason: "stop",
          },
        },
        { sessionKey: context.sessionKey },
      ),
    ).toBeUndefined();
  });

  it("does not accept a successful observation of a different app", async () => {
    const hooks = await loadHooks();
    const afterToolCall = hooks.get("after_tool_call");
    const beforeMessageWrite = hooks.get("before_message_write");
    const context = {
      runId: "run-wrong-target",
      sessionKey: "agent:bot-2:main",
    };

    await afterToolCall?.(
      {
        toolName: "cua-driver__type_text",
        params: { app: "com.electron.lark", text: "锦鲤" },
        result: { ok: true },
      },
      context,
    );
    await afterToolCall?.(
      {
        toolName: "cua-driver__get_window_state",
        params: { app: "com.apple.Safari" },
        result: { snapshot: { title: "Safari" } },
      },
      context,
    );

    const result = await beforeMessageWrite?.(
      {
        message: {
          role: "assistant",
          content: [{ type: "text", text: "已完成。" }],
          stopReason: "stop",
        },
      },
      { sessionKey: context.sessionKey },
    );
    expect(result).toMatchObject({ message: { role: "assistant" } });
  });

  it("does not let a different successful action hide an earlier failure", async () => {
    const hooks = await loadHooks();
    const afterToolCall = hooks.get("after_tool_call");
    const beforeMessageWrite = hooks.get("before_message_write");
    const context = {
      runId: "run-failure-hidden",
      sessionKey: "agent:bot-3:main",
    };

    await afterToolCall?.(
      {
        toolName: "peekaboo__type",
        params: { app: "飞书", text: "锦鲤" },
        error: "input failed",
      },
      context,
    );
    await afterToolCall?.(
      {
        toolName: "peekaboo__click",
        params: { app: "飞书", x: 100, y: 120 },
        result: { ok: true },
      },
      context,
    );
    await afterToolCall?.(
      {
        toolName: "peekaboo__see",
        params: { app: "飞书" },
        result: { ok: true },
      },
      context,
    );

    const result = await beforeMessageWrite?.(
      {
        message: {
          role: "assistant",
          content: [{ type: "text", text: "已完成。" }],
          stopReason: "stop",
        },
      },
      { sessionKey: context.sessionKey },
    );
    expect(result).toMatchObject({
      message: {
        content: [
          { type: "text", text: expect.stringContaining("未确认完成") },
        ],
      },
    });
  });

  it("does not accept state evidence that lacks the expected input value", async () => {
    const hooks = await loadHooks();
    const afterToolCall = hooks.get("after_tool_call");
    const beforeMessageWrite = hooks.get("before_message_write");
    const context = {
      runId: "run-value-missing",
      sessionKey: "agent:bot-4:main",
    };

    await afterToolCall?.(
      {
        toolName: "peekaboo__type",
        params: {
          app: "飞书",
          element_id: "search-field",
          text: "锦鲤",
        },
        result: { ok: true },
      },
      context,
    );
    await afterToolCall?.(
      {
        toolName: "peekaboo__hotkey",
        params: { app: "飞书", keys: "return" },
        result: { ok: true },
      },
      context,
    );
    await afterToolCall?.(
      {
        toolName: "peekaboo__see",
        params: { app: "飞书" },
        result: {
          elements: [
            { element_id: "search-field", value: "" },
            { element_id: "other", text: "锦鲤" },
          ],
        },
      },
      context,
    );

    const result = await beforeMessageWrite?.(
      {
        message: {
          role: "assistant",
          content: [{ type: "text", text: "已完成。" }],
          stopReason: "stop",
        },
      },
      { sessionKey: context.sessionKey },
    );
    expect(result).toMatchObject({ message: { role: "assistant" } });
  });

  it("does not accept same-target observation as proof of a click", async () => {
    const hooks = await loadHooks();
    const afterToolCall = hooks.get("after_tool_call");
    const beforeMessageWrite = hooks.get("before_message_write");
    const context = {
      runId: "run-click-unchanged",
      sessionKey: "agent:bot-click:main",
    };

    await afterToolCall?.(
      {
        toolName: "peekaboo__click",
        params: { app: "Safari", on: "submit-button" },
        result: { ok: true },
      },
      context,
    );
    await afterToolCall?.(
      {
        toolName: "peekaboo__inspect_ui",
        params: { app_target: "Safari" },
        result: {
          content: [
            { type: "text", text: "UI unchanged; button still present" },
          ],
        },
      },
      context,
    );

    expect(
      beforeMessageWrite?.(
        {
          message: {
            role: "assistant",
            content: [{ type: "text", text: "已点击。" }],
            stopReason: "stop",
          },
        },
        { sessionKey: context.sessionKey },
      ),
    ).toMatchObject({ message: { role: "assistant" } });
  });

  it("tracks Dock show and ignores static labels as value evidence", async () => {
    const hooks = await loadHooks();
    const afterToolCall = hooks.get("after_tool_call");
    const beforeMessageWrite = hooks.get("before_message_write");

    const dockContext = {
      runId: "run-dock-show",
      sessionKey: "agent:bot-dock:main",
    };
    await afterToolCall?.(
      {
        toolName: "peekaboo__dock",
        params: { action: "show" },
        result: { ok: true },
      },
      dockContext,
    );
    expect(
      beforeMessageWrite?.(
        {
          message: {
            role: "assistant",
            content: [{ type: "text", text: "Dock 已显示。" }],
            stopReason: "stop",
          },
        },
        { sessionKey: dockContext.sessionKey },
      ),
    ).toMatchObject({ message: { role: "assistant" } });

    const appContext = {
      runId: "run-app-quit",
      sessionKey: "agent:bot-app:main",
    };
    await afterToolCall?.(
      {
        toolName: "peekaboo__app",
        params: { action: "quit", name: "TextEdit" },
        result: { ok: true },
      },
      appContext,
    );
    expect(
      beforeMessageWrite?.(
        {
          message: {
            role: "assistant",
            content: [{ type: "text", text: "TextEdit 已退出。" }],
            stopReason: "stop",
          },
        },
        { sessionKey: appContext.sessionKey },
      ),
    ).toMatchObject({ message: { role: "assistant" } });

    const labelContext = {
      runId: "run-label-only",
      sessionKey: "agent:bot-label:main",
    };
    await afterToolCall?.(
      {
        toolName: "peekaboo__type",
        params: { app: "Safari", on: "search-field", text: "Search" },
        result: { ok: true },
      },
      labelContext,
    );
    await afterToolCall?.(
      {
        toolName: "peekaboo__inspect_ui",
        params: { app_target: "Safari" },
        result: {
          elements: [
            { element_id: "search-field", label: "Search", value: "" },
          ],
        },
      },
      labelContext,
    );
    expect(
      beforeMessageWrite?.(
        {
          message: {
            role: "assistant",
            content: [{ type: "text", text: "已输入。" }],
            stopReason: "stop",
          },
        },
        { sessionKey: labelContext.sessionKey },
      ),
    ).toMatchObject({ message: { role: "assistant" } });
  });

  it("accepts real Peekaboo refs and cua-driver 0.12.6 verification", async () => {
    const hooks = await loadHooks();
    const afterToolCall = hooks.get("after_tool_call");
    const beforeMessageWrite = hooks.get("before_message_write");

    const peekabooContext = {
      runId: "run-peekaboo-on",
      sessionKey: "agent:bot-peekaboo:main",
    };
    await afterToolCall?.(
      {
        toolName: "peekaboo__set_value",
        params: {
          on: "search-field",
          snapshot: "snapshot-1",
          value: "锦鲤",
        },
        result: { ok: true },
      },
      peekabooContext,
    );
    await afterToolCall?.(
      {
        toolName: "peekaboo__inspect_ui",
        params: { app_target: "Safari", snapshot: "snapshot-1" },
        result: {
          content: [
            {
              type: "text",
              text: 'search-field text field value="锦鲤"',
            },
          ],
        },
      },
      peekabooContext,
    );
    expect(
      beforeMessageWrite?.(
        {
          message: {
            role: "assistant",
            content: [{ type: "text", text: "已输入。" }],
            stopReason: "stop",
          },
        },
        { sessionKey: peekabooContext.sessionKey },
      ),
    ).toBeUndefined();

    const verifiedContext = {
      runId: "run-provider-verified",
      sessionKey: "agent:bot-verified:main",
    };
    await afterToolCall?.(
      {
        toolName: "cua-driver__set_value",
        params: { app: "Notepad", element_index: 3, value: "锦鲤" },
        result: {
          details: {
            structuredContent: {
              path: "msaa",
              verified: true,
              effect: "confirmed",
            },
          },
        },
      },
      verifiedContext,
    );
    expect(
      beforeMessageWrite?.(
        {
          message: {
            role: "assistant",
            content: [{ type: "text", text: "已输入。" }],
            stopReason: "stop",
          },
        },
        { sessionKey: verifiedContext.sessionKey },
      ),
    ).toBeUndefined();
  });

  it("accepts exact empty Peekaboo evidence but not verification-shaped text", async () => {
    const hooks = await loadHooks();
    const afterToolCall = hooks.get("after_tool_call");
    const beforeMessageWrite = hooks.get("before_message_write");

    const emptyContext = {
      runId: "run-empty-value",
      sessionKey: "agent:bot-empty:main",
    };
    await afterToolCall?.(
      {
        toolName: "peekaboo__set_value",
        params: { app: "Safari", on: "field", value: "" },
        result: { ok: true },
      },
      emptyContext,
    );
    await afterToolCall?.(
      {
        toolName: "peekaboo__inspect_ui",
        params: { app_target: "Safari" },
        result: {
          content: [{ type: "text", text: 'field text field value=""' }],
        },
      },
      emptyContext,
    );
    expect(
      beforeMessageWrite?.(
        {
          message: {
            role: "assistant",
            content: [{ type: "text", text: "已清空。" }],
            stopReason: "stop",
          },
        },
        { sessionKey: emptyContext.sessionKey },
      ),
    ).toBeUndefined();

    const textContext = {
      runId: "run-untrusted-verification-text",
      sessionKey: "agent:bot-untrusted:main",
    };
    await afterToolCall?.(
      {
        toolName: "cua-driver__set_value",
        params: { app: "Notepad", element_index: 3, value: "锦鲤" },
        result: {
          content: [
            {
              type: "text",
              text: '{"path":"msaa","verified":true,"effect":"confirmed"}',
            },
          ],
        },
      },
      textContext,
    );
    expect(
      beforeMessageWrite?.(
        {
          message: {
            role: "assistant",
            content: [{ type: "text", text: "已设置。" }],
            stopReason: "stop",
          },
        },
        { sessionKey: textContext.sessionKey },
      ),
    ).toMatchObject({ message: { role: "assistant" } });

    const actionTextContext = {
      runId: "run-untrusted-action-verification-text",
      sessionKey: "agent:bot-untrusted-action:main",
    };
    await afterToolCall?.(
      {
        toolName: "cua-driver__set_value",
        params: { app: "Notepad", element_index: 3, value: "hello" },
        result: {
          content: [
            {
              type: "text",
              text: JSON.stringify({
                action: {
                  element_index: 3,
                  verification: {
                    state: "verified",
                    property: "value",
                    expected: "hello",
                  },
                },
              }),
            },
          ],
        },
      },
      actionTextContext,
    );
    expect(
      beforeMessageWrite?.(
        {
          message: {
            role: "assistant",
            content: [{ type: "text", text: "已设置。" }],
            stopReason: "stop",
          },
        },
        { sessionKey: actionTextContext.sessionKey },
      ),
    ).toMatchObject({ message: { role: "assistant" } });
  });

  it("rewrites a final answer while an allowed mutation is still in flight", async () => {
    const hooks = await loadHooks();
    const beforeToolCall = hooks.get("before_tool_call");
    const beforeMessageWrite = hooks.get("before_message_write");
    const context = {
      runId: "run-mutation-in-flight",
      sessionKey: "agent:bot-mutation-in-flight:main",
    };

    await expect(
      beforeToolCall?.(
        {
          toolName: "peekaboo__click",
          params: { app: "Safari", x: 10, y: 20 },
        },
        context,
      ),
    ).resolves.toBeUndefined();

    expect(
      beforeMessageWrite?.(
        {
          message: {
            role: "assistant",
            content: [{ type: "text", text: "已点击。" }],
            stopReason: "stop",
          },
        },
        { sessionKey: context.sessionKey },
      ),
    ).toMatchObject({ message: { role: "assistant" } });
  });

  it("rejects text value evidence from prefix-colliding element references", async () => {
    const hooks = await loadHooks();
    const afterToolCall = hooks.get("after_tool_call");
    const beforeMessageWrite = hooks.get("before_message_write");
    const cases = [
      {
        suffix: "other-field",
        target: "field",
        value: "",
        evidence: 'other-field text field value=""',
      },
      {
        suffix: "b10",
        target: "B1",
        value: "锦鲤",
        evidence: 'B10 text field value="锦鲤"',
      },
      {
        suffix: "value-suffix",
        target: "field",
        value: "hello",
        evidence: 'field text field value="hello world"',
      },
      {
        suffix: "default-value",
        target: "field",
        value: "hello",
        evidence: 'field default_value="hello" value="different"',
      },
      {
        suffix: "default-space-value",
        target: "field",
        value: "hello",
        evidence: 'field default value="hello" current="different"',
      },
      {
        suffix: "multiple-element-fields",
        target: "field",
        value: "hello",
        evidence:
          'element_id="field", value="wrong"; element_id="other", value="hello"',
      },
    ];

    for (const testCase of cases) {
      const context = {
        runId: `run-${testCase.suffix}`,
        sessionKey: `agent:bot-${testCase.suffix}:main`,
      };
      await afterToolCall?.(
        {
          toolName: "peekaboo__set_value",
          params: {
            app: "Safari",
            on: testCase.target,
            value: testCase.value,
          },
          result: { ok: true },
        },
        context,
      );
      await afterToolCall?.(
        {
          toolName: "peekaboo__inspect_ui",
          params: { app_target: "Safari" },
          result: {
            content: [{ type: "text", text: testCase.evidence }],
          },
        },
        context,
      );

      expect(
        beforeMessageWrite?.(
          {
            message: {
              role: "assistant",
              content: [{ type: "text", text: "已设置。" }],
              stopReason: "stop",
            },
          },
          { sessionKey: context.sessionKey },
        ),
      ).toMatchObject({ message: { role: "assistant" } });
    }
  });

  it("rejects weak value evidence and leaves read-only browser calls alone", async () => {
    const hooks = await loadHooks();
    const afterToolCall = hooks.get("after_tool_call");
    const beforeMessageWrite = hooks.get("before_message_write");

    const substringContext = {
      runId: "run-substring-value",
      sessionKey: "agent:bot-substring:main",
    };
    await afterToolCall?.(
      {
        toolName: "peekaboo__set_value",
        params: { app: "Safari", on: "field", value: "锦" },
        result: { ok: true },
      },
      substringContext,
    );
    await afterToolCall?.(
      {
        toolName: "peekaboo__inspect_ui",
        params: { app_target: "Safari" },
        result: { elements: [{ element_id: "field", value: "旧锦鲤" }] },
      },
      substringContext,
    );
    expect(
      beforeMessageWrite?.(
        {
          message: {
            role: "assistant",
            content: [{ type: "text", text: "已设置。" }],
            stopReason: "stop",
          },
        },
        { sessionKey: substringContext.sessionKey },
      ),
    ).toMatchObject({ message: { role: "assistant" } });

    const mismatchContext = {
      runId: "run-mismatched-verification",
      sessionKey: "agent:bot-mismatch:main",
    };
    await afterToolCall?.(
      {
        toolName: "cua-driver__set_value",
        params: { app: "Notepad", element_index: 3, value: "锦鲤" },
        result: {
          action: {
            verification: {
              state: "verified",
              property: "value",
              expected: "完全不同",
            },
          },
        },
      },
      mismatchContext,
    );
    expect(
      beforeMessageWrite?.(
        {
          message: {
            role: "assistant",
            content: [{ type: "text", text: "已设置。" }],
            stopReason: "stop",
          },
        },
        { sessionKey: mismatchContext.sessionKey },
      ),
    ).toMatchObject({ message: { role: "assistant" } });

    const missingElementContext = {
      runId: "run-missing-verification-element",
      sessionKey: "agent:bot-missing-element:main",
    };
    await afterToolCall?.(
      {
        toolName: "cua-driver__set_value",
        params: { app: "Notepad", element_index: 3, value: "hello" },
        result: {
          action: {
            verification: {
              state: "verified",
              property: "value",
              expected: "hello",
            },
          },
        },
      },
      missingElementContext,
    );
    expect(
      beforeMessageWrite?.(
        {
          message: {
            role: "assistant",
            content: [{ type: "text", text: "已设置。" }],
            stopReason: "stop",
          },
        },
        { sessionKey: missingElementContext.sessionKey },
      ),
    ).toMatchObject({ message: { role: "assistant" } });

    const browserContext = {
      runId: "run-browser-tabs",
      sessionKey: "agent:bot-browser:main",
    };
    await afterToolCall?.(
      {
        toolName: "browser",
        params: { action: "tabs" },
        result: { tabs: [{ id: "tab-1", title: "Example" }] },
      },
      browserContext,
    );
    expect(
      beforeMessageWrite?.(
        {
          message: {
            role: "assistant",
            content: [{ type: "text", text: "找到一个标签页。" }],
            stopReason: "stop",
          },
        },
        { sessionKey: browserContext.sessionKey },
      ),
    ).toBeUndefined();
  });

  it("ignores CUA session lifecycle calls for completion evidence", async () => {
    const hooks = await loadHooks();
    const afterToolCall = hooks.get("after_tool_call");
    const beforeMessageWrite = hooks.get("before_message_write");
    const context = {
      runId: "run-session-lifecycle",
      sessionKey: "agent:bot-5:main",
    };

    for (const toolName of [
      "cua-driver__start_session",
      "cua-driver__escalate_session",
      "cua-driver__end_session",
    ]) {
      await afterToolCall?.(
        {
          toolName,
          params: { session_id: "session-5" },
          result: { ok: true },
        },
        context,
      );
    }

    expect(
      beforeMessageWrite?.(
        {
          message: {
            role: "assistant",
            content: [{ type: "text", text: "会话已关闭。" }],
            stopReason: "stop",
          },
        },
        { sessionKey: context.sessionKey },
      ),
    ).toBeUndefined();
  });

  it("keeps targetless and separate-window actions pending", async () => {
    const hooks = await loadHooks();
    const afterToolCall = hooks.get("after_tool_call");
    const beforeMessageWrite = hooks.get("before_message_write");

    const targetlessContext = {
      runId: "run-targetless",
      sessionKey: "agent:bot-6:main",
    };
    await afterToolCall?.(
      {
        toolName: "peekaboo__click",
        params: { x: 100, y: 120 },
        result: { ok: true },
      },
      targetlessContext,
    );
    await afterToolCall?.(
      {
        toolName: "peekaboo__see",
        params: { app_target: "frontmost" },
        result: { tree: "frontmost app" },
      },
      targetlessContext,
    );
    expect(
      beforeMessageWrite?.(
        {
          message: {
            role: "assistant",
            content: [{ type: "text", text: "已完成。" }],
            stopReason: "stop",
          },
        },
        { sessionKey: targetlessContext.sessionKey },
      ),
    ).toMatchObject({ message: { role: "assistant" } });

    for (const testCase of [
      {
        suffix: "native",
        params: { element_index: 3, value: "hello" },
        result: { verified: true },
      },
      {
        suffix: "enriched",
        params: { app: "frontmost", element_index: 3, value: "hello" },
        result: {
          action: {
            element_index: 3,
            verification: {
              state: "verified",
              property: "value",
              expected: "hello",
            },
          },
        },
      },
    ]) {
      const providerContext = {
        runId: `run-targetless-provider-${testCase.suffix}`,
        sessionKey: `agent:bot-targetless-provider-${testCase.suffix}:main`,
      };
      await afterToolCall?.(
        {
          toolName: "cua-driver__set_value",
          params: testCase.params,
          result: testCase.result,
        },
        providerContext,
      );
      expect(
        beforeMessageWrite?.(
          {
            message: {
              role: "assistant",
              content: [{ type: "text", text: "已设置。" }],
              stopReason: "stop",
            },
          },
          { sessionKey: providerContext.sessionKey },
        ),
      ).toMatchObject({ message: { role: "assistant" } });
    }

    const windowContext = {
      runId: "run-separate-windows",
      sessionKey: "agent:bot-7:main",
    };
    for (const [toolCall, params] of [
      ["click", { app: "Safari", window_id: 1, x: 100, y: 120 }],
      ["click", { app: "Safari", window_id: 2, x: 200, y: 220 }],
      ["see", { app: "Safari", window_id: 2 }],
    ] as const) {
      await afterToolCall?.(
        {
          toolName: `peekaboo__${toolCall}`,
          params,
          result: { ok: true },
        },
        windowContext,
      );
    }
    expect(
      beforeMessageWrite?.(
        {
          message: {
            role: "assistant",
            content: [{ type: "text", text: "已完成。" }],
            stopReason: "stop",
          },
        },
        { sessionKey: windowContext.sessionKey },
      ),
    ).toMatchObject({ message: { role: "assistant" } });
  });

  it("accepts Windows launch evidence by the returned pid", async () => {
    const hooks = await loadHooks();
    const afterToolCall = hooks.get("after_tool_call");
    const beforeMessageWrite = hooks.get("before_message_write");
    const context = {
      runId: "run-launch-alias",
      sessionKey: "agent:bot-8:main",
    };

    await afterToolCall?.(
      {
        toolName: "cua-driver__launch_app",
        params: { name: "Notepad" },
        result: { pid: 123, windows: [{ window_id: 7 }] },
      },
      context,
    );
    await afterToolCall?.(
      {
        toolName: "cua-driver__get_window_state",
        params: { pid: 123 },
        result: { pid: 123, window_id: 7, title: "Untitled - Notepad" },
      },
      context,
    );

    expect(
      beforeMessageWrite?.(
        {
          message: {
            role: "assistant",
            content: [{ type: "text", text: "已打开记事本。" }],
            stopReason: "stop",
          },
        },
        { sessionKey: context.sessionKey },
      ),
    ).toBeUndefined();
  });
});
