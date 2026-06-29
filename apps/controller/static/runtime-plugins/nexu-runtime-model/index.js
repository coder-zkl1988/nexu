import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const pluginDir = path.dirname(fileURLToPath(import.meta.url));
const statePath = path.resolve(
  pluginDir,
  "..",
  "..",
  "nexu-runtime-model.json",
);
// OpenClaw's compiled config lives at the state-dir root, next to the runtime
// model state file. It is the source of truth for which providers/models the
// runtime registry actually knows about.
const openclawConfigPath = path.resolve(
  pluginDir,
  "..",
  "..",
  "openclaw.json",
);

let cachedRaw = null;
let cachedState = null;

function loadState() {
  try {
    const raw = readFileSync(statePath, "utf8");
    if (cachedState && cachedRaw === raw) {
      return cachedState;
    }
    const parsed = JSON.parse(raw);
    if (
      !parsed ||
      typeof parsed !== "object" ||
      typeof parsed.selectedModelRef !== "string" ||
      typeof parsed.promptNotice !== "string"
    ) {
      return null;
    }
    cachedRaw = raw;
    cachedState = parsed;
    return parsed;
  } catch {
    return cachedState;
  }
}

let cachedConfigRaw = null;
let cachedProviderModels = null;

/**
 * Map of provider key -> Set of model ids registered in openclaw.json.
 * Cached by raw file content so we re-parse only when the config changes.
 */
function loadProviderModels() {
  try {
    const raw = readFileSync(openclawConfigPath, "utf8");
    if (cachedProviderModels && cachedConfigRaw === raw) {
      return cachedProviderModels;
    }
    const parsed = JSON.parse(raw);
    const providers = parsed?.models?.providers ?? {};
    const map = new Map();
    for (const [providerKey, providerValue] of Object.entries(providers)) {
      const models = providerValue?.models;
      const ids = new Set();
      if (Array.isArray(models)) {
        for (const m of models) {
          if (m && typeof m.id === "string") ids.add(m.id);
        }
      } else if (models && typeof models === "object") {
        for (const id of Object.keys(models)) ids.add(id);
      }
      map.set(providerKey, ids);
    }
    cachedConfigRaw = raw;
    cachedProviderModels = map;
    return map;
  } catch {
    return cachedProviderModels;
  }
}

/**
 * True when the override is safe to apply: either it carries no provider
 * prefix (a bare model override we can't validate, so we trust it), or the
 * provider exists in the registry and the model id is registered under it.
 *
 * Defends against a stale/invalid runtime-model selection (e.g. an
 * `anthropic/...` ref with no Anthropic provider configured) silently
 * bricking every reply with "Unknown model" — when invalid we skip the
 * override and let the agent fall back to its own configured model.
 */
function isOverrideRegistered(providerOverride, modelOverride) {
  if (!providerOverride) return true;
  const providerModels = loadProviderModels();
  // Can't read the registry → fail open (preserve previous behaviour).
  if (!providerModels) return true;
  const ids = providerModels.get(providerOverride);
  if (!ids) return false; // unknown provider (the real failure mode)
  if (ids.size === 0) return true; // provider known but model list empty → trust
  if (ids.has(modelOverride)) return true;
  // Tolerate refs that double-prefix the model (e.g. "stepfun/step-3.7-flash").
  const lastSegment = modelOverride.includes("/")
    ? modelOverride.slice(modelOverride.lastIndexOf("/") + 1)
    : modelOverride;
  return ids.has(lastSegment);
}

function resolveValidOverride(state) {
  if (!state || state.selectedModelRef.trim().length === 0) {
    return null;
  }
  const slashIndex = state.selectedModelRef.indexOf("/");
  const providerOverride =
    slashIndex > 0 ? state.selectedModelRef.slice(0, slashIndex) : "";
  const modelOverride =
    slashIndex > 0
      ? state.selectedModelRef.slice(slashIndex + 1)
      : state.selectedModelRef;
  if (!isOverrideRegistered(providerOverride, modelOverride)) {
    return null;
  }
  return { providerOverride, modelOverride };
}

const plugin = {
  id: "nexu-runtime-model",
  name: "Nexu Runtime Model",
  description:
    "Injects Nexu runtime model selection into model routing and prompt context.",
  register(api) {
    try {
      api.logger.info(
        "[nexu-runtime-model] loaded — intercepting before_model_resolve",
      );
    } catch {}
    api.on("before_model_resolve", async () => {
      const state = loadState();
      const override = resolveValidOverride(state);
      if (!override) {
        if (state && state.selectedModelRef.trim().length > 0) {
          try {
            api.logger.warn(
              `[nexu-runtime-model] selected model "${state.selectedModelRef}" is not in the registry — skipping override, falling back to the agent's configured model`,
            );
          } catch {}
        }
        return;
      }
      return {
        ...(override.providerOverride
          ? { providerOverride: override.providerOverride }
          : {}),
        modelOverride: override.modelOverride,
      };
    });

    api.on("before_prompt_build", async () => {
      const state = loadState();
      // Only inject the "authoritative model is X" notice when the override is
      // actually being applied — otherwise the prompt would lie about a model
      // the runtime isn't using.
      if (
        !state ||
        state.promptNotice.trim().length === 0 ||
        !resolveValidOverride(state)
      ) {
        return;
      }
      return {
        prependSystemContext: state.promptNotice,
      };
    });
  },
};

export default plugin;
