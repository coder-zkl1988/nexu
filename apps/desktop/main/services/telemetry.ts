import * as Sentry from "@sentry/electron/main";

/**
 * Central error-reporting gate for the desktop main process.
 *
 * `reportError` is the one place handled failures should be surfaced from
 * (auto-update errors, runtime failures, device faults relayed up, …). It is a
 * no-op unless crash reporting is BOTH configured (Sentry DSN present) and
 * consented to (the "崩溃报告 / Crash reports" toggle, default on) — enforced via
 * `active`. index.ts owns the actual Sentry lifecycle and registers a consent
 * applier here so the toggle can start/stop reporting at runtime without a
 * circular import.
 */

let active = false;
let consentApplier: ((enabled: boolean) => void) | null = null;

export function setTelemetryActive(value: boolean): void {
  active = value;
}

export function isTelemetryActive(): boolean {
  return active;
}

/** index.ts registers how to actually start/stop Sentry (it owns the DSN + init options). */
export function setCrashReportsConsentApplier(
  fn: ((enabled: boolean) => void) | null,
): void {
  consentApplier = fn;
}

/** Called by the settings toggle (via IPC) to start/stop crash reporting live. */
export function applyCrashReportsConsent(enabled: boolean): void {
  consentApplier?.(enabled);
}

const SENSITIVE_KEY =
  /(token|key|secret|password|apikey|dsn|authorization|cookie)/i;

/** Recursively redact credential-looking values so context never leaks secrets. */
function redact(value: unknown, keyIsSensitive = false): unknown {
  if (typeof value === "string") {
    return keyIsSensitive ? "<redacted>" : value;
  }
  if (Array.isArray(value)) {
    return value.map((item) => redact(item));
  }
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) {
      out[k] = redact(v, SENSITIVE_KEY.test(k));
    }
    return out;
  }
  return value;
}

/**
 * Report a handled error with structured context. Safe to call from anywhere in
 * the main process; does nothing unless reporting is active and consented.
 */
export function reportError(
  err: unknown,
  ctx: {
    /** Coarse subsystem, e.g. "updater", "runtime", "device". */
    area: string;
    /** Stable machine-readable cause, e.g. "download_failed". */
    reasonCode?: string;
    /** Extra context; credential-looking fields are redacted before sending. */
    extra?: Record<string, unknown>;
  },
): void {
  if (!active) {
    return;
  }
  const error =
    err instanceof Error
      ? err
      : new Error(typeof err === "string" ? err : JSON.stringify(err));
  Sentry.captureException(error, {
    tags: {
      area: ctx.area,
      ...(ctx.reasonCode ? { reasonCode: ctx.reasonCode } : {}),
    },
    ...(ctx.extra
      ? { extra: redact(ctx.extra) as Record<string, unknown> }
      : {}),
  });
}
