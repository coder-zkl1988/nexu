import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  useComposeWorkflow,
  useCreateWorkflow,
  useDeleteWorkflow,
  useInstantiateWorkflowTemplate,
  useRunWorkflow,
  useTeamWorkflows,
  useWorkflowTemplates,
} from "@/hooks/use-team-workflows";
import type { TeamRunInfo } from "@/lib/a2ui/custom-components/TeamRunPanel";
import { pinTeamRunToCanvas } from "@/lib/canvas/team-step-node";
import type { TeamResponse } from "@nexu/shared";
import { History, Loader2, Play, Sparkles, Trash2 } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import type {
  GetApiV1TeamsByIdWorkflowsResponse,
  PostApiV1TeamsByIdWorkflowsByWorkflowIdRunResponse,
  PostApiV1TeamsByIdWorkflowsComposeResponse,
} from "../../../lib/api/types.gen";

// Generated (wire) shapes — schema defaults are optional on this side.
type WorkflowDto = GetApiV1TeamsByIdWorkflowsResponse["workflows"][number];
type RunResult = PostApiV1TeamsByIdWorkflowsByWorkflowIdRunResponse;
type ComposeResult = PostApiV1TeamsByIdWorkflowsComposeResponse;

const RECENT_RUN_STORAGE_PREFIX = "nexu:team-workflows:recent-run:";

/**
 * The run detail view lives in the workspace-level A2UI sidebar (survives
 * route changes; state is re-polled from the server). localStorage only
 * remembers WHICH run to reopen after the panel is closed or the app reloads.
 */
export function loadRecentRun(teamId: string): TeamRunInfo | null {
  try {
    const raw = localStorage.getItem(`${RECENT_RUN_STORAGE_PREFIX}${teamId}`);
    return raw ? (JSON.parse(raw) as TeamRunInfo) : null;
  } catch {
    return null;
  }
}

function storeRecentRun(teamId: string, run: TeamRunInfo): void {
  try {
    localStorage.setItem(
      `${RECENT_RUN_STORAGE_PREFIX}${teamId}`,
      JSON.stringify(run),
    );
  } catch {
    // localStorage unavailable/full — the reopen button just won't show.
  }
}

/** Map a started workflow run onto the shared run-panel data shape. */
export function toTeamRunInfo(
  team: TeamResponse,
  workflow: WorkflowDto,
  run: RunResult,
): TeamRunInfo {
  const nameBySlug = new Map(team.members.map((m) => [m.expertSlug, m.name]));
  const cardByStep = new Map(
    run.cards.map((card) => [card.stepId, card.cardId]),
  );
  return {
    teamId: team.id,
    boardId: run.boardId,
    parentCardId: run.parentCardId,
    runId: run.runId,
    workflowId: workflow.id,
    title: workflow.name,
    steps: workflow.steps.map((step) => ({
      id: step.id,
      name: step.name ?? step.id,
      assigneeName: nameBySlug.get(step.assigneeSlug) ?? step.assigneeSlug,
      cardId: cardByStep.get(step.id) ?? "",
      dependsOn: step.dependsOn ?? [],
      ...(step.type && step.type !== "task" ? { type: step.type } : {}),
    })),
  };
}

/**
 * Team workflows (SOP) section: reusable declarative workflows with a
 * template library and one-sentence auto-compose. Running a workflow opens
 * the live DAG panel in the workspace sidebar (shared with chat run cards).
 * See design docs P1–P5 + 2026-07-02-chat-first-team-operations.md.
 */
