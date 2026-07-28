const MAX_TRACKED_RUNS = 500;

export const LOCAL_AUTOMATION_UNVERIFIED_MESSAGE =
  "电脑操作未确认完成：工具可能只投递了动作，后续状态没有证明请求结果。系统不会仅凭成功回执或一次普通截图报告完成。";

// Click, hotkey, scroll, drag, menu, Dock, dialog, and window actions have no
// read-back: the OS delivers the event and what happens next is the target
// app's business. No provider can prove intent for them — cua-driver 0.12.6
// says so in its own tool description ("A click is never driver-verifiable
// (no read-back) ... confirm the effect via screenshot"), and Peekaboo 3.9.8
// returns plain `[ok]` text. Failing the whole run on that means reporting a
// successful task as failed, which is worse than saying the outcome is
// unconfirmed. Evidence the provider *can* produce and did not — a typed or
// assigned value that never read back, a launch never observed, a failed call
// never retried — stays a hard failure.
export const LOCAL_AUTOMATION_ADVISORY_MESSAGE =
  "提示：本次电脑操作中的点击/按键/滚动/拖拽类动作无法被系统验证——这类动作只能投递事件，操作系统不提供「是否达成意图」的回执。上述结果未经证实，请自行确认。";

const OBSERVATION_TOOLS = new Set([
  "peekaboo__see",
  "peekaboo__inspect_ui",
  "cua-driver__get_accessibility_tree",
  "cua-driver__get_desktop_state",
  "cua-driver__get_session_state",
  "cua-driver__get_window_state",
]);

const MUTATION_TOOLS = new Set([
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

const NON_MUTATING_TOOLS = new Set([
  ...OBSERVATION_TOOLS,
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

const IMPLICIT_APP_TARGETS = new Set(["active", "current", "frontmost"]);

// Actions with no read-back: the OS delivers the event and what happens next
// is the target app's business. No provider can prove intent for these —
// cua-driver 0.12.6 states it in its own `click` description ("A click is
// never driver-verifiable (no read-back)"), and Peekaboo 3.9.8 returns plain
// `[ok]` text. Membership is by action class, NOT by whether a given call
// carried an element reference: `type` belongs to a verifiable class even when
// the provider offers no way to bind it to an element (Peekaboo's `type` has
// no `--on`), and an unverified `type` is exactly the failure this guard
// exists to catch.
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

type AutomationTarget = {
  app: string | null;
  window: string | null;
  session: string | null;
};

type TrackedCall = {
  name: string;
  params: Record<string, unknown>;
};

type PendingAction = {
  aliases: AutomationTarget[];
  expectedElementId: string | null;
  expectedText: string | null;
  failed: boolean;
  fingerprint: string;
  target: AutomationTarget;
  toolName: string;
  verificationKind: "element-value" | "provider-only" | "target-observed";
};

type RunState = {
  calls: Map<string, TrackedCall>;
  pending: PendingAction[];
};

export type LocalAutomationCompletionFailure = {
  /**
   * `error` — the provider could have produced evidence and did not, so the
   * completion claim is unfounded and the run fails.
   * `advisory` — every unresolved action is one no provider can verify, so the
   * reply stands with an explicit caveat instead of being replaced by a failure.
   */
  severity: "error" | "advisory";
  errorKind: "local_automation_unverified";
  errorMessage: string;
};

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object"
    ? (value as Record<string, unknown>)
    : null;
}

function readText(
  params: Record<string, unknown>,
  keys: readonly string[],
): string | null {
  for (const key of keys) {
    const value = params[key];
    if (typeof value === "string" && value.trim()) return value.trim();
    if (typeof value === "number" && Number.isFinite(value)) {
      return String(value);
    }
    if (typeof value === "boolean") return String(value);
  }
  return null;
}

function readLiteralText(
  params: Record<string, unknown>,
  keys: readonly string[],
): string | null {
  for (const key of keys) {
    const value = params[key];
    if (typeof value === "string") return value;
    if (typeof value === "number" && Number.isFinite(value)) {
      return String(value);
    }
    if (typeof value === "boolean") return String(value);
  }
  return null;
}

function normalizeTarget(value: string | null): string | null {
  if (!value) return null;
  const normalized = value.trim().toLowerCase();
  return normalized && !IMPLICIT_APP_TARGETS.has(normalized)
    ? normalized
    : null;
}

function stableValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stableValue);
  const record = asRecord(value);
  if (!record) return value;
  return Object.fromEntries(
    Object.entries(record)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, nested]) => [key, stableValue(nested)]),
  );
}

