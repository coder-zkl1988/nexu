import { useUpdateChannelCapabilities } from "@/hooks/use-update-channel-capabilities";
import type {
  FeishuChannelCapabilities,
  SlackChannelCapabilities,
} from "@nexu/shared";
import {
  Check,
  ChevronDown,
  ChevronUp,
  FileText,
  Image,
  Loader2,
  Mic2,
  SlidersHorizontal,
  Video,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";

type Props =
  | {
      channelId: string;
      channelType: "slack";
      initial: Partial<SlackChannelCapabilities> | null;
    }
  | {
      channelId: string;
      channelType: "feishu";
      initial: Partial<FeishuChannelCapabilities> | null;
    };

const DEFAULT_SLACK: SlackChannelCapabilities = {
  replyToMode: "off",
  streamingMode: "partial",
  nativeTaskCards: false,
};

const DEFAULT_FEISHU: FeishuChannelCapabilities = {
  streaming: true,
  renderMode: "card",
  replyInThread: false,
  voiceReplyMode: "off",
  mediaMaxMb: 30,
};

export function ChannelCapabilitiesPanel(props: Props) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const mutation = useUpdateChannelCapabilities();
  const initialSettings = useMemo(
    () =>
      props.channelType === "slack"
        ? { ...DEFAULT_SLACK, ...props.initial }
        : { ...DEFAULT_FEISHU, ...props.initial },
    [props.channelType, props.initial],
  );
  const [draft, setDraft] = useState<
    SlackChannelCapabilities | FeishuChannelCapabilities
  >(initialSettings);

  useEffect(() => setDraft(initialSettings), [initialSettings]);

  const dirty = JSON.stringify(draft) !== JSON.stringify(initialSettings);

  async function save() {
    try {
      if (props.channelType === "slack") {
        await mutation.mutateAsync({
          channelId: props.channelId,
          channelType: "slack",
          settings: draft as SlackChannelCapabilities,
        });
      } else {
        await mutation.mutateAsync({
          channelId: props.channelId,
          channelType: "feishu",
          settings: draft as FeishuChannelCapabilities,
        });
      }
      toast.success(t("channels.capabilities.saved"));
    } catch (error: unknown) {
      toast.error(
        error instanceof Error
          ? error.message
          : t("channels.capabilities.saveFailed"),
      );
    }
  }

  return (
    <div className="mt-4 border-t border-border pt-3">
      <button
        type="button"
        className="flex w-full items-center gap-2 text-left text-[12px] font-medium text-text-primary"
        onClick={() => setOpen((current) => !current)}
        aria-expanded={open}
      >
        <SlidersHorizontal size={13} className="text-text-muted" />
        <span>{t("channels.capabilities.title")}</span>
        {props.initial === null ? (
          <span className="font-normal text-[10px] text-text-muted">
            {t("channels.capabilities.defaults")}
          </span>
        ) : null}
        {open ? (
          <ChevronUp size={13} className="ml-auto text-text-muted" />
        ) : (
          <ChevronDown size={13} className="ml-auto text-text-muted" />
        )}
      </button>

      {open ? (
        <div className="mt-3 space-y-3">
          {props.channelType === "slack" ? (
            <SlackCapabilityFields
              value={draft as SlackChannelCapabilities}
              onChange={setDraft}
              disabled={mutation.isPending}
            />
          ) : (
            <FeishuCapabilityFields
              value={draft as FeishuChannelCapabilities}
              onChange={setDraft}
              disabled={mutation.isPending}
            />
          )}

          <div className="flex items-center gap-2 pt-1">
            <button
              type="button"
              onClick={save}
              disabled={!dirty || mutation.isPending}
              className="inline-flex items-center gap-1.5 rounded-md bg-accent px-3 py-1.5 text-[11px] font-medium text-white hover:bg-accent-hover disabled:opacity-50"
            >
              {mutation.isPending ? (
                <Loader2 size={12} className="animate-spin" />
              ) : (
                <Check size={12} />
              )}
              {t("channels.capabilities.save")}
            </button>
            <button
              type="button"
              onClick={() => setDraft(initialSettings)}
              disabled={!dirty || mutation.isPending}
              className="rounded-md border border-border px-3 py-1.5 text-[11px] font-medium text-text-secondary hover:bg-surface-3 disabled:opacity-50"
            >
              {t("channels.capabilities.reset")}
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function SlackCapabilityFields({
  value,
  onChange,
  disabled,
}: {
  value: SlackChannelCapabilities;
  onChange: (value: SlackChannelCapabilities) => void;
  disabled: boolean;
}) {
  const { t } = useTranslation();
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      <SelectField
        label={t("channels.capabilities.slack.threads")}
        value={value.replyToMode}
        disabled={disabled}
        onChange={(replyToMode) =>
          onChange({
            ...value,
            replyToMode: replyToMode as SlackChannelCapabilities["replyToMode"],
          })
        }
        options={[
          ["off", t("channels.capabilities.slack.threadOff")],
          ["first", t("channels.capabilities.slack.threadFirst")],
          ["all", t("channels.capabilities.slack.threadAll")],
          ["batched", t("channels.capabilities.slack.threadBatched")],
        ]}
      />
      <SelectField
        label={t("channels.capabilities.slack.streaming")}
        value={value.streamingMode}
        disabled={disabled}
        onChange={(streamingMode) =>
          onChange({
            ...value,
            streamingMode:
              streamingMode as SlackChannelCapabilities["streamingMode"],
            nativeTaskCards:
              streamingMode === "progress" ? value.nativeTaskCards : false,
          })
        }
        options={[
          ["off", t("channels.capabilities.slack.streamOff")],
          ["partial", t("channels.capabilities.slack.streamPartial")],
          ["block", t("channels.capabilities.slack.streamBlock")],
          ["progress", t("channels.capabilities.slack.streamProgress")],
        ]}
      />
      <ToggleField
        label={t("channels.capabilities.slack.taskCards")}
        checked={value.nativeTaskCards}
        disabled={disabled || value.streamingMode !== "progress"}
        onChange={(nativeTaskCards) => onChange({ ...value, nativeTaskCards })}
      />
    </div>
  );
}

function FeishuCapabilityFields({
  value,
  onChange,
  disabled,
}: {
  value: FeishuChannelCapabilities;
  onChange: (value: FeishuChannelCapabilities) => void;
  disabled: boolean;
}) {
  const { t } = useTranslation();
  return (
    <>
      <div className="grid gap-3 sm:grid-cols-2">
        <SelectField
          label={t("channels.capabilities.feishu.renderMode")}
          value={value.renderMode}
          disabled={disabled}
          onChange={(renderMode) =>
            onChange({
              ...value,
              renderMode: renderMode as FeishuChannelCapabilities["renderMode"],
              streaming: renderMode === "raw" ? false : value.streaming,
            })
          }
          options={[
            ["card", t("channels.capabilities.feishu.cards")],
            ["auto", t("channels.capabilities.feishu.auto")],
            ["raw", t("channels.capabilities.feishu.text")],
          ]}
        />
        <SelectField
          label={t("channels.capabilities.feishu.voiceReplies")}
          value={value.voiceReplyMode}
          disabled={disabled}
          onChange={(voiceReplyMode) =>
            onChange({
              ...value,
              voiceReplyMode:
                voiceReplyMode as FeishuChannelCapabilities["voiceReplyMode"],
            })
          }
          options={[
            ["off", t("channels.capabilities.feishu.voiceOff")],
            ["inbound", t("channels.capabilities.feishu.voiceInbound")],
            ["tagged", t("channels.capabilities.feishu.voiceTagged")],
            ["always", t("channels.capabilities.feishu.voiceAlways")],
          ]}
        />
        <ToggleField
          label={t("channels.capabilities.feishu.streaming")}
          checked={value.streaming}
          disabled={disabled || value.renderMode === "raw"}
          onChange={(streaming) => onChange({ ...value, streaming })}
        />
        <ToggleField
          label={t("channels.capabilities.feishu.threads")}
          checked={value.replyInThread}
          disabled={disabled}
          onChange={(replyInThread) => onChange({ ...value, replyInThread })}
        />
        <label className="space-y-1 text-[11px] text-text-muted">
          <span>{t("channels.capabilities.feishu.mediaLimit")}</span>
          <div className="flex items-center gap-2">
            <input
              type="number"
              aria-label={t("channels.capabilities.feishu.mediaLimit")}
              min={1}
              step={1}
              value={value.mediaMaxMb}
              disabled={disabled}
              onChange={(event) =>
                onChange({
                  ...value,
                  mediaMaxMb: Math.max(1, Number(event.target.value) || 1),
                })
              }
              className="h-8 w-20 rounded-md border border-border bg-surface-0 px-2 text-[12px] text-text-primary focus:outline-none focus:ring-1 focus:ring-ring disabled:opacity-60"
            />
            <span>MB</span>
          </div>
        </label>
      </div>
      <div className="flex flex-wrap gap-x-3 gap-y-2 border-t border-border/70 pt-3 text-[10px] text-text-secondary">
        <RuntimeCapability
          icon={Mic2}
          label={t("channels.capabilities.audio")}
        />
        <RuntimeCapability
          icon={Image}
          label={t("channels.capabilities.images")}
        />
        <RuntimeCapability
          icon={FileText}
          label={t("channels.capabilities.files")}
        />
        <RuntimeCapability
          icon={Video}
          label={t("channels.capabilities.video")}
        />
      </div>
    </>
  );
}

function SelectField({
  label,
  value,
  options,
  onChange,
  disabled,
}: {
  label: string;
  value: string;
  options: Array<[value: string, label: string]>;
  onChange: (value: string) => void;
  disabled: boolean;
}) {
  return (
    <label className="space-y-1 text-[11px] text-text-muted">
      <span>{label}</span>
      <select
        value={value}
        disabled={disabled}
        onChange={(event) => onChange(event.target.value)}
        className="h-8 w-full rounded-md border border-border bg-surface-0 px-2 text-[12px] text-text-primary focus:outline-none focus:ring-1 focus:ring-ring disabled:opacity-60"
      >
        {options.map(([optionValue, optionLabel]) => (
          <option key={optionValue} value={optionValue}>
            {optionLabel}
          </option>
        ))}
      </select>
    </label>
  );
}

function ToggleField({
  label,
  checked,
  onChange,
  disabled,
}: {
  label: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
  disabled: boolean;
}) {
  return (
    <label className="flex min-h-8 items-center gap-2 text-[11px] text-text-primary">
      <input
        type="checkbox"
        checked={checked}
        onChange={(event) => onChange(event.target.checked)}
        disabled={disabled}
      />
      <span>{label}</span>
    </label>
  );
}

function RuntimeCapability({
  icon: Icon,
  label,
}: {
  icon: typeof Mic2;
  label: string;
}) {
  return (
    <span className="inline-flex items-center gap-1">
      <Icon size={11} className="text-[var(--color-success)]" />
      {label}
    </span>
  );
}
