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
  Loader2,
  Pause,
  Play,
  Plus,
  Sparkles,
  Trash2,
} from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  deleteApiV1SchedulesByScheduleId,
  getApiV1Bots,
  getApiV1Channels,
  getApiV1Schedules,
  getApiV1SchedulesByScheduleIdRuns,
  patchApiV1SchedulesByScheduleId,
  postApiV1Schedules,
} from "../../lib/api/sdk.gen";
import type {
  GetApiV1BotsResponse,
  GetApiV1ChannelsResponse,
  GetApiV1SchedulesByScheduleIdRunsResponse,
  GetApiV1SchedulesResponse,
} from "../../lib/api/types.gen";

interface ScheduleItem {
  id: string;
  botId: string;
  name: string;
  cron: string;
  timezone: string;
  prompt: string;
  enabled: boolean;
  source: "ui" | "agent";
  sessionKey?: string;
  channelType?: string;
  channelId?: string;
  createdAt: string;
  updatedAt: string;
}

const DAYS = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"] as const;
type DayKey = (typeof DAYS)[number];

type ScheduleMode = "daily" | "interval";

interface IntervalConfig {
  value: number;
  unit: "minutes" | "hours";
}

function parseIntervalCron(cron: string): IntervalConfig | null {
  const parts = cron.split(" ");
  if (parts.length < 5) return null;
  const minutePart = parts[0] ?? "*";
  // Every N minutes: */N * * * *
  if (minutePart.startsWith("*/")) {
    const v = Number.parseInt(minutePart.slice(2), 10);
    if (v > 0) return { value: v, unit: "minutes" };
  }
  // Every N hours: 0 */N * * *
  const hourPart = parts[1] ?? "*";
  if (hourPart.startsWith("*/") && (minutePart === "0" || minutePart === "0")) {
    const v = Number.parseInt(hourPart.slice(2), 10);
    if (v > 0) return { value: v, unit: "hours" };
  }
  return null;
}

function cronToTriggerText(cron: string, timezone: string): string {
  const parts = cron.split(" ");
  if (parts.length < 5) return cron;

  const interval = parseIntervalCron(cron);
  if (interval) {
    const label =
      interval.unit === "minutes"
        ? `Every ${interval.value} min`
        : `Every ${interval.value} hr`;
    return `${label} (${timezone})`;
  }

  const minute = parts[0] ?? "0";
  const hour = parts[1] ?? "9";
  const daysPart = parts[4] ?? "*";

  const timeStr = `${hour.padStart(2, "0")}:${minute.padStart(2, "0")}`;

  if (daysPart === "*") {
    return `Every day at ${timeStr} (${timezone})`;
  }

  const dayLabels: Record<string, string> = {
    "1": "Mon",
    "2": "Tue",
    "3": "Wed",
    "4": "Thu",
    "5": "Fri",
    "6": "Sat",
    "7": "Sun",
  };

  if (daysPart === "1-5") {
    return `Weekdays at ${timeStr} (${timezone})`;
  }

  if (daysPart === "0" || daysPart === "7") {
    return `Sundays at ${timeStr} (${timezone})`;
  }

  const days = daysPart.split(",").map((d) => dayLabels[d.trim()] ?? d);
  if (days.length <= 3 && days.every((d) => d.length <= 4)) {
    return `${days.join(", ")} at ${timeStr} (${timezone})`;
  }

  return `Cron: ${cron}`;
}

function buildCronExpression(time: string, selectedDays: Set<DayKey>): string {
  const [hours, minutes] = time.split(":");
  const dayMap: Record<DayKey, string> = {
    mon: "1",
    tue: "2",
    wed: "3",
    thu: "4",
    fri: "5",
    sat: "6",
    sun: "7",
  };

  let daysPart = "*";
  if (selectedDays.size > 0 && selectedDays.size < 7) {
    const sorted = [...selectedDays]
      .map((d) => Number(dayMap[d]))
      .sort((a, b) => a - b);
    daysPart = sorted.join(",");
  }

  return `${minutes} ${hours} * * ${daysPart}`;
}

