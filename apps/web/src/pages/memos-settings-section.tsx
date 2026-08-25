import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Cloud, KeyRound, Loader2 } from "lucide-react";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import {
  getApiV1MemosSettings,
  patchApiV1MemosSettings,
} from "../../lib/api/sdk.gen";

const MEMOS_SETTINGS_QUERY_KEY = ["memos-settings"] as const;

type MemosPatch = {
  enabled?: boolean;
  apiKey?: string;
  userId?: string;
  memoryLimitNumber?: number;
  relativity?: number;
};

export function MemosSettingsSection() {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const [apiKeyDraft, setApiKeyDraft] = useState("");
  const [userIdDraft, setUserIdDraft] = useState("tabby-user");
  const [memoryLimitDraft, setMemoryLimitDraft] = useState("9");
  const [relativityDraft, setRelativityDraft] = useState("0.4");

  const settingsQuery = useQuery({
    queryKey: MEMOS_SETTINGS_QUERY_KEY,
    queryFn: async () => {
      const response = await getApiV1MemosSettings();
      if (response.error || !response.data) {
        throw new Error(t("memos.loadFailed"));
      }
      return response.data.memos;
    },
  });

  useEffect(() => {
    if (!settingsQuery.data) return;
    setUserIdDraft(settingsQuery.data.userId ?? "tabby-user");
    setMemoryLimitDraft(String(settingsQuery.data.memoryLimitNumber ?? 9));
    setRelativityDraft(String(settingsQuery.data.relativity ?? 0.4));
    // The key is never sent back by the API, so the field always starts empty
    // and an untouched field must not overwrite the stored key.
    setApiKeyDraft("");
  }, [settingsQuery.data]);

  const updateMutation = useMutation({
    mutationFn: async (body: MemosPatch) => {
      const response = await patchApiV1MemosSettings({ body });
      if (response.error) throw new Error(t("memos.updateFailed"));
      return response.data?.memos;
    },
    onSuccess: (memos) => {
      if (memos) queryClient.setQueryData(MEMOS_SETTINGS_QUERY_KEY, memos);
      toast.success(t("memos.updated"));
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const saveDetails = () => {
    const limit = Number.parseInt(memoryLimitDraft, 10);
    if (!Number.isInteger(limit) || limit < 1 || limit > 50) {
      toast.error(t("memos.limitInvalid"));
      return;
    }
    const relativity = Number.parseFloat(relativityDraft);
    if (!Number.isFinite(relativity) || relativity < 0 || relativity > 1) {
      toast.error(t("memos.relativityInvalid"));
      return;
    }
    const trimmedUserId = userIdDraft.trim();
    if (trimmedUserId.length === 0) {
      toast.error(t("memos.userIdInvalid"));
      return;
    }
    const trimmedKey = apiKeyDraft.trim();
    void updateMutation.mutateAsync({
      userId: trimmedUserId,
      memoryLimitNumber: limit,
      relativity,
      // Only send the key when the user actually typed one.
      ...(trimmedKey.length > 0 ? { apiKey: trimmedKey } : {}),
    });
  };

  if (settingsQuery.isLoading) {
    return (
      <Card>
        <CardContent className="flex items-center gap-2 py-6 text-[13px] text-text-muted">
          <Loader2 className="h-4 w-4 animate-spin" />
          {t("memos.loading")}
        </CardContent>
      </Card>
    );
  }

  const memos = settingsQuery.data;
  if (!memos) {
    return (
      <Card>
        <CardContent className="py-6 text-[13px] text-text-muted">
          {t("memos.loadFailed")}
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Cloud className="h-4 w-4 text-text-secondary" />
          <CardTitle className="text-[13px]">{t("memos.title")}</CardTitle>
        </div>
        <div className="text-[11px] text-text-muted">
          {memos.apiKeyConfigured
            ? t("memos.keyConfigured")
            : t("memos.keyMissing")}
        </div>
      </CardHeader>
      <CardContent className="divide-y divide-border p-0">
        <div className="flex items-center justify-between gap-4 px-5 py-4">
          <div>
            <div className="text-[12px] font-medium text-text-primary">
              {t("memos.enabled")}
            </div>
            <div className="mt-1 text-[11px] text-text-secondary">
              {t("memos.enabledHint")}
            </div>
          </div>
          <Switch
            checked={memos.enabled}
            disabled={updateMutation.isPending || !memos.apiKeyConfigured}
            onCheckedChange={(enabled) =>
              void updateMutation.mutateAsync({ enabled })
            }
          />
        </div>

        <div className="space-y-4 px-5 py-4">
          <label
            htmlFor="memos-api-key"
            className="block text-[11px] text-text-secondary"
          >
            <span className="flex items-center gap-1.5">
              <KeyRound className="h-3.5 w-3.5" />
              {t("memos.apiKey")}
            </span>
            <Input
              id="memos-api-key"
              className="mt-1"
              type="password"
              autoComplete="off"
              value={apiKeyDraft}
              placeholder={
                memos.apiKeyConfigured
                  ? t("memos.apiKeyPlaceholderSet")
                  : t("memos.apiKeyPlaceholder")
              }
              onChange={(event) => setApiKeyDraft(event.target.value)}
            />
          </label>

          <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
            <label
              htmlFor="memos-user-id"
              className="block w-full max-w-48 text-[11px] text-text-secondary"
            >
              {t("memos.userId")}
              <Input
                id="memos-user-id"
                className="mt-1"
                value={userIdDraft}
                onChange={(event) => setUserIdDraft(event.target.value)}
              />
            </label>
            <label
              htmlFor="memos-memory-limit"
              className="block w-full max-w-40 text-[11px] text-text-secondary"
            >
              {t("memos.memoryLimit")}
              <Input
                id="memos-memory-limit"
                className="mt-1"
                type="number"
                min={1}
                max={50}
                value={memoryLimitDraft}
                onChange={(event) => setMemoryLimitDraft(event.target.value)}
              />
            </label>
            <label
              htmlFor="memos-relativity"
              className="block w-full max-w-40 text-[11px] text-text-secondary"
            >
              {t("memos.relativity")}
              <Input
                id="memos-relativity"
                className="mt-1"
                type="number"
                min={0}
                max={1}
                step={0.05}
                value={relativityDraft}
                onChange={(event) => setRelativityDraft(event.target.value)}
              />
            </label>
            <Button
              type="button"
              size="sm"
              disabled={updateMutation.isPending}
              onClick={saveDetails}
            >
              {updateMutation.isPending ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : null}
              {t("memos.save")}
            </Button>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
