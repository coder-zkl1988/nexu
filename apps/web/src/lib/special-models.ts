// Tabby Official models reserved for a specific internal purpose. They are not
// general chat models, so the model picker shows them greyed-out (non-selectable)
// with a purpose label instead of letting a bot be assigned to them.
const SPECIAL_PURPOSE_MODEL_LABEL_KEYS: Record<string, string> = {
  "tabby-phone": "models.special.phone",
  "tabby-image": "models.special.image",
  "tabby-image-free": "models.special.image",
  "tabby-video": "models.special.video",
};

/**
 * Return the i18n key for a model's purpose label if the model is reserved for a
 * specific internal use (phone control, image generation, …), otherwise null.
 * A non-null result means the model must not be selectable as a bot chat model.
 */
export function getSpecialModelLabelKey(modelId: string): string | null {
  return SPECIAL_PURPOSE_MODEL_LABEL_KEYS[modelId] ?? null;
}
