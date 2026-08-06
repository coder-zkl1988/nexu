const EXECUTION_SESSION_KEY_PREFIX = "[NEXU_EXECUTION_SESSION_KEY] ";

/** Read cards created before Nexu wrote Workboard's native sessionKey field. */
export function executionSessionKeyFromNotes(
  notes: string | undefined,
): string | null {
  const firstLine = notes?.split(/\r?\n/, 1)[0]?.trim();
  if (!firstLine?.startsWith(EXECUTION_SESSION_KEY_PREFIX)) {
    return null;
  }
  const sessionKey = firstLine
    .slice(EXECUTION_SESSION_KEY_PREFIX.length)
    .trim();
  return sessionKey || null;
}
