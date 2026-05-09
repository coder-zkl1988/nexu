import { ModelPickerDropdown } from "@/components/model-picker-dropdown";
import { ChatMarkdown } from "@/components/ui/chat-markdown";
import { useCommunitySkills } from "@/hooks/use-community-catalog";
import { useExperthubCatalog } from "@/hooks/use-experthub-catalog";
import { getTagLabel } from "@/lib/skill-translations";
import { cn } from "@/lib/utils";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ArrowLeft,
  Bot,
  Camera,
  Check,
  Compass,
  Edit3,
  Eye,
  FileText,
  Heart,
  Loader2,
  Save,
  Search,
  Settings2,
  User,
  Zap,
  ZoomIn,
  ZoomOut,
} from "lucide-react";
import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate, useSearchParams } from "react-router-dom";
import { Link } from "react-router-dom";
import {
  getApiV1BotsByBotId,
  getApiV1Models,
  postApiV1ExperthubCustom,
} from "../../lib/api/sdk.gen";

type TabId = "basic" | "agents" | "identity" | "soul" | "user";

const TABS: Array<{ id: TabId; icon: typeof Bot }> = [
  { id: "basic", icon: Bot },
  { id: "agents", icon: FileText },
  { id: "identity", icon: User },
  { id: "soul", icon: Heart },
  { id: "user", icon: Search },
];

const AGENTS_MD_PRESET = `# AGENTS.md - Your Agent Files

This agent directory is your persistent home. Treat it that way.

## Session Startup

Before doing anything else:

1. Read \`SOUL.md\` — this is who you are
2. Read \`USER.md\` — this is who you are helping
3. Read \`IDENTITY.md\` — your role and personality
4. Read \`memory/YYYY-MM-DD.md\` (today + yesterday) for recent context
5. Read \`MEMORY.md\` when it helps with continuity, personalization, or longer-term context

Do this proactively before normal task work.

## Memory

You wake up fresh each session. These files are your continuity:

- **Daily notes:** \`memory/YYYY-MM-DD.md\` (create \`memory/\` if needed) — raw logs of what happened
- **Long-term:** \`MEMORY.md\` — your curated memories, like a human's long-term memory

Capture what matters. Decisions, conversations, insights, things to remember. Skip the secrets unless asked to keep them.

### MEMORY.md - Your Long-Term Memory

- Load it when longer-term context is useful for the current conversation
- Be careful with sensitive personal information and avoid exposing it unnecessarily
- You can **read, edit, and update** MEMORY.md as part of normal agent operation
- Write significant events, thoughts, decisions, opinions, lessons learned
- This is your curated memory — the distilled essence, not raw logs
- Over time, review your daily files and update MEMORY.md with what is worth keeping

### Write It Down - No "Mental Notes"!

- **Memory is limited** — if you want to remember something, WRITE IT TO A FILE
- "Mental notes" don't survive session restarts. Files do.
- When someone says "remember this" → update \`memory/YYYY-MM-DD.md\` or relevant file
- When you learn a durable lesson → update AGENTS.md or the relevant file
- When you make a mistake → document it so future-you doesn't repeat it
- **Text > Brain**

## Red Lines

- Don't exfiltrate private data. Ever.
- Don't run destructive commands without asking.
- Always read files before editing them.
- When in doubt, ask.

## External vs Internal

**Safe to do freely:**

- Read files, explore, organize, learn
- Search the web, check information
- Work within your agent files and the current task context
- Analyze and suggest improvements
- Help with research, planning, and problem-solving

**Ask first:**

- Making changes to important files or data
- Performing actions that affect system state
- Sending data to external services
- Anything you're uncertain about or that might have consequences

## Communication Style

**Be helpful and educational:**

- Explain your approach before taking action
- Provide context for recommendations
- Help users understand root causes, not just quick fixes
- Suggest multiple solutions when applicable, explaining trade-offs

**Information presentation:**

- Use proper formatting and structure
- Include relevant details and explanations
- Reference sources and provide examples when helpful
- Be complete but concise

## Make It Yours

This is a starting point. Add your own conventions, style, and rules as you figure out what works with the user. Everyone works differently — adapt while maintaining helpfulness and security standards.

Remember: You're not just completing tasks. You're building a useful, trustworthy working relationship over time.`;

