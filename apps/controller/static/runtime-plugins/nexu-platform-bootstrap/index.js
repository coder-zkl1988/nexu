const TOOL_PROGRESS_PROMPT =
  "When using tools, briefly state what you are about to do before each call and report progress between steps. Never go silent during multi-step work.";

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
