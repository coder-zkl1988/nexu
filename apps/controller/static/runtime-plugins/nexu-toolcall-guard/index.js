/**
 * nexu-toolcall-guard
 *
 * Circuit breaker for runaway tool-call retry loops and local automation gate.
 *
 * Some models (observed: gpt-5.3-codex-spark) call a tool but never produce
 * arguments — the tool call's `arguments` is always `{}`. OpenClaw validates
 * the arguments against the tool schema, throws "Validation failed for tool
 * ...", feeds that error back as a tool result, and the model retries the same
 * empty call forever. pi-ai's agent loop has no step ceiling, so this burns
 * tokens indefinitely while the user only sees "a tool keeps running but never
 * produces output".
 *
 * Strategy (no OpenClaw source changes; pure plugin):
 *  1. `after_tool_call` — when a call fails *argument validation* (error text
 *     contains "Validation failed for tool"), accumulate a per-run counter
 *     keyed by (runId, toolName, paramsHash). Only count when there is NO
 *     progress: same tool, same (or still-empty) arguments. Any successful
 *     call, any non-validation error, or any *changed* arguments resets the
 *     counter — so a normal "got it wrong once, then fixed it" path is never
 *     penalised.
 *  2. `before_tool_call` — once the same tool has failed `threshold` times in a
 *     row with no progress, block the next call and return a clear instruction
 *     telling the model to stop retrying and tell the user to switch models.
 *  3. `agent_end` — drop the run's counter so the map cannot grow unbounded.
 *
 * We cannot hard-kill the run from a plugin (`abortEmbeddedAgentRun` is not
 * exported from the openclaw entrypoint), so this relies on blocking the tool
 * plus a strong instruction. The threshold gives the model a couple of chances
 * to self-correct before the brake engages.
 */

const DEFAULT_THRESHOLD = 3;
const MAX_TRACKED_RUNS = 500;
const LOCAL_AUTOMATION_TOOL_PREFIXES = ["peekaboo__", "cua-driver__"];
// Embedded-browser tools registered by the nexu-browser plugin. They drive a
// browser that carries the user's own logins, so they are gated exactly like
// desktop control: desktop main session only. Kept in sync with
// EMBEDDED_BROWSER_TOOLS in apps/controller/src/lib/openclaw-config-compiler.ts.
const EMBEDDED_BROWSER_TOOLS = new Set([
  "browser_click",
  "browser_open",
  "browser_scroll",
  "browser_snapshot",
  "browser_type",
]);
const HOST_EXECUTION_TOOLS = new Set([
  "exec",
  "process",
  "gateway",
  "nodes",
  "cron",
]);
const COMPUTER_OBSERVATION_TOOLS = new Set([
  "peekaboo__see",
  "peekaboo__inspect_ui",
  "cua-driver__get_accessibility_tree",
  "cua-driver__get_desktop_state",
  "cua-driver__get_session_state",
  "cua-driver__get_window_state",
]);
const COMPUTER_MUTATION_TOOLS = new Set([
  "peekaboo__app",
  "peekaboo__click",
  "peekaboo__type",
  "peekaboo__set_value",
  "peekaboo__perform_action",
  "peekaboo__hotkey",
  "peekaboo__scroll",
  "peekaboo__drag",
  "peekaboo__window",
  "peekaboo__menu",
  "peekaboo__dock",
  "peekaboo__dialog",
  "cua-driver__click",
  "cua-driver__double_click",
  "cua-driver__right_click",
  "cua-driver__drag",
  "cua-driver__move_cursor",
  "cua-driver__scroll",
  "cua-driver__type_text",
  "cua-driver__press_key",
  "cua-driver__hotkey",
  "cua-driver__set_value",
  "cua-driver__launch_app",
]);
const NON_MUTATING_COMPUTER_TOOLS = new Set([
  ...COMPUTER_OBSERVATION_TOOLS,
  "peekaboo__list",
  "cua-driver__check_permissions",
  "cua-driver__get_cursor_position",
  "cua-driver__get_screen_size",
  "cua-driver__list_apps",
  "cua-driver__list_windows",
  "cua-driver__start_session",
  "cua-driver__end_session",
  "cua-driver__escalate_session",
]);
const APPROVED_CUA_TOOLS = new Set([
  "cua-driver__check_permissions",
  "cua-driver__get_accessibility_tree",
  "cua-driver__get_cursor_position",
  "cua-driver__get_desktop_state",
  "cua-driver__get_screen_size",
  "cua-driver__get_session_state",
  "cua-driver__get_window_state",
  "cua-driver__list_apps",
  "cua-driver__list_windows",
  "cua-driver__click",
  "cua-driver__double_click",
  "cua-driver__right_click",
  "cua-driver__drag",
  "cua-driver__move_cursor",
  "cua-driver__scroll",
  "cua-driver__type_text",
  "cua-driver__press_key",
  "cua-driver__hotkey",
  "cua-driver__set_value",
  "cua-driver__launch_app",
  "cua-driver__start_session",
  "cua-driver__end_session",
  "cua-driver__escalate_session",
]);
const IMPLICIT_APP_TARGETS = new Set(["active", "current", "frontmost"]);
// Action classes with no read-back — see the identical list and rationale in
// apps/controller/src/services/local-automation-completion-guard.ts. Keyed by
// action class, not by whether a call carried an element reference: an
// unverified `type` stays a hard failure even where the provider cannot bind
// it to an element.
const UNVERIFIABLE_ACTION_TOOLS = new Set([
  "peekaboo__click",
  "peekaboo__hotkey",
  "peekaboo__scroll",
  "peekaboo__drag",
  "peekaboo__menu",
  "peekaboo__dock",
  "peekaboo__dialog",
  "peekaboo__window",
  "peekaboo__perform_action",
  "cua-driver__click",
  "cua-driver__double_click",
  "cua-driver__right_click",
  "cua-driver__drag",
  "cua-driver__scroll",
  "cua-driver__press_key",
  "cua-driver__hotkey",
  "cua-driver__move_cursor",
]);
const UNVERIFIED_COMPUTER_ACTION_MESSAGE =
  "电脑操作未确认完成：工具可能只投递了动作，后续状态没有证明请求结果。系统不会仅凭成功回执或一次普通截图报告完成。";