export function TeamWorkflows({ team }: { team: TeamResponse }) {
  const { t } = useTranslation();
  const { data, isLoading } = useTeamWorkflows(team.id);
  const deleteWorkflow = useDeleteWorkflow();
  const [templateOpen, setTemplateOpen] = useState(false);
  const [composeOpen, setComposeOpen] = useState(false);
  const [runTarget, setRunTarget] = useState<WorkflowDto | null>(null);
  const [recentRun, setRecentRun] = useState<TeamRunInfo | null>(() =>
    loadRecentRun(team.id),
  );

  function openRunPanel(run: TeamRunInfo) {
    pinTeamRunToCanvas(run);
  }

  const workflows = data?.workflows ?? [];

  return (
    <Card data-team-workflows="true">
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle>{t("teamWorkflows.title")}</CardTitle>
        <div className="flex gap-2">
          {recentRun ? (
            <Button
              variant="ghost"
              size="sm"
              data-recent-run={recentRun.parentCardId}
              onClick={() => openRunPanel(recentRun)}
            >
              <History className="mr-1 h-4 w-4" />
              {t("teamWorkflows.recentRun")}
            </Button>
          ) : null}
          <Button
            variant="outline"
            size="sm"
            onClick={() => setTemplateOpen(true)}
          >
            {t("teamWorkflows.fromTemplate")}
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => setComposeOpen(true)}
          >
            <Sparkles className="mr-1 h-4 w-4" />
            {t("teamWorkflows.compose")}
          </Button>
        </div>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {isLoading ? (
          <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
        ) : workflows.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            {t("teamWorkflows.empty")}
          </p>
        ) : (
          <div className="flex flex-col gap-2">
            {workflows.map((workflow) => (
              <div
                key={workflow.id}
                data-workflow-row={workflow.id}
                className="flex items-center gap-3 rounded-md border px-3 py-2"
              >
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="truncate text-sm font-medium">
                      {workflow.name}
                    </span>
                    {workflow.source === "builtin" ? (
                      <Badge variant="secondary">
                        {t("teamWorkflows.builtin")}
                      </Badge>
                    ) : null}
                    <span className="text-xs text-muted-foreground">
                      {t("teamWorkflows.stepCount", {
                        count: workflow.steps.length,
                      })}
                    </span>
                  </div>
                  {workflow.description ? (
                    <div className="truncate text-xs text-muted-foreground">
                      {workflow.description}
                    </div>
                  ) : null}
                </div>
                <Button
                  size="sm"
                  onClick={() => setRunTarget(workflow)}
                  data-workflow-run={workflow.id}
                >
                  <Play className="mr-1 h-4 w-4" />
                  {t("teamWorkflows.run")}
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label={t("teamWorkflows.delete")}
                  onClick={() => {
                    void deleteWorkflow
                      .mutateAsync({
                        teamId: team.id,
                        workflowId: workflow.id,
                      })
                      .catch(() => toast.error(t("teamWorkflows.errDelete")));
                  }}
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              </div>
            ))}
          </div>
        )}
      </CardContent>

      <TemplatePickerDialog
        team={team}
        open={templateOpen}
        onClose={() => setTemplateOpen(false)}
      />
      <ComposeDialog
        team={team}
        open={composeOpen}
        onClose={() => setComposeOpen(false)}
      />
      {runTarget ? (
        <RunDialog
          team={team}
          workflow={runTarget}
          onClose={() => setRunTarget(null)}
          onStarted={(run) => {
            const info = toTeamRunInfo(team, runTarget, run);
            storeRecentRun(team.id, info);
            setRecentRun(info);
            setRunTarget(null);
            openRunPanel(info);
          }}
        />
      ) : null}
    </Card>
  );
}

