/**
 * Small UI vocabulary shared by the four xhs-ops A2UI components: card shell,
 * fields, chip editor, buttons, status dots, Chinese label maps and the device
 * list hook. Styling follows XHSBatchTable / TeamRunCard (CSS variables +
 * Tailwind utility classes) so the cards sit naturally in the chat thread.
 */
import { useQuery } from "@tanstack/react-query";
import { X } from "lucide-react";
import { type ReactNode, useState } from "react";
import { getApiV1Devices } from "../../../../../lib/api/sdk.gen";
import type {
  XhsOpsAnomalyType,
  XhsOpsChunkStatus,
  XhsOpsRunStatus,
} from "./xhs-ops-types";

// ── Class name constants ───────────────────────────────────────

export const inputClass =
  "h-7 w-full min-w-0 rounded-md border border-border bg-surface-1 px-2 text-[12px] text-text-primary outline-none placeholder:text-text-tertiary focus:border-[var(--color-brand-primary)] disabled:opacity-60";

export const textareaClass =
  "w-full min-w-0 resize-y rounded-md border border-border bg-surface-1 px-2 py-1.5 text-[12px] leading-5 text-text-primary outline-none placeholder:text-text-tertiary focus:border-[var(--color-brand-primary)] disabled:opacity-60";

export const selectClass =
  "h-7 w-full min-w-0 rounded-md border border-border bg-surface-1 px-1.5 text-[12px] text-text-primary outline-none focus:border-[var(--color-brand-primary)] disabled:opacity-60";

const primaryButtonClass =
  "inline-flex h-7 shrink-0 items-center justify-center gap-1 rounded-md border border-[var(--color-accent)] bg-[var(--color-accent)] px-3 text-[12px] font-semibold text-[var(--color-accent-fg)] hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50";

const secondaryButtonClass =
  "inline-flex h-7 shrink-0 items-center justify-center gap-1 rounded-md border border-border bg-surface-1 px-2.5 text-[12px] font-medium text-text-secondary hover:bg-surface-2 hover:text-text-primary disabled:cursor-not-allowed disabled:opacity-50";

const dangerButtonClass =
  "inline-flex h-7 shrink-0 items-center justify-center gap-1 rounded-md border border-red-500/40 bg-surface-1 px-2.5 text-[12px] font-medium text-red-600 hover:bg-red-500/10 disabled:cursor-not-allowed disabled:opacity-50";

// ── Layout primitives ─────────────────────────────────────────

export function CardShell({
  title,
  subtitle,
  actions,
  children,
  footer,
  testId,
}: {
  title: ReactNode;
  subtitle?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
  testId?: string;
}) {
  return (
    <div
      data-xhs-ops-card={testId}
      className="flex w-full max-w-[720px] flex-col overflow-hidden rounded-xl border border-border bg-surface-1 text-text-primary"
    >
      <div className="flex items-start justify-between gap-3 border-b border-border px-4 py-2.5">
        <div className="min-w-0">
          <div className="truncate text-[14px] font-medium">{title}</div>
          {subtitle ? (
            <div className="mt-0.5 text-[11px] text-text-tertiary">
              {subtitle}
            </div>
          ) : null}
        </div>
        {actions ? (
          <div className="flex shrink-0 items-center gap-2">{actions}</div>
        ) : null}
      </div>
      <div className="flex flex-col gap-3 px-4 py-3">{children}</div>
      {footer ? (
        <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border px-4 py-2.5">
          {footer}
        </div>
      ) : null}
    </div>
  );
}

export function SectionTitle({
  children,
  hint,
}: {
  children: ReactNode;
  hint?: ReactNode;
}) {
  return (
    <div className="flex items-baseline gap-2">
      <span className="text-[12px] font-semibold text-text-primary">
        {children}
      </span>
      {hint ? (
        <span className="text-[11px] text-text-tertiary">{hint}</span>
      ) : null}
    </div>
  );
}

export function Field({
  label,
  children,
  className,
}: {
  label: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    // biome-ignore lint/a11y/noLabelWithoutControl: wraps its control as a child
    <label className={`flex min-w-0 flex-col gap-1 ${className ?? ""}`}>
      <span className="text-[11px] text-text-secondary">{label}</span>
      {children}
    </label>
  );
}

export function ErrorLine({ message }: { message: string | null }) {
  if (!message) return null;
  return (
    <div
      role="alert"
      className="rounded-md border border-red-500/20 bg-red-500/5 px-2.5 py-1.5 text-[12px] text-red-600"
    >
      {message}
    </div>
  );
}

