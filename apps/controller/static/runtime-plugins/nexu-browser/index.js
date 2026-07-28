// nexu-browser runtime plugin: let the chat agent drive the browser panel
// embedded in the Nexu desktop app.
//
// Every tool POSTs to the controller, which relays the command to the desktop
// renderer's browser panel and returns what the panel saw afterwards. The
// panel is the executor, so the user always watches the agent browse — see
// apps/controller/src/routes/agent-browser-routes.ts.
//
// This plugin does not touch any browser outside the app. Control of the
// user's own Chrome was deliberately dropped: it needed an extension, a
// pairing step, and a dedicated tab group, and it still handed the agent every
// logged-in session the user had.

const ACT_PATH = "/api/v1/browser/agent/act";

/** Controller base URL, injected via plugin config by the compiler. */
let configuredControllerUrl = null;

function controllerOrigin() {
  const raw =
    configuredControllerUrl ||
    process.env.NEXU_CONTROLLER_URL ||
    process.env.CONTROLLER_URL ||
    "";
  return raw.replace(/\/+$/, "");
}

function textResult(text, isError) {
  const result = { content: [{ type: "text", text }] };
  if (isError) result.isError = true;
  return result;
}

/**
 * toolCallId -> session context captured in `before_tool_call`.
 *
 * The tool's `execute` only receives the call id and params, but the command
 * has to carry a session key: the controller refuses anything that is not the
 * desktop main session.
 */
const callContexts = new Map();
const MAX_TRACKED_CALLS = 200;

function rememberCallContext(toolCallId, ctx) {
  if (!toolCallId) return;
  callContexts.set(toolCallId, {
    sessionKey: ctx?.sessionKey ?? null,
    channelId: ctx?.channelId ?? null,
  });
  if (callContexts.size > MAX_TRACKED_CALLS) {
    const oldest = callContexts.keys().next().value;
    if (oldest !== undefined) callContexts.delete(oldest);
  }
}

/**
 * Renders a snapshot as indented lines. Cheaper than the raw JSON and easier
 * for a model to scan, while keeping every ref addressable.
 */
function renderSnapshot(snapshot) {
  const lines = [
    `${snapshot.title || "(untitled)"} — ${snapshot.url}`,
    "Elements (use the ref with browser_click / browser_type):",
  ];
  for (const node of snapshot.nodes) {
    const indent = "  ".repeat(Math.min(node.depth, 8));
    const value = node.value ? ` = ${JSON.stringify(node.value)}` : "";
    const disabled = node.disabled ? " [disabled]" : "";
    lines.push(
      `${indent}${node.ref} ${node.role} ${JSON.stringify(node.name)}${value}${disabled}`,
    );
  }
  if (snapshot.truncated) {
    lines.push("(truncated — scroll or raise maxNodes for the rest)");
  }
  return lines.join("\n");
}

function renderObservation(observation) {
  const element = observation.element;
  const lines = [`${observation.title || "(untitled)"} — ${observation.url}`];
  if (observation.navigated) lines.push("The page navigated.");
  if (element) {
    const value = element.value ? ` = ${JSON.stringify(element.value)}` : "";
    lines.push(
      `Element now: ${element.ref} ${element.role} ${JSON.stringify(element.name)}${value}${element.disabled ? " [disabled]" : ""}`,
    );
  } else if (!observation.navigated) {
    lines.push("The element is no longer on the page.");
  }
  return lines.join("\n");
}

