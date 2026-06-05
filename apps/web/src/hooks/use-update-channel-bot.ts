import { useMutation, useQueryClient } from "@tanstack/react-query";
import { patchApiV1ChannelsByChannelId } from "../../lib/api/sdk.gen";

export function useUpdateChannelBot() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({
      channelId,
      botId,
    }: {
      channelId: string;
      botId: string;
    }) => {
      const { data, error } = await patchApiV1ChannelsByChannelId({
        path: { channelId },
        body: { botId },
      });
      if (error) {
        throw new Error(
          (error as { message?: string } | undefined)?.message ??
            "Failed to update channel bot",
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
