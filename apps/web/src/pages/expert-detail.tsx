import { SkillList } from "@/components/experts/skill-selector";
import { ChatMarkdown } from "@/components/ui/chat-markdown";
import {
  createSkillReference,
  getSkillReferenceKey,
  includeRequiredSkillReferences,
  installedSkillMatchesReference,
  skillReferenceMatchesSkill,
  useExpertSkillCatalog,
} from "@/hooks/use-expert-skill-catalog";
import {
  useExpertDetail,
  useExperthubCatalog,
  useInstallExpert,
  useUninstallExpert,
  useUpdateExpertSkills,
} from "@/hooks/use-experthub-catalog";
import { getTagLabel } from "@/lib/skill-translations";
import { cn } from "@/lib/utils";
import type { SkillReference } from "@nexu/shared";
import {
  ArrowLeft,
  Bot,
  Compass,
  Download,
  Edit3,
  FileText,
  Heart,
  Loader2,
  Lock,
  Save,
  Search,
  Settings2,
  Sparkles,
  Trash2,
  User,
  Wrench,
  X,
} from "lucide-react";
import { useMemo, useState } from "react";
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

  // Skill editing state
  const [editingSkills, setEditingSkills] = useState(false);
  const [skillTab, setSkillTab] = useState<"yours" | "explore">("explore");
  const [skillSearch, setSkillSearch] = useState("");
  const [activeTag, setActiveTag] = useState<string | null>(null);
  const {
    allSkills,
    displaySkills,
    installedSkills,
    topTags,
    isLoading: isSkillCatalogLoading,
    hasNextPage: hasNextSkillPage,
    isFetchingNextPage: isFetchingNextSkillPage,
    fetchNextPage: fetchNextSkillPage,
  } = useExpertSkillCatalog({
    tab: skillTab,
    search: skillSearch,
    category: activeTag,
  });
  const updateSkillsMutation = useUpdateExpertSkills();

  // Current configured skills from ledger
  const ledgerEntry = slug
    ? catalogQuery.data?.installedExperts?.find((e) => e.slug === slug)
    : null;
  const currentConfiguredSkills: string[] = ledgerEntry?.configuredSkills ?? [];
  const currentConfiguredSkillRefs: SkillReference[] =
    ledgerEntry?.configuredSkillRefs ??
    currentConfiguredSkills.map((skillSlug) => ({ slug: skillSlug }));
  const requiredSkills: string[] = data?.requiredSkills ?? [];
  const requiredSkillsSet = useMemo(
    () => new Set(requiredSkills),
    [requiredSkills],
  );
  const effectiveConfiguredSkillRefs = includeRequiredSkillReferences(
    requiredSkills,
    currentConfiguredSkillRefs,
  );

  // When entering edit mode, initialize from current configured skills (if any)
  // or fall back to required skills
  const [editedSkillRefs, setEditedSkillRefs] = useState<SkillReference[]>([]);

  function enterEditMode() {
    setEditedSkillRefs([...effectiveConfiguredSkillRefs]);
    setEditingSkills(true);
  }

  function cancelEdit() {
    setEditingSkills(false);
    setEditedSkillRefs([]);
    setSkillSearch("");
    setActiveTag(null);
  }

  async function saveSkills() {
    if (!slug) return;
    try {
      await updateSkillsMutation.mutateAsync({
        slug,
        skills: editedSkillRefs.map((reference) => reference.slug),
        skillRefs: editedSkillRefs,
      });
      setEditingSkills(false);
      toast.success(
        t("experts.detail.skills_saved", { defaultValue: "Skills updated" }),
      );
    } catch (err) {
      toast.error(
        err instanceof Error
          ? err.message
          : t("experts.detail.skills_save_error", {
              defaultValue: "Failed to update skills",
            }),
      );
    }
  }

  function toggleSkill(skill: (typeof displaySkills)[number]) {
    if (requiredSkillsSet.has(skill.slug)) return;
    setEditedSkillRefs((previous) =>
      previous.some((reference) => skillReferenceMatchesSkill(reference, skill))
        ? previous.filter((reference) => reference.slug !== skill.slug)
        : [...previous, createSkillReference(skill)],
    );
  }

  const skillNameMap = useMemo(() => {
    const map = new Map<string, string>();
    for (const s of allSkills) {
      if (s.name && s.name !== s.slug) {
        map.set(getSkillReferenceKey(createSkillReference(s)), s.name);
        if (!map.has(s.slug)) map.set(s.slug, s.name);
      }
    }
    return map;
  }, [allSkills]);

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

              {/* Skills */}
              {(requiredSkills.length > 0 || isInstalled) && (
                <div>
                  <div className="flex items-center justify-between mb-2">
                    <h3 className="text-[13px] font-semibold text-text-primary flex items-center gap-1.5">
                      <Wrench size={14} />
                      {t("experts.detail.requiredSkills")}
                    </h3>
                    {!editingSkills ? (
                      <button
                        type="button"
                        onClick={enterEditMode}
                        className="flex items-center gap-1 px-2.5 py-1 rounded-md text-[11px] font-medium text-text-secondary hover:text-text-primary hover:bg-surface-2 transition-colors"
                      >
                        <Edit3 size={12} />
                        {t("experts.custom.edit")}
                      </button>
                    ) : (
                      <div className="flex items-center gap-1">
                        <button
                          type="button"
                          onClick={cancelEdit}
                          disabled={updateSkillsMutation.isPending}
                          className="flex items-center gap-1 px-2.5 py-1 rounded-md text-[11px] font-medium text-text-secondary hover:text-text-primary hover:bg-surface-2 transition-colors"
                        >
                          <X size={12} />
                          {t("experts.custom.cancel", { defaultValue: "取消" })}
                        </button>
                        <button
                          type="button"
                          onClick={() => void saveSkills()}
                          disabled={updateSkillsMutation.isPending}
                          className="flex items-center gap-1 px-2.5 py-1 rounded-md text-[11px] font-medium bg-[#FF5A3C] text-white hover:opacity-90 transition-opacity disabled:opacity-50"
                        >
                          {updateSkillsMutation.isPending ? (
                            <Loader2 size={12} className="animate-spin" />
                          ) : (
                            <Save size={12} />
                          )}
                          {t("experts.custom.save", { defaultValue: "保存" })}
                        </button>
                      </div>
                    )}
                  </div>

                  {editingSkills ? (
                    <div className="flex flex-col gap-2">
                      <div className="flex items-center gap-2">
                        <div className="inline-flex items-center gap-1 p-1 rounded-full bg-surface-2">
                          {(
                            [
                              {
                                id: "yours" as const,
                                label: t("skills.yours"),
                                icon: Settings2,
                              },
                              {
                                id: "explore" as const,
                                label: t("skills.explore"),
                                icon: Compass,
                              },
                            ] as const
                          ).map((tab) => {
                            const active = skillTab === tab.id;
                            const TabIcon = tab.icon;
                            return (
                              <button
                                key={tab.id}
                                type="button"
                                onClick={() => setSkillTab(tab.id)}
                                className={cn(
                                  "flex items-center gap-1.5 px-3 py-1 rounded-full text-[12px] font-medium transition-all",
                                  active
                                    ? "bg-white text-text-primary shadow-[var(--shadow-rest)]"
                                    : "text-text-secondary hover:text-text-primary",
                                )}
                              >
                                <TabIcon size={12} />
                                {tab.label}
                              </button>
                            );
                          })}
                        </div>
                        <div className="relative flex-1 max-w-[200px]">
                          <Search
                            size={12}
                            className="absolute left-2.5 top-1/2 -translate-y-1/2 text-text-muted"
                          />
                          <input
                            type="text"
                            value={skillSearch}
                            onChange={(e) => setSkillSearch(e.target.value)}
                            placeholder={t("skills.searchPlaceholder")}
                            className="w-full pl-8 pr-3 py-1 rounded-lg border border-border bg-surface-0 text-[12px] text-text-primary placeholder:text-text-muted focus:outline-none focus:border-[var(--color-brand-primary)]/30 transition-colors"
                          />
                        </div>
                      </div>
                      {skillTab === "explore" && (
                        <div className="flex items-center gap-1.5 overflow-x-auto no-scrollbar">
                          <button
                            type="button"
                            onClick={() => setActiveTag(null)}
                            className={cn(
                              "shrink-0 inline-flex items-center justify-center rounded-full h-6 px-2.5 text-[10px] leading-none font-medium transition-all",
                              activeTag === null
                                ? "bg-[var(--color-accent)] text-white"
                                : "border border-border bg-surface-1 text-text-secondary hover:text-text-primary hover:border-border-hover",
                            )}
                          >
                            {t("skills.all")}
                          </button>
                          {topTags.map(({ tag, count }) => (
                            <button
                              key={tag}
                              type="button"
                              onClick={() =>
                                setActiveTag(activeTag === tag ? null : tag)
                              }
                              className={cn(
                                "shrink-0 inline-flex items-center justify-center rounded-full h-6 px-2.5 text-[10px] leading-none font-medium transition-all",
                                activeTag === tag
                                  ? "bg-[var(--color-accent)] text-white"
                                  : "border border-border bg-surface-1 text-text-secondary hover:text-text-primary hover:border-border-hover",
                              )}
                            >
                              {getTagLabel(tag, "zh-CN")}
                              <span className="ml-1 tabular-nums opacity-50">
                                {count}
                              </span>
                            </button>
                          ))}
                        </div>
                      )}
                      <div className="max-h-[300px] flex flex-col">
                        <SkillList
                          displaySkills={displaySkills}
                          selectedSkillRefs={editedSkillRefs}
                          installedSkills={installedSkills}
                          lockedSkills={requiredSkillsSet}
                          onToggleSkill={toggleSkill}
                          isLoading={isSkillCatalogLoading}
                          hasNextPage={hasNextSkillPage}
                          isFetchingNextPage={isFetchingNextSkillPage}
                          onLoadMore={() => {
                            void fetchNextSkillPage();
                          }}
                          emptyLabel={t("skills.loadingCatalog")}
                          noResultsLabel={t("skills.noMatchingSkills")}
                        />
                      </div>
                      <div className="flex items-center gap-2 text-[11px] text-text-muted">
                        <Lock size={10} />
                        {t("experts.detail.skills_required_hint", {
                          defaultValue: "Required skills cannot be removed",
                        })}
                      </div>
                    </div>
                  ) : (
                    <div className="rounded-lg bg-surface-1 border border-border p-3 space-y-1">
                      {effectiveConfiguredSkillRefs.map((skillReference) => {
                        const skillKey = getSkillReferenceKey(skillReference);
                        const isRequired = requiredSkillsSet.has(
                          skillReference.slug,
                        );
                        const isSkillInstalled = installedSkills.some(
                          (installedSkill) =>
                            installedSkillMatchesReference(
                              installedSkill,
                              skillReference,
                            ),
                        );
                        return (
                          <div
                            key={skillKey}
                            className="flex items-center gap-2 text-[12px] text-text-muted font-mono"
                          >
                            {isRequired ? (
                              <Lock size={12} />
                            ) : (
                              <Wrench size={12} />
                            )}
                            <span
                              className={
                                isSkillInstalled ? "text-text-primary" : ""
                              }
                            >
                              {skillNameMap.get(skillKey) ||
                                skillReference.slug}
                            </span>
                            {isSkillInstalled && (
                              <span className="text-[10px] text-green-500 font-medium shrink-0">
                                {t("experts.detail.skill_installed", {
                                  defaultValue: "已安装",
                                })}
                              </span>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              )}

              {hasAnyFile && (
                <p className="text-[12px] text-text-muted">
                  {t("experts.detail.switch_tab_hint", {
                    defaultValue:
                      "切换上方标签页查看专家的 AGENTS、IDENTITY 和 SOUL 配置",
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
