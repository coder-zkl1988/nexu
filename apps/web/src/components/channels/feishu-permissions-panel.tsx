import { useUpdateFeishuPermissions } from "@/hooks/use-update-feishu-permissions";
import type { FeishuPermissions, FeishuPolicy } from "@nexu/shared";
import { useQuery } from "@tanstack/react-query";
import { ChevronDown, ChevronUp, HelpCircle, Loader2, X } from "lucide-react";
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { getApiV1ChannelsByChannelIdFeishuDmPeers } from "../../../lib/api/sdk.gen";

const DEFAULTS: FeishuPermissions = {
  requireMention: true,
  dmPolicy: "open",
  groupPolicy: "open",
  allowFrom: [],
  browserOwnerIds: [],
};

/**
 * Draft shape accepted as input — matches the SDK-generated type where every
 * field is optional. Normalized to a full {@link FeishuPermissions} via
 * {@link normalize} before use.
 */
export type FeishuPermissionsDraft = {
  requireMention?: boolean;
  dmPolicy?: FeishuPolicy;
  groupPolicy?: FeishuPolicy;
  allowFrom?: string[];
  browserOwnerIds?: string[];
};

function normalize(input: FeishuPermissionsDraft | null): FeishuPermissions {
  if (input === null) return DEFAULTS;
  return {
    requireMention: input.requireMention ?? DEFAULTS.requireMention,
    dmPolicy: input.dmPolicy ?? DEFAULTS.dmPolicy,
    groupPolicy: input.groupPolicy ?? DEFAULTS.groupPolicy,
    allowFrom: input.allowFrom ?? DEFAULTS.allowFrom,
    browserOwnerIds: input.browserOwnerIds ?? DEFAULTS.browserOwnerIds,
  };
}

type Props = {
  channelId: string;
  initial: FeishuPermissionsDraft | null;
};

