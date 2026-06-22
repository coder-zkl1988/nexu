/**
 * nexu-toolcall-guard
 *
 * Circuit breaker for runaway tool-call retry loops.
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

// runId -> { toolName, count, paramsHash }
const runFailures = new Map();

function stableHash(params) {
  try {
    return JSON.stringify(params ?? {});
  } catch {
    return "";
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
      const runId = ctx?.runId || event?.runId;
      if (!runId) return;

      const rec = runFailures.get(runId);
      if (!rec || rec.toolName !== event?.toolName || rec.count < threshold) {
        return;
      }

      // Only block if there is still no progress: arguments unchanged from the
      // failing call, or still empty. If the model finally produced different,
      // non-empty arguments, let it through (it may have self-corrected).
      const paramsHash = stableHash(event?.params);
      if (paramsHash !== rec.paramsHash && !isEmptyParams(event?.params)) {
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

    // Phase 3: clean up when the run ends.
    api.on("agent_end", async (event, ctx) => {
      const runId = ctx?.runId || event?.runId;
      if (runId) runFailures.delete(runId);
    });
  },
};

export default plugin;
