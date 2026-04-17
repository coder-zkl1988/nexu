import { useUpdateChannelBot } from "@/hooks/use-update-channel-bot";
import {
  CheckCircle2,
  Loader2,
  Pencil,
  Shield,
  X as XIcon,
} from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { BotPicker } from "./bot-picker";
import {
  type FeishuPermissionsDraft,
  FeishuPermissionsPanel,
} from "./feishu-permissions-panel";

/**
 * Minimal channel shape required by the instance card. Kept structural (not
 * tied to the @nexu/shared ChannelResponse) so it also matches the SDK's
 * generated response type, which treats teamName as non-nullable and keeps
 * feishuPermissions fields optional.
 */
export type ChannelInstance = {
  id: string;
  botId: string;
  accountId: string;
  teamName: string | null;
  status: string;
  channelType?: string;
  feishuPermissions?: FeishuPermissionsDraft | null;
};

type Props = {
  channel: ChannelInstance;
  botName: string;
  liveStatus?: string;
};

function StatusIcon({ status }: { status: string }) {
  if (status === "error" || status === "disconnected") {
    return <Shield size={14} className="text-red-500 shrink-0" />;
  }
  if (status === "connecting" || status === "restarting") {
    return (
      <Loader2 size={14} className="text-amber-500 shrink-0 animate-spin" />
    );
  }
  return (
    <CheckCircle2 size={14} className="text-[var(--color-success)] shrink-0" />
  );
}

export function ChannelInstanceCard({ channel, botName, liveStatus }: Props) {
  const { t } = useTranslation();
  const [editing, setEditing] = useState(false);
  const [draftBotId, setDraftBotId] = useState<string | null>(channel.botId);
  const patch = useUpdateChannelBot();

  const status = liveStatus ?? channel.status;

  async function handleSave() {
    if (!draftBotId || draftBotId === channel.botId) return;
    try {
      await patch.mutateAsync({
        channelId: channel.id,
        botId: draftBotId,
      });
      setEditing(false);
      toast.success(t("channels.instance.saved"));
    } catch (e: unknown) {
      const message =
        e instanceof Error ? e.message : t("channels.instance.saveFailed");
      toast.error(message);
    }
  }

  function handleCancel() {
    setDraftBotId(channel.botId);
    setEditing(false);
  }

  const saveDisabled =
    patch.isPending || !draftBotId || draftBotId === channel.botId;

  return (
    <div className="p-4 rounded-xl border bg-surface-1 border-border">
      <div className="flex items-center justify-between gap-3 mb-3">
        <div className="min-w-0">
          <div className="text-[13px] font-semibold text-text-primary truncate">
            {channel.teamName || channel.accountId}
          </div>
          {channel.teamName ? (
            <div className="text-[11px] text-text-muted mt-0.5 truncate">
              {channel.accountId}
            </div>
          ) : null}
        </div>
        <div className="flex items-center gap-1.5 shrink-0">
          <StatusIcon status={status} />
          <span className="text-[11px] text-text-muted capitalize">
            {status}
          </span>
        </div>
      </div>

      {editing ? (
        <div className="space-y-2">
          <BotPicker
            value={draftBotId}
            onChange={setDraftBotId}
            required
            disabled={patch.isPending}
          />
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={handleSave}
              disabled={saveDisabled}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-[12px] font-medium text-white rounded-lg bg-accent hover:bg-accent-hover transition-all disabled:opacity-60"
            >
              {patch.isPending ? (
                <Loader2 size={12} className="animate-spin" />
              ) : null}
              {t("channels.instance.save")}
            </button>
            <button
              type="button"
              onClick={handleCancel}
              disabled={patch.isPending}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-[12px] font-medium text-text-secondary rounded-lg border border-border hover:border-border-hover hover:bg-surface-3 transition-all disabled:opacity-60"
            >
              <XIcon size={12} />
              {t("channels.instance.cancel")}
            </button>
          </div>
        </div>
      ) : (
        <div className="flex items-center justify-between gap-3">
          <div className="text-[12px] text-text-secondary min-w-0">
            <span className="text-text-muted">
              {t("channels.instance.routedTo")}
            </span>{" "}
            <span className="font-medium text-text-primary truncate">
              {botName}
            </span>
          </div>
          <button
            type="button"
            onClick={() => setEditing(true)}
            className="inline-flex items-center gap-1.5 px-2.5 py-1.5 text-[11px] font-medium text-text-secondary rounded-lg border border-border hover:border-border-hover hover:bg-surface-3 transition-all shrink-0"
          >
            <Pencil size={11} />
            {t("channels.instance.change")}
          </button>
        </div>
      )}

      {channel.channelType === "feishu" ? (
        <FeishuPermissionsPanel
          channelId={channel.id}
          initial={channel.feishuPermissions ?? null}
        />
      ) : null}
    </div>
  );
}