export function HintLine({ children }: { children: ReactNode }) {
  return <div className="text-[11px] text-text-tertiary">{children}</div>;
}

export function PrimaryButton({
  children,
  onClick,
  disabled,
  title,
}: {
  children: ReactNode;
  onClick: () => void;
  disabled?: boolean;
  title?: string;
}) {
  return (
    <button
      type="button"
      className={primaryButtonClass}
      onClick={onClick}
      disabled={disabled}
      title={title}
    >
      {children}
    </button>
  );
}

export function SecondaryButton({
  children,
  onClick,
  disabled,
  title,
  danger,
}: {
  children: ReactNode;
  onClick: () => void;
  disabled?: boolean;
  title?: string;
  danger?: boolean;
}) {
  return (
    <button
      type="button"
      className={danger ? dangerButtonClass : secondaryButtonClass}
      onClick={onClick}
      disabled={disabled}
      title={title}
    >
      {children}
    </button>
  );
}

export function NumberInput({
  value,
  onChange,
  min,
  max,
  disabled,
  ariaLabel,
  className,
}: {
  value: number;
  onChange: (next: number) => void;
  min: number;
  max: number;
  disabled?: boolean;
  ariaLabel?: string;
  className?: string;
}) {
  return (
    <input
      type="number"
      inputMode="numeric"
      className={`${inputClass} ${className ?? ""}`}
      value={Number.isFinite(value) ? value : ""}
      min={min}
      max={max}
      disabled={disabled}
      aria-label={ariaLabel}
      onChange={(e) => {
        const n = Number(e.target.value);
        if (e.target.value === "" || !Number.isFinite(n)) {
          onChange(min);
          return;
        }
        onChange(Math.min(max, Math.max(min, Math.round(n))));
      }}
    />
  );
}

/**
 * Chip list editor: shows the current values as removable chips; typing then
 * Enter / comma / blur adds one or more values (split on , ， 、 and newlines).
 */
export function ChipInput({
  value,
  onChange,
  placeholder,
  disabled,
  ariaLabel,
}: {
  value: string[];
  onChange: (next: string[]) => void;
  placeholder?: string;
  disabled?: boolean;
  ariaLabel?: string;
}) {
  const [draft, setDraft] = useState("");

  const commit = () => {
    const parts = draft
      .split(/[,，、\n]/)
      .map((p) => p.trim())
      .filter((p) => p.length > 0 && !value.includes(p));
    if (parts.length > 0) onChange([...value, ...parts]);
    setDraft("");
  };

  return (
    <div
      className={`flex min-h-7 w-full flex-wrap items-center gap-1 rounded-md border border-border bg-surface-1 px-1.5 py-1 ${disabled ? "opacity-60" : ""}`}
    >
      {value.map((chip) => (
        <span
          key={chip}
          className="inline-flex max-w-full items-center gap-1 rounded-full bg-surface-2 px-2 py-0.5 text-[11px] text-text-primary"
        >
          <span className="truncate">{chip}</span>
          {!disabled ? (
            <button
              type="button"
              aria-label={`移除 ${chip}`}
              className="shrink-0 rounded-full text-text-tertiary hover:text-text-primary"
              onClick={() => onChange(value.filter((v) => v !== chip))}
            >
              <X size={11} />
            </button>
          ) : null}
        </span>
      ))}
      <input
        className="h-5 min-w-[80px] flex-1 bg-transparent text-[12px] text-text-primary outline-none placeholder:text-text-tertiary"
        value={draft}
        placeholder={value.length === 0 ? placeholder : ""}
        disabled={disabled}
        aria-label={ariaLabel}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === ",") {
            e.preventDefault();
            commit();
          } else if (
            e.key === "Backspace" &&
            draft === "" &&
            value.length > 0
          ) {
            onChange(value.slice(0, -1));
          }
        }}
      />
    </div>
  );
}

// ── Status vocabulary ─────────────────────────────────────────

export const RUN_STATUS_LABEL: Record<XhsOpsRunStatus, string> = {
  planned: "已计划",
  running: "执行中",
  completed: "已完成",
  failed: "失败",
  cancelled: "已取消",
  interrupted: "已中断",
};

export const CHUNK_STATUS_LABEL: Record<XhsOpsChunkStatus, string> = {
  pending: "待执行",
  running: "执行中",
  completed: "完成",
  failed: "失败",
  skipped: "跳过",
  cancelled: "取消",
};

