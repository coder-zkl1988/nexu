import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import {
  ChevronDown,
  Clock,
  Edit3,
  GitBranch,
  Loader2,
  Mail,
  MessageSquare,
  Pause,
  Play,
  Plus,
  Sparkles,
  Trash2,
  Zap,
} from "lucide-react";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { getApiV1Bots } from "../../lib/api/sdk.gen";
import type { GetApiV1BotsResponse } from "../../lib/api/types.gen";

interface RunHistoryEntry {
  time: string;
  success: boolean;
  duration: string;
}

interface Automation {
  id: string;
  name: string;
  description: string;
  trigger: string;
  action: string;
  status: "active" | "paused";
  lastRun: string;
  icon: typeof Mail;
  iconColor: string;
  botId: string;
  cron: string;
  prompt: string;
  history: RunHistoryEntry[];
}

const DAYS = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"] as const;
type DayKey = (typeof DAYS)[number];

const mockAutomations: Automation[] = [
  {
    id: "1",
    name: "Daily Report Generator",
    description: "Automatically generate and send daily analytics reports",
    trigger: "Schedule · Every day at 9:00 AM",
    action: "Generate report → Send email",
    status: "paused",
    lastRun: "2 hours ago",
    icon: Mail,
    iconColor: "bg-blue-50 text-blue-500",
    botId: "bot-1",
    cron: "0 9 * * 1-5",
    prompt:
      "Generate the daily analytics report and send it to the team mailing list.",
    history: [
      { time: "9:00 AM", success: true, duration: "2.3s" },
      { time: "9:00 AM", success: true, duration: "1.8s" },
      { time: "9:00 AM", success: false, duration: "0.5s" },
    ],
  },
  {
    id: "2",
    name: "Slack Summary Bot",
    description: "Summarize important conversations and post to channel",
    trigger: "Webhook · New message in #general",
    action: "Summarize → Post to Slack",
    status: "paused",
    lastRun: "15 min ago",
    icon: MessageSquare,
    iconColor: "bg-purple-50 text-purple-500",
    botId: "bot-2",
    cron: "",
    prompt:
      "Summarize the latest conversations in #general and post highlights.",
    history: [
      { time: "10:45 AM", success: true, duration: "3.1s" },
      { time: "10:30 AM", success: true, duration: "2.7s" },
    ],
  },
  {
    id: "3",
    name: "Code Review Assistant",
    description: "Auto-review pull requests and suggest improvements",
    trigger: "GitHub · New PR opened",
    action: "Analyze code → Comment on PR",
    status: "paused",
    lastRun: "3 days ago",
    icon: GitBranch,
    iconColor: "bg-orange-50 text-orange-500",
    botId: "bot-3",
    cron: "",
    prompt: "Review the pull request and suggest improvements.",
    history: [
      { time: "May 5", success: true, duration: "5.2s" },
      { time: "May 4", success: true, duration: "4.1s" },
      { time: "May 3", success: false, duration: "0.8s" },
    ],
  },
  {
    id: "4",
    name: "Customer Support Triage",
    description: "Classify and route incoming support tickets",
    trigger: "Webhook · New ticket created",
    action: "Classify → Assign to agent",
    status: "paused",
    lastRun: "1 hour ago",
    icon: Zap,
    iconColor: "bg-green-50 text-green-500",
    botId: "bot-4",
    cron: "",
    prompt:
      "Classify the incoming support ticket and assign it to the appropriate agent.",
    history: [
      { time: "9:45 AM", success: true, duration: "1.2s" },
      { time: "9:20 AM", success: true, duration: "0.9s" },
      { time: "8:55 AM", success: true, duration: "1.5s" },
    ],
  },
];

