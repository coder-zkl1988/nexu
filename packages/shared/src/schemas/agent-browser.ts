import { z } from "zod";

/**
 * Agent control of the embedded browser.
 *
 * The agent runs in OpenClaw, the browser view lives in the Electron main
 * process, and the panel that gives that view its bounds is owned by the web
 * renderer. Rather than let the controller reach into the main process, the
 * renderer is the executor: it subscribes to a command stream and calls the
 * desktop host itself.
 *
 * That is not just plumbing convenience. The executor being the panel makes
 * "the user can see what the agent is doing" structural — an action cannot be
 * performed while the panel is closed, because the thing that performs it is
 * the panel.
 */

export const agentBrowserCommandSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("open"), url: z.string() }),
  z.object({ action: z.literal("snapshot") }),
  z.object({ action: z.literal("click"), ref: z.string() }),
  z.object({
    action: z.literal("type"),
    ref: z.string(),
    text: z.string(),
    submit: z.boolean().optional(),
  }),
  z.object({ action: z.literal("scroll"), deltaY: z.number() }),
]);

export const agentBrowserSnapshotNodeSchema = z.object({
  ref: z.string(),
  role: z.string(),
  name: z.string(),
  value: z.string().optional(),
  disabled: z.boolean().optional(),
  depth: z.number(),
});

export const agentBrowserSnapshotSchema = z.object({
  url: z.string(),
  title: z.string(),
  truncated: z.boolean(),
  nodes: z.array(agentBrowserSnapshotNodeSchema),
});

/**
 * What an action leaves behind: where the page ended up, and the state of the
 * element that was acted on.
 *
 * Every successful action carries evidence rather than a bare acknowledgement.
 * A browser can be read back, unlike a desktop click, so "it succeeded" and
 * "here is the element afterwards" cost the same round trip — and only the
 * second one can be checked.
 */
export const agentBrowserObservationSchema = z.object({
  url: z.string(),
  title: z.string(),
  // Absent when the element is gone — usually because the click navigated.
  // Optional rather than nullable: the OpenAPI 3.0 `nullable` this emits is
  // dropped by the SDK generator, so a nullable field would type as non-null
  // in the frontend.
  element: agentBrowserSnapshotNodeSchema.optional(),
  navigated: z.boolean(),
});

/** What the renderer sends back for a command it finished executing. */
export const agentBrowserOutcomeSchema = z.union([
  z.object({ ok: z.literal(true), snapshot: agentBrowserSnapshotSchema }),
  z.object({
    ok: z.literal(true),
    observation: agentBrowserObservationSchema,
  }),
  z.object({ ok: z.literal(false), error: z.string() }),
]);

/** What the runtime plugin POSTs on behalf of the agent. */
export const agentBrowserActBodySchema = z.object({
  sessionKey: z.string(),
  command: agentBrowserCommandSchema,
});

/** What the renderer POSTs once a dispatched command settles. */
export const agentBrowserResultBodySchema = z.object({
  requestId: z.string(),
  outcome: agentBrowserOutcomeSchema,
});

export const agentBrowserResultAckSchema = z.object({
  // False when the request already timed out and no one is waiting any more.
  accepted: z.boolean(),
});

export type AgentBrowserCommand = z.infer<typeof agentBrowserCommandSchema>;
export type AgentBrowserSnapshot = z.infer<typeof agentBrowserSnapshotSchema>;
export type AgentBrowserOutcome = z.infer<typeof agentBrowserOutcomeSchema>;
