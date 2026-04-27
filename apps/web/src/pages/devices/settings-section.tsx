import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { formatChannelConnectErrorMessage } from "@/lib/channel-connect-errors";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Loader2 } from "lucide-react";
import { useEffect, useState } from "react";
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
  const [wsPort, setWsPort] = useState("");
  const [rpcPort, setRpcPort] = useState("");
  const [portsDirty, setPortsDirty] = useState(false);

  useEffect(() => {
    if (deviceControl && !portsDirty) {
      setWsPort(String(deviceControl.wsPort));
      setRpcPort(String(deviceControl.rpcPort));
    }
  }, [deviceControl, portsDirty]);

  const patchMutation = useMutation({
    mutationFn: async (body: {
      enabled?: boolean;
      wsPort?: number;
      rpcPort?: number;
    }) => {
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

  const handleSavePorts = async () => {
    const ws = Number(wsPort);
    const rpc = Number(rpcPort);
    if (
      !Number.isInteger(ws) ||
      ws <= 0 ||
      ws > 65535 ||
      !Number.isInteger(rpc) ||
      rpc <= 0 ||
      rpc > 65535
    ) {
      toast.error(t("devices.settings.portValidationError"));
      return;
    }
    if (ws === rpc) {
      toast.error(t("devices.settings.portConflictError"));
      return;
    }
    try {
      await patchMutation.mutateAsync({ wsPort: ws, rpcPort: rpc });
      setPortsDirty(false);
    } catch {
      // toast already fired by mutation onError
    }
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
      <CardContent className="flex flex-col gap-5">
        <div className="flex items-center justify-between">
          <div>
            <div className="text-[13px] font-medium">
              {t("devices.settings.enablePlugin")}
            </div>
            <div className="text-[12px] text-text-muted mt-0.5">
              {t("devices.settings.enablePluginDesc", {
                wsPort: String(deviceControl.wsPort),
              })}
            </div>
          </div>
          <Switch
            checked={deviceControl.enabled}
            onCheckedChange={handleToggle}
            disabled={patchMutation.isPending}
          />
        </div>

        <div className="flex flex-col sm:flex-row gap-3">
          <div className="flex-1 flex flex-col gap-1.5">
            <Label htmlFor="ws-port">{t("devices.settings.wsPort")}</Label>
            <Input
              id="ws-port"
              type="number"
              min={1}
              max={65535}
              value={wsPort}
              onChange={(e) => {
                setWsPort(e.target.value);
                setPortsDirty(true);
              }}
              disabled={patchMutation.isPending}
            />
          </div>
          <div className="flex-1 flex flex-col gap-1.5">
            <Label htmlFor="rpc-port">{t("devices.settings.rpcPort")}</Label>
            <Input
              id="rpc-port"
              type="number"
              min={1}
              max={65535}
              value={rpcPort}
              onChange={(e) => {
                setRpcPort(e.target.value);
                setPortsDirty(true);
              }}
              disabled={patchMutation.isPending}
            />
          </div>
          <div className="flex items-end">
            <Button
              type="button"
              onClick={handleSavePorts}
              disabled={patchMutation.isPending}
            >
              {t("devices.settings.savePorts")}
            </Button>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
