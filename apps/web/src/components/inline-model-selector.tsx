import { track } from "@/lib/tracking";
import { cn } from "@/lib/utils";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, ChevronDown } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import {
  getApiInternalDesktopDefaultModel,
  getApiV1Models,
  putApiInternalDesktopDefaultModel,
} from "../../lib/api/sdk.gen";

export interface InlineModelSelectorProps {
  selectedModelId?: string;
  onSelectModel?: (modelId: string) => void;
}

function getProviderIdFromModelId(
  models: Array<{ id: string; name: string; provider: string }>,
  modelId: string,
): string | null {
  const matched = models.find((model) => model.id === modelId);
  if (matched) {
    return matched.provider;
  }
  const [provider] = modelId.split("/");
  return provider || null;
}

export function InlineModelSelector(props: InlineModelSelectorProps) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();

  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  // Controlled mode (props provided)
  const controlledMode =
    props.selectedModelId !== undefined && props.onSelectModel !== undefined;

  // Fetch current model (uncontrolled/standalone mode)
  const { data: defaultModelData } = useQuery({
    queryKey: ["desktop-default-model"],
    queryFn: async () => {
      const { data } = await getApiInternalDesktopDefaultModel();
      return data as { modelId: string | null } | undefined;
    },
    enabled: !controlledMode,
  });

  // Fetch available models
  const { data: modelsData } = useQuery({
    queryKey: ["models"],
    queryFn: async () => {
      const { data } = await getApiV1Models();
      return data;
    },
    staleTime: 5 * 60 * 1000,
  });
  const models = (modelsData?.models ?? []) as Array<{
    id: string;
    name: string;
    provider: string;
  }>;

  const currentModelId = controlledMode
    ? (props.selectedModelId ?? "")
    : (defaultModelData?.modelId ?? "");

  // Update model mutation (uncontrolled/standalone mode)
  const updateModel = useMutation({
    mutationFn: async (modelId: string) => {
      const toastId = toast.loading(t("models.switchingModel"));
      const { error } = await putApiInternalDesktopDefaultModel({
        body: { modelId },
      });
      if (error) {
        toast.error(t("models.modelSwitchFailed"), { id: toastId });
        throw new Error("Failed to update model");
      }
      toast.success(t("models.modelSwitched"), { id: toastId });
    },
    onSuccess: (_, modelId) => {
      track("workspace_change_model_change", {
        previous_provider_name: getProviderIdFromModelId(
          models,
          currentModelId,
        ),
        previous_model_name: currentModelId || null,
        provider_name: getProviderIdFromModelId(models, modelId),
        model_name: modelId,
      });
      queryClient.invalidateQueries({ queryKey: ["desktop-default-model"] });
      queryClient.invalidateQueries({ queryKey: ["channels-live-status"] });
    },
  });

  const handleSelect = (modelId: string) => {
    if (controlledMode && props.onSelectModel) {
      props.onSelectModel(modelId);
    } else {
      updateModel.mutate(modelId);
    }
    setOpen(false);
  };

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  const currentModel = models.find((m) => m.id === currentModelId);
  const displayName = (currentModel?.name ?? currentModelId) || "Default";

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className={cn(
          "flex items-center gap-1 px-2 h-8 rounded-lg hover:bg-[var(--color-tabby-canvas)] transition-colors text-[var(--color-tabby-muted)] text-sm",
          open && "bg-[var(--color-tabby-canvas)]",
        )}
      >
        <span className="max-w-[120px] truncate">{displayName}</span>
        <ChevronDown
          size={13}
          className={cn("transition-transform shrink-0", open && "rotate-180")}
        />
      </button>

      {open && (
        <div className="absolute right-0 top-full z-50 mt-1.5 w-52 bg-white border border-[var(--color-tabby-border)] rounded-xl shadow-lg max-h-72 overflow-y-auto">
          {(() => {
            const filtered = models.filter((m) => m.id && m.name);
            const groups = new Map<string, typeof filtered>();
            for (const m of filtered) {
              const provider = m.provider || "Other";
              if (!groups.has(provider)) groups.set(provider, []);
              groups.get(provider)?.push(m);
            }
            return Array.from(groups.entries()).map(
              ([provider, providerModels], gi) => (
                <div key={provider}>
                  <div
                    className={cn(
                      "px-3 py-1.5 text-[10px] font-semibold text-[var(--color-tabby-muted)] uppercase tracking-wide",
                      gi > 0 && "border-t border-[var(--color-tabby-border)]",
                    )}
                  >
                    {provider}
                  </div>
                  {providerModels.map((m) => (
                    <button
                      key={m.id}
                      type="button"
                      onClick={() => handleSelect(m.id ?? "")}
                      className="flex items-center gap-2 w-full px-3 py-2 text-left text-sm hover:bg-[var(--color-tabby-canvas)] transition-colors"
                    >
                      <div className="flex-1 min-w-0">
                        <div className="text-[13px] text-[var(--color-tabby-foreground)] truncate">
                          {m.name}
                        </div>
                      </div>
                      {currentModelId === m.id && (
                        <Check
                          size={14}
                          className="text-[var(--color-tabby-orange)] shrink-0"
                        />
                      )}
                    </button>
                  ))}
                </div>
              ),
            );
          })()}
        </div>
      )}
    </div>
  );
}
