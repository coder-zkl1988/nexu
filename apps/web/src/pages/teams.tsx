import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
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
import { PageHeader } from "@/components/ui/page-header";
import { useExperthubCatalog } from "@/hooks/use-experthub-catalog";
import { useCreateTeam, useDeleteTeam, useTeams } from "@/hooks/use-teams";
import { cn } from "@/lib/utils";
import { Loader2, Plus, Trash2, Users } from "lucide-react";
import { useMemo, useState } from "react";
import { Link } from "react-router-dom";

export function TeamsPage() {
  const { data, isLoading, isError } = useTeams();
  const deleteTeam = useDeleteTeam();
  const [createOpen, setCreateOpen] = useState(false);

  const teams = data?.teams ?? [];

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Teams"
        description="Group installed experts into a team and run a task across them."
        actions={
          <Button onClick={() => setCreateOpen(true)}>
            <Plus className="mr-1 h-4 w-4" />
            Create team
          </Button>
        }
      />

      {isLoading ? (
        <div className="flex items-center gap-2 text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" />
          Loading teams…
        </div>
      ) : isError ? (
        <p className="text-destructive">Failed to load teams.</p>
      ) : teams.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center gap-3 py-12 text-center">
            <Users className="h-8 w-8 text-muted-foreground" />
            <p className="text-muted-foreground">
              No teams yet. Create one to run a task across multiple experts.
            </p>
            <Button onClick={() => setCreateOpen(true)}>
              <Plus className="mr-1 h-4 w-4" />
              Create team
            </Button>
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {teams.map((team) => (
            <Card key={team.id} className="flex flex-col">
              <CardHeader>
                <div className="flex items-start justify-between gap-2">
                  <Link to={`/workspace/teams/${team.id}`} className="min-w-0">
                    <CardTitle className="truncate hover:underline">
                      {team.name}
                    </CardTitle>
                  </Link>
                  <Button
                    variant="ghost"
                    size="icon"
                    disabled={deleteTeam.isPending}
                    onClick={() => {
                      if (confirm(`Delete team "${team.name}"?`)) {
                        deleteTeam.mutate(team.id);
                      }
                    }}
                    aria-label="Delete team"
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
                <CardDescription>
                  {team.members.length} member
                  {team.members.length === 1 ? "" : "s"}
                </CardDescription>
              </CardHeader>
              <CardContent className="mt-auto">
                <div className="flex flex-wrap gap-1">
                  {team.members.map((m) => (
                    <Badge key={m.botId} variant="secondary">
                      {m.name ?? m.expertSlug}
                    </Badge>
                  ))}
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <CreateTeamDialog open={createOpen} onOpenChange={setCreateOpen} />
    </div>
  );
}

function CreateTeamDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { data: catalog } = useExperthubCatalog();
  const createTeam = useCreateTeam();
  const [name, setName] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [error, setError] = useState<string | null>(null);

  const installed = useMemo(
    () => catalog?.installedExperts ?? [],
    [catalog?.installedExperts],
  );

  function reset() {
    setName("");
    setSelected(new Set());
    setError(null);
  }

  function toggle(slug: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(slug)) {
        next.delete(slug);
      } else {
        next.add(slug);
      }
      return next;
    });
  }

  async function submit() {
    setError(null);
    if (!name.trim()) {
      setError("Team name is required.");
      return;
    }
    if (selected.size === 0) {
      setError("Select at least one member.");
      return;
    }
    try {
      await createTeam.mutateAsync({
        name: name.trim(),
        memberSlugs: Array.from(selected),
      });
      reset();
      onOpenChange(false);
    } catch {
      setError("Failed to create team. Please try again.");
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) reset();
        onOpenChange(next);
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Create team</DialogTitle>
        </DialogHeader>
        <DialogBody className="flex flex-col gap-4">
          <div className="flex flex-col gap-2">
            <Label htmlFor="team-name">Name</Label>
            <Input
              id="team-name"
              value={name}
              placeholder="e.g. Release Squad"
              onChange={(e) => setName(e.target.value)}
            />
          </div>

          <div className="flex flex-col gap-2">
            <Label>Members (installed experts)</Label>
            {installed.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                No installed experts. Install experts first, then create a team.
              </p>
            ) : (
              <div className="flex max-h-60 flex-col gap-1 overflow-y-auto rounded-md border p-2">
                {installed.map((expert) => {
                  const isSelected = selected.has(expert.slug);
                  return (
                    <button
                      key={expert.slug}
                      type="button"
                      onClick={() => toggle(expert.slug)}
                      className={cn(
                        "flex items-center justify-between rounded px-2 py-1.5 text-left text-sm hover:bg-accent",
                        isSelected && "bg-accent",
                      )}
                    >
                      <span className="truncate">
                        {expert.name ?? expert.slug}
                      </span>
                      {isSelected ? (
                        <Badge variant="default">Selected</Badge>
                      ) : null}
                    </button>
                  );
                })}
              </div>
            )}
          </div>

          {error ? <p className="text-sm text-destructive">{error}</p> : null}
        </DialogBody>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            onClick={submit}
            disabled={createTeam.isPending || installed.length === 0}
          >
            {createTeam.isPending ? (
              <Loader2 className="mr-1 h-4 w-4 animate-spin" />
            ) : null}
            Create
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