async function act(toolCallId, command) {
  const origin = controllerOrigin();
  if (!origin) {
    return textResult("browser unavailable (controller URL not configured)", true);
  }
  const context = callContexts.get(toolCallId);
  if (!context?.sessionKey || context.channelId) {
    return textResult(
      "The embedded browser can only be driven from the Nexu desktop main session.",
      true,
    );
  }

  let response;
  try {
    response = await fetch(`${origin}${ACT_PATH}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ sessionKey: context.sessionKey, command }),
    });
  } catch {
    return textResult("browser unavailable (controller unreachable)", true);
  }

  let payload = null;
  try {
    payload = await response.json();
  } catch {
    payload = null;
  }
  if (!response.ok) {
    return textResult(
      payload?.message
        ? `browser command failed: ${payload.message}`
        : `browser command failed (${response.status})`,
      true,
    );
  }
  if (!payload || payload.ok !== true) {
    return textResult(
      `browser command failed: ${payload?.error ?? "unknown error"}`,
      true,
    );
  }
  if (payload.snapshot) return textResult(renderSnapshot(payload.snapshot));
  if (payload.observation) {
    return textResult(renderObservation(payload.observation));
  }
  return textResult("done");
}

const REF_NOTE =
  "Refs come from browser_open / browser_snapshot and stay valid until the page navigates.";

const plugin = {
  id: "nexu-browser",
  name: "Nexu Embedded Browser",
  description:
    "Registers browser_open / browser_snapshot / browser_click / browser_type / browser_scroll so the chat agent can drive the browser panel embedded in the Nexu desktop app.",
  register(api) {
    const cfg = api?.pluginConfig;
    if (cfg && typeof cfg.controllerUrl === "string" && cfg.controllerUrl) {
      configuredControllerUrl = cfg.controllerUrl;
    }

    api.on("before_tool_call", (event, ctx) => {
      if (!event?.toolName?.startsWith("browser_")) return;
      rememberCallContext(event.toolCallId ?? ctx?.toolCallId, ctx);
    });

    const registerBrowserTools = () => [
      {
        name: "browser_open",
        label: "Open in browser",
        description: `Open a web page in the browser panel inside the Nexu desktop app, and return the page's elements. Opens the panel if it is closed, so the user sees the page you are working with. Use this instead of asking the user to open a link. Returns the same element listing as browser_snapshot.`,
        parameters: {
          type: "object",
          additionalProperties: false,
          properties: {
            url: {
              type: "string",
              description: "The page to open, e.g. https://example.com",
            },
          },
          required: ["url"],
        },
        async execute(toolCallId, params) {
          const url = typeof params?.url === "string" ? params.url.trim() : "";
          if (!url) return textResult("browser_open requires a url.", true);
          return act(toolCallId, { action: "open", url });
        },
      },
      {
        name: "browser_snapshot",
        label: "Read page",
        description: `Read the current page in the Nexu browser panel: every interactive and named element with a ref you can act on. NO arguments. Call this after a page changes in a way you need to see in full — click and type already report the element they touched.`,
        parameters: { type: "object", additionalProperties: false, properties: {} },
        async execute(toolCallId) {
          return act(toolCallId, { action: "snapshot" });
        },
      },
      {
        name: "browser_click",
        label: "Click element",
        description: `Click an element in the Nexu browser panel. Returns the page URL and that element's state afterwards, so you can tell a click that worked from one that did nothing — report what came back, do not assume success. ${REF_NOTE}`,
        parameters: {
          type: "object",
          additionalProperties: false,
          properties: {
            ref: { type: "string", description: "Element ref, e.g. e12" },
          },
          required: ["ref"],
        },
        async execute(toolCallId, params) {
          const ref = typeof params?.ref === "string" ? params.ref.trim() : "";
          if (!ref) return textResult("browser_click requires a ref.", true);
          return act(toolCallId, { action: "click", ref });
        },
      },
      {
        name: "browser_type",
        label: "Type into element",
        description: `Type text into a field in the Nexu browser panel. Set submit to press Enter afterwards — search boxes and forms need it. Returns that element's value afterwards, which is your evidence the text landed. ${REF_NOTE}`,
        parameters: {
          type: "object",
          additionalProperties: false,
          properties: {
            ref: { type: "string", description: "Element ref, e.g. e12" },
            text: { type: "string", description: "Text to type" },
            submit: {
              type: "boolean",
              description: "Press Enter after typing. Default false.",
            },
          },
          required: ["ref", "text"],
        },
        async execute(toolCallId, params) {
          const ref = typeof params?.ref === "string" ? params.ref.trim() : "";
          const text = typeof params?.text === "string" ? params.text : null;
          if (!ref || text === null) {
            return textResult("browser_type requires a ref and text.", true);
          }
          return act(toolCallId, {
            action: "type",
            ref,
            text,
            submit: params?.submit === true,
          });
        },
      },
      {
        name: "browser_scroll",
        label: "Scroll page",
        description:
          "Scroll the page in the Nexu browser panel. Positive deltaY scrolls down. Use this when a snapshot came back truncated or the element you need is below the fold.",
        parameters: {
          type: "object",
          additionalProperties: false,
          properties: {
            deltaY: {
              type: "number",
              description: "Pixels to scroll; positive is down, e.g. 600",
            },
          },
          required: ["deltaY"],
        },
        async execute(toolCallId, params) {
          const deltaY = Number(params?.deltaY);
          if (!Number.isFinite(deltaY)) {
            return textResult("browser_scroll requires a numeric deltaY.", true);
          }
          return act(toolCallId, { action: "scroll", deltaY });
        },
      },
    ];

    // Factory registrations MUST pass opts.names (matching manifest
    // contracts.tools) — without it the registry records zero tool names and no
    // agent ever sees the tools.
    api.registerTool(registerBrowserTools, {
      names: [
        "browser_open",
        "browser_snapshot",
        "browser_click",
        "browser_type",
        "browser_scroll",
      ],
    });
  },
};

export default plugin;
export { renderObservation, renderSnapshot };
