import { cn } from "@/lib/utils";
import { type Activity, ChevronRight, Loader2, RefreshCcw } from "lucide-react";
import { Link } from "react-router-dom";

export function StatusDot({
  active,
  warning = false,
}: { active: boolean; warning?: boolean }) {
  return (
    <span
      className={cn(
        "size-2 shrink-0 rounded-full",
        warning
          ? "bg-[var(--color-warning)]"
          : active
            ? "bg-[var(--color-success)]"
            : "bg-text-tertiary",
      )}
    />
  );
}

export function SectionTitle({
  icon: Icon,
  children,
}: { icon: typeof Activity; children: string }) {
  return (
    <div className="flex items-center gap-2 text-[11px] font-semibold text-text-secondary">
      <Icon className="size-3.5" />
      <span>{children}</span>
    </div>
  );
}

export function HealthRow({
  label,
  status,
  active,
  warning = false,
  actionLabel,
  actionBusy = false,
  onAction,
  href,
}: {
  label: string;
  status: string;
  active: boolean;
  warning?: boolean;
  actionLabel?: string;
  actionBusy?: boolean;
  onAction?: () => void;
  href?: string;
}) {
  return (
    <div className="flex items-center justify-between gap-3 text-[11px]">
      <div className="min-w-0">
        <div className="flex items-center gap-2 text-text-secondary">
          <StatusDot active={active} warning={warning} />
          <span className="truncate">{label}</span>
        </div>
        <div className="mt-0.5 truncate pl-4 text-[9px] text-text-muted">
          {status}
        </div>
      </div>
      {href ? (
        <Link
          to={href}
          className="shrink-0 rounded-md p-1.5 text-text-muted hover:bg-surface-2 hover:text-text-primary"
          aria-label={actionLabel ?? label}
          title={actionLabel ?? label}
        >
          <ChevronRight className="size-3.5" />
        </Link>
      ) : actionLabel && onAction ? (
        <button
          type="button"
          disabled={actionBusy}
          onClick={onAction}
          className="shrink-0 rounded-md border border-border px-2 py-1 text-[9px] font-medium text-text-secondary hover:bg-surface-2 disabled:opacity-50"
        >
          {actionBusy ? (
            <Loader2 className="size-3 animate-spin" />
          ) : actionLabel === "Restart" ? (
            <RefreshCcw className="size-3" />
          ) : (
            actionLabel
          )}
        </button>
      ) : null}
    </div>
  );
}