function TemplatePickerDialog({
  team,
  open,
  onClose,
}: {
  team: TeamResponse;
  open: boolean;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const { data } = useWorkflowTemplates();
  const instantiate = useInstantiateWorkflowTemplate();

  return (
    <Dialog open={open} onOpenChange={(next) => !next && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{t("teamWorkflows.templateTitle")}</DialogTitle>
        </DialogHeader>
        <DialogBody className="flex flex-col gap-2">
          <p className="text-xs text-muted-foreground">
            {t("teamWorkflows.templateHint")}
          </p>
          {(data?.templates ?? []).map((template) => (
            <div
              key={template.id}
              className="flex items-center gap-3 rounded-md border px-3 py-2"
            >
              <div className="min-w-0 flex-1">
                <div className="text-sm font-medium">{template.name}</div>
                <div className="truncate text-xs text-muted-foreground">
                  {template.description}
                </div>
              </div>
              <Button
                size="sm"
                disabled={instantiate.isPending}
                onClick={() => {
                  void instantiate
                    .mutateAsync({ teamId: team.id, templateId: template.id })
                    .then(() => {
                      toast.success(t("teamWorkflows.templateAdded"));
                      onClose();
                    })
                    .catch(() =>
                      toast.error(t("teamWorkflows.errInstantiate")),
                    );
                }}
              >
                {instantiate.isPending ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  t("teamWorkflows.use")
                )}
              </Button>
            </div>
          ))}
        </DialogBody>
      </DialogContent>
    </Dialog>
  );
}

function ComposeDialog({
  team,
  open,
  onClose,
}: {
  team: TeamResponse;
  open: boolean;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const compose = useComposeWorkflow();
  const createWorkflow = useCreateWorkflow();
  const [description, setDescription] = useState("");
  const [result, setResult] = useState<ComposeResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  function reset() {
    setDescription("");
    setResult(null);
    setError(null);
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) {
          reset();
          onClose();
        }
      }}
    >
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{t("teamWorkflows.composeTitle")}</DialogTitle>
        </DialogHeader>
        <DialogBody className="flex flex-col gap-3">
          <Textarea
            value={description}
            placeholder={t("teamWorkflows.composePlaceholder")}
            onChange={(event) => setDescription(event.target.value)}
          />
          {error ? <p className="text-sm text-destructive">{error}</p> : null}
          {result ? (
            <div className="flex flex-col gap-2 rounded-md border p-3">
              <div className="text-sm font-medium">{result.draft.name}</div>
              {result.draft.steps.map((step) => (
                <div key={step.id} className="text-xs">
                  <span className="font-medium">{step.name ?? step.id}</span>
                  <span className="text-muted-foreground">
                    {" "}
                    → {step.assigneeSlug}
                    {(step.dependsOn ?? []).length > 0
                      ? ` （${t("teamWorkflows.dependsOn")}: ${(step.dependsOn ?? []).join(", ")}）`
                      : ""}
                  </span>
                </div>
              ))}
              {result.warnings.length > 0 ? (
                <div className="flex flex-col gap-1 border-t pt-2">
                  {result.warnings.map((warning) => (
                    <div key={warning} className="text-xs text-amber-600">
                      {warning}
                    </div>
                  ))}
                </div>
              ) : null}
            </div>
          ) : null}
        </DialogBody>
        <DialogFooter>
          {result ? (
            <Button
              disabled={createWorkflow.isPending}
              onClick={() => {
                void createWorkflow
                  .mutateAsync({ teamId: team.id, body: result.draft })
                  .then(() => {
                    toast.success(t("teamWorkflows.composeSaved"));
                    reset();
                    onClose();
                  })
                  .catch(() => setError(t("teamWorkflows.errSave")));
              }}
            >
              {createWorkflow.isPending ? (
                <Loader2 className="mr-1 h-4 w-4 animate-spin" />
              ) : null}
              {t("teamWorkflows.saveDraft")}
            </Button>
          ) : (
            <Button
              disabled={compose.isPending || !description.trim()}
              onClick={() => {
                setError(null);
                void compose
                  .mutateAsync({
                    teamId: team.id,
                    body: { description: description.trim() },
                  })
                  .then(setResult)
                  .catch(() => setError(t("teamWorkflows.errCompose")));
              }}
            >
              {compose.isPending ? (
                <Loader2 className="mr-1 h-4 w-4 animate-spin" />
              ) : (
                <Sparkles className="mr-1 h-4 w-4" />
              )}
              {t("teamWorkflows.generate")}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function RunDialog({
  team,
  workflow,
  onClose,
  onStarted,
}: {
  team: TeamResponse;
  workflow: WorkflowDto;
  onClose: () => void;
  onStarted: (run: RunResult) => void;
}) {
  const { t } = useTranslation();
  const runWorkflow = useRunWorkflow();
  const [values, setValues] = useState<Record<string, string>>(() =>
    Object.fromEntries(
      (workflow.inputs ?? [])
        .filter((input) => input.default !== undefined)
        .map((input) => [input.name, input.default ?? ""]),
    ),
  );
  const [error, setError] = useState<string | null>(null);

  return (
    <Dialog open onOpenChange={(next) => !next && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>
            {t("teamWorkflows.runTitle", { name: workflow.name })}
          </DialogTitle>
        </DialogHeader>
        <DialogBody className="flex flex-col gap-3">
          {(workflow.inputs ?? []).map((input) => (
            <div key={input.name} className="flex flex-col gap-1.5">
              <Label htmlFor={`wf-input-${input.name}`}>
                {input.description ?? input.name}
                {input.required ? (
                  <span className="text-destructive"> *</span>
                ) : null}
              </Label>
              <Input
                id={`wf-input-${input.name}`}
                value={values[input.name] ?? ""}
                onChange={(event) =>
                  setValues((prev) => ({
                    ...prev,
                    [input.name]: event.target.value,
                  }))
                }
              />
            </div>
          ))}
          {error ? <p className="text-sm text-destructive">{error}</p> : null}
        </DialogBody>
        <DialogFooter>
          <Button
            disabled={runWorkflow.isPending}
            onClick={() => {
              setError(null);
              const missing = (workflow.inputs ?? []).filter(
                (input) => input.required && !values[input.name]?.trim(),
              );
              if (missing.length > 0) {
                setError(
                  t("teamWorkflows.errInputRequired", {
                    name: missing[0]?.name ?? "",
                  }),
                );
                return;
              }
              const inputs = Object.fromEntries(
                Object.entries(values).filter(([, value]) => value.trim()),
              );
              void runWorkflow
                .mutateAsync({
                  teamId: team.id,
                  workflowId: workflow.id,
                  body: { inputs },
                })
                .then(onStarted)
                .catch(() => setError(t("teamWorkflows.errRun")));
            }}
          >
            {runWorkflow.isPending ? (
              <Loader2 className="mr-1 h-4 w-4 animate-spin" />
            ) : (
              <Play className="mr-1 h-4 w-4" />
            )}
            {t("teamWorkflows.start")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