function AutomationModal({
  open,
  onOpenChange,
  editingAutomation,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  editingAutomation: Automation | null;
}) {
  const { t } = useTranslation();
  const isEditing = editingAutomation !== null;

  const [bots, setBots] = useState<Array<{ id: string; name: string }>>([]);
  const [loadingBots, setLoadingBots] = useState(false);

  const [name, setName] = useState("");
  const [botId, setBotId] = useState("");
  const [scheduleMode, setScheduleMode] = useState<"daily" | "interval">(
    "daily",
  );
  const [time, setTime] = useState("09:00");
  const [selectedDays, setSelectedDays] = useState<Set<DayKey>>(new Set());
  const [intervalHours, setIntervalHours] = useState(0);
  const [intervalMinutes, setIntervalMinutes] = useState(30);
  const [prompt, setPrompt] = useState("");
  const [runImmediately, setRunImmediately] = useState(false);

  // Fetch bots when modal opens
  useEffect(() => {
    if (open) {
      setLoadingBots(true);
      getApiV1Bots()
        .then((res: { data?: GetApiV1BotsResponse }) => {
          if (res.data?.bots) {
            // Filter active bots only
            const activeBots = res.data.bots
              .filter((b) => b.status === "active")
              .map((b) => ({ id: b.id, name: b.name }));
            setBots(activeBots);
          }
        })
        .finally(() => setLoadingBots(false));
    }
  }, [open]);

  // Pre-fill form when editing
  useEffect(() => {
    if (editingAutomation) {
      setName(editingAutomation.name);
      setBotId(editingAutomation.botId);
      setPrompt(editingAutomation.prompt);

      // Parse cron expression to extract time and days
      if (editingAutomation.cron) {
        const parts = editingAutomation.cron.split(" ");
        if (parts.length >= 5) {
          const minute = parts[0] ?? "0";
          const hour = parts[1] ?? "9";
          setTime(`${hour.padStart(2, "0")}:${minute.padStart(2, "0")}`);

          // Parse days (1=Monday, 7=Sunday in cron)
          const daysPart = parts[4];
          if (daysPart && daysPart !== "*") {
            const dayMap: Record<string, DayKey> = {
              "1": "mon",
              "2": "tue",
              "3": "wed",
              "4": "thu",
              "5": "fri",
              "6": "sat",
              "7": "sun",
            };
            const selected = new Set<DayKey>();
            if (daysPart.includes("-")) {
              const rangeParts = daysPart.split("-");
              const start = Number(rangeParts[0] ?? 1);
              const end = Number(rangeParts[1] ?? 5);
              for (let d = start; d <= end; d++) {
                const key = dayMap[String(d)];
                if (key) selected.add(key);
              }
            } else if (daysPart.includes(",")) {
              for (const d of daysPart.split(",")) {
                const key = dayMap[d.trim()];
                if (key) selected.add(key);
              }
            } else {
              const key = dayMap[daysPart];
              if (key) selected.add(key);
            }
            setSelectedDays(selected);
          }
        }
      }
    }
  }, [editingAutomation]);

  function resetForm() {
    setName("");
    setBotId("");
    setScheduleMode("daily");
    setTime("09:00");
    setSelectedDays(new Set());
    setIntervalHours(0);
    setIntervalMinutes(30);
    setPrompt("");
    setRunImmediately(false);
  }

  function handleOpenChange(val: boolean) {
    if (!val) resetForm();
    onOpenChange(val);
  }

  function toggleDay(day: DayKey) {
    setSelectedDays((prev) => {
      const next = new Set(prev);
      if (next.has(day)) {
        next.delete(day);
      } else {
        next.add(day);
      }
      return next;
    });
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="w-[600px] h-[720px] flex flex-col p-0 bg-white rounded-xl">
        <div className="px-8 pt-8 pb-5">
          <DialogTitle className="text-[18px] font-semibold leading-tight text-[var(--color-tabby-foreground)]">
            {isEditing
              ? t("automations.modal.editTitle")
              : t("automations.modal.createTitle")}
          </DialogTitle>
          <DialogDescription className="text-[13px] text-[var(--color-tabby-muted)] mt-1">
            {t("automations.modal.description")}
          </DialogDescription>
        </div>

        <div className="px-8 flex-1 overflow-y-auto space-y-5 pb-2">
          {/* Name */}
          <div>
            <Label className="block text-[13px] font-medium text-[var(--color-tabby-foreground)] mb-1.5">
              {t("automations.modal.name")}
            </Label>
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="text-[13px] py-2 border-[var(--color-tabby-border)] rounded-lg focus:ring-1 focus:ring-[var(--color-tabby-foreground)] focus:border-[var(--color-tabby-foreground)]"
            />
          </div>

          {/* Assign task to */}
          <div>
            <Label className="block text-[13px] font-medium text-[var(--color-tabby-foreground)] mb-1.5">
              {t("automations.modal.assignTo")}
            </Label>
            <div className="relative">
              <select
                value={botId}
                onChange={(e) => setBotId(e.target.value)}
                disabled={loadingBots}
                className="block w-full pl-3 pr-10 py-2 text-[13px] border border-[var(--color-tabby-border)] rounded-lg bg-white text-[var(--color-tabby-foreground)] focus:ring-1 focus:ring-[var(--color-tabby-foreground)] focus:border-[var(--color-tabby-foreground)] appearance-none disabled:opacity-50 disabled:cursor-not-allowed"
              >
                <option value="">
                  {loadingBots
                    ? t("automations.modal.loading")
                    : t("automations.modal.assignPlaceholder")}
                </option>
                {bots.map((bot) => (
                  <option key={bot.id} value={bot.id}>
                    {bot.name}
                  </option>
                ))}
              </select>
              <div className="pointer-events-none absolute inset-y-0 right-0 flex items-center px-3 text-[var(--color-tabby-muted)]">
                {loadingBots ? (
                  <Loader2 size={16} className="animate-spin" />
                ) : (
                  <ChevronDown size={16} />
                )}
              </div>
            </div>
          </div>

          {/* Schedule */}
          <div>
            <Label className="block text-[13px] font-medium text-[var(--color-tabby-foreground)] mb-2.5">
              {t("automations.modal.schedule")}
            </Label>

            {/* Daily / Interval toggle */}
            <div className="flex p-1 bg-[var(--color-tabby-surface-2)] rounded-lg border border-[var(--color-tabby-border)] mb-3">
              <button
                type="button"
                onClick={() => setScheduleMode("daily")}
                className={cn(
                  "flex-1 py-1.5 text-[13px] font-medium rounded-md transition-colors",
                  scheduleMode === "daily"
                    ? "bg-white shadow-sm border border-[var(--color-tabby-border)] text-[var(--color-tabby-foreground)]"
                    : "text-[var(--color-tabby-muted)] hover:text-[var(--color-tabby-foreground)]",
                )}
              >
                {t("automations.modal.daily")}
              </button>
              <button
                type="button"
                onClick={() => setScheduleMode("interval")}
                className={cn(
                  "flex-1 py-[6px] text-[14px] font-medium rounded-md transition-colors",
                  scheduleMode === "interval"
                    ? "bg-white shadow-sm border border-[var(--color-tabby-border)] text-[var(--color-tabby-foreground)]"
                    : "text-[var(--color-tabby-muted)] hover:text-[var(--color-tabby-foreground)]",
                )}
              >
                {t("automations.modal.interval")}
              </button>
            </div>

            {scheduleMode === "daily" && (
              <div className="space-y-3">
                {/* Time picker - 24h format */}
                <div className="flex items-center gap-3">
                  <input
                    type="time"
                    value={time}
                    onChange={(e) => setTime(e.target.value)}
                    className="block w-[120px] px-3 py-1.5 text-[13px] border border-[var(--color-tabby-border)] rounded-lg bg-white text-[var(--color-tabby-foreground)] focus:outline-none focus:ring-2 focus:ring-black focus:border-black [&::-webkit-calendar-picker-indicator]:opacity-50 [&::-webkit-calendar-picker-indicator]:hover:opacity-100"
                  />
                  <span className="text-[12px] text-[var(--color-tabby-muted)]">
                    {t("automations.modal.timezone")}:{" "}
                    {Intl.DateTimeFormat().resolvedOptions().timeZone}
                  </span>
                </div>

                {/* Days of week - full week, none selected by default */}
                <div>
                  <span className="text-[12px] text-[var(--color-tabby-muted)] mb-1.5 block">
                    {t("automations.modal.days")}
                  </span>
                  <div className="flex gap-1">
                    {DAYS.map((day) => (
                      <button
                        key={day}
                        type="button"
                        onClick={() => toggleDay(day)}
                        className={cn(
                          "w-8 h-8 rounded-lg text-[12px] font-medium transition-colors",
                          selectedDays.has(day)
                            ? "bg-black text-white"
                            : "bg-black/10 text-[var(--color-tabby-muted)] hover:bg-black/20",
                        )}
                      >
                        {t(`automations.days.${day}`)}
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            )}

            {scheduleMode === "interval" && (
              <div className="flex items-center gap-2">
                <span className="text-[12px] text-[var(--color-tabby-muted)]">
                  {t("automations.modal.every")}
                </span>
                <Input
                  type="number"
                  min={0}
                  max={23}
                  value={intervalHours}
                  onChange={(e) => setIntervalHours(Number(e.target.value))}
                  className="w-16 text-[13px] py-1.5 text-center border-[var(--color-tabby-border)]"
                />
                <span className="text-[12px] text-[var(--color-tabby-muted)]">
                  {t("automations.modal.hours")}
                </span>
                <span className="text-[12px] text-[var(--color-tabby-muted)]">
                  {t("automations.modal.and")}
                </span>
                <Input
                  type="number"
                  min={1}
                  max={59}
                  value={intervalMinutes}
                  onChange={(e) => setIntervalMinutes(Number(e.target.value))}
                  className="w-16 text-[13px] py-1.5 text-center border-[var(--color-tabby-border)]"
                />
                <span className="text-[12px] text-[var(--color-tabby-muted)]">
                  {t("automations.modal.minutes")}
                </span>
              </div>
            )}
          </div>

          {/* Prompt */}
          <div>
            <Label className="block text-[13px] font-medium text-[var(--color-tabby-foreground)] mb-1.5">
              {t("automations.modal.prompt")}
            </Label>
            <Textarea
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              placeholder={t("automations.modal.promptPlaceholder")}
              rows={4}
              className="text-[13px] resize-none border-[var(--color-tabby-border)] rounded-lg focus:ring-1 focus:ring-[var(--color-tabby-foreground)] focus:border-[var(--color-tabby-foreground)]"
            />
          </div>

          {/* Run immediately */}
          <div className="flex items-center">
            <Switch
              size="sm"
              checked={runImmediately}
              onCheckedChange={setRunImmediately}
            />
            <Label className="ml-3 text-[13px] font-medium text-[var(--color-tabby-foreground)] cursor-pointer">
              {t("automations.modal.runImmediately")}
            </Label>
          </div>
        </div>

        <div className="px-8 py-5 flex justify-end gap-3 border-t border-[var(--color-tabby-border)]">
          <button
            type="button"
            onClick={() => handleOpenChange(false)}
            className="px-5 py-2 text-[13px] font-medium text-[var(--color-tabby-muted)] bg-white border border-[var(--color-tabby-border)] rounded-lg hover:bg-[var(--color-tabby-surface-2)] transition-colors"
          >
            {t("automations.modal.cancel")}
          </button>
          <button
            type="submit"
            className="px-5 py-2 text-[13px] font-medium text-white bg-black rounded-lg hover:opacity-90 transition-opacity focus:outline-none focus:ring-2 focus:ring-black focus:ring-offset-2"
          >
            {isEditing
              ? t("automations.modal.save")
              : t("automations.modal.create")}
          </button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

export function AutomationsPage() {
  const { t } = useTranslation();
  const [filter, setFilter] = useState<"all" | "active" | "paused">("all");
  const [_expandedId, _setExpandedId] = useState<string | null>(null);
  const [showModal, setShowModal] = useState(false);
  const [editingAutomation, setEditingAutomation] = useState<Automation | null>(
    null,
  );
  const [automations, setAutomations] = useState<Automation[]>(mockAutomations);

  const filtered = automations.filter((a) => {
    if (filter === "all") return true;
    return a.status === filter;
  });

  function handleNew() {
    setEditingAutomation(null);
    setShowModal(true);
  }

  function handleEdit(automation: Automation) {
    setEditingAutomation(automation);
    setShowModal(true);
  }

  function handleToggleStatus(automation: Automation) {
    setAutomations((prev) =>
      prev.map((a) =>
        a.id === automation.id
          ? { ...a, status: a.status === "active" ? "paused" : "active" }
          : a,
      ),
    );
  }

  function handleDelete(automation: Automation) {
    setAutomations((prev) => prev.filter((a) => a.id !== automation.id));
  }

  return (
    <div className="h-full overflow-y-auto px-6 py-4">
      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <div>
          <h1 className="text-lg font-semibold text-[var(--color-tabby-foreground)]">
            {t("layout.nav.automations")}
          </h1>
          <p className="text-xs text-[var(--color-tabby-muted)] mt-0.5">
            {t("automations.subtitle")}
          </p>
        </div>
        <button
          type="button"
          onClick={handleNew}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-black text-white text-sm font-medium hover:opacity-90 transition-opacity"
        >
          <Plus className="w-4 h-4" />
          {t("automations.newAutomation")}
        </button>
      </div>

      {/* Filter tabs */}
      <div className="flex items-center justify-between mb-5 border-b border-[var(--color-tabby-border)]">
        <div className="flex items-center gap-6">
          {(
            [
              {
                id: "all" as const,
                label: t("automations.all"),
                count: mockAutomations.length,
              },
              {
                id: "active" as const,
                label: t("automations.active"),
                count: mockAutomations.filter((a) => a.status === "active")
                  .length,
              },
              {
                id: "paused" as const,
                label: t("automations.paused"),
                count: mockAutomations.filter((a) => a.status === "paused")
                  .length,
              },
            ] as const
          ).map((tab) => (
            <button
              key={tab.id}
              type="button"
              onClick={() => setFilter(tab.id)}
              className={cn(
                "relative pb-2.5 text-sm font-medium transition-colors",
                filter === tab.id
                  ? "text-[var(--color-tabby-foreground)]"
                  : "text-[var(--color-tabby-muted)] hover:text-[var(--color-tabby-foreground)]",
              )}
            >
              {tab.label}
              <span className="ml-1 text-[var(--color-tabby-muted)]">
                {tab.count}
              </span>
              {filter === tab.id && (
                <span className="absolute bottom-0 left-0 right-0 h-0.5 bg-[var(--color-tabby-foreground)] rounded-full" />
              )}
            </button>
          ))}
        </div>
      </div>

      {/* Content - Card Grid */}
      {filtered.length > 0 ? (
        <div className="grid gap-4 [grid-template-columns:repeat(auto-fill,minmax(220px,1fr))]">
          {filtered.map((automation) => {
            const Icon = automation.icon;
            return (
              <div
                key={automation.id}
                className="bg-white rounded-xl border border-[var(--color-tabby-border)] p-4 hover:border-[var(--color-tabby-foreground)]/30 transition-colors cursor-pointer"
              >
                {/* Header */}
                <div className="flex items-start gap-3 mb-3">
                  <div
                    className={cn(
                      "w-10 h-10 rounded-xl flex items-center justify-center shrink-0",
                      automation.iconColor,
                    )}
                  >
                    <Icon className="w-5 h-5" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-0.5">
                      <span className="text-[14px] font-semibold text-[var(--color-tabby-foreground)] truncate">
                        {automation.name}
                      </span>
                      <span
                        className={cn(
                          "text-[10px] px-1.5 py-0.5 rounded-full font-medium shrink-0",
                          automation.status === "active"
                            ? "bg-green-50 text-green-600"
                            : "bg-amber-50 text-amber-600",
                        )}
                      >
                        {automation.status === "active"
                          ? t("automations.active")
                          : t("automations.paused")}
                      </span>
                    </div>
                    <p className="text-[12px] text-[var(--color-tabby-muted)] line-clamp-1">
                      {automation.description}
                    </p>
                  </div>
                </div>

                {/* Trigger & Action */}
                <div className="space-y-1.5 mb-3">
                  <div className="flex items-center gap-2 text-[12px]">
                    <Clock className="w-3.5 h-3.5 text-[var(--color-tabby-muted)] shrink-0" />
                    <span className="text-[var(--color-tabby-muted)]">
                      {t("automations.detail.trigger")}:
                    </span>
                    <span className="text-[var(--color-tabby-foreground)] truncate">
                      {automation.trigger}
                    </span>
                  </div>
                  <div className="flex items-center gap-2 text-[12px]">
                    <Zap className="w-3.5 h-3.5 text-[var(--color-tabby-muted)] shrink-0" />
                    <span className="text-[var(--color-tabby-muted)]">
                      {t("automations.detail.action")}:
                    </span>
                    <span className="text-[var(--color-tabby-foreground)] truncate">
                      {automation.action}
                    </span>
                  </div>
                </div>

                {/* Footer */}
                <div className="flex items-center justify-between pt-3 border-t border-[var(--color-tabby-border)]">
                  <span className="text-[11px] text-[var(--color-tabby-muted)]">
                    {automation.lastRun}
                  </span>
                  <div className="flex items-center gap-1">
                    <button
                      type="button"
                      onClick={() => handleEdit(automation)}
                      className="p-1.5 rounded-md text-[var(--color-tabby-muted)] hover:text-[var(--color-tabby-foreground)] hover:bg-neutral-100 transition-colors"
                    >
                      <Edit3 size={14} />
                    </button>
                    <button
                      type="button"
                      onClick={() => handleToggleStatus(automation)}
                      className={cn(
                        "p-1.5 rounded-md transition-colors",
                        automation.status === "active"
                          ? "text-amber-600 hover:bg-amber-50"
                          : "text-green-600 hover:bg-green-50",
                      )}
                    >
                      {automation.status === "active" ? (
                        <Pause size={14} />
                      ) : (
                        <Play size={14} />
                      )}
                    </button>
                    <button
                      type="button"
                      onClick={() => handleDelete(automation)}
                      className="p-1.5 rounded-md text-red-500 hover:bg-red-50 transition-colors"
                    >
                      <Trash2 size={14} />
                    </button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      ) : (
        <div className="flex flex-col items-center justify-center py-20">
          <Sparkles className="w-12 h-12 text-[var(--color-tabby-muted)] opacity-30 mb-4" />
          <p className="text-sm text-[var(--color-tabby-muted)]">
            {t("automations.noAutomations")}
          </p>
          <p className="text-xs text-[var(--color-tabby-muted)] mt-1">
            {t("automations.createFirst")}
          </p>
        </div>
      )}

      <AutomationModal
        open={showModal}
        onOpenChange={setShowModal}
        editingAutomation={editingAutomation}
      />
    </div>
  );
}
