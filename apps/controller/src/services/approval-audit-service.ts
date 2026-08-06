import { z } from "zod";
import { LowDbStore } from "../store/lowdb-store.js";

const approvalAuditSourceSchema = z.enum(["openclaw", "team"]);
const approvalAuditKindSchema = z.enum(["exec", "plugin", "team"]);
const approvalAuditStatusSchema = z.enum([
  "pending",
  "approved",
  "denied",
  "expired",
  "interrupted",
  "failed",
]);
const approvalAuditDecisionSchema = z.enum([
  "allow-once",
  "allow-always",
  "deny",
  "approved",
  "rejected",
  "expired",
  "interrupted",
]);

export const approvalAuditEntrySchema = z.object({
  id: z.string(),
  approvalId: z.string(),
  source: approvalAuditSourceSchema,
  kind: approvalAuditKindSchema,
  status: approvalAuditStatusSchema,
  decision: approvalAuditDecisionSchema.optional(),
  title: z.string(),
  description: z.string().optional(),
  reviewer: z.string().optional(),
  agentId: z.string().optional(),
  sessionKey: z.string().optional(),
  runId: z.string().optional(),
  teamId: z.string().optional(),
  workflowId: z.string().optional(),
  stepId: z.string().optional(),
  cardId: z.string().optional(),
  requestedAt: z.number().int().nonnegative(),
  expiresAt: z.number().int().nonnegative().optional(),
  resolvedAt: z.number().int().nonnegative().optional(),
});

const approvalAuditLedgerSchema = z.object({
  version: z.literal(1),
  entries: z.array(approvalAuditEntrySchema),
});

export type ApprovalAuditEntry = z.infer<typeof approvalAuditEntrySchema>;
export type ApprovalAuditSource = z.infer<typeof approvalAuditSourceSchema>;
export type ApprovalAuditKind = z.infer<typeof approvalAuditKindSchema>;
export type ApprovalAuditStatus = z.infer<typeof approvalAuditStatusSchema>;
export type ApprovalAuditDecision = z.infer<typeof approvalAuditDecisionSchema>;

type ApprovalAuditRequestedInput = Omit<
  ApprovalAuditEntry,
  "id" | "status" | "decision" | "reviewer" | "resolvedAt"
>;

type ApprovalAuditResolvedInput = {
  approvalId: string;
  source: ApprovalAuditSource;
  kind: ApprovalAuditKind;
  status: Exclude<ApprovalAuditStatus, "pending">;
  decision?: ApprovalAuditDecision;
  reviewer?: string;
  resolvedAt?: number;
  title?: string;
  description?: string;
  agentId?: string;
  sessionKey?: string;
  runId?: string;
  teamId?: string;
  workflowId?: string;
  stepId?: string;
  cardId?: string;
};

const rawApprovalRequestSchema = z.object({
  id: z.string(),
  request: z.record(z.unknown()),
  createdAtMs: z.number().int().nonnegative(),
  expiresAtMs: z.number().int().nonnegative(),
});

const rawApprovalResolvedSchema = z.object({
  id: z.string(),
  decision: z.enum(["allow-once", "allow-always", "deny"]),
  resolvedBy: z.string().nullable().optional(),
  ts: z.number().int().nonnegative(),
  request: z.record(z.unknown()).optional(),
});

const MAX_ENTRIES = 10_000;
const RETENTION_MS = 30 * 24 * 60 * 60_000;

