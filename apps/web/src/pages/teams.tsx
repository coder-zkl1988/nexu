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
import { useExperthubCatalog } from "@/hooks/use-experthub-catalog";
import {
  useCreateTeam,
  useDeleteTeam,
  useTeams,
  useUpdateTeam,
} from "@/hooks/use-teams";
import { cn } from "@/lib/utils";
import type { TeamResponse } from "@nexu/shared";
import { Loader2, Pencil, Plus, Trash2, Users } from "lucide-react";
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";

export function TeamsPage() {
  const { t } = useTranslation();
  const { data, isLoading, isError } = useTeams();
  const deleteTeam = useDeleteTeam();
  const [createOpen, setCreateOpen] = useState(false);
  const [editTeam, setEditTeam] = useState<TeamResponse | null>(null);

  const teams = data?.teams ?? [];

  return (
    <div className="flex h-full flex-col">
      <div className="shrink-0 px-6 pt-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-lg font-semibold text-[var(--color-tabby-foreground)]">
              {t("teams.title")}
            </h1>
            <p className="mt-0.5 text-xs text-[var(--color-tabby-muted)]">
              {t("teams.description")}
            </p>
          </div>
          <Button onClick={() => setCreateOpen(true)}>
            <Plus className="mr-1 h-4 w-4" />
            {t("teams.create")}
          </Button>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto px-6 pb-6 pt-6">
        {isLoading ? (
          <div className="flex items-center gap-2 text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            {t("teams.loading")}
          </div>
        ) : isError ? (
          <p className="text-destructive">{t("teams.loadError")}</p>
        ) : teams.length === 0 ? (
          <Card>
            <CardContent className="flex flex-col items-center gap-3 py-12 text-center">
              <Users className="h-8 w-8 text-muted-foreground" />
              <p className="text-muted-foreground">{t("teams.empty")}</p>
              <Button onClick={() => setCreateOpen(true)}>
                <Plus className="mr-1 h-4 w-4" />
                {t("teams.create")}
              </Button>
            </CardContent>
          </Card>
        ) : (
          <div className="grid gap-4 [grid-template-columns:repeat(auto-fill,minmax(260px,1fr))]">
            {teams.map((team) => (
              <Card key={team.id} className="flex flex-col">
                <CardHeader>
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <CardTitle className="truncate">{team.name}</CardTitle>
                    </div>
                    <div className="flex shrink-0 items-center">
                      {/* The default team's membership is dynamic (all
                          installed experts) — manual member edits would be
                          overwritten, so hide the edit affordance. */}
                      {!team.isDefault && (
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => setEditTeam(team)}
                          aria-label={t("teams.editAria")}
                        >
                          <Pencil className="h-4 w-4" />
                        </Button>
                      )}
                      {!team.isDefault && (
                        <Button
                          variant="ghost"
                          size="icon"
                          disabled={deleteTeam.isPending}
                          onClick={() => {
                            if (
                              confirm(
                                t("teams.deleteConfirm", { name: team.name }),
                              )
                            ) {
                              deleteTeam.mutate(team.id);
                            }
                          }}
                          aria-label={t("teams.deleteAria")}
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      )}
                    </div>
                  </div>
                  <CardDescription>
                    {t("teams.memberCount", { count: team.members.length })}
                    {team.isDefault && (
                      <span className="ml-1.5 text-text-muted">
                        · {t("teams.defaultTeamAutoMembers")}
                      </span>
                    )}
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
      </div>

      <TeamFormDialog open={createOpen} onOpenChange={setCreateOpen} />
      {editTeam ? (
        <TeamFormDialog
          key={editTeam.id}
          open
          onOpenChange={(next) => {
            if (!next) setEditTeam(null);
          }}
          team={editTeam}
        />
      ) : null}
    </div>
  );
}

/**
 * Member picker shared by create + edit. Lists ALL catalog experts (installed
 * first, with the manifest's localized name), marking uninstalled ones — they
 * are auto-installed on submit. Searchable since the catalog is large.
 */
function ExpertMemberPicker({
  selected,
  onToggle,
}: {
  selected: Set<string>;
  onToggle: (slug: string) => void;
}) {
  const { t } = useTranslation();
  const { data: catalog } = useExperthubCatalog();
  const [query, setQuery] = useState("");

  const experts = useMemo(() => catalog?.experts ?? [], [catalog?.experts]);
  const installedSlugs = useMemo(
    () => new Set(catalog?.installedSlugs ?? []),
    [catalog?.installedSlugs],
  );

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    const matched = q
      ? experts.filter(
          (e) =>
            e.name.toLowerCase().includes(q) ||
            e.slug.toLowerCase().includes(q),
        )
      : experts;
    return [...matched].sort((a, b) => {
      const ai = installedSlugs.has(a.slug) ? 0 : 1;
      const bi = installedSlugs.has(b.slug) ? 0 : 1;
      return ai - bi || a.name.localeCompare(b.name);
    });
  }, [experts, query, installedSlugs]);

  if (experts.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">{t("teams.noExperts")}</p>
    );
  }

  return (
    <div className="flex flex-col gap-2">
      <Input
        value={query}
        placeholder={t("teams.searchExperts")}
        onChange={(e) => setQuery(e.target.value)}
      />
      <div className="flex max-h-60 flex-col gap-1 overflow-y-auto rounded-md border p-2">
        {filtered.map((expert) => {
          const isSelected = selected.has(expert.slug);
          const isInstalled = installedSlugs.has(expert.slug);
          return (
            <button
              key={expert.slug}
              type="button"
              onClick={() => onToggle(expert.slug)}
              className={cn(
                "flex items-center justify-between gap-2 rounded px-2 py-1.5 text-left text-sm",
                isSelected
                  ? "bg-accent text-accent-fg"
                  : "hover:bg-accent-subtle",
              )}
            >
              <span className="truncate">{expert.name}</span>
              <span className="flex shrink-0 items-center gap-1">
                {!isInstalled ? (
                  <Badge variant="outline">{t("teams.notInstalled")}</Badge>
                ) : null}
                {isSelected ? (
                  <Badge variant="default">{t("teams.selected")}</Badge>
                ) : null}
              </span>
            </button>
          );
        })}
        {filtered.length === 0 ? (
          <p className="px-2 py-1 text-sm text-muted-foreground">
            {t("teams.noSearchMatch")}
          </p>
        ) : null}
      </div>
    </div>
  );
}

/** Create a new team or edit an existing one (when `team` is provided). */
function TeamFormDialog({
  open,
  onOpenChange,
  team,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  team?: TeamResponse;
}) {
  const { t } = useTranslation();
  const editing = team != null;
  const createTeam = useCreateTeam();
  const updateTeam = useUpdateTeam();
  const [name, setName] = useState(team?.name ?? "");
  const [selected, setSelected] = useState<Set<string>>(
    () => new Set(team?.members.map((m) => m.expertSlug)),
  );
  const [error, setError] = useState<string | null>(null);
  const pending = createTeam.isPending || updateTeam.isPending;
  const nameId = editing ? "edit-team-name" : "create-team-name";

  function reset() {
    setName(team?.name ?? "");
    setSelected(new Set(team?.members.map((m) => m.expertSlug)));
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
      setError(t("teams.errNameRequired"));
      return;
    }
    if (selected.size === 0) {
      setError(t("teams.errSelectMember"));
      return;
    }
    const body = { name: name.trim(), memberSlugs: Array.from(selected) };
    try {
      if (editing) {
        await updateTeam.mutateAsync({ id: team.id, body });
      } else {
        await createTeam.mutateAsync(body);
      }
      onOpenChange(false);
    } catch {
      setError(
        editing ? t("teams.errUpdateFailed") : t("teams.errCreateFailed"),
      );
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
          <DialogTitle>
            {editing ? t("teams.editTitle") : t("teams.create")}
          </DialogTitle>
        </DialogHeader>
        <DialogBody className="flex flex-col gap-4">
          <div className="flex flex-col gap-2">
            <Label htmlFor={nameId}>{t("teams.nameLabel")}</Label>
            <Input
              id={nameId}
              value={name}
              placeholder={t("teams.namePlaceholder")}
              onChange={(e) => setName(e.target.value)}
            />
          </div>

          <div className="flex flex-col gap-2">
            <Label>{t("teams.membersLabel")}</Label>
            <ExpertMemberPicker selected={selected} onToggle={toggle} />
          </div>

          {error ? <p className="text-sm text-destructive">{error}</p> : null}
        </DialogBody>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            {t("teams.cancel")}
          </Button>
          <Button onClick={submit} disabled={pending}>
            {pending ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : null}
            {editing ? t("teams.save") : t("teams.createSubmit")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