function mutationFingerprint(
  toolName: string,
  params: Record<string, unknown>,
): string {
  try {
    return `${toolName}:${JSON.stringify(stableValue(params))}`;
  } catch {
    return `${toolName}:unserializable`;
  }
}

function resolveTarget(
  toolName: string,
  params: Record<string, unknown>,
): AutomationTarget {
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

function resultTargets(value: unknown): AutomationTarget[] {
  const targets: AutomationTarget[] = [];
  const seen = new Set<object>();
  let remainingNodes = 500;

  const visit = (candidate: unknown): void => {
    if (remainingNodes-- <= 0 || !candidate || typeof candidate !== "object") {
      return;
    }
    if (seen.has(candidate)) return;
    seen.add(candidate);
    if (Array.isArray(candidate)) {
      for (const entry of candidate) visit(entry);
      return;
    }
    const record = candidate as Record<string, unknown>;
    const pid = readText(record, ["pid", "process_id", "processId"]);
    const app = readText(record, [
      "app",
      "application",
      "bundle_id",
      "bundleId",
      "process_name",
      "processName",
    ]);
    const windowId = readText(record, ["window_id", "windowId"]);
    const session = readText(record, ["session", "session_id", "sessionId"]);
    if (pid || app || windowId || session) {
      targets.push({
        app: normalizeTarget(pid ? `pid:${pid}` : app),
        window: windowId ? `id:${windowId.toLowerCase()}` : null,
        session: normalizeTarget(session),
      });
    }
    for (const nested of Object.values(record)) visit(nested);
  };

  visit(value);
  const deduplicated = new Map<string, AutomationTarget>();
  for (const target of targets) {
    deduplicated.set(JSON.stringify(target), target);
  }
  return [...deduplicated.values()];
}

function targetsMatch(
  action: AutomationTarget,
  evidence: AutomationTarget,
): boolean {
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

function hasExplicitTarget(target: AutomationTarget): boolean {
  return Boolean(target.app || target.window || target.session);
}

function expectedTextForMutation(
  toolName: string,
  params: Record<string, unknown>,
): string | null {
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

function expectedElementIdForMutation(
  params: Record<string, unknown>,
): string | null {
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

function parseStructuredText(value: string): unknown | null {
  const trimmed = value.trim();
  if (
    trimmed.length === 0 ||
    trimmed.length > 1_000_000 ||
    (!trimmed.startsWith("{") && !trimmed.startsWith("["))
  ) {
    return null;
  }
  try {
    return JSON.parse(trimmed) as unknown;
  } catch {
    return null;
  }
}

function textHasExplicitElementValue(
  text: string,
  expectedElementId: string,
  expectedText: string,
  matchMode: "contains" | "exact",
): boolean {
  const normalizedElementId = expectedElementId
    .normalize("NFKC")
    .toLocaleLowerCase();
  const normalizedExpectedText = expectedText
    .normalize("NFKC")
    .toLocaleLowerCase();
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
  value: unknown,
  expectedElementId: string | null,
  expectedText: string,
  matchMode: "contains" | "exact",
): boolean {
  if (!expectedElementId) return false;
  const needle = expectedText.normalize("NFKC").toLocaleLowerCase();
  if (!needle && matchMode === "contains") return false;
  let remainingNodes = 2_000;
  const seen = new Set<object>();

  const containsExpectedValue = (record: Record<string, unknown>): boolean => {
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
    const attributes = asRecord(record.attributes);
    return attributes ? containsExpectedValue(attributes) : false;
  };

  const visit = (candidate: unknown): boolean => {
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
    const record = candidate as Record<string, unknown>;
    const candidateId = normalizeTarget(
      readText(record, [
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
    if (candidateId === expectedElementId && containsExpectedValue(record)) {
      return true;
    }
    return Object.values(record).some(visit);
  };

  return visit(value);
}

function resultHasCuaNativeVerification(value: unknown): boolean {
  const seen = new Set<object>();
  let remainingNodes = 100;

  const visit = (candidate: unknown): boolean => {
    if (remainingNodes-- <= 0 || !candidate || typeof candidate !== "object") {
      return false;
    }
    if (seen.has(candidate)) return false;
    seen.add(candidate);
    if (Array.isArray(candidate)) return candidate.some(visit);
    const record = candidate as Record<string, unknown>;
    if (record.verified === true) return true;
    return [
      record.result,
      record.data,
      record.payload,
      record.details,
      record.structuredContent,
    ].some(visit);
  };

  return visit(value);
}

function resultHasProviderVerification(
  value: unknown,
  toolName: string,
  expectedText: string | null,
  expectedElementId: string | null,
): boolean {
  if (
    toolName.startsWith("cua-driver__") &&
    resultHasCuaNativeVerification(value)
  ) {
    return true;
  }
  const seen = new Set<object>();
  let remainingNodes = 1_000;

  const visit = (candidate: unknown): boolean => {
    if (remainingNodes-- <= 0) return false;
    if (typeof candidate === "string") return false;
    if (!candidate || typeof candidate !== "object") return false;
    if (seen.has(candidate)) return false;
    seen.add(candidate);
    if (Array.isArray(candidate)) return candidate.some(visit);
    const record = candidate as Record<string, unknown>;
    const action = asRecord(record.action);
    const verification = asRecord(action?.verification);
    if (verification?.state === "verified") {
      if (expectedText === null) {
        const actionName = readText(action ?? {}, ["toolName", "actionName"]);
        const toolOperation = toolName.split("__").at(-1);
        if (!actionName || !toolOperation) return false;
        return (
          actionName.toLocaleLowerCase().replace(/[^a-z0-9]/g, "") ===
          toolOperation.toLocaleLowerCase().replace(/[^a-z0-9]/g, "")
        );
      }
      const verifiedElementId = action
        ? expectedElementIdForMutation(action)
        : null;
      if (expectedElementId && verifiedElementId !== expectedElementId) {
        return false;
      }
      const expected = readLiteralText(verification, ["expected"]);
      const property = readText(verification, ["property"]);
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
      const actualPreview = readLiteralText(verification, ["actualPreview"]);
      return (
        actualPreview === null ||
        actualPreview.normalize("NFKC").toLocaleLowerCase() ===
          normalizedRequested
      );
    }
    return [record.result, record.data, record.payload, record.content].some(
      visit,
    );
  };

  return visit(value);
}

function verificationKindForMutation(
  toolName: string,
  params: Record<string, unknown>,
): PendingAction["verificationKind"] {
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

function isReadOnlyMutationToolAction(
  toolName: string,
  action: string | undefined,
): boolean {
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

function isMutation(
  toolName: string,
  params: Record<string, unknown>,
): boolean {
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
  if (NON_MUTATING_TOOLS.has(toolName)) return false;
  if (MUTATION_TOOLS.has(toolName)) return true;
  return (
    toolName.startsWith("peekaboo__") || toolName.startsWith("cua-driver__")
  );
}

export class LocalAutomationCompletionGuard {
  private readonly runs = new Map<string, RunState>();
  private readonly finalFailures = new Map<
    string,
    LocalAutomationCompletionFailure
  >();

  observeAgentEvent(payload: unknown): void {
    const event = asRecord(payload);
    const runId = typeof event?.runId === "string" ? event.runId : null;
    if (!runId || event?.stream !== "tool") return;
    if (this.finalFailures.has(runId)) return;

    const data = asRecord(event.data);
    if (!data) return;
    const phase = typeof data?.phase === "string" ? data.phase : null;
    const name = typeof data?.name === "string" ? data.name : null;
    const toolCallId =
      typeof data?.toolCallId === "string" ? data.toolCallId : null;
    if (!phase || !name || !toolCallId) return;
    if (!OBSERVATION_TOOLS.has(name) && !isMutation(name, {})) return;

    if (phase === "start") {
      const state = this.getOrCreateRun(runId);
      state.calls.set(toolCallId, {
        name,
        params: asRecord(data.args) ?? {},
      });
      return;
    }

    if (phase !== "result") return;
    const state = this.getOrCreateRun(runId);
    const call = state.calls.get(toolCallId) ?? { name, params: {} };
    state.calls.delete(toolCallId);
    const target = resolveTarget(call.name, call.params);
    const failed = data.isError === true;

    if (isMutation(call.name, call.params)) {
      const aliases =
        call.name === "cua-driver__launch_app"
          ? resultTargets(data.result)
          : [];
      const expectedElementId = expectedElementIdForMutation(call.params);
      const expectedText = expectedTextForMutation(call.name, call.params);
      const fingerprint = mutationFingerprint(call.name, call.params);
      const verificationKind = verificationKindForMutation(
        call.name,
        call.params,
      );
      if (!failed) {
        state.pending = state.pending.filter((pending) =>
          pending.failed ? pending.fingerprint !== fingerprint : true,
        );
      }
      if (
        !failed &&
        hasExplicitTarget(target) &&
        resultHasProviderVerification(
          data.result,
          call.name,
          expectedText,
          expectedElementId,
        )
      ) {
        return;
      }
      state.pending.push({
        aliases,
        expectedElementId,
        expectedText,
        failed,
        fingerprint,
        target,
        toolName: call.name,
        verificationKind,
      });
      return;
    }

    if (OBSERVATION_TOOLS.has(call.name) && !failed) {
      state.pending = state.pending.filter(
        (pending) =>
          pending.failed ||
          ![pending.target, ...pending.aliases].some((candidate) =>
            targetsMatch(candidate, target),
          ) ||
          pending.verificationKind === "provider-only" ||
          (pending.verificationKind === "element-value" &&
            (pending.expectedText === null ||
              !evidenceConfirmsExpectedValue(
                data.result,
                pending.expectedElementId,
                pending.expectedText,
                pending.toolName.endsWith("__set_value") ? "exact" : "contains",
              ))),
      );
    }
  }

  finalFailureFor(runId: string): LocalAutomationCompletionFailure | null {
    const finalizedFailure = this.finalFailures.get(runId);
    if (finalizedFailure) return finalizedFailure;
    const state = this.runs.get(runId);
    const hasUnfinishedMutation = [...(state?.calls.values() ?? [])].some(
      (call) => isMutation(call.name, call.params),
    );
    if (!state || (state.pending.length === 0 && !hasUnfinishedMutation)) {
      this.runs.delete(runId);
      return null;
    }
    // An in-flight mutation at final time is strictly worse than an
    // unverifiable one: the tool never returned, so the action may not even
    // have been delivered. That stays a hard failure whatever its kind.
    const hasObtainableEvidenceGap =
      hasUnfinishedMutation ||
      state.pending.some(
        (pending) =>
          pending.failed || !UNVERIFIABLE_ACTION_TOOLS.has(pending.toolName),
      );
    const failure: LocalAutomationCompletionFailure = hasObtainableEvidenceGap
      ? {
          severity: "error",
          errorKind: "local_automation_unverified",
          errorMessage: LOCAL_AUTOMATION_UNVERIFIED_MESSAGE,
        }
      : {
          severity: "advisory",
          errorKind: "local_automation_unverified",
          errorMessage: LOCAL_AUTOMATION_ADVISORY_MESSAGE,
        };
    this.runs.delete(runId);
    this.finalFailures.set(runId, failure);
    if (this.finalFailures.size > MAX_TRACKED_RUNS) {
      const oldest = this.finalFailures.keys().next().value;
      if (oldest !== undefined) this.finalFailures.delete(oldest);
    }
    return failure;
  }

  discardRun(runId: string): void {
    this.runs.delete(runId);
  }

  private getOrCreateRun(runId: string): RunState {
    const existing = this.runs.get(runId);
    if (existing) return existing;
    const state: RunState = { calls: new Map(), pending: [] };
    this.runs.set(runId, state);
    if (this.runs.size > MAX_TRACKED_RUNS) {
      const oldest = this.runs.keys().next().value;
      if (oldest !== undefined) this.runs.delete(oldest);
    }
    return state;
  }
}
