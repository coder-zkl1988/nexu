import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { formatChannelConnectErrorMessage } from "@/lib/channel-connect-errors";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Loader2 } from "lucide-react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import {
  getApiV1RuntimeConfig,
  patchApiV1RuntimeConfigDeviceControl,
} from "../../../lib/api/sdk.gen";

const RUNTIME_CONFIG_QUERY_KEY = ["runtime-config"] as const;

export function DeviceControlSettingsSection() {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const { data, isLoading } = useQuery({
    queryKey: RUNTIME_CONFIG_QUERY_KEY,
    queryFn: async () => {
      const res = await getApiV1RuntimeConfig();
      if (res.error) {
        throw new Error(
          formatChannelConnectErrorMessage(
            res.error,
            t("devices.settings.loading"),
          ),
        );
      }
      return res.data;
    },
  });

  const deviceControl = data?.deviceControl;

  const patchMutation = useMutation({
    mutationFn: async (body: { enabled?: boolean }) => {
      const res = await patchApiV1RuntimeConfigDeviceControl({ body });
      if (res.error) {
        throw new Error(
          formatChannelConnectErrorMessage(
            res.error,
            t("devices.settings.updateFailed"),
          ),
        );
      }
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: RUNTIME_CONFIG_QUERY_KEY });
      toast.success(t("devices.settings.updated"));
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const handleToggle = (checked: boolean) => {
    patchMutation.mutate({ enabled: checked });
  };

  if (isLoading || !deviceControl) {
    return (
      <Card>
        <CardContent className="flex items-center gap-2 py-6 text-[13px] text-text-muted">
          <Loader2 className="h-4 w-4 animate-spin" />
          {t("devices.settings.loading")}
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t("devices.settings.title")}</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="flex items-center justify-between">
          <div>
            <div className="text-[13px] font-medium">
              {t("devices.settings.enablePlugin")}
            </div>
            <div className="text-[12px] text-text-muted mt-0.5">
              WebSocket 端口 18790，RPC 端口 18801 为预置端口，无需修改。
            </div>
          </div>
          <Switch
            checked={deviceControl.enabled}
            onCheckedChange={handleToggle}
            disabled={patchMutation.isPending}
          />
        </div>
      </CardContent>
    </Card>
  );
}
