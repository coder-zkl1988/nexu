import type { UpdateChannelCapabilitiesInput } from "@nexu/shared";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { patchApiV1ChannelsByChannelIdCapabilities } from "../../lib/api/sdk.gen";

export function useUpdateChannelCapabilities() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (
      input: UpdateChannelCapabilitiesInput & { channelId: string },
    ) => {
      const { channelId, ...body } = input;
      const { data, error } = await patchApiV1ChannelsByChannelIdCapabilities({
        path: { channelId },
        body,
      });
      if (error) {
        throw new Error(
          (error as { message?: string } | undefined)?.message ??
            "Failed to update channel capabilities",
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