function parseCronDays(daysPart: string): Set<DayKey> {
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

  if (!daysPart || daysPart === "*") return selected;

  if (daysPart.includes("-")) {
    const range = daysPart.split("-").map(Number);
    const start = range[0] ?? 1;
    const end = range[1] ?? 5;
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

  return selected;
}

function AutomationModal({
  open,
  onOpenChange,
  editingSchedule,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  editingSchedule: ScheduleItem | null;
  onSaved: () => void;
}) {
  const { t } = useTranslation();
  const isEditing = editingSchedule !== null;

  const [bots, setBots] = useState<Array<{ id: string; name: string }>>([]);
  const [loadingBots, setLoadingBots] = useState(false);
  const [channels, setChannels] = useState<
    Array<{ channelType: string; accountId?: string; botId?: string }>
  >([]);
  const [saving, setSaving] = useState(false);

  const [name, setName] = useState("");
  const [botId, setBotId] = useState("");
  const [channelType, setChannelType] = useState("");
  const [channelId, setChannelId] = useState<string | undefined>(undefined);
  const [scheduleMode, setScheduleMode] = useState<ScheduleMode>("daily");
  const [time, setTime] = useState("09:00");
  const [selectedDays, setSelectedDays] = useState<Set<DayKey>>(new Set());
  const [intervalValue, setIntervalValue] = useState(30);
  const [intervalUnit, setIntervalUnit] = useState<"minutes" | "hours">(
    "minutes",
  );
  const [prompt, setPrompt] = useState("");
  const [enabled, setEnabled] = useState(true);
  const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;

  useEffect(() => {
    if (open) {
      setLoadingBots(true);
      getApiV1Bots()
        .then((res: { data?: GetApiV1BotsResponse }) => {
          if (res.data?.bots) {
            const seen = new Map<string, string>();
            const activeBots: Array<{ id: string; name: string }> = [];
            for (const b of res.data.bots) {
              if (b.status !== "active") continue;
              if (seen.has(b.name)) continue;
              seen.set(b.name, b.id);
              activeBots.push({ id: b.id, name: b.name });
            }
            setBots(activeBots);
          }
        })
        .finally(() => setLoadingBots(false));

      getApiV1Channels()
        .then((res: { data?: GetApiV1ChannelsResponse }) => {
          if (res.data?.channels) {
            const connected = res.data.channels
              .filter((ch) => ch.status === "connected")
              .map((ch) => ({
                channelType: ch.channelType,
                accountId: ch.accountId as string | undefined,
                botId: ch.botId,
              }));
            setChannels(connected);
          }
        })
        .catch(() => {});
    }
  }, [open]);

  useEffect(() => {
    if (editingSchedule) {
      setName(editingSchedule.name);
      setBotId(editingSchedule.botId);
      setChannelType(editingSchedule.channelType ?? "");
      setChannelId(editingSchedule.channelId ?? undefined);
      setPrompt(editingSchedule.prompt);
      setEnabled(editingSchedule.enabled);

      const interval = parseIntervalCron(editingSchedule.cron);
      if (interval) {
        setScheduleMode("interval");
        setIntervalValue(interval.value);
        setIntervalUnit(interval.unit);
      } else {
        setScheduleMode("daily");
        const parts = editingSchedule.cron.split(" ");
        if (parts.length >= 5) {
          const minute = parts[0] ?? "0";
          const hour = parts[1] ?? "9";
          setTime(`${hour.padStart(2, "0")}:${minute.padStart(2, "0")}`);
          setSelectedDays(parseCronDays(parts[4] ?? "*"));
        }
      }
    } else {
      setName("");
      setBotId("");
      setPrompt("");
      setEnabled(true);
      setScheduleMode("daily");
      setTime("09:00");
      setSelectedDays(new Set());
      setIntervalValue(30);
      setIntervalUnit("minutes");
    }
  }, [editingSchedule]);

  function resetForm() {
    setName("");
    setBotId("");
    setChannelType("");
    setChannelId(undefined);
    setScheduleMode("daily");
    setTime("09:00");
    setSelectedDays(new Set());
    setIntervalValue(30);
    setIntervalUnit("minutes");
    setPrompt("");
    setEnabled(true);
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

  async function handleSubmit() {
    if (saving) return;
    setSaving(true);
    try {
      const cron =
        scheduleMode === "interval"
          ? intervalUnit === "minutes"
            ? `*/${intervalValue} * * * *`
            : `0 */${intervalValue} * * *`
          : buildCronExpression(time, selectedDays);
      if (isEditing && editingSchedule) {
        await patchApiV1SchedulesByScheduleId({
          body: {
            name,
            cron,
            timezone,
            prompt,
            enabled,
            channelType: channelType || undefined,
            channelId: channelId || undefined,
          },
          path: { scheduleId: editingSchedule.id },
        });
      } else {
        await postApiV1Schedules({
          body: {
            botId,
            name,
            cron,
            timezone,
            prompt,
            enabled,
            channelType: channelType || undefined,
            channelId: channelId || undefined,
          },
        });
      }
      onSaved();
      handleOpenChange(false);
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="w-[600px] h-[640px] flex flex-col p-0 bg-white rounded-xl">
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
                onChange={(e) => {
                  setBotId(e.target.value);
                  // Reset channel selection when bot changes — channels are bound to specific bots
                  if (!isEditing) {
                    setChannelType("");
                    setChannelId(undefined);
                  }
                }}
                disabled={loadingBots || isEditing}
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

          {/* Delivery channel — only show channels bound to the selected bot */}
          {!isEditing && botId && channels.some((ch) => ch.botId === botId) && (
            <div>
              <Label className="block text-[13px] font-medium text-[var(--color-tabby-foreground)] mb-1.5">
                {t("automations.modal.deliveryChannel")}
              </Label>
              <div className="relative">
                <select
                  value={
                    channelId ? `${channelType}:${channelId}` : channelType
                  }
                  onChange={(e) => {
                    const val = e.target.value;
                    if (!val || !val.includes(":")) {
                      setChannelType(val);
                      setChannelId(undefined);
                    } else {
                      const [type, ...rest] = val.split(":");
                      setChannelType(type ?? "");
                      setChannelId(rest.join(":") || undefined);
                    }
                  }}
                  className="block w-full pl-3 pr-10 py-2 text-[13px] border border-[var(--color-tabby-border)] rounded-lg bg-white text-[var(--color-tabby-foreground)] focus:ring-1 focus:ring-[var(--color-tabby-foreground)] focus:border-[var(--color-tabby-foreground)] appearance-none"
                >
                  <option value="">
                    {t("automations.modal.deliveryChannelPlaceholder")}
                  </option>
                  {channels
                    .filter((ch) => ch.botId === botId)
                    .map((ch) => {
                      const compoundKey = ch.accountId
                        ? `${ch.channelType}:${ch.accountId}`
                        : ch.channelType;
                      return (
                        <option key={compoundKey} value={compoundKey}>
                          {ch.channelType}
                          {ch.accountId ? ` - ${ch.accountId}` : ""}
                        </option>
                      );
                    })}
                </select>
                <div className="pointer-events-none absolute inset-y-0 right-0 flex items-center px-3 text-[var(--color-tabby-muted)]">
                  <ChevronDown size={16} />
                </div>
              </div>
            </div>
          )}

          {/* Schedule */}
          <div>
            <Label className="block text-[13px] font-medium text-[var(--color-tabby-foreground)] mb-2.5">
              {t("automations.modal.schedule")}
            </Label>

            {/* Mode tabs */}
            <div className="inline-flex items-center gap-1 p-1 rounded-full bg-neutral-100 mb-3">
              {(
                [
                  { id: "daily" as const, label: t("automations.modal.daily") },
                  {
                    id: "interval" as const,
                    label: t("automations.modal.interval"),
                  },
                ] as const
              ).map((tab) => (
                <button
                  key={tab.id}
                  type="button"
                  onClick={() => setScheduleMode(tab.id)}
                  className={cn(
                    "px-4 py-1.5 rounded-full text-[13px] font-medium transition-all",
                    scheduleMode === tab.id
                      ? "bg-white text-[var(--color-tabby-foreground)] shadow-[var(--shadow-rest)]"
                      : "text-[var(--color-tabby-muted)] hover:text-[var(--color-tabby-foreground)]",
                  )}
                >
                  {tab.label}
                </button>
              ))}
            </div>

            {scheduleMode === "daily" ? (
              <div className="space-y-3">
                {/* Time picker */}
                <div className="flex items-center gap-3">
                  <input
                    type="time"
                    value={time}
                    onChange={(e) => setTime(e.target.value)}
                    className="block w-[120px] px-3 py-1.5 text-[13px] border border-[var(--color-tabby-border)] rounded-lg bg-white text-[var(--color-tabby-foreground)] focus:outline-none focus:ring-2 focus:ring-black focus:border-black [&::-webkit-calendar-picker-indicator]:opacity-50 [&::-webkit-calendar-picker-indicator]:hover:opacity-100"
                  />
                  <span className="text-[12px] text-[var(--color-tabby-muted)]">
                    {t("automations.modal.timezone")}: {timezone}
                  </span>
                </div>

                {/* Days of week */}
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
            ) : (
              <div className="flex items-center gap-2">
                <span className="text-[13px] text-[var(--color-tabby-muted)]">
                  {t("automations.modal.every")}
                </span>
                <input
                  type="number"
                  min={1}
                  max={1440}
                  value={intervalValue}
                  onChange={(e) =>
                    setIntervalValue(
                      Math.max(1, Math.min(1440, Number(e.target.value) || 1)),
                    )
                  }
                  className="w-[80px] px-3 py-1.5 text-[13px] text-center border border-[var(--color-tabby-border)] rounded-lg bg-white text-[var(--color-tabby-foreground)] focus:outline-none focus:ring-2 focus:ring-black focus:border-black"
                />
                <div className="relative">
                  <select
                    value={intervalUnit}
                    onChange={(e) =>
                      setIntervalUnit(e.target.value as "minutes" | "hours")
                    }
                    className="block w-[100px] pl-3 pr-8 py-1.5 text-[13px] border border-[var(--color-tabby-border)] rounded-lg bg-white text-[var(--color-tabby-foreground)] focus:ring-1 focus:ring-[var(--color-tabby-foreground)] focus:border-[var(--color-tabby-foreground)] appearance-none"
                  >
                    <option value="minutes">
                      {t("automations.modal.minutes")}
                    </option>
                    <option value="hours">
                      {t("automations.modal.hours")}
                    </option>
                  </select>
                  <div className="pointer-events-none absolute inset-y-0 right-0 flex items-center px-2 text-[var(--color-tabby-muted)]">
                    <ChevronDown size={14} />
                  </div>
                </div>
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

          {/* Enabled toggle */}
          <div className="flex items-center">
            <Switch size="sm" checked={enabled} onCheckedChange={setEnabled} />
            <Label className="ml-3 text-[13px] font-medium text-[var(--color-tabby-foreground)] cursor-pointer">
              {t("automations.modal.enabled")}
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
            type="button"
            onClick={handleSubmit}
            disabled={saving}
            className="px-5 py-2 text-[13px] font-medium text-white bg-black rounded-lg hover:opacity-90 transition-opacity focus:outline-none focus:ring-2 focus:ring-black focus:ring-offset-2 disabled:opacity-50"
          >
            {saving
              ? t("automations.modal.saving")
              : isEditing
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
  const [showModal, setShowModal] = useState(false);
  const [editingSchedule, setEditingSchedule] = useState<ScheduleItem | null>(
    null,
  );
  const [schedules, setSchedules] = useState<ScheduleItem[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchSchedules = useCallback(async () => {
    try {
      const res = await getApiV1Schedules();
      const data = res.data as GetApiV1SchedulesResponse | undefined;
      const list = data?.schedules ?? [];
      setSchedules(
        list.map((s) => ({
          id: s.id,
          botId: s.botId,
          name: s.name,
          cron: s.cron,
          timezone: s.timezone ?? "UTC",
          prompt: s.prompt,
          enabled: s.enabled ?? true,
          source: (s.source as "ui" | "agent") ?? "ui",
          sessionKey: s.sessionKey as string | undefined,
          channelType: s.channelType as string | undefined,
          channelId: s.channelId as string | undefined,
          createdAt: s.createdAt,
          updatedAt: s.updatedAt,
        })),
      );
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchSchedules();
  }, [fetchSchedules]);

  const filtered = schedules.filter((s) => {
    if (filter === "all") return true;
    if (filter === "active") return s.enabled;
    return !s.enabled;
  });

  const activeCount = schedules.filter((s) => s.enabled).length;
  const pausedCount = schedules.filter((s) => !s.enabled).length;

  function handleNew() {
    setEditingSchedule(null);
    setShowModal(true);
  }

  function handleEdit(schedule: ScheduleItem) {
    setEditingSchedule(schedule);
    setShowModal(true);
  }

  async function handleToggleStatus(schedule: ScheduleItem) {
    await patchApiV1SchedulesByScheduleId({
      body: { enabled: !schedule.enabled },
      path: { scheduleId: schedule.id },
    });
    fetchSchedules();
  }

  async function handleDelete(schedule: ScheduleItem) {
    await deleteApiV1SchedulesByScheduleId({
      path: { scheduleId: schedule.id },
    });
    fetchSchedules();
  }

  const [expandedRuns, setExpandedRuns] = useState<Set<string>>(new Set());
  const [runsData, setRunsData] = useState<
    Record<string, GetApiV1SchedulesByScheduleIdRunsResponse | null>
  >({});
  const [runsLoading, setRunsLoading] = useState<Set<string>>(new Set());

  async function toggleRuns(scheduleId: string) {
    setExpandedRuns((prev) => {
      const next = new Set(prev);
      if (next.has(scheduleId)) {
        next.delete(scheduleId);
      } else {
        next.add(scheduleId);
        if (!(scheduleId in runsData)) {
          setRunsLoading((s) => new Set(s).add(scheduleId));
          getApiV1SchedulesByScheduleIdRuns({
            path: { scheduleId },
            query: { limit: 20 },
          })
            .then((res) => {
              setRunsData((d) => ({
                ...d,
                [scheduleId]:
                  res.data as GetApiV1SchedulesByScheduleIdRunsResponse,
              }));
            })
            .catch(() => {
              setRunsData((d) => ({ ...d, [scheduleId]: null }));
            })
            .finally(() => {
              setRunsLoading((s) => {
                const ns = new Set(s);
                ns.delete(scheduleId);
                return ns;
              });
            });
        }
      }
      return next;
    });
  }

  return (
    <div className="h-full flex flex-col">
      {/* Fixed header area */}
      <div className="shrink-0 px-6 pt-4">
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
                  count: schedules.length,
                },
                {
                  id: "active" as const,
                  label: t("automations.active"),
                  count: activeCount,
                },
                {
                  id: "paused" as const,
                  label: t("automations.paused"),
                  count: pausedCount,
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
      </div>

      {/* Scrollable content area */}
      <div className="flex-1 overflow-y-auto px-6 pb-4">
        {loading ? (
          <div className="flex items-center justify-center py-20">
            <Loader2 className="w-8 h-8 animate-spin text-[var(--color-tabby-muted)]" />
          </div>
        ) : filtered.length > 0 ? (
          <div className="grid gap-4 items-start [grid-template-columns:repeat(auto-fill,minmax(max(220px,calc(33.333%-11px)),1fr))]">
            {filtered.map((schedule) => (
              <div
                key={schedule.id}
                className="bg-white rounded-xl border border-[var(--color-tabby-border)] p-4 hover:border-[var(--color-tabby-foreground)]/30 transition-colors"
              >
                {/* Header */}
                <div className="flex items-start gap-3 mb-3">
                  <div className="w-10 h-10 rounded-xl flex items-center justify-center shrink-0 bg-neutral-100 text-neutral-500">
                    <Clock className="w-5 h-5" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-0.5">
                      <span className="text-[14px] font-semibold text-[var(--color-tabby-foreground)] truncate">
                        {schedule.name}
                      </span>
                      <span
                        className={cn(
                          "text-[10px] px-1.5 py-0.5 rounded-full font-medium shrink-0",
                          schedule.enabled
                            ? "bg-green-50 text-green-600"
                            : "bg-amber-50 text-amber-600",
                        )}
                      >
                        {schedule.enabled
                          ? t("automations.active")
                          : t("automations.paused")}
                      </span>
                      {schedule.source === "agent" && (
                        <span className="text-[10px] px-1.5 py-0.5 rounded-full font-medium shrink-0 bg-blue-50 text-blue-600">
                          {t("automations.agentCreated")}
                        </span>
                      )}
                    </div>
                    <p className="text-[12px] text-[var(--color-tabby-muted)] line-clamp-1">
                      {schedule.prompt}
                    </p>
                  </div>
                </div>

                {/* Trigger info */}
                <div className="space-y-1.5 mb-3">
                  <div className="flex items-center gap-2 text-[12px]">
                    <Clock className="w-3.5 h-3.5 text-[var(--color-tabby-muted)] shrink-0" />
                    <span className="text-[var(--color-tabby-foreground)] truncate">
                      {cronToTriggerText(schedule.cron, schedule.timezone)}
                    </span>
                  </div>
                </div>

                {/* Run history toggle */}
                <button
                  type="button"
                  onClick={() => toggleRuns(schedule.id)}
                  className="flex items-center gap-1 text-[11px] text-[var(--color-tabby-muted)] hover:text-[var(--color-tabby-foreground)] transition-colors mb-1"
                >
                  <Clock size={12} />
                  {t("automations.detail.history")}
                  <ChevronDown
                    size={12}
                    className={cn(
                      "transition-transform",
                      expandedRuns.has(schedule.id) && "rotate-180",
                    )}
                  />
                </button>

                {/* Run history list */}
                {expandedRuns.has(schedule.id) && (
                  <div className="mb-3 border border-[var(--color-tabby-border)] rounded-lg divide-y divide-[var(--color-tabby-border)] max-h-[200px] overflow-y-auto">
                    {runsLoading.has(schedule.id) ? (
                      <div className="flex items-center justify-center py-4">
                        <Loader2
                          size={14}
                          className="animate-spin text-[var(--color-tabby-muted)]"
                        />
                      </div>
                    ) : runsData[schedule.id] === null ? (
                      <div className="text-[11px] text-[var(--color-tabby-muted)] text-center py-4">
                        {t("automations.detail.historyError")}
                      </div>
                    ) : (runsData[schedule.id]?.entries?.length ?? 0) === 0 ? (
                      <div className="text-[11px] text-[var(--color-tabby-muted)] text-center py-4">
                        {t("automations.detail.noHistory")}
                      </div>
                    ) : (
                      runsData[schedule.id]?.entries?.map((run) => (
                        <div
                          key={run.ts}
                          className="flex items-center gap-2 px-3 py-2 text-[11px]"
                        >
                          <span
                            className={cn(
                              "w-1.5 h-1.5 rounded-full shrink-0",
                              run.status === "ok"
                                ? "bg-green-500"
                                : run.status === "error"
                                  ? "bg-red-500"
                                  : "bg-neutral-300",
                            )}
                          />
                          <span className="text-[var(--color-tabby-muted)] shrink-0 w-[120px]">
                            {run.runAtMs
                              ? new Date(run.runAtMs).toLocaleString()
                              : new Date(run.ts).toLocaleString()}
                          </span>
                          {run.durationMs !== undefined && (
                            <span className="text-[var(--color-tabby-muted)] shrink-0">
                              {run.durationMs < 1000
                                ? `${run.durationMs}ms`
                                : `${(run.durationMs / 1000).toFixed(1)}s`}
                            </span>
                          )}
                          <span className="text-[var(--color-tabby-muted)] truncate flex-1 min-w-0 text-right">
                            {run.error
                              ? run.error.slice(0, 80)
                              : (run.summary?.slice(0, 80) ?? "")}
                          </span>
                        </div>
                      ))
                    )}
                  </div>
                )}

                {/* Footer */}
                <div className="flex items-center justify-between pt-3 border-t border-[var(--color-tabby-border)]">
                  <span className="text-[11px] text-[var(--color-tabby-muted)]">
                    {schedule.channelType
                      ? `# ${schedule.channelType}`
                      : schedule.botId}
                  </span>
                  <div className="flex items-center gap-1">
                    <button
                      type="button"
                      onClick={() => handleEdit(schedule)}
                      disabled={schedule.source === "agent"}
                      className={cn(
                        "p-1.5 rounded-md transition-colors",
                        schedule.source === "agent"
                          ? "text-[var(--color-tabby-border)] cursor-not-allowed"
                          : "text-[var(--color-tabby-muted)] hover:text-[var(--color-tabby-foreground)] hover:bg-neutral-100",
                      )}
                    >
                      <Edit3 size={14} />
                    </button>
                    <button
                      type="button"
                      onClick={() => handleToggleStatus(schedule)}
                      className={cn(
                        "p-1.5 rounded-md transition-colors",
                        schedule.enabled
                          ? "text-amber-600 hover:bg-amber-50"
                          : "text-green-600 hover:bg-green-50",
                      )}
                    >
                      {schedule.enabled ? (
                        <Pause size={14} />
                      ) : (
                        <Play size={14} />
                      )}
                    </button>
                    <button
                      type="button"
                      onClick={() => handleDelete(schedule)}
                      className="p-1.5 rounded-md text-red-500 hover:bg-red-50 transition-colors"
                    >
                      <Trash2 size={14} />
                    </button>
                  </div>
                </div>
              </div>
            ))}
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
          editingSchedule={editingSchedule}
          onSaved={fetchSchedules}
        />
      </div>
    </div>
  );
}
