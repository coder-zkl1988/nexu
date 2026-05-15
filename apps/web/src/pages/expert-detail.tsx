import { ChatMarkdown } from "@/components/ui/chat-markdown";
import {
  useExpertDetail,
  useExperthubCatalog,
  useInstallExpert,
  useUninstallExpert,
} from "@/hooks/use-experthub-catalog";
import { cn } from "@/lib/utils";
import {
  ArrowLeft,
  Bot,
  Download,
  FileText,
  Heart,
  Loader2,
  Sparkles,
  Trash2,
  User,
  Wrench,
} from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";
import { toast } from "sonner";

type TabId = "basic" | "agents" | "identity" | "soul";

const TABS: Array<{ id: TabId; icon: typeof Bot }> = [
  { id: "basic", icon: Bot },
  { id: "agents", icon: FileText },
  { id: "identity", icon: User },
  { id: "soul", icon: Heart },
];

export default function ExpertDetailPage() {
  const { slug } = useParams<{ slug: string }>();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { t } = useTranslation();

  const { data, isLoading, error } = useExpertDetail(slug ?? null);
  const catalogQuery = useExperthubCatalog();
  const installMutation = useInstallExpert();
  const uninstallMutation = useUninstallExpert();
  const [pendingAction, setPendingAction] = useState<
    "install" | "uninstall" | null
  >(null);
  const [activeTab, setActiveTab] = useState<TabId>("basic");

  const installedSlugs = new Set(catalogQuery.data?.installedSlugs ?? []);
  const isInstalled = slug ? installedSlugs.has(slug) : false;
  const isBusy = pendingAction !== null;

  function handleBack() {
    // Preserve the view state (tab/tag/q) from the URL when navigating back
    const tab = searchParams.get("tab") || "explore";
    const tag = searchParams.get("tag") || "";
    const q = searchParams.get("q") || "";
    const params = new URLSearchParams();
    if (tab) params.set("tab", tab);
    if (tag) params.set("tag", tag);
    if (q) params.set("q", q);
    const qs = params.toString();
    navigate(`/workspace/experts${qs ? `?${qs}` : ""}`, { replace: true });
  }

  async function handleInstall() {
    if (!slug || !data) return;
    setPendingAction("install");
    try {
      const result = await installMutation.mutateAsync(slug);
      toast.success(t("experts.install_success", { botName: data.name }));
      navigate(`/workspace/chat?botId=${encodeURIComponent(result.botId)}`);
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
  const workspaceFiles = data.workspaceFiles ?? {};
  const hasAnyFile =
    workspaceFiles["AGENTS.md"] ||
    workspaceFiles["IDENTITY.md"] ||
    workspaceFiles["SOUL.md"];

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
              {data.avatarDataUrl ? (
                <img
                  src={data.avatarDataUrl}
                  alt=""
                  className="w-full h-full object-cover rounded-2xl"
                />
              ) : (
                <span aria-hidden>{data.emoji}</span>
              )}
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

        {/* Tab bar */}
        <div className="inline-flex items-center gap-1 p-1 rounded-full bg-surface-2 mb-6">
          {TABS.map((tab) => {
            const active = activeTab === tab.id;
            const Icon = tab.icon;
            const disabled =
              tab.id !== "basic" &&
              !workspaceFiles[
                tab.id === "agents"
                  ? "AGENTS.md"
                  : tab.id === "identity"
                    ? "IDENTITY.md"
                    : "SOUL.md"
              ];
            return (
              <button
                key={tab.id}
                type="button"
                disabled={disabled}
                onClick={() => setActiveTab(tab.id)}
                className={cn(
                  "flex items-center gap-1.5 px-4 py-1.5 rounded-full text-[13px] font-medium transition-all",
                  active
                    ? "bg-white text-text-primary shadow-[var(--shadow-rest)]"
                    : disabled
                      ? "text-text-tertiary cursor-default"
                      : "text-text-secondary hover:text-text-primary",
                )}
              >
                <Icon size={14} />
                {t(`experts.custom.tab.${tab.id}`)}
              </button>
            );
          })}
        </div>

        {/* Tab content */}
        <div className="min-h-0">
          {activeTab === "basic" && (
            <div className="space-y-6">
              {/* System prompt preview — fallback when no workspace files */}
              {!hasAnyFile && data.systemPrompt && (
                <div>
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
              )}

              {/* Required skills */}
              {requiredSkills.length > 0 && (
                <div>
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

              {hasAnyFile && (
                <p className="text-[12px] text-text-muted">
                  {t("experts.detail.switch_tab_hint", {
                    defaultValue:
                      "切换上方标签页查看伙伴的 AGENTS、IDENTITY 和 SOUL 配置",
                  })}
                </p>
              )}
            </div>
          )}

          {activeTab === "agents" && workspaceFiles["AGENTS.md"] && (
            <div className="rounded-lg border border-border bg-surface-0 p-4">
              <ChatMarkdown content={workspaceFiles["AGENTS.md"]} />
            </div>
          )}

          {activeTab === "identity" && workspaceFiles["IDENTITY.md"] && (
            <div className="rounded-lg border border-border bg-surface-0 p-4">
              <ChatMarkdown content={workspaceFiles["IDENTITY.md"]} />
            </div>
          )}

          {activeTab === "soul" && workspaceFiles["SOUL.md"] && (
            <div className="rounded-lg border border-border bg-surface-0 p-4">
              <ChatMarkdown content={workspaceFiles["SOUL.md"]} />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