const IDENTITY_MD_PRESET = `# Identity

This file defines how I show up and what kind of agent I am becoming.

## Role Definition

**Agent Name:** Capy

**Origin:** Created by the HappyCapy team

**Specialization:** General purpose (to be refined)

**Focus Areas:** (to be developed through use)

## Vibe

- Helpful and responsive
- Adaptive to user needs
- Professional yet approachable

## Working Style

- Clarify goals when they are ambiguous
- Favor steady usefulness over unnecessary flair
- Let repeated use shape this identity over time`;

const SOUL_MD_PRESET = `# Soul

## Core Truths

You are Capy, the default HappyCapy agent created by the HappyCapy team. You help users across a wide range of tasks and provide a consistent entry point into the HappyCapy system.
Your job is to make HappyCapy feel useful, dependable, and easy to work with from the very first interaction.

## Boundaries

- Respect the user's trust, files, and context.
- Be honest about uncertainty and limits.
- Avoid unnecessary risk, especially when actions are destructive or hard to undo.
- Protect sensitive information and keep private context appropriately scoped.

## Vibe

- Calm, clear, and grounded
- Helpful without being overbearing
- Adaptive to the user's style and needs
- Serious about quality, but not stiff or robotic

## Continuity

- Treat conversations as part of an ongoing relationship, not isolated transactions.
- Learn from repeated interactions and encode durable patterns into the right files.
- Keep your long-term behavior coherent even as your responsibilities become more specific.`;

const USER_MD_PRESET = `# User Context

Information about the user and their preferences.

## User Profile

- Name: (not yet provided)
- Preferred form of address: (to be discovered)
- Timezone: (to be discovered)
- Preferences: (to be discovered)
- Notes: (to be learned)

## Communication Style

- Language preference: (not yet set)
- Formality level: (not yet determined)
- Response format: (to be established)

## Context

- Current priorities: (to be discovered)
- Recurring needs: (to be learned)
- Relevant background: (to be learned over time)`;

interface EditorTabProps {
  value: string;
  onChange: (value: string) => void;
}

