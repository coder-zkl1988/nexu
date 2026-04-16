import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Loader2 } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import {
  getApiV1RuntimeConfig,
  patchApiV1RuntimeConfigDeviceControl,
} from "../../../lib/api/sdk.gen";

const RUNTIME_CONFIG_QUERY_KEY = ["runtime-config"] as const;

export function DeviceControlSettingsSection() {
  const qc = useQueryClient();
  const { data, isLoading } = useQuery({
    queryKey: RUNTIME_CONFIG_QUERY_KEY,
    queryFn: async () => {
      const res = await getApiV1RuntimeConfig();
      if (res.error) throw new Error("Failed to load runtime config");
      return res.data;
    },
  });

  const deviceControl = data?.deviceControl;
  const [wsPort, setWsPort] = useState("");
  const [rpcPort, setRpcPort] = useState("");

  useEffect(() => {
    if (deviceControl) {
      setWsPort(String(deviceControl.wsPort));
      setRpcPort(String(deviceControl.rpcPort));
    }
  }, [deviceControl]);

  const patchMutation = useMutation({
    mutationFn: async (body: {
      enabled?: boolean;
      wsPort?: number;
      rpcPort?: number;
    }) => {
      const res = await patchApiV1RuntimeConfigDeviceControl({ body });
      if (res.error) throw new Error("Update failed");
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: RUNTIME_CONFIG_QUERY_KEY });
      toast.success("Device control updated");
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const handleToggle = (checked: boolean) => {
    patchMutation.mutate({ enabled: checked });
  };

  const handleSavePorts = () => {
    const ws = Number(wsPort);
    const rpc = Number(rpcPort);
    if (
      !Number.isInteger(ws) ||
      ws <= 0 ||
      !Number.isInteger(rpc) ||
      rpc <= 0
    ) {
      toast.error("Ports must be positive integers");
      return;
    }
    patchMutation.mutate({ wsPort: ws, rpcPort: rpc });
  };

  if (isLoading || !deviceControl) {
    return (
      <Card>
        <CardContent className="flex items-center gap-2 py-6 text-[13px] text-text-muted">
          <Loader2 className="h-4 w-4 animate-spin" />
          Loading device control config…
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Android Device Control</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-5">
        <div className="flex items-center justify-between">
          <div>
            <div className="text-[13px] font-medium">Enable plugin</div>
            <div className="text-[12px] text-text-muted mt-0.5">
              Runs the lobster-device-control plugin to accept Android
              connections at ws://0.0.0.0:{deviceControl.wsPort}/phone
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
            <Label htmlFor="ws-port">WebSocket port (phone)</Label>
            <Input
              id="ws-port"
              type="number"
              min={1}
              max={65535}
              value={wsPort}
              onChange={(e) => setWsPort(e.target.value)}
              disabled={patchMutation.isPending}
            />
          </div>
          <div className="flex-1 flex flex-col gap-1.5">
            <Label htmlFor="rpc-port">HTTP RPC port (controller)</Label>
            <Input
              id="rpc-port"
              type="number"
              min={1}
              max={65535}
              value={rpcPort}
              onChange={(e) => setRpcPort(e.target.value)}
              disabled={patchMutation.isPending}
            />
          </div>
          <div className="flex items-end">
            <Button
              type="button"
              onClick={handleSavePorts}
              disabled={patchMutation.isPending}
            >
              Save ports
            </Button>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
