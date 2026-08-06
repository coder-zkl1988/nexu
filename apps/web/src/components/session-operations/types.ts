import type {
  GetApiV1RuntimeOperationsResponse,
  GetApiV1RuntimeRecoveryResponse,
} from "../../../lib/api/types.gen";

export interface SessionOperationTool {
  id: string;
  name: string;
  summary: string;
}

export interface SessionOperationSnapshot {
  busy: boolean;
  messageCount: number;
  modelId: string | null;
  contextUsedTokens: number | null;
  contextWindowTokens: number | null;
  contextFresh: boolean | null;
  sessionKey: string | null;
  agentId: string | null;
  startedAt: number | null;
  tools: SessionOperationTool[];
  fileCount: number;
  imageCount: number;
  previewCount: number;
  canvasCount: number;
  browserAvailable: boolean;
  browserOpen: boolean;
  browserOwnedByAgent: boolean;
}

export interface PendingApprovalView {
  teamId: string;
  teamName: string;
  workflowId: string;
  runId: string;
  stepId: string;
  prompt: string;
}

export type OperationsTab = "run" | "approvals" | "health" | "recovery";
export type RuntimeApproval =
  GetApiV1RuntimeOperationsResponse["approvals"][number];
export type RuntimeTask = GetApiV1RuntimeOperationsResponse["tasks"][number];
export type TaskGraph = GetApiV1RuntimeOperationsResponse["taskGraph"];
export type TaskGraphNode = TaskGraph["nodes"][number];
export type RecoveryCheckpoint =
  GetApiV1RuntimeRecoveryResponse["checkpoints"][number];
export type ApprovalDecision = RuntimeApproval["allowedDecisions"][number];
