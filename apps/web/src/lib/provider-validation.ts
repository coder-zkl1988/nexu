export type ProviderVerificationResult = {
  valid: boolean;
  models?: string[];
  modelDetails?: Array<{
    id: string;
    contextWindow?: number;
    maxTokens?: number;
  }>;
  error?: string;
};

export function normalizeVerifiedModelIds(
  models: unknown[] | undefined,
): string[] {
  if (!models) {
    return [];
  }

  return [
    ...new Set(
      models
        .map((model) => {
          if (typeof model === "string") {
            return model.trim();
          }
          if (
            model &&
            typeof model === "object" &&
            "id" in model &&
            typeof model.id === "string"
          ) {
            return model.id.trim();
          }
          return null;
        })
        .filter((modelId): modelId is string => Boolean(modelId)),
    ),
  ];
}

export function requireUsableProviderModels(
  result: {
    valid: boolean;
    models?: unknown[];
    error?: string;
  },
  messages: {
    invalid: string;
    noModels: string;
  },
): string[] {
  if (!result.valid) {
    throw new Error(result.error?.trim() || messages.invalid);
  }

  const models = normalizeVerifiedModelIds(result.models);
  if (models.length === 0) {
    throw new Error(messages.noModels);
  }

  return models;
}

export async function saveVerifiedProviderModels(
  verify: () => Promise<ProviderVerificationResult>,
  save: (models: string[], result: ProviderVerificationResult) => Promise<void>,
  messages: {
    invalid: string;
    noModels: string;
  },
): Promise<string[]> {
  const result = await verify();
  const models = requireUsableProviderModels(result, messages);
  await save(models, result);
  return models;
}
