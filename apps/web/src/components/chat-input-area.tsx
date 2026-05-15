import { ChatInput, ChatInputAttachButton } from "@/components/chat-input";
import { useCommunitySkills } from "@/hooks/use-community-catalog";
import { cn } from "@/lib/utils";
import { useQuery } from "@tanstack/react-query";
import {
  Check,
  ChevronDown,
  File,
  FileImage,
  FileSpreadsheet,
  FileText,
  Plus,
  Presentation,
  Sparkles,
  X,
  Zap,
} from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { getApiV1Models } from "../../lib/api/sdk.gen";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface BotItem {
  id: string;
  name: string;
  slug: string;
  status: "active" | "paused" | "deleted";
  modelId: string;
}

export interface PendingAttachment {
  id: string;
  type: "image" | "file";
  previewUrl: string;
  content: string;
  mimeType: string;
  filename?: string;
  size?: number;
}

export interface ChatInputAreaProps {
  bots: BotItem[];
  selectedBot: BotItem | null;
  onSelectBot: (bot: BotItem) => void;
  onSend: (text: string, attachments: PendingAttachment[]) => void;
  sending: boolean;
  waitingReply: boolean;
  disabled: boolean;
  placeholder: string;
  /** Show "add bot" button in bot dropdown (true for new conversation page) */
  showAddBot?: boolean;
  /** Show bot selector dropdown (default true, false for session page) */
  showBotSelector?: boolean;
  /** Show model selector dropdown (default true, false for session page) */
  showModelSelector?: boolean;
  /** Show model as read-only label instead of changeable dropdown */
  modelReadOnly?: boolean;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const MAX_FILE_BYTES = 7_500_000;

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function extractBase64FromDataUrl(dataUrl: string): string {
  const idx = dataUrl.indexOf(",");
  return idx >= 0 ? dataUrl.slice(idx + 1) : dataUrl;
}

// ---------------------------------------------------------------------------
// File bubble (for non-image attachments)
// ---------------------------------------------------------------------------

function FileBubble({
  filename,
  mimeType,
  size,
}: {
  filename: string;
  mimeType: string;
  size?: number;
}) {
  const ext = filename.split(".").pop()?.toLowerCase() ?? "";
  const isPdf = ext === "pdf";
  const isExcel = ["xls", "xlsx"].includes(ext);
  const isDoc = ["doc", "docx"].includes(ext);
  const isPpt = ["ppt", "pptx"].includes(ext);
  const isMd = ext === "md";
  const isTxt = ext === "txt";
  const isImage = mimeType.startsWith("image/");
  const isAudio = mimeType.startsWith("audio/");

  let Icon = File;
  let color = "text-gray-400";

  if (isPdf) {
    Icon = FileText;
    color = "text-red-500";
  } else if (isExcel) {
    Icon = FileSpreadsheet;
    color = "text-green-500";
  } else if (isDoc) {
    Icon = FileText;
    color = "text-blue-500";
  } else if (isPpt) {
    Icon = Presentation;
    color = "text-orange-500";
  } else if (isMd || isTxt) {
    Icon = FileText;
    color = "text-gray-400";
  } else if (isImage) {
    Icon = FileImage;
    color = "text-purple-500";
  } else if (isAudio) {
    Icon = File;
    color = "text-pink-500";
  }

  return (
    <div className="flex items-center gap-1.5 h-18 px-2.5 rounded-xl border border-border bg-surface-1 max-w-[160px]">
      <Icon size={24} className={`shrink-0 ${color}`} />
      <div className="min-w-0">
        <div className="text-[12px] text-text-primary truncate font-medium">
          {filename}
        </div>
        {size !== undefined && (
          <div className="text-[10px] text-text-muted">{formatBytes(size)}</div>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Attachment tray
// ---------------------------------------------------------------------------

function AttachmentTray({
  attachments,
  onRemove,
}: {
  attachments: PendingAttachment[];
  onRemove: (id: string) => void;
}) {
  const { t } = useTranslation();
  return (
    <div className="relative overflow-x-auto no-scrollbar px-3 pt-2.5 pb-1">
      <div className="flex gap-2 w-max">
        {attachments.map((att) => (
          <div key={att.id} className="relative group shrink-0">
            {att.type === "image" ? (
              <img
                src={att.previewUrl}
                alt=""
                className="h-16 w-16 rounded-xl object-cover border border-border"
              />
            ) : (
              <FileBubble
                filename={att.filename ?? "file"}
                mimeType={att.mimeType}
                size={att.size}
              />
            )}
            <button
              type="button"
              onClick={() => onRemove(att.id)}
              title={t("localChat.removeAttachment")}
              aria-label={t("localChat.removeAttachment")}
              className="absolute -top-1.5 -right-1.5 h-5 w-5 rounded-full bg-text-primary text-white flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity shadow"
            >
              <X size={10} />
            </button>
          </div>
        ))}
      </div>
      {attachments.length > 0 && (
        <div className="absolute right-0 top-0 bottom-0 w-10 bg-gradient-to-l from-[var(--color-tabby-bg)] to-transparent pointer-events-none" />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Bot selector dropdown
// ---------------------------------------------------------------------------

function BotSelector({
  bots,
  selected,
  onSelect,
  showAdd,
}: {
  bots: BotItem[];
  selected: BotItem | null;
  onSelect: (bot: BotItem) => void;
  showAdd?: boolean;
}) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  const activeBots = bots.filter((b) => b.status === "active");

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className={cn(
          "flex items-center gap-1 px-2 h-8 rounded-lg hover:bg-[var(--color-tabby-canvas)] transition-colors text-[var(--color-tabby-muted)] text-sm",
          open && "bg-[var(--color-tabby-canvas)]",
        )}
      >
        {(selected?.name ?? t("localChat.selectBot")).slice(0, 8)}
        <ChevronDown
          size={13}
          className={cn("transition-transform", open && "rotate-180")}
        />
      </button>

      {open && (
        <div className="absolute left-0 top-full z-50 mt-1.5 min-w-[180px] rounded-xl border border-border bg-surface-1 py-1 shadow-[0_8px_24px_rgba(15,23,42,0.12)]">
          {activeBots.length === 0 ? (
            <div className="px-3 py-2 text-[12px] text-text-muted">
              {t("localChat.noBots")}
            </div>
          ) : (
            activeBots.map((bot) => (
              <button
                key={bot.id}
                type="button"
                onClick={() => {
                  onSelect(bot);
                  setOpen(false);
                }}
                className={cn(
                  "flex items-center gap-2 w-full px-3 py-2 text-left text-[13px] transition-colors hover:bg-surface-2",
                  selected?.id === bot.id && "font-medium text-accent",
                )}
              >
                <Sparkles size={13} className="shrink-0 text-text-muted" />
                <span className="truncate">{bot.name}</span>
              </button>
            ))
          )}
          {showAdd && (
            <div className="border-t border-border mt-1 pt-1">
              <button
                type="button"
                onClick={() => {
                  setOpen(false);
                  navigate("/workspace/experts/custom");
                }}
                className="flex items-center gap-2 w-full px-3 py-2 text-left text-[12px] text-text-secondary hover:bg-surface-2 rounded-b-lg transition-colors"
              >
                <Plus size={13} className="shrink-0" />
                {t("localChat.addBot", { defaultValue: "添加伙伴" })}
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export function ChatInputArea({
  bots,
  selectedBot,
  onSelectBot,
  onSend,
  sending,
  waitingReply,
  disabled,
  placeholder,
  showAddBot,
  showBotSelector = true,
  showModelSelector = true,
  modelReadOnly = false,
}: ChatInputAreaProps) {
  const { t } = useTranslation();
  const [input, setInput] = useState("");
  const [pendingAttachments, setPendingAttachments] = useState<
    PendingAttachment[]
  >([]);
  const [skillDropdownOpen, setSkillDropdownOpen] = useState(false);
  const [selectedSkillSlug, setSelectedSkillSlug] = useState<string | null>(
    null,
  );
  const [modelDropdownOpen, setModelDropdownOpen] = useState(false);

  const fileRef = useRef<HTMLInputElement>(null);
  const skillDropdownRef = useRef<HTMLDivElement>(null);
  const modelDropdownRef = useRef<HTMLDivElement>(null);

  const { data: skillsData } = useCommunitySkills();
  const installedSkills = skillsData?.installedSkills ?? [];

  const { data: modelsData } = useQuery({
    queryKey: ["models"],
    queryFn: async () => {
      const { data } = await getApiV1Models();
      return data;
    },
    staleTime: 5 * 60 * 1000,
  });
  const models = (modelsData?.models ?? []) as Array<{
    id: string;
    name: string;
    provider: string;
  }>;

  const addAttachment = useCallback((att: Omit<PendingAttachment, "id">) => {
    setPendingAttachments((prev) => [
      ...prev,
      { ...att, id: crypto.randomUUID() },
    ]);
  }, []);

  const removeAttachment = useCallback((id: string) => {
    setPendingAttachments((prev) => prev.filter((a) => a.id !== id));
  }, []);

  const readFileBlob = useCallback(
    (file: File) => {
      if (file.size > MAX_FILE_BYTES) {
        toast.error(
          `File "${file.name}" is too large (${formatBytes(file.size)}). Maximum allowed size is ${formatBytes(MAX_FILE_BYTES)}.`,
        );
        return;
      }
      const isImage = file.type.startsWith("image/");
      const reader = new FileReader();
      reader.onload = () => {
        const dataUrl = reader.result as string;
        addAttachment({
          type: isImage ? "image" : "file",
          previewUrl: dataUrl,
          content: extractBase64FromDataUrl(dataUrl),
          mimeType: file.type || "application/octet-stream",
          filename: file.name,
          size: file.size,
        });
      };
      reader.readAsDataURL(file);
    },
    [addAttachment],
  );

  const handleFile = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (!file) return;
      readFileBlob(file);
      e.target.value = "";
    },
    [readFileBlob],
  );

  const handlePaste = useCallback(
    (e: React.ClipboardEvent) => {
      if (!selectedBot || waitingReply) return;
      const imageItem = Array.from(e.clipboardData.items).find((i) =>
        i.type.startsWith("image/"),
      );
      if (!imageItem) return;
      e.preventDefault();
      const blob = imageItem.getAsFile();
      if (!blob) return;
      if (blob.size > MAX_FILE_BYTES) {
        toast.error(
          `Pasted image is too large (${formatBytes(blob.size)}). Maximum allowed size is ${formatBytes(MAX_FILE_BYTES)}.`,
        );
        return;
      }
      const reader = new FileReader();
      reader.onload = () => {
        const dataUrl = reader.result as string;
        addAttachment({
          type: "image",
          previewUrl: dataUrl,
          content: extractBase64FromDataUrl(dataUrl),
          mimeType: blob.type || "image/png",
          filename: `pasted-image-${Date.now()}.png`,
          size: blob.size,
        });
      };
      reader.readAsDataURL(blob);
    },
    [addAttachment, selectedBot, waitingReply],
  );

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (
        skillDropdownRef.current &&
        !skillDropdownRef.current.contains(e.target as Node)
      ) {
        setSkillDropdownOpen(false);
      }
      if (
        modelDropdownRef.current &&
        !modelDropdownRef.current.contains(e.target as Node)
      ) {
        setModelDropdownOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  }

  const canSend =
    !!selectedBot &&
    !sending &&
    !waitingReply &&
    (input.trim().length > 0 || pendingAttachments.length > 0);

  function handleSend() {
    if (!canSend) return;
    const text = input.trim();
    setInput("");
    const atts = [...pendingAttachments];
    setPendingAttachments([]);
    onSend(text, atts);
  }

  return (
    <>
      <input
        ref={fileRef}
        type="file"
        accept="image/*,.pdf,.doc,.docx,.xls,.xlsx"
        className="hidden"
        onChange={handleFile}
      />
      {pendingAttachments.length > 0 && (
        <AttachmentTray
          attachments={pendingAttachments}
          onRemove={removeAttachment}
        />
      )}
      <ChatInput
        value={input}
        onChange={setInput}
        onKeyDown={handleKeyDown}
        onPaste={handlePaste}
        onSend={handleSend}
        placeholder={placeholder}
        disabled={disabled}
        sending={sending}
        leftActions={
          <>
            <ChatInputAttachButton onClick={() => fileRef.current?.click()} />
            <div className="relative" ref={skillDropdownRef}>
              <button
                type="button"
                onClick={() => setSkillDropdownOpen(!skillDropdownOpen)}
                className={cn(
                  "flex items-center gap-1.5 px-2 h-8 rounded-lg hover:bg-[var(--color-tabby-canvas)] transition-colors text-sm",
                  selectedSkillSlug
                    ? "text-[var(--color-tabby-foreground)] font-medium"
                    : "text-[var(--color-tabby-muted)]",
                )}
              >
                <Sparkles className="w-4 h-4" />
                {selectedSkillSlug
                  ? (installedSkills.find((s) => s.slug === selectedSkillSlug)
                      ?.name ?? selectedSkillSlug)
                  : "Skills"}
              </button>
              {skillDropdownOpen && (
                <div className="absolute bottom-full left-0 mb-1 w-56 bg-white border border-[var(--color-tabby-border)] rounded-xl shadow-lg z-50 max-h-64 overflow-y-auto">
                  <div className="px-3 py-2 text-[11px] text-[var(--color-tabby-muted)] font-medium border-b border-[var(--color-tabby-border)]">
                    {t("skills.installed", { defaultValue: "已安装技能" })}
                  </div>
                  {installedSkills.length === 0 ? (
                    <div className="px-3 py-4 text-xs text-[var(--color-tabby-muted)] text-center">
                      {t("skills.noInstalled", {
                        defaultValue: "暂无已安装技能",
                      })}
                    </div>
                  ) : (
                    installedSkills.map((skill) => (
                      <button
                        key={skill.slug}
                        type="button"
                        onClick={() => {
                          setSelectedSkillSlug(
                            selectedSkillSlug === skill.slug
                              ? null
                              : skill.slug,
                          );
                          setSkillDropdownOpen(false);
                        }}
                        className="flex items-center gap-2 w-full px-3 py-2 text-left text-sm hover:bg-[var(--color-tabby-canvas)] transition-colors"
                      >
                        <div className="w-6 h-6 rounded-md bg-[var(--color-tabby-canvas)] flex items-center justify-center shrink-0">
                          <Zap
                            size={12}
                            className="text-[var(--color-tabby-muted)]"
                          />
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="text-[13px] text-[var(--color-tabby-foreground)] truncate">
                            {skill.name}
                          </div>
                        </div>
                        {selectedSkillSlug === skill.slug && (
                          <Check
                            size={14}
                            className="text-[var(--color-tabby-orange)] shrink-0"
                          />
                        )}
                      </button>
                    ))
                  )}
                </div>
              )}
            </div>
          </>
        }
        rightActions={
          <>
            {showBotSelector ? (
              <BotSelector
                bots={bots}
                selected={selectedBot}
                onSelect={onSelectBot}
                showAdd={showAddBot}
              />
            ) : selectedBot ? (
              <span className="text-[12px] text-text-muted">
                {selectedBot.name}
              </span>
            ) : null}
            {showModelSelector &&
              (modelReadOnly ? (
                <span className="text-[12px] text-text-muted">
                  {models.find((m) => m.id === selectedBot?.modelId)?.name ??
                    selectedBot?.modelId ??
                    "Default"}
                </span>
              ) : (
                <div className="relative" ref={modelDropdownRef}>
                  <button
                    type="button"
                    onClick={() => setModelDropdownOpen(!modelDropdownOpen)}
                    className="flex items-center gap-1 px-2 h-8 rounded-lg hover:bg-[var(--color-tabby-canvas)] transition-colors text-[var(--color-tabby-muted)] text-sm"
                  >
                    {models.find((m) => m.id === selectedBot?.modelId)?.name ??
                      selectedBot?.modelId ??
                      "Default"}
                    <ChevronDown className="w-3.5 h-3.5" />
                  </button>
                  {modelDropdownOpen && (
                    <div className="absolute bottom-full right-0 mb-1 w-52 bg-white border border-[var(--color-tabby-border)] rounded-xl shadow-lg z-50 max-h-72 overflow-y-auto">
                      {(() => {
                        const filtered = models.filter((m) => m.id && m.name);
                        const groups = new Map<string, typeof filtered>();
                        for (const m of filtered) {
                          const provider = m.provider || "Other";
                          if (!groups.has(provider)) groups.set(provider, []);
                          groups.get(provider)?.push(m);
                        }
                        return Array.from(groups.entries()).map(
                          ([provider, providerModels], gi) => (
                            <div key={provider}>
                              <div
                                className={cn(
                                  "px-3 py-1.5 text-[10px] font-semibold text-[var(--color-tabby-muted)] uppercase tracking-wide",
                                  gi > 0 &&
                                    "border-t border-[var(--color-tabby-border)]",
                                )}
                              >
                                {provider}
                              </div>
                              {providerModels.map((m) => (
                                <button
                                  key={m.id}
                                  type="button"
                                  onClick={() => {
                                    if (!selectedBot) return;
                                    onSelectBot({
                                      ...selectedBot,
                                      modelId: m.id ?? "",
                                    });
                                    setModelDropdownOpen(false);
                                  }}
                                  className="flex items-center gap-2 w-full px-3 py-2 text-left text-sm hover:bg-[var(--color-tabby-canvas)] transition-colors"
                                >
                                  <div className="flex-1 min-w-0">
                                    <div className="text-[13px] text-[var(--color-tabby-foreground)] truncate">
                                      {m.name}
                                    </div>
                                  </div>
                                  {selectedBot?.modelId === m.id && (
                                    <Check
                                      size={14}
                                      className="text-[var(--color-tabby-orange)] shrink-0"
                                    />
                                  )}
                                </button>
                              ))}
                            </div>
                          ),
                        );
                      })()}
                    </div>
                  )}
                </div>
              ))}
          </>
        }
      />
    </>
  );
}