// Click/hotkey/scroll/drag/menu/dock/dialog/window have no read-back, so no
// provider can prove they achieved intent. Replacing a correct reply with a
// failure for those reports successful work as failed. Append a caveat
// instead; evidence the provider could have produced and did not still
// replaces the message. Mirrors the severity split in
// apps/controller/src/services/local-automation-completion-guard.ts.
const UNVERIFIABLE_COMPUTER_ACTION_NOTICE =
  "\n\n---\n提示：本次操作中的点击/按键/滚动/拖拽类动作无法被系统验证——这类动作只能投递事件，操作系统不提供「是否达成意图」的回执。上述结果未经证实，请自行确认。";

// runId -> { toolName, count, paramsHash }
const runFailures = new Map();
// sessionKey -> { runId, inFlight: Map<string, number>, pending: Array<...> }
const pendingComputerRuns = new Map();

function stableHash(params) {
  try {
    return JSON.stringify(params ?? {});
  } catch {
    return "";
  }
}

function stableValue(value) {
  if (Array.isArray(value)) return value.map(stableValue);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.entries(value)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, nested]) => [key, stableValue(nested)]),
  );
}

function mutationFingerprint(toolName, params) {
  try {
    return `${toolName}:${JSON.stringify(stableValue(params ?? {}))}`;
  } catch {
    return `${toolName}:unserializable`;
  }
}

function isValidationFailure(error) {
  if (!error) return false;
  const s = typeof error === "string" ? error : String(error);
  return (
    s.includes("Validation failed for tool") || s.includes("Received arguments")
  );
}

function isEmptyParams(params) {
  return (
    !params ||
    (typeof params === "object" && Object.keys(params).length === 0)
  );
}

function isLocalAutomationTool(toolName) {
  return (
    toolName === "browser" ||
    EMBEDDED_BROWSER_TOOLS.has(toolName) ||
    LOCAL_AUTOMATION_TOOL_PREFIXES.some((prefix) => toolName?.startsWith(prefix))
  );
}

function readText(params, keys) {
  for (const key of keys) {
    const value = params?.[key];
    if (typeof value === "string" && value.trim()) return value.trim();
    if (typeof value === "number" && Number.isFinite(value)) {
      return String(value);
    }
    if (typeof value === "boolean") return String(value);
  }
  return null;
}