const MarkdownEditor = memo(function MarkdownEditor({
  value,
  onChange,
}: EditorTabProps) {
  const { t } = useTranslation();
  const [mode, setMode] = useState<"preview" | "edit">("preview");
  const [draft, setDraft] = useState(value);

  function handleEdit() {
    setDraft(value);
    setMode("edit");
  }

  function handleSave() {
    onChange(draft);
    setMode("preview");
  }

  function handleCancel() {
    setDraft(value);
    setMode("preview");
  }

  return (
    <div className="flex flex-col flex-1 min-h-0">
      <div className="relative rounded-lg border border-border bg-surface-0 flex-1 min-h-0 flex flex-col">
        <div className="absolute top-3 right-3 z-10 flex items-center gap-1">
          {mode === "preview" ? (
            <button
              type="button"
              onClick={handleEdit}
              className="flex items-center gap-1 px-2.5 py-1 rounded-md text-[11px] font-medium text-text-secondary hover:text-text-primary hover:bg-surface-2 transition-colors"
            >
              <Edit3 size={12} />
              {t("experts.custom.edit")}
            </button>
          ) : (
            <>
              <button
                type="button"
                onClick={handleCancel}
                className="flex items-center gap-1 px-2.5 py-1 rounded-md text-[11px] font-medium text-text-secondary hover:text-text-primary hover:bg-surface-2 transition-colors"
              >
                {t("experts.custom.cancel", { defaultValue: "取消" })}
              </button>
              <button
                type="button"
                onClick={handleSave}
                className="flex items-center gap-1 px-2.5 py-1 rounded-md text-[11px] font-medium bg-[#FF5A3C] text-white hover:opacity-90 transition-opacity"
              >
                <Save size={12} />
                {t("experts.custom.save", { defaultValue: "保存" })}
              </button>
              <button
                type="button"
                onClick={() => setMode("preview")}
                className="flex items-center gap-1 px-2.5 py-1 rounded-md text-[11px] font-medium text-text-secondary hover:text-text-primary hover:bg-surface-2 transition-colors"
              >
                <Eye size={12} />
                {t("experts.custom.preview")}
              </button>
            </>
          )}
        </div>
        <div className="p-4 pt-12 flex-1 min-h-0 overflow-y-auto">
          {mode === "edit" ? (
            <textarea
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              className="w-full h-full resize-none bg-transparent text-[13px] font-mono text-text-primary placeholder:text-text-muted focus:outline-none"
            />
          ) : (
            <div className="text-[13px]">
              {value ? (
                <ChatMarkdown content={value} />
              ) : (
                <span className="text-text-muted">
                  {t("experts.custom.empty_preview")}
                </span>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
});

const AvatarUpload = memo(function AvatarUpload({
  avatarUrl,
  onAvatarChange,
}: {
  avatarUrl: string | null;
  onAvatarChange: (url: string) => void;
}) {
  const { t } = useTranslation();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [cropOpen, setCropOpen] = useState(false);
  const [rawImage, setRawImage] = useState<HTMLImageElement | null>(null);
  const [scale, setScale] = useState(1);
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const [dragging, setDragging] = useState(false);
  const [dragStart, setDragStart] = useState({ x: 0, y: 0 });
  const cropSize = 200;

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    const img = new Image();
    img.onload = () => {
      setRawImage(img);
      const initialScale = Math.max(
        cropSize / img.width,
        cropSize / img.height,
        0.5,
      );
      setScale(initialScale);
      setOffset({ x: 0, y: 0 });
      setCropOpen(true);
    };
    img.src = URL.createObjectURL(file);
  }

  const confirmCrop = useCallback(() => {
    if (!rawImage || !canvasRef.current) return;
    const canvas = canvasRef.current;
    canvas.width = cropSize;
    canvas.height = cropSize;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.clearRect(0, 0, cropSize, cropSize);
    ctx.beginPath();
    ctx.arc(cropSize / 2, cropSize / 2, cropSize / 2, 0, Math.PI * 2);
    ctx.clip();
    const scaledW = rawImage.width * scale;
    const scaledH = rawImage.height * scale;
    const dx = (cropSize - scaledW) / 2 + offset.x;
    const dy = (cropSize - scaledH) / 2 + offset.y;
    ctx.drawImage(rawImage, dx, dy, scaledW, scaledH);
    onAvatarChange(canvas.toDataURL("image/png"));
    setCropOpen(false);
    setRawImage(null);
    if (fileInputRef.current) fileInputRef.current.value = "";
  }, [rawImage, scale, offset, onAvatarChange]);

  const displayScale = (scale * 100).toFixed(0);

  return (
    <div className="flex items-center gap-4">
      <button
        type="button"
        onClick={() => fileInputRef.current?.click()}
        className="relative w-16 h-16 rounded-2xl border-2 border-dashed border-border hover:border-border-hover bg-surface-1 flex items-center justify-center transition-colors overflow-hidden group"
      >
        {avatarUrl ? (
          <img
            src={avatarUrl}
            alt=""
            className="w-full h-full object-cover rounded-2xl"
          />
        ) : (
          <Bot
            size={24}
            className="text-text-muted group-hover:text-text-secondary transition-colors"
          />
        )}
        <div className="absolute inset-0 flex items-center justify-center bg-black/30 opacity-0 group-hover:opacity-100 transition-opacity rounded-2xl">
          <Camera size={16} className="text-white" />
        </div>
      </button>
      <input
        ref={fileInputRef}
        type="file"
        accept="image/png,image/jpeg,image/webp,image/gif"
        onChange={handleFileChange}
        className="hidden"
      />
      <canvas ref={canvasRef} className="hidden" />
      <div>
        <p className="text-[13px] text-text-primary font-medium">
          {t("experts.custom.avatar", { defaultValue: "搭子头像" })}
        </p>
        <p className="text-[11px] text-text-muted mt-0.5">
          {t("experts.custom.avatar_hint", {
            defaultValue: "支持 PNG、JPG、WebP 格式",
          })}
        </p>
      </div>

      {cropOpen && rawImage && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
          <div className="bg-surface-0 rounded-2xl shadow-2xl p-6 w-full max-w-lg mx-4">
            <h3 className="text-sm font-semibold text-text-primary mb-4">
              {t("experts.custom.avatar_crop", { defaultValue: "调整头像" })}
            </h3>
            <div
              className="relative w-[200px] h-[200px] mx-auto bg-[#1a1a2e] rounded-full overflow-hidden cursor-grab active:cursor-grabbing select-none"
              onMouseDown={(e) => {
                setDragging(true);
                setDragStart({
                  x: e.clientX - offset.x,
                  y: e.clientY - offset.y,
                });
              }}
              onMouseMove={(e) => {
                if (!dragging) return;
                setOffset({
                  x: e.clientX - dragStart.x,
                  y: e.clientY - dragStart.y,
                });
              }}
              onMouseUp={() => setDragging(false)}
              onMouseLeave={() => setDragging(false)}
            >
              <div
                className="absolute inset-0 flex items-center justify-center pointer-events-none"
                style={{
                  transform: `scale(${scale}) translate(${offset.x / scale}px, ${offset.y / scale}px)`,
                }}
              >
                <img
                  src={rawImage.src}
                  alt=""
                  className="max-w-none"
                  draggable={false}
                />
              </div>
              <div className="absolute inset-0 rounded-full border-2 border-white/30 shadow-[inset_0_0_0_9999px_rgba(0,0,0,0.25)]" />
            </div>
            <div className="flex items-center gap-3 mt-4 mb-4">
              <ZoomOut size={14} className="text-text-muted" />
              <input
                type="range"
                min={
                  Math.max(
                    cropSize / Math.max(rawImage.width, rawImage.height),
                    0.3,
                  ) * 100
                }
                max={300}
                value={scale * 100}
                onChange={(e) => setScale(Number(e.target.value) / 100)}
                className="flex-1 accent-[#FF5A3C]"
              />
              <ZoomIn size={14} className="text-text-muted" />
              <span className="text-[11px] text-text-muted w-10 text-right tabular-nums">
                {displayScale}%
              </span>
            </div>
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => {
                  setCropOpen(false);
                  setRawImage(null);
                }}
                className="px-4 py-2 rounded-lg text-[13px] font-medium text-text-secondary hover:bg-surface-2 transition-colors"
              >
                {t("experts.custom.cancel", { defaultValue: "取消" })}
              </button>
              <button
                type="button"
                onClick={confirmCrop}
                className="px-4 py-2 rounded-lg text-[13px] font-medium bg-[#FF5A3C] text-white hover:opacity-90 transition-opacity"
              >
                {t("experts.custom.avatar_confirm", { defaultValue: "确认" })}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
});

const PAGE_SIZE = 50;

function SkillList({
  skills,
  displaySkills,
  selectedSkillsSet,
  installedSlugs,
  onToggleSkill,
  emptyLabel,
  noResultsLabel,
}: {
  skills: Array<{
    slug: string;
    name: string;
    description: string;
    tags: string[];
  }>;
  displaySkills: typeof skills;
  selectedSkillsSet: Set<string>;
  installedSlugs: Set<string>;
  onToggleSkill: (slug: string) => void;
  emptyLabel: string;
  noResultsLabel: string;
}) {
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);
  const sentinelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const sentinel = sentinelRef.current;
    if (!sentinel) return;
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry?.isIntersecting) {
          setVisibleCount((prev) => Math.min(prev + PAGE_SIZE, displaySkills.length));
        }
      },
      { rootMargin: "200px" },
    );
    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [displaySkills.length]);

  // Reset visible count when the skill list changes (tab switch, search, tag filter)
  useEffect(() => {
    setVisibleCount(PAGE_SIZE);
  }, [displaySkills]);

  const visibleSkills = displaySkills.slice(0, visibleCount);

  return (
    <div className="flex-1 min-h-0 overflow-y-auto rounded-lg border border-border bg-surface-0">
      {skills.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-12 gap-2">
          <Loader2 size={20} className="animate-spin text-text-muted" />
          <span className="text-[12px] text-text-muted">{emptyLabel}</span>
        </div>
      ) : (
        <div className="divide-y divide-border">
          {visibleSkills.map((skill) => (
            <SkillCheckboxItem
              key={skill.slug}
              skill={skill}
              isSelected={selectedSkillsSet.has(skill.slug)}
              isInstalled={installedSlugs.has(skill.slug)}
              onToggle={() => onToggleSkill(skill.slug)}
            />
          ))}
          {visibleSkills.length < displaySkills.length && (
            <div ref={sentinelRef} className="h-1" />
          )}
          {displaySkills.length === 0 && (
            <div className="flex flex-col items-center justify-center py-12 gap-2">
              <Search size={20} className="text-text-muted" />
              <span className="text-[12px] text-text-muted">
                {noResultsLabel}
              </span>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

const SkillCheckboxItem = memo(function SkillCheckboxItem({
  skill,
  isSelected,
  isInstalled,
  onToggle,
}: {
  skill: {
    slug: string;
    name: string;
    description: string;
    tags: string[];
  };
  isSelected: boolean;
  isInstalled: boolean;
  onToggle: () => void;
}) {
  const { t } = useTranslation();
  return (
    <label className="flex items-center gap-3 px-3 py-2.5 hover:bg-surface-1 cursor-pointer transition-colors">
      <input
        type="checkbox"
        checked={isSelected}
        onChange={onToggle}
        className="h-3.5 w-3.5 rounded border-border text-[#FF5A3C] focus:ring-[#FF5A3C]/30 shrink-0"
      />
      <div className="w-8 h-8 rounded-[8px] bg-white border border-border flex items-center justify-center shrink-0">
        <Zap size={14} className="text-text-muted" />
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="text-[12px] font-semibold text-text-primary truncate">
            {skill.name}
          </span>
          {isInstalled && (
            <span className="shrink-0 text-[10px] font-medium text-[var(--color-accent)] bg-[var(--color-accent)]/10 px-1.5 py-0.5 rounded">
              {t("skills.sourceInstalled")}
            </span>
          )}
        </div>
        {skill.description && (
          <p className="text-[11px] text-text-muted truncate mt-0.5">
            {skill.description}
          </p>
        )}
      </div>
      {isSelected && <Check size={14} className="text-[#FF5A3C] shrink-0" />}
    </label>
  );
});

export function ExpertCustomPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const queryClient = useQueryClient();
  const editSlug = searchParams.get("slug");
  const isEditing = !!editSlug;
  const [activeTab, setActiveTab] = useState<TabId>("basic");
  const [skillTab, setSkillTab] = useState<"yours" | "explore">("explore");
  const [skillSearch, setSkillSearch] = useState("");
  const [activeTag, setActiveTag] = useState<string | null>(null);

  const [name, setName] = useState("");
  const [avatarUrl, setAvatarUrl] = useState<string | null>(null);
  const [description, setDescription] = useState("");
  const [selectedModel, setSelectedModel] = useState("");
  const [selectedSkills, setSelectedSkills] = useState<string[]>([]);
  const selectedSkillsSet = useMemo(
    () => new Set(selectedSkills),
    [selectedSkills],
  );

  const [agentsMd, setAgentsMd] = useState(AGENTS_MD_PRESET);
  const [identityMd, setIdentityMd] = useState(IDENTITY_MD_PRESET);
  const [soulMd, setSoulMd] = useState(SOUL_MD_PRESET);
  const [userMd, setUserMd] = useState(USER_MD_PRESET);

  // Load platform template content as default values for file editors
  const { data: templateAgentsMd } = useQuery({
    queryKey: ["platform-template", "AGENTS.md"],
    queryFn: async () => {
      const res = await fetch("/api/v1/experthub/platform-templates/AGENTS.md");
      if (!res.ok) return null;
      return res.text();
    },
    staleTime: Number.POSITIVE_INFINITY,
  });
  const { data: templateIdentityMd } = useQuery({
    queryKey: ["platform-template", "IDENTITY.md"],
    queryFn: async () => {
      const res = await fetch(
        "/api/v1/experthub/platform-templates/IDENTITY.md",
      );
      if (!res.ok) return null;
      return res.text();
    },
    staleTime: Number.POSITIVE_INFINITY,
  });
  const { data: templateSoulMd } = useQuery({
    queryKey: ["platform-template", "SOUL.md"],
    queryFn: async () => {
      const res = await fetch("/api/v1/experthub/platform-templates/SOUL.md");
      if (!res.ok) return null;
      return res.text();
    },
    staleTime: Number.POSITIVE_INFINITY,
  });
  const { data: templateUserMd } = useQuery({
    queryKey: ["platform-template", "USER.md"],
    queryFn: async () => {
      const res = await fetch("/api/v1/experthub/platform-templates/USER.md");
      if (!res.ok) return null;
      return res.text();
    },
    staleTime: Number.POSITIVE_INFINITY,
  });

  // Track whether the user has explicitly edited each file (vs using the default)
  const identityTouchedRef = useRef(false);
  const agentsTouchedRef = useRef(false);
  const soulTouchedRef = useRef(false);
  const userTouchedRef = useRef(false);

  // Override defaults with platform template content once loaded
  useEffect(() => {
    if (templateAgentsMd && !agentsTouchedRef.current) {
      setAgentsMd(templateAgentsMd);
    }
  }, [templateAgentsMd]);

  // Debounce name → IDENTITY.md sync so typing in the name field doesn't
  // trigger a full re-render on every keystroke.
  useEffect(() => {
    if (!templateIdentityMd || identityTouchedRef.current) return;
    const timer = setTimeout(() => {
      setIdentityMd((prev) =>
        prev.replace(
          /-\s+\*\*Name:\*\*\s*(_\(.*\)\s*)?/,
          `- **Name:** ${name || "_pick something you like_"}`,
        ),
      );
    }, 400);
    return () => clearTimeout(timer);
  }, [templateIdentityMd, name]);

  useEffect(() => {
    if (templateSoulMd && !soulTouchedRef.current) {
      setSoulMd(templateSoulMd);
    }
  }, [templateSoulMd]);
  useEffect(() => {
    if (templateUserMd && !userTouchedRef.current) {
      setUserMd(templateUserMd);
    }
  }, [templateUserMd]);

  const { data: modelsData } = useQuery({
    queryKey: ["models"],
    queryFn: async () => {
      const { data } = await getApiV1Models();
      return data;
    },
  });
  const models = (modelsData?.models ?? []) as Array<{
    id: string;
    name: string;
    provider: string;
  }>;

  const { data: skillsData } = useCommunitySkills();
  const allSkills = skillsData?.skills ?? [];
  const installedSlugs = useMemo(
    () => new Set(skillsData?.installedSlugs ?? []),
    [skillsData?.installedSlugs],
  );
  const installedSkills = skillsData?.installedSkills ?? [];

  const { data: catalogData } = useExperthubCatalog();
  const ledgerBotId = useMemo(() => {
    if (!editSlug || !catalogData?.installedExperts) return null;
    const entry = catalogData.installedExperts.find((e) => e.slug === editSlug);
    return entry?.botId ?? null;
  }, [editSlug, catalogData?.installedExperts]);

  const { data: editData } = useQuery({
    queryKey: ["bot-by-id", ledgerBotId],
    queryFn: async () => {
      if (!ledgerBotId) return null;
      const { data } = await getApiV1BotsByBotId({
        path: { botId: ledgerBotId },
      });
      return (
        (data as {
          id: string;
          name: string;
          modelId?: string;
          slug: string;
        }) ?? null
      );
    },
    enabled: !!ledgerBotId,
  });

  // Restore edit state from catalog ledger entry (description, avatar) and
  // installed skills bound to this bot's workspace.
  const editLedgerEntry = useMemo(() => {
    if (!editSlug || !catalogData?.installedExperts) return null;
    return catalogData.installedExperts.find((e) => e.slug === editSlug) ?? null;
  }, [editSlug, catalogData?.installedExperts]);

  useEffect(() => {
    if (editData && isEditing) {
      setName(editData.name ?? "");
      if (editData.modelId) setSelectedModel(editData.modelId);
      if (editLedgerEntry?.description) {
        setDescription(editLedgerEntry.description);
      }
      if (editLedgerEntry?.avatarDataUrl) {
        setAvatarUrl(editLedgerEntry.avatarDataUrl);
      }
    }
  }, [editData, editLedgerEntry, isEditing]);

  // Restore selected skills when the bot ID is resolved during editing.
  // Watch the raw skills query data (stable reference) rather than the derived
  // installedSkills array to avoid re-render loops from a fresh [] on each
  // render while the query is still loading.
  const skillsRestoredRef = useRef<string | null>(null);
  useEffect(() => {
    if (!isEditing || !ledgerBotId) return;
    if (skillsRestoredRef.current === ledgerBotId) return;
    const botSkills = (skillsData?.installedSkills ?? [])
      .filter((s) => s.agentId === ledgerBotId)
      .map((s) => s.slug);
    if (botSkills.length > 0) {
      setSelectedSkills(botSkills);
      skillsRestoredRef.current = ledgerBotId;
    }
  }, [isEditing, ledgerBotId, skillsData]);

  const exploreSkills = useMemo(
    () => [...allSkills].filter((s) => !installedSlugs.has(s.slug)),
    [allSkills, installedSlugs],
  );

  const yoursSkills = useMemo(() => {
    return installedSkills.map((is) => {
      const catalogEntry = allSkills.find((s) => s.slug === is.slug);
      return (
        catalogEntry ?? {
          slug: is.slug,
          name: is.name || is.slug,
          description: is.description || "",
          downloads: 0,
          stars: 0,
          tags: [] as string[],
          version: "",
          updatedAt: "",
        }
      );
    });
  }, [installedSkills, allSkills]);

  const topTags = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const s of allSkills) {
      for (const tag of s.tags) {
        counts[tag] = (counts[tag] ?? 0) + 1;
      }
    }
    return Object.entries(counts)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 12)
      .map(([tag, count]) => ({ tag, count }));
  }, [allSkills]);

  const filteredExploreSkills = useMemo(() => {
    let list = [...exploreSkills];
    if (activeTag) list = list.filter((s) => s.tags.includes(activeTag));
    if (skillSearch.trim()) {
      const q = skillSearch.toLowerCase();
      list = list.filter((s) =>
        [s.slug, s.name, s.description].join("\n").toLowerCase().includes(q),
      );
    }
    return list;
  }, [exploreSkills, activeTag, skillSearch]);

  const filteredYoursSkills = useMemo(() => {
    let list = [...yoursSkills];
    if (skillSearch.trim()) {
      const q = skillSearch.toLowerCase();
      list = list.filter((s) =>
        [s.slug, s.name, s.description].join("\n").toLowerCase().includes(q),
      );
    }
    return list;
  }, [yoursSkills, skillSearch]);

  const saveMutation = useMutation({
    mutationFn: async () => {
      const workspaceFiles: Record<string, string> = {};
      if (agentsMd) workspaceFiles["AGENTS.md"] = agentsMd;
      if (identityMd) workspaceFiles["IDENTITY.md"] = identityMd;
      if (soulMd) workspaceFiles["SOUL.md"] = soulMd;
      if (userMd) workspaceFiles["USER.md"] = userMd;

      const { data, error } = await postApiV1ExperthubCustom({
        body: {
          name,
          avatarDataUrl: avatarUrl ?? undefined,
          modelId: selectedModel,
          description: description || undefined,
          skills: selectedSkills,
          existingSlug: editSlug ?? undefined,
          workspaceFiles,
        },
      });
      if (error) throw new Error("Failed to create custom expert");
      return data as { ok: boolean; botId: string; slug: string };
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({
        queryKey: ["experthub", "catalog"],
      });
      navigate("/workspace/experts");
    },
  });

  const displaySkills =
    skillTab === "explore" ? filteredExploreSkills : filteredYoursSkills;

  return (
    <div className="h-full flex flex-col overflow-hidden">
      <div className="max-w-4xl mx-auto px-4 sm:px-6 pt-8 md:pt-2 w-full flex flex-col flex-1 min-h-0">
        <div className="flex items-center gap-3 mb-6 shrink-0">
          <Link
            to="/workspace/experts"
            className="flex items-center justify-center w-8 h-8 rounded-lg hover:bg-surface-2 transition-colors text-text-muted hover:text-text-primary"
          >
            <ArrowLeft size={18} />
          </Link>
          <div>
            <h1 className="text-lg font-semibold text-[var(--color-tabby-foreground)]">
              {isEditing
                ? t("experts.custom.edit_title", { defaultValue: "编辑搭子" })
                : t("experts.custom.title")}
            </h1>
            <p className="text-xs text-[var(--color-tabby-muted)] mt-0.5">
              {isEditing ? editSlug : t("experts.custom.subtitle")}
            </p>
          </div>
        </div>

        <div className="inline-flex items-center gap-1 p-1 rounded-full bg-surface-2 mb-4 flex-wrap shrink-0">
          {TABS.map((tab) => {
            const active = activeTab === tab.id;
            const Icon = tab.icon;
            return (
              <button
                key={tab.id}
                type="button"
                onClick={() => setActiveTab(tab.id)}
                className={cn(
                  "flex items-center gap-1.5 px-4 py-1.5 rounded-full text-[13px] font-medium transition-all",
                  active
                    ? "bg-white text-text-primary shadow-[var(--shadow-rest)]"
                    : "text-text-secondary hover:text-text-primary",
                )}
              >
                <Icon size={14} />
                {t(`experts.custom.tab.${tab.id}`)}
              </button>
            );
          })}
        </div>

        <div className="flex-1 min-h-0 flex flex-col pb-6">
          {activeTab === "basic" && (
            <div className="flex-1 min-h-0 flex flex-col overflow-y-auto">
              <div className="shrink-0 space-y-6">
                <AvatarUpload
                  avatarUrl={avatarUrl}
                  onAvatarChange={setAvatarUrl}
                />

                <div>
                  <label
                    htmlFor="expert-name"
                    className="block text-[13px] font-medium text-text-primary mb-2"
                  >
                    {t("experts.custom.name")}
                  </label>
                  <input
                    id="expert-name"
                    type="text"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder={t("experts.custom.name_placeholder")}
                    className="w-full max-w-md rounded-lg border border-border bg-surface-0 px-3 py-2 text-[13px] text-text-primary placeholder:text-text-muted focus:outline-none focus:border-[var(--color-brand-primary)]/30 transition-colors"
                  />
                </div>

                <div>
                  <span className="block text-[13px] font-medium text-text-primary mb-2">
                    {t("experts.custom.model")}
                  </span>
                  <div className="w-[40%]">
                    <ModelPickerDropdown
                      models={models}
                      currentModelId={selectedModel}
                      emptyLabel={t("experts.custom.model_placeholder")}
                      onSelectModel={setSelectedModel}
                    />
                  </div>
                </div>

                <div>
                  <label
                    htmlFor="expert-description"
                    className="block text-[13px] font-medium text-text-primary mb-2"
                  >
                    {t("experts.custom.description", { defaultValue: "简介" })}
                  </label>
                  <textarea
                    id="expert-description"
                    value={description}
                    onChange={(e) => setDescription(e.target.value)}
                    placeholder={t("experts.custom.description_placeholder", {
                      defaultValue: "一句话介绍你的搭子...",
                    })}
                    rows={2}
                    className="w-full max-w-md rounded-lg border border-border bg-surface-0 px-3 py-2 text-[13px] text-text-primary placeholder:text-text-muted focus:outline-none focus:border-[var(--color-brand-primary)]/30 transition-colors resize-none"
                  />
                </div>
              </div>

              <div className="flex-1 min-h-0 flex flex-col mt-6">
                <span className="block text-[13px] font-medium text-text-primary mb-2 shrink-0">
                  {t("experts.custom.skills")}
                </span>
                <div className="flex items-center gap-2 mb-3 shrink-0">
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
                  <div className="flex items-center gap-1.5 mb-3 overflow-x-auto no-scrollbar shrink-0">
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
                <SkillList
                  skills={allSkills}
                  displaySkills={displaySkills}
                  selectedSkillsSet={selectedSkillsSet}
                  installedSlugs={installedSlugs}
                  onToggleSkill={(slug) =>
                    setSelectedSkills((prev) =>
                      prev.includes(slug)
                        ? prev.filter((s) => s !== slug)
                        : [...prev, slug],
                    )
                  }
                  emptyLabel={t("skills.loadingCatalog")}
                  noResultsLabel={t("skills.noMatchingSkills")}
                />
              </div>
                {selectedSkills.length > 0 && (
                  <p className="text-[11px] text-text-muted mt-1.5 shrink-0">
                    {t("experts.custom.skills_selected", {
                      defaultValue: "已选择 {{count}} 个技能",
                      count: selectedSkills.length,
                    })}
                  </p>
                )}
              </div>

              <div className="pt-4 shrink-0">
                <button
                  type="button"
                  disabled={
                    !name.trim() || !selectedModel || saveMutation.isPending
                  }
                  onClick={() => saveMutation.mutate()}
                  className="inline-flex items-center gap-2 px-5 py-2 rounded-lg bg-[#FF5A3C] text-white text-[13px] font-medium hover:opacity-90 transition-opacity disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  {saveMutation.isPending ? (
                    <Loader2 size={14} className="animate-spin" />
                  ) : (
                    <Save size={14} />
                  )}
                  {t(
                    isEditing
                      ? "experts.custom.edit_save"
                      : "experts.custom.create",
                    { defaultValue: isEditing ? "保存修改" : "创建搭子" },
                  )}
                </button>
                {saveMutation.isError && (
                  <p className="text-[11px] text-[var(--color-danger)] mt-2">
                    {t("experts.custom.create_failed", {
                      defaultValue: "创建失败，请重试",
                    })}
                  </p>
                )}
              </div>
            </div>
          )}

          {activeTab === "agents" && (
            <MarkdownEditor
              value={agentsMd}
              onChange={(v) => {
                agentsTouchedRef.current = true;
                setAgentsMd(v);
              }}
            />
          )}
          {activeTab === "identity" && (
            <MarkdownEditor
              value={identityMd}
              onChange={(v) => {
                identityTouchedRef.current = true;
                setIdentityMd(v);
              }}
            />
          )}
          {activeTab === "soul" && (
            <MarkdownEditor
              value={soulMd}
              onChange={(v) => {
                soulTouchedRef.current = true;
                setSoulMd(v);
              }}
            />
          )}
          {activeTab === "user" && (
            <MarkdownEditor
              value={userMd}
              onChange={(v) => {
                userTouchedRef.current = true;
                setUserMd(v);
              }}
            />
          )}
        </div>
      </div>
    </div>
  );
}
