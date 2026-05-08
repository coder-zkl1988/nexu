import {
  useInstallExpert,
  useUninstallExpert,
} from "@/hooks/use-experthub-catalog";
import { cn } from "@/lib/utils";
import type { MinimalExpert } from "@nexu/shared";
import { Loader2 } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";
import { toast } from "sonner";

export function ExpertCard({
  expert,
  installed,
  detailTo,
  isCustom,
  customEditTo,
  customAvatarUrl,
}: {
  expert: MinimalExpert;
  installed: boolean;
  detailTo: string;
  isCustom?: boolean;
  customEditTo?: string;
  customAvatarUrl?: string;
}) {
  const { t } = useTranslation();
  const installMutation = useInstallExpert();
  const uninstallMutation = useUninstallExpert();
  const [pendingAction, setPendingAction] = useState<
    "install" | "uninstall" | null
  >(null);

  const isMutating = pendingAction !== null;

  async function handleInstall() {
    setPendingAction("install");
    try {
      await installMutation.mutateAsync(expert.slug);
      toast.success(t("experts.install_success", { botName: expert.name }));
    } catch (err) {
      toast.error(
        err instanceof Error
          ? err.message
          : t("experts.install_error", { defaultValue: "Install failed" }),
      );
    } finally {
      setPendingAction(null);
    }
  }

  async function handleUninstall() {
    setPendingAction("uninstall");
    try {
      await uninstallMutation.mutateAsync(expert.slug);
    } catch (err) {
      toast.error(
        err instanceof Error
          ? err.message
          : t("experts.uninstall_error", { defaultValue: "Uninstall failed" }),
      );
    } finally {
      setPendingAction(null);
    }
  }

  return (
    <Link
      to={detailTo}
      draggable={false}
      className={cn("card flex flex-col p-4")}
    >
      {/* Header: Emoji + Name + Category */}
      <div className="flex items-center gap-3 mb-2">
        <div className="w-10 h-10 rounded-[10px] bg-surface-2 border border-border flex items-center justify-center shrink-0 overflow-hidden">
          {customAvatarUrl ? (
            <img
              src={customAvatarUrl}
              alt=""
              className="w-full h-full object-cover"
            />
          ) : (
            <span aria-hidden className="text-[22px] leading-none">
              {expert.emoji}
            </span>
          )}
        </div>
        <div className="flex-1 min-w-0">
          <div className="text-[13px] font-semibold text-text-heading truncate">
            {expert.name}
          </div>
          {expert.category && (
            <span className="text-[11px] text-text-muted">
              {expert.category}
            </span>
          )}
        </div>
      </div>

      {/* Description */}
      <p className="text-[12px] text-text-tertiary leading-[1.5] line-clamp-2 mb-3">
        {expert.description}
      </p>

      {/* Footer */}
      <div
        className="mt-auto flex items-center justify-between"
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            e.stopPropagation();
          }
        }}
      >
        <span />
        {isCustom ? (
          <div className="flex items-center gap-2">
            {customEditTo && (
              <Link
                to={customEditTo}
                onClick={(e) => e.stopPropagation()}
                className="rounded-[8px] px-[14px] py-[5px] text-[12px] font-medium border border-border text-text-primary hover:bg-surface-2 hover:border-border-hover transition-colors"
              >
                {t("experts.edit")}
              </Link>
            )}
            <button
              type="button"
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                void handleUninstall();
              }}
              disabled={isMutating}
              className="rounded-[8px] px-[14px] py-[5px] text-[12px] font-medium border border-border text-[var(--color-danger)] hover:bg-[var(--color-danger)]/5 hover:border-[var(--color-danger)]/30 transition-colors"
            >
              {pendingAction === "uninstall"
                ? t("experts.removing")
                : t("experts.remove")}
            </button>
          </div>
        ) : isMutating && pendingAction === "install" ? (
          <span className="inline-flex items-center gap-1.5 rounded-[8px] px-[14px] py-[5px] text-[12px] font-medium border border-border text-text-muted cursor-default">
            <Loader2 size={12} className="animate-spin" />
            {t("experts.installing")}
          </span>
        ) : installed ? (
          <button
            type="button"
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              void handleUninstall();
            }}
            disabled={isMutating}
            className="rounded-[8px] px-[14px] py-[5px] text-[12px] font-medium border border-border text-[var(--color-danger)] hover:bg-[var(--color-danger)]/5 hover:border-[var(--color-danger)]/30 transition-colors"
          >
            {pendingAction === "uninstall"
              ? t("experts.removing")
              : t("experts.remove")}
          </button>
        ) : (
          <button
            type="button"
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              void handleInstall();
            }}
            disabled={isMutating}
            className="rounded-[8px] px-[14px] py-[5px] text-[12px] font-medium border border-border text-text-primary hover:bg-surface-2 hover:border-border-hover transition-colors"
          >
            {t("experts.install")}
          </button>
        )}
      </div>
    </Link>
  );
}
