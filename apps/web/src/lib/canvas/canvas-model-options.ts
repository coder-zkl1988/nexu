/**
 * canvas-model-options.ts
 *
 * Shared model list for the canvas generation model pickers (W5). The selected
 * model id is a best-effort HINT — the generation lane honors it only if the
 * active tool/skill supports model selection.
 */

import {
  QueryClient,
  QueryClientContext,
  useQuery,
} from "@tanstack/react-query";
import { useContext } from "react";
import { getApiV1Models } from "../../../lib/api/sdk.gen";

// Standalone fallback so the fetch works even when a picker is rendered outside
// an app-level QueryClientProvider (e.g. canvas static-markup tests). In the
// running app the provider's client is used, so the ["models"] cache is shared.
const fallbackQueryClient = new QueryClient();

export type CanvasModelOption = { id: string; name: string };

/** Available generation models for the canvas model pickers. */
export function useCanvasModelOptions(): CanvasModelOption[] {
  const ctxClient = useContext(QueryClientContext);
  const { data } = useQuery(
    {
      queryKey: ["models"],
      queryFn: async () => {
        const { data: d } = await getApiV1Models();
        return d;
      },
      staleTime: 5 * 60 * 1000,
    },
    ctxClient ?? fallbackQueryClient,
  );
  return data?.models ?? [];
}
