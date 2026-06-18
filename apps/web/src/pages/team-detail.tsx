import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { PageHeader } from "@/components/ui/page-header";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { useRunTeamTask, useRunTeamTaskAuto, useTeam } from "@/hooks/use-teams";
import type { TeamSubtaskInput } from "@nexu/shared";
import { ArrowLeft, Loader2, Plus, Sparkles, Trash2 } from "lucide-react";
import { useState } from "react";
import { Link, useParams } from "react-router-dom";

type SubtaskDraft = {
  id: string;
  title: string;
  assigneeSlug: string;
  notes: string;
};

type StartedRun = { cardId: string; sessionKey: string };

export function TeamDetailPage() {
  const { id } = useParams<{ id: string }>();
  const { data: team, isLoading, isError } = useTeam(id ?? null);
  const runTask = useRunTeamTask();
  const runAuto = useRunTeamTaskAuto();

  const [mode, setMode] = useState<"auto" | "manual">("auto");
  const [task, setTask] = useState("");
  const [subtasks, setSubtasks] = useState<SubtaskDraft[]>(() => [
    { id: crypto.randomUUID(), title: "", assigneeSlug: "", notes: "" },
  ]);
  const [error, setError] = useState<string | null>(null);
  const [plan, setPlan] = useState<TeamSubtaskInput[] | null>(null);
  const [started, setStarted] = useState<StartedRun[] | null>(null);

  if (isLoading) {
    return (
      <div className="flex items-center gap-2 text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" />
        Loading team…
      </div>
    );
  }
  if (isError || !team) {
    return (
      <div className="flex flex-col gap-4">
        <BackLink />
        <p className="text-destructive">Team not found.</p>
      </div>
    );
  }

  const members = team.members;

  function updateSubtask(rowId: string, patch: Partial<SubtaskDraft>) {
    setSubtasks((prev) =>
      prev.map((s) => (s.id === rowId ? { ...s, ...patch } : s)),
    );
  }

  function addSubtask() {
    setSubtasks((prev) => [
      ...prev,
      { id: crypto.randomUUID(), title: "", assigneeSlug: "", notes: "" },
    ]);
  }

  function removeSubtask(rowId: string) {
    setSubtasks((prev) => prev.filter((s) => s.id !== rowId));
  }

  async function run() {
    setError(null);
    setStarted(null);
    setPlan(null);
    if (!task.trim()) {
      setError("Task description is required.");
      return;
    }
    const cleaned = subtasks
      .map((s) => ({
        title: s.title.trim(),
        assigneeSlug: s.assigneeSlug,
        notes: s.notes.trim() || undefined,
      }))
      .filter((s) => s.title && s.assigneeSlug);
    if (cleaned.length === 0) {
      setError("Add at least one subtask with a title and an assignee.");
      return;
    }
    if (!id) {
      return;
    }
    try {
      const result = await runTask.mutateAsync({
        id,
        body: { task: task.trim(), subtasks: cleaned },
      });
      setStarted(result.started);
    } catch {
      setError("Failed to dispatch the task. Is the runtime online?");
    }
  }

  async function planAndRun() {
    setError(null);
    setStarted(null);
    setPlan(null);
    if (!task.trim()) {
      setError("Task description is required.");
      return;
    }
    if (!id) {
      return;
    }
    try {
      const result = await runAuto.mutateAsync({
        id,
        body: { task: task.trim() },
      });
      setPlan(result.plan);
      setStarted(result.started);
    } catch {
      setError(
        "The lead couldn't produce a plan. Try a clearer task, or use manual mode.",
      );
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <BackLink />
      <PageHeader
        title={team.name}
        description={
          <span className="flex flex-wrap items-center gap-1">
            {members.map((m) => (
              <Badge key={m.botId} variant="secondary">
                {m.name ?? m.expertSlug}
              </Badge>
            ))}
          </span>
        }
      />

      <Card>
        <CardHeader>
          <CardTitle>Run a task</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <div className="flex gap-2">
            <Button
              variant={mode === "auto" ? "default" : "outline"}
              size="sm"
              onClick={() => setMode("auto")}
            >
              <Sparkles className="mr-1 h-4 w-4" />
              Let the lead plan
            </Button>
            <Button
              variant={mode === "manual" ? "default" : "outline"}
              size="sm"
              onClick={() => setMode("manual")}
            >
              Manual subtasks
            </Button>
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="team-task">Task</Label>
            <Textarea
              id="team-task"
              value={task}
              placeholder="What should the team accomplish?"
              onChange={(e) => setTask(e.target.value)}
            />
          </div>

          {mode === "manual" ? (
            <div className="flex flex-col gap-2">
              <Label>Subtasks</Label>
              {subtasks.map((subtask) => (
                <div
                  key={subtask.id}
                  className="flex flex-col gap-2 rounded-md border p-3"
                >
                  <div className="flex gap-2">
                    <Input
                      value={subtask.title}
                      placeholder="Subtask title"
                      onChange={(e) =>
                        updateSubtask(subtask.id, { title: e.target.value })
                      }
                    />
                    <Select
                      value={subtask.assigneeSlug}
                      onValueChange={(value) =>
                        updateSubtask(subtask.id, { assigneeSlug: value })
                      }
                    >
                      <SelectTrigger className="w-48 shrink-0">
                        <SelectValue placeholder="Assign to…" />
                      </SelectTrigger>
                      <SelectContent>
                        {members.map((m) => (
                          <SelectItem key={m.expertSlug} value={m.expertSlug}>
                            {m.name ?? m.expertSlug}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="shrink-0"
                      onClick={() => removeSubtask(subtask.id)}
                      disabled={subtasks.length === 1}
                      aria-label="Remove subtask"
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                  <Textarea
                    value={subtask.notes}
                    placeholder="Optional detail for this subtask"
                    onChange={(e) =>
                      updateSubtask(subtask.id, { notes: e.target.value })
                    }
                  />
                </div>
              ))}
              <Button
                variant="outline"
                onClick={addSubtask}
                className="self-start"
              >
                <Plus className="mr-1 h-4 w-4" />
                Add subtask
              </Button>
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">
              The lead agent will break the task into subtasks and assign each
              to the best-suited member, then dispatch them.
            </p>
          )}

          {error ? <p className="text-sm text-destructive">{error}</p> : null}

          {mode === "auto" ? (
            <Button
              onClick={planAndRun}
              disabled={runAuto.isPending}
              className="self-start"
            >
              {runAuto.isPending ? (
                <Loader2 className="mr-1 h-4 w-4 animate-spin" />
              ) : (
                <Sparkles className="mr-1 h-4 w-4" />
              )}
              Let the lead plan &amp; dispatch
            </Button>
          ) : (
            <Button
              onClick={run}
              disabled={runTask.isPending}
              className="self-start"
            >
              {runTask.isPending ? (
                <Loader2 className="mr-1 h-4 w-4 animate-spin" />
              ) : null}
              Dispatch task
            </Button>
          )}
        </CardContent>
      </Card>

      {plan ? (
        <Card>
          <CardHeader>
            <CardTitle>Lead's plan ({plan.length})</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-2">
            {plan.map((item) => (
              <div
                key={`${item.assigneeSlug}::${item.title}`}
                className="rounded-md border px-3 py-2 text-sm"
              >
                <div className="font-medium">{item.title}</div>
                <div className="text-xs text-muted-foreground">
                  →{" "}
                  {members.find((m) => m.expertSlug === item.assigneeSlug)
                    ?.name ?? item.assigneeSlug}
                </div>
                {item.notes ? (
                  <div className="mt-1 text-xs text-muted-foreground">
                    {item.notes}
                  </div>
                ) : null}
              </div>
            ))}
          </CardContent>
        </Card>
      ) : null}

      {started ? (
        <Card>
          <CardHeader>
            <CardTitle>Dispatched workers ({started.length})</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-2">
            {started.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                No workers started this pass. The dispatcher starts at most one
                card per member per pass — re-dispatch to start the rest.
              </p>
            ) : (
              started.map((run) => (
                <div
                  key={run.cardId}
                  className="rounded-md border px-3 py-2 font-mono text-xs"
                >
                  {run.sessionKey}
                </div>
              ))
            )}
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}

function BackLink() {
  return (
    <Link
      to="/workspace/teams"
      className="flex w-fit items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
    >
      <ArrowLeft className="h-4 w-4" />
      Back to teams
    </Link>
  );
}
