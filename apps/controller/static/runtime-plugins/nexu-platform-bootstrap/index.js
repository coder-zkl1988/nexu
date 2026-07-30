const TOOL_PROGRESS_PROMPT =
  "When using tools, briefly state what you are about to do before each call and report progress between steps. Never go silent during multi-step work. For desktop/computer tools, resolve and pass an explicit app, window, or snapshot whenever the tool supports it; do not rely on frontmost state. An action receipt only confirms dispatch, and a generic same-target screenshot does not prove a click, hotkey, scroll, or drag achieved its intended result. Claim completion only when the provider explicitly marks the action verified, a typed/assigned value is read back from the same element, or a launched target is subsequently observed; otherwise report the action as unverified or failed.";

const plugin = {
  id: "nexu-platform-bootstrap",
  name: "Nexu Platform Bootstrap",
  description:
    "Injects platform-level prompt context including tool progress feedback instructions.",
  register(api) {
    try { api.logger.info("[nexu-platform-bootstrap] loaded — injecting platform prompt context"); } catch {}
    api.on("before_prompt_build", async () => {
      return {
        prependSystemContext: TOOL_PROGRESS_PROMPT,
      };
    });
  },
};

export default plugin;
