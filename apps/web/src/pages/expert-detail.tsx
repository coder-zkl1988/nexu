import {
  useExpertDetail,
  useExperthubCatalog,
  useInstallExpert,
  useUninstallExpert,
} from "@/hooks/use-experthub-catalog";
import { cn } from "@/lib/utils";
import {
  ArrowLeft,
  Download,
  Loader2,
  Sparkles,
  Trash2,
  User,
  Wrench,
} from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate, useParams } from "react-router-dom";
import { toast } from "sonner";

export default function ExpertDetailPage() {
  const { slug } = useParams<{ slug: string }>();
  const navigate = useNavigate();
  const { t } = useTranslation();

  const { data, isLoading, error } = useExpertDetail(slug ?? null);
  const catalogQuery = useExperthubCatalog();
  const installMutation = useInstallExpert();
  const uninstallMutation = useUninstallExpert();
  const [pendingAction, setPendingAction] = useState<
    "install" | "uninstall" | null
  >(null);

  const installedSlugs = new Set(catalogQuery.data?.installedSlugs ?? []);
  const isInstalled = slug ? installedSlugs.has(slug) : false;
  const isBusy = pendingAction !== null;

  function handleBack() {
    if (window.history.length > 1) {
      navigate(-1);
    } else {
      navigate("/workspace/experts", { replace: true });
    }
  }

  async function handleInstall() {
    if (!slug || !data) return;
    setPendingAction("install");
    try {
      await installMutation.mutateAsync(slug);
      toast.success(t("experts.install_success", { botName: data.name }));
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
    if (!slug) return;
    setPendingAction("uninstall");
    try {
      await uninstallMutation.mutateAsync(slug);
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

  if (isLoading) {
    return (
      <div className="min-h-full bg-surface-0 flex items-center justify-center">
        <Loader2 size={24} className="animate-spin text-text-muted" />
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="min-h-full bg-surface-0">
        <div className="max-w-3xl mx-auto px-6 py-8">
          <button
            type="button"
            onClick={handleBack}
            className="inline-flex items-center gap-1.5 text-[13px] text-text-muted hover:text-text-primary transition-colors mb-6"
          >
            <ArrowLeft size={14} />
            {t("experts.detail.back")}
          </button>
          <p className="text-[14px] text-text-muted">
            {t("experts.detail.not_found", {
              defaultValue: "Expert not found.",
            })}
          </p>
        </div>
      </div>
    );
  }

  const tags = data.tags ?? [];
  const requiredSkills = data.requiredSkills ?? [];

  return (
    <div className="min-h-full bg-surface-0">
      <div className="max-w-3xl mx-auto px-6 py-8">
        {/* Back link */}
        <button
          type="button"
          onClick={handleBack}
          className="inline-flex items-center gap-1.5 text-[13px] text-text-muted hover:text-text-primary transition-colors mb-6"
        >
          <ArrowLeft size={14} />
          {t("experts.detail.back")}
        </button>

        {/* Hero */}
        <div className="flex items-start justify-between gap-4 mb-6">
          <div className="flex items-start gap-4 min-w-0">
            <div className="w-16 h-16 shrink-0 rounded-2xl bg-surface-2 border border-border flex items-center justify-center text-[32px] leading-none">
              <span aria-hidden>{data.emoji}</span>
            </div>
            <div className="min-w-0">
              <h1 className="text-[20px] font-semibold text-text-primary mb-1">
                {data.name}
              </h1>
              <p className="text-[12px] text-text-muted mb-2 flex items-center gap-2 flex-wrap">
                <span className="uppercase tracking-wide">{data.category}</span>
                {data.version && (
                  <span className="text-[11px] px-1.5 py-0.5 rounded bg-surface-3">
                    v{data.version}
                  </span>
                )}
                {data.author && (
                  <span className="inline-flex items-center gap-1 text-text-muted">
                    <User size={11} />
                    {data.author}
                  </span>
                )}
              </p>
              <p className="text-[13px] text-text-secondary leading-relaxed">
                {data.description}
              </p>
            </div>
          </div>

          {/* Install/Uninstall button */}
          {isInstalled ? (
            <button
              type="button"
              disabled={isBusy}
              onClick={() => void handleUninstall()}
              className={cn(
                "shrink-0 flex items-center gap-1.5 px-4 py-2 rounded-lg text-[13px] font-medium transition-colors",
                isBusy
                  ? "bg-surface-3 text-text-muted cursor-not-allowed"
                  : "bg-red-500/10 text-red-500 hover:bg-red-500/20",
              )}
            >
              {pendingAction === "uninstall" ? (
                <Loader2 size={14} className="animate-spin" />
              ) : (
                <Trash2 size={14} />
              )}
              {pendingAction === "uninstall"
                ? t("experts.uninstalling")
                : t("experts.uninstall")}
            </button>
          ) : (
            <button
              type="button"
              disabled={isBusy}
              onClick={() => void handleInstall()}
              className={cn(
                "shrink-0 flex items-center gap-1.5 px-4 py-2 rounded-lg text-[13px] font-medium transition-colors",
                isBusy
                  ? "bg-surface-3 text-text-muted cursor-not-allowed"
                  : "bg-accent text-white hover:bg-accent/90",
              )}
            >
              {pendingAction === "install" ? (
                <Loader2 size={14} className="animate-spin" />
              ) : (
                <Download size={14} />
              )}
              {pendingAction === "install"
                ? t("experts.installing")
                : t("experts.install")}
            </button>
          )}
        </div>

        {/* Tags row */}
        {tags.length > 0 && (
          <div className="flex items-center gap-1.5 mb-6 pb-6 border-b border-border flex-wrap">
            {tags.map((tg) => (
              <span
                key={tg}
                className="text-[10px] px-1.5 py-0.5 rounded bg-surface-3 text-text-muted font-medium"
              >
                {tg}
              </span>
            ))}
          </div>
        )}

        {/* System prompt preview */}
        <div className="mb-6">
          <h3 className="text-[13px] font-semibold text-text-primary mb-2 flex items-center gap-1.5">
            <Sparkles size={14} />
            {t("experts.detail.systemPrompt")}
          </h3>
          <div className="rounded-lg bg-[#1e1e2e] border border-border overflow-x-auto">
            <pre className="px-3 py-3 text-[12px] leading-relaxed font-mono text-[#cdd6f4] whitespace-pre-wrap">
              {data.systemPrompt}
            </pre>
          </div>
        </div>

        {/* Required skills */}
        {requiredSkills.length > 0 && (
          <div className="mb-6">
            <h3 className="text-[13px] font-semibold text-text-primary mb-2 flex items-center gap-1.5">
              <Wrench size={14} />
              {t("experts.detail.requiredSkills")}
            </h3>
            <div className="rounded-lg bg-surface-1 border border-border p-3 space-y-1">
              {requiredSkills.map((skillSlug) => (
                <div
                  key={skillSlug}
                  className="flex items-center gap-2 text-[12px] text-text-muted font-mono"
                >
                  <Wrench size={12} />
                  {skillSlug}
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
