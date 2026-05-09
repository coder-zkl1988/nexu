import type { FeishuPermissions } from "@nexu/shared";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { patchApiV1ChannelsByChannelIdFeishuPermissions } from "../../lib/api/sdk.gen";

export function useUpdateFeishuPermissions() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({
      channelId,
      perms,
    }: {
      channelId: string;
      perms: FeishuPermissions;
    }) => {
      const { data, error } =
        await patchApiV1ChannelsByChannelIdFeishuPermissions({
          path: { channelId },
          body: perms,
        });
      if (error) {
        throw new Error(
          (error as { message?: string } | undefined)?.message ??
            "Failed to update feishu permissions",
        );
      }
      return data;
    },
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["channels"] }),
        queryClient.invalidateQueries({ queryKey: ["channels-live-status"] }),
      ]);
    },
  });
}
