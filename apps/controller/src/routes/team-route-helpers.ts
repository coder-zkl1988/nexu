import { logger } from "../lib/logger.js";

/**
 * Map an unexpected team run / compose / gateway failure to a graceful 502.
 * Known outcomes are handled at each call site ahead of this catch-all:
 * WorkflowValidationError / WorkflowInputError / TeamMemberNotInstalledError →
 * 400, TeamNotFoundError (and workflow/approval not-found) → 404. This covers
 * upstream failures — a gateway non-OK/timeout/network drop surfaced as a
 * generic Error from WorkflowComposer.complete, or a workboard card op that
 * fails during setup — so the route degrades per the "502 = upstream run/
 * compose failure" contract instead of leaking a bare Hono 500. The raw error
 * is logged server-side for debugging; the client only sees a generic message
 * (never internal detail or credentials).
 */
export function teamRunUpstreamFailure(error: unknown): { message: string } {
  logger.error({ err: error }, "team run: upstream failure");
  return { message: "运行启动失败，请稍后重试" };
}