export function FeishuPermissionsPanel({ channelId, initial }: Props) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const baseline = useMemo(() => normalize(initial), [initial]);
  const [draft, setDraft] = useState<FeishuPermissions>(baseline);
  const mutation = useUpdateFeishuPermissions();
  const dirty = useMemo(
    () => JSON.stringify(draft) !== JSON.stringify(baseline),
    [draft, baseline],
  );
  const needsAllowlist =
    draft.dmPolicy === "allowlist" || draft.groupPolicy === "allowlist";

  async function save() {
    try {
      await mutation.mutateAsync({ channelId, perms: draft });
      toast.success(t("feishu.permissions.saved"));
    } catch (error) {
      const msg =
        error instanceof Error
          ? error.message
          : t("feishu.permissions.saveFailed");
      toast.error(msg);
    }
  }

  function reset() {
    setDraft(baseline);
  }

  const controlsDisabled = mutation.isPending;

  return (
    <div className="mt-3 pt-3 border-t border-border">
      <button
        type="button"
        className="flex items-center gap-2 text-[12px] font-medium text-text-primary"
        onClick={() => setOpen((v) => !v)}
      >
        {open ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
        <span>{t("feishu.permissions.title")}</span>
        {initial === null ? (
          <span className="text-[11px] text-text-muted font-normal">
            ({t("feishu.permissions.usingDefaults")})
          </span>
        ) : null}
      </button>
      {open ? (
        <div className="mt-3 space-y-3">
          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={draft.requireMention}
              onChange={(e) =>
                setDraft({ ...draft, requireMention: e.target.checked })
              }
              disabled={controlsDisabled}
            />
            <span className="text-[12px] text-text-primary">
              {t("feishu.permissions.requireMention")}
            </span>
          </label>

          <PolicyField
            label={t("feishu.permissions.dmPolicy")}
            value={draft.dmPolicy}
            onChange={(v) => setDraft({ ...draft, dmPolicy: v })}
            disabled={controlsDisabled}
          />

          <PolicyField
            label={t("feishu.permissions.groupPolicy")}
            value={draft.groupPolicy}
            onChange={(v) => setDraft({ ...draft, groupPolicy: v })}
            disabled={controlsDisabled}
          />

          {needsAllowlist ? (
            <div>
              <div className="flex items-center gap-1 text-[12px] text-text-primary mb-1">
                <span>{t("feishu.permissions.allowFrom")}</span>
                <a
                  href="https://open.feishu.cn/document/server-docs/contact-v3/user/get"
                  target="_blank"
                  rel="noreferrer"
                  className="text-text-muted hover:text-text-primary inline-flex"
                  title={t("feishu.permissions.openIdHelp")}
                  aria-label={t("feishu.permissions.openIdHelp")}
                >
                  <HelpCircle size={12} />
                </a>
              </div>
              <textarea
                className="w-full font-mono text-[11px] p-2 rounded-md border border-border bg-surface-1 text-text-primary focus:outline-none focus:ring-1 focus:ring-ring disabled:opacity-60"
                rows={4}
                placeholder="ou_xxxxxxxx"
                value={draft.allowFrom.join("\n")}
                onChange={(e) =>
                  setDraft({
                    ...draft,
                    allowFrom: e.target.value
                      .split("\n")
                      .map((s) => s.trim())
                      .filter(Boolean),
                  })
                }
                disabled={controlsDisabled}
              />
            </div>
          ) : null}

          <BrowserOwnersEditor
            channelId={channelId}
            value={draft.browserOwnerIds}
            onChange={(browserOwnerIds) =>
              setDraft({ ...draft, browserOwnerIds })
            }
            disabled={controlsDisabled}
          />

          <div className="flex items-center gap-2 pt-1">
            <button
              type="button"
              onClick={save}
              disabled={!dirty || controlsDisabled}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-[12px] font-medium text-white rounded-lg bg-accent hover:bg-accent-hover transition-all disabled:opacity-60"
            >
              {mutation.isPending ? (
                <Loader2 size={12} className="animate-spin" />
              ) : null}
              {t("feishu.permissions.save")}
            </button>
            <button
              type="button"
              onClick={reset}
              disabled={!dirty || controlsDisabled}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-[12px] font-medium text-text-secondary rounded-lg border border-border hover:border-border-hover hover:bg-surface-3 transition-all disabled:opacity-60"
            >
              {t("feishu.permissions.reset")}
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function PolicyField({
  label,
  value,
  onChange,
  disabled,
}: {
  label: string;
  value: FeishuPolicy;
  onChange: (v: FeishuPolicy) => void;
  disabled?: boolean;
}) {
  const { t } = useTranslation();
  const options: { value: FeishuPolicy; label: string }[] = [
    { value: "open", label: t("feishu.permissions.policy.open") },
    { value: "allowlist", label: t("feishu.permissions.policy.allowlist") },
    { value: "disabled", label: t("feishu.permissions.policy.disabled") },
  ];
  return (
    <div>
      <div className="text-[12px] text-text-primary mb-1">{label}</div>
      <div className="inline-flex rounded-md border border-border overflow-hidden">
        {options.map((o) => {
          const selected = value === o.value;
          return (
            <button
              key={o.value}
              type="button"
              disabled={disabled}
              onClick={() => onChange(o.value)}
              className={
                selected
                  ? "px-3 py-1 text-[11px] font-medium bg-accent text-white disabled:opacity-60"
                  : "px-3 py-1 text-[11px] font-medium bg-surface-1 text-text-secondary hover:bg-surface-3 disabled:opacity-60"
              }
            >
              {o.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}

function formatLastActive(lastActiveAt: number | null): string {
  if (!lastActiveAt) return "";
  return new Date(lastActiveAt).toLocaleString([], {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/**
 * Whitelist manager for the embedded-browser owner list. The pain point it
 * removes: nobody knows their own `ou_` open_id — but the runtime holds one
 * session per DM peer, so recent peers are offered as one-click candidates,
 * with a manual field as the fallback. Edits land in the parent draft and
 * ship with the panel's normal save.
 */
function BrowserOwnersEditor({
  channelId,
  value,
  onChange,
  disabled,
}: {
  channelId: string;
  value: string[];
  onChange: (next: string[]) => void;
  disabled?: boolean;
}) {
  const { t } = useTranslation();
  const [manualDraft, setManualDraft] = useState("");
  const peersQuery = useQuery({
    queryKey: ["feishu-dm-peers", channelId],
    queryFn: async () => {
      const response = await getApiV1ChannelsByChannelIdFeishuDmPeers({
        path: { channelId },
      });
      if (response.error || !response.data) {
        throw new Error(t("feishu.permissions.browserOwnersRecentError"));
      }
      return response.data.peers;
    },
  });

  function add(openId: string) {
    const trimmed = openId.trim();
    if (!trimmed || value.includes(trimmed)) return;
    onChange([...value, trimmed]);
  }

  return (
    <div>
      <div className="flex items-center gap-1 text-[12px] text-text-primary mb-1">
        <span>{t("feishu.permissions.browserOwners")}</span>
        <a
          href="https://open.feishu.cn/document/server-docs/contact-v3/user/get"
          target="_blank"
          rel="noreferrer"
          className="text-text-muted hover:text-text-primary inline-flex"
          title={t("feishu.permissions.openIdHelp")}
          aria-label={t("feishu.permissions.openIdHelp")}
        >
          <HelpCircle size={12} />
        </a>
      </div>
      <div className="text-[11px] text-text-muted mb-2">
        {t("feishu.permissions.browserOwnersHint")}
      </div>

      {value.length === 0 ? (
        <div className="text-[11px] text-text-muted mb-2">
          {t("feishu.permissions.browserOwnersEmpty")}
        </div>
      ) : (
        <div className="flex flex-wrap gap-1.5 mb-2">
          {value.map((openId) => (
            <span
              key={openId}
              className="inline-flex items-center gap-1 pl-2 pr-1 py-0.5 rounded-md border border-border bg-surface-1 font-mono text-[11px] text-text-primary"
            >
              {openId}
              <button
                type="button"
                onClick={() => onChange(value.filter((id) => id !== openId))}
                disabled={disabled}
                aria-label={t("feishu.permissions.browserOwnersRemove")}
                className="text-text-muted hover:text-text-primary disabled:opacity-60"
              >
                <X size={11} />
              </button>
            </span>
          ))}
        </div>
      )}

      <div className="rounded-md border border-border bg-surface-1 p-2 mb-2">
        <div className="text-[11px] text-text-secondary mb-1">
          {t("feishu.permissions.browserOwnersRecent")}
        </div>
        {peersQuery.isLoading ? (
          <Loader2 size={12} className="animate-spin text-text-muted" />
        ) : peersQuery.isError ? (
          <div className="text-[11px] text-text-muted">
            {t("feishu.permissions.browserOwnersRecentError")}
          </div>
        ) : (peersQuery.data?.length ?? 0) === 0 ? (
          <div className="text-[11px] text-text-muted">
            {t("feishu.permissions.browserOwnersRecentEmpty")}
          </div>
        ) : (
          <div className="space-y-1">
            {peersQuery.data?.slice(0, 8).map((peer) => {
              const added = value.includes(peer.openId);
              return (
                <div
                  key={peer.openId}
                  className="flex items-center justify-between gap-2"
                >
                  <span className="font-mono text-[11px] text-text-primary truncate">
                    {peer.openId}
                  </span>
                  <span className="text-[10px] text-text-muted shrink-0">
                    {formatLastActive(peer.lastActiveAt)}
                  </span>
                  <button
                    type="button"
                    onClick={() => add(peer.openId)}
                    disabled={disabled || added}
                    className="shrink-0 px-2 py-0.5 text-[11px] font-medium rounded-md border border-border text-text-secondary hover:bg-surface-3 disabled:opacity-60"
                  >
                    {added
                      ? t("feishu.permissions.browserOwnersAdded")
                      : t("feishu.permissions.browserOwnersAdd")}
                  </button>
                </div>
              );
            })}
          </div>
        )}
      </div>

      <div className="flex items-center gap-2">
        <input
          className="flex-1 font-mono text-[11px] px-2 py-1 rounded-md border border-border bg-surface-1 text-text-primary focus:outline-none focus:ring-1 focus:ring-ring disabled:opacity-60"
          placeholder={t("feishu.permissions.browserOwnersManualPlaceholder")}
          value={manualDraft}
          onChange={(e) => setManualDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              add(manualDraft);
              setManualDraft("");
            }
          }}
          disabled={disabled}
        />
        <button
          type="button"
          onClick={() => {
            add(manualDraft);
            setManualDraft("");
          }}
          disabled={disabled || manualDraft.trim().length === 0}
          className="px-2.5 py-1 text-[11px] font-medium rounded-md border border-border text-text-secondary hover:bg-surface-3 disabled:opacity-60"
        >
          {t("feishu.permissions.browserOwnersAdd")}
        </button>
      </div>
    </div>
  );
}