function readLiteralText(params, keys) {
  for (const key of keys) {
    const value = params?.[key];
    if (typeof value === "string") return value;
    if (typeof value === "number" && Number.isFinite(value)) {
      return String(value);
    }
    if (typeof value === "boolean") return String(value);
  }
  return null;
}

function normalizeTarget(value) {
  if (!value) return null;
  const normalized = value.trim().toLowerCase();
  return normalized && !IMPLICIT_APP_TARGETS.has(normalized)
    ? normalized
    : null;
}

function resolveAutomationTarget(toolName, params) {
  const directApp = readText(params, [
    "app",
    "app_target",
    "application",
    "bundle_id",
    "bundleId",
  ]);
  const pid = readText(params, ["pid"]);
  const appName =
    toolName === "peekaboo__app" || toolName === "cua-driver__launch_app"
      ? readText(params, ["name"])
      : null;
  const windowId = readText(params, ["window_id", "windowId"]);
  const windowIndex = readText(params, ["window_index", "windowIndex"]);
  const session = readText(params, [
    "session",
    "session_id",
    "sessionId",
    "snapshot",
    "snapshot_id",
    "snapshotId",
  ]);
  return {
    app: normalizeTarget(directApp ?? (pid ? `pid:${pid}` : appName)),
    window: windowId
      ? `id:${windowId.toLowerCase()}`
      : windowIndex
        ? `index:${windowIndex.toLowerCase()}`
        : null,
    session: normalizeTarget(session),
  };
}

function resultTargets(value) {
  const targets = [];
  const seen = new Set();
  let remainingNodes = 500;

  const visit = (candidate) => {
    if (remainingNodes-- <= 0) return;
    // See the identical rationale in
    // apps/controller/src/services/local-automation-completion-guard.ts.
    if (typeof candidate === "string") {
      for (const match of candidate.matchAll(/\(pid (\d{1,10})\)/g)) {
        targets.push({
          app: normalizeTarget(`pid:${match[1]}`),
          window: null,
          session: null,
        });
      }
      return;
    }
    if (!candidate || typeof candidate !== "object") {
      return;
    }
    if (seen.has(candidate)) return;
    seen.add(candidate);
    if (Array.isArray(candidate)) {
      for (const entry of candidate) visit(entry);
      return;
    }
    const pid = readText(candidate, ["pid", "process_id", "processId"]);
    const app = readText(candidate, [
      "app",
      "application",
      "bundle_id",
      "bundleId",
      "process_name",
      "processName",
    ]);
    const windowId = readText(candidate, ["window_id", "windowId"]);
    const session = readText(candidate, [
      "session",
      "session_id",
      "sessionId",
    ]);
    if (pid || app || windowId || session) {
      targets.push({
        app: normalizeTarget(pid ? `pid:${pid}` : app),
        window: windowId ? `id:${windowId.toLowerCase()}` : null,
        session: normalizeTarget(session),
      });
    }
    for (const nested of Object.values(candidate)) visit(nested);
  };

  visit(value);
  const deduplicated = new Map();
  for (const target of targets) {
    deduplicated.set(JSON.stringify(target), target);
  }
  return [...deduplicated.values()];
}

function automationTargetsMatch(action, evidence) {
  if (action.window) {
    return (
      action.window === evidence.window &&
      (!action.app || !evidence.app || action.app === evidence.app)
    );
  }
  if (action.session) {
    return (
      action.session === evidence.session &&
      (!action.app || !evidence.app || action.app === evidence.app)
    );
  }
  if (action.app) return action.app === evidence.app;
  return false;
}

function hasExplicitAutomationTarget(target) {
  return Boolean(target.app || target.window || target.session);
}

function expectedTextForMutation(toolName, params) {
  if (toolName === "peekaboo__type" || toolName === "cua-driver__type_text") {
    return readLiteralText(params, ["text"]);
  }
  if (
    toolName === "peekaboo__set_value" ||
    toolName === "cua-driver__set_value"
  ) {
    return readLiteralText(params, ["value", "text"]);
  }
  return null;
}

function expectedElementIdForMutation(params) {
  return normalizeTarget(
    readText(params, [
      "element_id",
      "elementId",
      "node_id",
      "nodeId",
      "target_id",
      "targetId",
      "element_index",
      "elementIndex",
      "element_token",
      "elementToken",
      "on",
    ]),
  );
}