function optionalString(record: Record<string, unknown>, key: string) {
  const value = record[key];
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function bounded(value: string | undefined, limit: number) {
  return value?.trim().slice(0, limit) || undefined;
}

function auditTitle(source: ApprovalAuditSource, kind: ApprovalAuditKind) {
  if (source === "team") return "Team approval";
  return kind === "exec" ? "Command approval" : "Plugin approval";
}

function normalizedReviewer(value: string | null | undefined) {
  const reviewer = bounded(value ?? undefined, 120);
  if (!reviewer || reviewer === "gateway-client") return undefined;
  return reviewer;
}

function approvalKey(source: ApprovalAuditSource, approvalId: string) {
  return `${source}:${approvalId}`;
}

function requestEntryId(source: ApprovalAuditSource, approvalId: string) {
  return `${source}:${encodeURIComponent(approvalId)}:requested`;
}

function resolvedEntryId(
  input: ApprovalAuditResolvedInput,
  reviewer: string | undefined,
) {
  return [
    input.source,
    encodeURIComponent(input.approvalId),
    "resolved",
    input.status,
    input.decision ?? "none",
    encodeURIComponent(reviewer ?? "unspecified"),
  ].join(":");
}

type AuditContext = Pick<
  ApprovalAuditEntry,
  | "agentId"
  | "sessionKey"
  | "runId"
  | "teamId"
  | "workflowId"
  | "stepId"
  | "cardId"
>;

function sanitizedContext(input: Partial<AuditContext>) {
  return {
    ...(bounded(input.agentId, 500)
      ? { agentId: bounded(input.agentId, 500) }
      : {}),
    ...(bounded(input.sessionKey, 500)
      ? { sessionKey: bounded(input.sessionKey, 500) }
      : {}),
    ...(bounded(input.runId, 500) ? { runId: bounded(input.runId, 500) } : {}),
    ...(bounded(input.teamId, 500)
      ? { teamId: bounded(input.teamId, 500) }
      : {}),
    ...(bounded(input.workflowId, 500)
      ? { workflowId: bounded(input.workflowId, 500) }
      : {}),
    ...(bounded(input.stepId, 500)
      ? { stepId: bounded(input.stepId, 500) }
      : {}),
    ...(bounded(input.cardId, 500)
      ? { cardId: bounded(input.cardId, 500) }
      : {}),
  };
}

function eventTimestamp(entry: ApprovalAuditEntry) {
  return entry.resolvedAt ?? entry.requestedAt;
}

function hasTerminalEntry(
  entries: ApprovalAuditEntry[],
  source: ApprovalAuditSource,
  approvalId: string,
) {
  return entries.some(
    (entry) =>
      entry.source === source &&
      entry.approvalId === approvalId &&
      entry.status !== "pending",
  );
}

function createResolvedEntry(
  entries: ApprovalAuditEntry[],
  input: ApprovalAuditResolvedInput,
) {
  const reviewer = normalizedReviewer(input.reviewer);
  const id = resolvedEntryId(input, reviewer);
  const duplicate = entries.find(
    (entry) =>
      entry.source === input.source &&
      entry.approvalId === input.approvalId &&
      entry.status === input.status &&
      entry.decision === input.decision &&
      normalizedReviewer(entry.reviewer) === reviewer,
  );
  if (duplicate) return duplicate;

  const requested = entries.find(
    (entry) =>
      entry.source === input.source &&
      entry.approvalId === input.approvalId &&
      entry.status === "pending",
  );
  const resolvedAt = input.resolvedAt ?? Date.now();
  return approvalAuditEntrySchema.parse({
    id,
    approvalId: input.approvalId,
    source: input.source,
    kind: input.kind,
    status: input.status,
    ...(input.decision ? { decision: input.decision } : {}),
    title: auditTitle(input.source, input.kind),
    ...(reviewer ? { reviewer } : {}),
    ...sanitizedContext({
      agentId: input.agentId ?? requested?.agentId,
      sessionKey: input.sessionKey ?? requested?.sessionKey,
      runId: input.runId ?? requested?.runId,
      teamId: input.teamId ?? requested?.teamId,
      workflowId: input.workflowId ?? requested?.workflowId,
      stepId: input.stepId ?? requested?.stepId,
      cardId: input.cardId ?? requested?.cardId,
    }),
    requestedAt: requested?.requestedAt ?? resolvedAt,
    ...(requested?.expiresAt !== undefined
      ? { expiresAt: requested.expiresAt }
      : {}),
    resolvedAt,
  });
}

function sanitizeStoredEntry(entry: ApprovalAuditEntry) {
  const { description: _description, ...metadata } = entry;
  return approvalAuditEntrySchema.parse({
    ...metadata,
    title: auditTitle(entry.source, entry.kind),
  });
}

function pruneEntries(entries: ApprovalAuditEntry[], now: number) {
  const sanitizedEntries = entries.map(sanitizeStoredEntry);
  const terminalApprovals = new Set(
    sanitizedEntries
      .filter((entry) => entry.status !== "pending")
      .map((entry) => approvalKey(entry.source, entry.approvalId)),
  );
  const retained = sanitizedEntries
    .filter(
      (entry) =>
        (entry.status === "pending" &&
          !terminalApprovals.has(
            approvalKey(entry.source, entry.approvalId),
          )) ||
        eventTimestamp(entry) >= now - RETENTION_MS,
    )
    .sort(
      (left, right) =>
        eventTimestamp(right) - eventTimestamp(left) ||
        right.id.localeCompare(left.id),
    );
  return retained.slice(0, MAX_ENTRIES);
}

export class ApprovalAuditService {
  private readonly store: LowDbStore<z.infer<typeof approvalAuditLedgerSchema>>;
  private ledgerQueue: Promise<void> = Promise.resolve();

  constructor(filePath: string) {
    this.store = new LowDbStore(filePath, approvalAuditLedgerSchema, () => ({
      version: 1,
      entries: [],
    }));
  }

  private runLedgerOperation<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.ledgerQueue.then(operation);
    this.ledgerQueue = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }

  recordRequested(input: ApprovalAuditRequestedInput) {
    return this.runLedgerOperation(async () => {
      const id = requestEntryId(input.source, input.approvalId);
      let recorded: ApprovalAuditEntry | undefined;
      await this.store.update((ledger) => {
        const existing = ledger.entries.find(
          (entry) =>
            entry.source === input.source &&
            entry.approvalId === input.approvalId &&
            entry.status === "pending",
        );
        if (existing) {
          recorded = sanitizeStoredEntry(existing);
          return {
            version: 1,
            entries: pruneEntries(ledger.entries, Date.now()),
          };
        }
        recorded = approvalAuditEntrySchema.parse({
          id,
          approvalId: input.approvalId,
          source: input.source,
          kind: input.kind,
          status: "pending",
          title: auditTitle(input.source, input.kind),
          ...sanitizedContext(input),
          requestedAt: input.requestedAt,
          ...(input.expiresAt !== undefined
            ? { expiresAt: input.expiresAt }
            : {}),
        });
        return {
          version: 1,
          entries: pruneEntries([recorded, ...ledger.entries], Date.now()),
        };
      });
      return recorded;
    });
  }

  recordResolved(input: ApprovalAuditResolvedInput) {
    return this.runLedgerOperation(async () => {
      let recorded: ApprovalAuditEntry | undefined;
      await this.store.update((ledger) => {
        recorded = sanitizeStoredEntry(
          createResolvedEntry(ledger.entries, input),
        );
        if (ledger.entries.some((entry) => entry.id === recorded?.id)) {
          return {
            version: 1,
            entries: pruneEntries(ledger.entries, Date.now()),
          };
        }
        return {
          version: 1,
          entries: pruneEntries([recorded, ...ledger.entries], Date.now()),
        };
      });
      return recorded;
    });
  }

  async observeGatewayRequested(kind: "exec" | "plugin", payload: unknown) {
    const parsed = rawApprovalRequestSchema.safeParse(payload);
    if (!parsed.success) return false;
    const request = parsed.data.request;
    await this.recordRequested({
      approvalId: parsed.data.id,
      source: "openclaw",
      kind,
      title: auditTitle("openclaw", kind),
      ...(optionalString(request, "agentId")
        ? { agentId: optionalString(request, "agentId") }
        : {}),
      ...(optionalString(request, "sessionKey")
        ? { sessionKey: optionalString(request, "sessionKey") }
        : {}),
      requestedAt: parsed.data.createdAtMs,
      expiresAt: parsed.data.expiresAtMs,
    });
    return true;
  }

  async observeGatewayResolved(kind: "exec" | "plugin", payload: unknown) {
    const parsed = rawApprovalResolvedSchema.safeParse(payload);
    if (!parsed.success) return false;
    const request = parsed.data.request ?? {};
    await this.recordResolved({
      approvalId: parsed.data.id,
      source: "openclaw",
      kind,
      status: parsed.data.decision === "deny" ? "denied" : "approved",
      decision: parsed.data.decision,
      reviewer: normalizedReviewer(parsed.data.resolvedBy),
      resolvedAt: parsed.data.ts,
      title: auditTitle("openclaw", kind),
      ...(optionalString(request, "agentId")
        ? { agentId: optionalString(request, "agentId") }
        : {}),
      ...(optionalString(request, "sessionKey")
        ? { sessionKey: optionalString(request, "sessionKey") }
        : {}),
    });
    return true;
  }

  markInterruptedTeamApprovals() {
    return this.runLedgerOperation(async () => {
      const now = Date.now();
      await this.store.update((ledger) => {
        let entries = ledger.entries;
        for (const pending of ledger.entries) {
          if (
            pending.source !== "team" ||
            pending.status !== "pending" ||
            hasTerminalEntry(entries, pending.source, pending.approvalId)
          ) {
            continue;
          }
          entries = [
            createResolvedEntry(entries, {
              approvalId: pending.approvalId,
              source: pending.source,
              kind: pending.kind,
              status: "interrupted",
              decision: "interrupted",
              reviewer: "system",
              resolvedAt: now,
            }),
            ...entries,
          ];
        }
        return { version: 1, entries: pruneEntries(entries, now) };
      });
    });
  }

  list(filters?: {
    source?: ApprovalAuditSource;
    status?: ApprovalAuditStatus;
    limit?: number;
  }) {
    return this.runLedgerOperation(async () => {
      const now = Date.now();
      const ledger = await this.store.update((current) => {
        let entries = current.entries;
        for (const pending of current.entries) {
          if (
            pending.status !== "pending" ||
            pending.expiresAt === undefined ||
            pending.expiresAt > now ||
            hasTerminalEntry(entries, pending.source, pending.approvalId)
          ) {
            continue;
          }
          entries = [
            createResolvedEntry(entries, {
              approvalId: pending.approvalId,
              source: pending.source,
              kind: pending.kind,
              status: "expired",
              decision: "expired",
              reviewer: "system",
              resolvedAt: pending.expiresAt,
            }),
            ...entries,
          ];
        }
        return { version: 1, entries: pruneEntries(entries, now) };
      });
      const limit = Math.max(1, Math.min(filters?.limit ?? 100, 500));
      return ledger.entries
        .filter(
          (entry) =>
            (!filters?.source || entry.source === filters.source) &&
            (!filters?.status || entry.status === filters.status),
        )
        .sort(
          (left, right) =>
            eventTimestamp(right) - eventTimestamp(left) ||
            right.id.localeCompare(left.id),
        )
        .slice(0, limit);
    });
  }
}
