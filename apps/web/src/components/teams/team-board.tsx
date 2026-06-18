import { Badge } from "@/components/ui/badge";
import { useTeamBoard } from "@/hooks/use-teams";
import { cn } from "@/lib/utils";
import type { TeamBoardCard } from "@nexu/shared";
import { Loader2 } from "lucide-react";

/** Workboard lifecycle statuses mapped onto the visible Kanban columns. */
const COLUMNS: Array<{ key: string; label: string; statuses: string[] }> = [
  {
    key: "todo",
    label: "To do",
    statuses: ["triage", "backlog", "scheduled", "todo"],
  },
  { key: "ready", label: "Ready", statuses: ["ready"] },
  { key: "running", label: "Running", statuses: ["running"] },
  { key: "review", label: "Review", statuses: ["review"] },
  { key: "done", label: "Done", statuses: ["done"] },
  { key: "blocked", label: "Blocked", statuses: ["blocked"] },
];

const STATUS_DOT: Record<string, string> = {
  todo: "bg-muted-foreground",
  ready: "bg-blue-500",
  running: "bg-amber-500 animate-pulse",
  review: "bg-violet-500",
  done: "bg-emerald-500",
  blocked: "bg-destructive",
};

function columnKeyFor(status: string): string {
  const match = COLUMNS.find((c) => c.statuses.includes(status));
  return match?.key ?? "todo";
}

export function TeamBoard({ teamId }: { teamId: string }) {
  const { data, isLoading, isError } = useTeamBoard(teamId);

  if (isLoading) {
    return (
      <div className="flex items-center gap-2 text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" />
        Loading board…
      </div>
    );
  }
  if (isError || !data) {
    return (
      <p className="text-sm text-destructive">Failed to load the board.</p>
    );
  }

  const cards = data.cards;
  const byColumn = new Map<string, TeamBoardCard[]>(
    COLUMNS.map((c) => [c.key, []]),
  );
  for (const card of cards) {
    byColumn.get(columnKeyFor(card.status))?.push(card);
  }

  if (cards.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        No cards yet. Run a task to populate the board.
      </p>
    );
  }

  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
      {COLUMNS.map((column) => {
        const columnCards = byColumn.get(column.key) ?? [];
        return (
          <div key={column.key} className="flex flex-col gap-2">
            <div className="flex items-center justify-between px-1 text-xs font-medium text-muted-foreground">
              <span>{column.label}</span>
              <span>{columnCards.length}</span>
            </div>
            <div className="flex min-h-12 flex-col gap-2 rounded-md bg-muted/40 p-2">
              {columnCards.map((card) => (
                <div
                  key={card.id}
                  className="rounded-md border bg-background p-2 text-xs shadow-sm"
                >
                  <div className="flex items-center gap-1.5">
                    <span
                      className={cn(
                        "h-1.5 w-1.5 shrink-0 rounded-full",
                        STATUS_DOT[column.key] ?? "bg-muted-foreground",
                      )}
                    />
                    <span className="line-clamp-2">{card.title}</span>
                  </div>
                  {card.assigneeName ? (
                    <Badge variant="secondary" className="mt-1.5">
                      {card.assigneeName}
                    </Badge>
                  ) : null}
                </div>
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}