function parseStructuredText(value) {
  const trimmed = value.trim();
  if (
    trimmed.length === 0 ||
    trimmed.length > 1_000_000 ||
    (!trimmed.startsWith("{") && !trimmed.startsWith("["))
  ) {
    return null;
  }
  try {
    return JSON.parse(trimmed);
  } catch {
    return null;
  }
}

function textHasExplicitElementValue(
  text,
  expectedElementId,
  expectedText,
  matchMode,
) {
  const normalizedElementId = expectedElementId.normalize("NFKC").toLocaleLowerCase();
  const normalizedExpectedText = expectedText.normalize("NFKC").toLocaleLowerCase();
  if (
    !normalizedElementId ||
    (!normalizedExpectedText && matchMode === "contains")
  ) {
    return false;
  }
  const escapedElementId = normalizedElementId.replace(
    /[.*+?^${}()|[\]\\]/g,
    "\\$&",
  );
  const bareOrWrappedElement = `(?:${escapedElementId}|\\[${escapedElementId}\\]|\\(${escapedElementId}\\))`;
  const elementPrefixPattern = new RegExp(
    `^\\s*(?:(?:[-*]|\\u2022)\\s*)?${bareOrWrappedElement}(?=\\s|[:=,}\\]]|$)`,
    "u",
  );
  const elementFieldPattern =
    /(?:^|[\s,{])(?:element[_ -]?id|node[_ -]?id|target[_ -]?id|element[_ -]?(?:index|token)|runtime[_ -]?id|automation[_ -]?id|id|on)\s*[:=]\s*(?:"([^"\r\n]*)"|'([^'\r\n]*)'|([^\s,}\]]+))/giu;
  const valueFieldPattern =
    /(?:^|[\s,{])(?:value|current[_ -]?value|text[_ -]?value)\s*[:=]\s*(?:"([^"\r\n]*)"|'([^'\r\n]*)'|([^\s,}\]]+))/giu;

  return text.split(/\r?\n|;/).some((segment) => {
    const normalizedSegment = segment.normalize("NFKC").toLocaleLowerCase();
    const elementIds = [...normalizedSegment.matchAll(elementFieldPattern)].map(
      (match) => normalizeTarget(match[1] ?? match[2] ?? match[3] ?? ""),
    );
    if (elementIds.length > 1) return false;
    const prefixMatches = elementPrefixPattern.test(normalizedSegment);
    if (
      (!prefixMatches && elementIds.length !== 1) ||
      (elementIds.length === 1 && elementIds[0] !== normalizedElementId)
    ) {
      return false;
    }

    const values = [...normalizedSegment.matchAll(valueFieldPattern)]
      .filter((match) => {
        const prefix = normalizedSegment.slice(0, match.index).trimEnd();
        return !/(?:^|[\s,{])default(?:[_ -])?$/.test(prefix);
      })
      .map((match) => match[1] ?? match[2] ?? match[3] ?? "");
    const [value] = values;
    if (values.length !== 1 || value === undefined) return false;
    return matchMode === "exact"
      ? value === normalizedExpectedText
      : value.includes(normalizedExpectedText);
  });
}

function evidenceConfirmsExpectedValue(
  value,
  expectedElementId,
  expectedText,
  matchMode,
) {
  if (!expectedElementId) return false;
  const needle = expectedText.normalize("NFKC").toLocaleLowerCase();
  if (!needle && matchMode === "contains") return false;
  let remainingNodes = 2_000;
  const seen = new Set();

  const containsExpectedValue = (record) => {
    for (const key of ["value", "currentValue", "textValue"]) {
      const candidate = record[key];
      if (
        typeof candidate === "string" &&
        (matchMode === "exact"
          ? candidate.normalize("NFKC").toLocaleLowerCase() === needle
          : candidate.normalize("NFKC").toLocaleLowerCase().includes(needle))
      ) {
        return true;
      }
    }
    const attributes = record.attributes;
    return attributes && typeof attributes === "object"
      ? containsExpectedValue(attributes)
      : false;
  };

  const visit = (candidate) => {
    if (remainingNodes-- <= 0) return false;
    if (typeof candidate === "string") {
      const structured = parseStructuredText(candidate);
      return structured
        ? visit(structured)
        : textHasExplicitElementValue(
            candidate,
            expectedElementId,
            expectedText,
            matchMode,
          );
    }
    if (!candidate || typeof candidate !== "object") return false;
    if (seen.has(candidate)) return false;
    seen.add(candidate);
    if (Array.isArray(candidate)) return candidate.some(visit);
    const candidateId = normalizeTarget(
      readText(candidate, [
        "element_id",
        "elementId",
        "node_id",
        "nodeId",
        "target_id",
        "targetId",
        "element_index",
        "elementIndex",
        "element_token",
        "elementToken",
        "index",
        "runtime_id",
        "runtimeId",
        "automation_id",
        "automationId",
        "id",
      ]),
    );
    if (
      candidateId === expectedElementId &&
      containsExpectedValue(candidate)
    ) {
      return true;
    }
    return Object.values(candidate).some(visit);
  };

  return visit(value);
}

function resultHasCuaNativeVerification(value) {
  const seen = new Set();
  let remainingNodes = 100;

  const visit = (candidate) => {
    if (remainingNodes-- <= 0 || !candidate || typeof candidate !== "object") {
      return false;
    }
    if (seen.has(candidate)) return false;
    seen.add(candidate);
    if (Array.isArray(candidate)) return candidate.some(visit);
    if (candidate.verified === true) return true;
    return [
      candidate.result,
      candidate.data,
      candidate.payload,
      candidate.details,
      candidate.structuredContent,
    ].some(visit);
  };

  return visit(value);
}

function resultHasProviderVerification(
  value,
  toolName,
  expectedText,
  expectedElementId,
) {
  if (
    toolName?.startsWith("cua-driver__") &&
    resultHasCuaNativeVerification(value)
  ) {
    return true;
  }
  const seen = new Set();
  let remainingNodes = 1_000;

  const visit = (candidate) => {
    if (remainingNodes-- <= 0) return false;
    if (typeof candidate === "string") return false;
    if (!candidate || typeof candidate !== "object") return false;
    if (seen.has(candidate)) return false;
    seen.add(candidate);
    if (Array.isArray(candidate)) return candidate.some(visit);
    const action =
      candidate.action && typeof candidate.action === "object"
        ? candidate.action
        : null;
    if (
      action?.verification &&
      typeof action.verification === "object" &&
      action.verification.state === "verified"
    ) {
      if (expectedText === null) {
        const actionName = readText(action, ["toolName", "actionName"]);
        const toolOperation = toolName.split("__").at(-1);
        if (!actionName || !toolOperation) return false;
        return (
          actionName.toLocaleLowerCase().replace(/[^a-z0-9]/g, "") ===
          toolOperation.toLocaleLowerCase().replace(/[^a-z0-9]/g, "")
        );
      }
      const verifiedElementId = expectedElementIdForMutation(action);
      if (expectedElementId && verifiedElementId !== expectedElementId) {
        return false;
      }
      const expected = readLiteralText(action.verification, ["expected"]);
      const property = readText(action.verification, ["property"]);
      const normalizedExpected = expected
        ?.normalize("NFKC")
        .toLocaleLowerCase();
      const normalizedRequested = expectedText
        .normalize("NFKC")
        .toLocaleLowerCase();
      const allowedProperties = toolName.endsWith("__set_value")
        ? new Set(["value"])
        : new Set(["focusedtext", "selection", "value"]);
      if (
        normalizedExpected !== normalizedRequested ||
        !property ||
        !allowedProperties.has(property.toLocaleLowerCase())
      ) {
        return false;
      }
      const actualPreview = readLiteralText(action.verification, ["actualPreview"]);
      return (
        actualPreview === null ||
        actualPreview.normalize("NFKC").toLocaleLowerCase() ===
          normalizedRequested
      );
    }
    return [
      candidate.result,
      candidate.data,
      candidate.payload,
      candidate.content,
    ].some(visit);
  };

  return visit(value);
}

function verificationKindForMutation(toolName, params) {
  const expectedText = expectedTextForMutation(toolName, params);
  const expectedElementId = expectedElementIdForMutation(params);
  if (expectedText !== null && expectedElementId !== null) {
    return "element-value";
  }
  if (toolName === "cua-driver__launch_app") return "target-observed";
  if (toolName === "peekaboo__app") {
    const action = readText(params, ["action"])?.toLowerCase();
    if (action === "launch" || action === "relaunch") {
      return "target-observed";
    }
  }
  return "provider-only";
}

function isReadOnlyMutationToolAction(toolName, action) {
  if (!action) return false;
  if (toolName === "peekaboo__app") return action === "list";
  if (toolName === "peekaboo__menu") {
    return action === "list" || action === "list-all";
  }
  if (toolName === "peekaboo__dock" || toolName === "peekaboo__dialog") {
    return action === "list";
  }
  return false;
}

function isComputerMutation(toolName, params) {
  if (
    toolName === "peekaboo__app" ||
    toolName === "peekaboo__window" ||
    toolName === "peekaboo__menu" ||
    toolName === "peekaboo__dock" ||
    toolName === "peekaboo__dialog"
  ) {
    const action = readText(params, ["action"])?.toLowerCase();
    if (isReadOnlyMutationToolAction(toolName, action)) return false;
  }
  if (NON_MUTATING_COMPUTER_TOOLS.has(toolName)) return false;
  if (COMPUTER_MUTATION_TOOLS.has(toolName)) return true;
  return (
    toolName?.startsWith("peekaboo__") ||
    toolName?.startsWith("cua-driver__")
  );
}

function isApprovedLocalAutomationTool(toolName) {
  // Nexu ships cua-driver on every platform. Peekaboo was the macOS backend
  // before the backends were unified; nothing compiles it into the MCP
  // registry any more, so any peekaboo__* call is an unreviewed surface and
  // fails closed. The completion guard still knows how to classify Peekaboo
  // results — that is fail-safe classification, not an authorisation path.
  if (toolName?.startsWith("peekaboo__")) {
    return false;
  }
  if (toolName?.startsWith("cua-driver__")) {
    return APPROVED_CUA_TOOLS.has(toolName);
  }
  return true;
}

function toolCallFailed(event) {
  if (event?.error) return true;
  const result = event?.result;
  return (
    result &&
    typeof result === "object" &&
    (result.isError === true || result.ok === false)
  );
}

function completionStateKey(ctx) {
  return typeof ctx?.sessionKey === "string" && ctx.sessionKey
    ? `session:${ctx.sessionKey}`
    : null;
}

function getComputerRunState(ctx, event) {
  const key = completionStateKey(ctx);
  const runId = ctx?.runId || event?.runId;
  if (!key || !runId) return null;
  const existing = pendingComputerRuns.get(key);
  if (existing?.runId === runId) return { key, state: existing };
  const state = { runId, inFlight: new Map(), pending: [] };
  pendingComputerRuns.set(key, state);
  if (pendingComputerRuns.size > MAX_TRACKED_RUNS) {
    const oldest = pendingComputerRuns.keys().next().value;
    if (oldest !== undefined) pendingComputerRuns.delete(oldest);
  }
  return { key, state };
}

function trackComputerStart(event, ctx) {
  const toolName = event?.toolName;
  const params = event?.params ?? {};
  if (!isComputerMutation(toolName, params)) return;
  const tracked = getComputerRunState(ctx, event);
  if (!tracked) return;
  const fingerprint = mutationFingerprint(toolName, params);
  tracked.state.inFlight.set(
    fingerprint,
    (tracked.state.inFlight.get(fingerprint) ?? 0) + 1,
  );
}

function trackComputerCompletion(event, ctx) {
  const toolName = event?.toolName;
  const params = event?.params ?? {};
  const mutation = isComputerMutation(toolName, params);
  const observation = COMPUTER_OBSERVATION_TOOLS.has(toolName);
  if (!mutation && !observation) return;
  const tracked = getComputerRunState(ctx, event);
  if (!tracked) return;
  const target = resolveAutomationTarget(toolName, params);
  const failed = toolCallFailed(event);

  if (mutation) {
    const aliases =
      toolName === "cua-driver__launch_app" ? resultTargets(event.result) : [];
    const expectedElementId = expectedElementIdForMutation(params);
    const expectedText = expectedTextForMutation(toolName, params);
    const fingerprint = mutationFingerprint(toolName, params);
    const inFlightCount = tracked.state.inFlight.get(fingerprint) ?? 0;
    if (inFlightCount <= 1) tracked.state.inFlight.delete(fingerprint);
    else tracked.state.inFlight.set(fingerprint, inFlightCount - 1);
    const verificationKind = verificationKindForMutation(toolName, params);
    if (!failed) {
      tracked.state.pending = tracked.state.pending.filter(
        (pending) => (pending.failed ? pending.fingerprint !== fingerprint : true),
      );
    }
    if (
      !failed &&
      hasExplicitAutomationTarget(target) &&
      resultHasProviderVerification(
        event.result,
        toolName,
        expectedText,
        expectedElementId,
      )
    ) {
      return;
    }
    tracked.state.pending.push({
      aliases,
      expectedElementId,
      expectedText,
      failed,
      fingerprint,
      target,
      toolName,
      verificationKind,
    });
    return;
  }

  if (!failed) {
    tracked.state.pending = tracked.state.pending.filter(
      (pending) =>
        pending.failed ||
        ![pending.target, ...pending.aliases].some((candidate) =>
          automationTargetsMatch(candidate, target),
        ) ||
        pending.verificationKind === "provider-only" ||
        (pending.verificationKind === "element-value" &&
          (pending.expectedText === null ||
            !evidenceConfirmsExpectedValue(
              event.result,
              pending.expectedElementId,
              pending.expectedText,
              pending.toolName.endsWith("__set_value")
                ? "exact"
                : "contains",
            ))),
    );
  }
}

function assistantMessageHasToolCall(message) {
  return (
    Array.isArray(message?.content) &&
    message.content.some(
      (part) =>
        part &&
        typeof part === "object" &&
        (part.type === "toolCall" || part.type === "tool_call"),
    )
  );
}

function isLocalInteractiveSession(ctx) {
  if (ctx?.channelId) return false;
  return /^agent:[^:]+:(?:main|[0-9a-f]{8}-[0-9a-f-]{27})$/i.test(
    ctx?.sessionKey ?? "",
  );
}

const plugin = {
  id: "nexu-toolcall-guard",
  name: "Nexu Tool Call Guard",
  description:
    "Breaks infinite tool-call retry loops caused by models that repeatedly fail argument validation.",
  register(api) {
    const configured = Number(api.pluginConfig?.threshold);
    const threshold =
      Number.isFinite(configured) && configured >= 2
        ? Math.floor(configured)
        : DEFAULT_THRESHOLD;

    try {
      api.logger.info(
        `[nexu-toolcall-guard] loaded — tripping after ${threshold} consecutive validation failures`,
      );
    } catch {}

    // Phase 1: accumulate consecutive same-tool, no-progress validation failures.
    api.on("after_tool_call", async (event, ctx) => {
      trackComputerCompletion(event, ctx);
      const runId = ctx?.runId || event?.runId;
      if (!runId) return;

      if (!isValidationFailure(event?.error)) {
        // Success, or any non-validation error, or a different outcome:
        // the model is making progress — reset this run's streak.
        runFailures.delete(runId);
        return;
      }

      const toolName = event?.toolName;
      const paramsHash = stableHash(event?.params);
      const prev = runFailures.get(runId);

      if (prev && prev.toolName === toolName && prev.paramsHash === paramsHash) {
        // Same tool, same arguments → no progress.
        prev.count += 1;
      } else {
        // New tool or changed arguments → start a fresh streak.
        runFailures.set(runId, { toolName, count: 1, paramsHash });
      }

      const rec = runFailures.get(runId);
      if (rec.count >= threshold) {
        try {
          api.logger.warn(
            `[nexu-toolcall-guard] tool "${toolName}" failed validation ${rec.count}x with no progress in run ${runId} — next call will be blocked`,
          );
        } catch {}
      }

      // Bound memory: evict the oldest tracked run if we somehow leak.
      if (runFailures.size > MAX_TRACKED_RUNS) {
        const oldest = runFailures.keys().next().value;
        if (oldest !== undefined) runFailures.delete(oldest);
      }
    });

    // Phase 2: once tripped, block further no-progress calls to the same tool.
    api.on("before_tool_call", async (event, ctx) => {
      if (
        isLocalAutomationTool(event?.toolName) &&
        !isApprovedLocalAutomationTool(event?.toolName)
      ) {
        try {
          api.logger.warn(
            `[nexu-toolcall-guard] BLOCKING unapproved local automation tool "${event.toolName}"`,
          );
        } catch {}
        return {
          block: true,
          blockReason:
            "该本机自动化工具不在 Nexu 审核过的能力清单中，已阻止调用。请使用设置中已授权的电脑控制或浏览器控制能力。",
        };
      }

      const protectedLocalTool =
        isLocalAutomationTool(event?.toolName) ||
        HOST_EXECUTION_TOOLS.has(event?.toolName);
      if (protectedLocalTool && !isLocalInteractiveSession(ctx)) {
        try {
          api.logger.warn(
            `[nexu-toolcall-guard] BLOCKING protected local tool "${event.toolName}" outside the desktop main session`,
          );
        } catch {}

        return {
          block: true,
          blockReason: HOST_EXECUTION_TOOLS.has(event?.toolName)
            ? "出于本机安全考虑，外部渠道、子会话和来源不明的调用不能执行主机命令。请让用户在 Nexu 桌面主会话中完成需要本机执行的操作。"
            : "本机浏览器和桌面控制只允许从 Nexu 桌面主会话调用。外部渠道、子会话和来源不明的调用默认被拒绝。请让用户在桌面端打开对应机器人的主会话后重试。",
        };
      }

      const runId = ctx?.runId || event?.runId;
      if (!runId) return;

      const rec = runFailures.get(runId);
      if (!rec || rec.toolName !== event?.toolName || rec.count < threshold) {
        trackComputerStart(event, ctx);
        return;
      }

      // Only block if there is still no progress: arguments unchanged from the
      // failing call, or still empty. If the model finally produced different,
      // non-empty arguments, let it through (it may have self-corrected).
      const paramsHash = stableHash(event?.params);
      if (paramsHash !== rec.paramsHash && !isEmptyParams(event?.params)) {
        trackComputerStart(event, ctx);
        return;
      }

      try {
        api.logger.warn(
          `[nexu-toolcall-guard] BLOCKING tool "${event.toolName}" in run ${runId} after ${rec.count} consecutive validation failures`,
        );
      } catch {}

      return {
        block: true,
        blockReason:
          `工具「${event.toolName}」已连续 ${rec.count} 次因参数校验失败被调用（生成的参数为空或始终没有变化），已阻止继续重试以避免无限循环。` +
          `请立即停止调用该工具，并直接用纯文本回复用户：当前所选模型无法正确生成工具调用参数，请在「设置 → AI 模型」中更换为支持工具调用的模型（如 DeepSeek、Claude 等）后再试。`,
      };
    });

    api.on("before_message_write", (event, ctx) => {
      const key = completionStateKey(ctx);
      const state = key ? pendingComputerRuns.get(key) : null;
      const message = event?.message;
      if (
        !state ||
        (state.pending.length === 0 && state.inFlight.size === 0) ||
        message?.role !== "assistant" ||
        message?.stopReason === "toolUse" ||
        assistantMessageHasToolCall(message)
      ) {
        return;
      }

      // An in-flight mutation never returned, so the action may not even have
      // been delivered — that outranks any per-action verifiability question.
      const hasObtainableEvidenceGap =
        state.inFlight.size > 0 ||
        state.pending.some(
          (pending) =>
            pending.failed || !UNVERIFIABLE_ACTION_TOOLS.has(pending.toolName),
        );

      if (!hasObtainableEvidenceGap) {
        try {
          api.logger.warn(
            `[nexu-toolcall-guard] appending unverifiable-action notice in run ${state.runId}; pending=${state.pending.length}`,
          );
        } catch {}
        return {
          message: {
            ...message,
            content: [
              ...(Array.isArray(message.content) ? message.content : []),
              { type: "text", text: UNVERIFIABLE_COMPUTER_ACTION_NOTICE },
            ],
          },
        };
      }

      try {
        api.logger.warn(
          `[nexu-toolcall-guard] replacing unverified computer-use completion in run ${state.runId}; pending=${state.pending.length}; inFlight=${state.inFlight.size}`,
        );
      } catch {}
      return {
        message: {
          ...message,
          content: [
            { type: "text", text: UNVERIFIED_COMPUTER_ACTION_MESSAGE },
          ],
        },
      };
    });

    // Phase 3: clean up when the run ends.
    api.on("agent_end", async (event, ctx) => {
      const runId = ctx?.runId || event?.runId;
      if (runId) runFailures.delete(runId);
      const key = completionStateKey(ctx);
      if (key) pendingComputerRuns.delete(key);
    });
  },
};

export default plugin;