export const ANOMALY_LABEL: Record<XhsOpsAnomalyType, string> = {
  no_results: "无搜索结果",
  load_failed: "加载失败",
  login_required: "需要登录",
  account_restricted: "账号受限",
  rate_limited: "操作频繁",
  content_mismatch: "内容不匹配",
  interrupted: "执行中断",
  other: "其他",
};

export function runStatusLabel(status: string): string {
  return (RUN_STATUS_LABEL as Record<string, string>)[status] ?? status;
}

export function chunkStatusLabel(status: string): string {
  return (CHUNK_STATUS_LABEL as Record<string, string>)[status] ?? status;
}

export function anomalyLabel(type: string): string {
  return (ANOMALY_LABEL as Record<string, string>)[type] ?? type;
}

export function chunkDotClass(status: XhsOpsChunkStatus | string): string {
  switch (status) {
    case "completed":
      return "bg-emerald-500";
    case "running":
      return "bg-sky-500 animate-pulse";
    case "failed":
      return "bg-red-500";
    case "skipped":
    case "cancelled":
      return "bg-amber-400";
    default:
      return "bg-border";
  }
}

export function runStatusTextClass(status: XhsOpsRunStatus | string): string {
  switch (status) {
    case "completed":
      return "text-emerald-600";
    case "running":
    case "planned":
      return "text-sky-600";
    case "failed":
      return "text-red-600";
    default:
      return "text-amber-600";
  }
}

export function StatusDot({
  status,
  title,
}: {
  status: XhsOpsChunkStatus | string;
  title?: string;
}) {
  return (
    <span
      title={title}
      className={`inline-block h-2 w-2 shrink-0 rounded-full ${chunkDotClass(status)}`}
    />
  );
}

// ── Time helpers ─────────────────────────────────────────────

export function formatClock(iso: string | number | null | undefined): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

export function formatDurationMs(ms: number | null | undefined): string {
  if (ms === null || ms === undefined || !Number.isFinite(ms)) return "—";
  if (ms < 60_000) return `${Math.round(ms / 1000)} 秒`;
  const minutes = Math.floor(ms / 60_000);
  const seconds = Math.round((ms % 60_000) / 1000);
  return seconds > 0 ? `${minutes} 分 ${seconds} 秒` : `${minutes} 分`;
}

// ── Devices ──────────────────────────────────────────────────

export interface XhsOpsDevice {
  deviceId: string;
  name?: string;
  model?: string;
  status: "idle" | "busy" | "error";
  lastSeen: number;
}

/** A phone that has not reported in for this long is shown as offline. */
const DEVICE_OFFLINE_AFTER_MS = 90_000;

export type DeviceOnlineState = "online" | "busy" | "offline";

export function deviceOnlineState(device: XhsOpsDevice): DeviceOnlineState {
  if (Date.now() - device.lastSeen > DEVICE_OFFLINE_AFTER_MS) return "offline";
  if (device.status === "busy") return "busy";
  return "online";
}

export const DEVICE_STATE_LABEL: Record<DeviceOnlineState, string> = {
  online: "在线",
  busy: "忙碌",
  offline: "离线",
};

export function deviceDisplayName(device: XhsOpsDevice): string {
  return device.name?.trim() || device.model?.trim() || device.deviceId;
}

/** Connected phones, refreshed every 10s (same cadence as XHSBatchTable). */
export function useXhsOpsDevices(): {
  devices: XhsOpsDevice[];
  error: string | null;
} {
  const { data, error } = useQuery({
    queryKey: ["devices"],
    queryFn: async () => {
      const { data: d, error: e } = await getApiV1Devices();
      if (e || !d) throw new Error("设备列表加载失败");
      return d;
    },
    refetchInterval: 10_000,
  });
  return {
    devices: (data?.devices ?? []) as XhsOpsDevice[],
    error: error ? "设备列表加载失败，稍后自动重试" : null,
  };
}

// ── Prop access ───────────────────────────────────────────────

/**
 * Read one top-level prop off the A2UI component, resolving `{path}` data
 * bindings the same way built-in components do.
 */
export function readProp<T = unknown>(
  comp: unknown,
  resolve: <V>(val: V) => unknown,
  key: string,
): T | undefined {
  const raw = (comp as Record<string, unknown>)[key];
  if (raw === undefined || raw === null) return undefined;
  return resolve(raw) as T;
}
