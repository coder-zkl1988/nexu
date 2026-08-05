import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Loader2, TerminalSquare } from "lucide-react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { getApiV1Bots, patchApiV1BotsByBotId } from "../../lib/api/sdk.gen";
import type { GetApiV1BotsResponse } from "../../lib/api/types.gen";

const BOTS_QUERY_KEY = ["bots", "host-execution"] as const;

type Bot = GetApiV1BotsResponse["bots"][number];
type HostExecutionSurface = "channels" | "automations";

export function HostExecutionSettingsSection() {
  const { t } = useTranslation();
  const queryClient = useQueryClient();

  const { data, isLoading, isError } = useQuery({
    queryKey: BOTS_QUERY_KEY,
    queryFn: async () => {
      const response = await getApiV1Bots();
      if (response.error || !response.data) {
        throw new Error(t("hostExecution.loadFailed"));
      }
      return response.data;
    },
  });

  const updateMutation = useMutation({
    mutationFn: async (input: {
      botId: string;
      surface: HostExecutionSurface;
      enabled: boolean;
    }) => {
      const response = await patchApiV1BotsByBotId({
        path: { botId: input.botId },
        body: {
          hostExecution: {
            [input.surface]: input.enabled ? "host" : "restricted",
          },
        },
      });
      if (response.error) throw new Error(t("hostExecution.updateFailed"));
      return response.data;
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: BOTS_QUERY_KEY });
      // Changing this restarts OpenClaw, because the guard reads its policy
      // once at plugin registration.
      toast.success(t("hostExecution.updated"));
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const bots = (data?.bots ?? []).filter((bot) => bot.status !== "deleted");

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <TerminalSquare className="size-4" />
          {t("hostExecution.title")}
        </CardTitle>
        <p className="mt-1 text-sm text-text-muted">
          {t("hostExecution.description")}
        </p>
      </CardHeader>
      <CardContent className="space-y-4">
        {isLoading ? (
          <div className="flex items-center gap-2 text-sm text-text-muted">
            <Loader2 className="size-4 animate-spin" />
            {t("hostExecution.loading")}
          </div>
        ) : isError ? (
          <div className="text-sm text-danger">
            {t("hostExecution.loadFailed")}
          </div>
        ) : bots.length === 0 ? (
          <div className="text-sm text-text-muted">
            {t("hostExecution.noBots")}
          </div>
        ) : (
          bots.map((bot: Bot) => (
            <div
              key={bot.id}
              data-host-execution-bot={bot.id}
              className="rounded-md border border-border p-3"
            >
              <div className="text-sm font-medium text-text-primary">
                {bot.name}
              </div>
              <div className="mt-3 space-y-3">
                {(
                  [
                    ["channels", t("hostExecution.channels")],
                    ["automations", t("hostExecution.automations")],
                  ] as const
                ).map(([surface, label]) => (
                  // Radix renders a button, not an input, so the control is
                  // associated by id rather than wrapped in a <label>.
                  <div
                    key={surface}
                    className="flex items-center justify-between gap-4"
                  >
                    <span
                      id={`host-execution-${bot.id}-${surface}-label`}
                      className="text-sm text-text-secondary"
                    >
                      {label}
                      <span className="mt-0.5 block text-xs text-text-muted">
                        {t(`hostExecution.${surface}Hint`)}
                      </span>
                    </span>
                    <Switch
                      aria-labelledby={`host-execution-${bot.id}-${surface}-label`}
                      data-host-execution-switch={`${bot.id}:${surface}`}
                      checked={bot.hostExecution?.[surface] === "host"}
                      disabled={updateMutation.isPending}
                      onCheckedChange={(enabled) =>
                        updateMutation.mutate({
                          botId: bot.id,
                          surface,
                          enabled,
                        })
                      }
                    />
                  </div>
                ))}
              </div>
            </div>
          ))
        )}
      </CardContent>
    </Card>
  );
}
