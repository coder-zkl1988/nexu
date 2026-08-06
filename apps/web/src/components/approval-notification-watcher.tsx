import { useTeams } from "@/hooks/use-teams";
import { useQueries, useQuery } from "@tanstack/react-query";
import { useEffect, useMemo } from "react";
import { useTranslation } from "react-i18next";
import {
  getApiV1RuntimeApprovals,
  getApiV1TeamsByIdWorkflowApprovals,
} from "../../lib/api/sdk.gen";

const NOTIFIED_APPROVALS_STORAGE_KEY = "nexu:notified-approvals:v1";
const TEAM_APPROVAL_TTL_MS = 24 * 60 * 60 * 1000;
const MIN_RUNTIME_APPROVAL_TTL_MS = 60 * 60 * 1000;
const MAX_STORED_APPROVALS = 500;

interface ApprovalNotificationCandidate {
  id: string;
  body: string;
  expiresAtMs: number;
}

function readNotifiedApprovals(now: number): Map<string, number> {
  try {
    const raw = localStorage.getItem(NOTIFIED_APPROVALS_STORAGE_KEY);
    if (!raw) return new Map();
    const parsed: unknown = JSON.parse(raw);
    if (
      typeof parsed !== "object" ||
      parsed === null ||
      Array.isArray(parsed)
    ) {
      return new Map();
    }
    return new Map(
      Object.entries(parsed).flatMap(([id, expiresAtMs]) =>
        typeof expiresAtMs === "number" &&
        Number.isFinite(expiresAtMs) &&
        expiresAtMs > now
          ? [[id, expiresAtMs] as const]
          : [],
      ),
    );
  } catch {
    return new Map();
  }
}

function writeNotifiedApprovals(approvals: Map<string, number>): void {
  try {
    const newest = Array.from(approvals.entries())
      .sort((left, right) => right[1] - left[1])
      .slice(0, MAX_STORED_APPROVALS);
    localStorage.setItem(
      NOTIFIED_APPROVALS_STORAGE_KEY,
      JSON.stringify(Object.fromEntries(newest)),
    );
  } catch {
    // Notification delivery must not depend on storage availability.
  }
}

export function ApprovalNotificationWatcher() {
  const { t } = useTranslation();
  const teamsQuery = useTeams();
  const runtimeApprovalsQuery = useQuery({
    queryKey: ["runtime-approvals"],
    queryFn: async () => {
      const { data, error } = await getApiV1RuntimeApprovals();
      if (error || !data) throw new Error("Runtime approvals unavailable");
      return data;
    },
    refetchInterval: 3000,
  });
  const teams = teamsQuery.data?.teams ?? [];
  const teamApprovalQueries = useQueries({
    queries: teams.map((team) => ({
      queryKey: ["teams", team.id, "workflow-approvals"],
      queryFn: async () => {
        const { data, error } = await getApiV1TeamsByIdWorkflowApprovals({
          path: { id: team.id },
        });
        if (error || !data) throw new Error("Team approvals unavailable");
        return data;
      },
      refetchInterval: 3000,
    })),
  });

  const candidates = useMemo<ApprovalNotificationCandidate[]>(() => {
    const now = Date.now();
    return [
      ...(runtimeApprovalsQuery.data?.approvals ?? []).map((approval) => ({
        id: `runtime:${approval.kind}:${approval.id}`,
        body: approval.title,
        expiresAtMs: Math.max(
          approval.expiresAtMs,
          now + MIN_RUNTIME_APPROVAL_TTL_MS,
        ),
      })),
      ...teamApprovalQueries.flatMap((query, index) => {
        const team = teams[index];
        if (!team) return [];
        return (query.data?.approvals ?? []).map((approval) => ({
          id: `team:${team.id}:${approval.workflowId}:${approval.runId}:${approval.stepId}`,
          body: `${team.name}: ${approval.prompt}`,
          expiresAtMs: now + TEAM_APPROVAL_TTL_MS,
        }));
      }),
    ];
  }, [runtimeApprovalsQuery.data?.approvals, teamApprovalQueries, teams]);

  useEffect(() => {
    if (
      typeof Notification === "undefined" ||
      Notification.permission !== "granted" ||
      candidates.length === 0
    ) {
      return;
    }

    const now = Date.now();
    const notified = readNotifiedApprovals(now);
    let changed = false;
    for (const candidate of candidates) {
      if (notified.has(candidate.id)) continue;
      try {
        new Notification(t("sessions.operations.notificationTitle"), {
          body: candidate.body,
        });
        notified.set(candidate.id, candidate.expiresAtMs);
        changed = true;
      } catch {
        // A later poll can retry if the platform rejected this notification.
      }
    }
    if (changed) writeNotifiedApprovals(notified);
  }, [candidates, t]);

  return null;
}
